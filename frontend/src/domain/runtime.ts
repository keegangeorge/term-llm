export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ModelOption {
  id: string;
  name: string;
  provider?: string;
  efforts?: string[];
  reasoning_modes?: string[];
  service_tiers?: Array<{ id?: string; name?: string } | string | null>;
  additional_speed_tiers?: string[];
  service_tier?: string;
  default_effort?: string;
  /** Moving alias such as "opus" that follows its family's newest model. */
  alias?: boolean;
  [key: string]: unknown;
}

const NATURAL_SUFFIX_MODELS = new Set(['o3-mini-high', 'o4-mini-high']);
const MODEL_EFFORT_SUFFIX = new RegExp(`^(.+)[-_](${EFFORTS.join('|')})$`, 'i');
export const matchModelEffortSuffix = (model: string) => model.match(MODEL_EFFORT_SUFFIX);

export function splitModelEffort(
  model: string,
  separateEffort = '',
): { model: string; effort: string } {
  const value = String(model || '').trim();
  const separate = String(separateEffort || '')
    .trim()
    .toLowerCase();
  const match = matchModelEffortSuffix(value);
  if (
    match &&
    !NATURAL_SUFFIX_MODELS.has(value.toLowerCase()) &&
    (!separate || EFFORTS.includes(separate as Effort))
  )
    return { model: match[1], effort: separate || match[2].toLowerCase() };
  return { model: value, effort: separate };
}

export function compactModelLabel(value: string): string {
  return String(value || '')
    .replace(/^(?:openai|anthropic|google|xai|ollama|openrouter)[/:]/i, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/i, '');
}

function advertisedEfforts(model: ModelOption | undefined): string[] | undefined {
  return (
    model?.efforts ||
    (Array.isArray(model?.reasoning_efforts) ? model.reasoning_efforts : undefined)
  );
}

export function supportedEfforts(model: ModelOption | undefined): string[] {
  const values = advertisedEfforts(model);
  return ['', ...new Set((values?.length ? values : EFFORTS).map(String).filter(Boolean))];
}

function effectiveEffort(effort: string, values: string[] | undefined): string {
  return !values?.length || values.includes(effort) ? effort : '';
}

export function defaultProvider(providers: ModelOption[]): ModelOption | undefined {
  return providers.find((provider) => provider.is_default === true) || providers[0];
}

export function defaultModel(provider: ModelOption | undefined): string {
  const configured = String(provider?.default_model || '').trim();
  if (configured) return configured;
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const first = models.find(
    (model) => typeof model === 'string' || (model && typeof model === 'object'),
  );
  return typeof first === 'string'
    ? first
    : String((first as { id?: unknown } | undefined)?.id || '');
}

export function supportsReasoningMode(model: ModelOption | undefined, mode: string): boolean {
  return Boolean(model?.reasoning_modes?.includes(mode));
}

const normalizeServiceTier = (value: unknown): string => {
  const tier = String(value || '')
    .trim()
    .toLowerCase();
  return tier === 'fast' ? 'priority' : tier;
};

export function isFastServiceTier(value: unknown): boolean {
  return normalizeServiceTier(value) === 'priority';
}

export function supportsFastMode(model: ModelOption | undefined): boolean {
  return Boolean(
    model?.service_tiers?.some((tier) =>
      isFastServiceTier(tier && typeof tier === 'object' ? tier.id : tier),
    ) || model?.additional_speed_tiers?.some(isFastServiceTier),
  );
}

export interface RuntimeSelection {
  provider: string;
  model: string;
  effort: string;
  reasoningMode: string;
  fast: boolean;
}
export function applyRuntimeToRequest(
  body: Record<string, unknown>,
  active: Partial<RuntimeSelection>,
  selected: RuntimeSelection,
  modelInfo?: ModelOption,
  providerInfo?: ModelOption,
): void {
  const split = splitModelEffort(selected.model, selected.effort);
  const values = advertisedEfforts(modelInfo);
  const effort = effectiveEffort(split.effort, values);
  if (split.model) body.model = split.model;
  const { provider } = selected;
  const differs =
    (provider && provider !== active.provider) ||
    (split.model &&
      splitModelEffort(split.model, effort).model !==
        splitModelEffort(active.model || '', active.effort).model) ||
    (effort && effort !== active.effort);
  if (provider || active.provider || differs)
    body.provider = provider || active.provider || undefined;
  const requestEffort =
    effort ||
    (!differs &&
      effectiveEffort(
        String(active.effort || '')
          .trim()
          .toLowerCase(),
        values,
      ));
  if (requestEffort) body.reasoning_effort = requestEffort;
  if (differs) body.model_swap = { mode: 'auto', fallback: 'handover' };
  if (supportsReasoningMode(modelInfo, selected.reasoningMode))
    body.reasoning = { mode: selected.reasoningMode === 'pro' ? 'pro' : 'standard' };
  if (supportsFastMode(modelInfo) && !isFastServiceTier(providerInfo?.service_tier))
    body.service_tier = selected.fast ? 'priority' : '';
}
