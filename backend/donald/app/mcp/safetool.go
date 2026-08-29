package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"
)

// addTool registers a tool exactly like mcp.AddTool, but wraps the handler so a
// panic becomes a failed tool call instead of a crashed process.
//
// This matters more here than in a standalone MCP server. The SDK dispatches
// each request in its own goroutine with no recover(), so a panic unwinds to the
// top of that goroutine and takes the process down — and this process is also
// serving the REST API and holding every open SSE stream. One malformed report
// from one agent would otherwise blank every browser watching every run.
func addTool[In, Out any](s *mcp.Server, logger *zap.Logger, t *mcp.Tool, h mcp.ToolHandlerFor[In, Out]) {
	registered = append(registered, t)
	mcp.AddTool(s, t, timeTool(logger, t.Name, recoverTool(logger, t.Name, h)))
}

// registered records every tool passed to addTool, so a test can assert over the
// whole surface. The SDK's Server exposes no way to enumerate its tools, and the
// annotations are load-bearing — clients gate calls on them.
var registered []*mcp.Tool

func timeTool[In, Out any](logger *zap.Logger, name string, next mcp.ToolHandlerFor[In, Out]) mcp.ToolHandlerFor[In, Out] {
	return func(ctx context.Context, req *mcp.CallToolRequest, in In) (*mcp.CallToolResult, Out, error) {
		start := time.Now()
		res, out, err := next(ctx, req, in)
		took := time.Since(start).Round(time.Millisecond)
		switch {
		case err != nil:
			logger.Warn("mcp tool failed", zap.String("tool", name), zap.Duration("took", took), zap.Error(err))
		case res != nil && res.IsError:
			logger.Warn("mcp tool returned an error result", zap.String("tool", name), zap.Duration("took", took))
		default:
			logger.Debug("mcp tool ok", zap.String("tool", name), zap.Duration("took", took))
		}
		return res, out, err
	}
}

func recoverTool[In, Out any](logger *zap.Logger, name string, next mcp.ToolHandlerFor[In, Out]) mcp.ToolHandlerFor[In, Out] {
	return func(ctx context.Context, req *mcp.CallToolRequest, in In) (res *mcp.CallToolResult, out Out, err error) {
		defer func() {
			if r := recover(); r != nil {
				logger.Error("PANIC in mcp tool",
					zap.String("tool", name), zap.Any("panic", r), zap.ByteString("stack", debug.Stack()))
				var zero Out
				out = zero
				// Reported through the result, not as a transport error, so the
				// agent sees a failed call rather than a broken session.
				err = nil
				res = &mcp.CallToolResult{
					IsError: true,
					Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("internal error in tool %q", name)}},
				}
			}
		}()
		return next(ctx, req, in)
	}
}

// jsonResult renders a tool's small acknowledgement as the text content MCP
// clients expect.
func jsonResult(v any) (*mcp.CallToolResult, any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, nil, err
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(b)}},
	}, nil, nil
}
