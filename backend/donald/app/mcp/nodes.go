package mcp

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nextwave/donald/core/module/agent_node"
	agent_node_types "github.com/nextwave/donald/core/module/agent_node/types"
	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
	agent_node_entity "github.com/nextwave/donald/entity/agent_node"
	"github.com/nextwave/donald/enums"
)

// ─────────────────────────────────────────────
// Tool: declare_actions
// ─────────────────────────────────────────────

// PlannedAction is one row of the up-front plan. Kept to four fields on purpose:
// this is the only bulk call in the surface, and every field multiplies by the
// number of steps the agent is declaring.
type PlannedAction struct {
	NodeKey     string `json:"node_key" jsonschema:"Stable slug for this action, unique in the run - lower_snake_case, e.g. fetch_invoices. Reuse it in every later call about this action."`
	Name        string `json:"name" jsonschema:"Short label shown on the node"`
	Description string `json:"description,omitempty" jsonschema:"Optional one-line description of what the step does"`
	After       string `json:"after,omitempty" jsonschema:"node_key of the step this one depends on. Omit for a first step. Use add_dependency for anything with more than one predecessor."`
}

type DeclareActionsParams struct {
	RunKey  string          `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	Actions []PlannedAction `json:"actions" jsonschema:"The steps you plan to run, in order. The plan is not binding - discover more later with add_action."`
}

func (h *Handler) DeclareActions(ctx context.Context, req *mcp.CallToolRequest, args DeclareActionsParams) (*mcp.CallToolResult, any, error) {
	run, err := h.resolveRun(ctx, args.RunKey)
	if err != nil {
		return nil, nil, err
	}
	if len(args.Actions) == 0 {
		return nil, nil, fmt.Errorf("actions is empty - declare at least one step, or skip declare_actions and use add_action as you go")
	}

	// One event for the whole plan, not one per step: the UI draws the plan as a
	// single arrival, and the agent gets one sequence number back.
	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        run.UUID,
		eventType:      enums.AGENT_EVENT_TYPE_PLAN_DECLARED,
		idempotencyKey: "plan_declared:" + run.RunKey,
		structural:     true,
		payload: payload_entity.AgentEventPayload{
			Message: nullString(fmt.Sprintf("declared %d planned actions", len(args.Actions))),
		},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			keyToUUID := map[string]uuid.UUID{}
			for i, a := range args.Actions {
				key := strings.TrimSpace(a.NodeKey)
				if key == "" {
					return fmt.Errorf("actions[%d].node_key is required", i)
				}
				if strings.TrimSpace(a.Name) == "" {
					return fmt.Errorf("actions[%d].name is required", i)
				}
				order := int64(i + 1)
				id, err := h.upsertNode(ctx, tx, run.UUID, key, nodeFields{
					Name:        a.Name,
					Description: a.Description,
					Planned:     true,
					PlanOrder:   &order,
				})
				if err != nil {
					return err
				}
				keyToUUID[key] = id
			}
			// Edges are created after every node exists, so an "after" may name a
			// step declared later in the list.
			for i, a := range args.Actions {
				if strings.TrimSpace(a.After) == "" {
					continue
				}
				from, ok := keyToUUID[a.After]
				if !ok {
					resolved, err := h.resolveNode(ctx, run.UUID, a.After)
					if err != nil {
						return fmt.Errorf("actions[%d].after names %q, which is not in this plan or the run: %w", i, a.After, err)
					}
					from = resolved.UUID
				}
				if err := h.upsertEdge(ctx, tx, run.UUID, from, keyToUUID[a.NodeKey],
					enums.AGENT_EDGE_TYPE_DEPENDENCY, ""); err != nil {
					return err
				}
			}
			return nil
		},
	})
	if err != nil {
		return nil, nil, err
	}

	return jsonResult(result{
		OK: true, RunKey: run.RunKey, Sequence: seq, GraphRevision: rev,
		Note: fmt.Sprintf("%d actions planned", len(args.Actions)),
	})
}

// ─────────────────────────────────────────────
// Tool: add_action
// ─────────────────────────────────────────────

type AddActionParams struct {
	RunKey      string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey     string `json:"node_key" jsonschema:"Stable slug for this action, unique in the run - lower_snake_case"`
	Name        string `json:"name" jsonschema:"Short label shown on the node"`
	Description string `json:"description,omitempty" jsonschema:"Optional one-line description"`
	ActionType  string `json:"action_type,omitempty" jsonschema:"One of: plan_step, tool_call, reasoning, decision, user_interaction, subagent_call, external_call, other"`
	ToolName    string `json:"tool_name,omitempty" jsonschema:"Name of the tool being invoked, when action_type is tool_call"`
	AgentLabel  string `json:"agent_label,omitempty" jsonschema:"Which subagent is doing this, if not you. A plain label - subagents are drawn as a lane, not a nested graph."`
	After       string `json:"after,omitempty" jsonschema:"node_key of the step this one follows"`
}

func (h *Handler) AddAction(ctx context.Context, req *mcp.CallToolRequest, args AddActionParams) (*mcp.CallToolResult, any, error) {
	run, err := h.resolveRun(ctx, args.RunKey)
	if err != nil {
		return nil, nil, err
	}
	key := strings.TrimSpace(args.NodeKey)
	if key == "" || strings.TrimSpace(args.Name) == "" {
		return nil, nil, fmt.Errorf("node_key and name are both required")
	}

	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        run.UUID,
		eventType:      enums.AGENT_EVENT_TYPE_NODE_ADDED,
		agentLabel:     args.AgentLabel,
		idempotencyKey: "node_added:" + run.RunKey + ":" + key,
		structural:     true,
		payload:        payload_entity.AgentEventPayload{Message: nullString(args.Name)},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			id, err := h.upsertNode(ctx, tx, run.UUID, key, nodeFields{
				Name:        args.Name,
				Description: args.Description,
				NodeType:    enums.AgentNodeTypeFromString(args.ActionType),
				ToolName:    args.ToolName,
				AgentLabel:  args.AgentLabel,
				// Discovered mid-run, so not part of the declared plan. The UI uses
				// this to distinguish work the agent said it would do from work it
				// turned out to need.
				Planned: false,
			})
			if err != nil {
				return err
			}
			_ = id
			if strings.TrimSpace(args.After) != "" {
				prev, err := h.resolveNode(ctx, run.UUID, args.After)
				if err != nil {
					return err
				}
				return h.upsertEdge(ctx, tx, run.UUID, prev.UUID, id, enums.AGENT_EDGE_TYPE_DEPENDENCY, "")
			}
			return nil
		},
	})
	if err != nil {
		return nil, nil, err
	}

	return jsonResult(result{OK: true, RunKey: run.RunKey, NodeKey: key, Sequence: seq, GraphRevision: rev})
}

// ─────────────────────────────────────────────
// Tools: start_action / report_progress / complete_action / fail_action / skip_action
// ─────────────────────────────────────────────

type StartActionParams struct {
	RunKey       string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey      string `json:"node_key" jsonschema:"The action you are starting"`
	InputSummary string `json:"input_summary,omitempty" jsonschema:"Short summary of the inputs. Never put credentials or personal data here."`
}

func (h *Handler) StartAction(ctx context.Context, req *mcp.CallToolRequest, args StartActionParams) (*mcp.CallToolResult, any, error) {
	return h.transition(ctx, args.RunKey, args.NodeKey, transitionSpec{
		to:                enums.AGENT_NODE_STATUS_IN_PROGRESS,
		idempotencySuffix: "start",
		mutate: func(n *agent_node_entity.AgentNode) {
			now := time.Now().UTC()
			n.StartedAt = nullTime(&now)
			if args.InputSummary != "" {
				n.InputSummary = nullString(args.InputSummary)
			}
		},
	})
}

type ReportProgressParams struct {
	RunKey  string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey string `json:"node_key" jsonschema:"The action you are working on"`
	Message string `json:"message" jsonschema:"One short line describing what is happening right now - this is displayed live under the node"`
	Percent *int64 `json:"percent,omitempty" jsonschema:"Optional completion percentage, 0-100"`
}

// ReportProgress is the highest-frequency tool in the surface, so it stays
// deliberately thin: no status change, no structural change, one short line.
func (h *Handler) ReportProgress(ctx context.Context, req *mcp.CallToolRequest, args ReportProgressParams) (*mcp.CallToolResult, any, error) {
	run, err := h.resolveRun(ctx, args.RunKey)
	if err != nil {
		return nil, nil, err
	}
	node, err := h.resolveNode(ctx, run.UUID, args.NodeKey)
	if err != nil {
		return nil, nil, err
	}
	if args.Percent != nil && (*args.Percent < 0 || *args.Percent > 100) {
		return nil, nil, fmt.Errorf("percent must be between 0 and 100 (got %d)", *args.Percent)
	}

	// Progress reports are NOT deduplicated across calls: two identical messages
	// seconds apart are two real updates. The timestamp keeps the key unique.
	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        run.UUID,
		eventType:      enums.AGENT_EVENT_TYPE_NODE_UPDATED,
		nodeUUID:       &node.UUID,
		agentLabel:     node.AgentLabel.String,
		idempotencyKey: fmt.Sprintf("progress:%s:%d", node.NodeKey, time.Now().UTC().UnixNano()),
		payload: payload_entity.AgentEventPayload{
			Message:         nullString(args.Message),
			ProgressPercent: nullInt64(args.Percent),
			NewStatus:       node.Status,
		},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			node.StatusMessage = nullString(args.Message)
			node.ProgressPercent = nullInt64(args.Percent)
			return h.updateNode(ctx, tx, node)
		},
	})
	if err != nil {
		return nil, nil, err
	}
	return jsonResult(result{OK: true, RunKey: run.RunKey, NodeKey: node.NodeKey, Sequence: seq, GraphRevision: rev})
}

type CompleteActionParams struct {
	RunKey        string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey       string `json:"node_key" jsonschema:"The action that finished"`
	OutputSummary string `json:"output_summary,omitempty" jsonschema:"Short summary of the result"`
}

func (h *Handler) CompleteAction(ctx context.Context, req *mcp.CallToolRequest, args CompleteActionParams) (*mcp.CallToolResult, any, error) {
	return h.transition(ctx, args.RunKey, args.NodeKey, transitionSpec{
		to:                enums.AGENT_NODE_STATUS_SUCCEEDED,
		idempotencySuffix: "complete",
		message:           args.OutputSummary,
		mutate: func(n *agent_node_entity.AgentNode) {
			now := time.Now().UTC()
			n.FinishedAt = nullTime(&now)
			n.ProgressPercent = null100()
			if args.OutputSummary != "" {
				n.OutputSummary = nullString(args.OutputSummary)
			}
		},
	})
}

type FailActionParams struct {
	RunKey  string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey string `json:"node_key" jsonschema:"The action that failed"`
	Error   string `json:"error" jsonschema:"What went wrong, in one or two lines"`
}

func (h *Handler) FailAction(ctx context.Context, req *mcp.CallToolRequest, args FailActionParams) (*mcp.CallToolResult, any, error) {
	if strings.TrimSpace(args.Error) == "" {
		return nil, nil, fmt.Errorf("error is required - a failed action with no reason is not diagnosable")
	}
	return h.transition(ctx, args.RunKey, args.NodeKey, transitionSpec{
		to:                enums.AGENT_NODE_STATUS_FAILED,
		idempotencySuffix: "fail",
		message:           args.Error,
		mutate: func(n *agent_node_entity.AgentNode) {
			now := time.Now().UTC()
			n.FinishedAt = nullTime(&now)
			n.ErrorMessage = nullString(args.Error)
		},
	})
}

type SkipActionParams struct {
	RunKey  string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey string `json:"node_key" jsonschema:"The planned action you are not going to run"`
	Reason  string `json:"reason,omitempty" jsonschema:"Why it was skipped"`
}

// SkipAction exists because a declared plan is not binding. Without it an agent
// that plans five steps and needs three leaves two nodes stuck at not_started,
// and the UI cannot tell those apart from work still to come.
func (h *Handler) SkipAction(ctx context.Context, req *mcp.CallToolRequest, args SkipActionParams) (*mcp.CallToolResult, any, error) {
	return h.transition(ctx, args.RunKey, args.NodeKey, transitionSpec{
		to:                enums.AGENT_NODE_STATUS_SKIPPED,
		idempotencySuffix: "skip",
		message:           args.Reason,
		mutate: func(n *agent_node_entity.AgentNode) {
			now := time.Now().UTC()
			n.FinishedAt = nullTime(&now)
			n.StatusMessage = nullString(args.Reason)
		},
	})
}

type transitionSpec struct {
	to                enums.AgentNodeStatus
	idempotencySuffix string
	message           string
	mutate            func(*agent_node_entity.AgentNode)
}

// transition is the shared body of every node status change. Each tool stays a
// separate MCP tool with its own name and its own required arguments — an agent
// picking "fail_action" and being forced to supply `error` is far more reliable
// than one choosing a status string on a generic update_action — but they all
// funnel through one code path so the event, the timestamps and the snapshot
// never disagree.
func (h *Handler) transition(ctx context.Context, runKey, nodeKey string, spec transitionSpec) (*mcp.CallToolResult, any, error) {
	run, err := h.resolveRun(ctx, runKey)
	if err != nil {
		return nil, nil, err
	}
	node, err := h.resolveNode(ctx, run.UUID, nodeKey)
	if err != nil {
		return nil, nil, err
	}

	previous := node.Status
	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        run.UUID,
		eventType:      enums.AGENT_EVENT_TYPE_NODE_STATUS_CHANGED,
		nodeUUID:       &node.UUID,
		agentLabel:     node.AgentLabel.String,
		idempotencyKey: fmt.Sprintf("%s:%s:%s", spec.idempotencySuffix, run.RunKey, node.NodeKey),
		payload: payload_entity.AgentEventPayload{
			PreviousStatus: previous,
			NewStatus:      spec.to,
			Message:        nullString(spec.message),
		},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			node.Status = spec.to
			if spec.mutate != nil {
				spec.mutate(&node)
			}
			return h.updateNode(ctx, tx, node)
		},
	})
	if err != nil {
		return nil, nil, err
	}

	return jsonResult(result{
		OK: true, RunKey: run.RunKey, NodeKey: node.NodeKey,
		Sequence: seq, GraphRevision: rev,
	})
}

type nodeFields struct {
	Name        string
	Description string
	NodeType    enums.AgentNodeType
	ToolName    string
	AgentLabel  string
	Planned     bool
	PlanOrder   *int64
}

// upsertNode creates a node or returns the existing one for this node_key.
// Re-declaring a key is not an error: an agent that repeats its plan should
// converge on the same graph rather than fail.
func (h *Handler) upsertNode(ctx context.Context, tx *sql.Tx, runUUID uuid.UUID, key string, f nodeFields) (uuid.UUID, error) {
	if existing, err := h.resolveNode(ctx, runUUID, key); err == nil {
		return existing.UUID, nil
	}
	id, err := uuid.NewV4()
	if err != nil {
		return uuid.UUID{}, err
	}
	nodeType := f.NodeType
	if nodeType == enums.AGENT_NODE_TYPE_INVALID {
		nodeType = enums.AGENT_NODE_TYPE_PLAN_STEP
	}
	_, err = h.core.AgentNode().Insert(ctx, agent_node_types.UpsertRequest{
		AgentNode: agent_node_entity.AgentNode{
			UUID:        id,
			RunUUID:     runUUID,
			NodeKey:     key,
			Name:        f.Name,
			Description: nullString(f.Description),
			NodeType:    nodeType,
			ToolName:    nullString(f.ToolName),
			AgentLabel:  nullString(f.AgentLabel),
			Status:      enums.AGENT_NODE_STATUS_NOT_STARTED,
			Planned:     f.Planned,
			PlanOrder:   nullInt64(f.PlanOrder),
			CreatedBy:   serviceIdentity,
			UpdatedBy:   serviceIdentity,
		},
	}, agent_node.WithSQLTransaction(tx))
	return id, err
}
