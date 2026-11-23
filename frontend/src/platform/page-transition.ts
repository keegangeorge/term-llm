/**
 * Switching Hub nodes is a full page load. The cross-document view transition
 * in shell.css keeps the previous page on screen and holds the new page
 * transparent while it boots; once the workspace has painted, fade it in so
 * the switch reads as one crossfade rather than a reload. If this never runs
 * (startup fails or is slow), the CSS hold fades in on its own.
 */
export const PAGE_TRANSITION_FADE_MS = 160;

export interface PageReadiness {
  workspaceVisible: boolean;
  authRequired: boolean;
  startupFailed: boolean;
  /** The server rendered extension styles, icons or script hint. */
  extensionsExpected: boolean;
  /** Every enabled extension has activated or failed (or safe mode skipped them). */
  extensionsSettled: boolean;
}

/**
 * Whether the page has something final to show: sign-in, a startup error, or
 * the workspace once any theme extension has restyled it.
 */
export function pageTransitionReady(page: PageReadiness): boolean {
  if (page.authRequired || page.startupFailed) return true;
  return page.workspaceVisible && (!page.extensionsExpected || page.extensionsSettled);
}

/** Mirrors page-transition-hold in shell.css: 1.5s, fading over its last 15%. */
const HOLD_MS = 1_500;
const HOLD_FADE_START_MS = HOLD_MS * 0.85;

const NEW_PAGE = '::view-transition-new(root)';

function heldNewPage(): Animation[] {
  if (typeof document.getAnimations !== 'function') return [];
  return document.getAnimations().filter((animation) => {
    const effect = animation.effect as KeyframeEffect | null;
    return effect?.pseudoElement === NEW_PAGE;
  });
}

export function watchPageTransitionReveal(): () => void {
  // A restored back-forward-cache document keeps its mounted App and its ready
  // state. Its next cross-document transition arrives via pagereveal, not a
  // Preact render, so reveal that new transition too.
  const reveal = () => revealAfterPageTransition();
  reveal();
  window.addEventListener('pagereveal', reveal);
  return () => window.removeEventListener('pagereveal', reveal);
}

export function revealAfterPageTransition(): void {
  // Two frames: the first lets the workspace render, the second is its paint.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      for (const animation of heldNewPage()) {
        if (reduced) {
          animation.finish();
          continue;
        }
        // Jump to the hold's own fade (keeping any progress already made) and
        // play it in PAGE_TRANSITION_FADE_MS.
        const current = Number(animation.currentTime) || 0;
        animation.currentTime = Math.max(current, HOLD_FADE_START_MS);
        animation.updatePlaybackRate((HOLD_MS - HOLD_FADE_START_MS) / PAGE_TRANSITION_FADE_MS);
      }
    }),
  );
}
