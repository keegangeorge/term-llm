import { describe, expect, it } from 'vitest';
import { applyCompletion, completedCursor } from './completions';
import {
  activeModelMentionAtCursor,
  modelMentionCompletions,
  modelMentionOwnsToken,
  type ModelMentionCatalogs,
} from './model-mentions';

const providers = [{ id: 'claude-bin' }, { id: 'chatgpt' }, { id: 'bedrock' }];
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const catalogs: ModelMentionCatalogs = {
  'claude-bin': [
    { id: 'opus', name: 'Opus 5.5', alias: true, efforts },
    { id: 'haiku', name: 'Haiku 5.5', alias: true, efforts },
    { id: 'claude-opus-5-5', name: 'Opus 5.5', efforts },
    { id: 'claude-opus-4-8', name: 'Opus 4.8', efforts },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
  ],
  chatgpt: [{ id: 'gpt-6.2-sol', name: 'gpt-6.2-sol', efforts, default_effort: 'low' }],
};

const tokenAtEnd = (value: string) => activeModelMentionAtCursor(value, value.length, providers);

const labels = (value: string) =>
  modelMentionCompletions(tokenAtEnd(value)!, providers, catalogs).map((entry) => entry.label);

describe('model mention tokens', () => {
  it('recognizes @model: and its @m: alias mid-sentence', () => {
    const token = tokenAtEnd('spawn a subagent with @model:opus');
    expect(token).toMatchObject({ scoped: true, query: 'opus', start: 22 });
    expect(modelMentionOwnsToken(token)).toBe(true);
    expect(tokenAtEnd('spawn a subagent with @m:opus')).toMatchObject({
      scoped: true,
      query: 'opus',
    });
    expect(tokenAtEnd('@agent:opus')).toBeNull();
  });

  it('treats plain @ as a model query only for provider names or colons', () => {
    expect(tokenAtEnd('@cl')).toMatchObject({ scoped: false, query: 'cl' });
    expect(tokenAtEnd('@chatgpt:gpt')).toMatchObject({ scoped: false });
    expect(tokenAtEnd('@src/main.ts')).toBeNull();
    expect(tokenAtEnd('@c')).toBeNull();
    expect(tokenAtEnd('@"claude')).toBeNull();
    expect(tokenAtEnd('@docs:intro')).toBeNull();
    expect(modelMentionOwnsToken(tokenAtEnd('@cl'))).toBe(false);
  });

  it('splits a chosen model from its effort query', () => {
    expect(tokenAtEnd('@m:claude-bin:opus#me')).toMatchObject({
      model: 'claude-bin:opus',
      effortQuery: 'me',
    });
  });
});

describe('model mention completions', () => {
  it('ranks moving aliases ahead of pinned versions and offers both', () => {
    expect(labels('@m:opus')).toEqual([
      'claude-bin:opus',
      'claude-bin:claude-opus-5-5',
      'claude-bin:claude-opus-4-8',
    ]);
    const [alias, pinned] = modelMentionCompletions(tokenAtEnd('@m:opus')!, providers, catalogs);
    expect(alias.badge).toBe('latest');
    expect(pinned.badge).toBeUndefined();
    expect(pinned.description).toContain('Opus 5.5');
  });

  it('groups pinned versions with their provider alias', () => {
    const mixed: ModelMentionCatalogs = {
      ...catalogs,
      bedrock: [{ id: 'claude-opus-4-8', name: 'Opus 4.8', efforts }],
    };
    const offered = [{ id: 'bedrock' }, { id: 'claude-bin' }];
    const token = activeModelMentionAtCursor('@m:opus', 7, offered)!;
    expect(modelMentionCompletions(token, offered, mixed).map((entry) => entry.label)).toEqual([
      'claude-bin:opus',
      'claude-bin:claude-opus-5-5',
      'claude-bin:claude-opus-4-8',
      'bedrock:claude-opus-4-8',
    ]);
  });

  it('searches display names and provider-qualified references', () => {
    expect(labels('@m:4.8')).toEqual(['claude-bin:claude-opus-4-8']);
    expect(labels('@m:chatgpt:')).toEqual(['chatgpt:gpt-6.2-sol']);
  });

  it('only lists providers that are offered', () => {
    const offered = [{ id: 'chatgpt' }];
    const token = activeModelMentionAtCursor('@m:', 3, offered)!;
    expect(modelMentionCompletions(token, offered, catalogs).map((entry) => entry.label)).toEqual([
      'chatgpt:gpt-6.2-sol',
    ]);
  });

  it('keeps the token open for models with efforts', () => {
    const prompt = 'research with @m:opus';
    const [opus] = modelMentionCompletions(tokenAtEnd(prompt)!, providers, catalogs);
    expect(opus.continues).toBe(true);
    const next = applyCompletion(prompt, opus);
    expect(next).toBe('research with @model:claude-bin:opus#');
    expect(completedCursor(prompt, opus)).toBe(next.length);
  });

  it('inserts a plain reference for models without efforts', () => {
    const prompt = '@m:haiku-4';
    const [haiku] = modelMentionCompletions(tokenAtEnd(prompt)!, providers, catalogs);
    expect(applyCompletion(prompt, haiku)).toBe('claude-bin:claude-haiku-4-5-20251001 ');
  });

  it('offers the default and each effort, then inserts plain text', () => {
    const prompt = 'use @m:chatgpt:gpt-6.2-sol# for research';
    const cursor = prompt.indexOf(' for');
    const token = activeModelMentionAtCursor(prompt, cursor, providers)!;
    const choices = modelMentionCompletions(token, providers, catalogs);
    expect(choices.map((entry) => entry.value)).toEqual([
      'chatgpt:gpt-6.2-sol',
      ...efforts.map((effort) => `chatgpt:gpt-6.2-sol-${effort}`),
    ]);
    expect(choices.find((entry) => entry.badge === 'default')?.value).toBe(
      'chatgpt:gpt-6.2-sol-low',
    );
    expect(applyCompletion(prompt, choices[2])).toBe('use chatgpt:gpt-6.2-sol-medium for research');
  });

  it('filters efforts by the typed prefix', () => {
    expect(labels('@m:claude-bin:opus#x')).toEqual(['claude-bin:opus-xhigh']);
    expect(labels('@m:claude-bin:opus#nope')).toEqual([]);
    expect(labels('@m:claude-bin:missing#')).toEqual([]);
  });

  it('caps loose @ results below scoped ones', () => {
    const many: ModelMentionCatalogs = {
      chatgpt: Array.from({ length: 20 }, (_, index) => ({ id: `m${index}`, name: '' })),
    };
    const loose = activeModelMentionAtCursor('@chatgpt:', 9, providers)!;
    const scoped = activeModelMentionAtCursor('@m:chatgpt:', 11, providers)!;
    expect(modelMentionCompletions(loose, providers, many)).toHaveLength(6);
    expect(modelMentionCompletions(scoped, providers, many)).toHaveLength(12);
  });
});
