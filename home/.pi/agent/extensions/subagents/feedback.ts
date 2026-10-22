import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { config } from './config.ts';
import type { Feedback, FeedbackKind } from './contracts.ts';
import { askDescription } from './prompts.ts';

export function feedbackMessage(feedback: Feedback) {
  const need = feedback.kind === 'decision' ? 'needs a decision' : 'found a gap';
  return `Subagent ${feedback.id} ${need}.\n\n${feedback.message}\n\nSteer ${feedback.id} with the answer, or ask the user and then steer. Do not wait for the final report.`;
}

export function deliverFeedback(pi: ExtensionAPI, feedback: Feedback) {
  pi.sendMessage({
    customType: config.widgetId,
    display: true,
    content: feedbackMessage(feedback),
    details: { id: feedback.id, kind: feedback.kind, message: feedback.message, feedback: true },
  }, { triggerTurn: true, deliverAs: 'steer' });
}

export function askTool(onAsk: (feedback: Feedback) => void): ToolDefinition {
  return {
    name: config.askTool,
    label: 'Ask parent',
    description: askDescription,
    promptGuidelines: [
      'Call this as soon as a missing decision or a discovered gap blocks useful work.',
      'The parent is notified immediately. Stop after asking if you cannot continue without the answer.',
    ],
    parameters: Type.Object({
      message: Type.String({ minLength: 1, description: 'The gap or the decision you need, including the options if you have them.' }),
      kind: Type.Optional(StringEnum(['gap', 'decision'] as const)),
    }),
    async execute(_toolCallId, params) {
      const message = params.message.trim();
      if (!message) throw new Error('Ask message must not be blank.');
      const kind: FeedbackKind = params.kind === 'decision' ? 'decision' : 'gap';
      onAsk({ id: '', kind, message });
      return {
        content: [{ type: 'text', text: 'Parent notified. If you need a decision before continuing, stop now. Guidance will arrive as a user message.' }],
        details: { delivered: true, kind },
      };
    },
  };
}
