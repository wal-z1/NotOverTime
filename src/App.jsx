import { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_PREFIX = 'timers.v1';
const MAX_TIMERS = 50;
const DEFAULT_SOUND = 'Beep';
const LIGHT_DEFAULT_COLOR = '#2e7d32';
const DARK_DEFAULT_COLOR = '#81c784';
const DEMO_PRESETS = [
  { name: 'Focus 25', seconds: 25 * 60 },
  { name: 'Break 5', seconds: 5 * 60 },
  { name: 'Deep Work 50', seconds: 50 * 60 },
  { name: 'Walk 10', seconds: 10 * 60 },
];
function getDefaultTrackerColor() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? DARK_DEFAULT_COLOR
    : LIGHT_DEFAULT_COLOR;
}

const TRACKER_COLORS = [getDefaultTrackerColor(), '#6750a4', '#ff9800', '#4caf50', '#2196f3', '#e91e63', '#00acc1'];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDuration(totalSeconds) {
  const bounded = clamp(Math.max(0, Math.round(totalSeconds)), 0, 99 * 60 * 60 + 59 * 60 + 59);
  const hours = Math.floor(bounded / 3600);
  const minutes = Math.floor((bounded % 3600) / 60);
  const seconds = bounded % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function parseDurationInput(raw) {
  const value = String(raw).trim();
  if (!value) return 0;
  const parts = value.split(':').map((part) => part.replace(/[^0-9]/g, ''));
  if (parts.length === 1) {
    return clamp(Number(parts[0]) || 0, 0, 99 * 3600 + 59 * 60 + 59);
  }
  let total = 0;
  const reversed = [...parts].reverse();
  const multipliers = [1, 60, 3600];
  reversed.forEach((part, index) => {
    total += (Number(part) || 0) * multipliers[index];
  });
  return clamp(total, 0, 99 * 3600 + 59 * 60 + 59);
}

function getDefaultSettings() {
  const defaultColor = getDefaultTrackerColor();
  return {
    theme: 'system',
    siteNotifications: false,
    notifyOnFinish: true,
    soundVolume: 0.7,
    alarmDuration: 60,
    compactMode: false,
    trackerColor: defaultColor,
    lastColor: defaultColor,
    lastSound: DEFAULT_SOUND,
    wakeLock: true,
  };
}

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function isValidTimer(timer) {
  if (!timer || typeof timer !== 'object') return false;
  if (typeof timer.id !== 'string' || !timer.id) return false;
  if (typeof timer.name !== 'string') return false;
  if (!Number.isFinite(timer.totalMs) || timer.totalMs <= 0) return false;
  if (!Number.isFinite(timer.elapsedMs) || timer.elapsedMs < 0) return false;
  if (timer.elapsedMs > timer.totalMs) return false;
  if (!['idle', 'running', 'paused', 'finished'].includes(timer.state)) return false;
  return true;
}

function sanitizeTimer(timer) {
  const totalMs = clamp(Math.round(Number(timer.totalMs) || 0), 1000, 99 * 60 * 60 * 1000);
  const elapsedMs = clamp(Math.round(Number(timer.elapsedMs) || 0), 0, totalMs);
  return {
    id: String(timer.id || crypto.randomUUID ? crypto.randomUUID() : `timer-${Date.now()}`),
    name: String(timer.name || 'Timer'),
    totalMs,
    elapsedMs,
    color: String(timer.color || getDefaultTrackerColor()),
    sound: String(timer.sound || DEFAULT_SOUND),
    state: timer.state === 'running' || timer.state === 'paused' || timer.state === 'finished' ? timer.state : 'idle',
    endTime: typeof timer.endTime === 'number' ? timer.endTime : null,
    updatedAt: Date.now(),
    finishedAt: typeof timer.finishedAt === 'number' ? timer.finishedAt : null,
  };
}

function buildTimer({ name, totalMs, color, sound }) {
  return {
    id: crypto.randomUUID(),
    name: String(name || 'Timer'),
    totalMs: clamp(Math.round(totalMs || 0), 1000, 99 * 60 * 60 * 1000),
    elapsedMs: 0,
    color: color || getDefaultTrackerColor(),
    sound: sound || DEFAULT_SOUND,
    state: 'idle',
    endTime: null,
    updatedAt: Date.now(),
    finishedAt: null,
  };
}

function useLocalStorageState(key, defaultValue, validate) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return defaultValue;
      const parsed = safeParse(stored, defaultValue);
      return validate ? validate(parsed) : parsed;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable
    }
  }, [key, value]);

  return [value, setValue];
}

function App() {
  const [timers, setTimers] = useState([]);
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}.settings`);
      if (!stored) return getDefaultSettings();
      const parsed = safeParse(stored, {});
      return {
        ...getDefaultSettings(),
        ...parsed,
        trackerColor: parsed.trackerColor || getDefaultTrackerColor(),
        lastColor: parsed.lastColor || parsed.trackerColor || getDefaultTrackerColor(),
      };
    } catch {
      return getDefaultSettings();
    }
  });
  const [snackbar, setSnackbar] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingTimeId, setEditingTimeId] = useState(null);
  const [timeDraft, setTimeDraft] = useState('');
  const [highlightedTimerId, setHighlightedTimerId] = useState(null);
  const [draft, setDraft] = useState({ name: '', duration: 1500, color: getDefaultTrackerColor(), sound: DEFAULT_SOUND });
  const [storageWarning, setStorageWarning] = useState(false);
  const timeInputRef = useRef(null);
  const tickerRef = useRef(0);
  const audioContextRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const finishNoticeRef = useRef(new Set());
  const nextRequestRef = useRef(null);
  const timerCardRefs = useRef(new Map());

  const timersById = useMemo(() => Object.fromEntries(timers.map((timer) => [timer.id, timer])), [timers]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    const saved = readStorage('timers', []);
    const valid = Array.isArray(saved) ? saved.filter(isValidTimer).map(sanitizeTimer) : [];
    const safe = valid.slice(0, MAX_TIMERS);
    setTimers(safe);
  }, []);

  useEffect(() => {
    const syncChange = (event) => {
      if (event.key === `${STORAGE_PREFIX}.timers`) {
        const next = readStorage('timers', []);
        if (Array.isArray(next)) {
          setTimers(next.filter(isValidTimer).map(sanitizeTimer).slice(0, MAX_TIMERS));
        }
      }
    };

    window.addEventListener('storage', syncChange);
    return () => window.removeEventListener('storage', syncChange);
  }, []);

  useEffect(() => {
    let active = true;

    const tick = () => {
      if (!active) return;
      setTimers((current) => {
        let changed = false;
        const updated = current.map((timer) => {
          if (timer.state !== 'running' || !timer.endTime) return timer;
          const remaining = Math.max(0, timer.endTime - Date.now());
          if (remaining <= 0) {
            changed = true;
            const endedTimer = {
              ...timer,
              elapsedMs: timer.totalMs,
              state: 'finished',
              endTime: null,
              finishedAt: Date.now(),
            };
            queueFinishNotification(endedTimer);
            return endedTimer;
          }
          const elapsedMs = clamp(timer.totalMs - remaining, 0, timer.totalMs);
          if (elapsedMs !== timer.elapsedMs) {
            changed = true;
          }
          return { ...timer, elapsedMs };
        });
        if (!changed) return current;
        return updated;
      });
    };

    const schedule = () => {
      cancelAnimationFrame(tickerRef.current);
      const shouldAnimate = timers.some((timer) => timer.state === 'running');
      if (shouldAnimate) {
        tickerRef.current = requestAnimationFrame(function loop() {
          tick();
          tickerRef.current = requestAnimationFrame(loop);
        });
      }
    };

    schedule();
    const visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        cancelAnimationFrame(tickerRef.current);
      } else {
        schedule();
      }
    };

    document.addEventListener('visibilitychange', visibilityHandler);
    return () => {
      active = false;
      cancelAnimationFrame(tickerRef.current);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [timers]);

  useEffect(() => {
    const persistTimers = () => {
      try {
        localStorage.setItem(`${STORAGE_PREFIX}.timers`, JSON.stringify(timers));
      } catch {
        setStorageWarning(true);
      }
    };

    const debounced = setTimeout(persistTimers, 150);
    const onPageHide = () => persistTimers();
    document.addEventListener('visibilitychange', onPageHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearTimeout(debounced);
      document.removeEventListener('visibilitychange', onPageHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [timers]);

  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}.settings`, JSON.stringify(settings));
    } catch {
      setStorageWarning(true);
    }
  }, [settings]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }, []);

  useEffect(() => {
    if (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.dataset.theme = 'dark';
    }
  }, [settings.theme]);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let wakeLockSentinel = null;
    const requestWakeLock = async () => {
      if (!settings.wakeLock || !timers.some((timer) => timer.state === 'running')) return;
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
      } catch {
        // ignore wake lock failures
      }
    };
    requestWakeLock();
    return () => {
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, [settings.wakeLock, timers]);

  useEffect(() => {
    if (!storageWarning) return;
    const timer = setTimeout(() => setStorageWarning(false), 3500);
    return () => clearTimeout(timer);
  }, [storageWarning]);

  function readStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}.${key}`);
      if (raw === null) return fallback;
      const parsed = safeParse(raw, fallback);
      return parsed;
    } catch {
      setStorageWarning(true);
      return fallback;
    }
  }

  function persistStorage(key, value) {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}.${key}`, JSON.stringify(value));
    } catch {
      setStorageWarning(true);
    }
  }

  function showSnackbar(message) {
    setSnackbar(message);
    window.clearTimeout(showSnackbar.timer);
    showSnackbar.timer = window.setTimeout(() => setSnackbar(''), 3200);
  }

  async function toggleSiteNotifications() {
    if (!('Notification' in window)) {
      showSnackbar('Notifications are not supported in this browser.');
      return;
    }

    if (Notification.permission === 'denied') {
      showSnackbar('Notifications are blocked. Re-enable them in browser settings.');
      return;
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setSettings((current) => ({ ...current, siteNotifications: false }));
        showSnackbar(permission === 'denied'
          ? 'Notifications are blocked. Re-enable them in browser settings.'
          : 'Notification permission was not granted.');
        return;
      }
    }

    setSettings((current) => ({ ...current, siteNotifications: !current.siteNotifications }));
  }

  function queueFinishNotification(timer) {
    if (!timer || timer.state !== 'finished') return;
    finishNoticeRef.current.add(timer.id);
    showSnackbar(`${timer.name} is done.`);
    const shouldNotify = settings.siteNotifications && 'Notification' in window && Notification.permission === 'granted';
    if (shouldNotify) {
      new Notification('Timer complete', { body: `${timer.name} finished.`, tag: timer.id });
    }
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 80, 200, 80, 200]);
    }
    playAlarm(timer.sound || settings.lastSound || DEFAULT_SOUND, settings.soundVolume || 0.7);
  }

  function playAlarm(name, volume) {
    if (!name || !('AudioContext' in window || 'webkitAudioContext' in window)) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const context = audioContextRef.current || new AudioCtx();
    audioContextRef.current = context;

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = {
      Beep: 660,
      Chime: 520,
      Bell: 780,
      Digital: 440,
      'Soft Pulse': 320,
    }[name] || 600;

    gainNode.gain.setValueAtTime(0.0001, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(volume * 0.24, context.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.6);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.65);
  }

  function openCreateDialog(initialTimer = null) {
    const timer = initialTimer || null;
    setEditingId(timer ? timer.id : null);
    setDraft({
      name: timer ? timer.name : '',
      duration: timer ? timer.totalMs / 1000 : 1500,
      color: timer ? timer.color : settings.lastColor || settings.trackerColor || getDefaultTrackerColor(),
      sound: timer ? timer.sound : settings.lastSound || DEFAULT_SOUND,
    });
    setDialogOpen(true);
  }

  function addTimer(timerData) {
    if (timers.length >= MAX_TIMERS) {
      showSnackbar('Maximum of 50 timers reached.');
      return;
    }

    const resolvedColor = timerData.color || settings.trackerColor || getDefaultTrackerColor();
    const newTimer = buildTimer({ ...timerData, color: resolvedColor });
    setTimers((current) => [...current, newTimer]);
    persistStorage('timers', [...timers, newTimer]);
    setSettings((current) => ({ ...current, trackerColor: resolvedColor, lastColor: resolvedColor, lastSound: timerData.sound || current.lastSound || DEFAULT_SOUND }));
  }

  function updateTimer(timerId, updates) {
    setTimers((current) => current.map((timer) => (timer.id === timerId ? { ...timer, ...updates } : timer)));
  }

  function beginTimeEdit(timer) {
    setEditingTimeId(timer.id);
    setTimeDraft(formatDuration(Math.max(0, (timer.totalMs - timer.elapsedMs) / 1000)));
    window.setTimeout(() => {
      timeInputRef.current?.focus();
      timeInputRef.current?.select();
    }, 0);
  }

  function cancelTimeEdit() {
    setEditingTimeId(null);
    setTimeDraft('');
  }

  function saveTimeEdit(timer) {
    const remainingSeconds = parseDurationInput(timeDraft);
    if (remainingSeconds <= 0) {
      showSnackbar('Enter a duration greater than zero.');
      return;
    }

    const remainingMs = remainingSeconds * 1000;
    const totalMs = clamp(timer.elapsedMs + remainingMs, 1000, 99 * 60 * 60 * 1000);
    const normalizedRemainingMs = totalMs - timer.elapsedMs;
    updateTimer(timer.id, {
      totalMs,
      endTime: timer.state === 'running' ? Date.now() + normalizedRemainingMs : null,
      state: timer.state === 'finished' ? 'paused' : timer.state,
      finishedAt: null,
      updatedAt: Date.now(),
    });
    cancelTimeEdit();
  }

  function startTimer(timerId) {
    setTimers((current) => current.map((timer) => {
      if (timer.id !== timerId) return timer;
      const remainingMs = timer.totalMs - timer.elapsedMs;
      const next = { ...timer, state: 'running', endTime: Date.now() + remainingMs, updatedAt: Date.now() };
      return next;
    }));
  }

  function pauseTimer(timerId) {
    setTimers((current) => current.map((timer) => {
      if (timer.id !== timerId || timer.state !== 'running') return timer;
      const elapsedMs = Math.min(timer.elapsedMs + (timer.endTime ? Math.max(0, timer.endTime - Date.now()) : 0), timer.totalMs);
      const remainingMs = timer.totalMs - elapsedMs;
      return { ...timer, elapsedMs, state: 'paused', endTime: null, totalMs: timer.totalMs, updatedAt: Date.now() };
    }));
  }

  function resetTimer(timerId) {
    setTimers((current) => current.map((timer) => (timer.id === timerId ? { ...timer, elapsedMs: 0, state: 'idle', endTime: null, finishedAt: null } : timer)));
  }

  function removeTimer(timerId) {
    setTimers((current) => current.filter((timer) => timer.id !== timerId));
  }

  function duplicateTimer(timerId) {
    const timer = timers.find((item) => item.id === timerId);
    if (!timer) return;
    if (timers.length >= MAX_TIMERS) {
      showSnackbar('Maximum of 50 timers reached.');
      return;
    }

    const duplicateId = crypto.randomUUID();
    const duplicate = buildTimer({
      name: `${timer.name} copy`,
      totalMs: timer.totalMs,
      color: timer.color,
      sound: timer.sound,
    });
    duplicate.id = duplicateId;
    setTimers((current) => [...current, duplicate]);
    persistStorage('timers', [...timers, duplicate]);
    setHighlightedTimerId(duplicateId);
    window.setTimeout(() => {
      const card = timerCardRefs.current.get(duplicateId);
      if (!card) return;
      const bounds = card.getBoundingClientRect();
      const isOutsideViewport = bounds.top < 0 || bounds.bottom > window.innerHeight;
      if (isOutsideViewport) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 0);
    window.setTimeout(() => setHighlightedTimerId(null), 1200);
  }

  function clearAll() {
    setTimers([]);
    persistStorage('timers', []);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const totalSeconds = clamp(Math.round(Number(draft.duration) || 0), 1, 99 * 3600 + 59 * 60 + 59);
    if (!editingId) {
      addTimer({
        name: draft.name.trim() || `Timer ${timers.length + 1}`,
        totalMs: totalSeconds * 1000,
        color: draft.color,
        sound: draft.sound,
      });
      setDialogOpen(false);
      return;
    }

    setTimers((current) => current.map((timer) => {
      if (timer.id !== editingId) return timer;
      const safeName = draft.name.trim() || timer.name || `Timer ${current.indexOf(timer) + 1}`;
      return {
        ...timer,
        name: safeName,
        totalMs: totalSeconds * 1000,
        color: draft.color,
        sound: draft.sound,
        elapsedMs: clamp(timer.elapsedMs, 0, totalSeconds * 1000),
        state: timer.state === 'finished' ? 'finished' : timer.state,
      };
    }));
    setDialogOpen(false);
  }

  return (
    <>
      <header className="app-header">
        <div className="brand-wrap">
          <h1>NotOverTime</h1>
        </div>
        <div className="header-actions">
          <label className="switch-row">
            <span>Site notifications</span>
            <button
              className="switch"
              type="button"
              aria-label="Toggle site notifications"
              aria-pressed={settings.siteNotifications}
              onClick={toggleSiteNotifications}
            >
              <span className="switch-thumb" />
            </button>
          </label>
          <label className="switch-row">
            <span>Compact mode</span>
            <button
              className="switch"
              type="button"
              aria-label="Toggle compact mode"
              aria-pressed={settings.compactMode}
              onClick={() => setSettings((current) => ({ ...current, compactMode: !current.compactMode }))}
            >
              <span className="switch-thumb" />
            </button>
          </label>
          <button className="icon-button" type="button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Toggle dark mode"
            onClick={() => setSettings((current) => ({ ...current, theme: current.theme === 'dark' ? 'light' : 'dark' }))}
          >
            {settings.theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      <main className="main-shell">
        {timers.length === 0 ? (
          <section className="empty-state">
            <h2>No timers yet</h2>
            <p>Start with a focused burst or pick a quick preset.</p>
            <div className="preset-row">
              {DEMO_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="preset-button"
                  onClick={() => addTimer({ name: preset.name, totalMs: preset.seconds * 1000, color: settings.trackerColor || getDefaultTrackerColor(), sound: DEFAULT_SOUND })}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <button className="empty-add-button primary" type="button" onClick={() => openCreateDialog()}>+ Add timer</button>
          </section>
        ) : (
          <section className={`timer-grid ${settings.compactMode ? 'compact-mode' : ''}`}>
            {timers.map((timer) => {
              const remainingMs = Math.max(0, timer.totalMs - timer.elapsedMs);
              const progress = clamp((timer.elapsedMs / timer.totalMs) * 100, 0, 100);
              const radius = 72;
              const circumference = 2 * Math.PI * radius;
              const offset = circumference * (1 - progress / 100);

              return (
                <article
                  key={timer.id}
                  ref={(element) => {
                    if (element) timerCardRefs.current.set(timer.id, element);
                    else timerCardRefs.current.delete(timer.id);
                  }}
                  className={`timer-card ${timer.state} ${highlightedTimerId === timer.id ? 'timer-card-highlight' : ''}`}
                >
                  <div className="card-top">
                    <h3>{timer.name}</h3>
                    {!settings.compactMode ? (
                      <button type="button" className="mini-button secondary" onClick={() => openCreateDialog(timer)}>Edit</button>
                    ) : null}
                  </div>

                  <div className={`timer-visual ${settings.compactMode ? 'compact-hidden' : ''}`} style={{ '--ring-color': timer.color }}>
                    <svg viewBox="0 0 200 200" className="timer-ring" aria-label={`${timer.name} remaining ${formatDuration(remainingMs / 1000)}`}>
                      <circle cx="100" cy="100" r={radius} className="track" />
                      <circle
                        cx="100"
                        cy="100"
                        r={radius}
                        className="progress"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                      />
                      <line x1="100" y1="100" x2="100" y2="34" className="hand" style={{ transform: `rotate(${(timer.elapsedMs / timer.totalMs) * 360}deg)` }} />
                    </svg>
                  </div>
                  <div className={`time-editor ${settings.compactMode ? 'compact' : ''}`}>
                    {editingTimeId === timer.id ? (
                      <input
                        ref={timeInputRef}
                        className="time-input"
                        type="text"
                        inputMode="numeric"
                        aria-label={`Edit ${timer.name} remaining time`}
                        value={timeDraft}
                        onChange={(event) => setTimeDraft(event.target.value)}
                        onBlur={() => saveTimeEdit(timer)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveTimeEdit(timer);
                          if (event.key === 'Escape') cancelTimeEdit();
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="remaining-time"
                        aria-label={`Edit ${timer.name} remaining time`}
                        onClick={() => beginTimeEdit(timer)}
                      >
                        {formatDuration(remainingMs / 1000)}
                      </button>
                    )}
                    {!settings.compactMode ? (
                      <div className="elapsed-total">{formatDuration(timer.elapsedMs / 1000)} / {formatDuration(timer.totalMs / 1000)}</div>
                    ) : null}
                  </div>
                  <div className={`linear-progress ${settings.compactMode ? 'compact-hidden' : ''}`} aria-label={`${Math.round(progress)}% complete`}>
                    <span className="linear-progress-fill" style={{ width: `${progress}%`, backgroundColor: timer.color }} />
                  </div>

                  <div className={`actions-row ${settings.compactMode ? 'compact-hidden' : ''}`}>
                    {timer.state === 'running' ? (
                      <button type="button" className="primary" onClick={() => pauseTimer(timer.id)}>Pause</button>
                    ) : (
                      <button type="button" className="primary" onClick={() => startTimer(timer.id)}>{timer.state === 'finished' ? 'Restart' : 'Start'}</button>
                    )}
                    <button type="button" className="secondary" onClick={() => resetTimer(timer.id)}>Reset</button>
                    <button type="button" className="secondary" onClick={() => duplicateTimer(timer.id)}>Duplicate</button>
                    <button type="button" className="danger" onClick={() => removeTimer(timer.id)}>Delete</button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>

      {timers.length > 0 ? (
        <button className="fab" type="button" aria-label="Create timer" onClick={() => openCreateDialog()}>+</button>
      ) : null}

      {dialogOpen ? (
        <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="timer-dialog-title">
          <div className="dialog-panel">
            <form onSubmit={handleSubmit}>
              <div className="dialog-header">
                <h2 id="timer-dialog-title">{editingId ? 'Edit timer' : 'Add timer'}</h2>
                <button type="button" className="close-button" onClick={() => setDialogOpen(false)}>×</button>
              </div>

              <label className="field">
                <span>Name</span>
                <input type="text" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>

              <label className="field">
                <span>Duration</span>
                <input type="text" inputMode="numeric" value={draft.duration} onChange={(event) => setDraft((current) => ({ ...current, duration: event.target.value }))} />
              </label>

              <div className="field">
                <span>Progress color</span>
                <div className="swatch-row">
                  {TRACKER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Use ${color} progress color`}
                      className={`swatch ${draft.color === color ? 'selected' : ''}`}
                      style={{ background: color }}
                      onClick={() => setDraft((current) => ({ ...current, color }))}
                    />
                  ))}
                  <label className="custom-color-picker" title="Custom color">
                    <input
                      type="color"
                      aria-label="Choose a custom progress color"
                      value={draft.color || settings.trackerColor || getDefaultTrackerColor()}
                      onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
                    />
                  </label>
                </div>
              </div>

              <label className="field">
                <span>Alarm sound</span>
                <select value={draft.sound} onChange={(event) => setDraft((current) => ({ ...current, sound: event.target.value }))}>
                  {['Beep', 'Chime', 'Bell', 'Digital', 'Soft Pulse'].map((sound) => (
                    <option key={sound} value={sound}>{sound}</option>
                  ))}
                </select>
              </label>

              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={() => setDialogOpen(false)}>Cancel</button>
                <button type="submit" className="primary">{editingId ? 'Save' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
          <div className="dialog-panel settings-panel">
            <div className="dialog-header">
              <h2 id="settings-dialog-title">Settings</h2>
              <button type="button" className="close-button" onClick={() => setSettingsOpen(false)}>×</button>
            </div>

            <div className="field">
              <span>Tracker progress color</span>
              <div className="swatch-row compact">
                {TRACKER_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Use ${color} progress color`}
                    className={`swatch ${settings.trackerColor === color ? 'selected' : ''}`}
                    style={{ background: color }}
                    onClick={() => { setSettings((current) => ({ ...current, trackerColor: color, lastColor: color })); setSettingsOpen(false); }}
                  />
                ))}
                <label className="custom-color-picker" title="Custom color">
                  <input
                    type="color"
                    aria-label="Choose a custom progress color"
                    value={settings.trackerColor || getDefaultTrackerColor()}
                    onChange={(event) => {
                      const color = event.target.value;
                      setSettings((current) => ({ ...current, trackerColor: color, lastColor: color }));
                    }}
                  />
                </label>
              </div>
            </div>

            <label className="setting-toggle">
              <span>
                <strong>Compact mode</strong>
                <small>Show only the changing time inside each ring.</small>
              </span>
              <button
                type="button"
                className="switch"
                aria-pressed={settings.compactMode}
                onClick={() => setSettings((current) => ({ ...current, compactMode: !current.compactMode }))}
              >
                <span className="switch-thumb" />
              </button>
            </label>

            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => setSettingsOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {storageWarning ? <div className="snackbar">Storage is unavailable, your timers won't be saved.</div> : null}
      {snackbar ? <div className="snackbar quiet">{snackbar}</div> : null}
    </>
  );
}

export default App;
