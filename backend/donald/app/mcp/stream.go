package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gofrs/uuid"
)

// streamHandler is the browser's half of the system: an SSE stream of graph
// deltas for one run.
//
// It lives in this package rather than beside the other REST routes because it
// needs the same two things the tools need — run resolution and the in-process
// broadcaster — and neither is worth exporting just to move this file.
//
// The client contract:
//
//	GET /v1/runs/{run_key}/stream?after=<sequence>
//
// The UI first loads a snapshot (the generated CRUD endpoints), reads
// graph_revision and last_event_sequence off the run, then connects here with
// after=<last_event_sequence>. Everything newer is replayed, then live deltas
// follow. If the UI ever sees a sequence that is not exactly one more than the
// last it applied, it has missed something: reconnect with the last good
// sequence, or reload the snapshot.
func (h *Handler) streamHandler(w http.ResponseWriter, r *http.Request) {
	runKey := chi.URLParam(r, "run_key")
	run, err := h.resolveRun(r.Context(), runKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	after := int64(0)
	if v := r.URL.Query().Get("after"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			http.Error(w, "after must be an integer sequence number", http.StatusBadRequest)
			return
		}
		after = parsed
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Nginx and friends buffer proxied responses by default, which holds every
	// delta until the buffer fills — the stream looks dead, then arrives in a
	// lump. This header is what turns that off at the ingress.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Subscribe BEFORE replaying history. The other order has a hole in it:
	// anything committed between the end of the replay query and the
	// subscription would reach neither, and the client would sit on a permanent
	// sequence gap.
	deltas, release := h.bus.Subscribe(run.UUID, after)
	defer release()

	highest, err := h.replay(r.Context(), run.UUID, after, w, flusher)
	if err != nil {
		h.logger.Warn("replay failed; the client will resync from its snapshot")
		return
	}

	// A heartbeat keeps intermediaries from culling an idle stream, and lets the
	// browser notice a dead connection during a long-running step that reports
	// nothing.
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return

		case d, ok := <-deltas:
			if !ok {
				return
			}
			// Replay and the live channel overlap by design (see the subscribe
			// ordering above), so drop anything already sent.
			if d.Sequence <= highest {
				continue
			}
			if err := writeSSE(w, flusher, d); err != nil {
				return
			}
			highest = d.Sequence

		case <-ticker.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// replay sends every event after the client's cursor and returns the highest
// sequence written.
func (h *Handler) replay(ctx context.Context, runUUID uuid.UUID, after int64, w http.ResponseWriter, flusher http.Flusher) (int64, error) {
	deltas, err := deltasAfter(ctx, h.core.DB(), runUUID, after)
	if err != nil {
		return after, err
	}
	highest := after
	for _, d := range deltas {
		if err := writeSSE(w, flusher, d); err != nil {
			return highest, err
		}
		highest = d.Sequence
	}
	return highest, nil
}

// writeSSE frames one delta. The SSE id is the sequence number, so a browser
// reconnecting with Last-Event-ID hands back exactly the cursor this protocol
// is built around.
func writeSSE(w http.ResponseWriter, flusher http.Flusher, d Delta) error {
	body, err := json.Marshal(d)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", d.Sequence, d.EventType, body); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}
