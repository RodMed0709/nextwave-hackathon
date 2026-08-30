package mcp

import (
	"context"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// maxWaitSeconds caps a single wait call.
//
// The ceiling exists for a protocol reason, not a policy one: MCP clients
// commonly abandon a tool call after 60s, and a request held longer than that
// comes back as a client-side timeout with the agent unsure whether the call
// landed. Chaining several short waits with report_progress between them is also
// simply a better demo — the graph keeps moving instead of sitting silent.
//
// It was 30, which made a full scenario run long enough that people stopped
// watching. 12 is still far more than the reaction time an intervention needs.
const maxWaitSeconds = 12

// defaultWaitScale shrinks every requested wait.
//
// The scenario briefs ask for durations in the units a person would narrate — a
// carrier taking 30 seconds to answer — and rewriting seven of them to make a
// demo shorter would lose that. Scaling here keeps the briefs readable and puts
// the pace of the whole demo behind one number that can be turned at the last
// minute without a redeploy of anything but an env var:
//
//	DONALD_WAIT_SCALE=1     run the briefs at their written durations
//	DONALD_WAIT_SCALE=0.25  a very fast walkthrough
//
// A scaled wait never rounds to nothing: one second is the floor, because a wait
// of zero silently removes the interruption window the tool exists to create.
const defaultWaitScale = 0.4

func waitScale() float64 {
	raw := strings.TrimSpace(os.Getenv("DONALD_WAIT_SCALE"))
	if raw == "" {
		return defaultWaitScale
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil || parsed <= 0 || parsed > 1 {
		return defaultWaitScale
	}
	return parsed
}

// demoPacingEnabled reports whether the wait tool should exist at all.
//
// It is ON by default while Donald is pre-production: the demo comes first, and
// a demo that silently runs too fast to interrupt is the failure that actually
// costs something today. Turn it off explicitly:
//
//	DONALD_DEMO_PACING=false   (also 0, no, off)
//
// Invert this default before Donald carries real traffic. Pacing is scaffolding:
// a real agent has genuine work taking genuine time and must never be able to
// park a request on the server. Startup logs a warning whenever it is on, so a
// production deploy that forgets is visible in the first lines of the pod log
// rather than discovered later.
func demoPacingEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("DONALD_DEMO_PACING"))) {
	case "0", "false", "no", "off":
		return false
	}
	return true
}

type WaitParams struct {
	Seconds int64  `json:"seconds" jsonschema:"How long to wait, in seconds. Ask for the duration the work would really take; the server scales it down for the demo and caps a single call at 12s. For a longer pause call this several times with a report_progress between them so the graph keeps moving."`
	Reason  string `json:"reason,omitempty" jsonschema:"What you are doing during the wait, e.g. 'reconciling against ERP'. Recorded in the server log only; it does not appear on the graph - use report_progress for that."`
}

type WaitResult struct {
	WaitedSeconds int64  `json:"waited_seconds"`
	Note          string `json:"note,omitempty"`
}

// Wait sleeps server-side so a demo run unfolds at a believable pace.
//
// This exists because the thing it fixes is not cosmetic. A run whose steps
// complete instantly cannot be interrupted, so stop and steer become decorative
// and the intervention half of the product is impossible to show. An LLM has no
// internal clock and cannot pace itself; in some hosts it cannot even shell out
// to sleep. Somewhere has to hold real wall-clock time, and the server is the
// only place that reliably can.
//
// It deliberately writes NOTHING to the graph: no event, no status change, no
// sequence bump. Waiting is not something that happened to the run, and a
// replayed run should look identical whether or not it was paced.
func (h *Handler) Wait(ctx context.Context, req *mcp.CallToolRequest, args WaitParams) (*mcp.CallToolResult, any, error) {
	if args.Seconds <= 0 {
		return nil, nil, fmt.Errorf("seconds must be greater than 0")
	}

	requested := args.Seconds
	seconds := int64(math.Round(float64(requested) * waitScale()))
	if seconds < 1 {
		seconds = 1
	}
	note := ""
	if seconds > maxWaitSeconds {
		seconds = maxWaitSeconds
		note = fmt.Sprintf("capped at %ds — call wait again for a longer pause, ideally with a report_progress between", maxWaitSeconds)
	}
	if seconds != requested && note == "" {
		note = fmt.Sprintf("waited %ds of the %ds you asked for; demo pacing is scaled down", seconds, requested)
	}

	select {
	case <-time.After(time.Duration(seconds) * time.Second):
		return jsonResult(WaitResult{WaitedSeconds: seconds, Note: note})
	case <-ctx.Done():
		// The client gave up or the run was interrupted. Report what actually
		// elapsed rather than claiming the full wait.
		return nil, nil, ctx.Err()
	}
}
