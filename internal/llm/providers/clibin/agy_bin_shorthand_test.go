package clibin

import (
	"context"
	"strings"
	"testing"
)

func TestAgyModelShorthand(t *testing.T) {
	const opus = "claude-opus-5-5-low\tClaude Opus 5.5 (Low)\nclaude-opus-5-5-medium\tClaude Opus 5.5 (Medium)\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\n"
	for _, tt := range []struct {
		selector, catalog, want, wantErr string
		calls                            int
	}{
		{selector: "opus", catalog: opus, want: "claude-opus-5-5-medium", calls: 1},
		{selector: "opus-high", catalog: opus, want: "claude-opus-5-5-high", calls: 1},
		{selector: "opus-max", catalog: opus, wantErr: `does not offer "max" effort`, calls: 1},
		{selector: "opus", catalog: opus + "claude-opus-6-medium\n", wantErr: "ambiguous", calls: 1},
		{selector: "opus", catalog: "gemini-4-argon-medium\n", wantErr: "no Claude opus", calls: 1},
		{selector: "opus", catalog: "claude-opus-5-5-high\n", want: "claude-opus-5-5-high", calls: 1},
		{selector: "opus", catalog: "claude-opus-5-5-low\nclaude-opus-5-5-high\n", wantErr: "choose one of low, high", calls: 1},
		{selector: "opus", catalog: "opus\n" + opus, want: "opus", calls: 1},
		{selector: "sonnet-low", catalog: "claude-sonnet-5-5-low\n" + opus, want: "claude-sonnet-5-5-low", calls: 1},
		{selector: "claude-opus-5-5-high", want: "claude-opus-5-5-high"},
		{selector: "my-custom-model", want: "my-custom-model"},
	} {
		t.Run(tt.selector+tt.wantErr, func(t *testing.T) {
			calls := 0
			original := agyModelsCommandOutput
			t.Cleanup(func() { agyModelsCommandOutput = original })
			t.Setenv("XDG_CACHE_HOME", t.TempDir())
			agyModelsCommandOutput = func(ctx context.Context, _ *AgyBinProvider) ([]byte, error) {
				calls++
				if _, ok := ctx.Deadline(); !ok {
					t.Error("catalog lookup has no deadline")
				}
				return []byte(tt.catalog), nil
			}
			got, err := NewAgyBinProvider("", nil).ResolveModelShorthand(context.Background(), tt.selector)
			if tt.wantErr == "" && err != nil || tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("error = %v, want %q", err, tt.wantErr)
			}
			if got != tt.want || calls != tt.calls {
				t.Fatalf("got %q after %d lookups, want %q after %d lookups", got, calls, tt.want, tt.calls)
			}
		})
	}
}
