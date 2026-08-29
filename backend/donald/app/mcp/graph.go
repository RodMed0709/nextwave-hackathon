package mcp

import (
	"context"
	"time"

	"github.com/gofrs/uuid"
	"github.com/guregu/null/v6"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	agent_node_entity "github.com/nextwave/donald/entity/agent_node"
	"github.com/nextwave/donald/enums"
)

// ─────────────────────────────────────────────
// Tool: get_graph
// ─────────────────────────────────────────────

type GetGraphParams struct {
	RunKey string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
}

// GraphAction is the recovery view of a node: the key to address it by, its
// label and its status. Nothing else. An agent calling this has lost track of
// its own plan, and handing back descriptions, timestamps and summaries would
// refill its context with what it already wrote.
type GraphAction struct {
	NodeKey string `json:"node_key"`
	Name    string `json:"name"`
	Status  string `json:"status"`
}

type GetGraphResult struct {
	RunKey        string        `json:"run_key"`
	RunStatus     string        `json:"run_status"`
	GraphRevision int64         `json:"graph_revision"`
	Actions       []GraphAction `json:"actions"`
}

// GetGraph is the recovery path for the failure this whole design expects: an
// LLM agent, mid-run, that no longer remembers the node_keys it invented. It is
// read-only and appends no event.
func (h *Handler) GetGraph(ctx context.Context, req *mcp.CallToolRequest, args GetGraphParams) (*mcp.CallToolResult, any, error) {
	run, err := h.resolveRun(ctx, args.RunKey)
	if err != nil {
		return nil, nil, err
	}

	nodes, err := h.nodesForRun(ctx, run.UUID)
	if err != nil {
		return nil, nil, err
	}

	out := GetGraphResult{
		RunKey:        run.RunKey,
		RunStatus:     run.Status.String(),
		GraphRevision: run.GraphRevision,
		Actions:       make([]GraphAction, 0, len(nodes)),
	}
	for _, n := range nodes {
		out.Actions = append(out.Actions, GraphAction{
			NodeKey: n.NodeKey,
			Name:    n.Name,
			Status:  n.Status.String(),
		})
	}
	return jsonResult(out)
}

// nodesForRun reads the run's nodes ordered for display. It goes to SQL rather
// than through the module's List: List takes an AIP filter expression and a
// declarations table built by the REST transport, which is a lot of machinery
// for "every node in this run".
func (h *Handler) nodesForRun(ctx context.Context, runUUID uuid.UUID) ([]agent_node_entity.AgentNode, error) {
	rows, err := h.core.DB().QueryContext(ctx,
		"SELECT `uuid`, `node_key`, `name`, `status`, `plan_order` FROM `agent_node` WHERE `run_uuid` = ? ORDER BY COALESCE(`plan_order`, 2147483647), `created_at`",
		runUUID.String())
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []agent_node_entity.AgentNode
	for rows.Next() {
		var (
			n         agent_node_entity.AgentNode
			id        string
			planOrder null.Int64
			status    int64
		)
		if err := rows.Scan(&id, &n.NodeKey, &n.Name, &status, &planOrder); err != nil {
			return nil, err
		}
		parsed, err := uuid.FromString(id)
		if err != nil {
			return nil, err
		}
		n.UUID = parsed
		n.Status = agentNodeStatus(status)
		n.PlanOrder = planOrder
		out = append(out, n)
	}
	return out, rows.Err()
}

func (h *Handler) nodeByUUID(ctx context.Context, id uuid.UUID) (agent_node_entity.AgentNode, error) {
	var n agent_node_entity.AgentNode
	var status int64
	err := h.core.DB().QueryRowContext(ctx,
		"SELECT `node_key`, `name`, `status` FROM `agent_node` WHERE `uuid` = ?", id.String()).
		Scan(&n.NodeKey, &n.Name, &status)
	if err != nil {
		return n, err
	}
	n.UUID = id
	n.Status = agentNodeStatus(status)
	return n, nil
}

func nullTime(t *time.Time) null.Time {
	if t == nil {
		return null.Time{}
	}
	return null.TimeFrom(*t)
}

func null100() null.Int64 { return null.IntFrom(100) }

// agentNodeStatus converts the raw column value read by the SQL helpers above
// back into the generated enum.
func agentNodeStatus(v int64) enums.AgentNodeStatus { return enums.AgentNodeStatus(v) }
