package mcp

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"github.com/gofrs/uuid"
	"go.uber.org/zap"

	"github.com/guregu/null/v6"

	"github.com/nextwave/donald/enums"
)

// pollInterval is how often a watched run is checked for new events. It is the
// floor on how stale the graph can look, and 400ms is well under what reads as
// "live" to a person watching a node change colour.
const pollInterval = 400 * time.Millisecond

// Delta is one graph change as the browser receives it. It mirrors the event row
// rather than the entity that changed: a client applies deltas to a snapshot it
// already loaded, so re-sending whole nodes would waste the bandwidth the
// sequence design exists to save.
type Delta struct {
	Sequence      int64      `json:"sequence"`
	GraphRevision int64      `json:"graph_revision"`
	EventType     string     `json:"event_type"`
	NodeUUID      *uuid.UUID `json:"node_uuid,omitempty"`
	OccurredAt    time.Time  `json:"occurred_at"`

	// The three fields below are what a client needs to apply a delta without
	// holding its own uuid lookup table. They are derived at read time from the
	// row's joins, not stored twice.
	//
	// node_key rather than only node_uuid because every other part of this
	// protocol addresses a node by its key — the agent invents it, the tools take
	// it, the graph is keyed on it — so forcing the one consumer that reads
	// events to resolve uuids was a gap, not a design.
	NodeKey        string `json:"node_key,omitempty"`
	AgentLabel     string `json:"agent_label,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`

	Payload deltaPayload `json:"payload"`
}

// deltaPayload is the wire form of an event payload: the stored fields plus
// everything a client would otherwise have to fetch separately to render the
// change.
//
// It is strictly ADDITIVE over the stored payload — nothing is renamed and no
// existing field changes type. previous_status and new_status keep their numeric
// form; `status` is a new string mirror of new_status, because a client applying
// a status change wants the name, and a number that silently shifts if the enum
// is reordered is a poor contract to hand out.
type deltaPayload struct {
	PreviousStatus   enums.AgentNodeStatus `json:"previous_status,omitempty"`
	NewStatus        enums.AgentNodeStatus `json:"new_status,omitempty"`
	Message          null.String           `json:"message,omitempty"`
	ProgressPercent  null.Int64            `json:"progress_percent,omitempty"`
	EdgeUUID         *uuid.UUID            `json:"edge_uuid,omitempty"`
	ArtifactUUID     *uuid.UUID            `json:"artifact_uuid,omitempty"`
	InterventionUUID *uuid.UUID            `json:"intervention_uuid,omitempty"`
	Detail           null.String           `json:"detail,omitempty"`

	// Status is new_status by name. This is the field a client should read.
	Status string `json:"status,omitempty"`

	// Node facts, so node_added and node_status_changed carry enough to build or
	// update the node without a second request.
	Label         string      `json:"label,omitempty"`
	Planned       *bool       `json:"planned,omitempty"`
	PlanOrder     null.Int64  `json:"plan_order,omitempty"`
	StartedAt     null.Time   `json:"started_at,omitempty"`
	FinishedAt    null.Time   `json:"finished_at,omitempty"`
	InputSummary  null.String `json:"input_summary,omitempty"`
	OutputSummary null.String `json:"summary,omitempty"`
	ActualSeconds *int64      `json:"actual_seconds,omitempty"`

	// The rest of what the agent actually told us about the step.
	//
	// These columns have been written since the first version of the MCP surface
	// and never left the database. The one that mattered most was error_message:
	// a step could fail, the agent's explanation would be stored, and the person
	// watching would see a red card saying FAILED and nothing else. The others
	// are the difference between a node that says "Reconcile routing" and one
	// that says what it is, which tool it runs and how far along it is.
	Description   null.String `json:"description,omitempty"`
	NodeType      string      `json:"node_type,omitempty"`
	ToolName      null.String `json:"tool_name,omitempty"`
	StatusMessage null.String `json:"status_message,omitempty"`
	ErrorMessage  null.String `json:"error_message,omitempty"`
	NodeProgress  null.Int64  `json:"node_progress_percent,omitempty"`

	// ManualMinutes is how long this step would have taken a person, as reported
	// by the agent on complete_action. It rides the event log rather than being
	// recomputed per render so the savings a card shows never changes between two
	// people looking at the same run.
	ManualMinutes *int64 `json:"manual_minutes,omitempty"`

	// Artifact facts for artifact_added. Without these the event names a uuid the
	// client cannot resolve, so attached evidence never rendered at all.
	ArtifactName string `json:"artifact_name,omitempty"`
	ArtifactType string `json:"artifact_type,omitempty"`
	ArtifactURL  string `json:"artifact_url,omitempty"`
	ArtifactText string `json:"artifact_text,omitempty"`

	// Edge endpoints by key. Without these an edge event names two uuids and a
	// client cannot draw the edge at all.
	EdgeKey       string `json:"edge_key,omitempty"`
	SourceNodeKey string `json:"source_node_key,omitempty"`
	TargetNodeKey string `json:"target_node_key,omitempty"`

	// Intervention facts for the stop/steer events.
	//
	// InterventionID is the correlation key: requested, delivered and resolved
	// are three separate events about one request, and a client cannot draw the
	// "queued → delivered → resolved" trail without something to join them on.
	Type           string `json:"type,omitempty"`
	Prompt         string `json:"prompt,omitempty"`
	InterventionID string `json:"intervention_id,omitempty"`
	// Origin is "operator" when a person raised it and "agent" when the agent
	// asked a question of its own. Only the second one blocks the step.
	Origin             string `json:"origin,omitempty"`
	InterventionStatus string `json:"intervention_status,omitempty"`

	// The run's own name and summary.
	//
	// The browser had no way to learn either: the snapshot endpoint carries them
	// but the viewer builds everything from the stream, and the stream described
	// only nodes. So every run was titled with its run_key — a slug the agent
	// invented for addressing, shown to a person as if it were a heading.
	RunName    string `json:"run_name,omitempty"`
	RunSummary string `json:"run_summary,omitempty"`

	// Plan is the whole declared plan, present on plan_declared only.
	Plan *planWire `json:"plan,omitempty"`

	// Subtasks is the complete ordered snapshot carried by start_action or
	// report_progress. A pointer preserves the difference between absent and an
	// explicitly empty list, which clears the client's current snapshot.
	Subtasks *[]Subtask `json:"subtasks,omitempty"`
}

// planWire is the declared plan as a client receives it. Edges are included
// because a plan's dependencies produce no edge_added events of their own.
type planWire struct {
	Steps []map[string]any    `json:"steps"`
	Edges []map[string]string `json:"edges"`
}

// Broadcaster fans graph deltas out to the browsers watching a run.
//
// Deltas are read from the agent_event table, not handed over in memory from
// whichever goroutine committed them. That indirection is what lets the API and
// the MCP server run as SEPARATE processes: an agent reporting to the MCP
// deployment writes an event, and the API deployment's tailer picks it up on its
// next poll and pushes it to the browsers it is serving. A Go channel could
// never cross that boundary; the database already does.
//
// It also means correctness no longer depends on running a single replica. Every
// API replica tails independently for the runs its own clients are watching.
//
// Polling rather than a message bus is a deliberate trade at this volume (tens of
// runs a day): one indexed query per watched run per 400ms costs nothing, needs
// no Redis, and exercises the same "fetch events after N" path the client uses to
// recover from a gap — so the recovery path is continuously tested instead of
// only in failure.
type Broadcaster struct {
	db     *sql.DB
	logger *zap.Logger

	mu   sync.Mutex
	subs map[uuid.UUID]*runWatch
	next int
}

type runWatch struct {
	chans map[int]chan Delta
	// lastSeen is the highest sequence this process has already fanned out for
	// the run, so each poll asks only for what is new.
	lastSeen int64
	cancel   context.CancelFunc
}

func NewBroadcaster(db *sql.DB, logger *zap.Logger) *Broadcaster {
	return &Broadcaster{db: db, logger: logger, subs: make(map[uuid.UUID]*runWatch)}
}

// Subscribe returns a channel of deltas for one run and a function that releases
// it. The caller MUST call the release function, or the subscription and its
// tailing goroutine live for the life of the process.
//
// from is the sequence the caller has already handled; the tailer only reports
// what comes after it.
func (b *Broadcaster) Subscribe(runUUID uuid.UUID, from int64) (<-chan Delta, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()

	w, existing := b.subs[runUUID]
	if !existing {
		ctx, cancel := context.WithCancel(context.Background())
		w = &runWatch{chans: make(map[int]chan Delta), lastSeen: from, cancel: cancel}
		b.subs[runUUID] = w
		go b.tail(ctx, runUUID)
	}

	id := b.next
	b.next++
	// Buffered so a slow browser never stalls the tailer that serves the others.
	ch := make(chan Delta, 64)
	w.chans[id] = ch

	return ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		watch, ok := b.subs[runUUID]
		if !ok {
			return
		}
		if c, ok := watch.chans[id]; ok {
			close(c)
			delete(watch.chans, id)
		}
		if len(watch.chans) == 0 {
			// Nobody is watching this run any more; stop querying for it.
			watch.cancel()
			delete(b.subs, runUUID)
		}
	}
}

// tail polls one run's events for as long as somebody is watching it.
func (b *Broadcaster) tail(ctx context.Context, runUUID uuid.UUID) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.mu.Lock()
			w, ok := b.subs[runUUID]
			if !ok {
				b.mu.Unlock()
				return
			}
			from := w.lastSeen
			b.mu.Unlock()

			deltas, err := deltasAfter(ctx, b.db, runUUID, from)
			if err != nil {
				// A transient database error must not kill the stream; the next
				// tick retries from the same cursor.
				b.logger.Warn("tailing run events failed", zap.Error(err))
				continue
			}
			if len(deltas) == 0 {
				continue
			}
			b.fanOut(runUUID, deltas)
		}
	}
}

func (b *Broadcaster) fanOut(runUUID uuid.UUID, deltas []Delta) {
	b.mu.Lock()
	defer b.mu.Unlock()

	w, ok := b.subs[runUUID]
	if !ok {
		return
	}
	for _, d := range deltas {
		for _, ch := range w.chans {
			select {
			case ch <- d:
			default:
				// A subscriber whose buffer is full is skipped rather than waited
				// on. Dropping is recoverable — the client sees the sequence gap
				// and reconnects with its last good cursor — whereas blocking here
				// would stall every other browser on this run.
			}
		}
		if d.Sequence > w.lastSeen {
			w.lastSeen = d.Sequence
		}
	}
}
