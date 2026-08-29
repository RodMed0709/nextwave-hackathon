package mcp

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"

	"github.com/nextwave/donald/core"
)

// ProtocolVersion is stamped on every run so the UI can render a graph reported
// by an older agent. Bump it when the meaning of a tool changes, not when one is
// added.
const ProtocolVersion = "1.0"

func boolPtr(b bool) *bool { return &b }

// Role selects which half of the surface this process serves, so the API and the
// MCP server can run as two independent deployments from ONE image.
//
// The point of the split is blast-radius isolation: agents are unpredictable
// callers, and a burst of MCP traffic must not slow the REST API the web app
// depends on. Splitting them gives each its own process, its own connection
// pool and its own resource limits.
//
// Correctness does not depend on the choice. Both roles run the same binary
// against the same database, so an MCP tool still commits its snapshot change
// and its event in one transaction; and deltas reach browsers by tailing
// agent_event rather than through an in-process channel, so they cross the
// process boundary unchanged. RoleAll keeps both in one process for local
// development.
type Role string

const (
	RoleAll Role = "all"
	RoleAPI Role = "api"
	RoleMCP Role = "mcp"
)

// RoleFromEnv reads DONALD_ROLE. An unset or unrecognised value serves
// everything, which is the safe default: a misconfigured pod that serves too
// much is a performance problem, one that serves too little is an outage.
func RoleFromEnv(logger *zap.Logger) Role {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("DONALD_ROLE"))) {
	case string(RoleAPI):
		return RoleAPI
	case string(RoleMCP):
		return RoleMCP
	case "", string(RoleAll):
		return RoleAll
	default:
		logger.Warn("DONALD_ROLE is not one of api, mcp, all; serving everything",
			zap.String("value", os.Getenv("DONALD_ROLE")))
		return RoleAll
	}
}

// Register mounts this process's share of the surface.
//
// The MCP endpoint is mounted by the mcp and all roles; the SSE stream by the
// api and all roles. The generated CRUD routes are mounted by the generated
// server regardless — they are cheap, and letting both roles serve them keeps a
// health check meaningful on either deployment.
func Register(r chi.Router, coreImpl *core.Implementation, logger *zap.Logger) {
	role := RoleFromEnv(logger)
	handler := NewHandler(coreImpl, NewBroadcaster(coreImpl.DB(), logger), logger)

	if role == RoleMCP || role == RoleAll {
		streamable := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
			return newServer(handler, logger)
		}, nil)
		// Full path including /v1 — the generated CRUD already owns that mount
		// point, and r.Route("/v1", ...) here would panic while the router builds.
		r.Handle("/v1/mcp", streamable)
		r.Handle("/v1/mcp/*", streamable)
	}

	if role == RoleAPI || role == RoleAll {
		r.Get("/v1/runs/{run_key}/stream", handler.streamHandler)
		// Purpose-built endpoints for the web app; see web_api.go for why the
		// generated CRUD is not enough on its own.
		handler.registerWebAPI(r)
	}

	logger.Info("donald custom routes mounted",
		zap.String("role", string(role)),
		zap.Bool("demo_pacing", demoPacingEnabled()))
	if demoPacingEnabled() {
		logger.Warn("DONALD_DEMO_PACING is on: the wait tool is exposed. This is demo scaffolding and should be off in production.")
	}
}

func newServer(h *Handler, logger *zap.Logger) *mcp.Server {
	registered = nil

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "donald",
		Version: ProtocolVersion,
	}, &mcp.ServerOptions{
		Instructions: serverInstructions(),
	})

	// Annotations are not decoration: clients gate tool calls on them, and in the
	// MCP spec destructiveHint DEFAULTS TO TRUE when omitted. Left off, every
	// reporting tool here would advertise itself as destructive and get gated.
	//
	// Every mutating tool below is idempotent — each carries a key derived from
	// (run_key, node_key), so a retry converges instead of duplicating. The one
	// exception is report_progress, where two identical messages are two real
	// updates.
	var (
		readOnly   = &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: boolPtr(false)}
		idempotent = &mcp.ToolAnnotations{DestructiveHint: boolPtr(false), IdempotentHint: true, OpenWorldHint: boolPtr(false)}
		additive   = &mcp.ToolAnnotations{DestructiveHint: boolPtr(false), OpenWorldHint: boolPtr(false)}
	)

	addTool(server, logger, &mcp.Tool{
		Name:        "start_run",
		Description: "Begin reporting a flow. Call this once, before anything else. You invent a run_key and reuse it in every later call; calling start_run again with the same key resumes the same run rather than creating a second one. Returns watch_url — SHOW IT to the person immediately, before you start working, so they can follow along from the beginning.",
		Annotations: idempotent,
	}, h.StartRun)

	addTool(server, logger, &mcp.Tool{
		Name:        "declare_actions",
		Description: "Declare the steps you plan to run, in order, so the whole flow is visible before it executes. The plan is NOT binding - add work you discover later with add_action, and drop planned work you no longer need with skip_action. Call this once, right after start_run.",
		Annotations: idempotent,
	}, h.DeclareActions)

	addTool(server, logger, &mcp.Tool{
		Name:        "finish_run",
		Description: "Close the run: succeeded, failed or cancelled. Always call this, especially when things went badly - a run nobody finishes is indistinguishable from an agent that crashed. Finishing as succeeded is refused while any action is still open, and the error names them.",
		Annotations: idempotent,
	}, h.FinishRun)

	addTool(server, logger, &mcp.Tool{
		Name:        "add_action",
		Description: "Add one step that was not in the declared plan. Use this whenever you discover work mid-run.",
		Annotations: idempotent,
	}, h.AddAction)

	addTool(server, logger, &mcp.Tool{
		Name:        "add_dependency",
		Description: "Draw an arrow between two steps. add_action's 'after' already covers a step with a single predecessor; use this for a step that waits on several, for a retry or fallback path, or for a conditional branch.",
		Annotations: idempotent,
	}, h.AddDependency)

	addTool(server, logger, &mcp.Tool{
		Name:        "start_action",
		Description: "Mark a step as now running. Call it when you actually begin the work, not when you plan it.",
		Annotations: idempotent,
	}, h.StartAction)

	addTool(server, logger, &mcp.Tool{
		Name:        "report_progress",
		Description: "Post one short line about what is happening inside a running step. Cheap and expected to be called often - this is what makes the graph feel live. Do not use it to change status.",
		Annotations: additive,
	}, h.ReportProgress)

	addTool(server, logger, &mcp.Tool{
		Name:        "complete_action",
		Description: "Mark a step as finished successfully.",
		Annotations: idempotent,
	}, h.CompleteAction)

	addTool(server, logger, &mcp.Tool{
		Name:        "fail_action",
		Description: "Mark a step as failed. The error is required - a failed step with no reason cannot be diagnosed by the person watching.",
		Annotations: idempotent,
	}, h.FailAction)

	addTool(server, logger, &mcp.Tool{
		Name:        "skip_action",
		Description: "Mark a planned step you are not going to run. Without this, abandoned plan steps sit at not_started forever and look like work still to come.",
		Annotations: idempotent,
	}, h.SkipAction)

	addTool(server, logger, &mcp.Tool{
		Name:        "block_action",
		Description: "Report that a step cannot proceed but has not failed - you are waiting on a person to decide, on data that does not exist yet, or on an external service that is down. Say exactly what you are waiting for; that message is what tells the watcher whether they can unblock you. Call start_action on the same step to resume.",
		Annotations: idempotent,
	}, h.BlockAction)

	addTool(server, logger, &mcp.Tool{
		Name:        "cancel_action",
		Description: "Mark a step you had already started and have now abandoned - typically because a person asked you to stop, or the work stopped being necessary. Use skip_action instead for a planned step you never began, and fail_action if something actually broke.",
		Annotations: idempotent,
	}, h.CancelAction)

	addTool(server, logger, &mcp.Tool{
		Name:        "check_instructions",
		Description: "Ask whether a person watching has asked you to stop or change course. Call this between steps. It is normally empty, and an empty answer means carry on. If it returns something, act on it and then call resolve_instruction.",
		Annotations: readOnly,
	}, h.CheckInstructions)

	addTool(server, logger, &mcp.Tool{
		Name:        "resolve_instruction",
		Description: "Report back on an instruction from check_instructions - whether you applied it or could not, and what you did. Until you call this, the person who asked cannot tell whether you honoured it.",
		Annotations: idempotent,
	}, h.ResolveInstruction)

	addTool(server, logger, &mcp.Tool{
		Name:        "attach_artifact",
		Description: "Attach a link or a short text result to a step, so it shows up beside the node. For binary files, upload through the storage API first and pass the resulting url here.",
		Annotations: idempotent,
	}, h.AttachArtifact)

	addTool(server, logger, &mcp.Tool{
		Name:        "health",
		Description: "Check whether Donald itself is reachable and its database is up. Call this when a tool call fails with a transport error, to tell 'Donald is down, retry later' apart from 'my run is broken'. Never abandon a run on a single failed call without checking here first.",
		Annotations: readOnly,
	}, h.Health)

	addTool(server, logger, &mcp.Tool{
		Name:        "get_graph",
		Description: "List the steps in this run with their keys and statuses. Use it if you have lost track of the node_keys you invented earlier.",
		Annotations: readOnly,
	}, h.GetGraph)

	// Demo pacing is opt-in and absent from the tool list entirely when off, so a
	// production agent never sees a tool it should not have and cannot build a
	// dependency on one that will vanish.
	if demoPacingEnabled() {
		addTool(server, logger, &mcp.Tool{
			Name:        "wait",
			Description: "DEMO ONLY. Pause for a few seconds so the flow unfolds at a realistic pace and a person watching has time to react. Use it between steps and inside long ones, matching the durations in the scenario you were given. Do not use it to fake work in a real run.",
			Annotations: readOnly,
		}, h.Wait)
	}

	return server
}
