export const STORAGE_PREFIX = 'timers.v1';
export const MAX_TIMERS = 50;
export const MAX_DURATION_SECONDS = 99 * 60 * 60 + 59 * 60 + 59;
export const MAX_DURATION_MS = MAX_DURATION_SECONDS * 1000;
export const DEFAULT_SOUND = 'Beep';
export const SOUND_OPTIONS = ['Beep', 'Chime', 'Bell', 'Digital', 'Soft Pulse'];
export const LIGHT_DEFAULT_COLOR = '#2e7d32';
export const DARK_DEFAULT_COLOR = '#81c784';
export const DEMO_PRESETS = [
  { name: 'Focus 25', seconds: 25 * 60 },
  { name: 'Break 5', seconds: 5 * 60 },
  { name: 'Deep Work 50', seconds: 50 * 60 },
  { name: 'Walk 10', seconds: 10 * 60 },
];

export function getDefaultTrackerColor() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? DARK_DEFAULT_COLOR
    : LIGHT_DEFAULT_COLOR;
}

export const TRACKER_COLORS = [
  getDefaultTrackerColor(),
  '#6750a4',
  '#ff9800',
  '#4caf50',
  '#2196f3',
  '#e91e63',
  '#00acc1',
];
