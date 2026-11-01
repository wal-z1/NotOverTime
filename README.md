# NotOverTime

Small, local-first timer app for focused work.

- Multi-timer dashboard
- Circular countdown rings
- Local-only storage in `localStorage`
- Light/dark theme
- PWA/offline support
- Notifications and alarms

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
