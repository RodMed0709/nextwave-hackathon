package mcp

import (
	"testing"

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
	newServer(NewHandler(nil, nil, zap.NewNop()), zap.NewNop())

	want := []string{
		"start_run", "declare_actions", "add_action", "add_dependency",
		"start_action", "report_progress", "complete_action", "fail_action",
		"skip_action", "check_instructions", "resolve_instruction",
		"attach_artifact", "get_graph",
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
