package mcp

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/guregu/null/v6"
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
	NodeKey     string   `json:"node_key" jsonschema:"Stable slug for this action, unique in the run - lower_snake_case, e.g. fetch_invoices. Reuse it in every later call about this action."`
	Name        string   `json:"name" jsonschema:"Short label shown on the node"`
	Description string   `json:"description,omitempty" jsonschema:"Optional one-line description of what the step does"`
	AgentLabel  string   `json:"agent_label,omitempty" jsonschema:"Which agent or subagent runs this step, e.g. 'Nina'. Drawn as a lane, so pass it here rather than describing it in text."`
	ActionType  string   `json:"action_type,omitempty" jsonschema:"One of: plan_step, tool_call, reasoning, decision, user_interaction, subagent_call, external_call, other"`
	DependsOn   []string `json:"depends_on,omitempty" jsonschema:"node_keys this step waits on. Give ALL of them - a step with three predecessors is a join and needs all three here. May name steps declared later in this same list."`
	After       string   `json:"after,omitempty" jsonschema:"Single-predecessor shorthand for depends_on. Use depends_on when there is more than one."`
}

// predecessors merges the two ways a plan step can state its dependencies.
//
// depends_on exists because `after` could only express one, which forced an
// agent declaring a join to follow up with add_dependency calls — contradicting
// the instruction to declare the whole graph in one go. `after` is kept as the
// single-parent shorthand because most steps have exactly one and a bare string
// reads better than a one-element list.
func (a PlannedAction) predecessors() []string {
	seen := map[string]bool{}
	var out []string
	for _, k := range append(append([]string{}, a.DependsOn...), a.After) {
		k = strings.TrimSpace(k)
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, k)
	}
	return out
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
		// The plan travels IN the event. Edges created here get no edge_added of
		// their own — they are part of one atomic plan declaration — so without
		// this a client replaying the log would see the nodes appear with no
		// shape connecting them.
		payload: payload_entity.AgentEventPayload{
			Message: nullString(fmt.Sprintf("declared %d planned actions", len(args.Actions))),
			Detail:  detailJSON(planDetail(args.Actions)),
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
					AgentLabel:  a.AgentLabel,
					NodeType:    enums.AgentNodeTypeFromString(a.ActionType),
					Planned:     true,
					PlanOrder:   &order,
				})
				if err != nil {
					return err
				}
				keyToUUID[key] = id
			}
			// Edges are created after every node exists, so a dependency may name a
			// step declared later in the list.
			for i, a := range args.Actions {
				for _, pred := range a.predecessors() {
					from, ok := keyToUUID[pred]
					if !ok {
						resolved, err := h.resolveNode(ctx, run.UUID, pred)
						if err != nil {
							return fmt.Errorf("actions[%d] (%s) depends on %q, which is not in this plan or the run: %w", i, a.NodeKey, pred, err)
						}
						from = resolved.UUID
					}
					if err := h.upsertEdge(ctx, tx, run.UUID, from, keyToUUID[a.NodeKey],
						enums.AGENT_EDGE_TYPE_DEPENDENCY, ""); err != nil {
						return err
					}
				}
			}
			return nil
		},
	})
	if err != nil {
		return nil, nil, err
	}

	return h.ack(ctx, result{
		OK: true, RunKey: run.RunKey, Sequence: seq, GraphRevision: rev,
		Note: fmt.Sprintf("%d actions planned", len(args.Actions)),
	}, run.UUID)
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

	// Filled in by apply() below, then read by commit so the event carries the
	// node it just created.
	var createdID uuid.UUID

	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        run.UUID,
		nodeUUIDRef:    &createdID,
		eventType:      enums.AGENT_EVENT_TYPE_NODE_ADDED,
		agentLabel:     args.AgentLabel,
		idempotencyKey: "node_added:" + run.RunKey + ":" + key,
		structural:     true,
		// The `after` edge travels WITH the node_added event.
		//
		// add_action creates the node and its incoming edge in one atomic
		// mutation, so there is no separate edge_added event to carry the edge.
		// Leaving it out meant a discovered node reached the client with no
		// predecessor: the graph treated it as a root and drew it at the very
		// start of the flow, beside step one, rather than hanging off the step
		// that discovered it.
		payload: payload_entity.AgentEventPayload{
			Message: nullString(args.Name),
			Detail:  detailJSON(afterEdgeDetail(args.After, key)),
		},
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
			createdID = id
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

	return h.ack(ctx, result{OK: true, RunKey: run.RunKey, NodeKey: key, Sequence: seq, GraphRevision: rev}, run.UUID)
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
			// A retry or a resume must not inherit the last attempt's ending.
			// Leaving finished_at set makes the UI draw a step that is running
			// and finished at once; leaving error_message makes a succeeding
			// retry still show the old failure.
			n.FinishedAt = null.Time{}
			n.ErrorMessage = null.String{}
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
			// Agents routinely report progress on a step they never explicitly
			// started. Reporting progress IS a claim to be working on it, so take
			// it at face value rather than leaving a node that is visibly
			// progressing while drawn as not-yet-started.
			if node.Status == enums.AGENT_NODE_STATUS_NOT_STARTED {
				node.Status = enums.AGENT_NODE_STATUS_IN_PROGRESS
				if !node.StartedAt.Valid {
					now := time.Now().UTC()
					node.StartedAt = nullTime(&now)
				}
			}
			return h.updateNode(ctx, tx, node)
		},
	})
	if err != nil {
		return nil, nil, err
	}
	return h.ack(ctx, result{OK: true, RunKey: run.RunKey, NodeKey: node.NodeKey, Sequence: seq, GraphRevision: rev}, run.UUID)
}

type CompleteActionParams struct {
	RunKey        string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey       string `json:"node_key" jsonschema:"The action that finished"`
	OutputSummary string `json:"output_summary,omitempty" jsonschema:"Short summary of the result"`
	ManualMinutes *int64 `json:"manual_minutes,omitempty" jsonschema:"Roughly how many minutes this step would have taken a person doing it by hand, start to finish. Your honest estimate; omit it if you genuinely cannot say."`
}

// manualMinutesCeiling is two working days. An estimate above it is not a
// generous guess, it is a misread unit — an agent answering in seconds, or
// pricing the whole run into one step — and letting it through would poison the
// only number in the product a person is asked to take on faith.
const manualMinutesCeiling = 2880

func (h *Handler) CompleteAction(ctx context.Context, req *mcp.CallToolRequest, args CompleteActionParams) (*mcp.CallToolResult, any, error) {
	if args.ManualMinutes != nil && (*args.ManualMinutes <= 0 || *args.ManualMinutes > manualMinutesCeiling) {
		return nil, nil, fmt.Errorf(
			"manual_minutes must be between 1 and %d (two working days) — got %d; omit it rather than sending a number you do not believe",
			manualMinutesCeiling, *args.ManualMinutes)
	}
	return h.transition(ctx, args.RunKey, args.NodeKey, transitionSpec{
		to:                enums.AGENT_NODE_STATUS_SUCCEEDED,
		idempotencySuffix: "complete",
		message:           args.OutputSummary,
		detail:            manualMinutesDetail(args.ManualMinutes),
		mutate: func(n *agent_node_entity.AgentNode) {
			now := time.Now().UTC()
			ensureStarted(n, now)
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
			ensureStarted(n, now)
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

type CancelActionParams struct {
	RunKey  string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey string `json:"node_key" jsonschema:"The action you were running and have abandoned"`
	Reason  string `json:"reason,omitempty" jsonschema:"Why it was abandoned - e.g. a user asked you to stop, or the work became unnecessary"`
}

// CancelAction is for work that WAS running and has been abandoned. It is
// distinct from skip_action (a planned step never begun) and from fail_action
// (something broke) because those three read very differently to the person
// watching, and conflating them makes the graph lie.
//
// The case that forced this tool: a user hits stop mid-action. The agent has no
// honest status to report otherwise — "skipped" claims it never started and
// "failed" blames the work for a decision a human made.
func (h *Handler) CancelAction(ctx context.Context, req *mcp.CallToolRequest, args CancelActionParams) (*mcp.CallToolResult, any, error) {
	return h.transition(ctx, args.RunKey, args.NodeKey, transitionSpec{
		to:                enums.AGENT_NODE_STATUS_CANCELLED,
		idempotencySuffix: "cancel",
		message:           args.Reason,
		mutate: func(n *agent_node_entity.AgentNode) {
			now := time.Now().UTC()
			ensureStarted(n, now)
			n.FinishedAt = nullTime(&now)
			n.StatusMessage = nullString(args.Reason)
		},
	})
}

// afterEdgeDetail describes the edge that add_action's `after` creates, in the
// same shape edge_added uses, so one handler on the client covers both.
//
// Returns nil when there is no predecessor — a genuinely root step — and a nil
// detail marshals to no field rather than an empty object.
func afterEdgeDetail(after, nodeKey string) map[string]string {
	after = strings.TrimSpace(after)
	if after == "" {
		return nil
	}
	return map[string]string{
		"edge_key":        after + "->" + nodeKey,
		"source_node_key": after,
		"target_node_key": nodeKey,
	}
}

// manualMinutesDetail records how much human time the completed step stood in
// for, on the event that completed it.
//
// It rides in `detail` because there is no column for it and adding one means a
// schema change in nuzur — but the event log is the right home for it anyway.
// The figure is written down ONCE, at the moment the agent claims it, and every
// later reader replays that same number instead of deriving one. A saving that
// says 45 minutes today and 40 tomorrow is a saving nobody believes, and being
// believed is the entire value of the figure.
//
// Absent stays absent: an agent that cannot honestly estimate should leave the
// card blank rather than have us invent a default on its behalf.
func manualMinutesDetail(minutes *int64) null.String {
	if minutes == nil {
		return null.String{}
	}
	return detailJSON(map[string]any{"manual_minutes": *minutes})
}

// transitionKey builds the idempotency key for a node status change.
//
// Two discriminators, and both are load-bearing:
//
//   - previous status, so a retry after a failure is not mistaken for a repeat
//     of the original call;
//   - attempt, so a SECOND start→complete cycle gets its own keys.
//
// The attempt was added after a real failure: a node that had already run once
// could be re-started (previous status differed, so the key was new) but could
// never be completed again, because `complete:<run>:<node>:in_progress` had been
// recorded during the first cycle. commit() short-circuited on it and returned
// the original sequence, so the caller was told it succeeded while the node sat
// in_progress forever. Retrying a whole step is normal; it has to converge.
//
// attempt counts start events, which is what makes duplicates still dedupe: two
// sends of the same complete happen within one attempt and produce the same key.
func transitionKey(suffix, runKey, nodeKey string, previous enums.AgentNodeStatus, attempt int) string {
	return fmt.Sprintf("%s:%s:%s:%s:%d", suffix, runKey, nodeKey, previous.String(), attempt)
}

// attemptCount is how many times this node has been started.
func (h *Handler) attemptCount(ctx context.Context, runUUID uuid.UUID, nodeKey string) (int, error) {
	var n int
	err := h.core.DB().QueryRowContext(ctx,
		"SELECT COUNT(*) FROM `agent_event` WHERE `run_uuid` = ? AND `idempotency_key` LIKE ?",
		runUUID.String(), "start:%:"+nodeKey+":%").Scan(&n)
	return n, err
}

// ensureStarted back-fills a start time for a step that reached a terminal
// status without one. Agents forget start_action; the alternative is a node the
// UI shows as finished but never started, and a duration it cannot compute.
func ensureStarted(n *agent_node_entity.AgentNode, at time.Time) {
	if !n.StartedAt.Valid {
		n.StartedAt = nullTime(&at)
	}
}

// ─────────────────────────────────────────────
// Tool: block_action
// ─────────────────────────────────────────────

type BlockActionParams struct {
	RunKey  string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey string `json:"node_key" jsonschema:"The action that cannot proceed"`
	Reason  string `json:"reason" jsonschema:"One of: user_decision (you need a person to decide something), missing_data (something you need does not exist yet), provider_outage (an external service is down)"`
	Message string `json:"message" jsonschema:"What exactly you are waiting for, in one line - this is what the person watching reads to know whether they can unblock you"`
}

// BlockAction reports a step that cannot proceed but has not failed.
//
// The three blocked states were in the schema from the first version and no
// tool could reach any of them, which meant an agent waiting on a person had to
// choose between lying (report_progress, "still working") and giving up
// (fail_action). Both are wrong, and the first is worse: a run that is stuck
// looks identical to one that is busy, so nobody comes to unblock it.
//
// Blocking a step also blocks the run, so a watcher scanning a list of runs can
// see which ones need attention without opening each graph.
//
// To resume, call start_action on the same step.
func (h *Handler) BlockAction(ctx context.Context, req *mcp.CallToolRequest, args BlockActionParams) (*mcp.CallToolResult, any, error) {
	var to enums.AgentNodeStatus
	switch strings.TrimSpace(strings.ToLower(args.Reason)) {
	case "user_decision", "user":
		to = enums.AGENT_NODE_STATUS_BLOCKED_ON_USER_DECISION
	case "missing_data", "data":
		to = enums.AGENT_NODE_STATUS_BLOCKED_ON_MISSING_DATA
	case "provider_outage", "outage", "provider":
		to = enums.AGENT_NODE_STATUS_BLOCKED_ON_PROVIDER_OUTAGE
	default:
		return nil, nil, fmt.Errorf("reason must be user_decision, missing_data or provider_outage (got %q)", args.Reason)
	}
	if strings.TrimSpace(args.Message) == "" {
		return nil, nil, fmt.Errorf("message is required - a blocked step with no explanation cannot be unblocked by anyone")
	}

	return h.transition(ctx, args.RunKey, args.NodeKey, transitionSpec{
		to:                to,
		idempotencySuffix: "block",
		message:           args.Message,
		mutate: func(n *agent_node_entity.AgentNode) {
			n.StatusMessage = nullString(args.Message)
			// Deliberately NOT setting finished_at: the step is not over, it is
			// waiting, and the UI should keep showing it as live.
		},
	})
}

// runStatusFor maps a node status change onto the run, for the two cases where
// one step's state is really the whole run's state: a step blocking blocks the
// run, and resuming it puts the run back to work.
//
// It deliberately does NOT propagate failure — one failed step does not mean the
// run failed, since the agent may recover or carry on. Only finish_run decides
// that.
func runStatusFor(previous, next enums.AgentNodeStatus) (enums.AgentRunStatus, bool) {
	switch next {
	case enums.AGENT_NODE_STATUS_BLOCKED_ON_USER_DECISION:
		return enums.AGENT_RUN_STATUS_BLOCKED_ON_USER_DECISION, true
	case enums.AGENT_NODE_STATUS_BLOCKED_ON_MISSING_DATA:
		return enums.AGENT_RUN_STATUS_BLOCKED_ON_MISSING_DATA, true
	case enums.AGENT_NODE_STATUS_BLOCKED_ON_PROVIDER_OUTAGE:
		return enums.AGENT_RUN_STATUS_BLOCKED_ON_PROVIDER_OUTAGE, true
	}
	if isBlocked(previous) && next == enums.AGENT_NODE_STATUS_IN_PROGRESS {
		return enums.AGENT_RUN_STATUS_IN_PROGRESS, true
	}
	return 0, false
}

func isBlocked(s enums.AgentNodeStatus) bool {
	switch s {
	case enums.AGENT_NODE_STATUS_BLOCKED_ON_USER_DECISION,
		enums.AGENT_NODE_STATUS_BLOCKED_ON_MISSING_DATA,
		enums.AGENT_NODE_STATUS_BLOCKED_ON_PROVIDER_OUTAGE:
		return true
	}
	return false
}

type transitionSpec struct {
	to                enums.AgentNodeStatus
	idempotencySuffix string
	message           string
	mutate            func(*agent_node_entity.AgentNode)

	// detail is the tool-specific extra this transition wants recorded with its
	// event, in the same JSON-in-a-column form declare_actions and add_action
	// already use. The zero value is SQL NULL, so every transition that has
	// nothing extra to say carries nothing extra — the field is opt-in per tool.
	detail null.String
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

	// Which attempt this is, so a second start→complete cycle gets its own keys.
	attempt, err := h.attemptCount(ctx, run.UUID, node.NodeKey)
	if err != nil {
		return nil, nil, err
	}

	previous := node.Status
	if previous == spec.to && spec.to != enums.AGENT_NODE_STATUS_IN_PROGRESS {
		// Already in the target state. Report the run's current cursor rather
		// than appending a second identical event.
		return jsonResult(result{
			OK: true, RunKey: run.RunKey, NodeKey: node.NodeKey,
			Sequence: run.LastEventSequence, GraphRevision: run.GraphRevision,
			Note: "already " + spec.to.String(),
		})
	}

	// The idempotency key includes the status we are moving FROM.
	//
	// Keying on (tool, run, node) alone was wrong: it made a retry invisible.
	// An agent that starts a step, fails it, then retries calls start_action a
	// second time — same tool, same node — and the already-recorded key made
	// commit() short-circuit, so the node stayed failed while the agent was told
	// it succeeded. Retry is a normal path, not an edge case.
	//
	// Including the previous status keeps genuine duplicates deduplicated (two
	// sends of the same call see the same previous status) while letting a real
	// second transition through.
	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        run.UUID,
		eventType:      enums.AGENT_EVENT_TYPE_NODE_STATUS_CHANGED,
		nodeUUID:       &node.UUID,
		agentLabel:     node.AgentLabel.String,
		idempotencyKey: transitionKey(spec.idempotencySuffix, run.RunKey, node.NodeKey, previous, attempt),
		payload: payload_entity.AgentEventPayload{
			PreviousStatus: previous,
			NewStatus:      spec.to,
			Message:        nullString(spec.message),
			Detail:         spec.detail,
		},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			node.Status = spec.to
			if spec.mutate != nil {
				spec.mutate(&node)
			}
			if err := h.updateNode(ctx, tx, node); err != nil {
				return err
			}
			// A blocked step blocks the run, and resuming it unblocks the run.
			// Without this the run-level blocked_on_* statuses in the schema are
			// unreachable, and a run sitting on a blocked step still claims to be
			// in_progress.
			if next, ok := runStatusFor(previous, spec.to); ok && run.Status != next {
				run.Status = next
				return h.updateRun(ctx, tx, run)
			}
			return nil
		},
	})
	if err != nil {
		return nil, nil, err
	}

	return h.ack(ctx, result{
		OK: true, RunKey: run.RunKey, NodeKey: node.NodeKey,
		Sequence: seq, GraphRevision: rev,
	}, run.UUID)
}

// planDetail is the declared plan in the shape a client needs to build the graph
// in one go: every step with the facts that render it, and every dependency as
// an explicit edge.
func planDetail(actions []PlannedAction) map[string]any {
	steps := make([]map[string]any, 0, len(actions))
	edges := make([]map[string]string, 0)
	for i, a := range actions {
		steps = append(steps, map[string]any{
			"node_key":    strings.TrimSpace(a.NodeKey),
			"label":       a.Name,
			"agent_label": a.AgentLabel,
			"planned":     true,
			"plan_order":  i + 1,
		})
		for _, pred := range a.predecessors() {
			edges = append(edges, map[string]string{
				"edge_key":        pred + "->" + strings.TrimSpace(a.NodeKey),
				"source_node_key": pred,
				"target_node_key": strings.TrimSpace(a.NodeKey),
			})
		}
	}
	return map[string]any{"steps": steps, "edges": edges}
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
		// The node already exists, so its live state (status, timings) is
		// authoritative and must not be clobbered by a re-declared plan. But
		// FILL IN blanks: a node first seen through start_action carries no
		// label, lane or plan order, and a later declare_actions is exactly
		// where those arrive. Ignoring the whole call left such nodes unlabelled
		// forever, which is how a graph ends up with no swimlanes.
		changed := false
		if !existing.AgentLabel.Valid && f.AgentLabel != "" {
			existing.AgentLabel = nullString(f.AgentLabel)
			changed = true
		}
		if !existing.PlanOrder.Valid && f.PlanOrder != nil {
			existing.PlanOrder = nullInt64(f.PlanOrder)
			changed = true
		}
		if !existing.Description.Valid && f.Description != "" {
			existing.Description = nullString(f.Description)
			changed = true
		}
		if changed {
			if err := h.updateNode(ctx, tx, existing); err != nil {
				return uuid.UUID{}, err
			}
		}
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
