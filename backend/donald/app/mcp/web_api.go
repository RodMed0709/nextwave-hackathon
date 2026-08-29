package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gofrs/uuid"

	"github.com/nextwave/donald/core/module/intervention"
	intervention_types "github.com/nextwave/donald/core/module/intervention/types"
	intervention_entity "github.com/nextwave/donald/entity/intervention"
	"github.com/nextwave/donald/enums"
)

// The web app's own endpoints.
//
// The generated CRUD can technically serve all of this, but not in a shape a UI
// wants: it addresses runs by uuid while every other part of this system
// addresses them by run_key, it needs an AIP filter expression to scope nodes to
// a run, and raising an intervention through it means the browser hand-assembling
// numeric enums, a tenant uuid and audit columns. These three endpoints exist so
// the front end deals in the same vocabulary the agents do.

type webRunSummary struct {
	RunKey        string  `json:"run_key"`
	Name          string  `json:"name,omitempty"`
	Status        string  `json:"status"`
	Summary       string  `json:"summary,omitempty"`
	GraphRevision int64   `json:"graph_revision"`
	LastSequence  int64   `json:"last_sequence"`
	StartedAt     *string `json:"started_at,omitempty"`
	FinishedAt    *string `json:"finished_at,omitempty"`
}

func (h *Handler) registerWebAPI(r chi.Router) {
	r.Get("/v1/runs", h.listRuns)
	r.Get("/v1/runs/{run_key}", h.getRun)
	r.Post("/v1/runs/{run_key}/interventions", h.raiseIntervention)
}

// listRuns backs the run picker: newest first, no filter expression required.
func (h *Handler) listRuns(w http.ResponseWriter, r *http.Request) {
	rows, err := h.core.DB().QueryContext(r.Context(),
		"SELECT `run_key`, COALESCE(`name`,''), `status`, COALESCE(`display_summary`,''), "+
			"`graph_revision`, `last_event_sequence`, `started_at`, `finished_at` "+
			"FROM `agent_run` WHERE `client_uuid` = ? ORDER BY `created_at` DESC LIMIT 50",
		h.clientUUID().String())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not list runs")
		return
	}
	defer func() { _ = rows.Close() }()

	out := []webRunSummary{}
	for rows.Next() {
		var (
			s                     webRunSummary
			status                int64
			startedAt, finishedAt *time.Time
		)
		if err := rows.Scan(&s.RunKey, &s.Name, &status, &s.Summary,
			&s.GraphRevision, &s.LastSequence, &startedAt, &finishedAt); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "could not read runs")
			return
		}
		s.Status = enums.AgentRunStatus(status).String()
		s.StartedAt, s.FinishedAt = rfc3339(startedAt), rfc3339(finishedAt)
		out = append(out, s)
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": out})
}

// getRun is the snapshot a client loads before subscribing to the stream.
//
// It returns last_sequence deliberately: that is the cursor to pass to
// /v1/runs/{run_key}/stream?after=N so the client picks up exactly where the
// snapshot ends, with no gap and no duplicates.
func (h *Handler) getRun(w http.ResponseWriter, r *http.Request) {
	run, err := h.resolveRun(r.Context(), chi.URLParam(r, "run_key"))
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}

	nodes, err := h.nodesForRun(r.Context(), run.UUID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not read the graph")
		return
	}
	type webNode struct {
		NodeKey    string `json:"node_key"`
		Label      string `json:"label"`
		AgentLabel string `json:"agent_label,omitempty"`
		Status     string `json:"status"`
		PlanOrder  *int64 `json:"plan_order,omitempty"`
	}
	outNodes := make([]webNode, 0, len(nodes))
	for _, n := range nodes {
		wn := webNode{NodeKey: n.NodeKey, Label: n.Name, Status: n.Status.String()}
		if n.PlanOrder.Valid {
			v := n.PlanOrder.Int64
			wn.PlanOrder = &v
		}
		outNodes = append(outNodes, wn)
	}

	edges, err := h.edgesForRun(r.Context(), run.UUID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not read the edges")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"run": webRunSummary{
			RunKey: run.RunKey, Name: run.Name.String, Status: run.Status.String(),
			Summary: run.DisplaySummary.String, GraphRevision: run.GraphRevision,
			LastSequence: run.LastEventSequence,
		},
		"nodes": outNodes,
		"edges": edges,
	})
}

type webEdge struct {
	EdgeKey       string `json:"edge_key"`
	SourceNodeKey string `json:"source_node_key"`
	TargetNodeKey string `json:"target_node_key"`
	Status        string `json:"status"`
}

func (h *Handler) edgesForRun(ctx context.Context, runUUID uuid.UUID) ([]webEdge, error) {
	rows, err := h.core.DB().QueryContext(ctx,
		"SELECT f.`node_key`, t.`node_key`, e.`status` FROM `agent_edge` e "+
			"JOIN `agent_node` f ON f.`uuid` = e.`from_node_uuid` "+
			"JOIN `agent_node` t ON t.`uuid` = e.`to_node_uuid` "+
			"WHERE e.`run_uuid` = ?", runUUID.String())
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := []webEdge{}
	for rows.Next() {
		var from, to string
		var status int64
		if err := rows.Scan(&from, &to, &status); err != nil {
			return nil, err
		}
		out = append(out, webEdge{
			EdgeKey: from + "->" + to, SourceNodeKey: from, TargetNodeKey: to,
			Status: enums.AgentEdgeStatus(status).String(),
		})
	}
	return out, rows.Err()
}

type raiseInterventionRequest struct {
	Type    string `json:"type"`
	NodeKey string `json:"node_key"`
	Prompt  string `json:"prompt"`
	UserID  string `json:"user_id,omitempty"`
}

// raiseIntervention is the stop/steer button.
//
// The browser sends a type, a node_key and a sentence; everything else — tenant,
// audit columns, numeric enums, the uuid lookups — is resolved here. The agent
// picks it up on its next check_instructions, and every mutation ack it receives
// meanwhile carries pending_instructions, so it learns about this without polling.
func (h *Handler) raiseIntervention(w http.ResponseWriter, r *http.Request) {
	var req raiseInterventionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "body must be JSON")
		return
	}

	var kind enums.InterventionType
	switch strings.ToLower(strings.TrimSpace(req.Type)) {
	case "stop":
		kind = enums.INTERVENTION_TYPE_STOP
	case "steer":
		kind = enums.INTERVENTION_TYPE_STEER
	default:
		writeJSONError(w, http.StatusBadRequest, "type must be 'stop' or 'steer'")
		return
	}

	run, err := h.resolveRun(r.Context(), chi.URLParam(r, "run_key"))
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}

	// Interventions are node-scoped in the schema. A stop raised without naming
	// a node means "stop what you are doing", so target whatever is in flight.
	nodeKey := strings.TrimSpace(req.NodeKey)
	if nodeKey == "" {
		nodeKey, err = h.inFlightNodeKey(r.Context(), run.UUID)
		if err != nil || nodeKey == "" {
			writeJSONError(w, http.StatusConflict,
				"no action is currently running, so there is nothing to stop — name a node_key explicitly")
			return
		}
	}
	node, err := h.resolveNode(r.Context(), run.UUID, nodeKey)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}

	requester := serviceIdentity
	if parsed, err := uuid.FromString(strings.TrimSpace(req.UserID)); err == nil {
		requester = parsed
	}
	id, err := uuid.NewV4()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not mint an id")
		return
	}

	if _, err := h.core.Intervention().Insert(r.Context(), intervention_types.UpsertRequest{
		Intervention: intervention_entity.Intervention{
			UUID: id, RunUUID: run.UUID, NodeUUID: node.UUID,
			Type: kind, Prompt: nullString(req.Prompt),
			Status:          enums.INTERVENTION_STATUS_REGISTERED,
			RequestedByUUID: requester,
			CreatedBy:       requester, UpdatedBy: requester,
		},
	}, intervention.WithSkipCache()); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not record the request")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "type": kind.String(), "node_key": node.NodeKey,
		"note": "the agent will pick this up on its next check; it is advisory, not a kill switch",
	})
}

func (h *Handler) inFlightNodeKey(ctx context.Context, runUUID uuid.UUID) (string, error) {
	var key string
	err := h.core.DB().QueryRowContext(ctx,
		"SELECT `node_key` FROM `agent_node` WHERE `run_uuid` = ? AND `status` = ? ORDER BY `started_at` DESC LIMIT 1",
		runUUID.String(), enums.AGENT_NODE_STATUS_IN_PROGRESS).Scan(&key)
	return key, err
}

func rfc3339(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeJSONError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, code, map[string]string{"error": message})
}
