package mcp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ─────────────────────────────────────────────
// Tool: health
// ─────────────────────────────────────────────

type HealthParams struct{}

type HealthResult struct {
	OK              bool   `json:"ok"`
	ProtocolVersion string `json:"protocol_version"`
	Database        string `json:"database"`
	ServerTime      string `json:"server_time"`
	Note            string `json:"note,omitempty"`
}

// Health answers the question an agent cannot otherwise answer during an
// outage: is Donald down, or is my run broken?
//
// Without it, both look identical — a transport error on whatever tool the agent
// happened to call next. An agent that cannot tell them apart either abandons a
// perfectly good run or keeps hammering a dead server. This says which, and it
// touches the database so a reachable server with an unreachable database
// reports unhealthy rather than cheerfully OK.
func (h *Handler) Health(ctx context.Context, req *mcp.CallToolRequest, _ HealthParams) (*mcp.CallToolResult, any, error) {
	res := HealthResult{
		OK:              true,
		ProtocolVersion: ProtocolVersion,
		Database:        "reachable",
		ServerTime:      time.Now().UTC().Format(time.RFC3339),
	}

	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := h.core.DB().PingContext(pingCtx); err != nil {
		res.OK = false
		res.Database = "unreachable"
		res.Note = "the server is up but its database is not; reporting will fail until this clears — retry rather than abandoning the run"
	}
	return jsonResult(res)
}

// transient classifies an error as worth retrying, so a tool failure can tell an
// agent whether to back off or give up.
//
// The distinction matters because the two failures demand opposite behaviour: a
// dropped database connection should be retried with the same idempotency key
// and will converge, while a malformed node_key will fail identically forever.
// Reported as one generic error, an agent has to guess, and it guesses wrong in
// whichever direction is worse.
func transient(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	return errors.Is(err, context.DeadlineExceeded)
}

// retryable wraps an error with the structured hint an agent needs. The text is
// what an MCP client surfaces, so the code and the advice have to live in it.
func retryable(err error, what string) error {
	if err == nil {
		return nil
	}
	if transient(err) {
		return fmt.Errorf("code=provider_unavailable retryable=true retry_after_seconds=5 — %s failed transiently: %w. Retry the same call; it carries an idempotency key and will not double-apply", what, err)
	}
	return fmt.Errorf("code=invalid_request retryable=false — %s failed: %w", what, err)
}
