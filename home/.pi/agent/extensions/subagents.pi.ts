import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, type AgentMessage, type AgentEvent } from '@earendil-works/pi-agent-core';
import { StringEnum } from '@earendil-works/pi-ai';
import {
  AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent, getMarkdownTheme,
  truncateHead, type ExtensionAPI, type ExtensionContext, type ExtensionToolContext,
  type KeybindingsManager, type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Container, Editor, ScrollView, matchesKey, stripTerminalSequences, truncateToWidth,
  type Component, type Focusable, type TUI, type TuiMouseEvent,
} from '@earendil-works/pi-tui';
import { Type, type Static } from 'typebox';

// One general-purpose type; in-process agents, isolated history, shared workspace.
// /subagents or Ctrl+Shift+A opens the live dashboard without switching parent sessions.
const Task = Type.Object({
  prompt: Type.String({ minLength: 1 }),
  model: Type.Optional(Type.String({ minLength: 1, description: 'Model ID; defaults to the parent model ID.' })),
  provider: Type.Optional(Type.String({ minLength: 1, description: 'Defaults to the parent provider.' })),
  thinkingLevel: Type.Optional(StringEnum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)),
  tools: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
    description: 'Exact parent-callable tool names. Defaults to active callable tools, excluding subagent tools. [] disables tools.',
    uniqueItems: true,
  })),
  systemPrompt: Type.Optional(Type.String({ description: 'Replaces the general-purpose system prompt.' })),
});
const Launch = Type.Object({ tasks: Type.Array(Task, { minItems: 1 }) });
const Steer = Type.Object({
  id: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1, description: 'Guidance delivered after the current assistant turn and its tools finish.' }),
});
const Inspect = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, description: 'Exact subagent ID. Omit to list retained jobs; supply an ID to include its result.' })),
});
const Wait = Type.Object({
  ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true, description: 'Exact IDs of the subagents to wait for. Waits for all selected jobs.' }),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_147_483_647, description: 'Optional maximum wait in milliseconds. A timeout returns current snapshots without stopping children. Omit to wait until all reports are ready.' })),
});
const NullableString = Type.Union([Type.String(), Type.Null()]);
const Snapshot = Type.Object({
  id: Type.String(), prompt: Type.String(), model: Type.String(), provider: Type.String(),
  status: StringEnum(['running', 'stopping', 'completed', 'failed', 'stopped'] as const),
  activity: Type.String(), pendingSteers: Type.Integer(), elapsedMs: Type.Number(),
  notification: StringEnum(['pending', 'queued', 'failed'] as const),
  error: NullableString, notificationError: NullableString,
  result: NullableString, fullOutputPath: NullableString,
});
const OWN_TOOLS = new Set(['subagents_launch', 'subagents_steer', 'subagents_status', 'subagents_wait']);
const DEFAULT_PROMPT = 'You are a general-purpose subagent. Complete the assigned task and return a clear, concise report to the parent agent. You share its working directory; coordinate file changes carefully.';
const WIDGET = 'subagents.pi';
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HISTORY_LIMIT = 20;
type TaskInput = Static<typeof Task>;
type Status = 'running' | 'stopping' | 'completed' | 'failed' | 'stopped';
type ToolProgress = {
  name: string; running: boolean; revision: number;
  result?: Parameters<ToolExecutionComponent['updateResult']>[0];
};
interface Job {
  id: string;
  agent: Agent;
  prompt: string;
  cwd: string;
  status: Status;
  startedAt: number;
  finishedAt?: number;
  finishedOrder?: number;
  settled?: boolean; // Report preparation/enqueue finished, not an acknowledgement that the parent read it.
  activity: string;
  revision: number;
  pendingSteers: number;
  hasPrompt?: boolean;
  tools: Map<string, ToolProgress>;
  error?: string;
  cancelled: boolean; // Session cleanup suppresses notifications; a manual stop does not.
  unsubscribe?: () => void;
  done?: Promise<void>;
  result?: string; // Bounded report, also available while notification/artifact delivery is pending.
  fullOutputPath?: string;
  notification: 'pending' | 'queued' | 'failed';
  notificationError?: string;
}
interface DashboardActions {
  jobs: () => Job[];
  steer: (job: Job, prompt: string) => void;
  stop: (job: Job) => void;
  subscribe: (listener: () => void) => () => void;
}

function active(job: Job) { return job.status === 'running' || job.status === 'stopping'; }
function snapshot(job: Job, includeResult = false): Static<typeof Snapshot> {
  return {
    id: job.id, prompt: job.prompt, model: job.agent.state.model.id, provider: job.agent.state.model.provider,
    status: job.status, activity: job.activity, pendingSteers: job.pendingSteers,
    elapsedMs: Math.max(0, (job.finishedAt ?? Date.now()) - job.startedAt),
    notification: job.notification, error: job.error ?? null, notificationError: job.notificationError ?? null,
    result: includeResult ? job.result ?? null : null, fullOutputPath: job.fullOutputPath ?? null,
  };
}
function oneLine(text: string) { return stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim(); }
function elapsed(job: Job) {
  const seconds = Math.max(0, Math.floor(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function badge(job: Job, theme: Theme, compact = false) {
  const color = job.status === 'running' ? 'accent' : job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'warning';
  const icon = active(job) ? FRAMES[Math.floor(Date.now() / 100) % FRAMES.length]
    : job.status === 'completed' ? '✓' : job.status === 'failed' ? '✗' : '■';
  return theme.fg(color, compact ? icon : `[${icon} ${job.status}]`);
}
function jobLine(job: Job, theme: Theme, width: number) {
  const divider = width < 32 ? ' ' : ` ${theme.fg('borderMuted', '│')} `;
  return `${badge(job, theme, width < 60)} ${theme.fg('accent', job.id.slice(0, 8))} ${theme.fg('muted', elapsed(job))}${divider}${theme.fg('text', oneLine(job.prompt))}`;
}
function panelLine(text: string, width: number, theme: Theme, background: Parameters<Theme['bg']>[0]) {
  // Truncation inserts full resets around its ellipsis. Reapply the surface after
  // each reset so wide graphemes and clipped rows keep a continuous background.
  return truncateToWidth(text, width, '…', true).split('\x1b[0m')
    .map((part) => theme.bg(background, part)).join('\x1b[0m');
}

function prepare(task: TaskInput, ctx: ExtensionToolContext, thinkingLevel: ReturnType<ExtensionAPI['getThinkingLevel']>, defaultTools: string[]) {
  if (!task.prompt.trim()) throw new Error('Subagent prompt must not be blank.');
  const provider = task.provider ?? ctx.model?.provider;
  const modelId = task.model ?? ctx.model?.id;
  const model = provider && modelId ? ctx.modelRegistry.find(provider, modelId) : undefined;
  if (!model) throw new Error(`Unknown subagent model: ${provider ?? '(unset)'}/${modelId ?? '(unset)'}`);

  const callable = new Map(ctx.tools.map((tool) => [tool.name, tool]));
  const tools = [...new Set(task.tools ?? defaultTools)].map((name) => {
    const tool = callable.get(name);
    if (!tool || OWN_TOOLS.has(name)) throw new Error(`Unavailable subagent tool: ${name}`);
    return {
      ...tool,
      // Parent validation/permission hooks, CHILD cancellation. Tool selection is not a sandbox.
      async execute(_id: string, args: unknown, signal?: AbortSignal, onUpdate?: Parameters<typeof tool.execute>[3]) {
        const outcome = await ctx.executeTool(name, args, { signal, onUpdate });
        return { ...outcome.result, isError: outcome.isError };
      },
    };
  });
  return new Agent({
    sessionId: randomUUID(),
    initialState: { model, thinkingLevel: task.thinkingLevel ?? thinkingLevel, systemPrompt: task.systemPrompt ?? DEFAULT_PROMPT, tools },
    streamFn: (selected, context, options) => ctx.modelRegistry.streamSimple(selected, context, options),
    // Abort during a tool must not schedule a final provider request with an already-aborted signal.
    finishTurn: (_turn, signal) => signal?.aborted ? { action: 'end' } : undefined,
  });
}

/** A temporary child-session view, not a parent session switch (which would abort children). */
class SubagentDashboard implements Component, Focusable {
  private selected = 0;
  private viewing = false;
  private confirming?: Job;
  private composing: Editor;
  private transcript = new Container();
  private scroll = new ScrollView(this.transcript, { follow: 'end' });
  private messages = new Map<AgentMessage, Component>();
  private toolComponents = new Map<string, { component: ToolExecutionComponent; revision: number; expanded?: boolean }>();
  private cacheKey = '';
  private currentId?: string;
  private viewedJob?: Job; // Pin the visible transcript even if bounded history evicts it.
  private lastStreaming?: AgentMessage;
  private partial?: { index: number; component: AssistantMessageComponent };
  private drafts = new Map<string, string>();
  private hideThinking = true;
  private expanded = false;
  private notice = '';
  private unsubscribe: () => void;
  private isFocused = false;
  private closed = false;
  private bodyTop = 3;
  private bodyHeight = 1;
  private transcriptHeight = 0;
  private editorBounds?: { top: number; height: number; offset: number; fullHeight: number };
  private contentTop = 0;

  private tui: TUI;
  private ctx: ExtensionContext;
  private kb: KeybindingsManager;
  private actions: DashboardActions;
  private done: () => void;

  constructor(tui: TUI, ctx: ExtensionContext, kb: KeybindingsManager, actions: DashboardActions, done: () => void, id?: string) {
    this.tui = tui;
    this.ctx = ctx;
    this.kb = kb;
    this.actions = actions;
    this.done = done;
    this.composing = new Editor(tui, {
      borderColor: (text) => this.theme.fg('accent', text),
      selectList: {
        selectedPrefix: (text) => this.theme.fg('accent', text), selectedText: (text) => this.theme.fg('accent', text),
        description: (text) => this.theme.fg('muted', text), scrollInfo: (text) => this.theme.fg('dim', text),
        noMatch: (text) => this.theme.fg('warning', text),
      },
    });
    this.composing.onSubmit = (text) => {
      const job = this.job;
      if (!job || !text.trim()) return;
      try {
        this.actions.steer(job, text);
        this.composing.addToHistory(text);
        this.composing.setText('');
        this.notice = 'Steering queued — delivered after the current turn and tools.';
      } catch (error) { this.notice = String(error); }
      this.tui.requestRender();
    };
    if (id) {
      this.selected = Math.max(0, actions.jobs().findIndex((job) => job.id === id));
      this.open();
    }
    this.unsubscribe = actions.subscribe(() => tui.requestRender());
  }
  private get theme() { return this.ctx.ui.theme; }
  private get job() { return this.viewing ? this.viewedJob : this.actions.jobs()[this.selected]; }
  get focused() { return this.isFocused; }
  set focused(value: boolean) { this.isFocused = value; this.composing.focused = value && this.viewing; }

  private open() {
    if (!this.job) return;
    if (this.currentId !== this.job.id) {
      if (this.currentId) this.drafts.set(this.currentId, this.composing.getExpandedText());
      this.currentId = this.job.id;
      this.composing.setText(this.drafts.get(this.currentId) ?? '');
      this.messages.clear();
      this.partial = undefined;
      this.toolComponents.clear();
      this.cacheKey = '';
      this.scroll.scrollToEnd();
    }
    this.viewedJob = this.job;
    this.viewing = true;
    this.composing.focused = this.focused;
    this.notice = '';
  }
  private syncTranscript(job: Job) {
    const key = `${job.id}:${job.revision}:${this.hideThinking}:${this.expanded}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    this.transcript.clear();
    const streaming = job.agent.state.streamingMessage;
    const messages = [...job.agent.state.messages, ...(streaming ? [streaming] : [])];
    const kept = new Set<AgentMessage>();
    for (const [index, message] of messages.entries()) {
      if (message.role === 'user') {
        let component = this.messages.get(message);
        if (!component) {
          const text = typeof message.content === 'string' ? message.content : message.content.map((part) => part.type === 'text' ? part.text : '[image]').join('\n');
          component = new UserMessageComponent(text, getMarkdownTheme());
          this.messages.set(message, component);
        }
        kept.add(message);
        this.transcript.addChild(component);
      } else if (message.role === 'assistant') {
        let component = this.messages.get(message) as AssistantMessageComponent | undefined;
        if (!component) {
          // Providers replace partial snapshots; keep one native component per in-flight message so clicks survive deltas.
          component = this.partial?.index === index ? this.partial.component
            : new AssistantMessageComponent(undefined, this.hideThinking, getMarkdownTheme());
          component.updateContent(message, message === streaming);
          this.messages.set(message, component);
        } else if (message === streaming || message === this.lastStreaming) component.updateContent(message, message === streaming);
        if (message === streaming) this.partial = { index, component };
        kept.add(message);
        this.transcript.addChild(component);
        for (const call of message.content) {
          if (call.type !== 'toolCall') continue;
          const progress = job.tools.get(call.id);
          const revision = message === streaming ? job.revision : progress?.revision ?? -1;
          let cached = this.toolComponents.get(call.id);
          if (!cached) {
            cached = { component: new ToolExecutionComponent(call.name, call.id, call.arguments, { showImages: false }, {}, this.tui, job.cwd), revision: -2 };
            this.toolComponents.set(call.id, cached);
          }
          if (cached.revision !== revision) {
            cached.component.updateArgs(call.arguments);
            if (message !== streaming) cached.component.setArgsComplete();
            if (progress) cached.component.markExecutionStarted();
            if (progress?.result) cached.component.updateResult(progress.result, progress.running);
            cached.revision = revision;
          }
          if (cached.expanded !== this.expanded) {
            cached.component.setExpanded(this.expanded);
            cached.expanded = this.expanded;
          }
          this.transcript.addChild(cached.component);
        }
      }
    }
    // Streaming snapshots can be replaced on every token; keep only live transcript objects.
    for (const message of this.messages.keys()) if (!kept.has(message)) this.messages.delete(message);
    this.lastStreaming = streaming;
    if (!streaming) this.partial = undefined;
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
        this.viewing = false;
        this.composing.focused = false;
      }
      else this.done();
    } else if ((this.viewing && matchesKey(data, 'ctrl+x')) || (!this.viewing && data === 'x')) {
      if (this.job?.status === 'running') this.confirming = this.job;
    } else if (!this.viewing) {
      const jobs = this.actions.jobs();
      if (this.kb.matches(data, 'tui.select.up')) this.selected = Math.max(0, this.selected - 1);
      else if (this.kb.matches(data, 'tui.select.down')) this.selected = Math.min(Math.max(0, jobs.length - 1), this.selected + 1);
      else if (this.kb.matches(data, 'tui.select.confirm') || data === 's') this.open();
    } else if (this.kb.matches(data, 'app.thinking.toggle')) {
      this.hideThinking = !this.hideThinking;
      this.messages.clear();
      this.partial = undefined;
      this.cacheKey = '';
    } else if (this.kb.matches(data, 'app.tools.expand')) {
      this.expanded = !this.expanded;
      this.cacheKey = '';
    } else if (this.kb.matches(data, 'tui.altScreen.pageUp')) this.scroll.scrollBy(-this.bodyHeight);
    else if (this.kb.matches(data, 'tui.altScreen.pageDown')) this.scroll.scrollBy(this.bodyHeight);
    else if (this.kb.matches(data, 'tui.altScreen.top')) this.scroll.scrollToStart();
    else if (this.kb.matches(data, 'tui.altScreen.bottom')) this.scroll.scrollToEnd();
    else if (this.job?.status === 'running') this.composing.handleInput(data);
    this.tui.requestRender();
  }
  handleMouse(event: TuiMouseEvent) {
    if (this.closed) return undefined;
    if (this.confirming) return { handled: true };
    if (event.type === 'wheel' && this.viewing) {
      this.scroll.scrollBy(event.wheelDelta ?? 0);
      this.tui.requestRender();
      return { handled: true };
    }
    if (this.viewing) {
      const editor = this.editorBounds;
      if (editor && event.y >= editor.top && event.y < editor.top + editor.height) {
        // Keep the dashboard as keyboard focus owner; only translate the clipped editor's coordinates.
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
    const theme = this.theme;
    const jobs = this.actions.jobs();
    this.selected = Math.min(this.selected, Math.max(0, jobs.length - 1));
    const job = this.job;
    const height = Math.max(4, this.tui.terminal.rows - 4);
    // Decorate the existing chrome without insetting native content: transcript/editor
    // columns and the two-line list rows must retain their mouse coordinates.
    const rule = (top: boolean) => theme.fg('border', width < 2 ? '─'.repeat(Math.max(0, width))
      : `${top ? '╭' : '╰'}${'─'.repeat(width - 2)}${top ? '╮' : '╯'}`);
    const key = (text: string) => theme.fg('accent', text);
    const separator = theme.fg('borderMuted', ' · ');
    this.editorBounds = undefined;
    if (this.confirming) {
      this.composing.focused = false;
      this.bodyHeight = 0;
      // A dedicated compact screen keeps the destructive-action controls visible, even at eight rows.
      return [
        theme.fg('warning', theme.bold(` Stop ${this.confirming.id.slice(0, 8)}?`)),
        theme.fg('warning', ' y stop · n / Esc cancel'),
        theme.fg('text', ` ${oneLine(this.confirming.prompt)}`),
        theme.fg('muted', ' Cannot undo tool side effects.'),
      ].slice(0, height).map((line) => panelLine(line, width, theme, 'toolErrorBg'));
    }
    const compact = height < 8;
    const running = jobs.filter(active).length;
    const title = this.viewing && job ? ` ${jobLine(job, theme, width - 1)}`
      : ` ${theme.fg('accent', theme.bold('Subagents'))}  ${theme.fg(running ? 'accent' : 'muted', `${running} running`)}${separator}${theme.fg('muted', `${jobs.length - running} finished`)}`;
    const subtitle = this.viewing && job
      ? ` ${width - 1 < 60 ? `${job.status} · ` : ''}${oneLine(job.agent.state.model.provider)}/${oneLine(job.agent.state.model.id)} · ${job.agent.state.thinkingLevel} · ${oneLine(job.activity)}${job.pendingSteers ? ` · ${job.pendingSteers} steering queued` : ''}`
      : ` ${key('↑↓')} select · ${key('Enter')} view / steer · ${key('x')} stop · ${key('Esc')} parent`;
    const heading = panelLine(title, width, theme, 'customMessageBg');
    const lines = compact ? [heading] : [rule(true), heading, theme.fg('muted', subtitle)];
    this.bodyTop = lines.length;
    let editor: string[] = [];
    let editorOffset = 0;
    let editorFullHeight = 0;
    if (this.viewing && job?.status === 'running') {
      this.composing.focused = this.focused && !this.confirming;
      editor = this.composing.render(width);
      editorFullHeight = editor.length;
      // Reserve headers/footer and one transcript row before allocating a large draft.
      const maxEditor = Math.max(1, Math.min(6, height - lines.length - (compact ? 1 : 3) - 1));
      if (editor.length > maxEditor) {
        const cursor = editor.findIndex((line) => line.includes('\x1b_pi:c\x07'));
        editorOffset = Math.max(0, cursor - maxEditor + 1);
        editor = editor.slice(editorOffset, editorOffset + maxEditor);
      }
    }
    const footer = theme.fg('muted', compact
      ? this.viewing ? ` ${key('Enter')} steer · ${key('Ctrl+X')} stop · ${key('Esc')} list`
        : ` ${key('Enter')} view · ${key('x')} stop · ${key('Esc')} parent`
      : this.viewing ? ` ${key('Enter')} steer · ${key('Ctrl+X')} stop · ${key('PgUp/PgDn')} scroll · ${key('Ctrl+O')} tools · ${key('Ctrl+T')} thinking · ${key('Esc')} list`
        : ` ${key('Ctrl+Shift+A')} / ${key('/subagents')} · history kept for this session (latest 20 finished)`);
    this.bodyHeight = Math.max(0, height - lines.length - editor.length - (compact ? 1 : 3));
    if (this.viewing && job) {
      this.syncTranscript(job);
      const transcript = this.scroll.render(width);
      // ScrollView owns follow/pause/clamping; clip explicitly so this also works in regular-mode overlays.
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
        const row = `${selected ? theme.fg('accent', theme.bold(' ›')) : '  '} ${jobLine(item, theme, width - 3)}`;
        const detail = `     ${theme.fg('muted', `${width - 3 < 60 ? `${item.status} · ` : ''}${oneLine(item.activity)}`)}${item.pendingSteers ? separator + theme.fg('warning', `${item.pendingSteers} steering queued`) : ''}`;
        // Paint both rows, including their trailing cells, as one selection band.
        lines.push(selected ? panelLine(row, width, theme, 'selectedBg') : row);
        lines.push(selected ? panelLine(detail, width, theme, 'selectedBg') : detail);
      }
      if (!jobs.length) lines.push(theme.fg('muted', ' No subagents yet. Ask the parent to launch some.'));
      lines.splice(this.bodyTop + this.bodyHeight);
      while (lines.length < this.bodyTop + this.bodyHeight) lines.push('');
    }
    const note = this.notice || (this.viewing && job ? `${job.error || ''}${this.scroll.isFollowingEnd ? '  Following live output' : '  Scroll paused · Ctrl+End follows live output'}` : `${jobs.length} total · ${this.selected + (jobs.length ? 1 : 0)} selected`);
    if (editor.length) this.editorBounds = { top: lines.length, height: editor.length, offset: editorOffset, fullHeight: editorFullHeight };
    const noteColor = this.viewing && job?.error ? 'error' : this.notice ? 'accent' : 'muted';
    lines.push(...editor, ...(compact ? [footer] : [theme.fg(noteColor, ` ${oneLine(note)}`), footer, rule(false)]));
    return lines.slice(0, height).map((line) => truncateToWidth(line, width));
  }
  invalidate() {
    this.cacheKey = '';
    this.messages.clear();
    this.partial = undefined;
    this.toolComponents.clear();
    this.transcript.invalidate();
    this.composing.invalidate();
  }
  dispose() { this.closed = true; this.unsubscribe(); }
}

export default function subagentsExtension(pi: ExtensionAPI) {
  const jobs = new Map<string, Job>();
  const listeners = new Set<() => void>();
  let finishedOrder = 0;
  let uiContext: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closeDashboard: (() => void) | undefined;
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

  function refresh() {
    if (uiContext && [...jobs.values()].some(active)) {
      if (!timer) { timer = setInterval(refresh, 100); timer.unref(); }
    } else if (timer) { clearInterval(timer); timer = undefined; }
    for (const listener of listeners) {
      try { listener(); }
      catch (error) {
        // A disposed/broken UI observer must not fail the child Agent's awaited event listener.
        listeners.delete(listener);
        console.error('subagents.pi: UI observer failed:', error);
      }
    }
  }
  function steer(job: Job, prompt: string) {
    if (!prompt.trim()) throw new Error('Steering prompt must not be blank.');
    if (jobs.get(job.id) !== job || job.cancelled || job.status !== 'running') throw new Error(`Subagent is not running: ${job.id}`);
    job.pendingSteers++;
    job.agent.steer({ role: 'user', content: prompt, timestamp: Date.now() });
    refresh();
  }
  function stop(job: Job) {
    if (jobs.get(job.id) !== job || job.status !== 'running') return;
    job.status = 'stopping';
    job.activity = 'Stopping — waiting for cancellation';
    job.agent.clearAllQueues();
    job.pendingSteers = 0;
    job.agent.abort();
    refresh();
  }
  async function dashboard(ctx: ExtensionContext, id?: string) {
    if (ctx.mode !== 'tui') { ctx.ui.notify('The subagent dashboard requires interactive TUI mode.', 'warning'); return; }
    if (closeDashboard) { ctx.ui.notify('The subagent dashboard is already open.', 'info'); return; }
    attachUI(ctx);
    await ctx.ui.custom<void>((tui, _theme, kb, done) => {
      closeDashboard = () => done();
      return new SubagentDashboard(tui, ctx, kb, { jobs: () => [...jobs.values()], steer, stop, subscribe }, done, id);
    }, { overlay: true, overlayOptions: { width: '96%', maxHeight: '100%', anchor: 'center' } }).finally(() => { closeDashboard = undefined; });
  }
  function attachUI(ctx: ExtensionContext) {
    if (ctx.mode !== 'tui' || uiContext) return;
    uiContext = ctx;
    ctx.ui.setWidget(WIDGET, (tui) => {
      const unsubscribe = subscribe(() => tui.requestRender());
      return {
        render(width) {
          const all = [...jobs.values()];
          const running = all.filter(active);
          if (!all.length) return [];
          const theme = ctx.ui.theme;
          const heading = theme.fg('border', running.length ? '╭─ ' : '── ')
            + theme.fg('accent', theme.bold('Subagents')) + theme.fg('borderMuted', ' · ')
            + theme.fg(running.length ? 'accent' : 'muted', `${running.length} running`)
            + theme.fg('muted', ` · ${all.length - running.length} finished`)
            + theme.fg('dim', ' · ') + theme.fg('accent', 'Ctrl+Shift+A');
          return [
            panelLine(heading, width, theme, 'customMessageBg'),
            ...running.slice(0, 4).map((job, index) => theme.fg('border', index === running.length - 1 ? '╰ ' : '│ ')
              + jobLine(job, theme, width - 2) + theme.fg('muted', ` · ${oneLine(job.activity)}`)),
            ...(running.length > 4 ? [theme.fg('border', '╰─ ') + theme.fg('muted', `+${running.length - 4} more · /subagents to view all`)] : []),
          ].map((line) => truncateToWidth(line, width));
        },
        handleMouse(event) {
          if (event.type === 'click' && event.button === 'left') { void dashboard(ctx).catch((error) => ctx.ui.notify(String(error), 'error')); return { handled: true }; }
          return undefined;
        },
        invalidate() { }, dispose: unsubscribe,
      };
    });
    refresh();
  }
  function progress(job: Job, event: AgentEvent) {
    job.revision++;
    if (event.type === 'tool_execution_start') job.tools.set(event.toolCallId, { name: event.toolName, running: true, revision: job.revision });
    if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      const final = event.type === 'tool_execution_end';
      const result = final ? event.result : event.partialResult;
      job.tools.set(event.toolCallId, {
        name: event.toolName, running: !final, revision: job.revision,
        result: { ...result, isError: final ? event.isError : false, ...(final ? { durationMs: event.durationMs } : {}) },
      });
    }
    if (event.type === 'message_start' && event.message.role === 'user') {
      if (job.hasPrompt && job.pendingSteers) job.pendingSteers--;
      job.hasPrompt = true;
    }
    if (job.status === 'running') {
      const tools = [...job.tools.values()].filter((tool) => tool.running);
      job.activity = tools.length ? `Running ${tools.map((tool) => tool.name).join(', ')}`
        : event.type === 'message_update' && event.assistantMessageEvent.type.startsWith('thinking') ? 'Thinking'
          : event.type === 'message_update' ? 'Writing response' : 'Working';
    }
    refresh();
  }
  function prune() {
    // Keep jobs cancellable until report preparation/enqueue settles, including async file writes.
    const finished = [...jobs.values()].filter((job) => job.settled).sort((a, b) => (b.finishedOrder ?? 0) - (a.finishedOrder ?? 0));
    for (const job of finished.slice(HISTORY_LIMIT)) jobs.delete(job.id);
  }
  async function run(job: Job) {
    let response = '';
    let error: string | undefined;
    try {
      await job.agent.prompt(job.prompt);
      while (!job.cancelled && job.status === 'running' && job.agent.hasQueuedMessages()) {
        const outcome = job.agent.state.messages.findLast((message) => message.role === 'assistant');
        // Error/abort are hard exits in Agent; queued steering must not implicitly restart them.
        if (outcome?.role === 'assistant' && (outcome.stopReason === 'error' || outcome.stopReason === 'aborted')) break;
        await job.agent.continue();
      }
      job.agent.clearAllQueues();
      const last = job.agent.state.messages.findLast((message) => message.role === 'assistant');
      if (last?.role === 'assistant') {
        response = last.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
        if (last.stopReason === 'error' || last.stopReason === 'aborted') error = last.errorMessage || `Subagent ${last.stopReason}`;
      } else error = 'Subagent finished without an assistant response.';
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    if (job.cancelled) return;
    job.status = job.status === 'stopping' ? 'stopped' : error ? 'failed' : 'completed';
    job.error = job.status === 'stopped' ? undefined : error;
    job.finishedAt = Date.now();
    job.finishedOrder = ++finishedOrder;
    job.pendingSteers = 0;
    job.activity = job.status === 'stopped' ? 'Stopped by user' : error ?? 'Finished';
    job.revision++;
    refresh();
    const full = `Subagent ${job.id} ${job.status}.\nTask: ${truncateToWidth(oneLine(job.prompt), 160)}\n\n${job.status === 'stopped' ? 'Stopped by user.\n\n' : error ? `Error: ${error}\n\n` : ''}${response || '(No text response.)'}`;
    const truncated = truncateHead(full);
    let content = truncated.content;
    // Make the report immediately recoverable, even if artifact I/O or enqueueing fails.
    job.result = content + (truncated.truncated ? '\n\n[Output truncated; preparing full response file.]' : '');
    let fullOutputPath: string | undefined;
    if (truncated.truncated) {
      try {
        const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-'));
        fullOutputPath = join(directory, 'response.md');
        await writeFile(fullOutputPath, full, { encoding: 'utf8', mode: 0o600 });
        content += `\n\n[Output truncated. Full response: ${fullOutputPath}]`;
      } catch { fullOutputPath = undefined; content += '\n\n[Output truncated; could not save the full response.]'; }
    }
    if (job.cancelled) return;
    job.result = content;
    job.fullOutputPath = fullOutputPath;
    // followUp waits for the parent to stop calling tools, starving useful results
    // during long tasks. steer is drained at a safe boundary after the current tools.
    pi.sendMessage({ customType: WIDGET, content, display: true,
      details: { id: job.id, status: job.status, prompt: job.prompt, model: job.agent.state.model.id,
        provider: job.agent.state.model.provider, fullOutputPath } },
    { triggerTurn: true, deliverAs: 'steer' });
    job.notification = 'queued';
  }
  function waitForJobs(selected: Job[], signal?: AbortSignal, timeoutMs?: number): Promise<boolean> {
    // Subscribe to lifecycle changes rather than polling. Keep object references so history
    // pruning cannot invalidate an in-flight wait for a larger batch.
    return new Promise((resolve, reject) => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = () => {};
      const finish = (timedOut: boolean, error?: unknown) => {
        unsubscribe();
        if (deadline) clearTimeout(deadline);
        signal?.removeEventListener('abort', abort);
        if (error !== undefined) reject(error);
        else resolve(timedOut);
      };
      const abort = () => finish(false, signal?.reason ?? new Error('Subagent wait aborted.'));
      const check = () => {
        if (selected.some((job) => job.cancelled)) finish(false, new Error('Subagent wait cancelled: the session changed or shut down.'));
        else if (selected.every((job) => job.settled)) finish(false);
      };
      unsubscribe = subscribe(check);
      signal?.addEventListener('abort', abort, { once: true });
      if (timeoutMs !== undefined) deadline = setTimeout(() => finish(true), timeoutMs);
      if (signal?.aborted) abort();
      else check();
    });
  }
  async function cleanup() {
    const pending = [...jobs.values()];
    jobs.clear(); // Do not accidentally clear newly launched jobs after awaiting old cancellations.
    closeDashboard?.();
    if (timer) { clearInterval(timer); timer = undefined; }
    uiContext?.ui.setWidget(WIDGET, undefined);
    uiContext = undefined;
    for (const job of pending) { job.cancelled = true; job.unsubscribe?.(); job.agent.clearAllQueues(); job.agent.abort(); }
    refresh(); // Release waits immediately, even when a child tool ignores cancellation.
    await Promise.allSettled(pending.map((job) => job.done));
  }
  pi.on('session_shutdown', cleanup);
  pi.on('session_start', cleanup);
  pi.on('session_tree', cleanup);

  pi.registerCommand('subagents', {
    description: 'Live subagents dashboard: view transcripts, steer, and stop. Optional agent ID prefix.',
    async handler(args, ctx) {
      const prefix = args.trim();
      const matches = prefix ? [...jobs.keys()].filter((id) => id.startsWith(prefix)) : [];
      if (prefix && matches.length !== 1) { ctx.ui.notify(matches.length ? 'Ambiguous subagent ID prefix.' : 'No matching subagent in this session.', 'warning'); return; }
      await dashboard(ctx, matches[0]);
    },
  });
  pi.registerShortcut('ctrl+shift+a', { description: 'Open live subagent dashboard', handler: (ctx) => dashboard(ctx) });
  pi.registerTool({
    name: 'subagents_launch', label: 'Launch subagents',
    description: 'Delegate substantial, well-bounded tasks to background subagents only when parallel progress, context isolation, or independent verification clearly outweighs startup and coordination overhead. Work directly by default; independence alone is not enough. Returns IDs and metadata immediately, not answers. Children have isolated history and share the parent workspace and callable tools. Reports arrive automatically at a safe parent turn boundary or resume an idle parent. No polling needed.',
    promptGuidelines: [
      'Work directly by default. Use subagents_launch only for substantial, well-bounded tasks where parallel progress, context isolation, or independent verification clearly outweighs delegation overhead, or when the user explicitly requests subagents. Independence alone is not enough.',
      'Keep routine searches, a few file reads, small edits, ordinary test commands, and tightly coupled planning/implementation/testing in the parent. Use parallel tool calls for simple concurrency, not separate agents.',
      'Keep the immediate critical path local. Do not launch a child just to immediately wait unless context isolation or independent verification justifies the handoff. For parallel work, identify useful non-overlapping work the parent can continue.',
      'Use the smallest useful number of children: normally one or two, not one per file, command, or phase. Add more only for clearly justified substantial workstreams. Do not duplicate delegated work; review and integrate the returned evidence instead.',
      'Delegate a bounded outcome with relevant context, file paths, constraints, explicit file ownership when editing, and expected concise evidence or results. Each child starts fresh and does not inherit conversation history.',
      'Subagents run in the background. Continue useful work or end your turn; completion reports arrive at the next safe turn boundary and automatically resume an idle parent.',
      'Coordinate shared-file edits to avoid conflicts. Use subagents_steer to redirect a running child. If it has finished, steering returns its result without restarting it.',
      'Use subagents_status to inspect progress or recover a retained result when needed, not in a polling loop. Do not declare delegated work complete until you have checked its result.',
      'Use subagents_wait with one or more exact IDs when the next step depends on their results. It blocks until all selected reports are ready; failures and manual stops also finish a wait. Check each returned status before continuing.',
    ],
    parameters: Launch,
    outputSchema: Type.Object({ ids: Type.Array(Type.String()), agents: Type.Array(Snapshot) }),
    async execute(_callId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!params.tasks.length) throw new Error('At least one subagent task is required.');
      const activeTools = new Set(pi.getActiveTools());
      const defaultTools = ctx.tools.filter((tool) => activeTools.has(tool.name) && !OWN_TOOLS.has(tool.name)).map((tool) => tool.name);
      const prepared: Job[] = params.tasks.map((task) => ({
        id: randomUUID(), agent: prepare(task, ctx, ctx.thinkingLevel ?? pi.getThinkingLevel(), defaultTools),
        prompt: task.prompt, cwd: ctx.cwd, cancelled: false, status: 'running', startedAt: Date.now(),
        activity: 'Starting', revision: 0, pendingSteers: 0, tools: new Map(), notification: 'pending',
      }));
      attachUI(ctx);
      for (const job of prepared) {
        jobs.set(job.id, job);
        job.unsubscribe = job.agent.subscribe((event) => progress(job, event));
        job.done = run(job).catch((error) => {
          job.notification = 'failed';
          job.notificationError = error instanceof Error ? error.message : String(error);
          console.error(`subagents.pi: could not deliver ${job.id}:`, error);
        }).finally(() => { job.settled = true; job.unsubscribe?.(); prune(); refresh(); });
      }
      refresh();
      const ids = prepared.map((job) => job.id);
      return {
        content: [{ type: 'text', text: `Launched background subagents: ${ids.join(', ')}. Responses will arrive automatically.` }],
        details: { ids },
        structuredContent: { ids, agents: prepared.map((job) => snapshot(job)) },
      };
    },
  });
  pi.registerTool({
    name: 'subagents_steer', label: 'Steer subagent',
    description: 'Send guidance to a running background subagent after its current turn and tools finish. If it has already finished or is stopping, returns accepted:false with its current status and available result; never restarts it.',
    parameters: Steer,
    outputSchema: Type.Object({ accepted: Type.Boolean(), agent: Snapshot }),
    async execute(_callId, params, signal) {
      signal?.throwIfAborted();
      const job = jobs.get(params.id);
      if (!params.prompt.trim()) throw new Error('Steering prompt must not be blank.');
      if (!job) throw new Error(`Subagent is not running or no longer retained: ${params.id}. Use subagents_status to list current jobs.`);
      const accepted = job.status === 'running';
      if (accepted) steer(job, params.prompt);
      const agent = snapshot(job, !accepted);
      return {
        content: [{ type: 'text', text: accepted ? `Steering queued for subagent ${job.id}.`
          : `Subagent ${job.id} is ${job.status}; guidance was not queued and the child was not restarted.\n\n${job.result ?? 'The final report is not ready yet.'}` }],
        details: { id: job.id, accepted, status: job.status },
        structuredContent: { accepted, agent },
      };
    },
  });
  pi.registerTool({
    name: 'subagents_wait', label: 'Wait for subagents',
    description: 'Wait for all specified background subagents to finish and prepare their reports, without polling or making model calls. Returns results for completed, failed, or stopped jobs. Optional timeout returns current snapshots with timedOut:true. Cancelling the wait or timing out does not stop children. Automatic completion notifications remain enabled. IDs must be exact and retained when the call starts.',
    parameters: Wait,
    outputSchema: Type.Object({ timedOut: Type.Boolean(), agents: Type.Array(Snapshot) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_callId, params, signal) {
      signal?.throwIfAborted();
      if (!params.ids.length) throw new Error('At least one subagent ID is required.');
      if (new Set(params.ids).size !== params.ids.length) throw new Error('Subagent IDs must be unique.');
      if (params.timeoutMs !== undefined && (!Number.isInteger(params.timeoutMs) || params.timeoutMs < 1 || params.timeoutMs > 2_147_483_647)) {
        throw new Error('timeoutMs must be an integer between 1 and 2147483647.');
      }
      const selected = params.ids.map((id) => {
        const job = jobs.get(id);
        if (!job) throw new Error(`Unknown or no longer retained subagent: ${id}`);
        return job;
      });
      const timedOut = await waitForJobs(selected, signal, params.timeoutMs);
      const agents = selected.map((job) => snapshot(job, true));
      const report = truncateHead([
        timedOut ? 'Wait timed out; unfinished children continue in the background.' : 'All selected subagents have finished. Check their statuses before depending on results.',
        ...agents.map((agent) => `${agent.id} · ${agent.status} · ${agent.activity}\n\n${agent.result ?? '(No final report yet.)'}`),
      ].join('\n\n'));
      return {
        content: [{ type: 'text', text: report.content + (report.truncated ? '\n\n[Combined output truncated. Use subagents_status with an exact ID to recover individual reports.]' : '') }],
        details: { timedOut, agents }, structuredContent: { timedOut, agents },
      };
    },
  });
  pi.registerTool({
    name: 'subagents_status', label: 'Subagent status',
    description: 'Inspect background subagent progress without waiting or making model calls. Omit id to list retained jobs; supply an exact ID to recover its available result. Reports are delivered automatically; use this for diagnostics, not polling. History is limited to this runtime and the latest 20 finished jobs.',
    parameters: Inspect,
    outputSchema: Type.Object({ agents: Type.Array(Snapshot) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_callId, params, signal) {
      signal?.throwIfAborted();
      const job = params.id ? jobs.get(params.id) : undefined;
      if (params.id && !job) throw new Error(`Unknown or no longer retained subagent: ${params.id}`);
      const agents = (job ? [job] : [...jobs.values()]).map((item) => snapshot(item, Boolean(job)));
      return {
        content: [{ type: 'text', text: agents.length ? agents.map((item) =>
          `${item.id} · ${item.status} · ${item.activity}\nTask: ${truncateToWidth(oneLine(item.prompt), 160)}`
          + (job ? `\nNotification: ${item.notification}${item.notificationError ? ` (${item.notificationError})` : ''}\n\n${item.result ?? '(No final report yet.)'}` : '')).join('\n\n')
          : 'No retained subagents in this session.' }],
        details: { agents }, structuredContent: { agents },
      };
    },
  });
}
