import { describe, expect, it } from 'vitest';
import {
  buildTimer,
  getClockRangeTimestamps,
  getTimerDeltaMs,
  getTimerDisplay,
  pauseTimersForPersistence,
  reconcileTimer,
  resetTimersForLoad,
  sanitizeTimer,
} from './timer';

const now = new Date('2024-01-15T12:00:00').getTime();

function timer(overrides = {}) {
  return {
    id: 'timer',
    name: 'Timer',
    totalMs: 10 * 60 * 1000,
    elapsedMs: 0,
    state: 'idle',
    endTime: null,
    ...overrides,
  };
}

describe('timer time helpers', () => {
  it('calculates deltas from absolute end timestamps', () => {
    const reference = timer({ state: 'running', endTime: now + 5 * 60 * 1000 });
    const later = timer({ id: 'later', state: 'running', endTime: now + 7 * 60 * 1000 });
    expect(getTimerDeltaMs(reference, later, now)).toBe(2 * 60 * 1000);
  });

  it('rolls clock ranges into the next day', () => {
    const range = getClockRangeTimestamps('23:30', '00:15', now);
    expect(range.crossesDay).toBe(true);
    expect(range.durationMs).toBe(45 * 60 * 1000);
  });

  it('handles a DST spring-forward range using local timestamps', () => {
    const base = new Date('2024-03-10T01:30:00-05:00').getTime();
    const range = getClockRangeTimestamps('01:30', '03:30', base);
    expect(range.durationMs).toBe(60 * 60 * 1000);
  });

  it('does not expose a delta for paused timers', () => {
    const reference = timer({ state: 'running', endTime: now + 5 * 60 * 1000 });
    const paused = timer({ id: 'paused', state: 'paused', elapsedMs: 2 * 60 * 1000 });
    expect(getTimerDeltaMs(reference, paused, now)).toBeNull();
  });

  it('starts scheduled timers at their absolute start and finishes missed ones', () => {
    const scheduled = timer({ state: 'scheduled', startTime: now + 1000 });
    expect(reconcileTimer(scheduled, now).state).toBe('scheduled');
    expect(reconcileTimer(scheduled, now + 2000).state).toBe('running');
    expect(reconcileTimer({ ...scheduled, startTime: now - 20 * 60 * 1000 }, now).state).toBe('finished');
  });

  it('loads old saved timers without resetting their fields', () => {
    const old = sanitizeTimer({ ...timer({ state: 'paused', elapsedMs: 1200 }), color: '#123456' });
    const loaded = resetTimersForLoad([old])[0];
    expect(loaded.state).toBe('paused');
    expect(loaded.elapsedMs).toBe(1200);
    expect(loaded.color).toBe('#123456');
  });

  it('creates future timers as scheduled', () => {
    const created = buildTimer({ name: 'Scheduled', totalMs: 60000, startTime: Date.now() + 60000 });
    expect(created.state).toBe('scheduled');
  });

  it('tracks additional minus/overtime when a timer finishes and time passes', () => {
    const finishedTimer = timer({
      state: 'finished',
      totalMs: 30 * 60 * 1000,
      elapsedMs: 30 * 60 * 1000,
      finishedAt: now,
    });
    // 2 minutes later without stopping alarm
    const reconciled = reconcileTimer(finishedTimer, now + 2 * 60 * 1000);
    expect(reconciled.overtimeMs).toBe(2 * 60 * 1000);

    const display = getTimerDisplay(reconciled);
    expect(display.overtimeMs).toBe(2 * 60 * 1000);
    expect(display.remainingMs).toBe(0);
  });

  it('freezes overtime once the alarm is stopped', () => {
    const finishedTimer = timer({
      state: 'finished',
      totalMs: 30 * 60 * 1000,
      elapsedMs: 30 * 60 * 1000,
      finishedAt: now,
      alarmStoppedAt: now + 135 * 1000, // stopped after 2m 15s
    });
    // 10 minutes later, overtime should remain frozen at 135 seconds
    const reconciled = reconcileTimer(finishedTimer, now + 10 * 60 * 1000);
    expect(reconciled.overtimeMs).toBe(135 * 1000);
  });

  it('preserves overtime and alarmStoppedAt in sanitizeTimer and pauseTimersForPersistence', () => {
    const finishedTimer = {
      ...timer({
        state: 'finished',
        totalMs: 15 * 60 * 1000,
        elapsedMs: 15 * 60 * 1000,
        finishedAt: now,
        alarmStoppedAt: now + 60 * 1000,
        overtimeMs: 60 * 1000,
      }),
    };
    const sanitized = sanitizeTimer(finishedTimer);
    expect(sanitized.alarmStoppedAt).toBe(now + 60 * 1000);
    expect(sanitized.overtimeMs).toBe(60 * 1000);

    const paused = pauseTimersForPersistence([sanitized], now + 120 * 1000);
    expect(paused[0].overtimeMs).toBe(60 * 1000);
  });
});
