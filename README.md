# Halifax WiFi Tracker

See who's home — at a glance. The app watches your eero network for connected devices, matches them against a registered list of people and their devices, and displays a live visual of who's in the house. Devices can be registered directly from the UI.

## How it works

- The backend polls your eero network and logs presence events to Supabase
- The frontend shows registered people as cards — green when connected, grey when away
- You can register new devices (name + MAC address) from the Settings page

## Stack

- **Backend** — Python stdlib HTTP server + eero API + Supabase
- **Frontend** — React + Vite

## Local setup

Copy the env template and fill in your values:

```bash
cp .env/local.env.example .env/local.env
```

Required variables in `.env/local.env`:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | e.g. `https://your-ref.supabase.co/rest/v1/` |
| `SUPABASE_KEY` | Your Supabase service role key |
| `SUPABASE_TABLE` | Table name, e.g. `Register-Wifi-Devices` |
| `EERO_USER_TOKEN` | Obtained via the `/eero/login` + `/eero/verify` flow |
| `EERO_NETWORK_NAME` | Your eero network name |

## Running locally

Run everything together:

```bash
./dev.sh
```

Or run the two pieces separately:

```bash
# Backend (from repo root)
python3 -m backend.server

# Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and proxies API calls to `http://localhost:8000`.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/devices` | All devices currently on the network |
| `GET` | `/registered-devices` | Devices registered in Supabase |
| `GET` | `/connected` | Intersection — registered devices that are online |
| `POST` | `/registered-devices` | Register a device `{ mac_address, name }` |
| `PATCH` | `/registered-devices` | Update a registered device |
| `GET` | `/logs` | Recent presence log entries |
| `POST` | `/eero/login` | Start eero auth (sends SMS) |
| `POST` | `/eero/verify` | Complete eero auth with OTP |
