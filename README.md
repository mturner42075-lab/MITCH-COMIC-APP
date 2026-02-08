# Noir Collect

Open-source alternative to CLZ Comics with a Modern Noir interface.

## Features
- Longbox inventory management (collection + hunt list)
- Barcode scanning with html5-qrcode
- ZXing fallback scanner for tougher barcodes
- Auto-match metadata via Comic Vine / Open Library
- CSV/JSON/XML export for portability
- CSV/JSON/XML import for bulk loads (XML supports CLZ export)
- PostgreSQL backend with REST API

## Quick Start
1. Add a Comic Vine API key (optional but recommended):
   - Export `COMICVINE_API_KEY` in your shell or set it in a `.env` file for the `api` service.
2. Start services:
   - `docker compose up`
3. Open:
   - Web UI: http://localhost:3000
   - API: http://localhost:4000/api/health

## Environment
Create `/Users/mitchturner/Documents/GitHub/MITCH-COMIC-APP/backend/.env` (optional):
```
PORT=4000
DATABASE_URL=postgres://noir_user:noir_pass@db:5432/noir_collect
COMICVINE_API_KEY=your_key_here
OPEN_LIBRARY_API=https://openlibrary.org
AUTH_TOKEN=change_me
```

## API
- `GET /api/search?title=batman&issue=1`
- `GET /api/barcode?barcode=9780306406157`
- `GET /api/comics?owned=true`
- `GET /api/export?format=xml`
- `POST /api/comics`
- `POST /api/import-xml`
- `PUT /api/comics/:id`
- `DELETE /api/comics/:id`

## Notes
- html5-qrcode works best on mobile devices.
- If Comic Vine API is not configured, searches fall back to Open Library.
- If `AUTH_TOKEN` is set, send `Authorization: Bearer <token>` or `X-API-Key` headers.

## Deploy (Render)

1. Create a Render account and connect this repo.
2. Use `render.yaml` at repo root. Render will create:
   - `noir-collect-api` (web service)
   - `noir-collect-db` (PostgreSQL)
3. Set the secrets in the Render dashboard:
   - `COMICVINE_API_KEY`
   - `GOOGLE_BOOKS_API_KEY` (optional)
   - `METRON_USERNAME` / `METRON_PASSWORD` (optional)
   - `AUTH_TOKEN` (optional)
4. After deploy, copy the Render service URL (e.g. `https://noir-collect-api.onrender.com`).
5. In the UI, set **API Base URL** to the Render URL.

Notes:
- GitHub Pages can stay as the frontend; the API lives on Render.
- If the API is asleep, first request may take ~30s on free tier.

### Render migration note
Render will run `npm run migrate` on start to apply `backend/schema.sql` automatically.

## GitHub Pages (Frontend)

1. Build the frontend:
   - `cd /Users/mitchturner/Documents/GitHub/MITCH-COMIC-APP/frontend`
   - `npm install`
   - `npm run build`
2. Deploy the `build/` folder to GitHub Pages (your existing workflow).
3. Set the API base URL in the UI once, or append a query string:
   - `https://YOUR_GH_PAGES_URL/?api=https://YOUR_RENDER_URL`
   - Example: `https://mturner42075-lab.github.io/MST/noir/?api=https://noir-collect-api.onrender.com`

Notes:
- The API base is stored in localStorage after the first set.
- The Render service URL must include https.
