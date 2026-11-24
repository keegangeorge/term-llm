package llm

import (
	"testing"

	"github.com/term-llm/term-llm/internal/config"
)

func TestIsMovingModelAlias(t *testing.T) {
	cfg := &config.Config{Providers: map[string]config.ProviderConfig{
		"work-claude": {Type: config.ProviderTypeClaudeBin},
	}}
	tests := []struct {
		provider, model string
		want            bool
	}{
		{"claude-bin", "opus", true},
		{"claude-bin", "Sonnet", true},
		{"work-claude", "haiku", true},
		{"claude-bin", "claude-opus-5-5", false},
		{"claude-bin", "opus-max", false},
		{"anthropic", "opus", false},
		{"openai", "chatgpt-4o-latest", true},
		{"gemini", "gemini-flash-latest", true},
		{"openai", "gpt-6.2-sol", false},
	}
	for _, tt := range tests {
		if got := IsMovingModelAlias(cfg, tt.provider, tt.model); got != tt.want {
			t.Errorf("IsMovingModelAlias(%q, %q) = %v, want %v", tt.provider, tt.model, got, tt.want)
		}
	}
	if !IsMovingModelAlias(nil, "claude-bin", "opus") {
		t.Error("IsMovingModelAlias(nil config) should still infer claude-bin")
	}
}
