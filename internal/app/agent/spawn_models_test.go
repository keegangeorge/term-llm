package agent

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/term-llm/term-llm/internal/config"
)

func configDiscoveryCatalog() SpawnModelCatalog {
	disabled := false
	return SpawnModelCatalog{
		cfg: &config.Config{
			DefaultProvider:   "chatgpt",
			ProviderDiscovery: config.ProviderDiscoveryConfig,
			Providers: map[string]config.ProviderConfig{
				"chatgpt":    {Model: "gpt-5.6-luna"},
				"claude-bin": {Model: "opus"},
				"openai":     {Model: "gpt-5.2", Enabled: &disabled},
				"anthropic":  {Model: "claude-sonnet-4-6", FromDefaults: true},
			},
		},
		hasLocalCredentials: func(string) bool { return true },
	}
}

func TestSpawnModelProvidersMatchPickerDiscovery(t *testing.T) {
	got := configDiscoveryCatalog().spawnModelProviders()
	if want := []string{"chatgpt", "claude-bin"}; !slices.Equal(got, want) {
		t.Fatalf("SpawnModelProviders() = %v, want %v", got, want)
	}
}

func TestResolveSpawnModel(t *testing.T) {
	catalog := configDiscoveryCatalog()
	tests := []struct {
		name, model, wantErr string
	}{
		{name: "enabled provider", model: "chatgpt:gpt-5.4"},
		{name: "enabled provider with colon model", model: "claude-bin:opus:extra"},
		{name: "debug provider", model: "debug:fast"},
		{name: "branding guess", model: "codex:gpt-5.4", wantErr: `unknown provider "codex"`},
		{name: "invented tier", model: "expensive:default", wantErr: `unknown provider "expensive"`},
		{name: "disabled built-in", model: "openai:gpt-5.2", wantErr: `provider "openai" is not enabled on this host`},
		{name: "schema default only", model: "anthropic:claude-sonnet-4-6", wantErr: `provider "anthropic" is not enabled on this host`},
		{name: "undeclared built-in", model: "gemini:gemini-3-flash-preview", wantErr: `provider "gemini" is not enabled on this host`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := catalog.ResolveSpawnModel(context.Background(), tt.model)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("ResolveSpawnModel(%q) = %v, want nil", tt.model, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("ResolveSpawnModel(%q) = nil, want error", tt.model)
			}
			for _, want := range []string{tt.wantErr, "use one of chatgpt, claude-bin", `"chatgpt:<model>"`, "omit model"} {
				if !strings.Contains(err.Error(), want) {
					t.Fatalf("ResolveSpawnModel(%q) = %q, want it to contain %q", tt.model, err, want)
				}
			}
		})
	}
}

func TestResolveSpawnModelRejectsExplicitlyDisabledDebug(t *testing.T) {
	catalog := configDiscoveryCatalog()
	disabled := false
	catalog.cfg.Providers["debug"] = config.ProviderConfig{Enabled: &disabled}
	_, err := catalog.ResolveSpawnModel(context.Background(), "debug:fast")
	if err == nil || !strings.Contains(err.Error(), `provider "debug" is not enabled on this host`) {
		t.Fatalf("ResolveSpawnModel(disabled debug) = %v, want early rejection", err)
	}
}

func TestResolveSpawnModelRejectsProviderBlockedModel(t *testing.T) {
	catalog := configDiscoveryCatalog()
	chatgpt := catalog.cfg.Providers["chatgpt"]
	chatgpt.AllowedModels = []string{"gpt-allowed"}
	catalog.cfg.Providers["chatgpt"] = chatgpt

	_, err := catalog.ResolveSpawnModel(context.Background(), "chatgpt:gpt-blocked")
	if err == nil || !strings.Contains(err.Error(), "providers.chatgpt.allowed_models") || !strings.Contains(err.Error(), "gpt-allowed") {
		t.Fatalf("ResolveSpawnModel() = %v, want provider allowlist denial with allowed entry", err)
	}
	if strings.Contains(err.Error(), "gpt-5.6-luna") || strings.Contains(err.Error(), "gpt-5.4") {
		t.Fatalf("provider denial enumerated a catalog: %v", err)
	}
	if _, err := catalog.ResolveSpawnModel(context.Background(), "chatgpt:gpt-allowed"); err != nil {
		t.Fatalf("ResolveSpawnModel(allowed) = %v", err)
	}
}

func TestResolveSpawnModelBoundsRecoverySuggestions(t *testing.T) {
	for _, count := range []int{0, 1, 3, 4, 40} {
		t.Run(fmt.Sprintf("%d providers", count), func(t *testing.T) {
			cfg := &config.Config{
				ProviderDiscovery: config.ProviderDiscoveryConfig,
				Providers:         make(map[string]config.ProviderConfig),
			}
			models := make([]string, 500)
			for i := range models {
				models[i] = fmt.Sprintf("catalog-model-%03d", i)
			}
			for i := range count {
				cfg.Providers[fmt.Sprintf("custom-%02d", i)] = config.ProviderConfig{Models: models}
			}
			if count > 0 {
				// Prefer the default even when it sorts last in a large catalog.
				cfg.DefaultProvider = fmt.Sprintf("custom-%02d", count-1)
			}
			_, err := NewSpawnModelCatalog(cfg).ResolveSpawnModel(context.Background(), "codex:guessed-model")
			if err == nil {
				t.Fatal("expected unknown provider error")
			}
			message := err.Error()
			if len(message) > 500 || strings.Contains(message, "catalog-model-") {
				t.Fatalf("error includes an oversized catalog: %q", message)
			}
			if !strings.Contains(message, "omit model") {
				t.Fatalf("error lacks default fallback: %q", message)
			}
			if count == 0 {
				if strings.Contains(message, "use one of") {
					t.Fatalf("error suggests providers when none are enabled: %q", message)
				}
				return
			}
			if !strings.Contains(message, "use one of "+cfg.DefaultProvider) ||
				!strings.Contains(message, fmt.Sprintf("%q", cfg.DefaultProvider+":<model>")) {
				t.Fatalf("error does not prefer the default: %q", message)
			}
			for i := 2; i < count-1; i++ {
				if strings.Contains(message, fmt.Sprintf("custom-%02d", i)) {
					t.Fatalf("error includes more than three provider suggestions: %q", message)
				}
			}
			if count > 3 {
				for _, want := range []string{fmt.Sprintf("and %d more", count-3), "term-llm providers --configured"} {
					if !strings.Contains(message, want) {
						t.Fatalf("error %q lacks %q", message, want)
					}
				}
			} else if strings.Contains(message, "more") {
				t.Fatalf("error implies omitted providers: %q", message)
			}
		})
	}
}

func TestSpawnModelCatalogWithoutConfigAllowsEverything(t *testing.T) {
	var catalog SpawnModelCatalog
	if got := catalog.spawnModelProviders(); got != nil {
		t.Fatalf("SpawnModelProviders() = %v, want nil", got)
	}
	if _, err := catalog.ResolveSpawnModel(context.Background(), "codex:gpt-5.4"); err != nil {
		t.Fatalf("ResolveSpawnModel() = %v, want nil without config", err)
	}
}

func TestResolveSpawnModelUsesAgyCatalogBeforeCheckingAllowlist(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake agy executable uses a POSIX shell")
	}
	bin := t.TempDir()
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	if err := os.WriteFile(filepath.Join(bin, "agy"), []byte("#!/bin/sh\n[ \"$1\" = models ] || exit 1\nprintf 'claude-opus-5-5-medium\\tClaude Opus 5.5 (Medium)\\nclaude-opus-5-5-high\\tClaude Opus 5.5 (High)\\n'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	catalog := configDiscoveryCatalog()
	catalog.cfg.Providers["agy-bin"] = config.ProviderConfig{AllowedModels: []string{"claude-opus-5-5-medium"}}
	got, err := catalog.ResolveSpawnModel(context.Background(), "agy-bin:opus")
	if err != nil || got != "agy-bin:claude-opus-5-5-medium" {
		t.Fatalf("default shorthand = %q, %v", got, err)
	}
	if _, err := catalog.ResolveSpawnModel(context.Background(), "agy-bin:opus-high"); err == nil || !strings.Contains(err.Error(), "providers.agy-bin.allowed_models") {
		t.Fatalf("explicit high effort was not rejected: %v", err)
	}
	if got, err := catalog.ResolveSpawnModel(context.Background(), "claude-bin:opus"); err != nil || got != "claude-bin:opus" {
		t.Fatalf("Claude Code alias = %q, %v", got, err)
	}
}
