import { getVolumeDb } from '../utils/timer';

export default function AppHeader({
  settings,
  setSettings,
  setSettingsOpen,
  setReorderAnnouncement,
  toggleSiteNotifications,
  onPreviewSound,
  onVolumeChange,
  compareVisible,
  onOpenCompare,
}) {
  const toggleSetting = (key) => {
    setSettings((current) => ({ ...current, [key]: !current[key] }));
  };

  function toggleReorderMode() {
    setSettings((current) => ({ ...current, reorderMode: !current.reorderMode }));
    setReorderAnnouncement(
      settings.reorderMode
        ? 'Timer reordering off.'
        : 'Timer reordering on. Drag handles or use move buttons.'
    );
  }

  return (
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
            onClick={() => toggleSetting('compactMode')}
          >
            <span className="switch-thumb" />
          </button>
        </label>
        <label className="switch-row">
          <span>Reorder timers</span>
          <button
            className="switch"
            type="button"
            aria-label="Toggle timer reordering"
            aria-pressed={settings.reorderMode}
            onClick={toggleReorderMode}
          >
            <span className="switch-thumb" />
          </button>
        </label>
        <div className="header-sound-control">
          <label className="header-sound-level">
            <span>Sound <strong>{Math.round(settings.soundVolume * 100)}% ({getVolumeDb(settings.soundVolume)})</strong></span>
            <input
              className="range-input"
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={settings.soundVolume}
              aria-label="Global alarm volume"
              onChange={(event) => onVolumeChange(Number(event.target.value))}
            />
          </label>
          <button type="button" className="icon-button sound-test-button" onClick={() => onPreviewSound(settings.lastSound, settings.soundVolume)}>
            Test
          </button>
        </div>
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
        {compareVisible ? <button type="button" className="icon-button" onClick={onOpenCompare}>Compare</button> : null}
      </div>
    </header>
  );
}
