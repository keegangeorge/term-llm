package clibin

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/term-llm/term-llm/internal/llm/core"
)

// ResolveModelShorthand resolves the supported Claude family nicknames against
// this Antigravity account's live catalog. Exact IDs need no discovery, and a
// failed lookup never falls back to another account or a curated model list.
func (p *AgyBinProvider) ResolveModelShorthand(ctx context.Context, selector string) (string, error) {
	family, effort := parseAgyEffort(strings.ToLower(selector))
	if family != "opus" && family != "sonnet" {
		return selector, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	models, err := p.ListModels(ctx)
	if err != nil {
		return "", fmt.Errorf("could not look up Antigravity shorthand %q: %w; use an exact model ID to skip lookup", selector, err)
	}
	return resolveAgyFamily(models, selector, family, effort)
}

func resolveAgyFamily(models []core.ModelInfo, selector, family, effort string) (string, error) {
	var matches []core.ModelInfo
	for _, model := range models {
		if model.ID == selector || strings.HasPrefix(selector, model.ID+"-") &&
			slices.Contains(model.ReasoningEfforts, effort) {
			return selector, nil
		}
		if strings.HasPrefix(model.ID, "claude-"+family+"-") {
			matches = append(matches, model)
		}
	}
	switch len(matches) {
	case 0:
		return "", fmt.Errorf("no Claude %s model in the Antigravity catalog; run `term-llm models --provider agy-bin` for exact IDs", family)
	case 1:
		return selectAgyFamilyEffort(matches[0], effort)
	default:
		ids := make([]string, 0, len(matches))
		for _, model := range matches {
			ids = append(ids, model.ID)
		}
		slices.Sort(ids)
		return "", fmt.Errorf("Antigravity shorthand %q is ambiguous; use an exact model ID (e.g. %s or %s)", selector, ids[0], ids[1])
	}
}

func selectAgyFamilyEffort(model core.ModelInfo, effort string) (string, error) {
	efforts := model.ReasoningEfforts
	if effort == "" {
		switch {
		case len(efforts) == 0:
			return model.ID, nil
		case slices.Contains(efforts, model.DefaultReasoningEffort):
			effort = model.DefaultReasoningEffort
		case slices.Contains(efforts, "medium"):
			effort = "medium"
		case len(efforts) == 1:
			effort = efforts[0]
		default:
			return "", fmt.Errorf("%s has no default or medium effort; choose one of %s", model.ID, strings.Join(efforts, ", "))
		}
	}
	if !slices.Contains(efforts, effort) {
		return "", fmt.Errorf("%s does not offer %q effort (available: %s)", model.ID, effort, strings.Join(efforts, ", "))
	}
	return model.ID + "-" + effort, nil
}
