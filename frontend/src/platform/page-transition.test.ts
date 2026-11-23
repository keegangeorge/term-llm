import { afterEach, expect, it, vi } from 'vitest';
import {
  pageTransitionReady,
  revealAfterPageTransition,
  watchPageTransitionReveal,
} from './page-transition';
import { extensionsExpected } from '../api/extensions';

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'getAnimations');
  document.head.querySelector('meta[name="term-llm-extension-scripts"]')?.remove();
});

function stubFrames() {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
}

function heldAnimation(pseudoElement: string, currentTime = 100) {
  return {
    effect: { pseudoElement },
    currentTime,
    finish: vi.fn(),
    updatePlaybackRate: vi.fn(),
  };
}

it('skips to the hold fade and plays it quickly once the workspace paints', () => {
  stubFrames();
  const held = heldAnimation('::view-transition-new(root)');
  const unrelated = heldAnimation('::view-transition-old(root)');
  Object.assign(document, { getAnimations: () => [held, unrelated] });
  revealAfterPageTransition();
  expect(held.currentTime).toBe(1275);
  expect(held.updatePlaybackRate).toHaveBeenCalledWith(225 / 160);
  expect(unrelated.currentTime).toBe(100);
  expect(unrelated.updatePlaybackRate).not.toHaveBeenCalled();
});

it('keeps fallback fade progress rather than restarting it', () => {
  stubFrames();
  const held = heldAnimation('::view-transition-new(root)', 1400);
  Object.assign(document, { getAnimations: () => [held] });
  revealAfterPageTransition();
  expect(held.currentTime).toBe(1400);
});

it('reveals at once for reduced motion', () => {
  stubFrames();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
  const held = heldAnimation('::view-transition-new(root)');
  Object.assign(document, { getAnimations: () => [held] });
  revealAfterPageTransition();
  expect(held.finish).toHaveBeenCalled();
  expect(held.updatePlaybackRate).not.toHaveBeenCalled();
});

it('reveals again when a ready page returns from the back-forward cache', () => {
  stubFrames();
  const held = heldAnimation('::view-transition-new(root)');
  Object.assign(document, { getAnimations: () => [held] });
  const stop = watchPageTransitionReveal();
  expect(held.updatePlaybackRate).toHaveBeenCalledTimes(1);
  held.updatePlaybackRate.mockClear();
  window.dispatchEvent(new Event('pagereveal'));
  expect(held.updatePlaybackRate).toHaveBeenCalledTimes(1);
  stop();
  held.updatePlaybackRate.mockClear();
  window.dispatchEvent(new Event('pagereveal'));
  expect(held.updatePlaybackRate).not.toHaveBeenCalled();
});

it('waits for a JS-only extension announced by the server', () => {
  expect(extensionsExpected()).toBe(false);
  const hint = document.createElement('meta');
  hint.name = 'term-llm-extension-scripts';
  document.head.append(hint);
  expect(extensionsExpected()).toBe(true);
});

it('reveals the workspace only once a theme extension has restyled it', () => {
  const page = {
    workspaceVisible: true,
    authRequired: false,
    startupFailed: false,
    extensionsExpected: true,
    extensionsSettled: false,
  };
  expect(pageTransitionReady(page)).toBe(false);
  expect(pageTransitionReady({ ...page, extensionsSettled: true })).toBe(true);
  expect(pageTransitionReady({ ...page, extensionsExpected: false })).toBe(true);
  expect(pageTransitionReady({ ...page, workspaceVisible: false, extensionsSettled: true })).toBe(
    false,
  );
  // Sign-in and startup errors never wait for extensions, which only load after startup.
  expect(pageTransitionReady({ ...page, workspaceVisible: false, authRequired: true })).toBe(true);
  expect(pageTransitionReady({ ...page, workspaceVisible: false, startupFailed: true })).toBe(true);
});
