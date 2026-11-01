export default function EmptyState({ presets, onAddPreset, onAddTimer }) {
  return (
    <section className="empty-state">
      <h2>No timers yet</h2>
      <p>Start with a focused burst or pick a quick preset.</p>
      <div className="preset-row">
        {presets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="preset-button"
            onClick={() => onAddPreset(preset)}
          >
            {preset.name}
          </button>
        ))}
      </div>
      <button className="empty-add-button primary" type="button" onClick={onAddTimer}>
        + Add timer
      </button>
    </section>
  );
}
