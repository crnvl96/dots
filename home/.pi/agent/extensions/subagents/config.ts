/**
 * Knobs for orchestrated child sessions. Edit this file, then /reload.
 * Children are in-memory Pi sessions. They are not written to the session directory.
 */
export const config = {
  /** Widget and completion-message type. Pi discovers the extension by its folder, not this id. */
  widgetId: 'subagents.pi',
  /** Meaningful kebab-case names are the public IDs. */
  namePattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
  nameMaxLength: 48,
  /** Settled reports kept if the parent never discards them. Live sessions are disposed with the report. */
  historyLimit: 20,
  /** Child-only tool. Always available unless a task sets tools to []. */
  askTool: 'subagents_ask',
  /**
   * Background children do not warm a second prompt cache. Everything else in the parent
   * settings object is copied unless a task overrides model, thinking, tools, or system prompt.
   */
  childCacheWarming: 'off' as const,
};
