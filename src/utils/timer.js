import {
  DEFAULT_SOUND,
  MAX_DURATION_MS,
  MAX_DURATION_SECONDS,
  getDefaultTrackerColor,
} from '../constants';

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatDuration(totalSeconds) {
  const bounded = clamp(Math.max(0, Math.round(totalSeconds)), 0, MAX_DURATION_SECONDS);
  const hours = Math.floor(bounded / 3600);
  const minutes = Math.floor((bounded % 3600) / 60);
  const seconds = bounded % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function parseDurationInput(raw) {
  const value = String(raw).trim();
  if (!value) return 0;
  const parts = value.split(':').map((part) => part.replace(/[^0-9]/g, ''));
  if (parts.length === 1) {
    const digits = parts[0];
    if (!digits) return 0;
    const clockDigits = digits.padStart(6, '0').slice(-6);
    const hours = Number(clockDigits.slice(0, 2)) || 0;
    const minutes = Number(clockDigits.slice(2, 4)) || 0;
    const seconds = Number(clockDigits.slice(4, 6)) || 0;
    return clamp(hours * 3600 + minutes * 60 + seconds, 0, MAX_DURATION_SECONDS);
  }
  let total = 0;
  [...parts].reverse().forEach((part, index) => {
    total += (Number(part) || 0) * [1, 60, 3600][index];
  });
  return clamp(total, 0, MAX_DURATION_SECONDS);
}

export function getDurationUnit(seconds) {
  if (seconds % 3600 === 0) return 'hours';
  if (seconds % 60 === 0) return 'minutes';
  return 'seconds';
}

export function getDurationValue(seconds, unit) {
  const divisor = unit === 'hours' ? 3600 : unit === 'minutes' ? 60 : 1;
  return seconds / divisor;
}

export function getDurationMultiplier(unit) {
  return unit === 'hours' ? 3600 : unit === 'minutes' ? 60 : 1;
}

export function getDurationMilliseconds(value, unit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
  return Math.round(numericValue * getDurationMultiplier(unit) * 1000);
}

export function getVolumeDb(volume) {
  if (volume <= 0) return '-60 dB';
  return `${Math.round(20 * Math.log10(volume))} dB`;
}

export function getTimerDisplay(timer) {
  const remainingMs = Math.max(0, timer.totalMs - timer.elapsedMs);
  const progress = clamp((timer.elapsedMs / timer.totalMs) * 100, 0, 100);
  const radius = 72;
  const circumference = 2 * Math.PI * radius;

  return {
    remainingMs,
    progress,
    radius,
    circumference,
    offset: circumference * (1 - progress / 100),
  };
}

export function getTimerEndTime(timer, now = Date.now()) {
  if (timer.state === 'running' && typeof timer.endTime === 'number') return timer.endTime;
  if (timer.state === 'paused') return now + Math.max(0, timer.totalMs - timer.elapsedMs);
  if (timer.state === 'scheduled' && typeof timer.startTime === 'number') {
    return timer.startTime + timer.totalMs;
  }
  return null;
}

export function formatLocalTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
}

export function formatClockInput(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function getClockTimeTimestamp(value, base = Date.now()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const date = new Date(base);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

export function getClockRangeTimestamps(fromValue, toValue, base = Date.now()) {
  const from = getClockTimeTimestamp(fromValue, base);
  let to = getClockTimeTimestamp(toValue, base);
  if (!from || !to) return null;
  const crossesDay = to <= from;
  if (crossesDay) to += 24 * 60 * 60 * 1000;
  return { from, to, durationMs: to - from, crossesDay };
}

export function getTimerDeltaMs(referenceTimer, timer, now = Date.now()) {
  const referenceEnd = getTimerEndTime(referenceTimer, now);
  const end = getTimerEndTime(timer, now);
  if (!referenceEnd || !end || referenceTimer.state === 'paused' || timer.state === 'paused') return null;
  return end - referenceEnd;
}

export function getDefaultSettings() {
  const defaultColor = getDefaultTrackerColor();
  return {
    theme: 'system',
    siteNotifications: false,
    notifyOnFinish: true,
    soundVolume: 0.7,
    alarmDuration: 60,
    compactMode: false,
    reorderMode: false,
    trackerColor: defaultColor,
    lastColor: defaultColor,
    lastSound: DEFAULT_SOUND,
    wakeLock: true,
  };
}

export function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function isValidTimer(timer) {
  if (!timer || typeof timer !== 'object') return false;
  if (typeof timer.id !== 'string' || !timer.id) return false;
  if (typeof timer.name !== 'string') return false;
  if (!Number.isFinite(timer.totalMs) || timer.totalMs <= 0) return false;
  if (!Number.isFinite(timer.elapsedMs) || timer.elapsedMs < 0) return false;
  if (timer.elapsedMs > timer.totalMs) return false;
  return ['idle', 'running', 'paused', 'finished', 'scheduled'].includes(timer.state);
}

export function sanitizeTimer(timer) {
  const totalMs = clamp(Math.round(Number(timer.totalMs) || 0), 1000, MAX_DURATION_MS);
  const elapsedMs = clamp(Math.round(Number(timer.elapsedMs) || 0), 0, totalMs);
  return {
    id: String(timer.id || (crypto.randomUUID ? crypto.randomUUID() : `timer-${Date.now()}`)),
    name: String(timer.name || 'Timer'),
    totalMs,
    elapsedMs,
    color: String(timer.color || getDefaultTrackerColor()),
    sound: String(timer.sound || DEFAULT_SOUND),
    repeatAlarm: timer.repeatAlarm === true,
    soundVolume: Number.isFinite(timer.soundVolume) ? clamp(timer.soundVolume, 0, 2) : 0.7,
    useGlobalVolume: timer.useGlobalVolume === true,
    state: ['running', 'paused', 'finished', 'scheduled'].includes(timer.state) ? timer.state : 'idle',
    endTime: typeof timer.endTime === 'number' ? timer.endTime : null,
    updatedAt: typeof timer.updatedAt === 'number' ? timer.updatedAt : Date.now(),
    finishedAt: typeof timer.finishedAt === 'number' ? timer.finishedAt : null,
    startTime: typeof timer.startTime === 'number' ? timer.startTime : null,
    clockMode: timer.clockMode === true,
    clockFrom: typeof timer.clockFrom === 'number' ? timer.clockFrom : null,
    clockTo: typeof timer.clockTo === 'number' ? timer.clockTo : null,
  };
}

export function buildTimer({ name, totalMs, color, sound, repeatAlarm = false, soundVolume = 0.7, useGlobalVolume = true, startTime = null, clockMode = false, clockFrom = null, clockTo = null }) {
  return {
    id: crypto.randomUUID(),
    name: String(name || 'Timer'),
    totalMs: clamp(Math.round(totalMs || 0), 1000, MAX_DURATION_MS),
    elapsedMs: 0,
    color: color || getDefaultTrackerColor(),
    sound: sound || DEFAULT_SOUND,
    repeatAlarm: repeatAlarm === true,
    soundVolume: clamp(Number(soundVolume), 0, 2),
    useGlobalVolume: useGlobalVolume === true,
    state: startTime && startTime > Date.now() ? 'scheduled' : 'idle',
    endTime: null,
    startTime,
    clockMode,
    clockFrom,
    clockTo,
    updatedAt: Date.now(),
    finishedAt: null,
  };
}

export function pauseTimersForPersistence(timers, now = Date.now()) {
  return timers.map((timer) => {
    if (timer.state !== 'running' || !timer.endTime) return timer;
    const elapsedMs = clamp(timer.totalMs - Math.max(0, timer.endTime - now), 0, timer.totalMs);
    const finished = elapsedMs >= timer.totalMs;
    return {
      ...timer,
      elapsedMs,
      state: finished ? 'finished' : 'paused',
      endTime: null,
      finishedAt: finished ? (timer.finishedAt || now) : null,
      updatedAt: now,
    };
  });
}

export function resetTimersForLoad(timers) {
  return timers.map((timer) => ({ ...timer }));
}

export function reconcileTimer(timer, now = Date.now()) {
  if (timer.state === 'scheduled' && typeof timer.startTime === 'number') {
    if (timer.startTime > now) return timer;
    const endTime = timer.startTime + timer.totalMs;
    if (endTime <= now) {
      return {
        ...timer,
        elapsedMs: timer.totalMs,
        state: 'finished',
        endTime: null,
        startTime: null,
        finishedAt: timer.finishedAt || endTime,
        updatedAt: now,
      };
    }
    return { ...timer, state: 'running', endTime, startTime: null, updatedAt: now };
  }

  if (timer.state !== 'running' || typeof timer.endTime !== 'number') return timer;
  if (timer.endTime <= now) {
    return {
      ...timer,
      elapsedMs: timer.totalMs,
      state: 'finished',
      endTime: null,
      finishedAt: timer.finishedAt || timer.endTime,
      updatedAt: now,
    };
  }

  return {
    ...timer,
    elapsedMs: clamp(timer.totalMs - (timer.endTime - now), 0, timer.totalMs),
  };
}

export function reconcileTimers(timers, now = Date.now()) {
  return timers.map((timer) => reconcileTimer(timer, now));
}
