import type { HubAgent } from '../stores/store-types';

/**
 * The Hub's agent list is the same on every node, and switching nodes loads a
 * new page. The last list is kept for this tab so the next node paints its
 * sidebar complete instead of growing it once the Hub answers. Like the other
 * cached UI data, it is dropped on 401/403, Hub sign-out and "Clear cached
 * data on this device".
 */
const PREFIX = 'term_llm_hub_agents:';

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
  try {
    if (agents.length) session()?.setItem(PREFIX + hubURL, JSON.stringify(agents));
    else session()?.removeItem(PREFIX + hubURL);
  } catch {
    // Storage can be unavailable or full; the list still loads from the Hub.
  }
}

export function clearHubAgents(): void {
  const storage = session();
  if (!storage) return;
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) storage.removeItem(key);
    }
  } catch {
    // Unavailable storage holds nothing to clear.
  }
}
