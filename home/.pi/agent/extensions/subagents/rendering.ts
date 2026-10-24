import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
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
  if (
    /^(Stopping|Needs a decision|Found a gap|Retrying|Compacting|Context compaction|Editing|Writing (?!response))/.test(
      activity,
    )
  )
    return 'warning';
  if (/^(Thinking|Writing response|Preparing)/.test(activity)) return 'accent';
  if (/^(Reading|Searching|Finding|Listing|Running|Using)/.test(activity)) return 'success';
  return 'muted';
}

/** Read-only rows. Spare space automatically reveals activity that the column clips. */
export function renderWidget(jobs: Job[], theme: Theme, width: number, height = 8) {
  if (!jobs.length || width <= 0 || height <= 0) return [];
  const heading = height >= 2;
  const overflow = jobs.length > height - Number(heading) && height >= 3;
  const visible = jobs.slice(0, Math.max(1, height - Number(heading) - Number(overflow)));
  let detailBudget = height - Number(heading) - visible.length - Number(overflow);
  const wide = width >= 64;
  const nameWidth = wide
    ? Math.min(
        34,
        Math.max(14, ...jobs.map((job) => visibleWidth(oneLine(job.id)) + 2)),
        Math.floor(width * 0.35),
      )
    : Math.max(8, Math.min(26, Math.floor(width * 0.32)));
  const timeWidth = Math.max(4, ...jobs.map((job) => visibleWidth(elapsed(job))));
  const activityWidth = wide
    ? width - nameWidth - 10 - timeWidth - 6
    : Math.max(0, width - nameWidth - 4 - (width >= 36 ? timeWidth + 2 : 0));
  const lines: string[] = [];
  if (heading) {
    const frame = FRAMES[Math.floor(Date.now() / 100) % FRAMES.length];
    const running = jobs.filter((job) => job.status === 'running').length;
    const stopping = jobs.length - running;
    lines.push(
      theme.fg('accent', `${frame} ${theme.bold('Subagents')}`) +
        theme.fg('dim', ' · ') +
        theme.fg('success', `${running} running`) +
        (stopping ? theme.fg('dim', ' · ') + theme.fg('warning', `${stopping} stopping`) : ''),
    );
  }
  for (const job of visible) {
    const status = STATUS[job.status];
    const activity =
      job.status === 'stopping' ? 'Stopping — waiting for cancellation' : oneLine(job.activity);
    const color = activityColor(activity);
    const name = theme.fg('text', cell(`  ${oneLine(job.id)}`, nameWidth));
    if (wide) {
      lines.push(
        [
          name,
          theme.fg(status.color, cell(`${status.icon} ${job.status}`, 10)),
          theme.fg(color, cell(activity, activityWidth)),
          theme.fg('dim', cell(elapsed(job), timeWidth, true)),
        ].join('  '),
      );
    } else {
      lines.push(
        name +
          '  ' +
          theme.fg(status.color, status.icon) +
          ' ' +
          theme.fg(color, cell(activity, activityWidth)) +
          (width >= 36 ? theme.fg('dim', `  ${cell(elapsed(job), timeWidth, true)}`) : ''),
      );
    }
    if (detailBudget > 0 && width > 8 && visibleWidth(activity) > activityWidth) {
      const details = wrapTextWithAnsi(activity, width - 4);
      const count = Math.min(detailBudget, details.length);
      for (let i = 0; i < count; i++) {
        const detail =
          i === count - 1 && count < details.length
            ? truncateToWidth(details.slice(i).join(' '), width - 4)
            : details[i];
        lines.push(theme.fg('dim', i ? '    ' : '  ↳ ') + theme.fg(color, detail));
      }
      detailBudget -= count;
    }
  }
  if (overflow)
    lines.push(
      theme.fg('dim', `  +${jobs.length - visible.length} more active · ask parent for details`),
    );
  return lines.map((line) => truncateToWidth(line, width));
}
