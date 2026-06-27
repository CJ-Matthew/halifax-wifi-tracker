# Wifi Scan

This project is split into a small Python backend and a Vite React frontend.

## Structure

- `backend/` - local JSON API and Supabase integration
- `frontend/` - Vite React control panel

## Backend endpoints

- `GET /devices/` returns connected devices from the local network scan
- `POST /registered-devices/` saves `{ mac_address, name }` to Supabase
- `GET /registered-devices/` returns the registered Supabase rows
- `GET /connected/` returns devices that are both connected and registered
- `GET /regsistered-devices/` is accepted as a typo alias for the registered-devices route

## Environment

Use `.env/local.env` for the backend.

Required variables:

- `SUPABASE_URL` - example: `https://your-project-ref.supabase.co/rest/v1/`
- `SUPABASE_KEY` - use your Supabase key
- `SUPABASE_TABLE` - example: `Register-Wifi-Devices`
- `HOST` - optional, defaults to `127.0.0.1`
- `PORT` - optional, defaults to `8000`

## Run the backend

```bash
cd /Users/calebmatthew/home-project/Wifi-Scan
python3 -m backend.server
```

## Run everything together

From the repo root:

```bash
bash dev.sh
```

This starts the backend and frontend together. The frontend refreshes the device lists every 2 minutes automatically.

## Frontend

The frontend is a Vite React app that calls the local backend.

### Frontend scripts

```bash
cd /Users/calebmatthew/home-project/Wifi-Scan/frontend
npm install
npm run dev
```

The dev server proxies API calls to `http://127.0.0.1:8000`.

The control screen refreshes connected and registered devices every 2 minutes.

If you prefer a different backend host or port, set `HOST` and `PORT` in `.env/local.env`.

## Control screen

The frontend shows:

- a left-side tab rail with `Home` and `Settings`
- a blank `Home` page for now
- a `Settings` page with `Register Device`, `Connected`, `Registered Devices`, and `Status`
- a 2-minute refresh cycle for connected and registered device data