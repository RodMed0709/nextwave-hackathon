package mcp

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/guregu/null/v6"
)

// ActivityObject names the business object involved in an activity without
// making the client infer it from copy or node metadata.
type ActivityObject struct {
	Kind  string `json:"kind" jsonschema:"One of: document, email, record"`
	Label string `json:"label" jsonschema:"Short customer-readable label for the object"`
}

// ActivityCue is optional semantic presentation metadata for a progress event.
// It describes only what the runtime explicitly reports; it does not affect node
// or run state.
type ActivityCue struct {
	Kind   string          `json:"kind" jsonschema:"One of: document.read, message.send, message.receive, data.check, calculate, submit"`
	Phase  string          `json:"phase,omitempty" jsonschema:"Optional phase: started, progress, completed"`
	Object *ActivityObject `json:"object,omitempty" jsonschema:"Optional business object involved in the activity"`
	Copy   string          `json:"copy,omitempty" jsonschema:"Optional short customer-readable description"`
}

// MetricCue carries typed numeric evidence. Currency is deliberately the only
// supported kind so arbitrary metrics cannot become a money animation.
type MetricCue struct {
	Kind     string  `json:"kind" jsonschema:"Must be currency"`
	Value    float64 `json:"value" jsonschema:"Finite numeric currency value"`
	Currency string  `json:"currency" jsonschema:"Three-letter uppercase currency code, e.g. USD"`
	Label    string  `json:"label" jsonschema:"Short customer-readable label for the value"`
}

func validateActivityCue(cue *ActivityCue) error {
	if cue == nil {
		return nil
	}
	switch cue.Kind {
	case "document.read", "message.send", "message.receive", "data.check", "calculate", "submit":
	default:
		return fmt.Errorf("activity.kind %q is not supported", cue.Kind)
	}
	switch cue.Phase {
	case "", "started", "progress", "completed":
	default:
		return fmt.Errorf("activity.phase %q is not supported", cue.Phase)
	}
	if cue.Object == nil {
		return nil
	}
	switch cue.Object.Kind {
	case "document", "email", "record":
	default:
		return fmt.Errorf("activity.object.kind %q is not supported", cue.Object.Kind)
	}
	if strings.TrimSpace(cue.Object.Label) == "" {
		return fmt.Errorf("activity.object.label is required when object is provided")
	}
	return nil
}

func validateMetricCue(cue *MetricCue) error {
	if cue == nil {
		return nil
	}
	if cue.Kind != "currency" {
		return fmt.Errorf("metric.kind %q is not supported", cue.Kind)
	}
	if math.IsNaN(cue.Value) || math.IsInf(cue.Value, 0) {
		return fmt.Errorf("metric.value must be finite")
	}
	if !isUpperCurrencyCode(cue.Currency) {
		return fmt.Errorf("metric.currency must be a three-letter uppercase code")
	}
	if strings.TrimSpace(cue.Label) == "" {
		return fmt.Errorf("metric.label is required")
	}
	return nil
}

func isUpperCurrencyCode(code string) bool {
	if len(code) != 3 {
		return false
	}
	for i := 0; i < len(code); i++ {
		if code[i] < 'A' || code[i] > 'Z' {
			return false
		}
	}
	return true
}

// encodeMotionCues validates and stores optional cues in the existing detail
// extension point. With no cues it returns an invalid null.String, preserving
// the payload emitted for existing report_progress callers.
func encodeMotionCues(activity *ActivityCue, metric *MetricCue) (null.String, error) {
	if err := validateActivityCue(activity); err != nil {
		return null.String{}, err
	}
	if err := validateMetricCue(metric); err != nil {
		return null.String{}, err
	}
	if activity == nil && metric == nil {
		return null.String{}, nil
	}
	detail := make(map[string]any, 2)
	if activity != nil {
		detail["activity"] = activity
	}
	if metric != nil {
		detail["metric"] = metric
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		return null.String{}, fmt.Errorf("encode motion cues: %w", err)
	}
	return null.StringFrom(string(raw)), nil
}

// liftMotionCues exposes cue objects as named delta fields while retaining the
// original detail string for old clients. Stored data is decoded permissively:
// write-time validation must not make a newer event unreadable by this server.
func liftMotionCues(payload *deltaPayload) {
	if payload == nil || !payload.Detail.Valid {
		return
	}
	var detail map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payload.Detail.String), &detail); err != nil {
		return
	}
	if raw, ok := detail["activity"]; ok {
		var cue *ActivityCue
		if err := json.Unmarshal(raw, &cue); err == nil && cue != nil {
			payload.Activity = cue
		}
	}
	if raw, ok := detail["metric"]; ok {
		var cue *MetricCue
		if err := json.Unmarshal(raw, &cue); err == nil && cue != nil {
			payload.Metric = cue
		}
	}
}
