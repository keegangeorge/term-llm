import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, getByRole, getByText, waitFor } from '@testing-library/preact';
import {
  ProxyClient,
  type ProxyState,
  type MoneyPeriod,
  type MoneySummary,
} from '../src/api/proxy-client';
import type { MoneyTimeline, TimelineSeries } from '../src/api/proxy-timeline';
import { homeView, moneyAmount, moneyLabel } from './home';
import { timelineView } from './timeline';
import type { TimelinePrefs } from './timeline-prefs';
import type { UIContext } from './dom';

function series(extra: Partial<TimelineSeries> = {}): TimelineSeries {
  return {
    key: 'client-a',
    label: 'Kitchen Mac',
    costs: [{ currency: 'USD', micros: 1200000, estimated: true }],
    tokens: 1500,
    unknown_cost: 0,
    unknown_tokens: 0,
    plan: 0,
    ...extra,
  };
}
function data(rows = [series()]): MoneyTimeline {
  return {
    timezone: 'Australia/Sydney',
    range: '30d',
    start: '2026-10-18T13:00:00Z',
    end: '2026-11-17T01:00:00Z',
    currencies: ['USD'],
    buckets: [
      {
        start: '2026-11-15T13:00:00Z',
        end: '2026-11-16T13:00:00Z',
        label: '16 Nov 2026 · AEDT',
        series: rows,
      },
      {
        start: '2026-11-16T13:00:00Z',
        end: '2026-11-17T01:00:00Z',
        label: '17 Nov 2026 · AEDT',
        series: [],
      },
    ],
  };
}
function context(): UIContext {
  return {
    run: async (action) => {
      try {
        await action();
        return true;
      } catch {
        return false;
      }
    },
    refresh: vi.fn(),
    announce: vi.fn(),
    navigate: vi.fn(),
    protectToken: vi.fn(),
  };
}
function mount(
  initial = data(),
  load = vi.fn().mockResolvedValue(data()),
  prefs: TimelinePrefs = { metric: 'cost', range: initial.range, group: 'model' },
) {
  const view = timelineView(initial, load, prefs);
  document.body.append(view);
  return { view, load };
}
afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, '', window.location.pathname);
  vi.restoreAllMocks();
});
it('defaults to a time bar chart, cost and 30 days, with native top controls', () => {
  const { view } = mount();
  expect(getByRole(view, 'button', { name: 'Cost' })).toHaveAttribute('aria-pressed', 'true');
  expect(getByRole(view, 'button', { name: 'Tokens' })).toHaveAttribute('aria-pressed', 'false');
  expect(getByRole(view, 'button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true');
  expect(getByRole(view, 'button', { name: '7d' })).toHaveAttribute('aria-pressed', 'false');
  expect(getByRole(view, 'button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false');
  expect(getByRole(view, 'combobox', { name: 'Grouping' })).toHaveValue('model');
  expect(view.querySelectorAll('[data-bucket]')).toHaveLength(2);
  expect(view.querySelector('.timeline-total')).toHaveTextContent('≈ US$1.20');
  expect(view.querySelector('details')).toBeNull();
  expect(view.querySelector('.timeline-footer')).toHaveTextContent('Australia/Sydney');
  expect(view.querySelector('table')).toBeNull();
});
it('shows a compact empty state with working controls instead of empty chart targets', async () => {
  const { view } = mount(data([]));
  expect(view.querySelector('.timeline-plot')).toHaveTextContent('No proxy activity');
  expect(view.querySelector('[data-bucket]')).toBeNull();
  expect(view.querySelector('.timeline-tooltip')).toBeEmptyDOMElement();
  fireEvent.click(getByRole(view, 'button', { name: '7d' }));
  await waitFor(() => expect(view.querySelectorAll('[data-bucket]')).toHaveLength(2));
});
it('selects by pointer, tap and keyboard, showing amounts, clients and missing counts', () => {
  const { view } = mount(data([series({ unknown_cost: 2 })]));
  const bar = view.querySelector('[data-bucket="0"]')!;
  fireEvent.click(bar);
  expect(bar).toHaveAttribute('aria-pressed', 'true');
  const tooltip = view.querySelector('.timeline-tooltip');
  expect(tooltip?.querySelector('.timeline-tooltip-row')).toHaveTextContent('Kitchen Mac');
  expect(tooltip?.querySelector('.timeline-tooltip-row b')).toHaveTextContent('≥ US$1.20');
  expect(tooltip?.querySelector('.timeline-tooltip-note')).toHaveTextContent(
    '2 requests with incomplete cost data',
  );
  expect(view.querySelector('.timeline-total')).toHaveTextContent('≥ US$1.20');
  fireEvent.keyDown(bar, { key: 'ArrowRight' });
  expect(view.querySelector('[data-bucket="1"]')).toHaveFocus();
  expect(view.querySelector('.timeline-tooltip')).toHaveTextContent('No activity');
});
it('keeps bucket details dismissed when the pointer is exposed to the chart underneath', () => {
  const { view } = mount();
  const first = view.querySelector('[data-bucket="0"]')!;
  const second = view.querySelector('[data-bucket="1"]')!;
  const tip = view.querySelector('.timeline-tooltip')!;
  fireEvent.click(first);
  fireEvent.click(getByRole(view, 'button', { name: 'Dismiss bucket details' }));
  expect(tip).toHaveAttribute('hidden');
  expect(first).toHaveFocus();
  // Removing the card can expose a slot and dispatch a boundary event without mouse motion.
  fireEvent.pointerEnter(second);
  expect(tip).toHaveAttribute('hidden');
  fireEvent.pointerMove(second);
  expect(tip).not.toHaveAttribute('hidden');
  expect(second).toHaveAttribute('aria-pressed', 'true');
});
it('shows the interval’s top 20 by the active metric and currency without truncating its total', () => {
  const rows = Array.from({ length: 22 }, (_, i) =>
    series({
      key: `model-${i}`,
      label: `Model ${i}`,
      costs: [
        { currency: 'USD', micros: i * 1_000_000, estimated: false },
        { currency: 'AUD', micros: (i === 7 ? 100 : i) * 1_000_000, estimated: false },
      ],
      tokens: 22 - i,
    }),
  );
  const initial = data(rows);
  initial.currencies = ['USD', 'AUD'];
  initial.buckets[1]!.series = [
    series({ ...rows[0]!, costs: [{ currency: 'USD', micros: 500_000_000, estimated: false }] }),
  ];
  const { view } = mount(initial);
  const hover = (i: number) => fireEvent.pointerMove(view.querySelector(`[data-bucket="${i}"]`)!);
  const tip = view.querySelector<HTMLElement>('.timeline-tooltip')!;
  const names = () =>
    Array.from(tip.querySelectorAll('.timeline-tooltip-row span'), (el) => el.textContent);
  hover(0);
  expect(tip).toHaveTextContent('Top 20 of 22');
  expect(names()).toEqual(
    rows
      .slice(2)
      .reverse()
      .map((row) => row.label),
  );
  expect(tip.querySelector('.timeline-tooltip-total')).toHaveTextContent('US$231.00');
  const more = tip.querySelector('details')!;
  expect(more.querySelector('summary')).toHaveTextContent('2 more contributors');
  more.open = true;
  fireEvent(more, new Event('toggle'));
  expect(names().slice(20)).toEqual(['Model 1', 'Model 0']);
  hover(1);
  expect(names()).toEqual(['Model 0']);
  expect(tip).not.toHaveTextContent('Top 20');
  expect(tip.querySelector('summary')).toBeNull();
  fireEvent.change(getByRole(view, 'combobox', { name: 'Currency' }), { target: { value: 'AUD' } });
  hover(0);
  expect(names()[0]).toBe('Model 7');
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  hover(0);
  expect(names()).toEqual(rows.slice(0, 20).map((row) => row.label));
});
it('uses actual usage tokens without double counting cache/reasoning client-side', () => {
  const { view } = mount();
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(view.querySelector('.timeline-total')).toHaveTextContent('1,500 tokens');
  fireEvent.click(view.querySelector('[data-bucket="0"]')!);
  expect(view.querySelector('.timeline-tooltip')).toHaveTextContent('1,500 tokens');
});
it('never fabricates zero for legacy missing tokens or unpriced/plan-only costs', () => {
  const { view } = mount(
    data([series({ costs: [], tokens: undefined, unknown_cost: 1, unknown_tokens: 1, plan: 1 })]),
  );
  expect(view.querySelector('.timeline-total')).toHaveTextContent('Not measured');
  expect(view.querySelector('.timeline-footer')).toHaveTextContent(
    '1 request with incomplete cost data',
  );
  expect(view.querySelector('.timeline-plot svg circle')).toBeNull();
  const slot = view.querySelector('[data-bucket="0"]')!;
  expect(slot.querySelectorAll('rect')).toHaveLength(1); // Only the hit target, not a zero bar.
  fireEvent.focus(slot);
  expect(view.querySelector('.timeline-tooltip')).toHaveTextContent('Not measured');
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(view.querySelector('.timeline-total')).toHaveTextContent('Not measured');
  expect(view.querySelector('.timeline-footer')).toHaveTextContent(
    '1 request with incomplete token data',
  );
  expect(view.textContent).not.toContain('0 tokens');
});
it('plots plan estimates by default and identifies the plan amount without calling it spending', () => {
  const { view } = mount(
    data([
      series({
        costs: [{ currency: 'USD', micros: 30000, estimated: true, plan_estimate_micros: 20000 }],
        plan: 1,
      }),
    ]),
  );
  expect(getByRole(view, 'heading', { level: 2 })).toHaveTextContent('Cost incl. plan estimates');
  expect(view.querySelector('.timeline-total')).toHaveTextContent('≈ US$0.03');
  expect(view).toHaveTextContent('Plan estimates aren’t charges.');
  fireEvent.click(view.querySelector('[data-bucket="0"]')!);
  expect(view.querySelector('.timeline-tooltip')).toHaveTextContent('US$0.02 plan estimate');
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(getByRole(view, 'heading', { level: 2 })).toHaveTextContent('Tokens');
  expect(view.querySelector('.timeline-tooltip')).not.toHaveTextContent('plan estimate');
  expect(view.querySelector('.timeline-heading small')).not.toBeVisible();
});
it('separates currencies explicitly and never sums USD with AUD', () => {
  const initial = data([
    series({
      costs: [
        { currency: 'USD', micros: 1000000, estimated: true },
        { currency: 'AUD', micros: 7000000, estimated: false },
      ],
    }),
  ]);
  initial.currencies = ['USD', 'AUD'];
  const { view } = mount(initial);
  expect(view.querySelector('.timeline-total')).toHaveTextContent('US$1.00');
  fireEvent.change(getByRole(view, 'combobox', { name: 'Currency' }), { target: { value: 'AUD' } });
  expect(view.querySelector('.timeline-total')).toHaveTextContent('A$7.00');
  expect(view.querySelector('.timeline-total')).not.toHaveTextContent('8.00');
});
it('compares the current metric with the previous range when a baseline is available', () => {
  const initial = data([
    series({ costs: [{ currency: 'USD', micros: 1200000, estimated: false }] }),
  ]);
  initial.previous = series({
    costs: [{ currency: 'USD', micros: 1000000, estimated: false }],
    tokens: 2000,
  });
  const { view } = mount(initial);
  const badge = view.querySelector('.timeline-delta');
  expect(badge).toBeVisible();
  expect(badge).toHaveTextContent(/\+20%/);
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(badge).toHaveTextContent(/-25%/);
});
it('omits the previous-period comparison for incomplete costs or a zero token baseline', () => {
  const initial = data([
    series({ costs: [{ currency: 'USD', micros: 1200000, estimated: false }], unknown_cost: 1 }),
  ]);
  initial.previous = series({
    costs: [{ currency: 'USD', micros: 1000000, estimated: false }],
    tokens: 0,
  });
  const { view } = mount(initial);
  const badge = view.querySelector('.timeline-delta');
  expect(badge).not.toBeVisible();
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(badge).not.toBeVisible();
});
it('sorts grouped amounts over all buckets and keeps unknown costs distinct from measured zero', () => {
  const initial = data([
    series({
      key: 'small',
      label: 'Small',
      costs: [
        { currency: 'USD', micros: 1000000, estimated: false },
        { currency: 'AUD', micros: 9000000, estimated: false },
      ],
    }),
    series({ key: 'missing', label: 'Missing', costs: [], unknown_cost: 1 }),
    series({
      key: 'free',
      label: 'Free',
      costs: [{ currency: 'USD', micros: 0, estimated: false }],
    }),
    series({
      key: 'large',
      label: 'Large',
      costs: [{ currency: 'USD', micros: 800000, estimated: false }],
    }),
  ]);
  initial.currencies = ['USD', 'AUD'];
  initial.buckets[1]!.series = [
    series({
      key: 'large',
      label: 'Large',
      costs: [{ currency: 'USD', micros: 2200000, estimated: false }],
    }),
  ];
  const { view } = mount(initial);
  const rows = () =>
    [...view.querySelectorAll('.timeline-breakdown li')].map((row) => ({
      name: row.querySelector('.timeline-breakdown-name')?.textContent,
      amount: row.querySelector('b')?.textContent,
      share: row.querySelector('.timeline-breakdown-share')?.textContent,
    }));
  expect(view.querySelector('.timeline-total')).toHaveTextContent('≥ US$4.00');
  expect(rows()).toEqual([
    { name: 'Large', amount: 'US$3.00', share: '75%' },
    { name: 'Small', amount: 'US$1.00', share: '25%' },
    { name: 'Free', amount: 'US$0.00', share: '0%' },
    { name: 'Missing', amount: 'Not measured', share: '' },
  ]);
  fireEvent.change(getByRole(view, 'combobox', { name: 'Currency' }), { target: { value: 'AUD' } });
  expect(view.querySelector('.timeline-total')).toHaveTextContent('A$9.00');
  expect(rows()[0]).toEqual({ name: 'Small', amount: 'A$9.00', share: '100%' });
  expect(view.querySelector('.timeline-breakdown')).not.toHaveTextContent('US$');
});
it('offers model grouping for both cost and token metrics', async () => {
  const { view, load } = mount(data(), undefined, { metric: 'cost', range: '30d', group: 'total' });
  fireEvent.change(getByRole(view, 'combobox', { name: 'Grouping' }), {
    target: { value: 'model' },
  });
  await waitFor(() => expect(load).toHaveBeenCalledWith('30d', 'model'));
  expect(view.querySelector('.timeline-breakdown')).toHaveTextContent('Kitchen Mac');
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(view.querySelector('.timeline-total')).toHaveTextContent('1,500 tokens');
  expect(view.querySelector('.timeline-breakdown')).toHaveTextContent('Kitchen Mac');
});
it('formats tooltip and accessible bucket label in the returned local timezone', () => {
  const { view } = mount();
  const bar = view.querySelector<SVGGElement>('[data-bucket="0"]')!;
  fireEvent.click(bar);
  expect(view.querySelector('.timeline-tooltip')).toHaveTextContent('Nov 16, 2026');
  expect(bar.getAttribute('aria-label')).toBe(
    view.querySelector('.timeline-tooltip strong')?.textContent,
  );
  expect(view.querySelector('.timeline-tooltip')).not.toHaveTextContent('+0000');
});

it('includes minutes and offset for hourly buckets while keeping axis ticks compact', () => {
  const hourly = data();
  hourly.range = 'today';
  hourly.timezone = 'Australia/Lord_Howe';
  hourly.buckets = [
    {
      start: '2026-10-03T15:30:00Z',
      end: '2026-10-03T16:00:00Z',
      label: 'server label',
      series: [series()],
    },
  ];
  const { view } = mount(hourly);
  const bar = view.querySelector<SVGGElement>('[data-bucket="0"]')!;
  expect(bar.getAttribute('aria-label')).toContain('2:30 AM GMT+11');
  fireEvent.click(bar);
  expect(view.querySelector('.timeline-tooltip strong')).toHaveTextContent('2:30 AM GMT+11');
  const ticks = [...view.querySelectorAll('.timeline-axis')].map((tick) => tick.textContent);
  expect(ticks).toContain('2:30 AM');
  expect(ticks.some((tick) => tick?.includes('GMT'))).toBe(false);
});

it('requests real range/group changes instead of reshaping month summaries', async () => {
  const { view, load } = mount();
  fireEvent.click(getByRole(view, 'button', { name: '7d' }));
  await waitFor(() => expect(load).toHaveBeenCalledWith('7d', 'model'));
  fireEvent.change(getByRole(view, 'combobox', { name: 'Grouping' }), {
    target: { value: 'client' },
  });
  await waitFor(() => expect(load).toHaveBeenCalledWith('7d', 'client'));
});
it('retains stable distinct colours when range/metric changes within the dashboard', async () => {
  const initial = data([series(), series({ key: 'b', label: 'Studio' })]);
  const reversed = data([...initial.buckets[0]!.series].reverse());
  const load = vi.fn().mockResolvedValue({ ...reversed, range: '7d' });
  const { view } = mount(initial, load);
  const colours = () =>
    [...view.querySelectorAll<HTMLElement>('.timeline-breakdown li')].map((row) => [
      row.querySelector('.timeline-breakdown-name')?.textContent,
      row.querySelector<HTMLElement>('.timeline-swatch')?.style.backgroundColor,
    ]);
  const before = colours();
  expect(new Set(before.map(([, colour]) => colour)).size).toBe(2);
  fireEvent.click(getByRole(view, 'button', { name: '7d' }));
  await waitFor(() => expect(view).toHaveAttribute('aria-busy', 'false'));
  expect(load).toHaveBeenCalledWith('7d', 'model');
  expect(colours()).toEqual(before);
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(colours()).toEqual(before);
});
it('hides stale data and exposes unavailable rather than a zero on fetch failure', async () => {
  const { view } = mount(data(), vi.fn().mockRejectedValue(new Error('offline')));
  fireEvent.click(getByRole(view, 'button', { name: '7d' }));
  await waitFor(() =>
    expect(view.querySelector('.timeline-total')).toHaveTextContent('Unavailable'),
  );
  expect(view.querySelector('svg')).toBeNull();
});
it('ignores superseded timeline responses', async () => {
  let resolve!: (d: MoneyTimeline) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<MoneyTimeline>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce(data([series({ tokens: 4000 })]));
  const { view } = mount(data(), load);
  fireEvent.click(getByRole(view, 'button', { name: '7d' }));
  fireEvent.click(getByRole(view, 'button', { name: 'Today' }));
  await waitFor(() => expect(view).toHaveAttribute('aria-busy', 'false'));
  resolve(data([series({ tokens: 99999 })]));
  await Promise.resolve();
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(view.querySelector('.timeline-total')).toHaveTextContent('4,000 tokens');
});
it('Home loads the authenticated timeline, with retry after failure', async () => {
  const api = new ProxyClient(vi.fn());
  vi.spyOn(api, 'summary').mockRejectedValue(new Error('summary unavailable'));
  vi.spyOn(api, 'timeline').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(data());
  const view = homeView({ routes: [], mode: 'file' } as unknown as ProxyState, api, context());
  document.body.append(view);
  await waitFor(() => expect(view.textContent).toContain('Chart unavailable'));
  fireEvent.click(getByRole(view, 'button', { name: 'Retry' }));
  await waitFor(() => expect(view.querySelector('svg')).not.toBeNull());
  expect(getByRole(view, 'combobox', { name: 'Grouping' })).toHaveValue('model');
  expect(api.timeline).toHaveBeenCalledWith(
    '30d',
    'model',
    Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
  );
});
it('uses the existing authenticated no-store transport for timeline and money settings', async () => {
  const fetcher = vi.fn<typeof fetch>();
  fetcher
    .mockResolvedValueOnce(new Response(JSON.stringify({ csrf: 'session-csrf' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(data())))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const api = new ProxyClient(fetcher);
  await api.login('admin');
  await api.timeline('7d', 'client', 'Australia/Sydney');
  await api.money({ timezone: 'UTC' });
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    '/_proxy/api/timeline?range=7d&group=client&timezone=Australia%2FSydney',
    expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      method: 'GET',
    }),
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    3,
    '/_proxy/api/money',
    expect.objectContaining({
      headers: expect.objectContaining({ 'X-CSRF-Token': 'session-csrf' }),
    }),
  );
});
it('keeps exact money/request classification and tiny amounts without inventing missing zeros', () => {
  expect(moneyAmount(1, 'USD')).toBe('US$0.000001');
  expect(moneyAmount(1, '$')).toBe('Amount unavailable');
  expect(moneyAmount(Number.MAX_SAFE_INTEGER + 1, 'USD')).toBe('Amount unavailable');
  expect(moneyLabel({ billing: 'pay_as_you_go', kind: 'estimated' })).toBe('Amount unavailable');
  expect(moneyLabel({ billing: 'plan', kind: 'unmeasured' })).toContain('not fully measured');
  expect(moneyLabel({ billing: 'plan', kind: 'no_charge_expected' })).toContain(
    'Blocked before dispatch',
  );
});

it('keeps missing counts additive exactly once across grouped series', () => {
  const { view } = mount(
    data([series({ unknown_cost: 1 }), series({ key: 'other', label: 'Studio', unknown_cost: 0 })]),
  );
  const incomplete = '1 request with incomplete cost data';
  expect(view.querySelector('.timeline-footer')).toHaveTextContent(incomplete);
  fireEvent.click(view.querySelector('[data-bucket="0"]')!);
  expect(view.querySelector('.timeline-tooltip')?.textContent?.split(incomplete)).toHaveLength(2);
});
it('does not restore stale data when metric changes after a failed range request', async () => {
  const { view } = mount(data(), vi.fn().mockRejectedValue(new Error('offline')));
  fireEvent.click(getByRole(view, 'button', { name: '7d' }));
  await waitFor(() =>
    expect(view.querySelector('.timeline-total')).toHaveTextContent('Unavailable'),
  );
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(view.querySelector('svg')).toBeNull();
});
it('refuses imprecise cross-bucket totals instead of rounding enormous token history', () => {
  const initial = data([series({ tokens: Number.MAX_SAFE_INTEGER })]);
  initial.buckets.push({ ...initial.buckets[0]!, series: [series({ tokens: 1 })] });
  const { view } = mount(initial);
  fireEvent.click(getByRole(view, 'button', { name: 'Tokens' }));
  expect(view.querySelector('.timeline-total')).toHaveTextContent('Amount unavailable');
  expect(view.querySelector('svg')).toBeNull();
});

it('keeps grouping colour caches independent and all active legend colours distinct', async () => {
  const clientData = data(
    Array.from({ length: 6 }, (_, i) => series({ key: 'c' + i, label: 'Client ' + i })),
  );
  const providerData = data(
    Array.from({ length: 6 }, (_, i) => series({ key: 'p' + i, label: 'Provider ' + i })),
  );
  const load = vi
    .fn()
    .mockResolvedValueOnce(clientData)
    .mockResolvedValueOnce(providerData)
    .mockResolvedValueOnce(clientData);
  const { view } = mount(data(), load);
  const colours = () =>
    [...view.querySelectorAll<HTMLElement>('.timeline-breakdown .timeline-swatch')].map(
      (n) => n.style.backgroundColor,
    );
  fireEvent.change(getByRole(view, 'combobox', { name: 'Grouping' }), {
    target: { value: 'client' },
  });
  await waitFor(() => expect(view).toHaveAttribute('aria-busy', 'false'));
  const before = colours();
  expect(new Set(before).size).toBe(6);
  fireEvent.change(getByRole(view, 'combobox', { name: 'Grouping' }), {
    target: { value: 'provider' },
  });
  await waitFor(() => expect(view).toHaveAttribute('aria-busy', 'false'));
  expect(new Set(colours()).size).toBe(6);
  fireEvent.change(getByRole(view, 'combobox', { name: 'Grouping' }), {
    target: { value: 'client' },
  });
  await waitFor(() => expect(view).toHaveAttribute('aria-busy', 'false'));
  expect(colours()).toEqual(before);
});

function period(extra: Partial<MoneyPeriod> = {}): MoneyPeriod {
  return {
    totals: [],
    requests: 0,
    included: 0,
    plan_unmeasured: 0,
    local: 0,
    unpriced: 0,
    unmeasured: 0,
    unspecified: 0,
    no_charge_expected: 0,
    ...extra,
  };
}
function summary(extra: Partial<MoneySummary> = {}): MoneySummary {
  return {
    asof: '2026-11-17T01:00:00Z',
    timezone: 'Australia/Sydney',
    month_label: 'November 2026',
    month: period(),
    today: period(),
    devices: [],
    apps: [],
    providers: [],
    ...extra,
  };
}
function home(initial: MoneySummary) {
  const api = new ProxyClient(vi.fn());
  vi.spyOn(api, 'timeline').mockResolvedValue(data());
  const loadSummary = vi.spyOn(api, 'summary').mockResolvedValue(initial);
  const view = homeView({ routes: [], mode: 'file' } as unknown as ProxyState, api, context());
  document.body.append(view);
  return { view, loadSummary };
}
async function openEstimates(view: HTMLElement) {
  const label = await waitFor(() => getByText(view, 'Plan estimates at API rates'));
  const panel = label.closest('details')!;
  expect(panel.open).toBe(false);
  fireEvent.click(label);
  expect(panel.open).toBe(true);
  return panel;
}
it('Home loads plan totals and coverage only when requested', async () => {
  const equivalent = {
    currency: 'USD',
    total_micros: 9000000,
    charged_micros: 0,
    estimated_micros: 9000000,
    floor_micros: 0,
    qualifier: 'at_least' as const,
    sources: [{ source: 'Published API card', asof: '2026-11-17', kind: 'estimated' }],
  };
  const { view, loadSummary } = home(
    summary({
      month: period({
        api_equivalent_totals: [equivalent],
        api_equivalent_covered: 2,
        api_equivalent_unpriced: 1,
        totals: [{ ...equivalent, total_micros: 777000000 }],
      }),
      today: period({
        api_equivalent_totals: [
          { ...equivalent, total_micros: 0, qualifier: 'about', sources: [] },
        ],
        api_equivalent_covered: 1,
        api_equivalent_unpriced: 0,
      }),
    }),
  );
  await waitFor(() => expect(view.querySelector('svg')).not.toBeNull());
  expect(loadSummary).not.toHaveBeenCalled();
  const panel = await openEstimates(view);
  await waitFor(() => expect(panel).toHaveTextContent('November 2026: ≥ US$9.00'));
  expect(panel).toHaveTextContent('Today: ≈ US$0.00');
  expect(panel).toHaveTextContent('2 priced · 1 unpriced');
  expect(panel).not.toHaveTextContent('0 unpriced');
  const pricing = panel.querySelector('details')!;
  expect(pricing.open).toBe(false);
  expect(getByText(pricing, /Published API card · 2026-11-17/)).not.toBeVisible();
  fireEvent.click(getByText(pricing, 'Price details'));
  expect(getByText(pricing, /Published API card · 2026-11-17/)).toBeVisible();
  expect(panel).not.toHaveTextContent('US$777');
  expect(view.querySelector('.timeline-total')).toHaveTextContent('US$1.20');
  expect(loadSummary).toHaveBeenCalledOnce();
});
it('Home preserves unknown and legacy plan equivalence rather than filling in zero or sources', async () => {
  const { view } = home(
    summary({ month: period({ api_equivalent_covered: 0, api_equivalent_unpriced: 3 }) }),
  );
  const panel = await openEstimates(view);
  await waitFor(() => expect(panel).toHaveTextContent('November 2026: No estimate · 3 unpriced'));
  expect(panel).toHaveTextContent('Today: No estimate');
  expect(panel).not.toHaveTextContent('Unknown');
  expect(panel).not.toHaveTextContent('US$0');
  expect(panel.querySelector('details')).toBeNull();
});
it('Home keeps the chart usable when plan totals fail and lets the user retry', async () => {
  const { view, loadSummary } = home(summary());
  loadSummary.mockRejectedValueOnce(new Error('offline'));
  const panel = await openEstimates(view);
  const retry = await waitFor(() => getByRole(panel, 'button', { name: 'Retry plan estimates' }));
  expect(panel).toHaveTextContent('Plan estimates unavailable.');
  expect(view.querySelector('svg')).not.toBeNull();
  expect(view.querySelector('.timeline-total')).toHaveTextContent('US$1.20');
  fireEvent.click(retry);
  await waitFor(() => expect(panel).toHaveTextContent('Today: No estimate'));
  expect(loadSummary).toHaveBeenCalledTimes(2);
});
