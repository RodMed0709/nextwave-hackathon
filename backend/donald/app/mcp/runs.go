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

	return jsonResult(result{OK: true, RunKey: run.RunKey, Sequence: seq, GraphRevision: rev})
}
