import type {
  ChartGroup,
  ChartRange,
  MoneyTimeline,
  TimelineSeries,
} from '../src/api/proxy-timeline';
import { button, el } from './dom';
import { moneyAmount } from './home';
import { breakdownView, shareRows } from './timeline-breakdown';
import { drawChart } from './timeline-chart';
import { groupingLabels, periodLabels, timelineControls } from './timeline-controls';
import { defaultTimelinePrefs, type TimelinePrefs } from './timeline-prefs';
import { timelineTooltip } from './timeline-tooltip';
import { aggregateTokenMix, tokenMixText, tokenMixView } from './timeline-tokens';

const palette = ['#5b5bd6', '#10a37f', '#3b82f6', '#a78bfa', '#d3800f', '#75859b'];
const compactNumber = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const comparison = new Intl.NumberFormat(undefined, {
  style: 'percent',
  signDisplay: 'exceptZero',
  maximumFractionDigits: 1,
});
let chartSequence = 0;

function safeAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 0;
}

function summarize<T>(
  items: T[],
  value: (item: T) => number | undefined,
  unknown: (item: T) => number,
  estimated: (item: T) => boolean,
) {
  let amount: number | undefined;
  let unsafe = false;
  let missing = 0;
  let estimate = false;
  for (const item of items) {
    const measured = value(item);
    if (measured !== undefined) {
      amount = (amount ?? 0) + measured;
      unsafe ||= !safeAmount(measured) || !safeAmount(amount);
    }
    missing += unknown(item);
    estimate ||= estimated(item);
  }
  return { amount, unsafe, unknown: missing, estimated: estimate };
}

/** `initial` was loaded with the supplied preferences; standalone callers default to Total. */
export function timelineView(
  initial: MoneyTimeline,
  load: (range: ChartRange, group: ChartGroup) => Promise<MoneyTimeline>,
  prefs?: TimelinePrefs,
  onChange?: (prefs: TimelinePrefs) => void,
  details?: HTMLElement[],
): HTMLElement {
  const defaults = prefs
    ? defaultTimelinePrefs
    : { ...defaultTimelinePrefs, group: 'total' as const };
  let settings = prefs ? { ...prefs } : { ...defaults, range: initial.range };
  let data = initial;
  let currency = 'USD';
  let selected = -1;
  let hoverSelection = false;
  let restoringFocus = false;
  let sequence = 0;
  let phase: 'ready' | 'loading' | 'failed' = 'ready';
  const uid = `timeline-bars-${++chartSequence}`;
  const colourGroups: Partial<Record<ChartGroup, Map<string, string>>> = {};
  function colour(key: string): string {
    if (settings.group === 'total') return palette[0]!;
    const cache = (colourGroups[settings.group] ??= new Map());
    if (!cache.has(key)) {
      let hash = 0;
      for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      if (cache.size >= palette.length) {
        const extra = `hsl(${hash % 360} 57% ${40 + (Math.floor(hash / 360) % 3) * 7}%)`;
        cache.set(key, extra);
        return extra;
      }
      let index = hash % palette.length;
      for (let n = 0; n < palette.length && [...cache.values()].includes(palette[index]!); n++)
        index = (index + 1) % palette.length;
      cache.set(key, palette[index]!);
    }
    return cache.get(key)!;
  }

  const view = el('div');
  view.className = 'timeline';
  const titleText = document.createTextNode('');
  const period = el('span');
  period.className = 'timeline-period';
  // The selected range is already announced by the range controls.
  period.setAttribute('aria-hidden', 'true');
  const title = el('h2', titleText, period);
  title.tabIndex = -1;
  const total = el('p');
  total.className = 'timeline-total';
  const delta = el('span');
  delta.className = 'timeline-delta';
  delta.hidden = true;
  const totalRow = el('div', total, delta);
  totalRow.className = 'timeline-total-row';
  const planNote = el('small', 'Plan estimates aren’t charges.');
  const summary = el('div', title, totalRow, planNote);
  summary.className = 'timeline-summary';
  const controls = timelineControls(change, reset);
  const heading = el('div', summary, controls.view);
  heading.className = 'timeline-heading';
  const plot = el('div');
  plot.className = 'timeline-plot';
  const tooltip = timelineTooltip(() => dismiss(true));
  plot.append(tooltip.view);
  const body = el('div', plot);
  body.className = 'timeline-body';
  const timezone = el('span');
  timezone.className = 'timeline-timezone';
  const status = el('span');
  status.role = 'status';
  status.className = 'timeline-status';
  const disclosures = el('div', ...(details ?? []));
  disclosures.className = 'timeline-details';
  disclosures.hidden = !details?.length;
  const footer = el('div', timezone, status, disclosures);
  footer.className = 'timeline-footer';
  const mixSlot = el('div');
  view.append(heading, mixSlot, body, footer);

  function cost(series: TimelineSeries) {
    return series.costs.find((entry) => entry.currency === currency);
  }
  function value(series: TimelineSeries): number | undefined {
    return settings.metric === 'tokens' ? series.tokens : cost(series)?.micros;
  }
  function unknown(series: TimelineSeries): number {
    return settings.metric === 'cost' ? series.unknown_cost : series.unknown_tokens;
  }
  function estimated(series: TimelineSeries): boolean {
    return settings.metric === 'cost' && !!cost(series)?.estimated;
  }
  function hasPlanEstimate(series: TimelineSeries): boolean {
    return settings.metric === 'cost' && cost(series)?.plan_estimate_micros !== undefined;
  }
  function format(amount: number): string {
    if (!safeAmount(amount)) return 'Amount unavailable';
    return settings.metric === 'cost'
      ? moneyAmount(amount, currency)
      : `${amount.toLocaleString()} tokens`;
  }
  function qualified(amount: number | undefined, missing: number, estimate: boolean): string {
    return amount === undefined
      ? 'Not measured'
      : `${missing ? '≥ ' : estimate ? '≈ ' : ''}${format(amount)}`;
  }
  function incompleteData(count: number): string {
    const measure = settings.metric === 'cost' ? 'cost' : 'token';
    return `${count.toLocaleString()} ${count === 1 ? 'request' : 'requests'} with incomplete ${measure} data`;
  }
  function updateDelta(current: ReturnType<typeof summarize>, includesPlan: boolean) {
    const previous = data.previous;
    const baseline = previous ? value(previous) : undefined;
    delta.hidden = true;
    if (
      !previous ||
      baseline === undefined ||
      !safeAmount(baseline) ||
      baseline === 0 ||
      current.amount === undefined ||
      current.unsafe ||
      current.unknown ||
      current.estimated ||
      includesPlan ||
      unknown(previous) ||
      estimated(previous) ||
      hasPlanEstimate(previous)
    )
      return;
    const change = (current.amount - baseline) / baseline;
    const label = comparison.format(change);
    delta.dataset.direction = change > 0 ? 'up' : change < 0 ? 'down' : 'same';
    const prior = data.range === 'today' ? 'yesterday' : `prior ${periodLabels[data.range]}`;
    delta.textContent = `${label} vs ${prior}`;
    delta.hidden = false;
  }

  let ranks = new Map<string, number>();
  function ordered(series: TimelineSeries[]) {
    return [...series].sort((a, b) => ranks.get(a.key)! - ranks.get(b.key)!);
  }
  function bar(index: number): SVGGElement | null {
    return plot.querySelector<SVGGElement>(`[data-bucket="${index}"]`);
  }
  function inspect(index: number, refresh = false) {
    if (index === selected && !refresh) return;
    selected = index;
    for (const slot of plot.querySelectorAll<SVGGElement>('[data-bucket]')) {
      const active = Number(slot.dataset.bucket) === index;
      slot.classList.toggle('selected', active);
      slot.setAttribute('aria-pressed', String(active));
    }
    const bucket = data.buckets[index];
    const target = bar(index);
    if (!bucket || !target || phase !== 'ready') {
      tooltip.hide();
      return;
    }
    // Hover ranks this interval, independently of the range-wide stack and rail.
    const ranked = [...bucket.series].sort(
      (a, b) =>
        (value(b) ?? -1) - (value(a) ?? -1) ||
        a.label.localeCompare(b.label) ||
        a.key.localeCompare(b.key),
    );
    const detail = (row: TimelineSeries) => {
      const amount = value(row);
      const missing = unknown(row);
      const plan = hasPlanEstimate(row) ? cost(row)?.plan_estimate_micros : undefined;
      return {
        series: row,
        amount:
          amount === undefined && settings.metric === 'cost' && row.plan && !missing
            ? 'Plan activity'
            : qualified(amount, missing, estimated(row)),
        notes: [
          ...(settings.metric === 'tokens' ? [tokenMixText(aggregateTokenMix([row]))] : []),
          ...(plan === undefined ? [] : [`${format(plan)} plan estimate`]),
          ...(missing ? [incompleteData(missing)] : []),
          ...(settings.metric === 'cost' && row.plan
            ? [`${row.plan.toLocaleString()} plan ${row.plan === 1 ? 'request' : 'requests'}`]
            : []),
        ],
      };
    };
    const sum = summarize(bucket.series, value, unknown, estimated);
    tooltip.show(
      plot,
      target,
      target.getAttribute('aria-label') || bucket.label,
      ranked,
      detail,
      colour,
      sum.amount === undefined ? undefined : qualified(sum.amount, sum.unknown, sum.estimated),
    );
  }
  function focusBar(index: number) {
    restoringFocus = true;
    bar(index)?.focus({ preventScroll: true });
    restoringFocus = false;
  }
  function dismiss(restore: boolean) {
    hoverSelection = false;
    if (restore) focusBar(selected);
    inspect(-1);
  }
  plot.addEventListener('pointerleave', (event) => {
    if (event.relatedTarget instanceof Node && plot.contains(event.relatedTarget)) return;
    if (hoverSelection) dismiss(tooltip.view.contains(document.activeElement));
  });
  view.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selected !== -1) {
      event.preventDefault();
      event.stopPropagation();
      dismiss(tooltip.view.contains(document.activeElement));
    }
  });

  function replacePlot(content: Element) {
    const current = plot.firstElementChild;
    if (current && current !== tooltip.view) current.replaceWith(content);
    else plot.prepend(content);
  }
  function draw() {
    const ready = phase === 'ready';
    const currencies = ready ? data.currencies : [];
    currency =
      settings.currency && currencies.includes(settings.currency)
        ? settings.currency
        : (currencies[0] ?? 'USD');
    controls.update(
      settings,
      currencies,
      currency,
      settings.metric === defaults.metric &&
        settings.range === defaults.range &&
        settings.group === defaults.group &&
        settings.currency === undefined,
    );
    const all = ready ? data.buckets.flatMap((bucket) => bucket.series) : [];
    const includesPlan = all.some(hasPlanEstimate);
    titleText.data =
      settings.metric === 'tokens' ? 'Tokens' : includesPlan ? 'Cost incl. plan estimates' : 'Cost';
    period.textContent = ` · ${periodLabels[ready ? data.range : settings.range]}`;
    planNote.hidden = !includesPlan;
    const summary = summarize(all, value, unknown, estimated);
    const invalidCurrency = settings.metric === 'cost' && !/^[A-Z]{3}$/.test(currency);
    const unsafe = summary.unsafe || invalidCurrency;
    timezone.textContent = ready ? `Times in ${data.timezone}` : '';
    status.textContent = ready && summary.unknown ? incompleteData(summary.unknown) : '';
    status.hidden = !status.textContent;
    delta.hidden = true;
    mixSlot.replaceChildren();
    if (unsafe || !all.length) {
      total.textContent =
        phase === 'loading'
          ? 'Loading…'
          : phase === 'failed'
            ? 'Unavailable'
            : unsafe
              ? 'Amount unavailable'
              : 'No activity';
      const message = el(
        'p',
        phase === 'loading'
          ? 'Loading chart…'
          : phase === 'failed'
            ? 'Chart unavailable.'
            : unsafe
              ? 'Amount unavailable'
              : 'No proxy activity in this date range.',
      );
      message.className = 'preview';
      const content =
        phase === 'failed'
          ? el(
              'div',
              message,
              button('Retry chart', () => void reload()),
            )
          : message;
      replacePlot(content);
      if (body.lastElementChild !== plot) body.lastElementChild?.remove();
      inspect(-1, true);
      return;
    }
    total.textContent = qualified(summary.amount, summary.unknown, summary.estimated);
    updateDelta(summary, includesPlan);
    const showTokenMix = settings.metric === 'tokens';
    if (showTokenMix) mixSlot.append(tokenMixView(aggregateTokenMix(all)));
    const rows = shareRows(all, value, unknown, estimated);
    ranks = new Map(rows.map((row, index) => [row.key, index]));
    const cache = colourGroups[settings.group];
    if (cache) {
      for (const key of cache.keys()) if (!ranks.has(key)) cache.delete(key);
    }
    // Reserve the most distinct colours for the leaders; retain assignments across metric changes.
    for (const key of ranks.keys()) colour(key);
    const rail = breakdownView(
      rows,
      groupingLabels[settings.group],
      periodLabels[data.range],
      colour,
      (row) => qualified(row.amount, row.unknown, row.estimated),
      !!body.querySelector('.timeline-breakdown details[open]'),
      showTokenMix ? (row) => tokenMixText(aggregateTokenMix(row.series)) : undefined,
    );
    if (body.lastElementChild === plot) body.append(rail);
    else body.lastElementChild?.replaceWith(rail);

    const hourly = data.range === 'today';
    const date = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(hourly ? { hour: 'numeric', minute: '2-digit', timeZoneName: 'shortOffset' } : {}),
      timeZone: data.timezone,
    });
    const axis = new Intl.DateTimeFormat(undefined, {
      ...(hourly ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' }),
      timeZone: data.timezone,
    });
    const currencyTick = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      notation: 'compact',
      maximumFractionDigits: 6,
    });
    const chart = drawChart({
      data,
      width: Math.max(280, plot.clientWidth || 960),
      ordered,
      value,
      colour,
      tick: (amount) =>
        settings.metric === 'cost'
          ? currencyTick.format(amount / 1_000_000)
          : compactNumber.format(amount),
      ariaLabel: `${settings.metric === 'cost' ? `${currency} cost` : 'Tokens'} over time · ${data.timezone}`,
      bucketLabel: (start) => date.format(new Date(start)),
      axisLabel: (start, last) => {
        const label = axis.format(new Date(start));
        return last && !hourly && label === axis.format(new Date(data.end)) ? 'Today' : label;
      },
      unit: 1,
      uid,
    });
    for (const slot of chart.querySelectorAll<SVGGElement>('[data-bucket]')) {
      const index = Number(slot.dataset.bucket);
      // Layout changes (including dismissing the card) can generate pointerenter
      // without pointer motion. Only actual movement should open a hover card.
      slot.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch' || index === selected) return;
        hoverSelection = true;
        inspect(index);
      });
      slot.addEventListener('focus', () => {
        if (restoringFocus) return;
        hoverSelection = false;
        inspect(index);
      });
      slot.addEventListener('click', () => {
        hoverSelection = false;
        inspect(index);
      });
      slot.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          hoverSelection = false;
          inspect(index);
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const count = data.buckets.length;
          const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
          bar(next)?.focus();
        }
      });
    }
    const focused = plot.contains(document.activeElement)
      ? document.activeElement?.getAttribute('data-bucket')
      : null;
    replacePlot(chart);
    if (focused != null) focusBar(Number(focused));
    inspect(selected, true);
  }

  async function reload() {
    const current = ++sequence;
    phase = 'loading';
    selected = -1;
    hoverSelection = false;
    view.setAttribute('aria-busy', 'true');
    draw();
    try {
      const next = await load(settings.range, settings.group);
      if (current !== sequence) return;
      data = next;
      phase = 'ready';
      draw();
    } catch {
      if (current !== sequence) return;
      phase = 'failed';
      draw();
    } finally {
      if (current === sequence) view.setAttribute('aria-busy', 'false');
    }
  }
  function apply(next: TimelinePrefs, retry = false) {
    const needsData = next.range !== settings.range || next.group !== settings.group;
    if (needsData || next.metric !== settings.metric || next.currency !== settings.currency) {
      settings = next;
      onChange?.({ ...settings });
    }
    if (needsData || (phase === 'failed' && retry)) void reload();
    else draw();
  }
  function change(part: Partial<TimelinePrefs>) {
    apply({ ...settings, ...part }, part.range !== undefined);
  }
  function reset() {
    apply({ ...defaults }, true);
  }
  draw();
  queueMicrotask(() => {
    if (!view.isConnected) return;
    let width = plot.clientWidth;
    if (phase === 'ready') draw();
    const resize = () => {
      if (width === plot.clientWidth) return;
      width = plot.clientWidth;
      if (phase === 'ready') draw();
    };
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        if (view.isConnected) resize();
        else observer.disconnect();
      });
      observer.observe(plot);
    } else {
      const fallback = () => {
        if (view.isConnected) resize();
        else window.removeEventListener('resize', fallback);
      };
      window.addEventListener('resize', fallback);
    }
  });
  return view;
}
