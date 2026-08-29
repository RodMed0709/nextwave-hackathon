package mcp

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/gofrs/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nextwave/donald/core/module/artifact"
	artifact_types "github.com/nextwave/donald/core/module/artifact/types"
	payload_entity "github.com/nextwave/donald/entity/agent_event_payload"
	artifact_entity "github.com/nextwave/donald/entity/artifact"
	"github.com/nextwave/donald/enums"
)

// ─────────────────────────────────────────────
// Tool: attach_artifact
// ─────────────────────────────────────────────

type AttachArtifactParams struct {
	RunKey  string `json:"run_key" jsonschema:"The run_key you passed to start_run"`
	NodeKey string `json:"node_key,omitempty" jsonschema:"The action that produced it. Omit for a result belonging to the run as a whole."`
	Name    string `json:"name" jsonschema:"Display name, e.g. 'invoice-summary.csv'"`
	Type    string `json:"type,omitempty" jsonschema:"One of: link (default), image, file, text, structured_data"`
	URL     string `json:"url,omitempty" jsonschema:"Link to the artifact. Use this for anything already hosted somewhere reachable."`
	Text    string `json:"text,omitempty" jsonschema:"Inline content, for a small text or JSON result. Keep it short - this is displayed in a panel, not a file viewer."`
}

// AttachArtifact records a link or a small inline result. Binary uploads do NOT
// go through this tool: pushing file bytes through an MCP tool call would put
// the whole payload in the agent's context on the way out. The generated storage
// endpoints handle the upload, and this records the reference.
func (h *Handler) AttachArtifact(ctx context.Context, req *mcp.CallToolRequest, args AttachArtifactParams) (*mcp.CallToolResult, any, error) {
	run, err := h.resolveRun(ctx, args.RunKey)
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(args.Name) == "" {
		return nil, nil, fmt.Errorf("name is required")
	}
	if strings.TrimSpace(args.URL) == "" && strings.TrimSpace(args.Text) == "" {
		return nil, nil, fmt.Errorf("give either url or text - an artifact with neither has nothing to show")
	}

	var nodeUUID *uuid.UUID
	nodeKey := ""
	if strings.TrimSpace(args.NodeKey) != "" {
		node, err := h.resolveNode(ctx, run.UUID, args.NodeKey)
		if err != nil {
			return nil, nil, err
		}
		nodeUUID = &node.UUID
		nodeKey = node.NodeKey
	}

	artifactType := enums.ArtifactTypeFromString(strings.TrimSpace(args.Type))
	if artifactType == enums.ARTIFACT_TYPE_INVALID {
		if args.Text != "" {
			artifactType = enums.ARTIFACT_TYPE_TEXT
		} else {
			artifactType = enums.ARTIFACT_TYPE_LINK
		}
	}

	id, err := uuid.NewV4()
	if err != nil {
		return nil, nil, err
	}

	seq, rev, err := h.commit(ctx, mutation{
		runUUID:        run.UUID,
		eventType:      enums.AGENT_EVENT_TYPE_ARTIFACT_ADDED,
		nodeUUID:       nodeUUID,
		idempotencyKey: fmt.Sprintf("artifact:%s:%s:%s", run.RunKey, nodeKey, args.Name),
		payload: payload_entity.AgentEventPayload{
			ArtifactUUID: &id,
			Message:      nullString(args.Name),
		},
		apply: func(ctx context.Context, tx *sql.Tx) error {
			_, err := h.core.Artifact().Insert(ctx, artifact_types.UpsertRequest{
				Artifact: artifact_entity.Artifact{
					UUID:         id,
					RunUUID:      run.UUID,
					NodeUUID:     nodeUUID,
					Name:         args.Name,
					ArtifactType: artifactType,
					URL:          nullString(args.URL),
					TextContent:  nullString(args.Text),
					Status:       enums.ARTIFACT_STATUS_ACTIVE,
					CreatedBy:    serviceIdentity,
					UpdatedBy:    serviceIdentity,
				},
			}, artifact.WithSQLTransaction(tx))
			return err
		},
	})
	if err != nil {
		return nil, nil, err
	}

	return jsonResult(result{OK: true, RunKey: run.RunKey, NodeKey: nodeKey, Sequence: seq, GraphRevision: rev})
}
