package mcp

import (
	"strings"
	"testing"

	"github.com/nextwave/donald/enums"

	"go.uber.org/zap"
)

// TestToolSurface builds the real server. Registration is where the SDK derives
// each tool's JSON schema from its params struct, so this catches a malformed
// jsonschema tag or an unsupported field type — which would otherwise surface as
// a panic on the first request in production.
//
// The handler's dependencies are nil because no tool is invoked here; only
// registration is exercised.
func TestToolSurface(t *testing.T) {
	// Assert the production shape: pacing explicitly off.
	t.Setenv("DONALD_DEMO_PACING", "false")
	newServer(NewHandler(nil, nil, zap.NewNop()), zap.NewNop())

	want := []string{
		"start_run", "declare_actions", "add_action", "add_dependency",
		"start_action", "report_progress", "complete_action", "fail_action",
		"skip_action", "cancel_action", "block_action", "check_instructions", "resolve_instruction",
		"attach_artifact", "get_graph", "finish_run",
	}
	if len(registered) != len(want) {
		t.Fatalf("registered %d tools, want %d", len(registered), len(want))
	}

	byName := map[string]bool{}
	for _, tool := range registered {
		byName[tool.Name] = true

		if tool.Description == "" {
			t.Errorf("%s has no description; an agent picks tools by description", tool.Name)
		}
		// Annotations are load-bearing: destructiveHint DEFAULTS TO TRUE when a
		// tool omits them, and clients gate calls on that. Every tool here is a
		// reporting call and none of them destroy anything.
		if tool.Annotations == nil {
			t.Errorf("%s has no annotations, so it advertises itself as destructive", tool.Name)
			continue
		}
		if d := tool.Annotations.DestructiveHint; d != nil && *d {
			t.Errorf("%s is marked destructive", tool.Name)
		}
	}
	for _, name := range want {
		if !byName[name] {
			t.Errorf("tool %q was not registered", name)
		}
	}
}

// TestRoleFromEnv covers the fallback that decides what a pod serves.
func TestRoleFromEnv(t *testing.T) {
	for _, tc := range []struct {
		env  string
		want Role
	}{
		{"", RoleAll},
		{"api", RoleAPI},
		{"MCP", RoleMCP},
		{"nonsense", RoleAll}, // serving too much beats serving nothing
	} {
		t.Setenv("DONALD_ROLE", tc.env)
		if got := RoleFromEnv(zap.NewNop()); got != tc.want {
			t.Errorf("DONALD_ROLE=%q gave %q, want %q", tc.env, got, tc.want)
		}
	}
}

// TestTransitionKeyDistinguishesRetry guards a bug that shipped and was caught by
// walking the state machine: the idempotency key was (tool, run, node), so an
// agent that started a step, failed it, then retried had its retry SWALLOWED —
// commit() saw the recorded key, short-circuited, and returned success while the
// node stayed failed.
//
// Retry is a normal path. The previous status is what separates a real second
// transition from a duplicate send.
func TestTransitionKeyDistinguishesRetry(t *testing.T) {
	firstStart := transitionKey("start", "run1", "fetch", enums.AGENT_NODE_STATUS_NOT_STARTED)
	retryStart := transitionKey("start", "run1", "fetch", enums.AGENT_NODE_STATUS_FAILED)
	if firstStart == retryStart {
		t.Fatalf("a retry after failure must not reuse the first start's key; both were %q", firstStart)
	}

	// A genuine duplicate — the same call sent twice from the same state — must
	// still deduplicate, or every retransmit becomes a second event.
	if transitionKey("start", "run1", "fetch", enums.AGENT_NODE_STATUS_NOT_STARTED) != firstStart {
		t.Error("the same transition from the same state must produce a stable key")
	}

	// Resuming a blocked step is also a second start and must get through.
	resume := transitionKey("start", "run1", "fetch", enums.AGENT_NODE_STATUS_BLOCKED_ON_USER_DECISION)
	if resume == firstStart {
		t.Error("resuming a blocked step must not reuse the first start's key")
	}

	// Different nodes and different runs must never collide.
	if transitionKey("start", "run1", "fetch", 0) == transitionKey("start", "run2", "fetch", 0) {
		t.Error("keys must be scoped to the run")
	}
}

// TestRunStatusFor covers the mapping that makes the schema's run-level
// blocked_on_* statuses reachable at all.
func TestRunStatusFor(t *testing.T) {
	if got, ok := runStatusFor(enums.AGENT_NODE_STATUS_IN_PROGRESS, enums.AGENT_NODE_STATUS_BLOCKED_ON_MISSING_DATA); !ok || got != enums.AGENT_RUN_STATUS_BLOCKED_ON_MISSING_DATA {
		t.Errorf("blocking a step must block the run, got %v (ok=%v)", got, ok)
	}
	if got, ok := runStatusFor(enums.AGENT_NODE_STATUS_BLOCKED_ON_USER_DECISION, enums.AGENT_NODE_STATUS_IN_PROGRESS); !ok || got != enums.AGENT_RUN_STATUS_IN_PROGRESS {
		t.Errorf("resuming a blocked step must unblock the run, got %v (ok=%v)", got, ok)
	}
	// A failed step does NOT fail the run - the agent may recover or carry on.
	// Only finish_run decides the run's outcome.
	if _, ok := runStatusFor(enums.AGENT_NODE_STATUS_IN_PROGRESS, enums.AGENT_NODE_STATUS_FAILED); ok {
		t.Error("one failed step must not change the run status")
	}
}

// TestDemoPacingDefaultsOnAndCanBeDisabled pins both halves of the switch.
//
// Pacing is ON by default while Donald is pre-production — the demo matters more
// than the production risk today — so the property worth protecting is that the
// OFF switch genuinely works and is not silently ignored. Flip the expectation
// here when the default flips.
func TestDemoPacingDefaultsOnAndCanBeDisabled(t *testing.T) {
	for _, off := range []string{"false", "0", "no", "off", "FALSE", "Off"} {
		t.Setenv("DONALD_DEMO_PACING", off)
		newServer(NewHandler(nil, nil, zap.NewNop()), zap.NewNop())
		for _, tool := range registered {
			if tool.Name == "wait" {
				t.Fatalf("DONALD_DEMO_PACING=%q did NOT disable the wait tool; the off switch is broken", off)
			}
		}
		// "Pace yourself" is the section heading; matching on the bare word
		// "wait" would false-positive on the base instructions, which talk about
		// being stuck waiting on data.
		if strings.Contains(serverInstructions(), "Pace yourself") {
			t.Errorf("DONALD_DEMO_PACING=%q disabled the tool but still advertises pacing", off)
		}
	}

	// Unset means on, and so does anything that is not a recognised negative.
	for _, on := range []string{"", "1", "true", "TRUE", "yes", "on", "nonsense"} {
		t.Setenv("DONALD_DEMO_PACING", on)
		newServer(NewHandler(nil, nil, zap.NewNop()), zap.NewNop())
		found := false
		for _, tool := range registered {
			if tool.Name == "wait" {
				found = true
			}
		}
		if !found {
			t.Errorf("DONALD_DEMO_PACING=%q should leave pacing ON but the wait tool was absent", on)
		}
		if !strings.Contains(serverInstructions(), "Pace yourself") {
			t.Errorf("DONALD_DEMO_PACING=%q did not add the pacing instructions", on)
		}
	}
}

// documentedTools is the contract as the skill and the Nauta briefs state it —
// every tool an agent is told to call.
//
// It is written from the DOCUMENTATION, deliberately, not from the registration
// code. That distinction is the whole point of this test: finish_run shipped
// implemented, documented and unregistered, and the existing surface test did
// not catch it because its expected list had been copied from the same
// registration block that was missing the tool. A test that reads the code it is
// testing agrees with the code's bugs.
var documentedTools = []string{
	"start_run", "declare_actions", "finish_run",
	"add_action", "add_dependency",
	"start_action", "report_progress",
	"complete_action", "fail_action", "skip_action", "cancel_action", "block_action",
	"check_instructions", "resolve_instruction",
	"attach_artifact", "get_graph",
}

func TestEveryDocumentedToolIsRegistered(t *testing.T) {
	t.Setenv("DONALD_DEMO_PACING", "false")
	newServer(NewHandler(nil, nil, zap.NewNop()), zap.NewNop())

	got := map[string]bool{}
	for _, tool := range registered {
		got[tool.Name] = true
	}
	for _, name := range documentedTools {
		if !got[name] {
			t.Errorf("tool %q is documented for agents but NOT registered — agents will be told to call a tool that does not exist", name)
		}
	}
	// The reverse: a registered tool nobody documented is dead weight in every
	// agent's context.
	documented := map[string]bool{}
	for _, n := range documentedTools {
		documented[n] = true
	}
	for _, tool := range registered {
		if !documented[tool.Name] {
			t.Errorf("tool %q is registered but not in the documented contract — document it or remove it", tool.Name)
		}
	}
}
