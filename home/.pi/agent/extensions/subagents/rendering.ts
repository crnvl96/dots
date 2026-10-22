import type { Theme } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { active, type Job } from './contracts.ts';
import { elapsed, jobStats, oneLine } from './formatting.ts';

export const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

export function statusColor(job: Job): Parameters<Theme['fg']>[0] {
  return job.status === 'running' ? 'accent' : job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'warning';
}

export function badge(job: Job, theme: Theme) {
  const icon = active(job) ? FRAMES[Math.floor(Date.now() / 100) % FRAMES.length]
    : job.status === 'completed' ? '✓' : job.status === 'failed' ? '✗' : '■';
  return theme.fg(statusColor(job), icon);
}

export function columns(left: string, right: string, width: number) {
  width = Math.max(0, width);
  const room = width - visibleWidth(right) - 2;
  if (room < 12) return truncateToWidth(left, width);
  const clipped = truncateToWidth(left, room);
  return clipped + ' '.repeat(width - visibleWidth(clipped) - visibleWidth(right)) + right;
}

export function jobLine(job: Job, theme: Theme, width: number, selected = false) {
  const title = theme.fg(selected ? 'accent' : 'text', selected ? theme.bold(job.id) : job.id);
  return columns(`${badge(job, theme)} ${title}`, theme.fg(statusColor(job), job.status) + theme.fg('dim', ` · ${elapsed(job)}`), width);
}

export function jobDetail(job: Job, theme: Theme, width: number) {
  const activity = `${width < 60 ? `${job.status} · ` : ''}${oneLine(job.activity)}`;
  const queued = job.pendingSteers ? theme.fg('warning', ` · ${job.pendingSteers} steering queued`) : '';
  const asks = job.asks ? theme.fg('warning', ` · ${job.asks} ask${job.asks === 1 ? '' : 's'}`) : '';
  return columns(theme.fg('muted', activity) + queued + asks,
    theme.fg('dim', `${oneLine(job.model)} · ${jobStats(job)}`), width);
}

export function panelLine(text: string, width: number, theme: Theme, background: Parameters<Theme['bg']>[0]) {
  return truncateToWidth(text, width, '…', true).split('\x1b[0m')
    .map((part) => theme.bg(background, part)).join('\x1b[0m');
}

export function renderWidget(jobs: Job[], theme: Theme, width: number) {
  if (!jobs.length) return [];
  const running = jobs.filter(active);
  const failed = jobs.filter((job) => job.status === 'failed').length;
  const stopped = jobs.some((job) => job.status === 'stopped');
  const summaryColor = running.length ? 'accent' : failed ? 'error' : stopped ? 'warning' : 'success';
  const summaryIcon = running.length ? FRAMES[Math.floor(Date.now() / 100) % FRAMES.length] : failed ? '✗' : stopped ? '■' : '✓';
  const heading = theme.fg(summaryColor, `${summaryIcon} `)
    + theme.fg('accent', theme.bold('Subagents')) + theme.fg('dim', ' · ')
    + theme.fg(running.length ? 'accent' : 'muted', `${running.length} running`)
    + theme.fg('muted', ` · ${jobs.length - running.length} finished`)
    + (failed ? theme.fg('error', ` · ${failed} failed`) : '');
  return [
    columns(heading, theme.fg('dim', 'Click to view'), width),
    ...running.slice(0, 4).map((job) => columns(
      theme.fg('dim', '  ⎿ ') + theme.fg('text', job.id),
      theme.fg('muted', `${oneLine(job.activity)} · ${elapsed(job)}`), width)),
    ...(running.length > 4 ? [theme.fg('dim', `  ⎿ +${running.length - 4} more`)] : []),
  ].map((line) => truncateToWidth(line, width));
}
