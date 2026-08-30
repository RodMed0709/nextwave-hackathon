package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gofrs/uuid"
	"go.uber.org/zap"

	agent_node_entity "github.com/nextwave/donald/entity/agent_node"
	agent_run_entity "github.com/nextwave/donald/entity/agent_run"
	"github.com/nextwave/donald/enums"
)

// Suggested instructions for the box an operator steers a step from.
//
// An empty textarea in front of a stalled graph is where this surface stops
// helping: the person can see something is wrong and still has to compose the
// sentence that fixes it. Three chips written from THIS run's own wording — the
// documents it named, the step that fed this one, the reason it blocked — turn
// that into a click. Generic chips ("check your work") would be worse than none,
// which is why the whole run context below is assembled before asking.
//
// The client requires OpenAI, so that is what ships; the call sits behind
// suggestionModel so swapping the provider is one assignment.

const (
	suggestionCount = 3
	// Enough for a sentence of context per field, short enough that a run with
	// forty nodes still produces a prompt that answers inside the timeout.
	suggestionSummaryLimit = 300
	// The label is a chip caption in a narrow panel, not a sentence.
	suggestionLabelLimit = 40
	// Neighbour lists are capped because a fan-in of thirty says no more about
	// what to instruct than the first handful does.
	suggestionNeighbourLimit = 6
	// This is on the critical path of a click. Six seconds is past the p99 of a
	// small completion and still short of the point where the panel feels broken.
	suggestionTimeout        = 6 * time.Second
	defaultSuggestionModel   = "gpt-4o-mini"
	openAIChatCompletionsURL = "https://api.openai.com/v1/chat/completions"
	openAIResponseBodyLimit  = 1 << 20
	suggestionCacheCapacity  = 256
	suggestionSourceLLM      = "llm"
	suggestionSourceFallback = "fallback"
)

// Suggestion is one chip: a caption to render and the text that lands in the
// textarea when it is clicked.
type Suggestion struct {
	Label  string `json:"label"`
	Prompt string `json:"prompt"`
}

type suggestionsResponse struct {
	Suggestions []Suggestion `json:"suggestions"`
	// source is "llm" or "fallback". The wire contract also reserves "agent",
	// for suggestions an agent supplies itself when it raises a decision; the
	// intervention table has no column to carry those today, so nothing emits it
	// yet and clients must not depend on the set being only two values.
	Source string `json:"source"`
}

// suggestionModel is the seam between Donald and whatever writes the text.
//
// It exists so the tests can exercise the parsing and degradation paths with no
// network and no key, and so a second provider is a swap here rather than a
// change to the handler.
type suggestionModel interface {
	complete(ctx context.Context, system, user string) (string, error)
}

var suggestionProvider suggestionModel = openAIModel{}

// nodeSuggestions backs the chips above the steer box.
//
// It never fails the request. A missing key, a slow model or a reply that is not
// the JSON we asked for all land on the static set instead, because this is
// mounted in a surface someone is demoing live and an empty panel with a 500
// behind it is the one outcome worse than a generic suggestion.
func (h *Handler) nodeSuggestions(w http.ResponseWriter, r *http.Request) {
	run, err := h.resolveRun(r.Context(), chi.URLParam(r, "run_key"))
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}
	node, err := h.resolveNode(r.Context(), run.UUID, chi.URLParam(r, "node_key"))
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}

	// The cache key is the graph state, not the clock: reopening a card that
	// nothing has happened to must show the same three chips. Text that
	// reshuffles every time the panel opens reads as noise rather than advice,
	// and it bills a completion per click.
	key := suggestionCacheKey{nodeUUID: node.UUID.String(), sequence: run.LastEventSequence}
	if cached, ok := cachedSuggestions(key); ok {
		writeJSON(w, http.StatusOK, suggestionsResponse{Suggestions: cached, Source: suggestionSourceLLM})
		return
	}

	sc, err := h.suggestionContext(r.Context(), run, node)
	if err != nil {
		h.logger.Warn("falling back to static suggestions: could not assemble the run context",
			zap.String("run_key", run.RunKey), zap.String("node_key", node.NodeKey), zap.Error(err))
		writeJSON(w, http.StatusOK, suggestionsResponse{
			Suggestions: fallbackSuggestions(node.Status),
			Source:      suggestionSourceFallback,
		})
		return
	}

	out, source := h.suggest(r.Context(), sc, node.Status)
	if source == suggestionSourceLLM {
		// Only model answers are cached. The static set is derived from the
		// node's status and is therefore already stable without help, and
		// caching it would pin a node to fallback text for the rest of its graph
		// state after a single timeout.
		storeSuggestions(key, out)
	}
	writeJSON(w, http.StatusOK, suggestionsResponse{Suggestions: out, Source: source})
}

// suggest is everything between an assembled context and three chips: the model
// call, the parse, and every way both of those can go wrong.
//
// It is separate from the handler so that the degradation paths — no key, no
// answer, an answer that is not the JSON we asked for — are reachable in a test
// without a database or a network.
func (h *Handler) suggest(ctx context.Context, sc suggestionContextData, status enums.AgentNodeStatus) ([]Suggestion, string) {
	degrade := func(reason string, err error) ([]Suggestion, string) {
		h.logger.Warn("falling back to static suggestions: "+reason,
			zap.String("node_key", sc.NodeKey), zap.Error(err))
		return fallbackSuggestions(status), suggestionSourceFallback
	}

	ctx, cancel := context.WithTimeout(ctx, suggestionTimeout)
	defer cancel()
	raw, err := suggestionProvider.complete(ctx, suggestionSystemPrompt, sc.userPrompt())
	if err != nil {
		return degrade("the model call did not return", err)
	}
	out, err := parseSuggestions(raw)
	if err != nil {
		return degrade("the model reply did not parse", err)
	}
	return out, suggestionSourceLLM
}

// suggestionNeighbour is a predecessor as the model sees it: what ran before
// this step and what it produced.
type suggestionNeighbour struct {
	NodeKey       string
	Name          string
	Status        string
	OutputSummary string
}

type suggestionContextData struct {
	RunName    string
	RunSummary string
	RunStatus  string

	NodeKey       string
	NodeName      string
	Description   string
	AgentLabel    string
	NodeStatus    string
	StatusMessage string
	ErrorMessage  string
	InputSummary  string
	OutputSummary string

	// PendingPrompt is what somebody has already asked of this step. Repeating
	// an instruction that is already outstanding is the most obvious way for
	// these chips to look like they are not reading the run.
	PendingPrompt string

	Predecessors  []suggestionNeighbour
	SuccessorKeys []string
}

func (h *Handler) suggestionContext(ctx context.Context, run agent_run_entity.AgentRun, node agent_node_entity.AgentNode) (suggestionContextData, error) {
	sc := suggestionContextData{
		RunName:       run.Name.String,
		RunSummary:    truncateForPrompt(run.DisplaySummary.String),
		RunStatus:     run.Status.String(),
		NodeKey:       node.NodeKey,
		NodeName:      node.Name,
		Description:   truncateForPrompt(node.Description.String),
		AgentLabel:    node.AgentLabel.String,
		NodeStatus:    node.Status.String(),
		StatusMessage: truncateForPrompt(node.StatusMessage.String),
		ErrorMessage:  truncateForPrompt(node.ErrorMessage.String),
		InputSummary:  truncateForPrompt(node.InputSummary.String),
		OutputSummary: truncateForPrompt(node.OutputSummary.String),
	}

	// Predecessors are what makes a suggestion sound like it belongs to this
	// flow rather than to any flow: the operator's instruction usually points
	// back at the data the previous step handed over.
	rows, err := h.core.DB().QueryContext(ctx,
		"SELECT n.`node_key`, n.`name`, n.`status`, COALESCE(n.`output_summary`, '') "+
			"FROM `agent_edge` e JOIN `agent_node` n ON n.`uuid` = e.`from_node_uuid` "+
			"WHERE e.`run_uuid` = ? AND e.`to_node_uuid` = ? "+
			"ORDER BY n.`plan_order`, n.`created_at` LIMIT ?",
		run.UUID.String(), node.UUID.String(), suggestionNeighbourLimit)
	if err != nil {
		return sc, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var n suggestionNeighbour
		var status int64
		if err := rows.Scan(&n.NodeKey, &n.Name, &status, &n.OutputSummary); err != nil {
			return sc, err
		}
		n.Status = enums.AgentNodeStatus(status).String()
		n.OutputSummary = truncateForPrompt(n.OutputSummary)
		sc.Predecessors = append(sc.Predecessors, n)
	}
	if err := rows.Err(); err != nil {
		return sc, err
	}

	// Successors are keys only. What comes next tells the model whether holding
	// this step is expensive; the downstream detail does not change the advice.
	succRows, err := h.core.DB().QueryContext(ctx,
		"SELECT n.`node_key` FROM `agent_edge` e JOIN `agent_node` n ON n.`uuid` = e.`to_node_uuid` "+
			"WHERE e.`run_uuid` = ? AND e.`from_node_uuid` = ? "+
			"ORDER BY n.`plan_order`, n.`created_at` LIMIT ?",
		run.UUID.String(), node.UUID.String(), suggestionNeighbourLimit)
	if err != nil {
		return sc, err
	}
	defer func() { _ = succRows.Close() }()
	for succRows.Next() {
		var key string
		if err := succRows.Scan(&key); err != nil {
			return sc, err
		}
		sc.SuccessorKeys = append(sc.SuccessorKeys, key)
	}
	if err := succRows.Err(); err != nil {
		return sc, err
	}

	sc.PendingPrompt = h.pendingInterventionPrompt(ctx, node.UUID)
	return sc, nil
}

// pendingInterventionPrompt returns the text of an instruction still outstanding
// on this node, if any. A failure to read it is not worth losing the whole
// suggestion over — the context is simply a little poorer — so it returns a
// string rather than an error.
func (h *Handler) pendingInterventionPrompt(ctx context.Context, nodeUUID uuid.UUID) string {
	var prompt string
	err := h.core.DB().QueryRowContext(ctx,
		"SELECT COALESCE(`prompt`, '') FROM `intervention` WHERE `node_uuid` = ? AND `status` IN (?, ?) "+
			"ORDER BY `created_at` DESC LIMIT 1",
		nodeUUID.String(),
		enums.INTERVENTION_STATUS_REGISTERED,
		enums.INTERVENTION_STATUS_PICKED_UP_BY_AGENT).Scan(&prompt)
	if err != nil {
		return ""
	}
	return truncateForPrompt(prompt)
}

const suggestionSystemPrompt = `You write short instructions that a logistics operations supervisor would give an AI agent in the middle of a task it is running.

Rules:
- Imperative and concrete. Name the documents, steps, carriers, references and numbers that appear in the context.
- Never generic. "Check your work", "review the output" and "proceed carefully" are useless to an operator.
- Vary the intent across the three: typically one that redirects the work, one that adds a check or a constraint, and one that stops or holds it.
- If the step is blocked or failed, aim all three at getting it unblocked.
- label is a chip caption of at most 40 characters. prompt is the full instruction the supervisor would type, one or two sentences, addressed to the agent.

Reply with JSON only, in the form {"suggestions":[{"label":"...","prompt":"..."}]}, with exactly three entries.`

// userPrompt renders the context as compact lines. Empty fields are omitted
// rather than sent as blanks: a wall of "error: " tells the model the run has
// shapes it does not, and every omitted line is latency saved on a click.
func (sc suggestionContextData) userPrompt() string {
	var b strings.Builder
	line := func(label, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		fmt.Fprintf(&b, "%s: %s\n", label, value)
	}

	line("Run", sc.RunName)
	line("Run status", sc.RunStatus)
	line("Run summary", sc.RunSummary)

	b.WriteString("\nThe operator is looking at this step:\n")
	line("  key", sc.NodeKey)
	line("  name", sc.NodeName)
	line("  description", sc.Description)
	line("  agent", sc.AgentLabel)
	line("  status", sc.NodeStatus)
	line("  status note", sc.StatusMessage)
	line("  error", sc.ErrorMessage)
	line("  input", sc.InputSummary)
	line("  output so far", sc.OutputSummary)
	line("  instruction already outstanding on this step", sc.PendingPrompt)

	if len(sc.Predecessors) > 0 {
		b.WriteString("\nSteps that fed into it:\n")
		for _, p := range sc.Predecessors {
			fmt.Fprintf(&b, "  - %s (%s) [%s]", p.NodeKey, p.Name, p.Status)
			if p.OutputSummary != "" {
				fmt.Fprintf(&b, ": %s", p.OutputSummary)
			}
			b.WriteString("\n")
		}
	}
	if len(sc.SuccessorKeys) > 0 {
		fmt.Fprintf(&b, "\nSteps waiting on it: %s\n", strings.Join(sc.SuccessorKeys, ", "))
	}
	return b.String()
}

// parseSuggestions turns the model's reply into at most three usable chips.
//
// Everything about the reply is treated as untrusted: response_format asks for a
// JSON object but the count, the labels and the lengths are the model's choice,
// and a chip caption long enough to break the panel is as much a failure as no
// reply at all.
func parseSuggestions(raw string) ([]Suggestion, error) {
	var payload struct {
		Suggestions []Suggestion `json:"suggestions"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &payload); err != nil {
		return nil, err
	}
	out := make([]Suggestion, 0, suggestionCount)
	for _, s := range payload.Suggestions {
		label, prompt := strings.TrimSpace(s.Label), strings.TrimSpace(s.Prompt)
		if prompt == "" {
			continue
		}
		if label == "" {
			label = prompt
		}
		out = append(out, Suggestion{Label: truncateRunes(label, suggestionLabelLimit), Prompt: prompt})
		if len(out) == suggestionCount {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("the reply parsed but carried no usable suggestion")
	}
	return out, nil
}

// fallbackSuggestions is the static set, chosen by what the step is doing.
//
// It is deliberately plain and deliberately actionable: these are what an
// operator gets when the model is unavailable, and the three options an operator
// always has are redirect, verify, and hold.
func fallbackSuggestions(status enums.AgentNodeStatus) []Suggestion {
	switch {
	case isBlocked(status):
		return []Suggestion{
			{Label: "Skip this step and continue", Prompt: "Skip this step and continue with the rest of the run; note in the summary what was skipped and why."},
			{Label: "Try an alternative source", Prompt: "Try an alternative source for the data this step is waiting on, and tell me what you tried."},
			{Label: "Hold the run until I confirm", Prompt: "Hold the run here until I confirm how to proceed. Do not start any further steps."},
		}
	case status == enums.AGENT_NODE_STATUS_FAILED:
		return []Suggestion{
			{Label: "Retry this step once", Prompt: "Retry this step once, and if it fails the same way, stop and report the exact error."},
			{Label: "Work around the failure", Prompt: "Take a different approach to this step and explain what you changed before you run it."},
			{Label: "Stop the run here", Prompt: "Stop the run here and summarise what completed, what failed, and what is left."},
		}
	case status == enums.AGENT_NODE_STATUS_IN_PROGRESS:
		return []Suggestion{
			{Label: "Narrow the scope", Prompt: "Narrow this step to only what is needed for the next step, and tell me what you dropped."},
			{Label: "Show your evidence", Prompt: "Before completing this step, attach the source you are working from and the figures you derived."},
			{Label: "Pause after this step", Prompt: "Finish this step, then pause the run and wait for me before starting the next one."},
		}
	case status == enums.AGENT_NODE_STATUS_SUCCEEDED:
		return []Suggestion{
			{Label: "Double-check the output", Prompt: "Re-check this step's output against its source before the next step uses it, and flag any mismatch."},
			{Label: "Continue to the next step", Prompt: "Carry on to the next step and keep reporting as you go."},
			{Label: "Hold before the next step", Prompt: "Hold here and wait for my confirmation before starting the next step."},
		}
	default:
		return []Suggestion{
			{Label: "Start this step now", Prompt: "Start this step now and report what you find as you go."},
			{Label: "Confirm the inputs first", Prompt: "Confirm the inputs this step depends on are complete and current before you start it."},
			{Label: "Hold until I confirm", Prompt: "Do not start this step until I confirm. Continue with anything that does not depend on it."},
		}
	}
}

// --- the OpenAI call ---------------------------------------------------------

type openAIModel struct{}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIRequest struct {
	Model          string            `json:"model"`
	Messages       []openAIMessage   `json:"messages"`
	ResponseFormat map[string]string `json:"response_format"`
	Temperature    float64           `json:"temperature"`
}

type openAIResponse struct {
	Choices []struct {
		Message openAIMessage `json:"message"`
	} `json:"choices"`
}

// complete asks OpenAI for the JSON object and hands back its raw content.
//
// The key is read from the environment on every call and never stored on the
// struct, logged, or returned: this repository is public, and the only copy of
// the secret in the process should be the one the request header holds. Errors
// deliberately carry the HTTP status and nothing from the response body, which
// can echo request material back.
func (openAIModel) complete(ctx context.Context, system, user string) (string, error) {
	key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if key == "" {
		return "", fmt.Errorf("OPENAI_API_KEY is not set")
	}
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = defaultSuggestionModel
	}

	body, err := json.Marshal(openAIRequest{
		Model: model,
		Messages: []openAIMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		ResponseFormat: map[string]string{"type": "json_object"},
		// Low but not zero: three chips that differ from each other are the
		// point, and a deterministic decode tends to write the same sentence
		// three ways.
		Temperature: 0.4,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, openAIChatCompletionsURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("openai returned %s", resp.Status)
	}

	var decoded openAIResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, openAIResponseBodyLimit)).Decode(&decoded); err != nil {
		return "", err
	}
	if len(decoded.Choices) == 0 {
		return "", fmt.Errorf("openai returned no choices")
	}
	return decoded.Choices[0].Message.Content, nil
}

// --- cache -------------------------------------------------------------------

type suggestionCacheKey struct {
	nodeUUID string
	// sequence is the run's last_event_sequence: it changes exactly when
	// something the suggestions were written from changes.
	sequence int64
}

// The cache is process-local and bounded. It is a de-duplicator for a UI that
// opens and closes the same card, not a store — a restart or a second replica
// simply pays for one more completion.
var suggestionCache = struct {
	mu      sync.Mutex
	entries map[suggestionCacheKey][]Suggestion
	order   []suggestionCacheKey
}{entries: map[suggestionCacheKey][]Suggestion{}}

func cachedSuggestions(key suggestionCacheKey) ([]Suggestion, bool) {
	suggestionCache.mu.Lock()
	defer suggestionCache.mu.Unlock()
	got, ok := suggestionCache.entries[key]
	if !ok {
		return nil, false
	}
	// Handed out as a copy so a caller mutating the slice cannot rewrite what
	// the next reader sees.
	return append([]Suggestion(nil), got...), true
}

func storeSuggestions(key suggestionCacheKey, out []Suggestion) {
	suggestionCache.mu.Lock()
	defer suggestionCache.mu.Unlock()
	if _, exists := suggestionCache.entries[key]; !exists {
		// Oldest-first eviction. Entries are worthless the moment the run moves
		// on, so insertion order is a good enough proxy for usefulness and costs
		// nothing to maintain.
		for len(suggestionCache.order) >= suggestionCacheCapacity {
			oldest := suggestionCache.order[0]
			suggestionCache.order = suggestionCache.order[1:]
			delete(suggestionCache.entries, oldest)
		}
		suggestionCache.order = append(suggestionCache.order, key)
	}
	suggestionCache.entries[key] = append([]Suggestion(nil), out...)
}

// --- helpers -----------------------------------------------------------------

func truncateForPrompt(s string) string {
	return truncateRunes(strings.TrimSpace(s), suggestionSummaryLimit)
}

// truncateRunes cuts on rune boundaries: a summary sliced mid-rune reaches the
// model as replacement characters, and a chip caption does the same on screen.
func truncateRunes(s string, limit int) string {
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	return strings.TrimSpace(string(runes[:limit-1])) + "…"
}
