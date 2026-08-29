package mcp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gofrs/uuid"
	"github.com/guregu/null/v6"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nextwave/donald/core/module/agent_event"
	agent_event_types "github.com/nextwave/donald/core/module/agent_event/types"
	agent_event_entity "github.com/nextwave/donald/entity/agent_event"
	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
	"github.com/nextwave/donald/enums"
)

// mutation is one atomic change to a run's graph: whatever the caller does to
// the snapshot inside apply, plus exactly one event appended to the log.
type mutation struct {
	runUUID uuid.UUID

	eventType enums.AgentEventType
	nodeUUID  *uuid.UUID
	// agentLabel attributes the change to a subagent. Subagents are a flat label
	// in this model, not their own entity, so this is the whole of it.
	agentLabel string
	// idempotencyKey makes a retried tool call a no-op. Agents retry, and the
	// unique index on (run_uuid, idempotency_key) is what turns a duplicate
	// report into "already recorded" instead of a second event.
	idempotencyKey string
	occurredAt     time.Time
	payload        payload_entity.AgentEventPayload

	// structural is true when the change alters the shape of the graph (a node
	// or edge added or removed) rather than just a status. Only structural
	// changes bump graph_revision, so a client can cheaply tell "re-layout" from
	// "repaint a node".
	structural bool

	// apply mutates the snapshot inside the same transaction as the event.
	apply func(ctx context.Context, tx *sql.Tx) error
}

// result is what every mutating tool returns. Deliberately tiny: the agent needs
// an acknowledgement and a cursor, not a copy of the graph it just changed.
// Returning entities here would put a growing payload in front of an LLM on
// every single progress report.
type result struct {
	OK       bool   `json:"ok"`
	RunKey   string `json:"run_key"`
	NodeKey  string `json:"node_key,omitempty"`
	Sequence int64  `json:"sequence"`
	// GraphRevision counts STRUCTURAL changes only - nodes and edges added or
	// removed. Status changes do not move it. Use Sequence as the execution
	// cursor: it advances on every event, so a client can tell "re-layout the
	// graph" (revision moved) from "repaint a node" (only sequence moved).
	GraphRevision int64  `json:"graph_revision"`
	Note          string `json:"note,omitempty"`

	// PendingInstructions is how many stop/steer requests are waiting for this
	// agent right now.
	//
	// It rides along on every mutation so an agent does not have to poll blind
	// between steps: zero means carry on, non-zero means call check_instructions.
	// It is a COUNT rather than the instructions themselves on purpose -
	// check_instructions is what marks a request delivered, and silently
	// acknowledging one inside an unrelated call would tell the person who
	// clicked the button that the agent had seen it when it had not.
	PendingInstructions int `json:"pending_instructions,omitempty"`
}

// ack finishes a result by attaching the pending-instruction signal.
//
// A failure to count is deliberately swallowed: an agent that just successfully
// reported progress should not be told its call failed because a secondary
// lookup did. Worst case the agent polls check_instructions as it always did.
func (h *Handler) ack(ctx context.Context, r result, runUUID uuid.UUID) (*mcp.CallToolResult, any, error) {
	if n, err := h.pendingInstructionCount(ctx, runUUID); err == nil && n > 0 {
		r.PendingInstructions = n
		if r.Note == "" {
			r.Note = fmt.Sprintf("%d instruction(s) waiting - call check_instructions", n)
		}
	}
	return jsonResult(r)
}

// pendingInstructionCount counts undelivered, unexpired interventions. Served by
// idx_intervention_run_status.
func (h *Handler) pendingInstructionCount(ctx context.Context, runUUID uuid.UUID) (int, error) {
	var n int
	err := h.core.DB().QueryRowContext(ctx,
		"SELECT COUNT(*) FROM `intervention` WHERE `run_uuid` = ? AND `status` = ? AND (`expires_at` IS NULL OR `expires_at` > ?)",
		runUUID.String(), enums.INTERVENTION_STATUS_REGISTERED, time.Now().UTC()).Scan(&n)
	return n, err
}

// commit runs a mutation: it takes the run's sequence lock, applies the snapshot
// change, appends the event, and advances the run's cursors — all in one
// transaction — then publishes the event to subscribed browsers.
//
// The lock is a SELECT ... FOR UPDATE on the run row. Two agents reporting on
// the same run concurrently (a parent and its subagent, or a retry racing the
// original) would otherwise both read the same last_event_sequence and write the
// same next one; one insert would lose to the unique index and its snapshot
// change would roll back with it. Serializing per run costs nothing at this
// volume and is what makes the sequence trustworthy.
//
// Publishing happens AFTER commit, never inside the transaction: a subscriber
// must not be told about a state that could still roll back.
func (h *Handler) commit(ctx context.Context, m mutation) (int64, int64, error) {
	if m.idempotencyKey == "" {
		return 0, 0, errors.New("idempotency_key is required for every graph mutation")
	}

	// An already-recorded key short-circuits before we take the lock. This is the
	// hot path for a retrying agent, and it must not block the run.
	if seq, rev, done, err := h.alreadyRecorded(ctx, m.runUUID, m.idempotencyKey); err != nil {
		return 0, 0, err
	} else if done {
		return seq, rev, nil
	}

	tx, err := h.core.DB().BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, retryable(err, "opening the transaction")
	}
	defer func() { _ = tx.Rollback() }()

	var lastSeq, graphRev int64
	err = tx.QueryRowContext(ctx,
		"SELECT `last_event_sequence`, `graph_revision` FROM `agent_run` WHERE `uuid` = ? FOR UPDATE",
		m.runUUID.String()).Scan(&lastSeq, &graphRev)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, 0, fmt.Errorf("run %s no longer exists", m.runUUID)
		}
		return 0, 0, err
	}

	// Re-check under the lock. Between the fast path above and acquiring the
	// lock, a concurrent retry of the SAME call may have committed.
	if seq, rev, done, err := h.alreadyRecordedTx(ctx, tx, m.runUUID, m.idempotencyKey); err != nil {
		return 0, 0, err
	} else if done {
		return seq, rev, nil
	}

	if m.apply != nil {
		if err := m.apply(ctx, tx); err != nil {
			return 0, 0, err
		}
	}

	seq := lastSeq + 1
	if m.structural {
		graphRev++
	}

	occurred := m.occurredAt
	if occurred.IsZero() {
		occurred = time.Now().UTC()
	}

	evUUID, err := uuid.NewV4()
	if err != nil {
		return 0, 0, err
	}
	_, err = h.core.AgentEvent().Insert(ctx, agent_event_types.UpsertRequest{
		AgentEvent: agent_event_entity.AgentEvent{
			UUID:           evUUID,
			RunUUID:        m.runUUID,
			Sequence:       seq,
			EventType:      m.eventType,
			NodeUUID:       m.nodeUUID,
			AgentLabel:     nullString(m.agentLabel),
			IdempotencyKey: m.idempotencyKey,
			OccurredAt:     occurred,
			Status:         enums.AGENT_EVENT_STATUS_RECORDED,
			CreatedBy:      serviceIdentity,
			UpdatedBy:      serviceIdentity,
			Payload:        m.payload,
		},
	}, agent_event.WithSQLTransaction(tx))
	if err != nil {
		return 0, 0, err
	}

	// last_heartbeat_at moves on every report, so a run whose agent died is
	// distinguishable from one that is merely slow.
	if _, err := tx.ExecContext(ctx,
		"UPDATE `agent_run` SET `last_event_sequence` = ?, `graph_revision` = ?, `last_heartbeat_at` = ?, `updated_by` = ? WHERE `uuid` = ?",
		seq, graphRev, time.Now().UTC(), serviceIdentity.String(), m.runUUID.String()); err != nil {
		return 0, 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, retryable(err, "committing the graph change")
	}

	// Nothing is published from here. Subscribers are fed by the Broadcaster
	// tailing agent_event, so a delta reaches a browser the same way whether the
	// MCP server shares this process with the API or runs as its own deployment.

	return seq, graphRev, nil
}

func (h *Handler) alreadyRecorded(ctx context.Context, runUUID uuid.UUID, key string) (int64, int64, bool, error) {
	row := h.core.DB().QueryRowContext(ctx,
		"SELECT e.`sequence`, r.`graph_revision` FROM `agent_event` e JOIN `agent_run` r ON r.`uuid` = e.`run_uuid` WHERE e.`run_uuid` = ? AND e.`idempotency_key` = ?",
		runUUID.String(), key)
	return scanRecorded(row)
}

func (h *Handler) alreadyRecordedTx(ctx context.Context, tx *sql.Tx, runUUID uuid.UUID, key string) (int64, int64, bool, error) {
	row := tx.QueryRowContext(ctx,
		"SELECT e.`sequence`, r.`graph_revision` FROM `agent_event` e JOIN `agent_run` r ON r.`uuid` = e.`run_uuid` WHERE e.`run_uuid` = ? AND e.`idempotency_key` = ?",
		runUUID.String(), key)
	return scanRecorded(row)
}

func scanRecorded(row *sql.Row) (int64, int64, bool, error) {
	var seq, rev int64
	switch err := row.Scan(&seq, &rev); {
	case errors.Is(err, sql.ErrNoRows):
		return 0, 0, false, nil
	case err != nil:
		return 0, 0, false, err
	default:
		return seq, rev, true, nil
	}
}

func nullString(s string) null.String {
	if s == "" {
		return null.String{}
	}
	return null.StringFrom(s)
}

func nullInt64(v *int64) null.Int64 {
	// null.Int64 is an alias for null.Int, and IntFromPtr already yields the
	// invalid (SQL NULL) value for a nil pointer.
	return null.IntFromPtr(v)
}

func detailJSON(v any) null.String {
	if v == nil {
		return null.String{}
	}
	b, err := json.Marshal(v)
	if err != nil {
		return null.String{}
	}
	return null.StringFrom(string(b))
}
