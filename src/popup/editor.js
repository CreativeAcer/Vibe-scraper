/**
 * Job editor, Smart Picker, and pagination detection logic.
 */
import { showStatus, showLog } from './ui.js';

// ── Job editor UI ─────────────────────────────────────────────────────────────

export function showJobEditor(currentUrl, state) {
  document.getElementById('no-jobs-message').classList.add('hidden');
  document.getElementById('jobs-list').classList.add('hidden');
  document.getElementById('job-editor').classList.remove('hidden');
  document.getElementById('quick-start-url').value = currentUrl || '';
  document.getElementById('quick-job-id').value = '';
  document.getElementById('quick-fields-preview').classList.add('hidden');
  state.currentFields = [];

  // Default to Button pagination mode
  document.getElementById('pagination-type-toggle').checked = false;
  document.getElementById('pagination-button-group').classList.remove('hidden');
  document.getElementById('pagination-query-group').classList.add('hidden');
  document.getElementById('label-button').classList.add('active');
  document.getElementById('label-query').classList.remove('active');
}

export function hideJobEditor(state) {
  document.getElementById('job-editor').classList.add('hidden');
  state.currentFields = [];
  if (state.jobs.length > 0) {
    document.getElementById('no-jobs-message').classList.add('hidden');
    document.getElementById('jobs-list').classList.remove('hidden');
  } else {
    document.getElementById('no-jobs-message').classList.remove('hidden');
    document.getElementById('jobs-list').classList.add('hidden');
  }
}

// ── Smart Picker ─────────────────────────────────────────────────────────────

export async function activateQuickSmartPicker(state) {
  const jobId = document.getElementById('quick-job-id').value.trim();
  if (!jobId) { alert('Please enter a Job ID first!'); return; }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      alert('Please navigate to the website you want to scrape first, then open the popup again.');
      return;
    }

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/selector-utils.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/smart-picker.js'] });
    await new Promise(r => setTimeout(r, 300));

    await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_SMART_PICKER', skipPanel: true });

    showStatus('✅ Smart Picker active! Click an item on the website.', 'success');
    document.getElementById('picker-status').classList.remove('hidden');

    const pickerBtn = document.getElementById('quick-smart-picker-btn');
    pickerBtn.textContent = '⏳ Waiting...';
    pickerBtn.disabled = true;

    const messageListener = (message) => {
      if (message.type === 'FIELDS_DETECTED') {
        handleQuickPickerResult(message.data, state);
        chrome.runtime.onMessage.removeListener(messageListener);
        pickerBtn.textContent = '🎯 Smart Picker';
        pickerBtn.disabled = false;
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(messageListener);
      pickerBtn.textContent = '🎯 Smart Picker';
      pickerBtn.disabled = false;
    }, 60000);
  } catch (error) {
    showStatus('❌ Error: ' + error.message, 'error');
    const pickerBtn = document.getElementById('quick-smart-picker-btn');
    pickerBtn.textContent = '🎯 Smart Picker';
    pickerBtn.disabled = false;
  }
}

export function handleQuickPickerResult(data, state) {
  state.currentFields = data.fields;
  state._quickJobItemSelector = data.itemSelector;

  document.getElementById('picker-status').classList.add('hidden');

  const preview = document.getElementById('quick-fields-preview');
  const fieldsList = document.getElementById('quick-fields-list');
  preview.classList.remove('hidden');

  fieldsList.innerHTML = `
    <div class="field-item" style="background:#e8f5e9;border-color:#4CAF50;">
      <div class="field-content">
        <div class="field-name">📋 Item Selector</div>
        <div class="field-details">${data.itemSelector}</div>
      </div>
    </div>
  `;

  data.fields.forEach((field, index) => {
    fieldsList.innerHTML += `
      <label class="field-item" for="field-${index}">
        <input type="checkbox" id="field-${index}" data-index="${index}" checked>
        <div class="field-content">
          <div class="field-name">${field.name}</div>
          <div class="field-details">${field.selector} → ${field.attr} (${field.type})</div>
          ${field.preview ? `<div class="field-preview">"${field.preview}"</div>` : ''}
        </div>
      </label>
    `;
  });

  document.getElementById('select-all-fields').onclick = () => {
    document.querySelectorAll('#quick-fields-list input[type="checkbox"]').forEach(cb => cb.checked = true);
  };
  document.getElementById('deselect-all-fields').onclick = () => {
    document.querySelectorAll('#quick-fields-list input[type="checkbox"]').forEach(cb => cb.checked = false);
  };

  document.getElementById('scraping-mode-section').classList.remove('hidden');
  showStatus(`✅ Detected ${data.fields.length} fields! Select what to scrape.`, 'success');
}

// ── Save job ──────────────────────────────────────────────────────────────────

export async function saveQuickJob(state) {
  const jobId    = document.getElementById('quick-job-id').value.trim();
  const startUrl = document.getElementById('quick-start-url').value;

  if (!jobId)                     { alert('Please enter a Job ID!'); return; }
  if (!state.currentFields.length){ alert('Please use Smart Picker to detect fields first!'); return; }

  const checkboxes       = document.querySelectorAll('#quick-fields-list input[type="checkbox"]:checked');
  const selectedIndices  = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
  const selectedFields   = state.currentFields.filter((_, i) => selectedIndices.includes(i));

  if (!selectedFields.length) { alert('Please select at least one field!'); return; }

  const itemSelector  = state._quickJobItemSelector || '.item';
  const scrapingMode  = document.querySelector('input[name="scraping-mode"]:checked').value;

  const jobConfig = {
    jobId,
    startUrl,
    listing: {
      itemSelector,
      fields: selectedFields.map(f => ({
        name: f.name, selector: f.selector, attr: f.attr, type: f.type, required: false,
      })),
    },
    export: { format: 'csv', filename: `${jobId}.csv`, includeUtf8Bom: true },
  };

  if (scrapingMode === 'pagination') {
    const isQueryParam = document.getElementById('pagination-type-toggle').checked;
    jobConfig.pagination = {
      enabled: true,
      type: isQueryParam ? 'queryParam' : 'button',
      maxPages: parseInt(document.getElementById('pagination-max').value) || 10,
      delayMs: 2000,
    };
    if (isQueryParam) {
      jobConfig.pagination.param = document.getElementById('pagination-param').value || 'page';
    } else {
      jobConfig.pagination.nextButtonSelector = document.getElementById('pagination-selector').value || 'a.next';
    }
  } else if (scrapingMode === 'infinite') {
    jobConfig.infiniteScroll = {
      enabled: true,
      maxScrolls: parseInt(document.getElementById('infinite-max').value) || 10,
      delayMs: parseInt(document.getElementById('infinite-delay').value) || 3000,
    };
  } else if (scrapingMode === 'load-more') {
    jobConfig.loadMore = {
      enabled: true,
      buttonSelector: document.getElementById('load-more-selector').value || '.load-more',
      maxClicks: parseInt(document.getElementById('load-more-max').value) || 10,
      delayMs: parseInt(document.getElementById('load-more-delay').value) || 2000,
    };
  }

  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const existingIndex = jobs.findIndex(j => j.jobId === jobId);
  if (existingIndex >= 0) {
    jobs[existingIndex] = jobConfig;
  } else {
    jobs.push(jobConfig);
  }
  await chrome.storage.local.set({ jobs });

  showStatus(`✅ Job saved with ${selectedFields.length} fields!`, 'success');
  return jobConfig;
}

// ── Button detection ──────────────────────────────────────────────────────────

async function activateSingleElementPicker(targetInputId, buttonEl) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/selector-utils.js'] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/smart-picker.js'] });
  await new Promise(r => setTimeout(r, 500));

  buttonEl.textContent = 'Click element...';

  await chrome.tabs.sendMessage(tab.id, {
    type: 'ACTIVATE_SMART_PICKER',
    skipPanel: true,
    singleElement: true,
  });

  return new Promise((resolve, reject) => {
    const listener = (message) => {
      if (message.type === 'ELEMENT_SELECTED') {
        chrome.runtime.onMessage.removeListener(listener);
        document.getElementById(targetInputId).value = message.selector;
        const elementText = message.element?.text?.substring(0, 30) || '';
        showStatus(`✅ Detected: ${message.selector} - "${elementText}"`, 'success');
        resolve(message.selector);
      } else if (message.type === 'SMART_PICKER_CANCELLED') {
        chrome.runtime.onMessage.removeListener(listener);
        showStatus('❌ Detection cancelled', 'error');
        reject(new Error('cancelled'));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); reject(new Error('timeout')); }, 60000);
  });
}

export async function detectNextButton() {
  const button = document.getElementById('detect-next-btn');
  button.textContent = '⏳ Wait...';
  button.disabled = true;
  try {
    await activateSingleElementPicker('pagination-selector', button);
  } catch { /* cancelled or timeout */ }
  button.textContent = '🎯 Detect';
  button.disabled = false;
}

export async function detectLoadMoreButton() {
  const button = document.getElementById('detect-load-more-btn');
  button.textContent = '⏳ Wait...';
  button.disabled = true;
  try {
    await activateSingleElementPicker('load-more-selector', button);
  } catch { /* cancelled or timeout */ }
  button.textContent = '🎯 Detect';
  button.disabled = false;
}

// ── Pagination auto-detect ────────────────────────────────────────────────────

export async function autoDetectPaginationMode() {
  const btn     = document.getElementById('auto-detect-mode-btn');
  const spinner = document.getElementById('detection-spinner');
  const result  = document.getElementById('detection-result');

  btn.disabled = true;
  btn.textContent = 'Detecting…';
  spinner.classList.remove('hidden');
  result.classList.add('hidden');

  let timeoutId;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      showStatus('❌ Cannot detect on this page type', 'error');
      return;
    }

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/selector-utils.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/pagination-detector.js'] });
    await new Promise(r => setTimeout(r, 300));
    await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_PAGINATION_DETECTOR' });

    timeoutId = setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '🔍 Auto-detect mode';
      spinner.classList.add('hidden');
      showStatus('❌ Detection timed out — try again', 'error');
    }, 10000);
  } catch (error) {
    clearTimeout(timeoutId);
    showStatus('❌ Detection failed: ' + error.message, 'error');
    btn.disabled = false;
    btn.textContent = '🔍 Auto-detect mode';
    spinner.classList.add('hidden');
  }
}

export function handlePaginationDetected(detectionResult, error) {
  const btn       = document.getElementById('auto-detect-mode-btn');
  const spinner   = document.getElementById('detection-spinner');
  const resultDiv = document.getElementById('detection-result');

  btn.disabled = false;
  btn.textContent = '🔍 Auto-detect mode';
  spinner.classList.add('hidden');

  if (error || !detectionResult) {
    showStatus('❌ Detection error: ' + (error || 'Unknown'), 'error');
    return;
  }

  window._lastDetectionResult = detectionResult;

  const typeLabels = {
    queryParam:  'Query Parameter Pagination',
    button:      'Button / AJAX Pagination',
    'load-more': 'Load More Button',
    infinite:    'Infinite Scroll',
    single:      'Single Page (no pagination)',
  };

  document.getElementById('detection-type-label').textContent =
    typeLabels[detectionResult.best.type] || detectionResult.best.type;

  const badge  = document.getElementById('detection-confidence-badge');
  badge.textContent = detectionResult.best.confidence;
  const colors = {
    high:   { bg: '#d4edda', color: '#155724' },
    medium: { bg: '#fff3cd', color: '#856404' },
    low:    { bg: '#f8d7da', color: '#721c24' },
  };
  const c = colors[detectionResult.best.confidence] || colors.low;
  badge.style.background = c.bg;
  badge.style.color      = c.color;

  const ev = detectionResult.best.evidence || [];
  document.getElementById('detection-evidence-list').innerHTML =
    ev.length ? ev.map(e => `<div>· ${e}</div>`).join('') : '<div>No specific signals detected</div>';

  resultDiv.classList.remove('hidden');
}

export function applyDetectedConfig(detectionResult) {
  const { config } = detectionResult;
  const type = config.paginationType;

  const radioMap = {
    queryParam:  'pagination',
    button:      'pagination',
    'load-more': 'load-more',
    infinite:    'infinite',
    single:      'single',
  };

  const radio = document.querySelector(`input[name="scraping-mode"][value="${radioMap[type] || 'single'}"]`);
  if (radio) { radio.checked = true; handleScrapingModeChange({ target: radio }); }

  if (type === 'queryParam') {
    const toggle = document.getElementById('pagination-type-toggle');
    toggle.checked = true;
    handlePaginationTypeToggle({ target: toggle });
    if (config.pageParam) document.getElementById('pagination-param').value = config.pageParam;
  } else if (type === 'button') {
    const toggle = document.getElementById('pagination-type-toggle');
    toggle.checked = false;
    handlePaginationTypeToggle({ target: toggle });
    if (config.nextButtonSelector) document.getElementById('pagination-selector').value = config.nextButtonSelector;
  } else if (type === 'load-more') {
    if (config.loadMoreSelector) document.getElementById('load-more-selector').value = config.loadMoreSelector;
  }

  showStatus(`✅ Applied: ${type} mode (${detectionResult.best.confidence} confidence)`, 'success');
}

// ── Scraping mode toggles ─────────────────────────────────────────────────────

export function handleScrapingModeChange(event) {
  const mode = event.target.value;
  document.getElementById('pagination-options').classList.add('hidden');
  document.getElementById('infinite-options').classList.add('hidden');
  document.getElementById('load-more-options').classList.add('hidden');
  if (mode === 'pagination')  document.getElementById('pagination-options').classList.remove('hidden');
  else if (mode === 'infinite')   document.getElementById('infinite-options').classList.remove('hidden');
  else if (mode === 'load-more')  document.getElementById('load-more-options').classList.remove('hidden');
}

export function handlePaginationTypeToggle(event) {
  const isQueryParam = event.target.checked;
  document.getElementById('pagination-button-group').classList.toggle('hidden', isQueryParam);
  document.getElementById('pagination-query-group').classList.toggle('hidden', !isQueryParam);
  document.getElementById('label-button').classList.toggle('active', !isQueryParam);
  document.getElementById('label-query').classList.toggle('active', isQueryParam);
}
