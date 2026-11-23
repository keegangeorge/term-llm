import { beforeEach, expect, it } from 'vitest';
import { clearHubAgents, readHubAgents, writeHubAgents } from './hub-agent-cache';
import { deletePersistentUICaches } from './persistent-cache';

const agent = (id: string, attention = false) => ({
  id,
  name: id.toUpperCase(),
  target: `/hub/node/${id}/`,
  active: false,
  attention,
});

beforeEach(() => sessionStorage.clear());

it('keeps one list per Hub and clears all of them', () => {
  writeHubAgents('/hub/', [agent('a')]);
  writeHubAgents('/other/', [agent('b')]);
  sessionStorage.setItem('unrelated', 'kept');
  expect(readHubAgents('/hub/').map((entry) => entry.id)).toEqual(['a']);
  clearHubAgents();
  expect(readHubAgents('/hub/')).toEqual([]);
  expect(readHubAgents('/other/')).toEqual([]);
  expect(sessionStorage.getItem('unrelated')).toBe('kept');
});

it('never shows an attention dot for the node on screen', () => {
  writeHubAgents('/hub/', [agent('a', true), agent('b', true)]);
  expect(readHubAgents('/hub/', 'a').map((entry) => entry.attention)).toEqual([false, true]);
});

it('drops malformed entries and targets that leave the origin', () => {
  sessionStorage.setItem(
    'term_llm_hub_agents:/hub/',
    JSON.stringify([
      agent('ok'),
      { ...agent('evil'), target: '//evil.example/' },
      { ...agent('slash'), target: '/\\evil.example/' },
      { id: 'nameless', target: '/hub/node/x/' },
      null,
    ]),
  );
  expect(readHubAgents('/hub/').map((entry) => entry.id)).toEqual(['ok']);
  sessionStorage.setItem('term_llm_hub_agents:/hub/', 'not json');
  expect(readHubAgents('/hub/')).toEqual([]);
});

it('is cleared with the other cached UI data', async () => {
  writeHubAgents('/hub/', [agent('a')]);
  await deletePersistentUICaches();
  expect(readHubAgents('/hub/')).toEqual([]);
});
