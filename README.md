# Desco Monitor Web

A browser-based DESCO prepaid dashboard. It retrieves readings and keeps history, forecasts, and settings in the browser. No AI or OpenCode is required.

## Run locally

Install Node.js 22 or newer and Chrome, Edge, or Chromium on the server, then run:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:3000 and enter your DESCO account or meter number. The first retrieval may take a minute. The desktop app's history is separate and is not automatically imported. Add and switch accounts in Settings; signing out removes an account from the active list but preserves its saved history in this browser. Account numbers are identifiers and this does not create an authenticated DESCO session.

The server listens on loopback by default. Set `HOST`, `PORT`, and optionally `CHROMIUM_PATH` in the environment before startup; `.env.example` documents these settings but is not loaded automatically. On Linux, install Chromium and set `CHROMIUM_PATH=/usr/bin/chromium` if needed. For development, run `npm start` after a build, then `npm run dev` in another terminal. Tests run with `npm test`.

## Hosting and privacy

This is a Node.js app with a server-side DESCO collector, not a static GitHub Pages site. Hosting must support a long-running Node process and a compatible headless Chromium browser. For remote hosting, bind to `0.0.0.0` behind an HTTPS reverse proxy with authentication and access controls. The collector has basic per-IP and concurrency limits, not complete public abuse protection. DESCO account numbers are identifiers, not passwords or proof of ownership.

The browser sends the account or meter number and previous snapshot to the server to retrieve DESCO data. The app does not persist readings on the server. Browser storage is specific to the browser and origin, is not encrypted, and can be cleared. Settings provides a backup download and restore; backups contain sensitive account and consumption data. Protect them and use HTTPS remotely. Notifications require permission and HTTPS or localhost. Scheduled refresh and notifications work only while the tab is open and the computer is awake.

DESCO endpoints are unofficial and can change. A failed refresh retains saved readings. Forecasts are estimates, not billing or recharge guarantees. Forecast accuracy needs a saved early-month snapshot and the corresponding completed DESCO total.

## GitHub

Dependencies, builds, local environment files, and logs are ignored. Do not commit backups, account numbers, or personal readings. Add your remote and push:

```sh
git remote add origin https://github.com/fakhrul62/desco-monitor.git
git push -u origin main
```
