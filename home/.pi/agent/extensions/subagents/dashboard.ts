import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from '@earendil-works/pi-coding-agent';
import {
  matchesKey, truncateToWidth, type Component, type Focusable, type TUI, type TuiMouseEvent,
} from '@earendil-works/pi-tui';
import { config } from './config.ts';
import { active, type DashboardActions, type Job } from './contracts.ts';
import { elapsed, jobStats, oneLine } from './formatting.ts';
import { clearTranscript, createComposer, createTranscript, syncTranscript, type TranscriptState } from './interactive.ts';
import { badge, columns, jobDetail, jobLine, panelLine, renderWidget, statusColor } from './rendering.ts';
import type { Runtime } from './runtime.ts';

/** Overlay list plus a live child session. Opening a child does not switch the parent session. */
export class SubagentDashboard implements Component, Focusable {
  actions: DashboardActions;
  selected = 0;
  viewing = false;
  confirming?: Job;
  composing;
  transcript;
  scroll;
  messages;
  toolComponents;
  cacheKey = '';
  currentId?: string;
  viewedJob?: Job;
  lastStreaming;
  partial;
  drafts = new Map<string, string>();
  hideThinking = true;
  expanded = false;
  notice = '';
  private unsubscribe: () => void;
  private isFocused = false;
  private closed = false;
  private bodyTop = 3;
  private bodyHeight = 1;
  private transcriptHeight = 0;
  private editorBounds?: { top: number; height: number; offset: number; fullHeight: number };
  private contentTop = 0;
  private renderedWidth = 0;
  private renderedHeight = 0;
  private live: TranscriptState;
  private tui: TUI;
  private ctx: ExtensionContext;
  private kb: KeybindingsManager;
  private done: () => void;

  constructor(tui: TUI, ctx: ExtensionContext, kb: KeybindingsManager, actions: DashboardActions, done: () => void) {
    this.tui = tui;
    this.ctx = ctx;
    this.kb = kb;
    this.actions = actions;
    this.done = done;
    this.live = createTranscript();
    this.transcript = this.live.transcript;
    this.scroll = this.live.scroll;
    this.messages = this.live.messages;
    this.toolComponents = this.live.toolComponents;
    this.composing = createComposer(tui, ctx);
    this.composing.onSubmit = (text) => {
      const job = this.job;
      if (!job || !text.trim()) return;
      try {
        this.actions.send(job, text);
        this.composing.addToHistory(text);
        this.composing.setText('');
        this.notice = job.status === 'running'
          ? 'Steering queued — delivered after the current turn and tools.'
          : 'Sent to the child session.';
      } catch (error) { this.notice = String(error); }
      this.tui.requestRender();
    };
    this.unsubscribe = actions.subscribe(() => {
      if (this.currentId && !actions.jobs().find((job) => job.id === this.currentId)?.agent) {
        this.clearView();
        this.drafts.delete(this.currentId);
        this.composing.setText('');
      }
      if (this.confirming?.discarded) this.confirming = undefined;
      if (this.viewedJob?.discarded) {
        this.viewedJob = undefined;
        this.currentId = undefined;
        this.viewing = false;
        this.composing.focused = false;
        this.notice = 'Finished subagent discarded.';
      }
      for (const id of this.drafts.keys()) if (!actions.jobs().some((job) => job.id === id && job.agent)) this.drafts.delete(id);
      tui.requestRender();
    });
  }

  private get theme() { return this.ctx.ui.theme; }
  private get job() { return this.viewing ? this.viewedJob : this.actions.jobs()[this.selected]; }
  get focused() { return this.isFocused; }
  set focused(value: boolean) {
    this.isFocused = value;
    this.composing.focused = value && this.viewing && !this.confirming;
  }

  private open() {
    if (!this.job) return;
    if (this.currentId !== this.job.id) {
      if (this.currentId) this.drafts.set(this.currentId, this.composing.getExpandedText());
      this.currentId = this.job.id;
      this.composing.setText(this.drafts.get(this.currentId) ?? '');
      this.clearView();
      this.scroll.scrollToEnd();
    }
    this.viewedJob = this.job;
    this.viewing = true;
    this.composing.focused = this.focused;
    this.notice = '';
  }

  private clearView() {
    clearTranscript(this.live);
    this.cacheKey = this.live.cacheKey;
    this.partial = undefined;
    this.lastStreaming = undefined;
  }

  handleInput(data: string) {
    if (this.closed) return;
    if (this.confirming) {
      if (data === 'y' || data === 'Y') {
        this.actions.stop(this.confirming);
        this.notice = 'Stop requested. Already-completed tool side effects cannot be undone.';
      } else if (data !== 'n' && data !== 'N' && !this.kb.matches(data, 'tui.select.cancel')) return;
      this.confirming = undefined;
    } else if (this.kb.matches(data, 'tui.select.cancel')) {
      if (this.viewing) {
        const index = this.actions.jobs().findIndex((job) => job.id === this.currentId);
        this.selected = Math.max(0, index);
        if (this.currentId) this.drafts.set(this.currentId, this.composing.getExpandedText());
        this.viewing = false;
        this.composing.focused = false;
      } else this.done();
    } else if ((this.viewing && matchesKey(data, 'ctrl+x')) || (!this.viewing && data === 'x')) {
      if (this.job?.status === 'running') this.confirming = this.job;
    } else if (!this.viewing) {
      const jobs = this.actions.jobs();
      if (this.kb.matches(data, 'tui.select.up')) this.selected = Math.max(0, this.selected - 1);
      else if (this.kb.matches(data, 'tui.select.down')) this.selected = Math.min(Math.max(0, jobs.length - 1), this.selected + 1);
      else if (this.kb.matches(data, 'tui.select.confirm') || data === 's') this.open();
    } else if (this.kb.matches(data, 'app.thinking.toggle') || matchesKey(data, 'ctrl+t')) {
      this.hideThinking = !this.hideThinking;
      this.live.hideThinking = this.hideThinking;
      this.messages.clear();
      this.partial = undefined;
      this.live.partial = undefined;
      this.live.cacheKey = '';
      this.cacheKey = '';
    } else if (this.kb.matches(data, 'app.tools.expand') || matchesKey(data, 'ctrl+o')) {
      this.expanded = !this.expanded;
      this.live.expanded = this.expanded;
      this.live.cacheKey = '';
      this.cacheKey = '';
    } else if (this.kb.matches(data, 'tui.altScreen.pageUp')) this.scroll.scrollBy(-this.bodyHeight);
    else if (this.kb.matches(data, 'tui.altScreen.pageDown')) this.scroll.scrollBy(this.bodyHeight);
    else if (this.kb.matches(data, 'tui.altScreen.top')) this.scroll.scrollToStart();
    else if (this.kb.matches(data, 'tui.altScreen.bottom')) this.scroll.scrollToEnd();
    else if (this.job?.agent) {
      this.composing.focused = this.focused;
      this.composing.handleInput(data);
    }
    this.tui.requestRender();
  }

  handleMouse(event: TuiMouseEvent) {
    if (this.closed) return undefined;
    if (event.x < 1 || event.x >= this.renderedWidth - 1 || event.y < 1 || event.y >= this.renderedHeight - 1) return { handled: true };
    event = { ...event, x: event.x - 1, y: event.y - 1, width: Math.max(0, event.width - 2), height: Math.max(0, event.height - 2) };
    if (this.confirming) return { handled: true };
    if (event.type === 'wheel' && this.viewing) {
      this.scroll.scrollBy(event.wheelDelta ?? 0);
      this.tui.requestRender();
      return { handled: true };
    }
    if (this.viewing) {
      const editor = this.editorBounds;
      if (editor && event.y >= editor.top && event.y < editor.top + editor.height) {
        this.composing.focused = this.focused;
        return this.composing.handleMouse({ ...event, y: event.y - editor.top + editor.offset, height: editor.fullHeight });
      }
      if (event.y >= this.bodyTop && event.y < this.bodyTop + this.bodyHeight) {
        const result = this.transcript.handleMouse({
          ...event, y: event.y - this.bodyTop + this.scroll.scrollTop, height: this.transcriptHeight,
        });
        return result ? { ...result, focusTarget: this } : undefined;
      }
    } else if (event.type === 'click' && event.button === 'left' && event.y >= this.bodyTop && event.y < this.bodyTop + this.bodyHeight) {
      const index = Math.floor((event.y - this.bodyTop) / 2) + this.contentTop;
      if (index < this.actions.jobs().length) { this.selected = index; this.open(); this.tui.requestRender(); }
      return { handled: true };
    }
    return undefined;
  }

  render(width: number): string[] {
    width = Math.max(0, width);
    const rows = this.tui.terminal.rows;
    const height = Math.max(0, rows - (rows < 10 ? 2 : 4));
    this.renderedWidth = width;
    const border = (text: string) => this.theme.fg(this.confirming ? 'warning' : 'accent', text);
    if (width < 2 || height < 3) {
      const lines = Array.from({ length: Math.min(height, 2) }, () => border('─'.repeat(width)));
      this.renderedHeight = lines.length;
      return lines;
    }
    const inner = width - 2;
    const lines = [border(`╭${'─'.repeat(inner)}╮`),
      ...this.renderContent(inner, height - 2).map((line) => border('│') + truncateToWidth(line, inner, '', true) + border('│')),
      border(`╰${'─'.repeat(inner)}╯`)];
    this.renderedHeight = lines.length;
    return lines;
  }

  private renderContent(width: number, height: number): string[] {
    const theme = this.theme;
    const jobs = this.actions.jobs();
    this.selected = Math.min(this.selected, Math.max(0, jobs.length - 1));
    const job = this.job;
    const rule = () => theme.fg('borderMuted', '─'.repeat(Math.max(0, width)));
    const key = (text: string) => theme.fg('accent', text);
    const separator = theme.fg('borderMuted', ' · ');
    this.editorBounds = undefined;
    if (this.confirming) {
      this.composing.focused = false;
      this.bodyHeight = 0;
      return [
        theme.fg('warning', theme.bold(` Stop ${this.confirming.id}?`)),
        theme.fg('warning', ' y stop · n / Esc cancel'),
        theme.fg('text', ` ${oneLine(this.confirming.prompt)}`),
        theme.fg('muted', ' Cannot undo tool side effects.'),
      ].slice(0, height).map((line) => panelLine(line, width, theme, 'toolErrorBg'));
    }
    const compact = height < 8;
    const running = jobs.filter(active).length;
    const title = this.viewing && job ? columns(` ${theme.fg('dim', 'Subagents /')} ${theme.bold(job.id)}`,
      `${badge(job, theme)} ${theme.fg(statusColor(job), job.status)}${theme.fg('dim', ` · ${elapsed(job)}`)}`, width)
      : ` ${theme.fg('accent', theme.bold('Subagents'))}  ${theme.fg(running ? 'accent' : 'muted', `${running} running`)}${separator}${theme.fg('muted', `${jobs.length - running} finished`)}`;
    const subtitle = this.viewing && job
      ? ` ${width < 60 ? `${job.status} · ` : ''}${oneLine(job.provider)}/${oneLine(job.model)} · ${jobStats(job)} · ${oneLine(job.activity)}${job.pendingSteers ? ` · ${job.pendingSteers} steering queued` : ''}`
      : ' Background tasks · select an agent to open its live session';
    const lines = compact ? [title] : [title, theme.fg('dim', subtitle), rule()];
    this.bodyTop = lines.length;
    let editor: string[] = [];
    let editorOffset = 0;
    let editorFullHeight = 0;
    if (this.viewing && job?.agent) {
      this.composing.focused = this.focused && !this.confirming;
      editor = this.composing.render(width);
      editorFullHeight = editor.length;
      const maxEditor = Math.max(1, Math.min(6, height - lines.length - (compact ? 1 : 3) - 1));
      if (editor.length > maxEditor) {
        const cursor = editor.findIndex((line) => line.includes('\x1b_pi:c\x07'));
        editorOffset = Math.max(0, cursor - maxEditor + 1);
        editor = editor.slice(editorOffset, editorOffset + maxEditor);
      }
    }
    const controls = job?.status === 'running' ? `${key('Enter')} send · ${key('Ctrl+X')} stop · ` : job?.agent ? `${key('Enter')} send · ` : '';
    const footer = theme.fg('muted', compact
      ? this.viewing ? ` ${controls}${key('Esc')} list`
        : ` ${key('Enter')} view · ${key('x')} stop · ${key('Esc')} parent`
      : this.viewing ? ` ${controls}${key('PgUp/PgDn')} scroll · ${job?.agent ? `${key('Ctrl+O')} tools · ${key('Ctrl+T')} thinking · ` : ''}${key('Esc')} list`
        : ` ${key('↑↓')} select · ${key('Enter')} view · ${key('s')} steer · ${key('x')} stop · ${key('Esc')} parent`);
    this.bodyHeight = Math.max(0, height - lines.length - editor.length - (compact ? 1 : 3));
    if (this.viewing && job) {
      this.live.hideThinking = this.hideThinking;
      this.live.expanded = this.expanded;
      syncTranscript(job, this.live, this.tui);
      this.cacheKey = this.live.cacheKey;
      this.lastStreaming = this.live.lastStreaming;
      this.partial = this.live.partial;
      const transcript = this.scroll.render(width);
      this.transcriptHeight = transcript.length;
      this.scroll.updateLayout(transcript.length, this.bodyHeight, () => this.tui.requestRender());
      lines.push(...transcript.slice(this.scroll.scrollTop, this.scroll.scrollTop + this.bodyHeight));
      while (lines.length < this.bodyTop + this.bodyHeight) lines.push('');
    } else {
      const capacity = Math.max(1, Math.floor(this.bodyHeight / 2));
      this.contentTop = Math.max(0, Math.min(this.contentTop, this.selected));
      if (this.selected >= this.contentTop + capacity) this.contentTop = this.selected - capacity + 1;
      for (const [offset, item] of jobs.slice(this.contentTop, this.contentTop + capacity).entries()) {
        const selected = offset + this.contentTop === this.selected;
        lines.push(`${selected ? theme.fg('accent', theme.bold(' ›')) : '  '} ${jobLine(item, theme, width - 3, selected)}`,
          `   ${theme.fg('dim', '⎿')} ${jobDetail(item, theme, width - 5)}`);
      }
      if (!jobs.length) lines.push(theme.fg('muted', ' No subagents yet. Ask the parent to launch some.'));
      lines.splice(this.bodyTop + this.bodyHeight);
      while (lines.length < this.bodyTop + this.bodyHeight) lines.push('');
    }
    const note = this.notice || (this.viewing && job ? `${job.error || ''}${this.scroll.isFollowingEnd ? active(job) ? '  Following live output' : job.agent ? '  End of transcript · click the editor and press Enter to continue' : '  End of report · full agent state released' : '  Scroll paused · Ctrl+End follows live output'}`
      : jobs.length ? `Agent ${this.selected + 1} of ${jobs.length} · ${job ? jobStats(job) : ''} · latest 20 reports retained` : 'No background work · your parent session is still active');
    if (editor.length) this.editorBounds = { top: lines.length, height: editor.length, offset: editorOffset, fullHeight: editorFullHeight };
    const noteColor = this.viewing && job?.error ? 'error' : this.notice ? 'accent' : 'muted';
    lines.push(...editor, ...(compact ? [footer] : [rule(), theme.fg(noteColor, ` ${oneLine(note)}`), footer]));
    return lines.slice(0, height).map((line) => truncateToWidth(line, width));
  }

  invalidate() {
    this.live.cacheKey = '';
    this.cacheKey = '';
    this.messages.clear();
    this.partial = undefined;
    this.toolComponents.clear();
    this.transcript.invalidate();
    this.composing.invalidate();
  }

  dispose() {
    this.closed = true;
    this.unsubscribe();
    this.clearView();
    this.viewedJob = undefined;
    this.confirming = undefined;
    this.drafts.clear();
    this.composing.setText('');
  }
}

export function bindDashboard(pi: ExtensionAPI, runtime: Runtime) {
  let closeDashboard: (() => void) | undefined;
  const actions = (): DashboardActions => ({
    jobs: () => [...runtime.jobs.values()],
    send: (job, prompt) => runtime.send(job, prompt),
    stop: (job) => runtime.stop(job),
    subscribe: runtime.subscribe,
  });
  async function dashboard(ctx: ExtensionContext) {
    if (ctx.mode !== 'tui') { ctx.ui.notify('The subagent dashboard requires interactive TUI mode.', 'warning'); return; }
    if (closeDashboard) { ctx.ui.notify('The subagent dashboard is already open.', 'info'); return; }
    runtime.attachUI(ctx);
    await ctx.ui.custom<void>((tui, _theme, kb, done) => {
      closeDashboard = () => done();
      return new SubagentDashboard(tui, ctx, kb, actions(), done);
    }, { overlay: true, overlayOptions: { width: '96%', maxHeight: '100%', anchor: 'center' } }).finally(() => { closeDashboard = undefined; });
  }
  runtime.setCloseUI(() => closeDashboard?.());
  runtime.setAttachUI((ctx) => {
    ctx.ui.setWidget(config.widgetId, (tui) => {
      const unsubscribe = runtime.subscribe(() => tui.requestRender());
      const theme = ctx.ui.theme;
      return {
        render: (width: number) => renderWidget([...runtime.jobs.values()], theme, width),
        handleMouse: (event: { type: string; button?: string }) => {
          if (event.type === 'click' && event.button === 'left') {
            void dashboard(ctx).catch((error) => ctx.ui.notify(String(error), 'error'));
            return { handled: true };
          }
          return undefined;
        },
        invalidate() {},
        dispose: unsubscribe,
      };
    });
  });
  void pi;
}
