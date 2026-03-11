/**
 * Browser-side scraping controls — start, stop, progress, completion.
 * Also handles "Scrape via Server" job submission and polling.
 */
import { showLog, showStatus, updateJobStatus, updateProgress, updateCurrentItem,
         startTimer, stopTimer, showServerBanner, showServerScrapeButton } from './ui.js';

const SERVER_URL = 'http://localhost:7823';

// ── Server health check ───────────────────────────────────────────────────────

export async function checkServerStatus(state) {
  // 1. Already running? Show green immediately.
  if (await pingServer()) {
    state.serverUp = true;
    showServerBanner(true);
    showServerScrapeButton(true);
    return;
  }

  // 2. Try to auto-start via native messaging (requires one-time install.py run).
  try {
    await sendNativeMessage({ command: 'start' });
    // Poll up to 4 s for the server process to bind the port.
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await pingServer()) {
        state.serverUp = true;
        showServerBanner(true);
        showServerScrapeButton(true);
        return;
      }
    }
  } catch {
    // Native host not installed — fall through to show setup instructions.
  }

  state.serverUp = false;
  showServerBanner(false, detectOS());
  showServerScrapeButton(false);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendNativeMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage('com.vibescaper.server', msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp);
      }
    });
  });
}

async function pingServer() {
  try {
    const r = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function detectOS() {
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'mac';
  return 'linux';
}

// ── Browser scraping ──────────────────────────────────────────────────────────

export async function startScraping(state) {
  if (!state.currentJobId) { showLog('error', 'No job selected'); return; }

  const job = state.jobs.find(j => j.jobId === state.currentJobId);
  if (!job) { showLog('error', 'Job not found'); return; }

  const startBtn = document.getElementById('start-btn');
  startBtn.disabled = true;
  startBtn.textContent = '⏳ Starting...';
  state._scrapingCompleteHandled = false;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showLog('error', 'No active tab found'); return; }

    const jobUrl     = new URL(job.startUrl);
    const currentUrl = new URL(tab.url);

    if (jobUrl.href !== currentUrl.href && jobUrl.origin !== currentUrl.origin) {
      showLog('error', `Please navigate to: ${job.startUrl}`);
      showLog('info', 'Then click "Start Scraping" again.');
      if (confirm(`This job scrapes:\n${job.startUrl}\n\nOpen it in a new tab?`)) {
        await chrome.tabs.create({ url: job.startUrl });
      }
      startBtn.disabled = false;
      startBtn.textContent = 'Start Scraping';
      return;
    }

    if (jobUrl.href !== currentUrl.href && jobUrl.origin === currentUrl.origin) {
      showLog('info', `Navigating to ${job.startUrl}...`);
      await chrome.tabs.update(tab.id, { url: job.startUrl });
      await new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
      await new Promise(r => setTimeout(r, 1000));
    }

    const response = await chrome.runtime.sendMessage({ type: 'START_SCRAPING', config: job });

    if (response.success) {
      const statusEl = document.getElementById('job-status');
      statusEl.textContent = 'Running';
      statusEl.className = 'value badge running';

      const stopBtn = document.getElementById('stop-btn');
      startBtn.classList.add('hidden');
      startBtn.style.display = 'none';
      stopBtn.classList.remove('hidden');
      stopBtn.style.display = '';

      document.getElementById('progress-section').classList.remove('hidden');

      const currentItemDisplay = document.getElementById('current-item-display');
      if (currentItemDisplay) {
        currentItemDisplay.classList.remove('hidden');
        document.getElementById('current-item-text').textContent = 'Initializing scraper...';
      }

      state.startTime = Date.now();
      startTimer(state);
      showLog('info', '🚀 Scraping started');
    } else {
      showLog('error', `Failed to start: ${response.error}`);
      startBtn.disabled = false;
      startBtn.textContent = 'Start Scraping';
    }
  } catch (error) {
    showLog('error', `Error: ${error.message}`);
    startBtn.disabled = false;
    startBtn.textContent = 'Start Scraping';
  }
}

export async function stopScraping(state) {
  if (!state.currentJobId) return;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'STOP_SCRAPING',
      jobId: state.currentJobId,
    });
    if (response.success) {
      updateJobStatus('stopped');
      document.getElementById('start-btn').classList.remove('hidden');
      document.getElementById('stop-btn').classList.add('hidden');
      stopTimer(state);
      showLog('info', 'Scraping stopped');
    }
  } catch (error) {
    showLog('error', `Error stopping: ${error.message}`);
  }
}

export function handleScrapingCompleted(result, state) {
  if (state._scrapingCompleteHandled) return;
  state._scrapingCompleteHandled = true;

  setTimeout(() => {
    const statusEl = document.getElementById('job-status');
    if (statusEl) { statusEl.textContent = 'Completed'; statusEl.className = 'value badge completed'; }

    const startBtn = document.getElementById('start-btn');
    const stopBtn  = document.getElementById('stop-btn');
    if (startBtn) { startBtn.classList.remove('hidden'); startBtn.style.display = ''; startBtn.disabled = false; startBtn.textContent = 'Start Scraping'; }
    if (stopBtn)  { stopBtn.classList.add('hidden'); stopBtn.style.display = 'none'; }

    const progressSection = document.getElementById('progress-section');
    if (progressSection) progressSection.classList.add('hidden');

    const currentItemDisplay = document.getElementById('current-item-display');
    if (currentItemDisplay) currentItemDisplay.classList.add('hidden');

    stopTimer(state);
  }, 100);

  const itemCount = result.itemsScraped || result.items?.length || 0;
  showLog('success', `✅ Scraping completed! ${itemCount} items scraped.`);
}

export function handleScrapingFailed(error, state) {
  updateJobStatus('failed');

  const startBtn = document.getElementById('start-btn');
  const stopBtn  = document.getElementById('stop-btn');
  if (startBtn) { startBtn.classList.remove('hidden'); startBtn.disabled = false; startBtn.textContent = 'Start Scraping'; }
  if (stopBtn)  { stopBtn.classList.add('hidden'); }

  document.getElementById('progress-section').classList.add('hidden');
  stopTimer(state);
  showLog('error', `❌ Scraping failed: ${error}`);
}

// ── Server scraping ───────────────────────────────────────────────────────────

/**
 * Collect all cookies for the job's start URL and return them as a header string.
 * This lets the server make authenticated requests on behalf of the user's session.
 */
async function collectCookiesForJob(startUrl) {
  try {
    const cookies = await chrome.cookies.getAll({ url: startUrl });
    if (!cookies.length) return null;
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    return null;  // cookies permission missing or URL invalid — scrape unauthenticated
  }
}

export async function startServerScraping(state) {
  if (!state.currentJobId) { showLog('error', 'No job selected'); return; }

  const job = state.jobs.find(j => j.jobId === state.currentJobId);
  if (!job) { showLog('error', 'Job not found'); return; }

  const serverBtn = document.getElementById('server-scrape-btn');
  serverBtn.disabled = true;
  serverBtn.textContent = '⏳ Sending to server...';

  try {
    // Attach session cookies so the server can scrape authenticated pages
    const cookieHeader = await collectCookiesForJob(job.startUrl);
    const payload = cookieHeader
      ? { ...job, _sessionCookies: cookieHeader }
      : job;

    const resp = await fetch(`${SERVER_URL}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || 'Server error');
    }

    const { job_id: serverId } = await resp.json();
    showLog('info', `🖥️ Server job started (id: ${serverId})`);

    // Show progress UI
    document.getElementById('progress-section').classList.remove('hidden');
    const statusEl = document.getElementById('job-status');
    statusEl.textContent = 'Running';
    statusEl.className = 'value badge running';
    state.startTime = Date.now();
    startTimer(state);

    // Poll for status
    await pollServerJob(serverId, state);
  } catch (error) {
    showLog('error', `Server error: ${error.message}`);
    if (!state.serverUp) {
      showLog('info', 'Is the server running? See the banner above for setup instructions.');
    }
  } finally {
    serverBtn.disabled = false;
    serverBtn.textContent = '🖥️ Scrape via Server';
  }
}

async function pollServerJob(serverId, state) {
  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const resp = await fetch(`${SERVER_URL}/status/${serverId}`);
      if (!resp.ok) break;
      const status = await resp.json();

      updateProgress({ itemsScraped: status.items_scraped, currentPage: status.current_page });

      if (status.status === 'completed') {
        showLog('success', `✅ Server scrape complete! ${status.items_scraped} items — downloading...`);
        document.getElementById('job-status').textContent = 'Completed';
        document.getElementById('job-status').className = 'value badge completed';
        document.getElementById('progress-section').classList.add('hidden');
        stopTimer(state);
        window.open(`${SERVER_URL}/download/${serverId}?format=csv`, '_blank');
        return;
      }

      if (status.status === 'failed') {
        showLog('error', `❌ Server scrape failed: ${status.error}`);
        document.getElementById('job-status').className = 'value badge failed';
        document.getElementById('progress-section').classList.add('hidden');
        stopTimer(state);
        return;
      }

      if (status.status === 'cancelled') {
        showLog('info', 'Server job was cancelled.');
        stopTimer(state);
        return;
      }
    } catch {
      showLog('error', 'Lost connection to server during scrape.');
      stopTimer(state);
      return;
    }
  }
}
