import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import { truncateHead, type AgentSessionEvent, type ExtensionAPI, type ExtensionContext, type ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth } from '@earendil-works/pi-tui';
import { config } from './config.ts';
import { updateActivity } from './activity.ts';
import { catalogForContext } from './catalog.ts';
import { active, lastAssistantText, type FeedbackKind, type Job } from './contracts.ts';
import { deliverFeedback } from './feedback.ts';
import { boundedReport, oneLine, snapshot } from './formatting.ts';
import { closeChildSession, openChildSession, resolveModel } from './session.ts';
import type { TaskInput } from './contracts.ts';

export interface Runtime {
  jobs: Map<string, Job>;
  subscribe: (listener: () => void) => () => void;
  launch: (tasks: TaskInput[], signal: AbortSignal | undefined, ctx: ExtensionToolContext) => Promise<Job[]>;
  steer: (job: Job, prompt: string) => void;
  stop: (job: Job) => void;
  waitFor: (selected: Job[], signal?: AbortSignal, timeoutMs?: number) => Promise<boolean>;
  discard: (selected: Job[]) => Promise<void>;
  refresh: () => void;
  attachUI: (ctx: ExtensionContext) => void;
  setAttachUI: (attach: (ctx: ExtensionContext) => void) => void;
}

export function createRuntime(pi: ExtensionAPI): Runtime {
  const jobs = new Map<string, Job>();
  const usedNames = new Set<string>();
  // Discarded/evicted jobs may still be awaiting extension shutdown.
  const releasing = new Set<Promise<void>>();
  const listeners = new Set<() => void>();
  let finishedOrder = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let uiContext: ExtensionContext | undefined;
  let attachUI = (_ctx: ExtensionContext) => {};
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  function refresh() {
    if (uiContext && [...jobs.values()].some(active)) {
      if (!timer) { timer = setInterval(refresh, 100); timer.unref(); }
    } else if (timer) { clearInterval(timer); timer = undefined; }
    for (const listener of listeners) {
      try { listener(); }
      catch (error) {
        listeners.delete(listener);
        console.error('subagents.pi: UI observer failed:', error);
      }
    }
  }

  function release(job: Job) {
    job.unsubscribe?.();
    job.unsubscribe = undefined;
    const session = job.session;
    job.session = undefined;
    job.tools.clear();
    job.done = undefined;
    if (!session) return Promise.resolve();
    const closing = closeChildSession(session).catch((error) => {
      console.error(`subagents.pi: could not close ${job.id}:`, error);
    });
    releasing.add(closing);
    return closing.finally(() => { releasing.delete(closing); });
  }

  async function prune() {
    const finished = [...jobs.values()].filter((job) => job.settled).sort((a, b) => (b.finishedOrder ?? 0) - (a.finishedOrder ?? 0));
    await discard(finished.slice(config.historyLimit));
  }

  function progress(job: Job, event: AgentSessionEvent) {
    if (event.type === 'message_start' && event.message.role === 'user') {
      if (job.hasPrompt && job.pendingSteers) job.pendingSteers--;
      job.hasPrompt = true;
    }
    updateActivity(job, event);
    refresh();
  }

  async function settle(job: Job, response: string, error?: string) {
    if (job.cancelled) return;
    job.status = job.status === 'stopping' ? 'stopped' : error ? 'failed' : 'completed';
    job.error = job.status === 'stopped' ? undefined : error;
    job.finishedAt = Date.now();
    job.finishedOrder = ++finishedOrder;
    job.pendingSteers = 0;
    job.activity = job.status === 'stopped' ? 'Stopped by user' : error ?? 'Finished';
    refresh();
    const report = await boundedReport(job, response, error);
    if (job.cancelled) return;
    job.result = report.content;
    job.fullOutputPath = report.fullOutputPath;
    try {
      pi.sendMessage({
        customType: config.widgetId, content: report.content, display: true,
        details: {
          id: job.id, status: job.status, prompt: job.prompt, model: job.model,
          provider: job.provider, fullOutputPath: report.fullOutputPath,
        },
      }, { triggerTurn: true, deliverAs: 'steer' });
      job.notification = 'queued';
    } catch (failure) {
      job.notification = 'failed';
      job.notificationError = failure instanceof Error ? failure.message : String(failure);
      throw failure;
    }
  }

  async function run(job: Job) {
    const session = job.session!;
    let response = '';
    let error: string | undefined;
    try {
      await session.prompt(job.prompt);
      const outcome = lastAssistantText(session.messages);
      response = outcome.text;
      error = outcome.error;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    if (job.cancelled) return;
    await settle(job, response, error);
  }

  function watch(job: Job) {
    const session = job.session!;
    job.unsubscribe = session.subscribe((event) => progress(job, event));
    job.done = run(job).catch((failure) => {
      job.notification = 'failed';
      job.notificationError = failure instanceof Error ? failure.message : String(failure);
      console.error(`subagents.pi: could not deliver ${job.id}:`, failure);
    }).finally(async () => {
      job.done = undefined;
      job.settled = true;
      await prune();
      refresh();
    });
  }

  function steer(job: Job, prompt: string) {
    if (!prompt.trim()) throw new Error('Steering prompt must not be blank.');
    if (jobs.get(job.id) !== job || job.cancelled || job.status !== 'running' || !job.session) throw new Error(`Subagent is not running: ${job.id}`);
    job.pendingSteers++;
    void job.session.steer(prompt).catch((error) => {
      job.pendingSteers = Math.max(0, job.pendingSteers - 1);
      job.activity = error instanceof Error ? error.message : String(error);
      refresh();
    });
    refresh();
  }

  function stop(job: Job) {
    if (jobs.get(job.id) !== job || job.status !== 'running' || !job.session) return;
    job.status = 'stopping';
    job.activity = 'Stopping — waiting for cancellation';
    job.session.agent.clearAllQueues();
    job.pendingSteers = 0;
    void job.session.abort();
    refresh();
  }

  function ask(job: Job, message: string, kind: FeedbackKind) {
    job.activity = kind === 'decision' ? 'Needs a decision' : 'Found a gap';
    refresh();
    deliverFeedback(pi, { id: job.id, kind, message });
  }

  async function launch(tasks: TaskInput[], signal: AbortSignal | undefined, ctx: ExtensionToolContext) {
    signal?.throwIfAborted();
    if (!tasks.length) throw new Error('At least one subagent task is required.');
    // Resolve all requested roles from one fresh scan before reserving names or opening sessions.
    // The body is snapshotted for this launch; later filesystem edits affect only later launches.
    const catalog = tasks.some((task) => task.agent !== undefined) ? catalogForContext(ctx) : undefined;
    const definitions = tasks.map((task) => {
      if (task.agent === undefined) return undefined;
      const definition = catalog?.agents.find((item) => item.name === task.agent);
      if (!definition) throw new Error(`Unknown or invalid agent definition: ${task.agent}. Use subagents_list for available names and discovery diagnostics.`);
      return definition;
    });
    const batchNames = new Set<string>();
    const reserved: string[] = [];
    const opened: Job[] = [];
    const thinkingLevel = (ctx.thinkingLevel ?? pi.getThinkingLevel()) as ThinkingLevel;
    try {
      for (const task of tasks) {
        if (typeof task.name !== 'string' || task.name.length > config.nameMaxLength || task.name.trim() !== task.name || !new RegExp(config.namePattern).test(task.name)) {
          throw new Error(`Subagent name must be 1–${config.nameMaxLength} characters in lowercase kebab-case, starting with a letter (e.g. review-parser).`);
        }
        if (!task.prompt.trim()) throw new Error('Subagent prompt must not be blank.');
        if (batchNames.has(task.name) || usedNames.has(task.name)) throw new Error(`Subagent name already used in this session or batch: ${task.name}`);
        resolveModel(task, ctx);
        batchNames.add(task.name);
        usedNames.add(task.name);
        reserved.push(task.name);
      }
      for (const [index, task] of tasks.entries()) {
        signal?.throwIfAborted();
        const definition = definitions[index];
        const child = await openChildSession({
          task, definition, ctx, pi, thinkingLevel,
          onAsk: (message, kind) => {
            const job = jobs.get(task.name);
            if (job) ask(job, message, kind);
          },
        });
        const job: Job = {
          id: task.name, session: child.session,
          model: child.modelId, provider: child.provider, prompt: task.prompt,
          ...(definition ? { agentType: definition.name, agentFile: definition.filePath } : {}),
          cancelled: false, status: 'running', startedAt: Date.now(), activity: 'Starting',
          pendingSteers: 0, tools: new Map(), notification: 'pending',
        };
        opened.push(job);
      }
      signal?.throwIfAborted();
    } catch (error) {
      await Promise.all(opened.map(release));
      for (const name of reserved) usedNames.delete(name);
      throw error;
    }
    for (const job of opened) {
      jobs.set(job.id, job);
      watch(job);
    }
    refresh();
    return opened;
  }

  function waitFor(selected: Job[], signal?: AbortSignal, timeoutMs?: number) {
    return new Promise<boolean>((resolve, reject) => {
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

  async function discard(selected: Job[]) {
    for (const job of selected) jobs.delete(job.id);
    await Promise.all(selected.map(release));
    refresh();
  }

  async function cleanup() {
    const pending = [...jobs.values()];
    jobs.clear();
    usedNames.clear();
    if (timer) { clearInterval(timer); timer = undefined; }
    uiContext?.ui.setWidget(config.widgetId, undefined);
    uiContext = undefined;
    for (const job of pending) {
      job.cancelled = true;
      job.unsubscribe?.();
      job.session?.agent.clearAllQueues();
      void job.session?.abort();
    }
    refresh();
    await Promise.allSettled(pending.map((job) => job.done));
    await Promise.all([...releasing, ...pending.map(release)]);
  }

  pi.on('session_shutdown', cleanup);
  pi.on('session_start', cleanup);
  pi.on('session_tree', cleanup);

  return {
    jobs, subscribe, launch, steer, stop, waitFor, discard, refresh,
    attachUI: (ctx) => {
      if (ctx.mode !== 'tui' || uiContext) return;
      uiContext = ctx;
      attachUI(ctx);
      refresh();
    },
    setAttachUI: (attach) => { attachUI = attach; },
  };
}

export function statusText(agents: ReturnType<typeof snapshot>[], detailed: boolean) {
  if (!agents.length) return 'No retained subagents in this session.';
  return agents.map((item) => `${item.id} · ${item.status} · ${item.activity}\nTask: ${truncateToWidth(oneLine(item.prompt), 160)}`
    + (detailed ? `\nNotification: ${item.notification}${item.notificationError ? ` (${item.notificationError})` : ''}\n\n${item.result ?? '(No final report yet.)'}` : '')).join('\n\n');
}

export function waitText(timedOut: boolean, agents: ReturnType<typeof snapshot>[]) {
  const report = truncateHead([
    timedOut ? 'Wait timed out; unfinished children continue in the background.' : 'All selected subagents have finished. Check their statuses before depending on results.',
    ...agents.map((agent) => `${agent.id} · ${agent.status} · ${agent.activity}\n\n${agent.result ?? '(No final report yet.)'}`),
  ].join('\n\n'));
  return report.content + (report.truncated ? '\n\n[Combined output truncated. Use subagents_status with an exact ID to recover individual reports.]' : '');
}
