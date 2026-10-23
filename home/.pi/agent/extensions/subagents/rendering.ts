import type { Theme } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { Job } from './contracts.ts';
import { elapsed, oneLine } from './formatting.ts';

const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

function columns(left: string, right: string, width: number) {
  const room = width - visibleWidth(right) - 2;
  if (room < 12) return truncateToWidth(left, width);
  const clipped = truncateToWidth(left, room);
  return clipped + ' '.repeat(width - visibleWidth(clipped) - visibleWidth(right)) + right;
}

function activityColor(activity: string) {
  if (activity === 'Stopping' || activity === 'Needs a decision' || activity === 'Found a gap') return 'warning';
  if (activity === 'Thinking') return 'accent';
  if (activity.startsWith('Running ')) return 'success';
  return 'muted';
}

/** Active jobs only. Keep the selected row visible without growing the menu. */
export function renderWidget(jobs: Job[], theme: Theme, width: number, selected = 0, capacity = 4) {
  if (!jobs.length || width <= 0) return [];
  const start = Math.max(0, selected - capacity + 1);
  const frame = FRAMES[Math.floor(Date.now() / 100) % FRAMES.length];
  const running = jobs.filter((job) => job.status === 'running').length;
  const stopping = jobs.length - running;
  const heading = theme.fg('accent', `${frame} ${theme.bold('Subagents')}`)
    + theme.fg('dim', ' · ') + theme.fg('success', `${running} running`)
    + (stopping ? theme.fg('dim', ' · ') + theme.fg('warning', `${stopping} stopping`) : '');
  return [
    heading,
    ...jobs.slice(start, start + capacity).map((job, offset) => {
      const chosen = start + offset === selected;
      const title = theme.fg(chosen ? 'accent' : 'text', `${chosen ? '›' : ' '} ${job.id}`);
      const activity = job.status === 'stopping' ? 'Stopping' : oneLine(job.activity);
      return columns(`  ${chosen ? theme.bold(title) : title}`,
        theme.fg(activityColor(activity), activity) + theme.fg('dim', ` · ${elapsed(job)}`), width);
    }),
    theme.fg('dim', `  ↑↓ select · Ctrl+X stop${jobs.length > capacity ? ` · ${selected + 1}/${jobs.length}` : ''}`),
  ].map((line) => truncateToWidth(line, width));
}
