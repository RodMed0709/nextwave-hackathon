package mcp

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/gofrs/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nextwave/donald/core/module/agent_edge"
	agent_edge_types "github.com/nextwave/donald/core/module/agent_edge/types"
	agent_edge_entity "github.com/nextwave/donald/entity/agent_edge"
	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
	"github.com/nextwave/donald/enums"
)

// ─────────────────────────────────────────────
// Tool: add_dependency
// ─────────────────────────────────────────────

type AddDependencyParams struct {
	RunKey    string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	From      string `json:"from" jsonschema:"node_key of the action that must happen first"`
	To        string `json:"to" jsonschema:"node_key of the action that depends on it"`
	EdgeType  string `json:"edge_type,omitempty" jsonschema:"One of: dependency (default), transition, conditional, retry, fallback, subagent_spawn"`
	Condition string `json:"condition,omitempty" jsonschema:"Label drawn on the arrow when edge_type is conditional, e.g. 'if invoice found'"`
}

// AddDependency is separate from add_action's `after` because a node can have
// many predecessors. `after` covers the common single-parent case in one call;
// this covers joins, retries and conditional branches.
func (h *Handler) AddDependency(ctx context.Context, req *mcp.CallToolRequest, args AddDependencyParams) (*mcp.CallToolResult, any, error) {
	run, err := h.resolveRun(ctx, args.RunKey)
	if err != nil {
		return nil, nil, err
	}
	from, err := h.resolveNode(ctx, run.UUID, args.From)
	if err != nil {
		return nil, nil, fmt.Errorf("from: %w", err)
	}
	to, err := h.resolveNode(ctx, run.UUID, args.To)
	if err != nil {
		return nil, nil, fmt.Errorf("to: %w", err)
	}
	if from.UUID == to.UUID {
		return nil, nil, fmt.Errorf("an action cannot depend on itself (%q)", from.NodeKey)
	}

	edgeType := enums.AgentEdgeTypeFromString(strings.TrimSpace(args.EdgeType))
	if edgeType == enums.AGENT_EDGE_TYPE_INVALID {
		edgeType = enums.AGENT_EDGE_TYPE_DEPENDENCY
	}

	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        run.UUID,
		eventType:      enums.AGENT_EVENT_TYPE_EDGE_ADDED,
		idempotencyKey: fmt.Sprintf("edge:%s:%s->%s:%s", run.RunKey, from.NodeKey, to.NodeKey, edgeType.String()),
		structural:     true,
		payload: payload_entity.AgentEventPayload{
			Message: nullString(fmt.Sprintf("%s -> %s", from.NodeKey, to.NodeKey)),
		},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			return h.upsertEdge(ctx, tx, run.UUID, from.UUID, to.UUID, edgeType, args.Condition)
		},
	})
	if err != nil {
		return nil, nil, err
	}

	return jsonResult(result{OK: true, RunKey: run.RunKey, Sequence: seq, GraphRevision: rev})
}

// upsertEdge is a no-op when the edge already exists. The schema's unique index
// on (from, to, edge_type) would otherwise turn a repeated plan declaration into
// a failed transaction.
func (h *Handler) upsertEdge(ctx context.Context, tx *sql.Tx, runUUID, from, to uuid.UUID, edgeType enums.AgentEdgeType, condition string) error {
	existing, err := h.core.AgentEdge().FetchAgentEdgeByFromNodeUUIDAndToNodeUUIDAndEdgeType(ctx,
		agent_edge_types.FetchAgentEdgeByFromNodeUUIDAndToNodeUUIDAndEdgeTypeRequest{
			FromNodeUUID: from,
			ToNodeUUID:   to,
			EdgeType:     edgeType,
			Limit:        1,
		}, agent_edge.WithSkipCache())
	if err == nil && len(existing.Results) > 0 {
		return nil
	}

	id, err := uuid.NewV4()
	if err != nil {
		return err
	}
	_, err = h.core.AgentEdge().Insert(ctx, agent_edge_types.UpsertRequest{
		AgentEdge: agent_edge_entity.AgentEdge{
			UUID:           id,
			RunUUID:        runUUID,
			FromNodeUUID:   from,
			ToNodeUUID:     to,
			EdgeType:       edgeType,
			ConditionLabel: nullString(condition),
			Status:         enums.AGENT_EDGE_STATUS_PENDING,
			CreatedBy:      serviceIdentity,
			UpdatedBy:      serviceIdentity,
		},
	}, agent_edge.WithSQLTransaction(tx))
	return err
}
