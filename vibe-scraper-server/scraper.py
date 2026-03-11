"""
Vibe Scraper — scraping engine.

Routing logic:
  1. Fetch the URL with httpx (fast, no JS).
  2. If the response body has very little visible text (< 200 chars), the site
     likely renders content with JavaScript — fall back to Playwright.
  3. Extract items using CSS selectors, matching the extension's field config.

Supported pagination: single-page and query-parameter (loops fetches).
Playwright is only launched when needed (lazy import).
"""

import asyncio
import csv
import io
import json
import re
from typing import Any, Callable, Coroutine

import httpx
from bs4 import BeautifulSoup, Tag


# ── Field extraction ──────────────────────────────────────────────────────────

def _extract_field(item: Tag, field: dict, base_url: str) -> str:
    """Extract a single field value from a BeautifulSoup element."""
    selector = field.get("selector", "")
    attr     = field.get("attr", "text")

    try:
        el = item.select_one(selector) if selector else item
    except Exception:
        el = None

    if el is None:
        return ""

    if attr == "text":
        return el.get_text(separator=" ", strip=True)
    if attr == "html":
        return str(el)
    if attr in ("href", "src"):
        value = el.get(attr, "")
        if value and not value.startswith(("http://", "https://", "//", "data:", "javascript:")):
            # Resolve relative URL
            from urllib.parse import urljoin
            value = urljoin(base_url, value)
        return value or ""
    return el.get(attr, "") or ""


def extract_items(html: str, config: dict, base_url: str) -> list[dict]:
    """Parse HTML and extract all items matching the job config."""
    soup   = BeautifulSoup(html, "html.parser")
    fields = config.get("listing", {}).get("fields", [])
    item_selector = config.get("listing", {}).get("itemSelector", "")

    if not item_selector:
        return []

    try:
        elements = soup.select(item_selector)
    except Exception:
        return []

    items = []
    for el in elements:
        row = {}
        for field in fields:
            row[field["name"]] = _extract_field(el, field, base_url)
        items.append(row)
    return items


# ── Static scraping (httpx + BeautifulSoup) ───────────────────────────────────

async def _fetch_static(url: str, client: httpx.AsyncClient) -> str:
    resp = await client.get(url, follow_redirects=True, timeout=20)
    resp.raise_for_status()
    return resp.text


def _looks_dynamic(html: str) -> bool:
    """Return True if the page appears to be a JS-rendered SPA with little static content."""
    soup = BeautifulSoup(html, "html.parser")
    # Remove script/style tags before counting text
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    visible_text = soup.get_text(separator=" ", strip=True)
    return len(visible_text) < 200


# ── Dynamic scraping (Playwright) ────────────────────────────────────────────

async def _fetch_dynamic(url: str, cookie_header: str | None = None) -> str:
    """Render the page with a headless Chromium browser and return its HTML."""
    from playwright.async_api import async_playwright  # lazy import

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()

        if cookie_header:
            # Parse "name=value; name2=value2" into Playwright cookie objects
            from urllib.parse import urlparse
            parsed = urlparse(url)
            domain = parsed.hostname or ""
            cookies = []
            for part in cookie_header.split(";"):
                part = part.strip()
                if "=" in part:
                    name, _, value = part.partition("=")
                    cookies.append({"name": name.strip(), "value": value.strip(),
                                    "domain": domain, "path": "/"})
            if cookies:
                await context.add_cookies(cookies)

        page = await context.new_page()
        await page.goto(url, wait_until="networkidle", timeout=30_000)
        html = await page.content()
        await browser.close()
    return html


# ── Pagination helpers ────────────────────────────────────────────────────────

def _build_page_url(base_url: str, param: str, page_number: int) -> str:
    from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
    parsed = urlparse(base_url)
    query  = parse_qs(parsed.query, keep_blank_values=True)
    query[param] = [str(page_number)]
    new_query = urlencode({k: v[0] for k, v in query.items()})
    return urlunparse(parsed._replace(query=new_query))


# ── Main scrape entry ─────────────────────────────────────────────────────────

async def scrape_job(
    config: dict,
    on_progress: Callable[[dict], Coroutine] | None = None,
) -> list[dict]:
    """
    Run a full scrape job and return all extracted items.

    config follows the same schema as the extension job config.
    on_progress is an optional async callback called after each page:
        await on_progress({"items_scraped": N, "current_page": N})
    """
    start_url     = config.get("startUrl", "")
    pagination    = config.get("pagination", {})
    max_pages     = pagination.get("maxPages", 1) if pagination.get("enabled") else 1
    delay_ms      = pagination.get("delayMs", 1500)
    pg_type       = pagination.get("type", "single")
    pg_param      = pagination.get("param", "page")
    cookie_header = config.get("_sessionCookies")  # forwarded from the browser by the extension

    all_items: list[dict] = []

    base_headers: dict = {"User-Agent": "Mozilla/5.0 (compatible; VibeScraper/1.0)"}
    if cookie_header:
        base_headers["Cookie"] = cookie_header

    async with httpx.AsyncClient(
        headers=base_headers,
        follow_redirects=True,
    ) as client:

        for page_num in range(1, max_pages + 1):
            if pg_type == "queryParam" and page_num > 1:
                url = _build_page_url(start_url, pg_param, page_num)
            else:
                url = start_url

            # Fetch — try static first, fall back to Playwright if JS-heavy
            try:
                html = await _fetch_static(url, client)
            except Exception as e:
                raise RuntimeError(f"Failed to fetch {url}: {e}") from e

            if _looks_dynamic(html):
                html = await _fetch_dynamic(url, cookie_header=cookie_header)

            items = extract_items(html, config, url)

            if not items:
                break  # No items found — stop paginating

            all_items.extend(items)

            if on_progress:
                await on_progress({
                    "items_scraped": len(all_items),
                    "current_page": page_num,
                })

            # Respect rate-limit delay between pages (not after the last one)
            if page_num < max_pages and pg_type == "queryParam":
                await asyncio.sleep(delay_ms / 1000)

    return all_items


# ── Export helpers ────────────────────────────────────────────────────────────

def items_to_csv(items: list[dict], include_bom: bool = True) -> bytes:
    """Serialise items to UTF-8 CSV bytes (with optional BOM for Excel)."""
    if not items:
        return b""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(items[0].keys()), lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(items)
    csv_str = output.getvalue()
    prefix  = "\ufeff" if include_bom else ""
    return (prefix + csv_str).encode("utf-8")


def items_to_json(items: list[dict]) -> bytes:
    return json.dumps(items, ensure_ascii=False, indent=2).encode("utf-8")
