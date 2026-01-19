// Options page JavaScript
let jobs = [];
let currentEditingJob = null;

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupEventListeners();
  loadJobs();
  loadSettings();
  // Note: loadPermissions() removed - we now use activeTab (see Permissions tab for explanation)
  
  // Check if we should auto-open job editor
  if (window.location.hash === '#new-job') {
    // Wait a bit for jobs to load
    setTimeout(() => {
      showJobEditor();
      // Remove hash from URL
      history.replaceState(null, null, ' ');
    }, 100);
  }
});

function setupTabs() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`${tab}-tab`).classList.add('active');
}

function setupEventListeners() {
  document.getElementById('new-job-btn').addEventListener('click', openSidebarForNewJob);
  document.getElementById('close-editor-btn').addEventListener('click', hideJobEditor);
  document.getElementById('job-form').addEventListener('submit', saveJob);
  document.getElementById('add-field-btn').addEventListener('click', addFieldRow);
  document.getElementById('smart-picker-btn').addEventListener('click', activateSmartPicker);
  document.getElementById('enable-pagination').addEventListener('change', togglePaginationSettings);
  document.getElementById('enable-infinite-scroll').addEventListener('change', toggleScrollSettings);
  document.getElementById('enable-load-more').addEventListener('change', toggleLoadMoreSettings);
  document.getElementById('pagination-type').addEventListener('change', updatePaginationTypeFields);
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('export-format').addEventListener('change', updateExportFormatFields);
  
  // Mode selector radio buttons
  document.querySelectorAll('input[name="scraping-mode"]').forEach(radio => {
    radio.addEventListener('change', handleModeChange);
  });
  
  // Note: Removed add-permission-btn as we now use activeTab (no manual permissions needed)
}

async function loadJobs() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_JOBS' });
  if (response.success) {
    jobs = response.jobs;
    renderJobs();
  }
}

function renderJobs() {
  const container = document.getElementById('jobs-list');
  container.innerHTML = '';
  
  jobs.forEach(job => {
    const card = createJobCard(job);
    container.appendChild(card);
  });
}

function createJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job-card';
  card.innerHTML = `
    <h3>${job.jobId}</h3>
    <p>${job.startUrl}</p>
    <div class="job-card-actions">
      <button class="secondary-btn edit-job-btn">Edit</button>
      <button class="secondary-btn delete-job-btn" style="color: #f44336; border-color: #f44336;">Delete</button>
    </div>
  `;
  
  card.querySelector('.edit-job-btn').addEventListener('click', () => editJob(job));
  card.querySelector('.delete-job-btn').addEventListener('click', () => deleteJob(job.jobId));
  
  return card;
}

function handleModeChange(e) {
  const mode = e.target.value;
  
  // Uncheck all mode checkboxes first
  document.getElementById('enable-pagination').checked = false;
  document.getElementById('enable-infinite-scroll').checked = false;
  document.getElementById('enable-load-more').checked = false;
  
  // Hide all settings
  document.getElementById('pagination-settings').classList.add('hidden');
  document.getElementById('scroll-settings').classList.add('hidden');
  document.getElementById('load-more-settings').classList.add('hidden');
  
  // Enable the selected mode
  if (mode === 'pagination') {
    document.getElementById('enable-pagination').checked = true;
    togglePaginationSettings();
  } else if (mode === 'infinite-scroll') {
    document.getElementById('enable-infinite-scroll').checked = true;
    toggleScrollSettings();
  } else if (mode === 'load-more') {
    document.getElementById('enable-load-more').checked = true;
    toggleLoadMoreSettings();
  }
  // 'single' mode doesn't need any settings
}

async function openSidebarForNewJob() {
  console.log('🚀 Opening sidebar for new job creation');
  
  try {
    // Get active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tabs.length === 0) {
      alert('No active tab found. Please navigate to the website where you want to scrape first.');
      return;
    }
    
    const tab = tabs[0];
    
    // Open sidebar on the active tab
    await chrome.sidePanel.open({ tabId: tab.id });
    
    // Send message to sidebar to start new job creation
    setTimeout(async () => {
      try {
        await chrome.runtime.sendMessage({
          type: 'OPEN_JOB_EDITOR',
          tabId: tab.id
        });
      } catch (error) {
        console.log('Sidebar will handle new job creation on open');
      }
    }, 500);
    
    // Show notification
    showNotification('✅ Opening sidebar for new job creation...');
    
  } catch (error) {
    console.error('❌ Error opening sidebar:', error);
    alert('Error opening sidebar: ' + error.message);
  }
}

function showJobEditor(job = null) {
  document.getElementById('jobs-list').classList.add('hidden');
  document.getElementById('job-editor').classList.remove('hidden');
  
  if (job) {
    currentEditingJob = job;
    populateJobForm(job);
    document.getElementById('editor-title').textContent = `Edit Job: ${job.jobId}`;
  } else {
    currentEditingJob = null;
    document.getElementById('job-form').reset();
    document.getElementById('editor-title').textContent = 'New Job';
    document.getElementById('fields-list').innerHTML = '';
    addFieldRow();
  }
}

function hideJobEditor() {
  document.getElementById('jobs-list').classList.remove('hidden');
  document.getElementById('job-editor').classList.add('hidden');
  currentEditingJob = null;
}

function editJob(job) {
  showJobEditor(job);
}

async function deleteJob(jobId) {
  if (!confirm(`Are you sure you want to delete job "${jobId}"?\n\nThis action cannot be undone.`)) {
    return;
  }
  
  console.log('🗑️ Deleting job:', jobId);

  try {
    const response = await chrome.runtime.sendMessage({ 
      type: 'DELETE_JOB_CONFIG', 
      jobId 
    });

    if (response && response.success) {
      console.log('✅ Job deleted successfully');
      showNotification('✅ Job deleted successfully');
      await loadJobs();
    } else {
      console.error('❌ Failed to delete job:', response?.error);
      showNotification('❌ Failed to delete job: ' + (response?.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('❌ Error deleting job:', error);
    showNotification('❌ Error deleting job: ' + error.message);
  }
}

function populateJobForm(job) {
  document.getElementById('job-id').value = job.jobId;
  document.getElementById('start-url').value = job.startUrl;
  
  // Determine which mode is active and set radio button
  let activeMode = 'single'; // default
  
  if (job.pagination) {
    activeMode = 'pagination';
    document.getElementById('enable-pagination').checked = true;
    document.getElementById('pagination-type').value = job.pagination.type;
    document.getElementById('pagination-param').value = job.pagination.param || 'page';
    document.getElementById('max-pages').value = job.pagination.maxPages || 10;
    document.getElementById('stop-on-no-items').checked = job.pagination.stopOnNoNewItems;
    togglePaginationSettings();
  }
  
  if (job.infiniteScroll?.enabled) {
    activeMode = 'infinite-scroll';
    document.getElementById('enable-infinite-scroll').checked = true;
    document.getElementById('max-scrolls').value = job.infiniteScroll.maxScrolls || 20;
    toggleScrollSettings();
  }
  
  if (job.loadMore?.enabled) {
    activeMode = 'load-more';
    document.getElementById('enable-load-more').checked = true;
    document.getElementById('load-more-button-selector').value = job.loadMore.buttonSelector || '';
    document.getElementById('max-load-more-clicks').value = job.loadMore.maxClicks || 10;
    document.getElementById('load-more-delay').value = job.loadMore.delayMs || 2000;
    toggleLoadMoreSettings();
  }
  
  // Set the correct radio button
  const radioButton = document.getElementById(`mode-${activeMode}`);
  if (radioButton) {
    radioButton.checked = true;
  }
  
  document.getElementById('item-selector').value = job.listing?.itemSelector || '';
  
  document.getElementById('fields-list').innerHTML = '';
  if (job.listing?.fields) {
    job.listing.fields.forEach(field => addFieldRow(field));
  }
  
  if (job.delays?.perActionMs) {
    document.getElementById('delay-min').value = job.delays.perActionMs.min;
    document.getElementById('delay-max').value = job.delays.perActionMs.max;
  }
  
  if (job.export) {
    document.getElementById('export-format').value = job.export.format || 'csv';
    document.getElementById('export-filename').value = job.export.filename || '';
    document.getElementById('csv-bom').checked = job.export.bom !== false;
  }
  
  if (job.compliance) {
    document.getElementById('require-consent').checked = job.compliance.requireUserConsentPerHost;
  }
}

function addFieldRow(fieldData = null) {
  const template = document.getElementById('field-template');
  const fieldItem = template.querySelector('.field-item').cloneNode(true);
  
  if (fieldData) {
    fieldItem.querySelector('.field-name').value = fieldData.name;
    fieldItem.querySelector('.field-selector').value = fieldData.selector;
    fieldItem.querySelector('.field-attr').value = fieldData.attr || 'text';
    fieldItem.querySelector('.field-type').value = fieldData.type || 'string';
    fieldItem.querySelector('.field-required').checked = fieldData.required || false;
  }
  
  const fieldsList = document.getElementById('fields-list');
  fieldsList.appendChild(fieldItem);
  updateFieldNumbers();
  
  fieldItem.querySelector('.remove-field-btn').addEventListener('click', () => {
    fieldItem.remove();
    updateFieldNumbers();
  });
}

function updateFieldNumbers() {
  const fields = document.querySelectorAll('.field-item');
  fields.forEach((field, index) => {
    field.querySelector('.field-number').textContent = `Field ${index + 1}`;
  });
}

function togglePaginationSettings() {
  const enabled = document.getElementById('enable-pagination').checked;
  const settings = document.getElementById('pagination-settings');
  if (enabled) {
    settings.classList.remove('hidden');
    updatePaginationTypeFields();
  } else {
    settings.classList.add('hidden');
  }
}

function toggleScrollSettings() {
  const enabled = document.getElementById('enable-infinite-scroll').checked;
  const settings = document.getElementById('scroll-settings');
  settings.classList.toggle('hidden', !enabled);
}

function toggleLoadMoreSettings() {
  const enabled = document.getElementById('enable-load-more').checked;
  const settings = document.getElementById('load-more-settings');
  settings.classList.toggle('hidden', !enabled);
}

function updatePaginationTypeFields() {
  const type = document.getElementById('pagination-type').value;
  document.getElementById('query-param-group').classList.toggle('hidden', type !== 'queryParam');
  document.getElementById('button-selector-group').classList.toggle('hidden', type !== 'button');
}

function updateExportFormatFields() {
  const format = document.getElementById('export-format').value;
  document.getElementById('csv-bom-group').classList.toggle('hidden', format !== 'csv');
}

async function saveJob(e) {
  e.preventDefault();
  
  const fields = Array.from(document.querySelectorAll('.field-item')).map(field => ({
    name: field.querySelector('.field-name').value,
    selector: field.querySelector('.field-selector').value,
    attr: field.querySelector('.field-attr').value,
    type: field.querySelector('.field-type').value,
    required: field.querySelector('.field-required').checked
  }));
  
  const config = {
    jobId: document.getElementById('job-id').value,
    startUrl: document.getElementById('start-url').value,
    listing: {
      itemSelector: document.getElementById('item-selector').value,
      fields: fields
    },
    delays: {
      perActionMs: {
        min: parseInt(document.getElementById('delay-min').value),
        max: parseInt(document.getElementById('delay-max').value)
      }
    },
    export: {
      format: document.getElementById('export-format').value,
      filename: document.getElementById('export-filename').value || `scrape_${Date.now()}.${document.getElementById('export-format').value}`,
      bom: document.getElementById('csv-bom').checked
    },
    compliance: {
      requireUserConsentPerHost: document.getElementById('require-consent').checked
    }
  };
  
  if (document.getElementById('enable-pagination').checked) {
    config.pagination = {
      type: document.getElementById('pagination-type').value,
      param: document.getElementById('pagination-param').value,
      maxPages: parseInt(document.getElementById('max-pages').value),
      stopOnNoNewItems: document.getElementById('stop-on-no-items').checked,
      delayMs: { min: 1500, max: 3000 }
    };
  }
  
  if (document.getElementById('enable-infinite-scroll').checked) {
    config.infiniteScroll = {
      enabled: true,
      maxScrolls: parseInt(document.getElementById('max-scrolls').value),
      delayMs: { min: 1000, max: 2000 }
    };
  }
  
  if (document.getElementById('enable-load-more').checked) {
    config.loadMore = {
      enabled: true,
      buttonSelector: document.getElementById('load-more-button-selector').value,
      maxClicks: parseInt(document.getElementById('max-load-more-clicks').value),
      delayMs: parseInt(document.getElementById('load-more-delay').value)
    };
  }
  
  await chrome.runtime.sendMessage({ type: 'SAVE_JOB_CONFIG', config });
  await loadJobs();
  hideJobEditor();
  alert('Job saved successfully!');
}

/**
 * Note: Permission management functions removed
 * This extension uses activeTab permission which doesn't require manual host permissions.
 * See the Permissions tab in settings for more information.
 */

async function loadSettings() {
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || {};
  
  if (settings.defaultDelays) {
    document.getElementById('default-delay-min').value = settings.defaultDelays.min;
    document.getElementById('default-delay-max').value = settings.defaultDelays.max;
  }
  
  document.getElementById('telemetry-enabled').checked = settings.telemetryEnabled || false;
}

async function saveSettings() {
  const settings = {
    defaultDelays: {
      min: parseInt(document.getElementById('default-delay-min').value),
      max: parseInt(document.getElementById('default-delay-max').value)
    },
    telemetryEnabled: document.getElementById('telemetry-enabled').checked
  };
  
  await chrome.storage.local.set({ settings });
  alert('Settings saved!');
}

/**
 * Activate Smart Picker
 */
async function activateSmartPicker() {
  const startUrl = document.getElementById('start-url').value;
  
  if (!startUrl) {
    alert('Please enter a Start URL first!');
    return;
  }

  try {
    // Get the CURRENT active tab (where user already is)
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if current tab matches the start URL domain
    const startUrlObj = new URL(startUrl);
    const currentUrlObj = new URL(currentTab.url);
    
    if (currentUrlObj.origin !== startUrlObj.origin) {
      // User is not on the right site
      const confirmNavigate = confirm(
        `You are currently on: ${currentUrlObj.origin}\n` +
        `But the Start URL is: ${startUrlObj.origin}\n\n` +
        `Do you want to navigate to the Start URL first?`
      );
      
      if (confirmNavigate) {
        // Navigate current tab to start URL
        await chrome.tabs.update(currentTab.id, { url: startUrl });
        
        // Wait for navigation to complete
        await new Promise((resolve) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
            if (tabId === currentTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });
      } else {
        // User wants to stay on current page
        showNotification('Smart Picker cancelled. Update the Start URL to match your current page.');
        return;
      }
    }

    // Additional wait to ensure DOM is ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Inject Smart Picker script
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['src/content/smart-picker.js']
    });

    // Wait a bit for script to initialize
    await new Promise(resolve => setTimeout(resolve, 200));

    // Activate Smart Picker using executeScript
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => {
        if (typeof window.SmartElementPicker === 'undefined') {
          console.error('SmartElementPicker not loaded');
          return;
        }

        const picker = new window.SmartElementPicker();
        
        picker.activate((result) => {
          // Send result back via chrome.runtime
          chrome.runtime.sendMessage({
            type: 'SMART_PICKER_RESULT',
            data: result
          });
        });
      }
    });

    // Show notification
    showNotification('✅ Smart Picker activated! Click on an item on the page.');

    // Listen for selection result
    const messageListener = (message, sender) => {
      if (message.type === 'SMART_PICKER_RESULT') {
        handleSmartPickerResult(message.data);
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

  } catch (error) {
    console.error('Error activating Smart Picker:', error);
    alert(`Error: ${error.message}\n\nMake sure you have permission to access this URL and the page is fully loaded.`);
  }
}

/**
 * Handle Smart Picker result
 */
function handleSmartPickerResult(data) {
  // Set item selector
  document.getElementById('item-selector').value = data.itemSelector;

  // Clear existing fields
  document.getElementById('fields-list').innerHTML = '';

  // Add all selected fields
  data.fields.forEach(field => {
    addFieldRow(field);
  });

  // Show notification
  showNotification(`✅ Added ${data.fields.length} fields from Smart Picker!`);

  // Focus back to options page
  window.focus();
}

/**
 * Show notification
 */
function showNotification(message, type = 'success') {
  const colors = {
    success: '#4CAF50',
    error: '#f44336',
    warning: '#ff9800',
    info: '#2196f3'
  };

  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type] || colors.success};
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    font-size: 14px;
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}
