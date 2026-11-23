import type { HubAgent } from '../stores/store-types';

/**
 * The Hub's agent list is the same on every node, and switching nodes loads a
 * new page. The last list is kept for this tab so the next node paints its
 * sidebar complete instead of growing it once the Hub answers. Like the other
 * cached UI data, it is dropped on 401/403, Hub sign-out and "Clear cached
 * data on this device".
 */
const PREFIX = 'term_llm_hub_agents:';
const INVALIDATION_KEY = 'term_llm_hub_agents_invalidation';

function originVersion(): string {
  try {
    return globalThis.localStorage?.getItem(INVALIDATION_KEY) || '';
  } catch {
    return '';
  }
}

/** Reconcile this tab's private list before any read or write. */
export function hubAgentCacheVersion(): string {
  const version = originVersion();
  const storage = session();
  if (!storage) return version;
  try {
    if ((storage.getItem(INVALIDATION_KEY) || '') !== version) {
      removeHubAgentLists(storage);
      storage.setItem(INVALIDATION_KEY, version);
    }
  } catch {
    // Storage denial means there is no usable cached list.
  }
  return version;
}

function removeHubAgentLists(storage: Storage): void {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX)) storage.removeItem(key);
  }
}

function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function safePath(value: unknown): string {
  return typeof value === 'string' && /^\/(?![\\/])/.test(value) ? value : '';
}

/** The cached list for this Hub, with attention relative to the node on screen. */
export function readHubAgents(hubURL: string, nodeId = ''): HubAgent[] {
  if (!hubURL) return [];
  hubAgentCacheVersion();
  try {
    const cached: unknown = JSON.parse(session()?.getItem(PREFIX + hubURL) || '[]');
    if (!Array.isArray(cached)) return [];
    return cached.flatMap((entry: unknown): HubAgent[] => {
      if (!entry || typeof entry !== 'object') return [];
      const agent = entry as Record<string, unknown>;
      const id = typeof agent.id === 'string' ? agent.id : '';
      const name = typeof agent.name === 'string' ? agent.name : '';
      const target = safePath(agent.target);
      if (!id || !name || !target) return [];
      return [
        {
          id,
          name,
          target,
          active: agent.active === true,
          attention: id !== nodeId && agent.attention === true,
        },
      ];
    });
  } catch {
    return [];
  }
}

export function writeHubAgents(hubURL: string, agents: readonly HubAgent[]): void {
  if (!hubURL) return;
  hubAgentCacheVersion();
  try {
    if (agents.length) session()?.setItem(PREFIX + hubURL, JSON.stringify(agents));
    else session()?.removeItem(PREFIX + hubURL);
  } catch {
    // Storage can be unavailable or full; the list still loads from the Hub.
  }
}

export function clearHubAgents(): void {
  // Other tabs have separate sessionStorage; invalidate theirs before clearing ours.
  const version = `${Date.now()}:${Math.random()}`;
  try {
    globalThis.localStorage?.setItem(INVALIDATION_KEY, version);
  } catch {
    // Local storage may be disabled; still clear this tab's list.
  }
  const storage = session();
  if (!storage) return;
  try {
    removeHubAgentLists(storage);
    storage.setItem(INVALIDATION_KEY, version);
  } catch {
    // Unavailable storage holds nothing to clear.
  }
}
