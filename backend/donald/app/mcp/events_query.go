package mcp

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/guregu/null/v6"

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
	// The node is LEFT JOINed because run-level events (run_started, plan_declared,
	// run_finished) legitimately have no node.
	rows, err := db.QueryContext(ctx,
		"SELECT e.`sequence`, e.`event_type`, e.`node_uuid`, e.`occurred_at`, e.`payload`, e.`idempotency_key`, "+
			"r.`graph_revision`, COALESCE(r.`name`, ''), COALESCE(r.`display_summary`, ''), "+
			"n.`node_key`, n.`name`, n.`agent_label`, n.`planned`, n.`plan_order`, "+
			"n.`started_at`, n.`finished_at`, n.`input_summary`, n.`output_summary`, "+
			"n.`description`, n.`node_type`, n.`tool_name`, n.`status_message`, "+
			"n.`error_message`, n.`progress_percent` "+
			"FROM `agent_event` e "+
			"JOIN `agent_run` r ON r.`uuid` = e.`run_uuid` "+
			"LEFT JOIN `agent_node` n ON n.`uuid` = e.`node_uuid` "+
			"WHERE e.`run_uuid` = ? AND e.`sequence` > ? ORDER BY e.`sequence`",
		runUUID.String(), after)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Delta
	for rows.Next() {
		var (
			seq        int64
			eventType  int64
			nodeUUID   sql.NullString
			occurred   time.Time
			raw        []byte
			idemKey    string
			graphRev   int64
			runName    string
			runSummary string
			nodeKey    sql.NullString
			nodeName   sql.NullString
			agentLabel sql.NullString
			planned    sql.NullBool
			planOrder  null.Int64
			startedAt  null.Time
			finishedAt null.Time
			inputSum   null.String
			outputSum  null.String
			descr      null.String
			nodeType   null.Int64
			toolName   null.String
			statusMsg  null.String
			errorMsg   null.String
			nodeProg   null.Int64
		)
		if err := rows.Scan(&seq, &eventType, &nodeUUID, &occurred, &raw, &idemKey, &graphRev,
			&runName, &runSummary,
			&nodeKey, &nodeName, &agentLabel, &planned, &planOrder,
			&startedAt, &finishedAt, &inputSum, &outputSum,
			&descr, &nodeType, &toolName, &statusMsg, &errorMsg, &nodeProg); err != nil {
			return nil, err
		}

		d := Delta{
			Sequence:       seq,
			GraphRevision:  graphRev,
			EventType:      enums.AgentEventType(eventType).String(),
			OccurredAt:     occurred,
			NodeKey:        nodeKey.String,
			AgentLabel:     agentLabel.String,
			IdempotencyKey: idemKey,
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
				d.Payload = deltaPayload{
					PreviousStatus:   p.PreviousStatus,
					NewStatus:        p.NewStatus,
					Message:          p.Message,
					ProgressPercent:  p.ProgressPercent,
					EdgeUUID:         p.EdgeUUID,
					ArtifactUUID:     p.ArtifactUUID,
					InterventionUUID: p.InterventionUUID,
					Detail:           p.Detail,
				}
			}
		}
		// detail carries the type-specific extras the stored payload has no
		// columns for: edge endpoints, the declared plan, and the human time a
		// completed step stood in for. Lifting them into named fields means a
		// client never has to parse a nested JSON string.
		if d.Payload.Detail.Valid {
			var extra map[string]json.RawMessage
			if err := json.Unmarshal([]byte(d.Payload.Detail.String), &extra); err == nil {
				assign := func(key string, dst *string) {
					if raw, ok := extra[key]; ok {
						_ = json.Unmarshal(raw, dst)
					}
				}
				// The numeric counterpart. It writes through a pointer-to-pointer
				// so a key that is absent, or present but not a number, leaves the
				// field nil rather than reporting a confident zero — "this step
				// saved 0 minutes" is a claim, and not one the agent made.
				assignInt := func(key string, dst **int64) {
					raw, ok := extra[key]
					if !ok {
						return
					}
					var n int64
					if err := json.Unmarshal(raw, &n); err != nil {
						return
					}
					*dst = &n
				}
				assign("edge_key", &d.Payload.EdgeKey)
				assign("source_node_key", &d.Payload.SourceNodeKey)
				assign("target_node_key", &d.Payload.TargetNodeKey)
				assign("origin", &d.Payload.Origin)
				// Replayed, never recalculated: this is the number the agent
				// reported when the step completed, and it must read the same on
				// the hundredth open of the card as on the first.
				assignInt("manual_minutes", &d.Payload.ManualMinutes)
				if raw, ok := extra["steps"]; ok {
					d.Payload.Plan = &planWire{}
					_ = json.Unmarshal(raw, &d.Payload.Plan.Steps)
					if e, ok := extra["edges"]; ok {
						_ = json.Unmarshal(e, &d.Payload.Plan.Edges)
					}
				}
			}
		}
		d.Payload.RunName = runName
		d.Payload.RunSummary = runSummary
		if d.Payload.NewStatus != enums.AGENT_NODE_STATUS_INVALID {
			d.Payload.Status = d.Payload.NewStatus.String()
		}
		if nodeKey.Valid {
			d.Payload.Label = nodeName.String
			if planned.Valid {
				v := planned.Bool
				d.Payload.Planned = &v
			}
			d.Payload.PlanOrder = planOrder
			d.Payload.StartedAt = startedAt
			d.Payload.FinishedAt = finishedAt
			d.Payload.InputSummary = inputSum
			d.Payload.OutputSummary = outputSum
			d.Payload.Description = descr
			d.Payload.ToolName = toolName
			d.Payload.StatusMessage = statusMsg
			d.Payload.ErrorMessage = errorMsg
			d.Payload.NodeProgress = nodeProg
			if nodeType.Valid {
				if t := enums.AgentNodeType(nodeType.Int64); t != enums.AGENT_NODE_TYPE_INVALID {
					d.Payload.NodeType = t.String()
				}
			}
			if startedAt.Valid && finishedAt.Valid {
				secs := int64(finishedAt.Time.Sub(startedAt.Time).Seconds())
				d.Payload.ActualSeconds = &secs
			}
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := enrichInterventions(ctx, db, out); err != nil {
		return nil, err
	}
	if err := enrichArtifacts(ctx, db, out); err != nil {
		return nil, err
	}
	return out, nil
}

// enrichInterventions attaches the type and prompt to the stop/steer events, so
// a client can render what was asked without a second request.
func enrichInterventions(ctx context.Context, db *sql.DB, deltas []Delta) error {
	want := map[string][]int{}
	for i, d := range deltas {
		if d.Payload.InterventionUUID != nil {
			k := d.Payload.InterventionUUID.String()
			want[k] = append(want[k], i)
		}
	}
	if len(want) == 0 {
		return nil
	}

	ids := make([]any, 0, len(want))
	for k := range want {
		ids = append(ids, k)
	}
	rows, err := db.QueryContext(ctx,
		"SELECT `uuid`, `type`, COALESCE(`prompt`, ''), `status` FROM `intervention` "+
			"WHERE `uuid` IN (?"+strings.Repeat(",?", len(ids)-1)+")", ids...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var id, prompt string
		var typ, status int64
		if err := rows.Scan(&id, &typ, &prompt, &status); err != nil {
			return err
		}
		for _, i := range want[id] {
			deltas[i].Payload.Type = enums.InterventionType(typ).String()
			deltas[i].Payload.Prompt = prompt
			deltas[i].Payload.InterventionID = id
			deltas[i].Payload.InterventionStatus = enums.InterventionStatus(status).String()
		}
	}
	return rows.Err()
}

// enrichArtifacts attaches the name, type and content to artifact_added.
//
// The stored payload holds only the artifact uuid, which is unusable on its own:
// the client has no way to resolve it and no endpoint to resolve it against, so
// every piece of evidence an agent attached arrived as an event with nothing in
// it. The UI has been able to render evidence blocks all along and never had the
// data to fill one.
//
// text_content is truncated here rather than at the client: this rides the live
// stream to every open browser, and an agent that inlines a large document
// should not be able to make the stream expensive for everyone watching.
func enrichArtifacts(ctx context.Context, db *sql.DB, deltas []Delta) error {
	want := map[string][]int{}
	for i, d := range deltas {
		if d.Payload.ArtifactUUID != nil {
			k := d.Payload.ArtifactUUID.String()
			want[k] = append(want[k], i)
		}
	}
	if len(want) == 0 {
		return nil
	}

	ids := make([]any, 0, len(want))
	for k := range want {
		ids = append(ids, k)
	}
	rows, err := db.QueryContext(ctx,
		"SELECT `uuid`, `name`, `artifact_type`, COALESCE(`url`, ''), COALESCE(`text_content`, '') "+
			"FROM `artifact` WHERE `uuid` IN (?"+strings.Repeat(",?", len(ids)-1)+")", ids...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var id, name, url, text string
		var typ int64
		if err := rows.Scan(&id, &name, &typ, &url, &text); err != nil {
			return err
		}
		if len(text) > artifactTextLimit {
			text = text[:artifactTextLimit] + "\n… (truncated)"
		}
		for _, i := range want[id] {
			deltas[i].Payload.ArtifactName = name
			deltas[i].Payload.ArtifactType = enums.ArtifactType(typ).String()
			deltas[i].Payload.ArtifactURL = url
			deltas[i].Payload.ArtifactText = text
		}
	}
	return rows.Err()
}

// artifactTextLimit is how much inline artifact text rides the live stream.
// Generous enough for an email or a small table, short of a document dump.
const artifactTextLimit = 4000
