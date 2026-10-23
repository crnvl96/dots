import { CustomEditor, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { matchesKey, type Component, type TUI } from '@earendil-works/pi-tui';
import { config } from './config.ts';
import { active, type MenuActions } from './contracts.ts';
import { renderWidget } from './rendering.ts';
import type { Runtime } from './runtime.ts';

/** The inline menu never takes focus or opens a child session. */
export class SubagentMenu implements Component {
  private selectedId?: string;
  private selected = 0;
  private closed = false;
  private unsubscribe: () => void;
  private unsubscribeInput: () => void;
  private tui: TUI;
  private ctx: ExtensionContext;
  private actions: MenuActions;

  constructor(tui: TUI, ctx: ExtensionContext, actions: MenuActions) {
    this.tui = tui;
    this.ctx = ctx;
    this.actions = actions;
    this.unsubscribe = actions.subscribe(() => {
      this.activeJobs();
      tui.requestRender();
    });
    this.unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      // Raw listeners run before dialogs, autocomplete and application shortcuts.
      // Only borrow keys from the parent editor, never from another focused UI.
      // Both Pi renderers expose this; unknown renderers safely keep their keys.
      const editor = 'getFocusedComponent' in tui && typeof tui.getFocusedComponent === 'function'
        ? tui.getFocusedComponent() : undefined;
      if (!(editor instanceof CustomEditor) || tui.hasOverlay() || editor.isShowingAutocomplete()) return;
      if ((matchesKey(data, 'up') || matchesKey(data, 'down')) && ctx.ui.getEditorText() !== '') return;
      if (this.handleInput(data)) return { consume: true };
    });
  }

  private activeJobs() {
    const jobs = this.actions.jobs().filter(active);
    const index = jobs.findIndex((job) => job.id === this.selectedId);
    this.selected = index < 0 ? Math.min(this.selected, Math.max(0, jobs.length - 1)) : index;
    this.selectedId = jobs[this.selected]?.id;
    return jobs;
  }

  handleInput(data: string): boolean {
    if (this.closed) return false;
    const up = matchesKey(data, 'up');
    const down = matchesKey(data, 'down');
    const stop = matchesKey(data, 'ctrl+x');
    if (!up && !down && !stop) return false;
    const jobs = this.activeJobs();
    if (!jobs.length) return false;
    if (stop) {
      const job = jobs[this.selected];
      if (job.status === 'running') this.actions.stop(job);
    } else {
      this.selected = Math.max(0, Math.min(jobs.length - 1, this.selected + (down ? 1 : -1)));
      this.selectedId = jobs[this.selected].id;
    }
    this.tui.requestRender();
    return true;
  }

  render(width: number): string[] {
    if (this.closed) return [];
    const capacity = Math.max(1, Math.min(4, Math.floor(this.tui.terminal.rows / 3)));
    return renderWidget(this.activeJobs(), this.ctx.ui.theme, width, this.selected, capacity);
  }

  invalidate() {}

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.unsubscribeInput();
  }
}

export function bindMenu(runtime: Runtime) {
  runtime.setAttachUI((ctx) => {
    ctx.ui.setWidget(config.widgetId, (tui) => {
      return new SubagentMenu(tui, ctx, {
        jobs: () => [...runtime.jobs.values()],
        stop: (job) => runtime.stop(job),
        subscribe: runtime.subscribe,
      });
    });
  });
}
