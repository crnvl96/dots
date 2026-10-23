import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { Job } from './contracts.ts';
import { elapsed, oneLine } from './formatting.ts';

const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const STATUS = {
  running: { icon: '●', color: 'success' },
  stopping: { icon: '◌', color: 'warning' },
  completed: { icon: '✓', color: 'success' },
  failed: { icon: '✕', color: 'error' },
  stopped: { icon: '■', color: 'muted' },
} as const;

function cell(text: string, width: number, right = false) {
  const clipped = truncateToWidth(text, width);
  const padding = ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
  return right ? padding + clipped : clipped + padding;
}

function activityColor(activity: string): ThemeColor {
  if (/^(Stopping|Needs a decision|Found a gap|Retrying|Compacting|Context compaction|Editing|Writing (?!response))/.test(activity)) return 'warning';
  if (/^(Thinking|Writing response|Preparing)/.test(activity)) return 'accent';
  if (/^(Reading|Searching|Finding|Listing|Running|Using)/.test(activity)) return 'success';
  return 'muted';
}

/** Active jobs only. A roomy table collapses to compact rows on narrow/short terminals. */
export function renderWidget(jobs: Job[], theme: Theme, width: number, selected = 0, capacity = 4, height = Infinity) {
  if (!jobs.length || width <= 0 || height <= 0) return [];
  const table = width >= 64 && height >= 4;
  const heading = height >= 2;
  const footer = height >= 3;
  capacity = Math.max(1, Math.min(capacity, height - Number(heading) - Number(footer) - Number(table)));
  selected = Math.max(0, Math.min(selected, jobs.length - 1));
  const start = Math.max(0, selected - capacity + 1);
  const nameWidth = Math.min(34, Math.max(14, ...jobs.map(job => visibleWidth(oneLine(job.id)) + 2)), Math.floor(width * 0.35));
  const timeWidth = Math.max(4, ...jobs.map(job => visibleWidth(elapsed(job))));
  const statusWidth = 10;
  const activityWidth = width - nameWidth - statusWidth - timeWidth - 9;
  const separator = theme.fg('dim', ' │ ');
  const lines: string[] = [];
  if (heading) {
    const frame = FRAMES[Math.floor(Date.now() / 100) % FRAMES.length];
    const running = jobs.filter((job) => job.status === 'running').length;
    const stopping = jobs.length - running;
    lines.push(theme.fg('accent', `${frame} ${theme.bold('Subagents')}`)
      + theme.fg('dim', ' · ') + theme.fg('success', `${running} running`)
      + (stopping ? theme.fg('dim', ' · ') + theme.fg('warning', `${stopping} stopping`) : ''));
  }
  if (table) {
    lines.push(theme.fg('dim', [cell('  AGENT', nameWidth), cell('STATUS', statusWidth),
      cell('DOING NOW', activityWidth), cell('TIME', timeWidth, true)].join(' │ ')));
  }
  for (const [offset, job] of jobs.slice(start, start + capacity).entries()) {
    const chosen = start + offset === selected;
    const status = STATUS[job.status];
    const activity = job.status === 'stopping' ? 'Stopping — waiting for cancellation' : oneLine(job.activity);
    const title = `${chosen ? '›' : ' '} ${oneLine(job.id)}`;
    const name = (size: number) => theme.fg(chosen ? 'accent' : 'text', chosen ? theme.bold(cell(title, size)) : cell(title, size));
    if (table) {
      lines.push([name(nameWidth), theme.fg(status.color, cell(`${status.icon} ${job.status}`, statusWidth)),
        theme.fg(activityColor(activity), cell(activity, activityWidth)), theme.fg('dim', cell(elapsed(job), timeWidth, true))].join(separator));
    } else {
      const compactNameWidth = Math.max(8, Math.min(26, Math.floor(width * 0.32)));
      const time = width >= 36 ? `  ${elapsed(job)}` : '';
      const room = Math.max(0, width - compactNameWidth - 4 - visibleWidth(time));
      lines.push(name(compactNameWidth) + '  ' + theme.fg(status.color, status.icon) + ' '
        + theme.fg(activityColor(activity), cell(activity, room)) + theme.fg('dim', time));
    }
  }
  if (footer) lines.push(theme.fg('dim', `  ↑↓ select · Ctrl+X stop${jobs.length > capacity ? ` · ${selected + 1}/${jobs.length}` : ''}`));
  return lines.map((line) => truncateToWidth(line, width));
}
