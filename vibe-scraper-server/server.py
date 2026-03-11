"""
Vibe Scraper — local server.

Start with:
    python server.py

Runs on http://localhost:7823
"""

import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from scraper import scrape_job, items_to_csv, items_to_json

# ── In-memory job store ───────────────────────────────────────────────────────

# job_id -> {status, items_scraped, current_page, error, items, config, cancel_event}
_jobs: dict[str, dict] = {}
_jobs_lock = asyncio.Lock()


# ── App setup ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Vibe Scraper server running on http://localhost:7823")
    print("Extension health check: GET /health")
    print("Press Ctrl+C to stop.\n")
    yield

app = FastAPI(title="Vibe Scraper", version="1.0.0", lifespan=lifespan)

# Allow requests from the Chrome extension (chrome-extension://*) and localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.post("/scrape")
async def start_scrape(config: dict[str, Any], background_tasks: BackgroundTasks):
    """Accept a job config (same schema as the extension) and start scraping."""
    if not config.get("startUrl"):
        raise HTTPException(status_code=400, detail="startUrl is required")
    if not config.get("listing", {}).get("itemSelector"):
        raise HTTPException(status_code=400, detail="listing.itemSelector is required")

    job_id = str(uuid.uuid4())[:8]
    cancel_event = asyncio.Event()

    async with _jobs_lock:
        _jobs[job_id] = {
            "status": "running",
            "items_scraped": 0,
            "current_page": 0,
            "error": None,
            "items": [],
            "config": config,
            "cancel_event": cancel_event,
        }

    background_tasks.add_task(_run_scrape, job_id, config, cancel_event)
    return {"job_id": job_id}


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "status":        job["status"],
        "items_scraped": job["items_scraped"],
        "current_page":  job["current_page"],
        "error":         job["error"],
    }


@app.get("/download/{job_id}")
async def download_results(job_id: str, format: str = "csv"):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail=f"Job is not completed (status: {job['status']})")

    items   = job["items"]
    job_id_safe = job_id.replace("/", "_")

    if format == "json":
        data     = items_to_json(items)
        filename = f"scrape-{job_id_safe}.json"
        media    = "application/json"
    else:
        bom  = job["config"].get("export", {}).get("includeUtf8Bom", True)
        data = items_to_csv(items, include_bom=bom)
        filename = job["config"].get("export", {}).get("filename") or f"scrape-{job_id_safe}.csv"
        media    = "text/csv; charset=utf-8"

    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job["cancel_event"].set()
    async with _jobs_lock:
        if _jobs[job_id]["status"] == "running":
            _jobs[job_id]["status"] = "cancelled"
    return {"cancelled": True}


# ── Background task ───────────────────────────────────────────────────────────

async def _run_scrape(job_id: str, config: dict, cancel_event: asyncio.Event):
    async def on_progress(progress: dict):
        if cancel_event.is_set():
            raise asyncio.CancelledError("Job was cancelled")
        async with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["items_scraped"] = progress["items_scraped"]
                _jobs[job_id]["current_page"]  = progress["current_page"]

    try:
        items = await scrape_job(config, on_progress=on_progress)
        async with _jobs_lock:
            _jobs[job_id]["items"]         = items
            _jobs[job_id]["items_scraped"] = len(items)
            _jobs[job_id]["status"]        = "completed"
    except asyncio.CancelledError:
        async with _jobs_lock:
            _jobs[job_id]["status"] = "cancelled"
    except Exception as exc:
        async with _jobs_lock:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"]  = str(exc)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7823, log_level="info")
