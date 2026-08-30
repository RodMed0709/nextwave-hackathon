package mcp

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/nextwave/donald/enums"
)

// stubModel stands in for OpenAI. Every test here runs against it or against the
// no-key short circuit: a test that reached the real API would need a secret to
// pass, and a secret in this repository is the one thing that must never be
// here.
type stubModel struct {
	reply string
	err   error
	calls int
}

func (s *stubModel) complete(context.Context, string, string) (string, error) {
	s.calls++
	return s.reply, s.err
}

func withProvider(t *testing.T, m suggestionModel) {
	t.Helper()
	previous := suggestionProvider
	suggestionProvider = m
	t.Cleanup(func() { suggestionProvider = previous })
}

func testContextData() suggestionContextData {
	return suggestionContextData{
		RunName:    "Nightly freight reconciliation",
		RunStatus:  "in_progress",
		NodeKey:    "reconcile_totals",
		NodeName:   "Reconcile totals",
		NodeStatus: "blocked_on_missing_data",
	}
}

// TestFallbackWhenNoAPIKeyConfigured is the demo-safety property: Donald is
// deployed without a key more often than with one, and the panel must still fill.
//
// It exercises the real OpenAI provider deliberately. The key check has to come
// before the request is built, or a keyless deployment spends six seconds per
// click discovering a 401.
func TestFallbackWhenNoAPIKeyConfigured(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")
	withProvider(t, openAIModel{})

	h := NewHandler(nil, nil, zap.NewNop())
	got, source := h.suggest(context.Background(), testContextData(), enums.AGENT_NODE_STATUS_BLOCKED_ON_MISSING_DATA)

	if source != suggestionSourceFallback {
		t.Fatalf("source is %q, want %q — a keyless deployment must not claim the model wrote these", source, suggestionSourceFallback)
	}
	if len(got) != suggestionCount {
		t.Fatalf("got %d suggestions, want %d", len(got), suggestionCount)
	}
	for i, s := range got {
		if strings.TrimSpace(s.Label) == "" || strings.TrimSpace(s.Prompt) == "" {
			t.Errorf("suggestion %d is half-empty: %+v", i, s)
		}
	}
	// A blocked step is the case an operator actually needs help with, so the
	// static set for it must offer a way out rather than generic advice.
	if want := fallbackSuggestions(enums.AGENT_NODE_STATUS_BLOCKED_ON_MISSING_DATA); got[0] != want[0] {
		t.Errorf("blocked node got %+v, want the blocked fallback set %+v", got[0], want[0])
	}
}

// TestModelReplyParsesAndIsCapped covers the two things the model controls and
// we do not: how many suggestions it returns and how long the captions are.
func TestModelReplyParsesAndIsCapped(t *testing.T) {
	reply := `{"suggestions":[
		{"label":"Re-pull the Maersk manifest","prompt":"Re-pull the Maersk manifest for booking 4471002 and reconcile it against the invoice totals."},
		{"label":"Check the container count","prompt":"Confirm the container count on the packing list matches the 18 units the previous step reported."},
		{"label":"Hold before invoicing","prompt":"Hold the run before the invoicing step until I confirm the corrected totals."},
		{"label":"A fourth the panel has no room for","prompt":"Do something else entirely."},
		{"label":"","prompt":""}
	]}`
	withProvider(t, &stubModel{reply: reply})

	h := NewHandler(nil, nil, zap.NewNop())
	got, source := h.suggest(context.Background(), testContextData(), enums.AGENT_NODE_STATUS_IN_PROGRESS)

	if source != suggestionSourceLLM {
		t.Fatalf("source is %q, want %q", source, suggestionSourceLLM)
	}
	if len(got) != suggestionCount {
		t.Fatalf("got %d suggestions, want at most %d", len(got), suggestionCount)
	}
	if got[0].Prompt != "Re-pull the Maersk manifest for booking 4471002 and reconcile it against the invoice totals." {
		t.Errorf("the first prompt did not survive the parse: %q", got[0].Prompt)
	}
	for _, s := range got {
		if n := len([]rune(s.Label)); n > suggestionLabelLimit {
			t.Errorf("label %q is %d runes; the chip caps at %d", s.Label, n, suggestionLabelLimit)
		}
	}
}

// TestLabelFallsBackToPromptAndIsTrimmed: a model that fills only prompt still
// has to render, and the caption it borrows must fit the chip.
func TestLabelFallsBackToPromptAndIsTrimmed(t *testing.T) {
	long := "Re-pull every carrier manifest for the week of the 14th and reconcile them line by line."
	got, err := parseSuggestions(fmt.Sprintf(`{"suggestions":[{"prompt":%q}]}`, long))
	if err != nil {
		t.Fatalf("a suggestion with only a prompt must parse, got %v", err)
	}
	if got[0].Prompt != long {
		t.Errorf("the prompt was altered: %q", got[0].Prompt)
	}
	if n := len([]rune(got[0].Label)); n > suggestionLabelLimit {
		t.Errorf("borrowed label is %d runes, want at most %d", n, suggestionLabelLimit)
	}
}

// TestMalformedReplyDegrades is the one that keeps a live demo alive. Every
// shape below has been seen from a chat model asked for JSON, and none of them
// may reach the operator as an error.
func TestMalformedReplyDegrades(t *testing.T) {
	for name, reply := range map[string]string{
		"prose":            "Sure! Here are three ideas for you.",
		"fenced":           "```json\n{\"suggestions\":[]}\n```",
		"empty array":      `{"suggestions":[]}`,
		"wrong shape":      `{"suggestions":{"label":"x"}}`,
		"blank entries":    `{"suggestions":[{"label":"x","prompt":"   "}]}`,
		"empty completion": "",
	} {
		t.Run(name, func(t *testing.T) {
			withProvider(t, &stubModel{reply: reply})
			h := NewHandler(nil, nil, zap.NewNop())
			got, source := h.suggest(context.Background(), testContextData(), enums.AGENT_NODE_STATUS_FAILED)
			if source != suggestionSourceFallback {
				t.Fatalf("source is %q, want %q", source, suggestionSourceFallback)
			}
			if len(got) != suggestionCount {
				t.Fatalf("got %d suggestions, want the %d-strong fallback set", len(got), suggestionCount)
			}
		})
	}
}

// TestModelErrorDegrades covers the timeout and the API error, which arrive at
// the handler identically: as an error from the provider.
func TestModelErrorDegrades(t *testing.T) {
	withProvider(t, &stubModel{err: context.DeadlineExceeded})
	h := NewHandler(nil, nil, zap.NewNop())
	if _, source := h.suggest(context.Background(), testContextData(), enums.AGENT_NODE_STATUS_BLOCKED_ON_USER_DECISION); source != suggestionSourceFallback {
		t.Fatalf("a timed-out model call gave source %q, want %q", source, suggestionSourceFallback)
	}
}

// TestCacheIsKeyedOnGraphState pins the product property: a card reopened while
// nothing has happened shows the same three chips, and shows new ones as soon as
// the run moves.
func TestCacheIsKeyedOnGraphState(t *testing.T) {
	node := "11111111-1111-4111-8111-111111111111"
	first := []Suggestion{{Label: "one", Prompt: "one"}}
	storeSuggestions(suggestionCacheKey{nodeUUID: node, sequence: 7}, first)

	got, ok := cachedSuggestions(suggestionCacheKey{nodeUUID: node, sequence: 7})
	if !ok || len(got) != 1 || got[0].Prompt != "one" {
		t.Fatalf("reopening the same card at the same sequence did not hit the cache: %+v (ok=%v)", got, ok)
	}
	// Mutating what the cache handed back must not rewrite what the next reader
	// gets; the entry is shared across every browser watching the run.
	got[0].Prompt = "tampered"
	if again, _ := cachedSuggestions(suggestionCacheKey{nodeUUID: node, sequence: 7}); again[0].Prompt != "one" {
		t.Error("the cache handed out its own slice; one caller can now rewrite everyone's suggestions")
	}
	if _, ok := cachedSuggestions(suggestionCacheKey{nodeUUID: node, sequence: 8}); ok {
		t.Error("an advanced sequence must miss the cache, or the chips go stale as the run moves")
	}
}

// TestCacheIsBounded guards against the obvious leak: this map lives for the
// life of the process and every distinct graph state adds an entry.
func TestCacheIsBounded(t *testing.T) {
	for i := range suggestionCacheCapacity * 2 {
		storeSuggestions(suggestionCacheKey{nodeUUID: "bounded", sequence: int64(i)},
			[]Suggestion{{Label: "x", Prompt: "x"}})
	}
	suggestionCache.mu.Lock()
	entries, order := len(suggestionCache.entries), len(suggestionCache.order)
	suggestionCache.mu.Unlock()
	if entries > suggestionCacheCapacity || order > suggestionCacheCapacity {
		t.Fatalf("cache holds %d entries (%d ordered), cap is %d", entries, order, suggestionCacheCapacity)
	}
}

// TestUserPromptOmitsEmptyFields: blank lines are latency on a click and they
// describe a run that does not exist.
func TestUserPromptOmitsEmptyFields(t *testing.T) {
	sc := testContextData()
	sc.Predecessors = []suggestionNeighbour{{NodeKey: "fetch_invoices", Name: "Fetch invoices", Status: "succeeded"}}
	sc.SuccessorKeys = []string{"publish_report"}
	prompt := sc.userPrompt()

	for _, absent := range []string{"error:", "output so far:", "instruction already outstanding"} {
		if strings.Contains(prompt, absent) {
			t.Errorf("prompt carries an empty %q line:\n%s", absent, prompt)
		}
	}
	for _, present := range []string{"reconcile_totals", "blocked_on_missing_data", "fetch_invoices", "publish_report"} {
		if !strings.Contains(prompt, present) {
			t.Errorf("prompt is missing %q, so the model cannot be specific about it:\n%s", present, prompt)
		}
	}
}

// TestSummariesAreTruncated keeps one verbose node from making every click slow.
func TestSummariesAreTruncated(t *testing.T) {
	got := truncateForPrompt(strings.Repeat("a", suggestionSummaryLimit*3))
	if n := len([]rune(got)); n > suggestionSummaryLimit {
		t.Fatalf("summary is %d runes after truncation, want at most %d", n, suggestionSummaryLimit)
	}
}
