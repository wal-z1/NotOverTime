# NotOverTime

Small, local-first timer app for focused work.

- Multi-timer dashboard
- Circular countdown rings
- Local-only storage in `localStorage`
- Light/dark theme
- PWA/offline support
- Notifications and alarms
- Global sound control in the header, with optional per-timer volume overrides

## Source layout

- `src/App.jsx` owns application state, timer lifecycle effects, persistence coordination, and event handlers.
- `src/constants.js` contains shared app configuration and preset values.
- `src/utils/timer.js` contains timer formatting, validation, normalization, and persistence helpers.
- `src/components/` contains presentational pieces shared by the app shell (`AppHeader`, `EmptyState`, `TimerCard`, and `Icon`).
- `src/styles.css` contains the global design tokens and responsive UI styles.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

Push to GitHub, import into Vercel, and deploy with the default static settings. Output goes to `dist/`.

## Privacy

No accounts, cookies, analytics, or backend. Data stays on the device only. Leave Vercel Analytics and Speed Insights off.

## Manual QA checklist

- Compare three timers (running, paused, scheduled); verify REF clearing, deltas, end times, compact hiding, and the 390px bottom sheet.
- Verify ringing in normal, compact, reorder, light/dark, and reduced-motion modes; the red outline must not clip or shift layout and must show `Ringing`.
- Exercise clock ranges across midnight and DST, scheduled auto-start, sleep/wake or visibility changes, missed completion notification, and old localStorage records.
- Check edit dialog focus-to-name, Tab trap, Escape, Enter save, disabled invalid-duration save tooltip, desktop/mobile height and field visibility.
- Verify the fixed GitHub frame at 360px: one row, safe bottom spacing, last card reachable, correct target/rel/ARIA, and no request before clicking.

## New UI classes and tokens

New classes reuse existing surface, outline, shadow, muted, primary, danger, spacing, button, dialog, and input tokens:
`.edit-overlay`, `.ringing-label`, `.day-badge`, `.ref-tag`, `.delta-chip`, `.end-time`, `.compare-overlay`, `.compare-panel`, `.compare-axis`, `.compare-lanes`, `.compare-lane`, `.compare-lane-label`, `.compare-bar-track`, `.compare-bar`, `.segmented-control`, `.clock-time-row`, `.more-options-button`.
The only new layout token is `--footer-h`, which reserves fixed GitHub-frame space so content is not covered.
