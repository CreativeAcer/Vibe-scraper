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

## Requirements

- Python 3.10 or newer
- pip

## Setup

```bash
# 1. Navigate to the server directory
cd vibe-scraper-server

# 2. Install dependencies (one-time)
pip install -r requirements.txt

# 3. Install Playwright's browser binaries (one-time, ~300 MB)
playwright install chromium

# 4. Start the server
python server.py
```

The server starts on **http://localhost:7823**.

Open the Vibe Scraper extension — you should see a green **"Local server connected"** indicator. If it shows orange, make sure the server is running.

## Usage

1. Set up a scraping job in the extension as normal (use Smart Picker).
2. Click **"🖥️ Scrape via Server"** instead of "Start Scraping".
3. The extension sends the job config to the server and polls for progress.
4. When complete, a CSV file downloads automatically.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Extension uses this to check if the server is running |
| POST | `/scrape` | Submit a job config, returns `{"job_id": "..."}` |
| GET | `/status/{job_id}` | Poll for progress |
| GET | `/download/{job_id}?format=csv\|json` | Download results |
| DELETE | `/jobs/{job_id}` | Cancel a running job |

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

## Notes

- The server only listens on `127.0.0.1` (localhost). It is not accessible from other machines.
- Job data is stored in memory only — it is lost when the server restarts.
- Stop the server at any time with **Ctrl+C**.
