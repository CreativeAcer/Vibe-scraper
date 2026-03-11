# Vibe Scraper — Local Server

An optional local server that gives the Vibe Scraper extension full scraping power: JavaScript rendering, no CORS restrictions, and background processing that survives tab navigation.

## Why use the server?

| Feature | Extension only | Extension + Server |
|---|---|---|
| Static HTML sites | ✅ | ✅ |
| JS-rendered SPAs | ❌ | ✅ (Playwright) |
| Background scraping | ❌ (tab must stay open) | ✅ |
| Proxy support | ❌ | Configurable |
| Large datasets | Limited by browser memory | Streams to disk |

---

## Installation (one-time, no terminal needed after)

The extension can start the server **automatically** once you run the installer once.

### Windows
1. Open the `vibe-scraper-server\` folder in Explorer
2. Double-click **`install.bat`**
3. Restart Chrome

### Mac / Linux
```bash
cd vibe-scraper-server
./install.sh     # or: python3 install.py
```
Then restart Chrome.

The installer:
- Installs Python dependencies (`pip install -r requirements.txt`)
- Installs Playwright's Chromium browser (one-time, ~300 MB)
- Detects your Vibe Scraper extension ID automatically
- Registers a native messaging host so Chrome can launch the server

After that, opening the extension automatically starts the server in the background — no terminal required.

---

## Manual start (no install required)

If you prefer not to run the installer, you can start the server manually each session:

### Windows
Double-click **`start.bat`**

### Mac / Linux
```bash
cd vibe-scraper-server
./start.sh
```

The server starts on **http://localhost:7823**.

---

## Requirements

- Python 3.10 or newer
- pip

---

## Usage

1. Set up a scraping job in the extension as normal (use Smart Picker).
2. Click **"🖥️ Scrape via Server"** instead of "Start Scraping".
3. The extension sends the job config to the server and polls for progress.
4. When complete, a CSV file downloads automatically.

---

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Extension uses this to check if the server is running |
| POST | `/scrape` | Submit a job config, returns `{"job_id": "..."}` |
| GET | `/status/{job_id}` | Poll for progress |
| GET | `/download/{job_id}?format=csv\|json` | Download results |
| DELETE | `/jobs/{job_id}` | Cancel a running job |

---

## Job config format

The server accepts the same JSON format as the extension stores internally:

```json
{
  "startUrl": "https://example.com/products",
  "listing": {
    "itemSelector": ".product-card",
    "fields": [
      { "name": "title",  "selector": ".title", "attr": "text" },
      { "name": "price",  "selector": ".price", "attr": "text" },
      { "name": "url",    "selector": "a",      "attr": "href" }
    ]
  },
  "pagination": {
    "enabled": true,
    "type": "queryParam",
    "param": "page",
    "maxPages": 10,
    "delayMs": 1500
  },
  "export": {
    "format": "csv",
    "filename": "products.csv",
    "includeUtf8Bom": true
  }
}
```

See `../config/example-config.json` for a full example.

---

## How auto-start works

```
Extension popup
    │
    │  chrome.runtime.sendNativeMessage('com.vibescaper.server', {command:'start'})
    ▼
native_host.py  ← Chrome launches this (registered by install.py)
    │
    │  subprocess.Popen([python, 'server.py'], start_new_session=True)
    ▼
server.py  (FastAPI on port 7823, runs independently, survives host exit)
```

`native_host.py` checks `/health` first — it only spawns a new process if the server isn't already running.

---

## Notes

- The server only listens on `127.0.0.1` (localhost). It is not accessible from other machines.
- Job data is stored in memory only — it is lost when the server restarts.
- Stop the server at any time with **Ctrl+C** (if started manually), or kill the `server.py` process.
