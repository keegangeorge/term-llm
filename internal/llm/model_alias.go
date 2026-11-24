package llm

import (
	"strings"

	"github.com/term-llm/term-llm/internal/config"
	"github.com/term-llm/term-llm/internal/llm/providers/clibin"
)

// IsMovingModelAlias reports whether a model ID follows the newest model in
// its family, such as Claude Code's "opus", rather than naming a pinned
// version. Pickers use it to offer both a tracking and a reproducible choice.
func IsMovingModelAlias(cfg *config.Config, provider, model string) bool {
	model = strings.ToLower(strings.TrimSpace(model))
	if model == "latest" || strings.HasSuffix(model, "-latest") {
		return true
	}
	var explicit config.ProviderType
	if cfg != nil {
		explicit = cfg.Providers[provider].Type
	}
	return config.InferProviderType(provider, explicit) == config.ProviderTypeClaudeBin && clibin.IsClaudeModelAlias(model)
}
