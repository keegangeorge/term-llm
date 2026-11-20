package spawnmodel

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeCatalog struct {
	err       error
	validated []string
}

func (c *fakeCatalog) ResolveSpawnModel(_ context.Context, model string) (string, error) {
	c.validated = append(c.validated, model)
	return model, c.err
}

func TestResolveRequiresProviderModel(t *testing.T) {
	for _, model := range []string{
		"requested-model",
		":requested-model",
		"provider:",
		" provider:requested-model",
		"provider:requested-model ",
		"pro vider:requested-model",
		"provider:requested model",
	} {
		catalog := &fakeCatalog{}
		_, err := Resolve(context.Background(), catalog, model)
		if err == nil || !strings.Contains(err.Error(), "provider:model") {
			t.Fatalf("Resolve(%q) = %v, want provider:model guidance", model, err)
		}
		if len(catalog.validated) != 0 {
			t.Fatalf("Resolve(%q) consulted the catalog for a malformed model", model)
		}
	}
}

func TestResolveDelegatesToCatalog(t *testing.T) {
	if _, err := Resolve(context.Background(), nil, "codex:gpt-5.4"); err != nil {
		t.Fatalf("Validate without catalog = %v, want nil", err)
	}
	if _, err := Resolve(context.Background(), &fakeCatalog{err: errors.New("never")}, ""); err != nil {
		t.Fatalf("Resolve(empty model) = %v, want nil", err)
	}

	reject := errors.New(`unknown provider "codex"`)
	catalog := &fakeCatalog{err: reject}
	if _, err := Resolve(context.Background(), catalog, "codex:gpt-5.4"); !errors.Is(err, reject) {
		t.Fatalf("Validate = %v, want catalog error", err)
	}
	if len(catalog.validated) != 1 || catalog.validated[0] != "codex:gpt-5.4" {
		t.Fatalf("catalog validated %v", catalog.validated)
	}
}
