# SolarFlow frontend

Web app for SolarFlow, a multi-tenant ERP and design platform for solar companies: React, Vite, TypeScript, Tailwind, TanStack Query, Konva (2D designer) and Three.js (3D designer). It talks to the API in the separate **solarflow-backend** repository.

## What is in this repo

- `frontend/`: the web app.
- `shared/`: validation schemas, permissions and calculations, imported as `@solarflow/shared`.

> **`shared/` is duplicated.** The backend repository carries an identical copy. When you change anything in `shared/`, copy the folder into the other repository too, so both sides validate and calculate the same way.

## Run it locally

Requirements: Node 20+ and the API running (see the backend repository).

```bash
npm install
cp frontend/.env.example frontend/.env.local    # optional settings, see below
npm run dev                                     # http://localhost:5173
```

### Settings (`frontend/.env.local`, never committed)

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | The API address including the version prefix, e.g. `http://localhost:4000/api/v1`. It is **baked in at build time**. |
| `VITE_GOOGLE_MAPS_API_KEY` | Optional. Enables Google satellite imagery in the designer's Site map. Without it the app uses free OpenStreetMap and Esri imagery. A browser key is visible to anyone who opens the app: restrict it in Google Cloud Console to your site's HTTP referrers and to the Maps JavaScript and Geocoding APIs. |

## Scripts

```bash
npm run typecheck
npm test
npm run build       # production build in frontend/dist
```

## Deploying

`npm run build` produces static files in `frontend/dist`. Host them on any static host (Netlify, Vercel, Cloudflare Pages, S3 + CDN, nginx) with a **single-page-app fallback** (every unknown path serves `index.html`). Build with `VITE_API_URL` set to the deployed API, and add the web app's URL to the backend's `CORS_ORIGINS`. GitHub Actions (`.github/workflows/ci.yml`) type-checks, tests and builds on every push.

## Security

Secrets live only in untracked `.env.local` files or in your host's build settings. Never commit them; rotate any key that has been shared in a chat or log.
