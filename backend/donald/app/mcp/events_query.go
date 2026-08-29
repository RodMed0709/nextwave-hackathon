package mcp

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/gofrs/uuid"

	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
	"github.com/nextwave/donald/enums"
)

// deltasAfter reads a run's events after a cursor, newest last.
//
// It is the single place events become Deltas, used by both the SSE replay (a
// client catching up on connect) and the tailer (a client being kept current).
// Those are the same operation at different cadences, and having one
// implementation is what makes a reconnect indistinguishable from a live update.
//
// The (run_uuid, sequence) unique index serves this directly.
func deltasAfter(ctx context.Context, db *sql.DB, runUUID uuid.UUID, after int64) ([]Delta, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT e.`sequence`, e.`event_type`, e.`node_uuid`, e.`occurred_at`, e.`payload`, r.`graph_revision` "+
			"FROM `agent_event` e JOIN `agent_run` r ON r.`uuid` = e.`run_uuid` "+
			"WHERE e.`run_uuid` = ? AND e.`sequence` > ? ORDER BY e.`sequence`",
		runUUID.String(), after)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Delta
	for rows.Next() {
		var (
			seq       int64
			eventType int64
			nodeUUID  sql.NullString
			occurred  time.Time
			raw       []byte
			graphRev  int64
		)
		if err := rows.Scan(&seq, &eventType, &nodeUUID, &occurred, &raw, &graphRev); err != nil {
			return nil, err
		}

		d := Delta{
			Sequence:      seq,
			GraphRevision: graphRev,
			EventType:     enums.AgentEventType(eventType).String(),
			OccurredAt:    occurred,
		}
		if nodeUUID.Valid {
			if parsed, err := uuid.FromString(nodeUUID.String); err == nil {
				d.NodeUUID = &parsed
			}
		}
		if len(raw) > 0 {
			// A payload that will not decode is not worth dropping the whole
			// delta for: the event type and sequence still tell the client what
			// changed and keep its cursor moving.
			var p payload_entity.AgentEventPayload
			if err := json.Unmarshal(raw, &p); err == nil {
				d.Payload = p
			}
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
