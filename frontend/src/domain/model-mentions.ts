import { activeMentionAtCursor, type Completion } from './completions';
import type { ModelOption } from './runtime';

/**
 * Scoped triggers that search models only, mirroring the TUI's `@agent:`.
 * `@model:` is canonical; `@m:` is a short alias.
 */
export const MODEL_MENTION_PREFIX = '@model:';
const MODEL_MENTION_PREFIXES = [MODEL_MENTION_PREFIX, '@m:'];
/** Separates a chosen model from its effort query while the token is open. */
const EFFORT_SEPARATOR = '#';
const SCOPED_LIMIT = 12;
const LOOSE_LIMIT = 6;

export interface ModelMentionToken {
  start: number;
  end: number;
  /** True for `@model:`/`@m:`; false when a plain `@` query looks like a model. */
  scoped: boolean;
  query: string;
  /** Set once a model is chosen: the `provider:model` awaiting an effort. */
  model?: string;
  effortQuery?: string;
}

export interface ModelMentionProvider {
  id: string;
}

export type ModelMentionCatalogs = Record<string, ModelOption[] | undefined>;

/**
 * Finds a model mention ending at the cursor. `@model:<query>` is always a model
 * mention; a plain `@<query>` only when it starts a provider name or is
 * `provider:...`, so ordinary file and agent mentions stay uncluttered.
 */
export function activeModelMentionAtCursor(
  value: string,
  cursor: number,
  providers: ModelMentionProvider[],
): ModelMentionToken | null {
  const mention = activeMentionAtCursor(value, cursor);
  if (!mention) return null;
  const token = value.slice(mention.start, mention.end);
  if (token.startsWith('@"')) return null;
  const prefix = MODEL_MENTION_PREFIXES.find((entry) => token.toLowerCase().startsWith(entry));
  const scoped = prefix !== undefined;
  const query = scoped ? token.slice(prefix.length) : mention.query;
  if (!scoped && !looksLikeModelQuery(query, providers)) return null;
  const separator = query.indexOf(EFFORT_SEPARATOR);
  if (separator < 0) return { start: mention.start, end: mention.end, scoped, query };
  return {
    start: mention.start,
    end: mention.end,
    scoped,
    query,
    model: query.slice(0, separator),
    effortQuery: query.slice(separator + 1),
  };
}

// A colon only counts after an offered provider, so other namespaces such as
// `@agent:` never turn into model suggestions.
function looksLikeModelQuery(query: string, providers: ModelMentionProvider[]): boolean {
  const lower = query.toLowerCase();
  const colon = lower.indexOf(':');
  if (colon >= 0)
    return providers.some((entry) => entry.id.toLowerCase() === lower.slice(0, colon));
  return lower.length >= 2 && providers.some((entry) => entry.id.toLowerCase().startsWith(lower));
}

/** Whether an open model mention should suppress project file search. */
export function modelMentionOwnsToken(token: ModelMentionToken | null): boolean {
  return Boolean(token && (token.scoped || token.model !== undefined));
}

/**
 * Completions for a model mention. Picking a model that accepts reasoning
 * efforts keeps the token open (`@model:provider:model#`) so the next list offers
 * its efforts; every final choice inserts plain `provider:model[-effort]`, the
 * exact form spawn_agent and --provider accept.
 */
export function modelMentionCompletions(
  token: ModelMentionToken,
  providers: ModelMentionProvider[],
  catalogs: ModelMentionCatalogs,
): Completion[] {
  const replacement = { start: token.start, end: token.end };
  if (token.model !== undefined) return effortCompletions(token, catalogs, replacement);
  const query = token.query.toLowerCase();
  const ranked: Array<{ provider: string; rank: number; order: number; completion: Completion }> =
    [];
  const bestRank = new Map<string, number>();
  let order = 0;
  for (const provider of providers) {
    for (const model of catalogs[provider.id] || []) {
      const reference = `${provider.id}:${model.id}`;
      const rank = matchRank(query, reference, model);
      order++;
      if (rank < 0) continue;
      bestRank.set(provider.id, Math.min(rank, bestRank.get(provider.id) ?? rank));
      const efforts = model.efforts || [];
      ranked.push({
        provider: provider.id,
        rank,
        order,
        completion: {
          value: efforts.length
            ? `${MODEL_MENTION_PREFIX}${reference}${EFFORT_SEPARATOR}`
            : reference,
          label: reference,
          description: modelDescription(model),
          badge: model.alias ? 'latest' : undefined,
          kind: 'model',
          continues: efforts.length > 0,
          replacement,
          segments: highlight(reference, query),
        },
      });
    }
  }
  // Models stay grouped by provider, best-matching provider first, so an
  // alias such as "opus" sits next to the pinned versions it competes with.
  const group = (entry: { provider: string }) => bestRank.get(entry.provider) ?? 0;
  return ranked
    .sort(
      (left, right) =>
        group(left) - group(right) || left.rank - right.rank || left.order - right.order,
    )
    .slice(0, token.scoped ? SCOPED_LIMIT : LOOSE_LIMIT)
    .map((entry) => entry.completion);
}

function effortCompletions(
  token: ModelMentionToken,
  catalogs: ModelMentionCatalogs,
  replacement: { start: number; end: number },
): Completion[] {
  const reference = token.model || '';
  const split = reference.indexOf(':');
  if (split < 0) return [];
  const providerId = reference.slice(0, split);
  const modelId = reference.slice(split + 1);
  const model = catalogs[providerId]?.find((entry) => entry.id === modelId);
  if (!model?.efforts?.length) return [];
  const query = (token.effortQuery || '').toLowerCase();
  const defaultEffort = String(model.default_effort || '');
  const choices: Completion[] = [];
  if ('default'.startsWith(query))
    choices.push({
      value: reference,
      label: reference,
      description: 'No effort suffix: the agent or provider default applies',
      kind: 'model',
      replacement,
    });
  for (const effort of model.efforts) {
    if (!effort.toLowerCase().startsWith(query)) continue;
    choices.push({
      value: `${reference}-${effort}`,
      label: `${reference}-${effort}`,
      description: `${effort} effort`,
      badge: effort === defaultEffort ? 'default' : undefined,
      kind: 'model',
      replacement,
    });
  }
  return choices;
}

/** Lower is better; -1 excludes the model. */
function matchRank(query: string, reference: string, model: ModelOption): number {
  if (!query) return model.alias ? 0 : 1;
  const id = model.id.toLowerCase();
  const ref = reference.toLowerCase();
  if (id === query || ref === query) return 0;
  if (id.startsWith(query) || ref.startsWith(query)) return model.alias ? 1 : 2;
  if (ref.includes(query)) return model.alias ? 3 : 4;
  if (
    String(model.name || '')
      .toLowerCase()
      .includes(query)
  )
    return 5;
  return -1;
}

function modelDescription(model: ModelOption): string {
  const name = String(model.name || '');
  const parts = name && name !== model.id ? [name] : [];
  if (model.efforts?.length) parts.push(`effort: ${model.efforts.join(', ')}`);
  return parts.join(' · ');
}

function highlight(label: string, query: string): Completion['segments'] {
  const index = query ? label.toLowerCase().indexOf(query) : -1;
  if (index < 0) return [{ text: label }];
  return [
    { text: label.slice(0, index) },
    { text: label.slice(index, index + query.length), matched: true },
    { text: label.slice(index + query.length) },
  ].filter((segment) => segment.text);
}
