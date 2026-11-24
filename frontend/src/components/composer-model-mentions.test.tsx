import { act, render, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { StoreContext } from '../app/context';
import { AppStore } from '../stores/app-store';
import { testConfig, testSession } from '../stores/store-test-fixtures';
import { Composer } from './Composer';

const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];

const modelStore = () => {
  const store = new AppStore(testConfig);
  store.sessions.value = [testSession()];
  store.activeSessionId.value = 's1';
  store.draftActive.value = false;
  store.startupDone.value = true;
  store.providers.value = [
    { id: 'claude-bin', name: 'claude-bin' },
    { id: 'chatgpt', name: 'chatgpt' },
  ];
  const catalogs: Record<string, unknown[]> = {
    'claude-bin': [
      { id: 'opus', display_name: 'Opus 5.5', alias: true, reasoning_efforts: efforts },
      { id: 'claude-opus-4-8', display_name: 'Opus 4.8', reasoning_efforts: efforts },
    ],
    chatgpt: [{ id: 'gpt-6.2-sol', reasoning_efforts: efforts }],
  };
  store.endpoints.models = vi.fn(async (provider = '') => ({ data: catalogs[provider] || [] }));
  store.endpoints.mentionSearch = vi.fn(async () => ({ active: false, items: [] }));
  return store;
};

const renderComposer = (store: AppStore) =>
  render(
    <StoreContext.Provider value={store}>
      <Composer />
    </StoreContext.Provider>,
  );

it('inserts an exact provider:model-effort through @m: in two steps', async () => {
  const store = modelStore();
  renderComposer(store);
  const textbox = screen.getByRole('textbox', { name: 'Message' });
  await userEvent.click(textbox);
  await userEvent.keyboard('launch a subagent in @m:opus');

  const menu = await screen.findByRole('listbox', { name: 'Composer completions' });
  await waitFor(() => expect(within(menu).getAllByRole('option')).toHaveLength(2));
  const [alias, pinned] = within(menu).getAllByRole('option');
  expect(alias).toHaveTextContent('claude-bin:opus');
  expect(alias).toHaveTextContent('latest');
  expect(pinned).toHaveTextContent('claude-bin:claude-opus-4-8');
  // Catalogs load per provider without disturbing the /model picker's list.
  expect(store.endpoints.models).toHaveBeenCalledWith('claude-bin');
  expect(store.endpoints.models).toHaveBeenCalledWith('chatgpt');
  expect(store.models.value).toEqual([]);

  await userEvent.keyboard('{Enter}');
  expect(store.prompt.value).toBe('launch a subagent in @model:claude-bin:opus#');
  // choose() restores the caret on the next frame, before a person types on.
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await userEvent.keyboard('med{Enter}');
  expect(store.prompt.value).toBe('launch a subagent in claude-bin:opus-medium ');
  expect(screen.queryByRole('listbox', { name: 'Composer completions' })).toBeNull();
  // A model mention is never sent to project file search.
  expect(store.endpoints.mentionSearch).not.toHaveBeenCalled();
});

it('shows a non-selectable row when nothing matches', async () => {
  const store = modelStore();
  renderComposer(store);
  await userEvent.click(screen.getByRole('textbox', { name: 'Message' }));
  await userEvent.keyboard('@model:nothing-like-this');
  const menu = await screen.findByRole('listbox', { name: 'Composer completions' });
  await waitFor(() => expect(menu).toHaveTextContent('No matching models'));
  await userEvent.keyboard('{Enter}');
  expect(store.prompt.value).toBe('@model:nothing-like-this');
});

it('loads catalogs for providers that arrive after the mention opens', async () => {
  const store = modelStore();
  const providers = store.providers.value;
  store.providers.value = [];
  renderComposer(store);
  await userEvent.click(screen.getByRole('textbox', { name: 'Message' }));
  await userEvent.keyboard('@model:gpt');
  const menu = await screen.findByRole('listbox', { name: 'Composer completions' });
  await waitFor(() => expect(menu).toHaveTextContent('No matching models'));
  await act(() => {
    store.providers.value = providers;
  });
  await waitFor(() => expect(menu).toHaveTextContent('chatgpt:gpt-6.2-sol'));
});
