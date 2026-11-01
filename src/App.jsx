import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SOUND,
  DEMO_PRESETS,
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
  getDurationMilliseconds,
  getDurationMultiplier,
  getDurationUnit,
  getDurationValue,
  getVolumeDb,
  isValidTimer,
  parseDurationInput,
  pauseTimersForPersistence,
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
  });
  const [storageWarning, setStorageWarning] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const timeInputRef = useRef(null);
  const tickerRef = useRef(0);
  const audioContextRef = useRef(null);
  const alarmIntervalRef = useRef(new Map());
  const finishNoticeRef = useRef(new Set());
  const nextRequestRef = useRef(null);
  const timerCardRefs = useRef(new Map());

  const timersById = useMemo(() => Object.fromEntries(timers.map((timer) => [timer.id, timer])), [timers]);

  useEffect(() => {
    if (selectedTimerId && timersById[selectedTimerId]) return;
    setSelectedTimerId(timers[0]?.id || null);
  }, [selectedTimerId, timers, timersById]);

  useEffect(() => {
    const keyboardHandler = (event) => {
      if (event.key === 'Escape') {
        if (editingTimeId) {
          cancelTimeEdit();
        } else if (dialogOpen || settingsOpen) {
          setDialogOpen(false);
          setSettingsOpen(false);
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
  }, [dialogOpen, editingTimeId, selectedTimerId, settingsOpen, timersById]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme;
    document.documentElement.style.setProperty('--primary', settings.trackerColor || getDefaultTrackerColor());
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--primary', settings.trackerColor || getDefaultTrackerColor());
  }, [settings.trackerColor]);

  useEffect(() => {
    const saved = readStorage('timers', []);
    const valid = Array.isArray(saved) ? saved.filter(isValidTimer).map(sanitizeTimer) : [];
    const safe = resetTimersForLoad(valid.slice(0, MAX_TIMERS));
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
    finishNoticeRef.current.add(timer.id);
    showSnackbar(`${timer.name} is done.`);
    const shouldNotify = settings.siteNotifications && 'Notification' in window && Notification.permission === 'granted';
    if (shouldNotify) {
      new Notification('Timer complete', { body: `${timer.name} finished.`, tag: timer.id });
    }
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 80, 200, 80, 200]);
    }
    const volume = Number.isFinite(timer.soundVolume) ? timer.soundVolume : settings.soundVolume || 0.7;
    playAlarm(timer.sound || settings.lastSound || DEFAULT_SOUND, volume);
    if (timer.repeatAlarm) {
      stopAlarm(timer.id);
      const interval = window.setInterval(() => {
        playAlarm(timer.sound || settings.lastSound || DEFAULT_SOUND, volume);
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
  }

  function playAlarm(name, volume) {
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
    oscillator.start();
    oscillator.stop(context.currentTime + 0.65);
  }

  function previewSound(name = DEFAULT_SOUND, volume = settings.soundVolume) {
    playAlarm(name, clamp(Number(volume) || 0, 0, 1));
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
    setDraft({
      name: timer ? timer.name : '',
      duration: getDurationValue(durationSeconds, durationUnit),
      durationUnit,
      color: timer ? timer.color : settings.lastColor || settings.trackerColor || getDefaultTrackerColor(),
      sound: timer ? timer.sound : settings.lastSound || DEFAULT_SOUND,
      repeatAlarm: timer ? timer.repeatAlarm === true : false,
      soundVolume: timer && Number.isFinite(timer.soundVolume) ? timer.soundVolume : settings.soundVolume,
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
      updatedAt: Date.now(),
    });
    cancelTimeEdit();
  }

  function startTimer(timerId) {
    stopAlarm(timerId);
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
    setTimers((current) => current.map((timer) => (timer.id === timerId ? { ...timer, elapsedMs: 0, state: 'idle', endTime: null, finishedAt: null } : timer)));
  }

  function removeTimer(timerId) {
    stopAlarm(timerId);
    setTimers((current) => current.filter((timer) => timer.id !== timerId));
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
    setTimers([]);
    persistStorage('timers', []);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const totalMs = clamp(
      getDurationMilliseconds(draft.duration, draft.durationUnit || 'minutes'),
      1000,
      MAX_DURATION_MS
    );
    if (!editingId) {
      addTimer({
        name: draft.name.trim() || `Timer ${timers.length + 1}`,
        totalMs,
        color: draft.color,
        sound: draft.sound,
        repeatAlarm: draft.repeatAlarm,
        soundVolume: draft.soundVolume,
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
        elapsedMs: clamp(timer.elapsedMs, 0, totalMs),
        state: timer.state === 'finished' ? 'finished' : timer.state,
      };
    }));
    setDialogOpen(false);
  }

  return (
    <>
      <AppHeader
        settings={settings}
        setSettings={setSettings}
        setSettingsOpen={setSettingsOpen}
        setReorderAnnouncement={setReorderAnnouncement}
        toggleSiteNotifications={toggleSiteNotifications}
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
                dragging={draggingTimerId === timer.id}
                dropTarget={dropTarget?.id === timer.id ? dropTarget.position : null}
                editingTime={editingTimeId === timer.id}
                timeDraft={timeDraft}
                timeInputRef={timeInputRef}
                onFocus={() => setSelectedTimerId(timer.id)}
                onOpenEditor={() => openCreateDialog(timer)}
                onBeginTimeEdit={() => beginTimeEdit(timer)}
                onCancelTimeEdit={cancelTimeEdit}
                onSaveTimeEdit={() => saveTimeEdit(timer)}
                onTimeDraftChange={(event) => setTimeDraft(event.target.value)}
                onStart={() => startTimer(timer.id)}
                onPause={() => pauseTimer(timer.id)}
                onReset={() => resetTimer(timer.id)}
                onDuplicate={() => duplicateTimer(timer.id)}
                onRemove={() => removeTimer(timer.id)}
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
      </main>

      {timers.length > 0 ? (
        <button className="fab" type="button" aria-label="Create timer" onClick={() => openCreateDialog()}>+</button>
      ) : null}

      {dialogOpen ? (
        <div
          className="dialog-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="timer-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialogOpen(false);
          }}
        >
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

              <div className="field">
                <span>Duration</span>
                <div className="duration-input-row">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={draft.duration}
                    onChange={(event) => setDraft((current) => ({ ...current, duration: event.target.value }))}
                  />
                  <select
                    aria-label="Duration unit"
                    value={draft.durationUnit || 'minutes'}
                    onChange={(event) => setDraft((current) => {
                      const oldMultiplier = getDurationMultiplier(current.durationUnit || 'minutes');
                      const seconds = (Number(current.duration) || 0) * oldMultiplier;
                      const nextUnit = event.target.value;
                      return {
                        ...current,
                        durationUnit: nextUnit,
                        duration: getDurationValue(seconds, nextUnit),
                      };
                    })}
                  >
                    <option value="seconds">Seconds</option>
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                  </select>
                </div>
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

              <label className="field">
                <span>Alarm sound</span>
                <select value={draft.sound} onChange={(event) => setDraft((current) => ({ ...current, sound: event.target.value }))}>
                  {SOUND_OPTIONS.map((sound) => (
                    <option key={sound} value={sound}>{sound}</option>
                  ))}
                </select>
                <button type="button" className="secondary inline-action" onClick={() => previewSound(draft.sound, settings.soundVolume)}>
                  Test sound
                </button>
              </label>

              <label className="setting-toggle inline-setting">
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
              </label>

              <label className="field">
                <span>Timer sound volume <strong>{Math.round(draft.soundVolume * 100)}%</strong></span>
                <input
                  className="range-input"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={draft.soundVolume}
                  aria-label="Timer sound volume"
                  onChange={(event) => setDraft((current) => ({ ...current, soundVolume: Number(event.target.value) }))}
                />
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
        <div
          className="dialog-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
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

            <div className="field">
              <span>Alarm volume <strong>{Math.round(settings.soundVolume * 100)}% ({getVolumeDb(settings.soundVolume)})</strong></span>
              <small className="field-help">The alarm plays over other audio; your device and browser volume still apply.</small>
              <input
                className="range-input"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.soundVolume}
                aria-label="Alarm volume"
                onChange={(event) => setSettings((current) => ({ ...current, soundVolume: Number(event.target.value) }))}
              />
              <button type="button" className="secondary inline-action" onClick={() => previewSound(settings.lastSound || DEFAULT_SOUND, settings.soundVolume)}>
                Test {settings.lastSound || DEFAULT_SOUND}
              </button>
            </div>

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

      {storageWarning ? <div className="snackbar">Storage is unavailable, your timers won't be saved.</div> : null}
      {snackbar ? <div className="snackbar quiet">{snackbar}</div> : null}
    </>
  );
}

export default App;
