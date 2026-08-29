package mcp

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gofrs/uuid"

	"github.com/nextwave/donald/core/module/agent_run"
	agent_run_types "github.com/nextwave/donald/core/module/agent_run/types"
	"github.com/nextwave/donald/core/module/intervention"
	intervention_types "github.com/nextwave/donald/core/module/intervention/types"
	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
	agent_run_entity "github.com/nextwave/donald/entity/agent_run"
	intervention_entity "github.com/nextwave/donald/entity/intervention"
	"github.com/nextwave/donald/enums"
)

// Endpoints shaped to the web app's existing client (lib/donald/source.ts).
//
// The frontend already had a working contract — poll `agent_events` for
// everything after a cursor, POST `operator_instructions` to steer — written
// before this API existed. Serving that contract is additive here and needs zero
// changes over there, which matters while several people are editing that tree.
// The richer SSE stream at /v1/runs/{run_key}/stream remains available for when
// the client wants to stop polling.

// webEvent is lib/donald/types.ts DonaldEvent.
//
// agent_label and node_key are POINTERS with no omitempty on purpose: the
// client's isDonaldEvent() accepts `string | null` and rejects undefined, so
// omitting an absent field would fail validation for every run-level event.
type webEvent struct {
	Sequence       int64        `json:"sequence"`
	EventType      string       `json:"event_type"`
	OccurredAt     string       `json:"occurred_at"`
	AgentLabel     *string      `json:"agent_label"`
	NodeKey        *string      `json:"node_key"`
	IdempotencyKey string       `json:"idempotency_key"`
	Payload        deltaPayload `json:"payload"`
}

func toWebEvent(d Delta) webEvent {
	e := webEvent{
		Sequence:       d.Sequence,
		EventType:      d.EventType,
		OccurredAt:     d.OccurredAt.UTC().Format(time.RFC3339Nano),
		IdempotencyKey: d.IdempotencyKey,
		Payload:        d.Payload,
	}
	if d.AgentLabel != "" {
		v := d.AgentLabel
		e.AgentLabel = &v
	}
	if d.NodeKey != "" {
		v := d.NodeKey
		e.NodeKey = &v
	}
	return e
}

func (h *Handler) registerWebEvents(r chi.Router) {
	// Mounted at both paths because the client builds its URL by resolving
	// "agent_events" against NEXT_PUBLIC_DONALD_API, which may or may not carry
	// a /v1 prefix. Cheaper to answer both than to constrain how the app is
	// configured. Note the UNDERSCORE: the generated CRUD owns /v1/agent-events.
	for _, base := range []string{"", "/v1"} {
		r.Get(base+"/agent_events", h.webAgentEvents)
		r.Post(base+"/operator_instructions", h.webOperatorInstruction)
	}
}

// webAgentEvents serves everything after a cursor for one run.
func (h *Handler) webAgentEvents(w http.ResponseWriter, r *http.Request) {
	run, err := h.resolveRunFlexible(r.Context(), r.URL.Query().Get("run_uuid"))
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}

	after := int64(0)
	if raw := r.URL.Query().Get("sequence_gt"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "sequence_gt must be an integer")
			return
		}
		after = parsed
	}

	deltas, err := deltasAfter(r.Context(), h.core.DB(), run.UUID, after)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not read events")
		return
	}
	events := make([]webEvent, 0, len(deltas))
	for _, d := range deltas {
		events = append(events, toWebEvent(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"events":        events,
		"run_key":       run.RunKey,
		"last_sequence": run.LastEventSequence,
	})
}

type operatorInstructionRequest struct {
	RunUUID         string `json:"run_uuid"`
	NodeKey         string `json:"node_key"`
	Instruction     string `json:"instruction"`
	OptionID        string `json:"option_id"`
	CurrentSequence int64  `json:"current_sequence"`
}

// webOperatorInstruction is the steer button.
//
// It returns the resulting event so the caller can apply it locally without
// waiting for its next poll — which is what makes the UI feel immediate. The
// event it returns is the same one the poll would deliver, with the same
// sequence, so applying it twice is a no-op: the client dedupes on
// idempotency_key.
func (h *Handler) webOperatorInstruction(w http.ResponseWriter, r *http.Request) {
	var req operatorInstructionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "body must be JSON")
		return
	}
	if strings.TrimSpace(req.Instruction) == "" {
		writeJSONError(w, http.StatusBadRequest, "instruction is required")
		return
	}

	run, err := h.resolveRunFlexible(r.Context(), req.RunUUID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}
	node, err := h.resolveNode(r.Context(), run.UUID, req.NodeKey)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}

	id, err := uuid.NewV4()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not mint an id")
		return
	}
	prompt := req.Instruction
	if strings.TrimSpace(req.OptionID) != "" {
		// The option the operator picked is part of the instruction, not
		// metadata: the agent reads the prompt and nothing else.
		prompt = req.Instruction + " (chose: " + req.OptionID + ")"
	}

	// One transaction: the intervention row and the event that announces it.
	seq, rev, err := h.commit(r.Context(), mutation{
		runUUID:        run.UUID,
		eventType:      enums.AGENT_EVENT_TYPE_INTERVENTION_REQUESTED,
		nodeUUID:       &node.UUID,
		idempotencyKey: "intervention_requested:" + id.String(),
		payload: payload_entity.AgentEventPayload{
			InterventionUUID: &id,
			Message:          nullString(prompt),
			Detail: detailJSON(map[string]string{
				"type":      enums.InterventionType(enums.INTERVENTION_TYPE_STEER).String(),
				"prompt":    prompt,
				"option_id": req.OptionID,
			}),
		},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			_, err := h.core.Intervention().Insert(ctx, intervention_types.UpsertRequest{
				Intervention: intervention_entity.Intervention{
					UUID: id, RunUUID: run.UUID, NodeUUID: node.UUID,
					Type: enums.INTERVENTION_TYPE_STEER, Prompt: nullString(prompt),
					Status:          enums.INTERVENTION_STATUS_REGISTERED,
					RequestedByUUID: serviceIdentity,
					CreatedBy:       serviceIdentity, UpdatedBy: serviceIdentity,
				},
			}, intervention.WithSQLTransaction(tx))
			return err
		},
	})
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = rev

	// Read the event back rather than synthesising it, so what the client applies
	// is byte-for-byte what its next poll would have delivered.
	deltas, err := deltasAfter(r.Context(), h.core.DB(), run.UUID, seq-1)
	if err != nil || len(deltas) == 0 {
		writeJSONError(w, http.StatusInternalServerError, "the instruction was recorded but could not be read back")
		return
	}
	writeJSON(w, http.StatusOK, toWebEvent(deltas[0]))
}

// resolveRunFlexible accepts a run_key or a run uuid.
//
// The client's parameter is named run_uuid but carries a run_key, because the
// key is what the rest of the system uses. Accepting either is one line and
// removes a whole class of confusing 404s.
func (h *Handler) resolveRunFlexible(ctx context.Context, ref string) (agent_run_entity.AgentRun, error) {
	ref = strings.TrimSpace(ref)
	if run, err := h.resolveRun(ctx, ref); err == nil {
		return run, nil
	}
	if id, err := uuid.FromString(ref); err == nil {
		res, err := h.core.AgentRun().FetchAgentRunByUUID(ctx,
			agent_run_types.FetchAgentRunByUUIDRequest{UUID: id}, agent_run.WithSkipCache())
		if err == nil && len(res.Results) > 0 {
			return res.Results[0], nil
		}
	}
	return h.resolveRun(ctx, ref)
}
