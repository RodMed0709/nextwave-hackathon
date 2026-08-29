// Package mcp is the Donald MCP server: the surface the client's agents call to
// describe and update the flow they are running.
//
// It mounts INTO the generated API process (see app/rest.go) rather than running
// as its own service, for one load-bearing reason: appending an agent_event and
// bumping agent_run.last_event_sequence must happen in a single database
// transaction, or the sequence the web UI relies on to detect missed messages
// develops holes and duplicates. Only in-process access to core.Implementation
// gives us that transaction. Co-location also lets a tool call hand a delta
// straight to the SSE broadcaster through a channel instead of a message bus.
package mcp

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"

	"github.com/gofrs/uuid"
	"go.uber.org/zap"

	"github.com/nextwave/donald/core"
	"github.com/nextwave/donald/core/module/agent_node"
	agent_node_types "github.com/nextwave/donald/core/module/agent_node/types"
	"github.com/nextwave/donald/core/module/agent_run"
	agent_run_types "github.com/nextwave/donald/core/module/agent_run/types"
	"github.com/nextwave/donald/core/module/client"
	client_types "github.com/nextwave/donald/core/module/client/types"
	agent_node_entity "github.com/nextwave/donald/entity/agent_node"
	agent_run_entity "github.com/nextwave/donald/entity/agent_run"
	client_entity "github.com/nextwave/donald/entity/client"
	"github.com/nextwave/donald/enums"
)

// serviceIdentity fills created_by/updated_by on every row an agent causes us to
// write. The schema requires those columns and there is no authenticated user
// behind an agent report, so they carry a fixed service uuid rather than a
// person's. Rows raised by a human in the web UI carry that person's uuid in
// intervention.requested_by_uuid instead.
var serviceIdentity = uuid.Must(uuid.FromString("00000000-0000-4000-8000-00000000d012"))

// demoClientUUID is the tenant every run lands under while auth is disabled.
// agent_run.client_uuid is required and multi-tenant by design, but nothing
// authenticates an agent yet, so there is no tenant to derive. Set
// DONALD_CLIENT_UUID to point runs at a real client row; otherwise the row below
// is created on demand so a demo works with no setup.
//
// This is the single place where "no auth for now" is load-bearing. When auth
// arrives, the tenant comes from the caller's token and this constant and
// ensureClient both go away.
var demoClientUUID = uuid.Must(uuid.FromString("00000000-0000-4000-8000-00000000c11e"))

// Handler holds everything a tool needs: the generated data layer and the
// broadcaster that pushes deltas to subscribed browsers.
type Handler struct {
	core   *core.Implementation
	bus    *Broadcaster
	logger *zap.Logger
}

func NewHandler(coreImpl *core.Implementation, bus *Broadcaster, logger *zap.Logger) *Handler {
	return &Handler{core: coreImpl, bus: bus, logger: logger}
}

func (h *Handler) clientUUID() uuid.UUID {
	if v := strings.TrimSpace(os.Getenv("DONALD_CLIENT_UUID")); v != "" {
		if parsed, err := uuid.FromString(v); err == nil {
			return parsed
		}
		h.logger.Warn("DONALD_CLIENT_UUID is not a valid uuid; falling back to the demo tenant")
	}
	return demoClientUUID
}

// resolveRun turns the agent-supplied run_key into a run row.
//
// Reads skip the module cache. The generated modules cache for 30s, which is
// right for a REST read path and wrong here: an agent calls start_action and
// complete_action seconds apart, and a stale run would hand back a stale
// sequence.
func (h *Handler) resolveRun(ctx context.Context, runKey string) (agent_run_entity.AgentRun, error) {
	runKey = strings.TrimSpace(runKey)
	if runKey == "" {
		return agent_run_entity.AgentRun{}, fmt.Errorf("run_key is required")
	}
	res, err := h.core.AgentRun().FetchAgentRunByClientUUIDAndRunKey(ctx,
		agent_run_types.FetchAgentRunByClientUUIDAndRunKeyRequest{
			ClientUUID: h.clientUUID(),
			RunKey:     runKey,
			Limit:      1,
		}, agent_run.WithSkipCache())
	if err != nil {
		return agent_run_entity.AgentRun{}, retryable(err, "looking up the run")
	}
	if len(res.Results) == 0 {
		return agent_run_entity.AgentRun{}, fmt.Errorf(
			"no run with run_key %q — call start_run first (run keys are per client and case-sensitive)", runKey)
	}
	return res.Results[0], nil
}

// resolveNode turns (run, node_key) into a node row. The error names the key the
// agent used, because the common failure is an agent inventing a slightly
// different slug on a later call than the one it declared.
func (h *Handler) resolveNode(ctx context.Context, runUUID uuid.UUID, nodeKey string) (agent_node_entity.AgentNode, error) {
	nodeKey = strings.TrimSpace(nodeKey)
	if nodeKey == "" {
		return agent_node_entity.AgentNode{}, fmt.Errorf("node_key is required")
	}
	res, err := h.core.AgentNode().FetchAgentNodeByRunUUIDAndNodeKey(ctx,
		agent_node_types.FetchAgentNodeByRunUUIDAndNodeKeyRequest{
			RunUUID: runUUID,
			NodeKey: nodeKey,
			Limit:   1,
		}, agent_node.WithSkipCache())
	if err != nil {
		return agent_node_entity.AgentNode{}, retryable(err, "looking up the action")
	}
	if len(res.Results) == 0 {
		return agent_node_entity.AgentNode{}, fmt.Errorf(
			"no action with node_key %q in this run — add it with add_action, or call get_graph to see the keys that exist", nodeKey)
	}
	return res.Results[0], nil
}

// ensureClient creates the demo tenant row if it is missing, so a fresh database
// serves a demo without anyone seeding it. Only reached while DONALD_CLIENT_UUID
// is unset, and only from start_run.
func (h *Handler) ensureClient(ctx context.Context, tx *sql.Tx) error {
	id := h.clientUUID()
	existing, err := h.core.Client().FetchClientByUUID(ctx,
		client_types.FetchClientByUUIDRequest{UUID: id}, client.WithSkipCache())
	if err != nil {
		return err
	}
	if len(existing.Results) > 0 {
		return nil
	}
	_, err = h.core.Client().Insert(ctx, client_types.UpsertRequest{
		Client: client_entity.Client{
			UUID:      id,
			Name:      "Donald demo tenant",
			Status:    enums.CLIENT_STATUS_ACTIVE,
			CreatedBy: serviceIdentity,
			UpdatedBy: serviceIdentity,
		},
	}, client.WithSQLTransaction(tx))
	return err
}

func (h *Handler) updateRun(ctx context.Context, tx *sql.Tx, run agent_run_entity.AgentRun) error {
	run.UpdatedBy = serviceIdentity
	_, err := h.core.AgentRun().Update(ctx,
		agent_run_types.UpsertRequest{AgentRun: run}, agent_run.WithSQLTransaction(tx))
	return err
}

func (h *Handler) updateNode(ctx context.Context, tx *sql.Tx, node agent_node_entity.AgentNode) error {
	node.UpdatedBy = serviceIdentity
	_, err := h.core.AgentNode().Update(ctx,
		agent_node_types.UpsertRequest{AgentNode: node}, agent_node.WithSQLTransaction(tx))
	return err
}
