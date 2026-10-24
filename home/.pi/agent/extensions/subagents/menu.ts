import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { config } from './config.ts';
import { active, type MenuActions } from './contracts.ts';
import { renderWidget } from './rendering.ts';
import type { Runtime } from './runtime.ts';

/** Read-only display. All input and child guidance belong to the parent session. */
export class SubagentMenu implements Component {
  private closed = false;
  private unsubscribe: () => void;
  private tui: TUI;
  private ctx: ExtensionContext;
  private actions: MenuActions;

  constructor(tui: TUI, ctx: ExtensionContext, actions: MenuActions) {
    this.tui = tui;
    this.ctx = ctx;
    this.actions = actions;
    this.unsubscribe = actions.subscribe(() => tui.requestRender());
  }

  render(width: number): string[] {
    if (this.closed) return [];
    const height = Math.max(1, Math.min(8, Math.floor(this.tui.terminal.rows / 3)));
    return renderWidget(this.actions.jobs().filter(active), this.ctx.ui.theme, width, height);
  }

  invalidate() {}

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
  }
}

export function bindMenu(runtime: Runtime) {
  runtime.setAttachUI((ctx) => {
    ctx.ui.setWidget(
      config.widgetId,
      (tui) =>
        new SubagentMenu(tui, ctx, {
          jobs: () => [...runtime.jobs.values()],
          subscribe: runtime.subscribe,
        }),
    );
  });
}
