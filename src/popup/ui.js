/**
 * Pure DOM helper functions for the Vibe Scraper popup.
 * No business logic — just reads/writes to the DOM.
 */

export function showNoJobsMessage() {
  document.getElementById('no-jobs-message').classList.remove('hidden');
  document.getElementById('jobs-list').classList.add('hidden');
}

export function showJobsList() {
  document.getElementById('no-jobs-message').classList.add('hidden');
  document.getElementById('jobs-list').classList.remove('hidden');
}

export function updateJobDetails(job) {
  document.getElementById('job-url').textContent = job.startUrl;
  updateJobStatus('idle');
}

export function updateJobStatus(status) {
  const el = document.getElementById('job-status');
  el.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  el.className = `value badge ${status}`;
}

export function populateJobSelector(jobs, onChange) {
  const select = document.getElementById('job-select');
  select.innerHTML = '';
  jobs.forEach(job => {
    const option = document.createElement('option');
    option.value = job.jobId;
    option.textContent = job.jobId;
    select.appendChild(option);
  });
  if (jobs.length > 0 && onChange) {
    onChange(jobs[0]);
  }
}

export function updateProgress(progress) {
  document.getElementById('items-count').textContent = progress.itemsScraped || 0;
  document.getElementById('pages-count').textContent = progress.currentPage || 0;
  const percentage = Math.min((progress.itemsScraped / 100) * 100, 100);
  document.getElementById('progress-fill').style.width = `${percentage}%`;
}

export function updateCurrentItem(message) {
  const display = document.getElementById('current-item-display');
  const textEl = document.getElementById('current-item-text');
  if (!display || !textEl) return;
  display.classList.remove('hidden');
  let text = '';
  if (message.pageNumber) text += `Page ${message.pageNumber} - `;
  text += `Item ${message.itemNumber}/${message.totalItems}: `;
  text += message.currentItem || 'Processing...';
  textEl.textContent = text;
}

export function showLog(level, message) {
  const container = document.getElementById('logs-container');
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="log-time">${time}</span>${message}`;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
  while (container.children.length > 50) {
    container.removeChild(container.firstChild);
  }
}

export function clearLogs() {
  document.getElementById('logs-container').innerHTML = '';
}

export function showStatus(message, type) {
  const status = document.createElement('div');
  status.style.cssText = `
    position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
    padding: 10px 15px;
    background: ${type === 'success' ? '#4CAF50' : '#f44336'};
    color: white; border-radius: 4px; font-size: 12px;
    z-index: 10000; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  status.textContent = message;
  document.body.appendChild(status);
  setTimeout(() => status.remove(), 3000);
}

export function startTimer(state) {
  stopTimer(state);
  state.timerInterval = setInterval(() => {
    if (state.startTime) {
      const elapsed = Date.now() - state.startTime;
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      document.getElementById('time-elapsed').textContent =
        `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }, 1000);
}

export function stopTimer(state) {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

export function resetTimerDisplay() {
  const el = document.getElementById('time-elapsed');
  if (el) el.textContent = '0:00';
}

// ── Server status banner ─────────────────────────────────────────────────────

export function showServerBanner(isUp, os) {
  const banner = document.getElementById('server-banner');
  const upEl   = document.getElementById('server-up');
  const downEl = document.getElementById('server-down');
  if (!banner) return;

  banner.classList.remove('hidden');
  if (isUp) {
    upEl.classList.remove('hidden');
    downEl.classList.add('hidden');
  } else {
    upEl.classList.add('hidden');
    downEl.classList.remove('hidden');

    // Pre-select the correct OS panel so it's ready when the user clicks "How to start →"
    if (os) {
      for (const id of ['setup-windows', 'setup-mac', 'setup-linux']) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      }
      const target = document.getElementById(`setup-${os}`);
      if (target) target.classList.remove('hidden');
    }
  }
}

export function showServerScrapeButton(show) {
  const btn = document.getElementById('server-scrape-btn');
  if (!btn) return;
  if (show) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}
