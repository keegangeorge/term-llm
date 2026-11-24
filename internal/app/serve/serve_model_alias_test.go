package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/term-llm/term-llm/internal/config"
	"github.com/term-llm/term-llm/internal/llm/core"
)

func TestHandleModelsMarksMovingAliases(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	srv := &serveServer{
		cfgRef: &config.Config{
			DefaultProvider: "claude-bin",
			Providers: map[string]config.ProviderConfig{
				"claude-bin": {Type: config.ProviderTypeClaudeBin, Model: "opus"},
			},
		},
	}
	srv.setCachedModelsForProvider("claude-bin", []core.ModelInfo{
		{ID: "opus", DisplayName: "Opus 5.5"},
		{ID: "claude-opus-5-5", DisplayName: "Opus 5.5"},
		{ID: "claude-opus-4-8", DisplayName: "Opus 4.8"},
	})

	rr := httptest.NewRecorder()
	srv.handleModels(rr, httptest.NewRequest(http.MethodGet, "/v1/models?provider=claude-bin", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Data []struct {
			ID    string `json:"id"`
			Alias bool   `json:"alias"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode /v1/models: %v", err)
	}
	got := map[string]bool{}
	for _, item := range resp.Data {
		got[item.ID] = item.Alias
	}
	want := map[string]bool{"opus": true, "claude-opus-5-5": false, "claude-opus-4-8": false}
	for id, alias := range want {
		if seen, ok := got[id]; !ok || seen != alias {
			t.Errorf("%s alias = %v (listed %v), want %v", id, seen, ok, alias)
		}
	}
}
