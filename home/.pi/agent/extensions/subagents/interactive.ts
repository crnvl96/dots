import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  AssistantMessageComponent, ToolExecutionComponent, UserMessageComponent, getMarkdownTheme,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Container, Editor, ScrollView, Text, type TUI } from '@earendil-works/pi-tui';
import type { Job, ToolProgress } from './contracts.ts';

export interface TranscriptState {
  messages: Map<AgentMessage, { render: (width: number) => string[] } | AssistantMessageComponent | UserMessageComponent>;
  toolComponents: Map<string, { component: ToolExecutionComponent; revision: number; expanded?: boolean }>;
  transcript: Container;
  scroll: ScrollView;
  cacheKey: string;
  lastStreaming?: AgentMessage;
  partial?: { index: number; component: AssistantMessageComponent };
  hideThinking: boolean;
  expanded: boolean;
}

export function createTranscript(): TranscriptState {
  const transcript = new Container();
  return {
    messages: new Map(), toolComponents: new Map(), transcript, scroll: new ScrollView(transcript, { follow: 'end' }),
    cacheKey: '', hideThinking: true, expanded: false,
  };
}

export function createComposer(tui: TUI, ctx: ExtensionContext) {
  const theme = ctx.ui.theme;
  return new Editor(tui, {
    borderColor: (text) => theme.fg('accent', text),
    selectList: {
      selectedPrefix: (text) => theme.fg('accent', text), selectedText: (text) => theme.fg('accent', text),
      description: (text) => theme.fg('muted', text), scrollInfo: (text) => theme.fg('dim', text),
      noMatch: (text) => theme.fg('warning', text),
    },
  });
}

export function clearTranscript(state: TranscriptState) {
  state.cacheKey = '';
  state.messages.clear();
  state.toolComponents.clear();
  state.transcript.clear();
  state.transcript.render(0);
  state.partial = undefined;
  state.lastStreaming = undefined;
}

export function syncTranscript(job: Job, state: TranscriptState, tui: TUI) {
  const key = `${job.id}:${job.revision}:${state.hideThinking}:${state.expanded}:${job.agent ? 'live' : 'report'}`;
  if (key === state.cacheKey) return;
  state.cacheKey = key;
  state.transcript.clear();
  if (!job.agent) {
    state.transcript.addChild(new Text(job.result ?? '(No final report available.)', 0, 0));
    return;
  }
  const streaming = job.agent.state.streamingMessage;
  const messages = [...job.agent.state.messages, ...(streaming ? [streaming] : [])];
  const kept = new Set<AgentMessage>();
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user') {
      let component = state.messages.get(message);
      if (!component) {
        const text = typeof message.content === 'string' ? message.content : message.content.map((part) => part.type === 'text' ? part.text : '[image]').join('\n');
        component = new UserMessageComponent(text, getMarkdownTheme());
        state.messages.set(message, component);
      }
      kept.add(message);
      state.transcript.addChild(component as UserMessageComponent);
    } else if (message.role === 'assistant') {
      let component = state.messages.get(message) as AssistantMessageComponent | undefined;
      if (!component || !('updateContent' in component)) {
        component = state.partial?.index === index ? state.partial.component
          : new AssistantMessageComponent(undefined, state.hideThinking, getMarkdownTheme());
        component.updateContent(message, message === streaming);
        state.messages.set(message, component);
      } else if (message === streaming || message === state.lastStreaming) component.updateContent(message, message === streaming);
      if (message === streaming) state.partial = { index, component };
      kept.add(message);
      state.transcript.addChild(component);
      for (const call of message.content) {
        if (call.type !== 'toolCall') continue;
        const progress = job.tools.get(call.id) as ToolProgress | undefined;
        const revision = message === streaming ? job.revision : progress?.revision ?? -1;
        let cached = state.toolComponents.get(call.id);
        if (!cached) {
          cached = { component: new ToolExecutionComponent(call.name, call.id, call.arguments, { showImages: false }, {}, tui, job.cwd), revision: -2 };
          state.toolComponents.set(call.id, cached);
        }
        if (cached.revision !== revision) {
          cached.component.updateArgs(call.arguments);
          if (message !== streaming) cached.component.setArgsComplete();
          if (progress) cached.component.markExecutionStarted();
          if (progress?.result) cached.component.updateResult(progress.result as never, progress.running);
          cached.revision = revision;
        }
        if (cached.expanded !== state.expanded) {
          cached.component.setExpanded(state.expanded);
          cached.expanded = state.expanded;
        }
        state.transcript.addChild(cached.component);
      }
    }
  }
  for (const message of state.messages.keys()) if (!kept.has(message)) state.messages.delete(message);
  state.lastStreaming = streaming;
  if (!streaming) state.partial = undefined;
}
