package mcp

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nextwave/donald/core/module/intervention"
	intervention_types "github.com/nextwave/donald/core/module/intervention/types"
	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
	intervention_interaction_entity "github.com/nextwave/donald/entity/intervention_interaction"
	"github.com/nextwave/donald/enums"
)

// ─────────────────────────────────────────────
// Tool: check_instructions
// ─────────────────────────────────────────────

type CheckInstructionsParams struct {
	RunKey string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
}

// PendingInstruction is what the agent gets back. It carries only what the agent
// must act on - no timestamps, no requester, no interaction history, because the
// agent cannot use any of it and every field costs context on a call the agent
// is expected to make between every action.
type PendingInstruction struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	NodeKey string `json:"node_key"`
	Message string `json:"message,omitempty"`
}

type CheckInstructionsResult struct {
	// Instructions is empty far more often than not; an agent that sees an empty
	// array should simply carry on.
	Instructions []PendingInstruction `json:"instructions"`
}

// CheckInstructions is the agent's half of the two-way channel. Because these
// agents are not ours to control, a stop is advisory: we can only record it and
// hand it over the next time the agent asks. Marking it delivered here is what
// lets the UI say "the agent has seen this" rather than leaving the person
// staring at a button that appears to have done nothing.
func (h *Handler) CheckInstructions(ctx context.Context, req *mcp.CallToolRequest, args CheckInstructionsParams) (*mcp.CallToolResult, any, error) {
	run, err := h.resolveRun(ctx, args.RunKey)
	if err != nil {
		return nil, nil, err
	}

	pending, err := h.core.Intervention().FetchInterventionByRunUUIDAndStatus(ctx,
		intervention_types.FetchInterventionByRunUUIDAndStatusRequest{
			RunUUID: run.UUID,
			Status:  enums.INTERVENTION_STATUS_REGISTERED,
			Limit:   20,
		}, intervention.WithSkipCache())
	if err != nil {
		return nil, nil, err
	}

	out := CheckInstructionsResult{Instructions: []PendingInstruction{}}
	now := time.Now().UTC()

	for _, iv := range pending.Results {
		// An expired request is not handed to the agent: the person who raised it
		// has long since given up, and acting on it now would be surprising.
		if iv.ExpiresAt.Valid && iv.ExpiresAt.Time.Before(now) {
			continue
		}
		node, err := h.nodeByUUID(ctx, iv.NodeUUID)
		if err != nil {
			h.logger.Warn("intervention references a node that no longer exists")
			continue
		}

		row := iv
		nodeUUID := iv.NodeUUID
		if _, _, err := h.commit(ctx, mutation{
			runUUID:        run.UUID,
			eventType:      enums.AGENT_EVENT_TYPE_INTERVENTION_DELIVERED,
			nodeUUID:       &nodeUUID,
			idempotencyKey: "intervention_delivered:" + iv.UUID.String(),
			payload: payload_entity.AgentEventPayload{
				InterventionUUID: &row.UUID,
				Message:          nullString("delivered to the agent"),
			},
			apply: func(ctx context.Context, tx *sql.Tx) error {
				row.Status = enums.INTERVENTION_STATUS_PICKED_UP_BY_AGENT
				row.DeliveredAt = nullTime(&now)
				row.UpdatedBy = serviceIdentity
				_, err := h.core.Intervention().Update(ctx,
					intervention_types.UpsertRequest{Intervention: row},
					intervention.WithSQLTransaction(tx))
				return err
			},
		}); err != nil {
			return nil, nil, err
		}

		out.Instructions = append(out.Instructions, PendingInstruction{
			ID:      iv.UUID.String(),
			Type:    iv.Type.String(),
			NodeKey: node.NodeKey,
			Message: iv.Prompt.String,
		})
	}

	return jsonResult(out)
}

// ─────────────────────────────────────────────
// Tool: resolve_instruction
// ─────────────────────────────────────────────

type ResolveInstructionParams struct {
	ID       string `json:"id" jsonschema:"The instruction id from check_instructions"`
	Outcome  string `json:"outcome" jsonschema:"Either 'applied' if you complied, or 'refused' if you could not"`
	Response string `json:"response,omitempty" jsonschema:"What you did about it, or why you could not - shown to the person who asked"`
}

// ResolveInstruction closes the loop. Without it the UI can say a stop was
// delivered but never that it was honoured, which is the difference between a
// control and a suggestion box.
func (h *Handler) ResolveInstruction(ctx context.Context, req *mcp.CallToolRequest, args ResolveInstructionParams) (*mcp.CallToolResult, any, error) {
	id, err := uuid.FromString(strings.TrimSpace(args.ID))
	if err != nil {
		return nil, nil, fmt.Errorf("id must be the instruction id returned by check_instructions")
	}

	var status enums.InterventionStatus
	switch strings.TrimSpace(strings.ToLower(args.Outcome)) {
	case "applied", "succeeded", "done":
		status = enums.INTERVENTION_STATUS_SUCCEEDED
	case "refused", "failed", "could_not":
		status = enums.INTERVENTION_STATUS_FAILED
	default:
		return nil, nil, fmt.Errorf("outcome must be 'applied' or 'refused' (got %q)", args.Outcome)
	}

	fetched, err := h.core.Intervention().FetchInterventionByUUID(ctx,
		intervention_types.FetchInterventionByUUIDRequest{UUID: id}, intervention.WithSkipCache())
	if err != nil {
		return nil, nil, err
	}
	if len(fetched.Results) == 0 {
		return nil, nil, fmt.Errorf("no instruction with id %s", id)
	}
	iv := fetched.Results[0]
	now := time.Now().UTC()

	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        iv.RunUUID,
		eventType:      enums.AGENT_EVENT_TYPE_INTERVENTION_RESOLVED,
		nodeUUID:       &iv.NodeUUID,
		idempotencyKey: "intervention_resolved:" + iv.UUID.String(),
		payload: payload_entity.AgentEventPayload{
			InterventionUUID: &iv.UUID,
			Message:          nullString(args.Response),
			Detail:           detailJSON(map[string]string{"outcome": status.String()}),
		},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			iv.Status = status
			iv.StatusMessage = nullString(args.Response)
			iv.ResolvedAt = nullTime(&now)
			iv.UpdatedBy = serviceIdentity
			iv.Interactions = append(iv.Interactions, newInteraction(args.Response, now))
			_, err := h.core.Intervention().Update(ctx,
				intervention_types.UpsertRequest{Intervention: iv},
				intervention.WithSQLTransaction(tx))
			return err
		},
	})
	if err != nil {
		return nil, nil, err
	}

	return jsonResult(result{OK: true, Sequence: seq, GraphRevision: rev})
}

func newInteraction(response string, at time.Time) intervention_interaction_entity.InterventionInteraction {
	return intervention_interaction_entity.InterventionInteraction{
		Name:          "agent response",
		AgentResponse: nullString(response),
		OccurredAt:    nullTime(&at),
		Status:        enums.INTERVENTION_INTERACTION_STATUS_COMPLETED,
	}
}
