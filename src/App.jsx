import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SOUND,
  DEMO_PRESETS,
  GITHUB_REPO_URL,
  MAX_DURATION_MS,
  MAX_TIMERS,
  SOUND_OPTIONS,
  STORAGE_PREFIX,
  TRACKER_COLORS,
  getDefaultTrackerColor,
} from './constants';
import {
  buildTimer,
  clamp,
  formatDuration,
  formatClockInput,
  formatLocalTime,
  getClockRangeTimestamps,
  getClockTimeTimestamp,
  getTimerDeltaMs,
  getTimerEndTime,
  getDurationMilliseconds,
  getDurationMultiplier,
  getDurationUnit,
  getDurationValue,
  isValidTimer,
  parseDurationInput,
  pauseTimersForPersistence,
  reconcileTimer,
  reconcileTimers,
  resetTimersForLoad,
  safeParse,
  sanitizeTimer,
  getDefaultSettings,
} from './utils/timer';
import AppHeader from './components/AppHeader';
import EmptyState from './components/EmptyState';
import TimerCard from './components/TimerCard';

function App() {
  const [timers, setTimers] = useState([]);
  const [timersHydrated, setTimersHydrated] = useState(false);
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
  const [selectedTimerId, setSelectedTimerId] = useState(null);
  const [highlightedTimerId, setHighlightedTimerId] = useState(null);
  const [stoppedAlarmIds, setStoppedAlarmIds] = useState(() => new Set());
  const [referenceTimerId, setReferenceTimerId] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [compareNow, setCompareNow] = useState(Date.now());
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [draggingTimerId, setDraggingTimerId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const [draft, setDraft] = useState({
    name: '',
    duration: 25,
    durationUnit: 'minutes',
    color: getDefaultTrackerColor(),
    sound: DEFAULT_SOUND,
    repeatAlarm: false,
    soundVolume: 0.7,
    useGlobalVolume: true,
    clockMode: false,
    clockFrom: null,
    clockTo: null,
  });
  const [storageWarning, setStorageWarning] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const timeInputRef = useRef(null);
  const tickerRef = useRef(0);
  const audioContextRef = useRef(null);
  const alarmIntervalRef = useRef(new Map());
  const activeAlarmRef = useRef(new Map());
  const finishNoticeRef = useRef(new Set());
  const nextRequestRef = useRef(null);
  const volumePreviewTimeoutRef = useRef(null);
  const timerCardRefs = useRef(new Map());
  const timerStatesRef = useRef(new Map());
  const dialogRef = useRef(null);
  const settingsDialogRef = useRef(null);
  const compareDialogRef = useRef(null);

  const timersById = useMemo(() => Object.fromEntries(timers.map((timer) => [timer.id, timer])), [timers]);

  useEffect(() => {
    if (selectedTimerId && timersById[selectedTimerId]) return;
    setSelectedTimerId(timers[0]?.id || null);
  }, [selectedTimerId, timers, timersById]);

  useEffect(() => {
    timers.forEach((timer) => {
      const previousState = timerStatesRef.current.get(timer.id);
      if (timer.state === 'finished' && ['running', 'scheduled'].includes(previousState)) {
        queueFinishNotification(timer);
      }
      timerStatesRef.current.set(timer.id, timer.state);
    });
    const ids = new Set(timers.map((timer) => timer.id));
    timerStatesRef.current.forEach((_, id) => {
      if (!ids.has(id)) timerStatesRef.current.delete(id);
    });
  }, [timers]);

  useEffect(() => {
    const keyboardHandler = (event) => {
      if (event.key === 'Escape') {
        if (editingTimeId) {
          cancelTimeEdit();
        } else if (dialogOpen || settingsOpen || compareOpen) {
          setDialogOpen(false);
          setSettingsOpen(false);
          setCompareOpen(false);
        }
        return;
      }

      if (event.code !== 'Space' || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, input, select, textarea, a')) return;
      const timer = timersById[selectedTimerId];
      if (!timer) return;
      event.preventDefault();
      if (timer.state === 'running') pauseTimer(timer.id);
      else startTimer(timer.id);
    };

    window.addEventListener('keydown', keyboardHandler);
    return () => window.removeEventListener('keydown', keyboardHandler);
  }, [compareOpen, dialogOpen, editingTimeId, selectedTimerId, settingsOpen, timersById]);

  useEffect(() => {
    const panel = dialogOpen ? dialogRef.current : settingsOpen ? settingsDialogRef.current : compareOpen ? compareDialogRef.current : null;
    if (!panel) return undefined;

    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const focusable = () => [...panel.querySelectorAll(focusableSelector)];
    const initialFocus = dialogOpen
      ? panel.querySelector('input[type="text"]') || focusable()[0]
      : focusable()[0];
    window.requestAnimationFrame(() => initialFocus?.focus());

    const trapFocus = (event) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener('keydown', trapFocus);
    return () => panel.removeEventListener('keydown', trapFocus);
  }, [compareOpen, dialogOpen, settingsOpen]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme;
    document.documentElement.style.setProperty('--app-accent', settings.trackerColor || getDefaultTrackerColor());
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-accent', settings.trackerColor || getDefaultTrackerColor());
  }, [settings.trackerColor]);

  useEffect(() => {
    const saved = readStorage('timers', []);
    const valid = Array.isArray(saved) ? saved.filter(isValidTimer).map(sanitizeTimer) : [];
    const loaded = resetTimersForLoad(valid.slice(0, MAX_TIMERS));
    const reconciled = reconcileTimers(loaded);
    setTimers(reconciled);
    setTimersHydrated(true);
    setStoppedAlarmIds(new Set(reconciled.filter((t) => t.alarmStoppedAt).map((t) => t.id)));
    reconciled.forEach((timer, index) => {
      const previous = loaded[index];
      if (previous && ['running', 'scheduled'].includes(previous.state) && timer.state === 'finished') {
        queueFinishNotification(timer);
      }
    });
  }, []);

  useEffect(() => {
    const reconcile = () => {
      setTimers((current) => {
        const next = current.map((timer) => {
          const reconciled = reconcileTimer(timer);
          if (['running', 'scheduled'].includes(timer.state) && reconciled.state === 'finished') {
            queueFinishNotification(reconciled);
          }
          return reconciled;
        });
        return next.some((timer, index) => timer !== current[index]) ? next : current;
      });
    };

    window.addEventListener('focus', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      window.removeEventListener('focus', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, []);

  useEffect(() => {
    const syncChange = (event) => {
      if (event.key === `${STORAGE_PREFIX}.timers`) {
        const next = readStorage('timers', []);
        if (Array.isArray(next)) {
          const sanitized = next.filter(isValidTimer).map(sanitizeTimer).slice(0, MAX_TIMERS);
          setTimers(sanitized);
          setStoppedAlarmIds(new Set(sanitized.filter((t) => t.alarmStoppedAt).map((t) => t.id)));
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
          const reconciled = reconcileTimer(timer);
          if (reconciled.state === 'finished' && timer.state !== 'finished') {
            changed = true;
            setStoppedAlarmIds((currentIds) => {
              const nextIds = new Set(currentIds);
              nextIds.delete(timer.id);
              return nextIds;
            });
            queueFinishNotification(reconciled);
            return reconciled;
          }
          if (reconciled !== timer) changed = true;
          return reconciled;
        });
        if (!changed) return current;
        return updated;
      });
    };

    const schedule = () => {
      cancelAnimationFrame(tickerRef.current);
      const shouldAnimate = timers.some(
        (timer) =>
          timer.state === 'running' ||
          timer.state === 'scheduled' ||
          (timer.state === 'finished' && !stoppedAlarmIds.has(timer.id) && !timer.alarmStoppedAt)
      );
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
  }, [timers, stoppedAlarmIds]);

  useEffect(() => {
    if (!compareOpen) return undefined;
    const interval = window.setInterval(() => setCompareNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [compareOpen]);

  useEffect(() => {
    if (referenceTimerId && !timers.some((timer) => timer.id === referenceTimerId && ['running', 'scheduled'].includes(timer.state))) {
      setReferenceTimerId(null);
    }
  }, [referenceTimerId, timers]);

  useEffect(() => {
    if (!compareOpen) return;
    setCompareIds((current) => current.filter((id) => timers.some((timer) => timer.id === id)));
  }, [compareOpen, timers]);

  useEffect(() => {
    if (!timersHydrated) return undefined;
    const persistTimers = () => {
      try {
        localStorage.setItem(`${STORAGE_PREFIX}.timers`, JSON.stringify(timers));
      } catch {
        setStorageWarning(true);
      }
    };

    const debounced = setTimeout(persistTimers, 150);
    const onPageHide = () => {
      try {
        localStorage.setItem(
          `${STORAGE_PREFIX}.timers`,
          JSON.stringify(pauseTimersForPersistence(timers))
        );
      } catch {
        setStorageWarning(true);
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearTimeout(debounced);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [timers, timersHydrated]);

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
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setIsInstalled(standalone);
    const beforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const appInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', beforeInstallPrompt);
    window.addEventListener('appinstalled', appInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstallPrompt);
      window.removeEventListener('appinstalled', appInstalled);
    };
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

  useEffect(() => () => {
    alarmIntervalRef.current.forEach((interval) => window.clearInterval(interval));
    alarmIntervalRef.current.clear();
    activeAlarmRef.current.forEach((oscillator) => {
      oscillator.stop();
    });
    activeAlarmRef.current.clear();
    window.clearTimeout(volumePreviewTimeoutRef.current);
  }, []);

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
    if (finishNoticeRef.current.has(timer.id)) return;
    finishNoticeRef.current.add(timer.id);
    showSnackbar(`${timer.name} is done.`);
    const shouldNotify = settings.siteNotifications && 'Notification' in window && Notification.permission === 'granted';
    if (shouldNotify) {
      new Notification('Timer complete', { body: `${timer.name} finished.`, tag: timer.id });
    }
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 80, 200, 80, 200]);
    }
    const volume = timer.useGlobalVolume
      ? settings.soundVolume
      : (Number.isFinite(timer.soundVolume) ? timer.soundVolume : settings.soundVolume || 0.7);
    playAlarm(timer.sound || settings.lastSound || DEFAULT_SOUND, volume, timer.id);
    if (timer.repeatAlarm) {
      stopAlarm(timer.id);
      const interval = window.setInterval(() => {
        playAlarm(timer.sound || settings.lastSound || DEFAULT_SOUND, volume, timer.id);
      }, 3000);
      alarmIntervalRef.current.set(timer.id, interval);
    }
  }

  function stopAlarm(timerId) {
    const interval = alarmIntervalRef.current.get(timerId);
    if (interval) {
      window.clearInterval(interval);
      alarmIntervalRef.current.delete(timerId);
    }
    const oscillator = activeAlarmRef.current.get(timerId);
    if (oscillator) {
      activeAlarmRef.current.delete(timerId);
      oscillator.stop();
    }
  }

  function playAlarm(name, volume, timerId = null) {
    if (!name || !('AudioContext' in window || 'webkitAudioContext' in window)) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const context = audioContextRef.current || new AudioCtx();
    audioContextRef.current = context;
    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }

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
    if (timerId) {
      activeAlarmRef.current.set(timerId, oscillator);
      oscillator.addEventListener('ended', () => {
        if (activeAlarmRef.current.get(timerId) === oscillator) {
          activeAlarmRef.current.delete(timerId);
        }
      }, { once: true });
    }
    oscillator.start();
    oscillator.stop(context.currentTime + 0.65);
  }

  function previewSound(name = DEFAULT_SOUND, volume = settings.soundVolume) {
    playAlarm(name, clamp(Number(volume) || 0, 0, 2));
  }

  function previewGlobalVolume(volume) {
    const nextVolume = clamp(Number(volume) || 0, 0, 2);
    setSettings((current) => ({ ...current, soundVolume: nextVolume }));
    window.clearTimeout(volumePreviewTimeoutRef.current);
    volumePreviewTimeoutRef.current = window.setTimeout(() => {
      previewSound(settings.lastSound || DEFAULT_SOUND, nextVolume);
    }, 180);
  }

  async function installApp() {
    if (!installPrompt) {
      showSnackbar('Use your browser menu and choose “Add to home screen” or “Install app”.');
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function openCreateDialog(initialTimer = null) {
    const timer = initialTimer || null;
    const durationSeconds = timer ? timer.totalMs / 1000 : 25 * 60;
    const durationUnit = timer ? getDurationUnit(durationSeconds) : 'minutes';
    setEditingId(timer ? timer.id : null);
    setMoreOptionsOpen(false);
    setDraft({
      name: timer ? timer.name : '',
      duration: getDurationValue(durationSeconds, durationUnit),
      durationUnit,
      color: timer ? timer.color : settings.lastColor || settings.trackerColor || getDefaultTrackerColor(),
      sound: timer ? timer.sound : settings.lastSound || DEFAULT_SOUND,
      repeatAlarm: timer ? timer.repeatAlarm === true : false,
      soundVolume: timer && Number.isFinite(timer.soundVolume) ? timer.soundVolume : settings.soundVolume,
      useGlobalVolume: timer ? timer.useGlobalVolume === true : true,
      clockMode: timer ? timer.clockMode === true : false,
      clockFrom: timer?.clockFrom || null,
      clockTo: timer?.clockTo || null,
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
    const totalMs = clamp(timer.elapsedMs + remainingMs, 1000, MAX_DURATION_MS);
    const normalizedRemainingMs = totalMs - timer.elapsedMs;
    updateTimer(timer.id, {
      totalMs,
      endTime: timer.state === 'running' ? Date.now() + normalizedRemainingMs : null,
      state: timer.state === 'finished' ? 'paused' : timer.state,
      finishedAt: null,
      alarmStoppedAt: null,
      overtimeMs: 0,
      updatedAt: Date.now(),
    });
    cancelTimeEdit();
  }

  function startTimer(timerId) {
    stopAlarm(timerId);
    finishNoticeRef.current.delete(timerId);
    setStoppedAlarmIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(timerId);
      return nextIds;
    });
    setTimers((current) => current.map((timer) => {
      if (timer.id !== timerId) return timer;
      const isFinished = timer.state === 'finished';
      const elapsedMs = isFinished ? 0 : timer.elapsedMs;
      const remainingMs = timer.totalMs - elapsedMs;
      const next = {
        ...timer,
        elapsedMs,
        state: 'running',
        endTime: Date.now() + remainingMs,
        finishedAt: null,
        alarmStoppedAt: null,
        overtimeMs: 0,
        updatedAt: Date.now(),
      };
      return next;
    }));
  }

  function getCompareTimers() {
    return timers
      .filter((timer) => ['running', 'scheduled', 'paused'].includes(timer.state))
      .map((timer) => ({ timer, endTime: getTimerEndTime(timer, compareNow), paused: timer.state === 'paused' }))
      .filter((entry) => entry.endTime)
      .sort((a, b) => a.endTime - b.endTime);
  }

  function pauseTimer(timerId) {
    setTimers((current) => current.map((timer) => {
      if (timer.id !== timerId || timer.state !== 'running') return timer;
      const elapsedMs = clamp(
        timer.totalMs - (timer.endTime ? Math.max(0, timer.endTime - Date.now()) : 0),
        0,
        timer.totalMs
      );
      return { ...timer, elapsedMs, state: 'paused', endTime: null, totalMs: timer.totalMs, updatedAt: Date.now() };
    }));
  }

  function resetTimer(timerId) {
    stopAlarm(timerId);
    finishNoticeRef.current.delete(timerId);
    setStoppedAlarmIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(timerId);
      return nextIds;
    });
    setTimers((current) => current.map((timer) => (
      timer.id === timerId
        ? {
            ...timer,
            elapsedMs: 0,
            state: 'idle',
            endTime: null,
            finishedAt: null,
            alarmStoppedAt: null,
            overtimeMs: 0,
          }
        : timer
    )));
  }

  function removeTimer(timerId) {
    stopAlarm(timerId);
    finishNoticeRef.current.delete(timerId);
    setStoppedAlarmIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(timerId);
      return nextIds;
    });
    setTimers((current) => current.filter((timer) => timer.id !== timerId));
  }

  function handleStopAlarm(timerId) {
    stopAlarm(timerId);
    const now = Date.now();
    setStoppedAlarmIds((currentIds) => new Set(currentIds).add(timerId));
    setTimers((current) => current.map((timer) => {
      if (timer.id !== timerId) return timer;
      const finishedAt = timer.finishedAt || now;
      const overtimeMs = Math.max(0, now - finishedAt);
      return {
        ...timer,
        alarmStoppedAt: now,
        overtimeMs,
        updatedAt: now,
      };
    }));
  }

  function moveTimer(timerId, direction) {
    setTimers((current) => {
      const index = current.findIndex((timer) => timer.id === timerId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      setReorderAnnouncement(`${next[index].name} moved to position ${nextIndex + 1} of ${next.length}.`);
      return next;
    });
  }

  function dropTimer(targetTimerId, position = 'before', sourceTimerId = draggingTimerId) {
    if (!sourceTimerId || sourceTimerId === targetTimerId) return;
    setTimers((current) => {
      const fromIndex = current.findIndex((timer) => timer.id === sourceTimerId);
      const toIndex = current.findIndex((timer) => timer.id === targetTimerId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      const targetIndex = next.findIndex((timer) => timer.id === targetTimerId);
      const insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
      next.splice(insertionIndex, 0, moved);
      setReorderAnnouncement(`${moved.name} moved ${position} ${current[toIndex].name}, to position ${insertionIndex + 1} of ${next.length}.`);
      return next;
    });
    setDraggingTimerId(null);
    setDropTarget(null);
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
      repeatAlarm: timer.repeatAlarm,
      soundVolume: timer.soundVolume,
      useGlobalVolume: timer.useGlobalVolume,
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
    alarmIntervalRef.current.forEach((interval) => window.clearInterval(interval));
    alarmIntervalRef.current.clear();
    setStoppedAlarmIds(new Set());
    finishNoticeRef.current.clear();
    setTimers([]);
    persistStorage('timers', []);
  }

  function setClockMode(enabled) {
    if (!enabled) {
      setDraft((current) => ({ ...current, clockMode: false }));
      return;
    }
    const from = draft.clockFrom || Date.now();
    const to = draft.clockTo || (from + getDurationMilliseconds(draft.duration, draft.durationUnit || 'minutes'));
    setDraft((current) => ({ ...current, clockMode: true, clockFrom: from, clockTo: to }));
  }

  function updateClockTime(field, value) {
    const base = field === 'from' ? (draft.clockFrom || Date.now()) : (draft.clockTo || Date.now());
    const timestamp = getClockTimeTimestamp(value, base);
    if (!timestamp) return;
    const currentFrom = field === 'from' ? timestamp : (draft.clockFrom || Date.now());
    const currentTo = field === 'to' ? timestamp : (draft.clockTo || currentFrom + 15 * 60 * 1000);
    const range = getClockRangeTimestamps(formatClockInput(currentFrom), formatClockInput(currentTo), currentFrom);
    if (!range) return;
    const seconds = clamp(Math.round(range.durationMs / 1000), 1, MAX_DURATION_MS / 1000);
    setDraft((current) => ({
      ...current,
      clockFrom: range.from,
      clockTo: range.to,
      duration: getDurationValue(seconds, current.durationUnit || 'minutes'),
    }));
  }

  const draftClockDurationMs = draft.clockMode && draft.clockFrom && draft.clockTo
    ? draft.clockTo - draft.clockFrom
    : getDurationMilliseconds(draft.duration, draft.durationUnit || 'minutes');
  const draftDurationValid = Number.isFinite(draftClockDurationMs)
    && draftClockDurationMs >= 1000
    && draftClockDurationMs <= MAX_DURATION_MS;
  const clockCrossesDay = draft.clockMode && draft.clockFrom && draft.clockTo && draft.clockTo > draft.clockFrom
    && new Date(draft.clockTo).getDate() !== new Date(draft.clockFrom).getDate();

  function handleSubmit(event) {
    event.preventDefault();
    const totalMs = clamp(draft.clockMode && draft.clockFrom && draft.clockTo
      ? draft.clockTo - draft.clockFrom
      : getDurationMilliseconds(draft.duration, draft.durationUnit || 'minutes'), 1000, MAX_DURATION_MS);
    if (!editingId) {
      addTimer({
        name: draft.name.trim() || `Timer ${timers.length + 1}`,
        totalMs,
        color: draft.color,
        sound: draft.sound,
        repeatAlarm: draft.repeatAlarm,
        soundVolume: draft.soundVolume,
        useGlobalVolume: draft.useGlobalVolume,
        startTime: draft.clockMode && draft.clockFrom > Date.now() ? draft.clockFrom : null,
        clockMode: draft.clockMode,
        clockFrom: draft.clockFrom,
        clockTo: draft.clockTo,
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
        totalMs,
        color: draft.color,
        sound: draft.sound,
        repeatAlarm: draft.repeatAlarm,
        soundVolume: draft.soundVolume,
        useGlobalVolume: draft.useGlobalVolume,
        startTime: draft.clockMode && draft.clockFrom > Date.now() ? draft.clockFrom : null,
        clockMode: draft.clockMode,
        clockFrom: draft.clockFrom,
        clockTo: draft.clockTo,
        elapsedMs: clamp(timer.elapsedMs, 0, totalMs),
        state: draft.clockMode && draft.clockFrom > Date.now() ? 'scheduled' : (timer.state === 'finished' ? 'finished' : timer.state),
      };
    }));
    setDialogOpen(false);
  }

  const compareTimers = getCompareTimers();
  const selectedCompareTimers = compareTimers.filter(({ timer }) => compareIds.includes(timer.id));
  const compareStart = Math.min(compareNow, ...selectedCompareTimers.map(({ endTime }) => endTime - 1));
  const compareSpan = Math.max(1000, ...selectedCompareTimers.map(({ endTime }) => endTime - compareStart));

  return (
    <>
      <AppHeader
        settings={settings}
        setSettings={setSettings}
        setSettingsOpen={setSettingsOpen}
        setReorderAnnouncement={setReorderAnnouncement}
        toggleSiteNotifications={toggleSiteNotifications}
        onPreviewSound={previewSound}
        onVolumeChange={previewGlobalVolume}
        compareVisible={timers.length > 1 && !settings.compactMode}
        onOpenCompare={() => {
          setCompareIds((current) => current.length ? current : timers.filter((timer) => ['running', 'scheduled'].includes(timer.state)).map((timer) => timer.id));
          setCompareNow(Date.now());
          setCompareOpen(true);
        }}
      />

      <main className="main-shell">
        {timers.length === 0 ? (
          <EmptyState
            presets={DEMO_PRESETS}
            onAddPreset={(preset) => addTimer({
              name: preset.name,
              totalMs: preset.seconds * 1000,
              color: settings.trackerColor || getDefaultTrackerColor(),
              sound: DEFAULT_SOUND,
            })}
            onAddTimer={() => openCreateDialog()}
          />
        ) : (
          <section
            className={`timer-grid ${settings.compactMode ? 'compact-mode' : ''} ${settings.reorderMode ? 'reorder-mode' : ''}`}
            aria-label={settings.reorderMode ? 'Timers. Reordering enabled.' : 'Timers'}
          >
            {settings.reorderMode ? (
              <p className="reorder-help">
                <strong>Reordering on.</strong> Drag a handle and release when the highlighted line is where you want the timer, or use the move buttons.
              </p>
            ) : null}
            {timers.map((timer) => (
              <TimerCard
                key={timer.id}
                timer={timer}
                timers={timers}
                compactMode={settings.compactMode}
                reorderMode={settings.reorderMode}
                selected={selectedTimerId === timer.id}
                highlighted={highlightedTimerId === timer.id}
                alarmStopped={stoppedAlarmIds.has(timer.id) || !!timer.alarmStoppedAt}
                reference={referenceTimerId === timer.id}
                compareDelta={referenceTimerId && referenceTimerId !== timer.id ? (() => {
                  const ref = timersById[referenceTimerId];
                  const refEnd = ref ? getTimerEndTime(ref, Date.now()) : null;
                  const end = getTimerEndTime(timer, Date.now());
                  return refEnd && end && ['running', 'scheduled'].includes(timer.state) ? getTimerDeltaMs(ref, timer, Date.now()) : null;
                })() : null}
                compareReferenceName={referenceTimerId ? timersById[referenceTimerId]?.name : null}
                endTime={getTimerEndTime(timer, Date.now())}
                startTime={timer.startTime}
                dragging={draggingTimerId === timer.id}
                dropTarget={dropTarget?.id === timer.id ? dropTarget.position : null}
                editingTime={editingTimeId === timer.id}
                timeDraft={timeDraft}
                timeInputRef={timeInputRef}
                onFocus={() => setSelectedTimerId(timer.id)}
                onOpenEditor={() => openCreateDialog(timer)}
                onCompare={() => setReferenceTimerId(timer.id)}
                onBeginTimeEdit={() => beginTimeEdit(timer)}
                onCancelTimeEdit={cancelTimeEdit}
                onSaveTimeEdit={() => saveTimeEdit(timer)}
                onTimeDraftChange={(event) => setTimeDraft(event.target.value)}
                onStart={() => startTimer(timer.id)}
                onPause={() => pauseTimer(timer.id)}
                onReset={() => resetTimer(timer.id)}
                onDuplicate={() => duplicateTimer(timer.id)}
                onRemove={() => removeTimer(timer.id)}
                onStopAlarm={() => handleStopAlarm(timer.id)}
                onMove={(direction) => moveTimer(timer.id, direction)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', timer.id);
                  setDraggingTimerId(timer.id);
                  setDropTarget(null);
                }}
                onDragEnd={() => {
                  setDraggingTimerId(null);
                  setDropTarget(null);
                }}
                onDragOver={(event) => {
                  if (!settings.reorderMode || !draggingTimerId || draggingTimerId === timer.id) return;
                  event.preventDefault();
                  const position = event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2
                    ? 'before'
                    : 'after';
                  if (dropTarget?.id !== timer.id || dropTarget.position !== position) {
                    setDropTarget({ id: timer.id, position });
                  }
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget)) return;
                  if (dropTarget?.id === timer.id) setDropTarget(null);
                }}
                onDrop={(event) => {
                  if (!settings.reorderMode) return;
                  event.preventDefault();
                  const sourceTimerId = event.dataTransfer.getData('text/plain');
                  dropTimer(timer.id, dropTarget?.id === timer.id ? dropTarget.position : 'before', sourceTimerId);
                }}
                cardRef={(element) => {
                  if (element) timerCardRefs.current.set(timer.id, element);
                  else timerCardRefs.current.delete(timer.id);
                }}
              />
            ))}
          </section>
        )}
        {reorderAnnouncement ? (
          <p className="sr-only" role="status" aria-live="polite">{reorderAnnouncement}</p>
        ) : null}
        <footer className="app-footer" aria-label="Project links">
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">View NotOverTime on GitHub</a>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Star NotOverTime on GitHub">Star</a>
          <a href={`${GITHUB_REPO_URL}/issues/new/choose`} target="_blank" rel="noopener noreferrer" aria-label="Report an issue on GitHub">Report an issue</a>
        </footer>
      </main>

      {timers.length > 0 ? (
        <button className="fab" type="button" aria-label="Create timer" onClick={() => openCreateDialog()}>+</button>
      ) : null}

      {dialogOpen ? (
        <div
          className="dialog-overlay edit-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="timer-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialogOpen(false);
          }}
        >
          <div className="dialog-panel" ref={dialogRef}>
            <form onSubmit={handleSubmit}>
              <div className="dialog-header">
                <h2 id="timer-dialog-title">{editingId ? 'Edit timer' : 'Add timer'}</h2>
                <button type="button" className="close-button" onClick={() => setDialogOpen(false)}>×</button>
              </div>

              <label className="field">
                <span>Name</span>
                <input type="text" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>

              <div className="field">
                <span className="editor-mode-row">
                  <strong>Time</strong>
                  <span className="segmented-control" role="group" aria-label="Timer mode">
                    <button type="button" className={!draft.clockMode ? 'selected' : ''} aria-pressed={!draft.clockMode} onClick={() => setClockMode(false)}>Duration</button>
                    <button type="button" className={draft.clockMode ? 'selected' : ''} aria-pressed={draft.clockMode} onClick={() => setClockMode(true)}>Clock time</button>
                  </span>
                </span>
                {draft.clockMode ? (
                  <div className="clock-time-row">
                    <label>From <input type="time" value={draft.clockFrom ? formatClockInput(draft.clockFrom) : ''} onChange={(event) => updateClockTime('from', event.target.value)} /></label>
                    <span aria-hidden="true">→</span>
                    <label>To <input type="time" value={draft.clockTo ? formatClockInput(draft.clockTo) : ''} onChange={(event) => updateClockTime('to', event.target.value)} /></label>
                    <small>{formatDuration(Math.max(0, (draft.clockTo || 0) - (draft.clockFrom || 0)) / 1000)} {clockCrossesDay ? <span className="day-badge">+1 day</span> : null}</small>
                  </div>
                ) : (
                  <div className="duration-input-row">
                    <input type="number" inputMode="decimal" min="0" step="any" value={draft.duration} onChange={(event) => setDraft((current) => ({ ...current, duration: event.target.value }))} />
                    <select aria-label="Duration unit" value={draft.durationUnit || 'minutes'} onChange={(event) => setDraft((current) => {
                      const oldMultiplier = getDurationMultiplier(current.durationUnit || 'minutes');
                      const seconds = (Number(current.duration) || 0) * oldMultiplier;
                      const nextUnit = event.target.value;
                      return { ...current, durationUnit: nextUnit, duration: getDurationValue(seconds, nextUnit) };
                    })}>
                      <option value="seconds">Seconds</option>
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                    </select>
                  </div>
                )}
              </div>

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

              <button type="button" className="more-options-button" aria-expanded={moreOptionsOpen} onClick={() => setMoreOptionsOpen((open) => !open)}>
                {moreOptionsOpen ? 'Less' : 'More'} options
              </button>

              {moreOptionsOpen ? <label className="field">
                <span>Alarm sound</span>
                <select value={draft.sound} onChange={(event) => setDraft((current) => ({ ...current, sound: event.target.value }))}>
                  {SOUND_OPTIONS.map((sound) => <option key={sound} value={sound}>{sound}</option>)}
                </select>
              </label> : null}

              {moreOptionsOpen ? <label className="setting-toggle inline-setting">
                <span>
                  <strong>Repeat until stopped</strong>
                  <small>Keep playing the alarm every 3 seconds.</small>
                </span>
                <button
                  type="button"
                  className="switch"
                  aria-pressed={draft.repeatAlarm}
                  onClick={() => setDraft((current) => ({ ...current, repeatAlarm: !current.repeatAlarm }))}
                >
                  <span className="switch-thumb" />
                </button>
              </label> : null}

              {moreOptionsOpen ? <label className="field">
                <span>Timer sound volume <strong>{Math.round(draft.soundVolume * 100)}%</strong></span>
                <input
                  className="range-input"
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={draft.soundVolume}
                  disabled={draft.useGlobalVolume}
                  aria-label="Timer sound volume"
                  onChange={(event) => setDraft((current) => ({ ...current, soundVolume: Number(event.target.value) }))}
                />
              </label> : null}
              {moreOptionsOpen ? <label className="setting-toggle inline-setting">
                <span>
                  <strong>Use app volume</strong>
                  <small>Follow the global sound level from the header.</small>
                </span>
                <button
                  type="button"
                  className="switch"
                  aria-pressed={draft.useGlobalVolume}
                  onClick={() => setDraft((current) => ({ ...current, useGlobalVolume: !current.useGlobalVolume }))}
                >
                  <span className="switch-thumb" />
                </button>
              </label> : null}

              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={() => setDialogOpen(false)}>Cancel</button>
                <button type="submit" className="primary" disabled={!draftDurationValid} title={draftDurationValid ? '' : 'Enter a duration between 1 second and the maximum allowed duration.'}>{editingId ? 'Save' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="dialog-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="dialog-panel settings-panel" ref={settingsDialogRef}>
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

            <p className="field-help settings-sound-note">
              Global alarm volume and the test button are available in the app header.
            </p>

            <div className="install-card">
              <div>
                <strong>{isInstalled ? 'App installed' : 'Use NotOverTime as an app'}</strong>
                <small>{isInstalled ? 'Open it from your home screen for a focused timer window.' : 'Install the offline-ready app for quick access from your home screen.'}</small>
              </div>
              {!isInstalled ? (
                <button type="button" className="secondary" onClick={installApp}>
                  {installPrompt ? 'Install app' : 'How to install'}
                </button>
              ) : null}
            </div>

            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => setSettingsOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {compareOpen ? (
        <div className="dialog-overlay compare-overlay" role="dialog" aria-modal="true" aria-labelledby="compare-dialog-title" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCompareOpen(false);
        }}>
          <div className="dialog-panel compare-panel" ref={compareDialogRef}>
            <div className="dialog-header">
              <h2 id="compare-dialog-title">Compare</h2>
              <button type="button" className="close-button" onClick={() => setCompareOpen(false)}>×</button>
            </div>
            <div className="compare-axis">now <span /> time</div>
            <div className="compare-lanes">
              {compareTimers.map(({ timer, endTime }, index) => {
                const included = compareIds.includes(timer.id);
                const width = Math.max(4, ((endTime - compareStart) / compareSpan) * 100);
                const previous = compareTimers[index - 1];
                return (
                  <div className="compare-lane" key={timer.id}>
                    <label className="compare-lane-label">
                      <input type="checkbox" checked={included} onChange={() => setCompareIds((current) => included ? current.filter((id) => id !== timer.id) : [...current, timer.id])} />
                      <span>{timer.name}</span>
                    </label>
                    <div className="compare-bar-track"><span className="compare-bar" style={{ width: `${width}%`, backgroundColor: timer.color }} /></div>
                    <strong>{timer.state === 'paused' ? 'paused' : formatLocalTime(endTime)}</strong>
                    {previous && timer.state !== 'paused' && previous.timer.state !== 'paused' ? <small>{formatDuration(Math.max(0, endTime - previous.endTime) / 1000)}</small> : null}
                  </div>
                );
              })}
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
