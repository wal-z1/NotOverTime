import { formatDuration, getTimerDisplay } from '../utils/timer';
import Icon from './Icon';

export default function TimerCard({
  timer,
  timers,
  compactMode,
  reorderMode,
  selected,
  highlighted,
  dragging,
  dropTarget,
  editingTime,
  timeDraft,
  timeInputRef,
  onFocus,
  onOpenEditor,
  onBeginTimeEdit,
  onCancelTimeEdit,
  onSaveTimeEdit,
  onTimeDraftChange,
  onStart,
  onPause,
  onReset,
  onDuplicate,
  onRemove,
  onStopAlarm,
  onMove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  cardRef,
}) {
  const { remainingMs, progress, radius, circumference, offset } = getTimerDisplay(timer);

  return (
    <article
      tabIndex="0"
      aria-label={`${timer.name} timer. Press Space to start or pause.`}
      ref={cardRef}
      style={{ '--timer-color': timer.color }}
      onFocus={onFocus}
      className={`timer-card ${timer.state} ${selected ? 'selected' : ''} ${highlighted ? 'timer-card-highlight' : ''} ${dragging ? 'dragging' : ''} ${dropTarget ? `drop-${dropTarget}` : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="card-top">
        {reorderMode ? (
          <div className="reorder-controls">
            <button
              type="button"
              className="drag-handle"
              draggable="true"
              aria-label={`Drag ${timer.name} to reorder`}
              title="Drag to reorder"
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            >
              <span aria-hidden="true">☷</span>
            </button>
            <div className="move-buttons">
              <button type="button" className="move-button" aria-label={`Move ${timer.name} up`} disabled={timers[0].id === timer.id} onClick={() => onMove(-1)}>↑</button>
              <button type="button" className="move-button" aria-label={`Move ${timer.name} down`} disabled={timers[timers.length - 1].id === timer.id} onClick={() => onMove(1)}>↓</button>
            </div>
          </div>
        ) : null}
        <h3>{timer.name}</h3>
        {!compactMode ? <button type="button" className="mini-button secondary" onClick={onOpenEditor}>Edit</button> : null}
      </div>

      <div className={`timer-visual ${compactMode ? 'compact-hidden' : ''}`} style={{ '--ring-color': timer.color }}>
        <svg viewBox="0 0 200 200" className="timer-ring" role="img" aria-label={`${timer.name} remaining ${formatDuration(remainingMs / 1000)}`}>
          <circle cx="100" cy="100" r="84" className="outer-ring" />
          <circle cx="100" cy="100" r={radius} className="track" />
          <circle cx="100" cy="100" r={radius} className={`progress ${timer.state === 'idle' ? 'reset' : ''}`} strokeDasharray={circumference} strokeDashoffset={offset} />
          <line x1="100" y1="100" x2="100" y2="34" className="hand" style={{ transform: `rotate(${(timer.elapsedMs / timer.totalMs) * 360}deg)` }} />
          <circle cx="100" cy="100" r="4" className="hand-cap" />
        </svg>
      </div>

      <div className={`time-editor ${compactMode ? 'compact' : ''}`}>
        {editingTime ? (
          <input
            ref={timeInputRef}
            className="time-input"
            type="text"
            inputMode="numeric"
            aria-label={`Edit ${timer.name} remaining time`}
            value={timeDraft}
            onChange={onTimeDraftChange}
            onBlur={onSaveTimeEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSaveTimeEdit();
              if (event.key === 'Escape') onCancelTimeEdit();
            }}
          />
        ) : (
          <button type="button" className="remaining-time" aria-label={`Edit ${timer.name} remaining time`} onClick={onBeginTimeEdit}>
            {formatDuration(remainingMs / 1000)}
          </button>
        )}
        {!compactMode ? <div className="elapsed-total">{formatDuration(timer.elapsedMs / 1000)} / {formatDuration(timer.totalMs / 1000)}</div> : null}
      </div>

      <div className={`linear-progress ${compactMode ? 'compact-hidden' : ''}`} aria-label={`${Math.round(progress)}% complete`}>
        <span className="linear-progress-fill" style={{ width: `${progress}%`, backgroundColor: timer.color }} />
      </div>

      <div className={`actions-row ${compactMode ? 'compact-hidden' : ''}`}>
        {timer.state === 'running' ? <button type="button" className="primary" onClick={onPause}>Pause</button> : <button type="button" className="primary" onClick={onStart}>{timer.state === 'finished' ? 'Restart' : 'Start'}</button>}
        <button type="button" className="secondary" onClick={onReset}>Reset</button>
        <button type="button" className="secondary" onClick={onDuplicate}>Duplicate</button>
        <button type="button" className="danger" onClick={onRemove}>Delete</button>
        {timer.state === 'finished' && timer.repeatAlarm ? <button type="button" className="danger" onClick={onStopAlarm}>Stop sound</button> : null}
      </div>

      <div className="compact-actions">
        <button type="button" className="compact-icon-button primary" aria-label={timer.state === 'running' ? `Pause ${timer.name}` : `Start ${timer.name}`} title={timer.state === 'running' ? 'Pause' : 'Start'} onClick={timer.state === 'running' ? onPause : onStart}>
          <Icon name={timer.state === 'running' ? 'pause' : 'play'} />
        </button>
        <button type="button" className="compact-icon-button secondary" aria-label={`Reset ${timer.name}`} title="Reset" onClick={onReset}><Icon name="reset" /></button>
        <button type="button" className="compact-icon-button secondary" aria-label={`Edit ${timer.name}`} title="Edit" onClick={onOpenEditor}><Icon name="edit" /></button>
        <button type="button" className="compact-icon-button danger" aria-label={`Delete ${timer.name}`} title="Delete" onClick={onRemove}><Icon name="trash" /></button>
        {timer.state === 'finished' && timer.repeatAlarm ? <button type="button" className="compact-icon-button danger" aria-label={`Stop sound for ${timer.name}`} title="Stop sound" onClick={onStopAlarm}>■</button> : null}
      </div>
    </article>
  );
}
