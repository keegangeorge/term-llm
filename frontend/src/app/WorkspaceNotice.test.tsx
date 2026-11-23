import { act, render, screen } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceNotice } from './App';
import { AppStore } from '../stores/app-store';
import { testConfig } from '../stores/store-test-fixtures';

let store: AppStore;
afterEach(() => {
  store?.dispose();
  vi.useRealTimers();
});

it('waits before labelling a restored workspace as reconnecting', () => {
  vi.useFakeTimers();
  store = new AppStore(testConfig);
  render(<WorkspaceNotice store={store} />);
  act(() => {
    store.sessionStore.catalogCached.value = true;
  });
  expect(screen.queryByTestId('workspace-notice')).toBeNull();
  act(() => {
    vi.advanceTimersByTime(999);
  });
  expect(screen.queryByTestId('workspace-notice')).toBeNull();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByTestId('workspace-notice')).toHaveTextContent('reconnecting');
});

it('never shows the reconnecting label when startup settles quickly', () => {
  vi.useFakeTimers();
  store = new AppStore(testConfig);
  render(<WorkspaceNotice store={store} />);
  act(() => {
    store.sessionStore.catalogCached.value = true;
  });
  act(() => {
    vi.advanceTimersByTime(300);
  });
  act(() => {
    store.sessionStore.catalogCached.value = false;
  });
  act(() => {
    vi.advanceTimersByTime(2_000);
  });
  expect(screen.queryByTestId('workspace-notice')).toBeNull();
});

it('shows failures at once', () => {
  store = new AppStore(testConfig);
  render(<WorkspaceNotice store={store} />);
  act(() => {
    store.workspaceShown.value = true;
    store.startupFailed.value = true;
  });
  expect(screen.getByTestId('workspace-notice')).toHaveTextContent("Couldn't reach term-llm");
});
