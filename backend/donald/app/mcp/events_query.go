package mcp

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/guregu/null/v6"

	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
	"github.com/nextwave/donald/enums"
)

// deltasAfter reads a run's events after a cursor, newest last.
//
// It is the single place events become Deltas, used by both the SSE replay (a
// client catching up on connect) and the tailer (a client being kept current).
// Those are the same operation at different cadences, and having one
// implementation is what makes a reconnect indistinguishable from a live update.
//
// The (run_uuid, sequence) unique index serves this directly.
func deltasAfter(ctx context.Context, db *sql.DB, runUUID uuid.UUID, after int64) ([]Delta, error) {
	// The node is LEFT JOINed because run-level events (run_started, plan_declared,
	// run_finished) legitimately have no node.
	rows, err := db.QueryContext(ctx,
		"SELECT e.`sequence`, e.`event_type`, e.`node_uuid`, e.`occurred_at`, e.`payload`, e.`idempotency_key`, "+
			"r.`graph_revision`, "+
			"n.`node_key`, n.`name`, n.`agent_label`, n.`planned`, n.`plan_order`, "+
			"n.`started_at`, n.`finished_at`, n.`input_summary`, n.`output_summary` "+
			"FROM `agent_event` e "+
			"JOIN `agent_run` r ON r.`uuid` = e.`run_uuid` "+
			"LEFT JOIN `agent_node` n ON n.`uuid` = e.`node_uuid` "+
			"WHERE e.`run_uuid` = ? AND e.`sequence` > ? ORDER BY e.`sequence`",
		runUUID.String(), after)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Delta
	for rows.Next() {
		var (
			seq        int64
			eventType  int64
			nodeUUID   sql.NullString
			occurred   time.Time
			raw        []byte
			idemKey    string
			graphRev   int64
			nodeKey    sql.NullString
			nodeName   sql.NullString
			agentLabel sql.NullString
			planned    sql.NullBool
			planOrder  null.Int64
			startedAt  null.Time
			finishedAt null.Time
			inputSum   null.String
			outputSum  null.String
		)
		if err := rows.Scan(&seq, &eventType, &nodeUUID, &occurred, &raw, &idemKey, &graphRev,
			&nodeKey, &nodeName, &agentLabel, &planned, &planOrder,
			&startedAt, &finishedAt, &inputSum, &outputSum); err != nil {
			return nil, err
		}

		d := Delta{
			Sequence:       seq,
			GraphRevision:  graphRev,
			EventType:      enums.AgentEventType(eventType).String(),
			OccurredAt:     occurred,
			NodeKey:        nodeKey.String,
			AgentLabel:     agentLabel.String,
			IdempotencyKey: idemKey,
		}
		if nodeUUID.Valid {
			if parsed, err := uuid.FromString(nodeUUID.String); err == nil {
				d.NodeUUID = &parsed
			}
		}
		if len(raw) > 0 {
			// A payload that will not decode is not worth dropping the whole
			// delta for: the event type and sequence still tell the client what
			// changed and keep its cursor moving.
			var p payload_entity.AgentEventPayload
			if err := json.Unmarshal(raw, &p); err == nil {
				d.Payload = deltaPayload{
					PreviousStatus:   p.PreviousStatus,
					NewStatus:        p.NewStatus,
					Message:          p.Message,
					ProgressPercent:  p.ProgressPercent,
					EdgeUUID:         p.EdgeUUID,
					ArtifactUUID:     p.ArtifactUUID,
					InterventionUUID: p.InterventionUUID,
					Detail:           p.Detail,
				}
			}
		}
		liftDetail(&d.Payload)
		if d.Payload.NewStatus != enums.AGENT_NODE_STATUS_INVALID {
			d.Payload.Status = d.Payload.NewStatus.String()
		}
		if nodeKey.Valid {
			d.Payload.Label = nodeName.String
			if planned.Valid {
				v := planned.Bool
				d.Payload.Planned = &v
			}
			d.Payload.PlanOrder = planOrder
			d.Payload.StartedAt = startedAt
			d.Payload.FinishedAt = finishedAt
			d.Payload.InputSummary = inputSum
			d.Payload.OutputSummary = outputSum
			if startedAt.Valid && finishedAt.Valid {
				secs := int64(finishedAt.Time.Sub(startedAt.Time).Seconds())
				d.Payload.ActualSeconds = &secs
			}
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := enrichInterventions(ctx, db, out); err != nil {
		return nil, err
	}
	return out, nil
}

// liftDetail exposes type-specific extras as ordinary delta fields while
// retaining the raw detail for clients that already consume its other keys.
func liftDetail(payload *deltaPayload) {
	if !payload.Detail.Valid {
		return
	}
	var extra map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payload.Detail.String), &extra); err != nil {
		return
	}
	assign := func(key string, dst *string) {
		if raw, ok := extra[key]; ok {
			_ = json.Unmarshal(raw, dst)
		}
	}
	assign("edge_key", &payload.EdgeKey)
	assign("source_node_key", &payload.SourceNodeKey)
	assign("target_node_key", &payload.TargetNodeKey)
	if raw, ok := extra["steps"]; ok {
		payload.Plan = &planWire{}
		_ = json.Unmarshal(raw, &payload.Plan.Steps)
		if edges, ok := extra["edges"]; ok {
			_ = json.Unmarshal(edges, &payload.Plan.Edges)
		}
	}
	if raw, ok := extra["subtasks"]; ok {
		var subtasks []Subtask
		if err := json.Unmarshal(raw, &subtasks); err == nil {
			payload.Subtasks = &subtasks
		}
	}
}

// enrichInterventions attaches the type and prompt to the stop/steer events, so
// a client can render what was asked without a second request.
func enrichInterventions(ctx context.Context, db *sql.DB, deltas []Delta) error {
	want := map[string][]int{}
	for i, d := range deltas {
		if d.Payload.InterventionUUID != nil {
			k := d.Payload.InterventionUUID.String()
			want[k] = append(want[k], i)
		}
	}
	if len(want) == 0 {
		return nil
	}

	ids := make([]any, 0, len(want))
	for k := range want {
		ids = append(ids, k)
	}
	rows, err := db.QueryContext(ctx,
		"SELECT `uuid`, `type`, COALESCE(`prompt`, '') FROM `intervention` "+
			"WHERE `uuid` IN (?"+strings.Repeat(",?", len(ids)-1)+")", ids...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var id, prompt string
		var typ int64
		if err := rows.Scan(&id, &typ, &prompt); err != nil {
			return err
		}
		for _, i := range want[id] {
			deltas[i].Payload.Type = enums.InterventionType(typ).String()
			deltas[i].Payload.Prompt = prompt
		}
	}
	return rows.Err()
}
