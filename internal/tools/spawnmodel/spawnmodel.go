// Package spawnmodel checks the spawn_agent model argument.
package spawnmodel

import (
	"context"
	"errors"
	"strings"
	"unicode"
)

// Catalog is implemented by spawn runners that can validate model overrides
// against the providers this host enables. Recovery guidance belongs in
// validation errors, not in the tool schema.
type Catalog interface {
	// ResolveSpawnModel validates the selector and resolves supported shorthands
	// to concrete provider:model selectors.
	ResolveSpawnModel(ctx context.Context, model string) (string, error)
}

// Resolve checks a model override requested through spawn_agent. Models set
// in agent configuration do not pass through here: they may be plain or
// colon-tagged names such as "llama3:8b".
func Resolve(ctx context.Context, runner any, model string) (string, error) {
	if model == "" {
		return model, nil
	}
	if !qualified(model) {
		return "", errors.New("model must use provider:model format; omit it to use the configured/default model")
	}
	if catalog, ok := runner.(Catalog); ok {
		return catalog.ResolveSpawnModel(ctx, model)
	}
	return model, nil
}

func qualified(model string) bool {
	provider, modelName, found := strings.Cut(model, ":")
	return found && provider != "" && modelName != "" &&
		!strings.ContainsFunc(provider, unicode.IsSpace) &&
		!strings.ContainsFunc(modelName, unicode.IsSpace)
}
