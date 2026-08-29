package mcp

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nextwave/donald/core/module/agent_run"
	agent_run_types "github.com/nextwave/donald/core/module/agent_run/types"
	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
	agent_run_entity "github.com/nextwave/donald/entity/agent_run"
	"github.com/nextwave/donald/enums"
)

// ─────────────────────────────────────────────
// Tool: start_run
// ─────────────────────────────────────────────

type StartRunParams struct {
	RunKey          string `json:"run_key" jsonschema:"A stable key you invent for this run and reuse in every later call - your session or thread id works well. Calling start_run twice with the same key resumes the existing run instead of creating a second one."`
	Name            string `json:"name,omitempty" jsonschema:"Short title for the run, shown as the heading above the graph"`
	Summary         string `json:"summary,omitempty" jsonschema:"One or two sentences describing what this flow does, written for a person watching it"`
	AgentIdentifier string `json:"agent_identifier,omitempty" jsonschema:"Which agent is running - your own identifier for yourself"`
}

func (h *Handler) StartRun(ctx context.Context, req *mcp.CallToolRequest, args StartRunParams) (*mcp.CallToolResult, any, error) {
	runKey := strings.TrimSpace(args.RunKey)
	if runKey == "" {
		return nil, nil, fmt.Errorf("run_key is required")
	}

	// Idempotent by design: an agent that lost its context and called start_run
	// again must land on the same run, not fork the graph.
	if existing, err := h.resolveRun(ctx, runKey); err == nil {
		return jsonResult(result{
			OK: true, RunKey: runKey,
			Sequence: existing.LastEventSequence, GraphRevision: existing.GraphRevision,
			Note: "run already exists; resuming it",
		})
	}

	runUUID, err := uuid.NewV4()
	if err != nil {
		return nil, nil, err
	}
	now := time.Now().UTC()

	tx, err := h.core.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if err := h.ensureClient(ctx, tx); err != nil {
		return nil, nil, fmt.Errorf("could not resolve the tenant for this run: %w", err)
	}

	run := agent_run_entity.AgentRun{
		UUID:            runUUID,
		ClientUUID:      h.clientUUID(),
		RunKey:          runKey,
		Name:            nullString(args.Name),
		DisplaySummary:  nullString(args.Summary),
		AgentIdentifier: nullString(args.AgentIdentifier),
		ProtocolVersion: nullString(ProtocolVersion),
		Status:          enums.AGENT_RUN_STATUS_IN_PROGRESS,
		// The first event has not been written yet; commit() advances both.
		GraphRevision:     0,
		LastEventSequence: 0,
		StartedAt:         nullTime(&now),
		LastHeartbeatAt:   nullTime(&now),
		CreatedBy:         serviceIdentity,
		UpdatedBy:         serviceIdentity,
	}
	if _, err := h.core.AgentRun().Insert(ctx,
		agent_run_types.UpsertRequest{AgentRun: run}, agent_run.WithSQLTransaction(tx)); err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}

	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        runUUID,
		eventType:      enums.AGENT_EVENT_TYPE_RUN_STARTED,
		idempotencyKey: "run_started:" + runKey,
		structural:     true,
		payload: payload_entity.AgentEventPayload{
			Message: nullString(args.Summary),
		},
	})
	if err != nil {
		return nil, nil, err
	}

	return jsonResult(result{
		OK: true, RunKey: runKey, Sequence: seq, GraphRevision: rev,
		Note: "run created; declare your planned actions next with declare_actions",
	})
}

// ─────────────────────────────────────────────
// Tool: finish_run
// ─────────────────────────────────────────────

type FinishRunParams struct {
	RunKey  string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	Status  string `json:"status" jsonschema:"How the run ended: succeeded, failed, or cancelled"`
	Message string `json:"message,omitempty" jsonschema:"Short closing note - for a failure, what went wrong"`
}

func (h *Handler) FinishRun(ctx context.Context, req *mcp.CallToolRequest, args FinishRunParams) (*mcp.CallToolResult, any, error) {
	run, err := h.resolveRun(ctx, args.RunKey)
	if err != nil {
		return nil, nil, err
	}

	status := enums.AgentRunStatusFromString(strings.TrimSpace(args.Status))
	switch status {
	case enums.AGENT_RUN_STATUS_SUCCEEDED, enums.AGENT_RUN_STATUS_FAILED, enums.AGENT_RUN_STATUS_CANCELLED:
	default:
		return nil, nil, fmt.Errorf("status must be one of succeeded, failed, cancelled (got %q)", args.Status)
	}

	// Refuse to close a run that still has work open, and say exactly which.
	//
	// A run marked succeeded while three nodes sit at not_started is a graph that
	// lies, and it lies in the direction that matters: it claims work happened.
	// Returning the offending keys makes the fix mechanical - skip them, cancel
	// them, or finish them - rather than a puzzle.
	open, err := h.openNodes(ctx, run.UUID)
	if err != nil {
		return nil, nil, err
	}
	if len(open) > 0 && status == enums.AGENT_RUN_STATUS_SUCCEEDED {
		return nil, nil, fmt.Errorf(
			"cannot finish as succeeded: %d action(s) still open — %s. Resolve each one first (complete_action, fail_action, skip_action or cancel_action), or finish with status=\"failed\" or \"cancelled\" if the run really ended this way",
			len(open), strings.Join(open, ", "))
	}

	now := time.Now().UTC()
	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        run.UUID,
		eventType:      enums.AGENT_EVENT_TYPE_RUN_FINISHED,
		idempotencyKey: "run_finished:" + run.RunKey,
		payload: payload_entity.AgentEventPayload{
			Message: nullString(args.Message),
			Detail:  detailJSON(map[string]string{"run_status": status.String()}),
		},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			run.Status = status
			run.StatusMessage = nullString(args.Message)
			run.FinishedAt = nullTime(&now)
			return h.updateRun(ctx, tx, run)
		},
	})
	if err != nil {
		return nil, nil, err
	}

	note := ""
	if len(open) > 0 {
		note = fmt.Sprintf("closed with %d action(s) still open: %s", len(open), strings.Join(open, ", "))
	}
	return h.ack(ctx, result{OK: true, RunKey: run.RunKey, Sequence: seq, GraphRevision: rev, Note: note}, run.UUID)
}

// openNodes lists the node_keys that have not reached a terminal status, in plan
// order so the message reads like the plan.
func (h *Handler) openNodes(ctx context.Context, runUUID uuid.UUID) ([]string, error) {
	rows, err := h.core.DB().QueryContext(ctx,
		"SELECT `node_key` FROM `agent_node` WHERE `run_uuid` = ? AND `status` IN (?, ?, ?, ?, ?) ORDER BY COALESCE(`plan_order`, 2147483647), `created_at`",
		runUUID.String(),
		enums.AGENT_NODE_STATUS_NOT_STARTED, enums.AGENT_NODE_STATUS_IN_PROGRESS,
		enums.AGENT_NODE_STATUS_BLOCKED_ON_USER_DECISION, enums.AGENT_NODE_STATUS_BLOCKED_ON_MISSING_DATA,
		enums.AGENT_NODE_STATUS_BLOCKED_ON_PROVIDER_OUTAGE)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}
