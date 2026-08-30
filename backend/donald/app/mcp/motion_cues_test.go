package mcp

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofrs/uuid"
	"github.com/guregu/null/v6"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/nextwave/donald/core"
	"github.com/nextwave/donald/enums"
	"go.uber.org/config"
	"go.uber.org/zap"
)

func TestMotionActivityAcceptsSupportedEnums(t *testing.T) {
	for _, kind := range []string{
		"document.read",
		"message.send",
		"message.receive",
		"data.check",
		"calculate",
		"submit",
	} {
		t.Run(kind, func(t *testing.T) {
			cue := &ActivityCue{Kind: kind}
			if err := validateActivityCue(cue); err != nil {
				t.Fatalf("supported activity kind %q was rejected: %v", kind, err)
			}
		})
	}

	for _, phase := range []string{"", "started", "progress", "completed"} {
		t.Run("phase_"+phase, func(t *testing.T) {
			cue := &ActivityCue{Kind: "data.check", Phase: phase}
			if err := validateActivityCue(cue); err != nil {
				t.Fatalf("supported activity phase %q was rejected: %v", phase, err)
			}
		})
	}

	for _, kind := range []string{"document", "email", "record"} {
		t.Run("object_"+kind, func(t *testing.T) {
			cue := &ActivityCue{
				Kind:   "data.check",
				Object: &ActivityObject{Kind: kind, Label: "Commercial invoice"},
			}
			if err := validateActivityCue(cue); err != nil {
				t.Fatalf("supported object kind %q was rejected: %v", kind, err)
			}
		})
	}
}

func TestMotionActivityRejectsUnknownEnumsAndMissingObjectLabel(t *testing.T) {
	tests := []struct {
		name string
		cue  ActivityCue
	}{
		{name: "unknown activity", cue: ActivityCue{Kind: "document.write"}},
		{name: "unknown phase", cue: ActivityCue{Kind: "document.read", Phase: "queued"}},
		{name: "unknown object", cue: ActivityCue{Kind: "document.read", Object: &ActivityObject{Kind: "spreadsheet", Label: "Invoice"}}},
		{name: "missing object label", cue: ActivityCue{Kind: "document.read", Object: &ActivityObject{Kind: "document"}}},
		{name: "blank object label", cue: ActivityCue{Kind: "document.read", Object: &ActivityObject{Kind: "document", Label: "  "}}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateActivityCue(&tc.cue); err == nil {
				t.Fatalf("invalid activity cue was accepted: %#v", tc.cue)
			}
		})
	}
}

func TestMotionMetricValidatesCurrencyEvidence(t *testing.T) {
	valid := &MetricCue{
		Kind:     "currency",
		Value:    15765.25,
		Currency: "USD",
		Label:    "Duties and fees",
	}
	if err := validateMetricCue(valid); err != nil {
		t.Fatalf("valid currency metric was rejected: %v", err)
	}

	tests := []struct {
		name   string
		metric MetricCue
	}{
		{name: "unknown kind", metric: MetricCue{Kind: "percentage", Value: 12, Currency: "USD", Label: "Rate"}},
		{name: "not a number", metric: MetricCue{Kind: "currency", Value: math.NaN(), Currency: "USD", Label: "Fees"}},
		{name: "positive infinity", metric: MetricCue{Kind: "currency", Value: math.Inf(1), Currency: "USD", Label: "Fees"}},
		{name: "negative infinity", metric: MetricCue{Kind: "currency", Value: math.Inf(-1), Currency: "USD", Label: "Fees"}},
		{name: "lowercase code", metric: MetricCue{Kind: "currency", Value: 12, Currency: "usd", Label: "Fees"}},
		{name: "short code", metric: MetricCue{Kind: "currency", Value: 12, Currency: "US", Label: "Fees"}},
		{name: "long code", metric: MetricCue{Kind: "currency", Value: 12, Currency: "USDX", Label: "Fees"}},
		{name: "non-letter code", metric: MetricCue{Kind: "currency", Value: 12, Currency: "U1D", Label: "Fees"}},
		{name: "missing label", metric: MetricCue{Kind: "currency", Value: 12, Currency: "USD"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateMetricCue(&tc.metric); err == nil {
				t.Fatalf("invalid metric cue was accepted: %#v", tc.metric)
			}
		})
	}
}

func TestMotionCueDetailIsOmittedWhenNoCueIsProvided(t *testing.T) {
	detail, err := encodeMotionCues(nil, nil)
	if err != nil {
		t.Fatalf("encoding absent cues failed: %v", err)
	}
	if detail.Valid {
		t.Fatalf("absent cues must omit detail, got %q", detail.String)
	}
}

func TestMotionCuesOmitExplicitNullLegacyDetail(t *testing.T) {
	payload := deltaPayload{
		Detail: null.StringFrom(`{"activity":null,"metric":null}`),
	}

	liftMotionCues(&payload)

	if payload.Activity != nil {
		t.Fatalf("legacy activity:null must stay omitted, got %#v", payload.Activity)
	}
	if payload.Metric != nil {
		t.Fatalf("legacy metric:null must stay omitted, got %#v", payload.Metric)
	}
}

func TestMotionCuesRoundTripThroughDetailAndDeltaLift(t *testing.T) {
	activity := &ActivityCue{
		Kind:  "document.read",
		Phase: "started",
		Object: &ActivityObject{
			Kind:  "document",
			Label: "Commercial invoice",
		},
		Copy: "Reading the commercial invoice",
	}
	metric := &MetricCue{
		Kind:     "currency",
		Value:    15765.25,
		Currency: "USD",
		Label:    "Duties and fees",
	}

	detail, err := encodeMotionCues(activity, metric)
	if err != nil {
		t.Fatalf("encoding valid cues failed: %v", err)
	}
	payload := deltaPayload{Detail: detail}
	liftMotionCues(&payload)

	if payload.Activity == nil {
		t.Fatal("activity was not lifted from detail")
	}
	if !reflect.DeepEqual(payload.Activity, activity) {
		t.Fatalf("activity changed during round trip: got %#v, want %#v", payload.Activity, activity)
	}
	if payload.Metric == nil {
		t.Fatal("metric was not lifted from detail")
	}
	if *payload.Metric != *metric {
		t.Fatalf("metric changed during round trip: got %#v, want %#v", payload.Metric, metric)
	}
	if payload.Metric.Value != 15765.25 {
		t.Fatalf("numeric value changed during round trip: got %.17g", payload.Metric.Value)
	}
}

func TestReportProgressPersistsAndLiftsMotionCues(t *testing.T) {
	state := newMotionCueDBState()
	coreImpl := newMotionCueTestCore(t, state)
	handler := NewHandler(coreImpl, nil, zap.NewNop())
	ctx := context.Background()

	_, _, err := handler.ReportProgress(ctx, nil, ReportProgressParams{
		RunKey:  state.runKey,
		NodeKey: state.nodeKey,
		Message: "Trying an unsupported activity",
		Activity: &ActivityCue{
			Kind: "document.write",
		},
	})
	if err == nil {
		t.Fatal("ReportProgress accepted an unsupported activity kind")
	}
	if state.storedEventPayload() != nil {
		t.Fatal("an invalid cue reached event persistence")
	}

	percent := int64(45)
	activity := &ActivityCue{
		Kind:  "document.read",
		Phase: "progress",
		Object: &ActivityObject{
			Kind:  "document",
			Label: "Commercial invoice",
		},
		Copy: "Reading the commercial invoice",
	}
	metric := &MetricCue{
		Kind:     "currency",
		Value:    15765.25,
		Currency: "USD",
		Label:    "Duties and fees",
	}
	_, _, err = handler.ReportProgress(ctx, (*sdkmcp.CallToolRequest)(nil), ReportProgressParams{
		RunKey:   state.runKey,
		NodeKey:  state.nodeKey,
		Message:  "Reading invoice totals",
		Percent:  &percent,
		Activity: activity,
		Metric:   metric,
	})
	if err != nil {
		t.Fatalf("ReportProgress with valid cues failed: %v", err)
	}

	stored := state.storedEventPayload()
	if len(stored) == 0 {
		t.Fatal("ReportProgress did not persist an event payload")
	}
	if !strings.Contains(string(stored), `"detail":"{\"activity\":`) {
		t.Fatalf("stored payload does not carry cues through detail: %s", stored)
	}
	if gotMessage, gotPercent := state.storedNodeProgress(); gotMessage != "Reading invoice totals" || gotPercent != percent {
		t.Fatalf("node progress was not persisted: message=%q percent=%d", gotMessage, gotPercent)
	}

	deltas, err := deltasAfter(ctx, coreImpl.DB(), state.runUUID, 0)
	if err != nil {
		t.Fatalf("reading persisted delta failed: %v", err)
	}
	if len(deltas) != 1 {
		t.Fatalf("got %d deltas, want 1", len(deltas))
	}
	got := deltas[0].Payload
	if !reflect.DeepEqual(got.Activity, activity) {
		t.Fatalf("typed SSE activity changed after persistence: got %#v, want %#v", got.Activity, activity)
	}
	if !reflect.DeepEqual(got.Metric, metric) {
		t.Fatalf("typed SSE metric changed after persistence: got %#v, want %#v", got.Metric, metric)
	}
	if got.Metric == nil || got.Metric.Value != 15765.25 {
		t.Fatalf("typed SSE numeric value changed: %#v", got.Metric)
	}

	legacyDetail, err := json.Marshal(map[string]any{
		"activity":        activity,
		"metric":          metric,
		"edge_key":        "prepare->read_invoice",
		"source_node_key": "prepare",
		"target_node_key": "read_invoice",
		"steps":           []map[string]any{{"node_key": "prepare", "label": "Prepare"}},
		"edges":           []map[string]string{{"edge_key": "prepare->read_invoice", "source_node_key": "prepare", "target_node_key": "read_invoice"}},
	})
	if err != nil {
		t.Fatalf("encoding legacy detail fixture failed: %v", err)
	}
	state.replaceStoredDetail(t, string(legacyDetail))
	deltas, err = deltasAfter(ctx, coreImpl.DB(), state.runUUID, 0)
	if err != nil {
		t.Fatalf("reading delta with legacy detail failed: %v", err)
	}
	got = deltas[0].Payload
	if got.EdgeKey != "prepare->read_invoice" || got.SourceNodeKey != "prepare" || got.TargetNodeKey != "read_invoice" {
		t.Fatalf("legacy edge detail was not lifted: %#v", got)
	}
	if got.Plan == nil || len(got.Plan.Steps) != 1 || len(got.Plan.Edges) != 1 {
		t.Fatalf("legacy plan detail was not lifted: %#v", got.Plan)
	}
	if !reflect.DeepEqual(got.Activity, activity) || !reflect.DeepEqual(got.Metric, metric) {
		t.Fatalf("motion cues were lost while lifting legacy detail: activity=%#v metric=%#v", got.Activity, got.Metric)
	}
}

var motionCueDriverSequence atomic.Uint64

type motionCueDBState struct {
	mu sync.Mutex

	runUUID  uuid.UUID
	nodeUUID uuid.UUID
	runKey   string
	nodeKey  string
	now      time.Time

	lastSequence    int64
	graphRevision   int64
	statusMessage   string
	progressPercent int64

	eventType       int64
	eventOccurredAt time.Time
	eventPayload    []byte
	idempotencyKey  string
}

func newMotionCueDBState() *motionCueDBState {
	return &motionCueDBState{
		runUUID:  uuid.Must(uuid.NewV4()),
		nodeUUID: uuid.Must(uuid.NewV4()),
		runKey:   "motion-cue-integration",
		nodeKey:  "read_invoice",
		now:      time.Date(2026, time.August, 29, 12, 0, 0, 0, time.UTC),
	}
}

func (s *motionCueDBState) storedEventPayload() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]byte(nil), s.eventPayload...)
}

func (s *motionCueDBState) storedNodeProgress() (string, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusMessage, s.progressPercent
}

func (s *motionCueDBState) replaceStoredDetail(t *testing.T, detail string) {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	var payload map[string]any
	if err := json.Unmarshal(s.eventPayload, &payload); err != nil {
		t.Fatalf("decoding stored event payload failed: %v", err)
	}
	payload["detail"] = detail
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encoding stored event payload failed: %v", err)
	}
	s.eventPayload = raw
}

func newMotionCueTestCore(t *testing.T, state *motionCueDBState) *core.Implementation {
	t.Helper()
	driverName := fmt.Sprintf("motion_cue_test_%d", motionCueDriverSequence.Add(1))
	sql.Register(driverName, &motionCueDBDriver{state: state})
	provider, err := config.NewYAML(config.Static(map[string]any{
		"db": []map[string]any{{
			"name":   "motion_cues",
			"host":   "local",
			"port":   "0",
			"user":   "test",
			"pswd":   "test",
			"params": "",
			"driver": driverName,
		}},
	}))
	if err != nil {
		t.Fatalf("creating test DB config failed: %v", err)
	}
	impl, err := core.New(core.Params{Provider: provider, Logger: zap.NewNop()})
	if err != nil {
		t.Fatalf("creating test core failed: %v", err)
	}
	t.Cleanup(impl.Destroy)
	return impl
}

type motionCueDBDriver struct {
	state *motionCueDBState
}

func (d *motionCueDBDriver) Open(string) (driver.Conn, error) {
	return &motionCueDBConn{state: d.state}, nil
}

type motionCueDBConn struct {
	state *motionCueDBState
}

func (c *motionCueDBConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepared statements are not used by this test driver")
}

func (c *motionCueDBConn) Close() error { return nil }

func (c *motionCueDBConn) Begin() (driver.Tx, error) { return motionCueDBTx{}, nil }

func (c *motionCueDBConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return motionCueDBTx{}, nil
}

func (c *motionCueDBConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()
	normalized := strings.ToLower(strings.Join(strings.Fields(query), " "))
	switch {
	case strings.Contains(normalized, "from `agent_run`") && strings.Contains(normalized, "`client_uuid` = ?"):
		return motionCueRows([]string{
			"uuid", "client_uuid", "run_key", "name", "display_summary", "agent_summary", "agent_identifier", "initial_prompt", "protocol_version", "status", "status_message", "graph_revision", "last_event_sequence", "started_at", "finished_at", "last_heartbeat_at", "created_by", "updated_by", "created_at", "updated_at",
		}, [][]driver.Value{{
			c.state.runUUID.String(), demoClientUUID.String(), c.state.runKey, nil, nil, nil, "Codex", nil, ProtocolVersion,
			int64(enums.AGENT_RUN_STATUS_IN_PROGRESS), nil, c.state.graphRevision, c.state.lastSequence,
			c.state.now, nil, c.state.now, serviceIdentity.String(), serviceIdentity.String(), c.state.now, c.state.now,
		}}), nil
	case strings.Contains(normalized, "from `agent_node`"):
		return motionCueRows([]string{
			"uuid", "run_uuid", "node_key", "name", "description", "node_type", "agent_label", "tool_name", "status", "status_message", "error_message", "progress_percent", "plan_order", "planned", "input_summary", "output_summary", "started_at", "finished_at", "created_by", "updated_by", "created_at", "updated_at",
		}, [][]driver.Value{{
			c.state.nodeUUID.String(), c.state.runUUID.String(), c.state.nodeKey, "Read invoice", nil,
			int64(enums.AGENT_NODE_TYPE_PLAN_STEP), "Codex", nil, int64(enums.AGENT_NODE_STATUS_IN_PROGRESS),
			nil, nil, nil, int64(1), true, nil, nil, c.state.now, nil,
			serviceIdentity.String(), serviceIdentity.String(), c.state.now, c.state.now,
		}}), nil
	case strings.Contains(normalized, "select e.`sequence`, r.`graph_revision`"):
		return motionCueRows([]string{"sequence", "graph_revision"}, nil), nil
	case strings.Contains(normalized, "select `last_event_sequence`, `graph_revision`"):
		return motionCueRows([]string{"last_event_sequence", "graph_revision"}, [][]driver.Value{{c.state.lastSequence, c.state.graphRevision}}), nil
	case strings.Contains(normalized, "select count(*) from `intervention`"):
		return motionCueRows([]string{"count"}, [][]driver.Value{{int64(0)}}), nil
	case strings.Contains(normalized, "select e.`sequence`, e.`event_type`"):
		if len(c.state.eventPayload) == 0 {
			return motionCueRows([]string{"sequence"}, nil), nil
		}
		return motionCueRows([]string{
			"sequence", "event_type", "node_uuid", "occurred_at", "payload", "idempotency_key", "graph_revision",
			"node_key", "name", "agent_label", "planned", "plan_order", "started_at", "finished_at", "input_summary", "output_summary",
		}, [][]driver.Value{{
			c.state.lastSequence, c.state.eventType, c.state.nodeUUID.String(), c.state.eventOccurredAt,
			append([]byte(nil), c.state.eventPayload...), c.state.idempotencyKey, c.state.graphRevision,
			c.state.nodeKey, "Read invoice", "Codex", true, int64(1), c.state.now, nil, nil, nil,
		}}), nil
	default:
		return nil, fmt.Errorf("unexpected test query: %s", normalized)
	}
}

func (c *motionCueDBConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()
	normalized := strings.ToLower(strings.Join(strings.Fields(query), " "))
	switch {
	case strings.Contains(normalized, "update `agent_node`"):
		c.state.statusMessage, _ = args[8].Value.(string)
		c.state.progressPercent, _ = args[10].Value.(int64)
	case strings.Contains(normalized, "insert into `agent_event`"):
		c.state.lastSequence, _ = args[2].Value.(int64)
		c.state.eventType, _ = args[3].Value.(int64)
		c.state.idempotencyKey, _ = args[6].Value.(string)
		c.state.eventOccurredAt, _ = args[7].Value.(time.Time)
		switch payload := args[13].Value.(type) {
		case string:
			c.state.eventPayload = []byte(payload)
		case []byte:
			c.state.eventPayload = append([]byte(nil), payload...)
		default:
			return nil, fmt.Errorf("unexpected event payload type %T", payload)
		}
	case strings.Contains(normalized, "update `agent_run` set `last_event_sequence`"):
		c.state.lastSequence, _ = args[0].Value.(int64)
		c.state.graphRevision, _ = args[1].Value.(int64)
	default:
		return nil, fmt.Errorf("unexpected test exec: %s", normalized)
	}
	return driver.RowsAffected(1), nil
}

type motionCueDBTx struct{}

func (motionCueDBTx) Commit() error   { return nil }
func (motionCueDBTx) Rollback() error { return nil }

type motionCueDBRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func motionCueRows(columns []string, values [][]driver.Value) *motionCueDBRows {
	return &motionCueDBRows{columns: columns, values: values}
}

func (r *motionCueDBRows) Columns() []string { return r.columns }
func (r *motionCueDBRows) Close() error      { return nil }

func (r *motionCueDBRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}
