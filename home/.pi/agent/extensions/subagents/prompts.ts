import { config } from './config.ts';

export const childPromptAppendix = [
  'You are a child Pi session orchestrated by a parent session.',
  'You do not inherit its conversation history.',
  'You have the same system prompt as the parent. Unless this task overrode them, you also have the same model, thinking level, tools, extensions, MCP servers, and Pi configuration.',
  `Use ${config.askTool} immediately when you hit a gap or need a decision. It returns as soon as the parent is notified.`,
  'If you cannot continue without that decision, return your findings and stop after asking. This finishes your task; the parent can launch a fresh task with the answer.',
  'When the task is done, return a concise result the parent can integrate.',
].join(' ');

export const launchDescription = 'Delegate substantial, well-bounded tasks to background subagents only when parallel progress, context isolation, or independent verification clearly outweighs startup and coordination overhead. Work directly by default; independence alone is not enough. Give each task a meaningful short kebab-case name; that name is its ID. Returns IDs and metadata immediately, not answers. Children are full Pi sessions: they inherit the parent system prompt, and the parent model, thinking level, configuration, tools, and extensions unless a task overrides those, and they do not inherit conversation history. Reports arrive automatically at a safe parent turn boundary or resume an idle parent, including decision requests. No polling needed. Use the optional agent field to select a discovered named definition; its instructions are loaded automatically into the child system prompt. subagents_list lists definitions, while subagents_status lists launched jobs.';

export const launchGuidelines = [
  'Use a matching named agent definition when available: pass its frontmatter name in tasks[].agent, independently of the unique job name. Definitions are advertised in the system prompt; subagents_list rescans them and reports diagnostics. The runtime loads the selected body automatically after the inherited parent prompt and before any task append.',
  'Give every subagent a meaningful short kebab-case name, such as review-parser or write-tests. The name is the exact agent ID for steer/status/wait/discard and its UI label. Names must be unique in this session, even after discard; use a fresh name for a new task.',
  'Work directly by default. Use subagents_launch only for substantial, well-bounded tasks where parallel progress, context isolation, or independent verification clearly outweighs delegation overhead, or when the user explicitly requests subagents. Independence alone is not enough.',
  'Keep routine searches, a few file reads, small edits, ordinary test commands, and tightly coupled planning/implementation/testing in the parent. Use parallel tool calls for simple concurrency, not separate agents.',
  'Keep the immediate critical path local. Do not launch a child just to immediately wait unless context isolation or independent verification justifies the handoff. For parallel work, identify useful non-overlapping work the parent can continue.',
  'Use the smallest useful number of children: normally one or two, not one per file, command, or phase. Add more only for clearly justified substantial workstreams. Do not duplicate delegated work; review and integrate the returned evidence instead.',
  'Delegate a bounded outcome with relevant context, file paths, constraints, explicit file ownership when editing, and expected concise evidence or results. Each child starts fresh and does not inherit conversation history. It inherits the parent system prompt. A task may append to that prompt, but cannot replace it. It also inherits the parent model, thinking level, Pi configuration, tools, and extensions unless the task overrides those.',
  'Subagents run in the background. Continue useful work or end your turn; completion reports arrive at the next safe turn boundary and automatically resume an idle parent.',
  `A child can call ${config.askTool} as soon as it finds a gap or needs a decision. That message arrives immediately, before the final report. Steer the child with the answer only while it is running. If it finishes while blocked, ask the user if needed and launch a fresh task with the answer and relevant findings. Finished children cannot resume. Do not ignore an ask until completion.`,
  'Coordinate shared-file edits to avoid conflicts. Use subagents_steer to redirect a running child. If it has finished, steering returns its result without restarting it. User guidance goes through the parent; the inline subagent menu only selects and stops running children.',
  'Use subagents_status to inspect progress or recover a retained result when needed, not in a polling loop. Do not declare delegated work complete until you have checked its result.',
  'Use subagents_wait with one or more exact IDs when the next step depends on their results. It blocks until all selected reports are ready; failures and manual stops also finish a wait. Check each returned status before continuing.',
  'After reviewing and integrating a finished subagent report, call subagents_discard with its exact ID when it is no longer needed. This releases retained reports and the live child session; never discard unread results or jobs needed by another pending operation.',
];

export const askDescription = 'Tell the parent session immediately about a gap or a decision you need. Returns as soon as the parent is notified. If you cannot continue without the answer, return your findings and stop. This finishes the task; the parent can launch a fresh task with the answer.';
