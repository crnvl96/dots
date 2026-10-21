// /usage — private, on-demand provider balances. No prompts, cookies, or model calls.
import type { ExtensionAPI, ExtensionCommandContext, Theme } from '@earendil-works/pi-coding-agent';
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui';

export type ProviderId = 'codex' | 'openrouter' | 'radius' | 'perplexity';
type Status = 'loading' | 'ok' | 'unavailable' | 'error';
export interface UsageWindow {
  label: string;
  usedPercent: number;
  resetAt?: number;
}
export interface UsageCard {
  id: ProviderId;
  status: Status;
  headline: string;
  details: string[];
  windows?: UsageWindow[];
}
export const PROVIDERS: Record<ProviderId, string> = {
  codex: 'OpenAI Codex', openrouter: 'OpenRouter', radius: 'Earendil Radius', perplexity: 'Perplexity',
};
const IDS = Object.keys(PROVIDERS) as ProviderId[];
const TIMEOUT_MS = 12_000;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function requiredNumber(value: unknown): number {
  if (!finite(value)) throw new UsageError('Unexpected response format.');
  return value;
}
// Never allow provider strings to inject terminal escapes or multiline content.
function clean(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, '').slice(0, 160);
}
export function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
class UsageError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

export function parseCodex(payload: unknown, now = Date.now()): UsageCard {
  const data = record(payload);
  const limits = record(data.rate_limit);
  const windows: UsageWindow[] = [];
  for (const [key, fallback] of [['primary_window', 'Primary'], ['secondary_window', 'Secondary']]) {
    const window = record(limits[key]);
    if (!finite(window.used_percent) || window.used_percent < 0 || window.used_percent > 100) continue;
    const seconds = window.limit_window_seconds;
    const label = finite(seconds) && seconds > 0
      ? (seconds % 86400 === 0 ? `${seconds / 86400}d` : `${Math.round(seconds / 3600 * 10) / 10}h`)
      : fallback;
    const resetAt = finite(window.reset_at) ? window.reset_at * 1000
      : finite(window.reset_after_seconds) ? now + window.reset_after_seconds * 1000 : undefined;
    windows.push({ label, usedPercent: window.used_percent, resetAt });
  }
  if (!windows.length) throw new UsageError('Usage windows unavailable for this plan.');
  const plan = typeof data.plan_type === 'string' ? clean(data.plan_type) : 'Subscription';
  return { id: 'codex', status: 'ok', headline: plan, windows, details: ['Plan limits · not API spend'] };
}

export function parseOpenRouter(payload: unknown): UsageCard {
  const data = record(record(payload).data);
  const credited = requiredNumber(data.total_credits);
  const used = requiredNumber(data.total_usage);
  return {
    id: 'openrouter', status: 'ok', headline: `${money(credited - used)} remaining`,
    details: [`Account credits · ${money(used)} used of ${money(credited)} purchased`],
  };
}

export function parseRadius(payload: unknown): UsageCard {
  const data = record(payload);
  if (data.currency !== 'USD') throw new UsageError('Unexpected response currency.');
  const balance = record(data.balance);
  const credit = requiredNumber(balance.credit_balance);
  const available = requiredNumber(balance.available);
  const reserved = requiredNumber(balance.reserved);
  return {
    id: 'radius', status: 'ok', headline: `${money(available)} available`,
    details: [`Organization · ${money(credit)} balance · ${money(reserved)} reserved`],
  };
}

export async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal, transport = fetch): Promise<unknown> {
  signal.throwIfAborted();
  const response = await transport(url, { headers: { Accept: 'application/json', ...headers }, signal, redirect: 'error' });
  if (!response.ok) {
    // Do not include response bodies, status text, URLs, or thrown transport errors: they can contain secrets.
    if (response.status === 401) throw new UsageError('Authentication expired or invalid. Sign in again.');
    if (response.status === 403) throw new UsageError('Balance access denied for this credential.', 403);
    if (response.status === 429) throw new UsageError('Rate limited. Try again later.');
    throw new UsageError(`Provider request failed (HTTP ${response.status}).`);
  }
  try { return await response.json(); }
  catch { throw new UsageError('Unexpected response format.'); }
}

// Bound credential resolution too. Pi may refresh OAuth tokens internally; it does not expose cancellation here.
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

export type UsageLoader = (id: ProviderId, signal: AbortSignal) => Promise<UsageCard>;
type Registry = Pick<ExtensionCommandContext['modelRegistry'], 'getProviderAuth' | 'getAll'>;

export function codexAccountId(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const claims = record(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
    const id = record(claims['https://api.openai.com/auth']).chatgpt_account_id;
    return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) ? id : undefined;
  } catch { return undefined; }
}

export function radiusOrigin(configured: string): string {
  const url = new URL(configured.includes('://') ? configured : `https://${configured}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new UsageError('Radius billing requires a trusted HTTPS gateway.');
  }
  return url.origin;
}

export function createUsageLoader(registry: Registry, env = process.env, transport = fetch, timeoutMs = TIMEOUT_MS): UsageLoader {
  return async (id, parentSignal) => {
    const unavailable = (headline: string, detail: string): UsageCard => ({ id, status: 'unavailable', headline, details: [detail] });
    if (id === 'perplexity') return unavailable('Not exposed by API', 'Credits: console.perplexity.ai/project/billing');
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(timeoutMs)]);
    try {
      signal.throwIfAborted();
      if (id === 'codex') {
        const resolved = await abortable(registry.getProviderAuth('openai-codex'), signal);
        const token = resolved?.auth.apiKey;
        if (!token) return unavailable('Not connected', 'Use /login → OpenAI Codex (legacy).');
        const base = resolved?.auth.baseUrl || registry.getAll().find(model => model.provider === 'openai-codex')?.baseUrl;
        if (base && new URL(base).origin !== 'https://chatgpt.com') {
          return unavailable('Custom endpoint', 'Plan usage is supported only for the official Codex provider.');
        }
        const accountId = codexAccountId(token);
        if (!accountId) return unavailable('Codex login required', 'Use /login → OpenAI Codex; an OpenAI API key cannot report plan usage.');
        return parseCodex(await getJson('https://chatgpt.com/backend-api/wham/usage', {
          Authorization: `Bearer ${token}`, 'ChatGPT-Account-Id': accountId,
        }, signal, transport));
      }
      if (id === 'openrouter') {
        let token = env.OPENROUTER_MANAGEMENT_KEY?.trim() || env.OPENROUTER_API_KEY?.trim();
        if (!token) {
          const resolved = await abortable(registry.getProviderAuth('openrouter'), signal);
          const base = resolved?.auth.baseUrl || registry.getAll().find(model => model.provider === 'openrouter')?.baseUrl;
          if (base && new URL(base).origin !== 'https://openrouter.ai') {
            return unavailable('Custom endpoint', 'Set OPENROUTER_MANAGEMENT_KEY for the official account; gateway credentials are not forwarded.');
          }
          token = resolved?.auth.apiKey;
        }
        if (!token) return unavailable('Not connected', 'Set OPENROUTER_MANAGEMENT_KEY for account balance access.');
        try {
          return parseOpenRouter(await getJson('https://openrouter.ai/api/v1/credits', { Authorization: `Bearer ${token}` }, signal, transport));
        } catch (error) {
          if (error instanceof UsageError && error.status === 403) {
            return unavailable('Management key required', 'Set OPENROUTER_MANAGEMENT_KEY; ordinary inference keys may not read account credits.');
          }
          throw error;
        }
      }
      const resolved = await abortable(registry.getProviderAuth('radius'), signal);
      const token = resolved?.auth.apiKey;
      if (!token) return unavailable('Not connected', 'Use /login → Radius, or configure RADIUS_API_KEY.');
      // Preserve the configured provider's origin rather than forwarding its credential to the public gateway.
      const gateway = radiusOrigin(resolved?.env?.PI_RADIUS_GATEWAY || env.PI_RADIUS_GATEWAY
        || resolved?.auth.baseUrl || registry.getAll().find(model => model.provider === 'radius')?.baseUrl
        || 'https://radius.pi.dev');
      const headers = { Authorization: `Bearer ${token}` };
      const context = record(await getJson(`${gateway}/v1/context`, headers, signal, transport));
      const orgId = record(context.organization).id;
      if (typeof orgId !== 'string' || !orgId.trim()) throw new UsageError('No Radius organization is available for this credential.');
      return parseRadius(await getJson(`${gateway}/v1/organizations/${encodeURIComponent(orgId)}/billing`, headers, signal, transport));
    } catch (error) {
      if (parentSignal.aborted) throw parentSignal.reason;
      return {
        id, status: 'error', headline: 'Unavailable',
        details: [signal.aborted ? 'Timed out. Press r to retry.'
          : error instanceof UsageError ? error.message : 'Unable to read usage. Check your connection and provider login.'],
      };
    }
  };
}

export function resetLabel(resetAt: number | undefined, now: number): string {
  if (resetAt === undefined || !Number.isFinite(resetAt)) return 'reset unknown';
  const minutes = Math.ceil((resetAt - now) / 60_000);
  if (minutes <= 0) return 'reset due';
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `resets in ${hours}h ${minutes % 60}m`
    : `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Compact custom layout; all values stay in this overlay, never the transcript. */
export function renderCards(cards: UsageCard[], width: number, theme: Theme, now = Date.now()): string[] {
  const lines: string[] = [];
  for (const card of cards) {
    const color = card.status === 'ok' ? 'success' : card.status === 'error' ? 'error' : 'muted';
    const icon = card.status === 'loading' ? '◌' : card.status === 'ok' ? '●' : '○';
    const title = `${theme.fg(color, icon)} ${theme.bold(PROVIDERS[card.id])}`;
    const value = theme.fg(card.status === 'ok' ? 'accent' : color, clean(card.headline));
    const gap = width - visibleWidth(title) - visibleWidth(value);
    if (gap >= 2) lines.push(title + ' '.repeat(gap) + value);
    else lines.push(title, ...wrapTextWithAnsi(`  ${value}`, Math.max(1, width)));
    for (const window of card.windows ?? []) {
      const barWidth = Math.max(3, Math.min(16, width - 42));
      const filled = Math.round(window.usedPercent / 100 * barWidth);
      const color = window.usedPercent >= 90 ? 'error' : window.usedPercent >= 70 ? 'warning' : 'success';
      const bar = theme.fg(color, '━'.repeat(filled)) + theme.fg('dim', '─'.repeat(barWidth - filled));
      const text = `  ${window.label.padEnd(3)} ${bar} ${Math.round(window.usedPercent)}% used · ${resetLabel(window.resetAt, now)}`;
      lines.push(...wrapTextWithAnsi(text, Math.max(1, width)));
    }
    for (const detail of card.details) lines.push(...wrapTextWithAnsi(theme.fg('dim', `  ${clean(detail)}`), Math.max(1, width)));
    lines.push('');
  }
  return lines.slice(0, -1).map(line => truncateToWidth(line, Math.max(0, width), ''));
}

export class UsageDashboard implements Component {
  cards: UsageCard[] = [];
  private readonly theme: Theme;
  private readonly load: UsageLoader;
  private readonly redraw: () => void;
  private readonly height: () => number;
  private readonly done: () => void;
  private controller?: AbortController;
  private closed = false;
  private pending = false;
  private offset = 0;
  private maxOffset = 0;
  private updated?: number;

  constructor(theme: Theme, load: UsageLoader, redraw: () => void, height: () => number, done: () => void) {
    this.theme = theme; this.load = load; this.redraw = redraw; this.height = height; this.done = done;
    this.refresh();
  }

  refresh(): void {
    if (this.closed || this.pending) return;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.pending = true;
    this.updated = undefined;
    this.cards = IDS.map(id => ({ id, status: 'loading', headline: 'Checking…', details: [] }));
    this.redraw();
    void Promise.all(IDS.map(async (id, index) => {
      let card: UsageCard;
      try { card = await this.load(id, signal); }
      catch { card = { id, status: 'error', headline: 'Unavailable', details: ['Unable to load provider usage.'] }; }
      if (!signal.aborted && !this.closed) { this.cards[index] = card; this.redraw(); }
    })).then(() => {
      if (signal.aborted || this.closed) return;
      this.pending = false;
      this.updated = Date.now();
      this.redraw();
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'q') || matchesKey(data, 'ctrl+c') || matchesKey(data, 'return')) {
      this.dispose(); this.done(); return;
    }
    if (matchesKey(data, 'r')) this.refresh();
    if (matchesKey(data, 'up')) this.offset = Math.max(0, this.offset - 1);
    if (matchesKey(data, 'down')) this.offset = Math.min(this.maxOffset, this.offset + 1);
    if (matchesKey(data, 'pageUp')) this.offset = Math.max(0, this.offset - 5);
    if (matchesKey(data, 'pageDown')) this.offset = Math.min(this.maxOffset, this.offset + 5);
    this.redraw();
  }

  render(width: number): string[] {
    const th = this.theme;
    const inner = Math.max(1, width - 4);
    const border = (s: string) => th.fg('borderMuted', s);
    const row = (s: string) => border('│') + ' ' + truncateToWidth(s, inner, '', true) + ' ' + border('│');
    const content = renderCards(this.cards, inner, th);
    const height = Math.max(1, this.height());
    const compact = height < 10;
    const bodyHeight = Math.max(0, height - (compact ? 2 : 7));
    this.maxOffset = Math.max(0, content.length - bodyHeight);
    this.offset = Math.min(this.offset, this.maxOffset);
    const state = this.pending ? 'Checking providers…' : `Checked ${new Date(this.updated ?? Date.now()).toLocaleTimeString()}`;
    if (compact) {
      return [th.bold('◈ Usage'), ...content.slice(this.offset, this.offset + bodyHeight),
        th.fg('muted', 'r refresh · esc close · ↑↓ scroll')]
        .slice(0, height).map(line => truncateToWidth(line, Math.max(0, width), ''));
    }
    const lines = [
      border(`╭${'─'.repeat(inner + 2)}╮`),
      row(`${th.fg('accent', '◈')} ${th.bold('Usage')} ${th.fg('dim', ' / balances & limits')}`),
      row(th.fg('dim', state)), row(''),
      ...content.slice(this.offset, this.offset + bodyHeight).map(row),
      row(''), row(th.fg('muted', `r refresh   esc close${this.maxOffset ? '   ↑↓ scroll' : ''}`)),
      border(`╰${'─'.repeat(inner + 2)}╯`),
    ];
    return lines.map(line => truncateToWidth(line, Math.max(0, width), ''));
  }

  invalidate(): void {} // Colors/layout are recomputed on every render.
  dispose(): void { this.closed = true; this.controller?.abort(); }
}

export default function usage(pi: ExtensionAPI): void {
  let active: UsageDashboard | undefined;
  const cleanup = () => { active?.dispose(); active = undefined; };
  pi.on('session_shutdown', cleanup);
  pi.registerCommand('usage', {
    description: 'Show Codex plan usage and provider credit balances',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui') {
        if (ctx.hasUI) ctx.ui.notify('/usage requires interactive terminal mode.', 'info');
        return;
      }
      if (active) return;
      try {
        await ctx.ui.custom<void>((tui, theme, _keys, done) => {
          active = new UsageDashboard(theme, createUsageLoader(ctx.modelRegistry),
            () => tui.requestRender(), () => tui.terminal.rows - 2, () => done());
          return active;
        }, { overlay: true, overlayOptions: { anchor: 'center', width: 76, margin: 1 } });
      } finally { cleanup(); }
    },
  });
}
