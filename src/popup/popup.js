/**
 * Vibe Scraper — popup entry point.
 * Wires event listeners and the global message listener.
 * Business logic lives in the imported modules.
 */
import { state } from './state.js';
import { showNoJobsMessage, showJobsList, updateJobDetails, updateJobStatus,
         populateJobSelector, updateProgress, updateCurrentItem,
         showLog, clearLogs } from './ui.js';
import { checkServerStatus, startScraping, stopScraping,
         handleScrapingCompleted, handleScrapingFailed,
         startServerScraping } from './scraping.js';
import { showJobEditor, hideJobEditor, activateQuickSmartPicker,
         handleQuickPickerResult, saveQuickJob, detectNextButton,
         detectLoadMoreButton, autoDetectPaginationMode,
         handlePaginationDetected, applyDetectedConfig,
         handleScrapingModeChange, handlePaginationTypeToggle } from './editor.js';

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadJobs();
  checkServerStatus(state);  // async — updates banner when resolved
  setupEventListeners();
  setupMessageListener();
  setupStatusPoller();
});

// ── Job loading ───────────────────────────────────────────────────────────────

async function loadJobs() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_JOBS' });
  if (response.success) {
    state.jobs = response.jobs;
    if (state.jobs.length === 0) {
      showNoJobsMessage();
    } else {
      showJobsList();
      populateJobSelector(state.jobs, (firstJob) => {
        state.currentJobId = firstJob.jobId;
        updateJobDetails(firstJob);
      });
    }
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
  document.getElementById('open-options').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
  });

  document.getElementById('create-job-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    showJobEditor(tab.url, state);
  });

  document.getElementById('create-new-job-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    showJobEditor(tab.url, state);
  });

  document.getElementById('close-job-editor').addEventListener('click', () => hideJobEditor(state));

  document.getElementById('quick-smart-picker-btn').addEventListener('click', () => activateQuickSmartPicker(state));

  document.getElementById('save-quick-job-btn').addEventListener('click', async () => {
    const jobConfig = await saveQuickJob(state);
    if (jobConfig) {
      setTimeout(async () => {
        hideJobEditor(state);
        await loadJobs();
      }, 1500);
    }
  });

  document.getElementById('job-select').addEventListener('change', (e) => {
    state.currentJobId = e.target.value;
    const job = state.jobs.find(j => j.jobId === state.currentJobId);
    if (job) updateJobDetails(job);
  });

  document.getElementById('start-btn').addEventListener('click', () => startScraping(state));
  document.getElementById('stop-btn').addEventListener('click', () => stopScraping(state));
  document.getElementById('clear-logs-btn').addEventListener('click', clearLogs);

  document.getElementById('detect-next-btn').addEventListener('click', detectNextButton);
  document.getElementById('detect-load-more-btn').addEventListener('click', detectLoadMoreButton);
  document.getElementById('auto-detect-mode-btn').addEventListener('click', autoDetectPaginationMode);
  document.getElementById('apply-detection-btn').addEventListener('click', () => {
    if (window._lastDetectionResult) applyDetectedConfig(window._lastDetectionResult);
  });

  document.querySelectorAll('input[name="scraping-mode"]').forEach(radio => {
    radio.addEventListener('change', handleScrapingModeChange);
  });
  document.getElementById('pagination-type-toggle').addEventListener('change', handlePaginationTypeToggle);

  // Server scrape button
  document.getElementById('server-scrape-btn').addEventListener('click', () => startServerScraping(state));

  // Server help toggle
  document.getElementById('server-help-btn').addEventListener('click', () => {
    document.getElementById('server-help').classList.remove('hidden');
  });
  document.getElementById('server-help-close').addEventListener('click', () => {
    document.getElementById('server-help').classList.add('hidden');
  });
}

// ── Global message listener ───────────────────────────────────────────────────

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'JOB_PROGRESS_UPDATE' && message.jobId === state.currentJobId) {
      updateProgress(message.progress);
      const statusEl = document.getElementById('job-status');
      if (statusEl && statusEl.textContent !== 'Running') {
        statusEl.textContent = 'Running';
        statusEl.className = 'value badge running';
      }
    } else if (message.type === 'CURRENT_ITEM_UPDATE' && message.jobId === state.currentJobId) {
      updateCurrentItem(message);
    } else if (message.type === 'SCRAPING_COMPLETED' && message.jobId === state.currentJobId) {
      handleScrapingCompleted(message.result, state);
    } else if (message.type === 'SCRAPING_FAILED' && message.jobId === state.currentJobId) {
      handleScrapingFailed(message.error, state);
    } else if (message.type === 'LOG_ENTRY' && message.log.jobId === state.currentJobId) {
      showLog(message.log.level, message.log.message);
    } else if (message.type === 'JOB_DELETED') {
      if (message.jobId === state.currentJobId) state.currentJobId = null;
      loadJobs();
    } else if (message.type === 'OPEN_JOB_EDITOR') {
      showJobEditor(null, state);
    } else if (message.type === 'PAGINATION_DETECTED') {
      handlePaginationDetected(message.result, message.error);
    }
    return true;
  });
}

// ── Status poller ─────────────────────────────────────────────────────────────

function setupStatusPoller() {
  setInterval(async () => {
    if (!state.currentJobId) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_JOB_STATUS',
        jobId: state.currentJobId,
      });
      if (response.success && response.status?.status === 'running') {
        const statusEl = document.getElementById('job-status');
        if (statusEl && statusEl.textContent !== 'Running') {
          statusEl.textContent = 'Running';
          statusEl.className = 'value badge running';
        }
        if (response.status.progress) updateProgress(response.status.progress);
      }
    } catch { /* ignore polling errors */ }
  }, 1000);
}
