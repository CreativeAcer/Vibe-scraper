// Popup script
let currentJobId = null;
let jobs = [];
let startTime = null;
let timerInterval = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadJobs();
  setupEventListeners();
  setupMessageListener(); // Set up single global listener
});

/**
 * Load jobs from storage
 */
async function loadJobs() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_JOBS' });
  
  if (response.success) {
    jobs = response.jobs;
    
    if (jobs.length === 0) {
      showNoJobsMessage();
    } else {
      showJobsList();
      populateJobSelector();
    }
  }
}

/**
 * Show no jobs message
 */
function showNoJobsMessage() {
  document.getElementById('no-jobs-message').classList.remove('hidden');
  document.getElementById('jobs-list').classList.add('hidden');
}

/**
 * Show jobs list
 */
function showJobsList() {
  document.getElementById('no-jobs-message').classList.add('hidden');
  document.getElementById('jobs-list').classList.remove('hidden');
}

/**
 * Populate job selector dropdown
 */
function populateJobSelector() {
  const select = document.getElementById('job-select');
  select.innerHTML = '';
  
  jobs.forEach(job => {
    const option = document.createElement('option');
    option.value = job.jobId;
    option.textContent = job.jobId;
    select.appendChild(option);
  });

  if (jobs.length > 0) {
    currentJobId = jobs[0].jobId;
    updateJobDetails(jobs[0]);
  }
}

/**
 * Update job details display
 */
function updateJobDetails(job) {
  document.getElementById('job-url').textContent = job.startUrl;
  updateJobStatus('idle');
}

/**
 * Update job status badge
 */
function updateJobStatus(status) {
  const statusElement = document.getElementById('job-status');
  statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  statusElement.className = `value badge ${status}`;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Open options
  document.getElementById('open-options').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
  });

  // Create job button - show inline editor
  document.getElementById('create-job-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    showJobEditor(tab.url);
  });

  // Create new job button (when jobs exist)
  document.getElementById('create-new-job-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    showJobEditor(tab.url);
  });

  // Close job editor
  document.getElementById('close-job-editor').addEventListener('click', () => {
    hideJobEditor();
  });

  // Quick Smart Picker button
  document.getElementById('quick-smart-picker-btn').addEventListener('click', async () => {
    await activateQuickSmartPicker();
  });

  // Save quick job
  document.getElementById('save-quick-job-btn').addEventListener('click', async () => {
    await saveQuickJob();
  });

  // Job selector change
  document.getElementById('job-select').addEventListener('change', (e) => {
    currentJobId = e.target.value;
    const job = jobs.find(j => j.jobId === currentJobId);
    if (job) {
      updateJobDetails(job);
    }
  });

  // Start scraping
  document.getElementById('start-btn').addEventListener('click', startScraping);

  // Stop scraping
  document.getElementById('stop-btn').addEventListener('click', stopScraping);

  // Clear logs
  document.getElementById('clear-logs-btn').addEventListener('click', clearLogs);

  // Selector helper button removed - not needed anymore
  
  // Scraping mode selection
  document.querySelectorAll('input[name="scraping-mode"]').forEach(radio => {
    radio.addEventListener('change', handleScrapingModeChange);
  });
  
  // Detect next button
  document.getElementById('detect-next-btn').addEventListener('click', detectNextButton);
  document.getElementById('detect-load-more-btn').addEventListener('click', detectLoadMoreButton);
  
  // Pagination type toggle
  document.getElementById('pagination-type-toggle').addEventListener('change', handlePaginationTypeToggle);
}

/**
 * Detect next button on page
 */
async function detectNextButton() {
  const button = document.getElementById('detect-next-btn');
  button.textContent = '⏳ Wait...';
  button.disabled = true;
  
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    console.log('🎯 Activating Smart Picker for next button detection...');
    
    // Use Smart Picker to detect the button
    // First inject Smart Picker if not already injected
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/smart-picker.js']
    });
    
    // Wait for it to load
    await new Promise(resolve => setTimeout(resolve, 500));
    
    button.textContent = 'Click next button...';
    
    // Activate Smart Picker in single-element mode
    await chrome.tabs.sendMessage(tab.id, {
      type: 'ACTIVATE_SMART_PICKER',
      skipPanel: true,
      singleElement: true
    });
    
    // Listen for the result
    const messageListener = (message) => {
      if (message.type === 'ELEMENT_SELECTED') {
        console.log('✅ Next button detected:', message);
        
        // Use the selector from Smart Picker
        const selector = message.selector;
        
        // Update the pagination selector input
        document.getElementById('pagination-selector').value = selector;
        
        // Show success
        const elementInfo = message.element?.tag || 'element';
        const elementText = message.element?.text?.substring(0, 30) || '';
        showStatus(`✅ Detected: ${selector} - "${elementText}"`, 'success');
        
        // Reset button
        button.textContent = '🎯 Detect';
        button.disabled = false;
        
        chrome.runtime.onMessage.removeListener(messageListener);
      } else if (message.type === 'SMART_PICKER_CANCELLED') {
        console.log('❌ Detection cancelled');
        
        showStatus('❌ Detection cancelled', 'error');
        
        button.textContent = '🎯 Detect';
        button.disabled = false;
        
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    };
    
    chrome.runtime.onMessage.addListener(messageListener);
    
    // Timeout after 60 seconds
    setTimeout(() => {
      button.textContent = '🎯 Detect';
      button.disabled = false;
      chrome.runtime.onMessage.removeListener(messageListener);
    }, 60000);
    
  } catch (error) {
    console.error('❌ Error detecting next button:', error);
    showStatus('❌ Error: ' + error.message, 'error');
    button.textContent = '🎯 Detect';
    button.disabled = false;
  }
}

/**
 * Detect Load More button on page
 */
async function detectLoadMoreButton() {
  const button = document.getElementById('detect-load-more-btn');
  button.textContent = '⏳ Wait...';
  button.disabled = true;
  
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    console.log('🎯 Activating Smart Picker for Load More button detection...');
    
    // Use Smart Picker to detect the button
    // First inject Smart Picker if not already injected
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/smart-picker.js']
    });
    
    // Wait for it to load
    await new Promise(resolve => setTimeout(resolve, 500));
    
    button.textContent = 'Click Load More...';
    
    // Activate Smart Picker in single-element mode
    await chrome.tabs.sendMessage(tab.id, {
      type: 'ACTIVATE_SMART_PICKER',
      skipPanel: true,
      singleElement: true
    });
    
    // Listen for the result
    const messageListener = (message) => {
      if (message.type === 'ELEMENT_SELECTED') {
        console.log('✅ Load More button detected:', message);
        
        // Use the selector from Smart Picker
        const selector = message.selector;
        
        // Update the load-more selector input
        document.getElementById('load-more-selector').value = selector;
        
        // Show success
        const elementInfo = message.element?.tag || 'element';
        const elementText = message.element?.text?.substring(0, 30) || '';
        showStatus(`✅ Detected: ${selector} - "${elementText}"`, 'success');
        
        // Reset button
        button.textContent = '🎯 Detect';
        button.disabled = false;
        
        chrome.runtime.onMessage.removeListener(messageListener);
      } else if (message.type === 'SMART_PICKER_CANCELLED') {
        console.log('❌ Detection cancelled');
        
        showStatus('❌ Detection cancelled', 'error');
        
        button.textContent = '🎯 Detect';
        button.disabled = false;
        
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    };
    
    chrome.runtime.onMessage.addListener(messageListener);
    
    // Timeout after 60 seconds
    setTimeout(() => {
      button.textContent = '🎯 Detect';
      button.disabled = false;
      chrome.runtime.onMessage.removeListener(messageListener);
    }, 60000);
    
  } catch (error) {
    console.error('❌ Error detecting Load More button:', error);
    showStatus('❌ Error: ' + error.message, 'error');
    button.textContent = '🎯 Detect';
    button.disabled = false;
  }
}

/**
 * Start scraping
 */
async function startScraping() {
  if (!currentJobId) {
    showLog('error', 'No job selected');
    return;
  }

  const job = jobs.find(j => j.jobId === currentJobId);
  if (!job) {
    showLog('error', 'Job not found');
    return;
  }
  
  // Disable start button immediately to prevent double-clicks
  const startBtn = document.getElementById('start-btn');
  startBtn.disabled = true;
  startBtn.textContent = '⏳ Starting...';
  console.log('🔒 Start button disabled to prevent double-clicks');
  
  // Reset completion handler flag for new scrape
  window._scrapingCompleteHandled = false;

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showLog('error', 'No active tab found');
      return;
    }

    // Check if we're on the right URL
    const jobUrl = new URL(job.startUrl);
    const currentUrl = new URL(tab.url);
    
    if (jobUrl.href !== currentUrl.href && jobUrl.origin !== currentUrl.origin) {
      // Different domain - ask user to navigate
      showLog('error', `Please navigate to: ${job.startUrl}`);
      showLog('info', 'Then click "Start Scraping" again.');
      
      // Offer to open in new tab
      if (confirm(`This job scrapes:\n${job.startUrl}\n\nWould you like to open it in a new tab?`)) {
        await chrome.tabs.create({ url: job.startUrl });
      }
      return;
    }
    
    if (jobUrl.href !== currentUrl.href && jobUrl.origin === currentUrl.origin) {
      // Same domain, different page - we can navigate
      showLog('info', `Navigating to ${job.startUrl}...`);
      await chrome.tabs.update(tab.id, { url: job.startUrl });
      
      // Wait for navigation
      await new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
      
      // Wait a bit more for page to settle
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Start job
    const response = await chrome.runtime.sendMessage({
      type: 'START_SCRAPING',
      config: job
    });

    if (response.success) {
      console.log('✅ Scraping started successfully, updating UI...');
      
      // Force immediate status update
      const statusElement = document.getElementById('job-status');
      console.log('📊 BEFORE update - Status element:', {
        text: statusElement.textContent,
        className: statusElement.className,
        display: window.getComputedStyle(statusElement).display,
        visibility: window.getComputedStyle(statusElement).visibility
      });
      
      statusElement.textContent = 'Running';
      statusElement.className = 'value badge running';
      
      console.log('📊 AFTER update - Status element:', {
        text: statusElement.textContent,
        className: statusElement.className,
        display: window.getComputedStyle(statusElement).display,
        visibility: window.getComputedStyle(statusElement).visibility
      });
      
      // Force a reflow to ensure update happens
      statusElement.offsetHeight;
      
      console.log('✅ Status element updated to Running');
      
      // Update button visibility
      const startBtn = document.getElementById('start-btn');
      const stopBtn = document.getElementById('stop-btn');
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      startBtn.style.display = 'none';
      stopBtn.style.display = '';
      console.log('Buttons updated - Start hidden, Stop visible');
      
      // Show progress section
      document.getElementById('progress-section').classList.remove('hidden');
      console.log('Progress section visible');
      
      // Show current item display
      const currentItemDisplay = document.getElementById('current-item-display');
      if (currentItemDisplay) {
        currentItemDisplay.classList.remove('hidden');
        document.getElementById('current-item-text').textContent = 'Initializing scraper...';
      }
      
      // Start timer
      startTime = Date.now();
      startTimer();
      
      showLog('info', '🚀 Scraping started - Status: Running');
      
      console.log('✅ UI update complete');
    } else {
      showLog('error', `Failed to start: ${response.error}`);
      
      // Re-enable start button on error
      startBtn.disabled = false;
      startBtn.textContent = 'Start Scraping';
      console.log('❌ Start failed - button re-enabled');
    }
  } catch (error) {
    showLog('error', `Error: ${error.message}`);
    
    // Re-enable start button on error
    const startBtn = document.getElementById('start-btn');
    startBtn.disabled = false;
    startBtn.textContent = 'Start Scraping';
    console.log('❌ Error occurred - button re-enabled');
  }
}

/**
 * Stop scraping
 */
async function stopScraping() {
  if (!currentJobId) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'STOP_SCRAPING',
      jobId: currentJobId
    });

    if (response.success) {
      updateJobStatus('stopped');
      document.getElementById('start-btn').classList.remove('hidden');
      document.getElementById('stop-btn').classList.add('hidden');
      
      stopTimer();
      
      showLog('info', 'Scraping stopped');
    }
  } catch (error) {
    showLog('error', `Error stopping: ${error.message}`);
  }
}

/**
 * Setup global message listener - runs once on load
 */
function setupMessageListener() {
  console.log('🎧 Setting up global message listener');
  
  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener((message) => {
    console.log('📨 Popup received message:', message.type, message);
    
    if (message.type === 'JOB_PROGRESS_UPDATE' && message.jobId === currentJobId) {
      console.log('⚙️ Updating progress:', message.progress);
      updateProgress(message.progress);
      
      // Also ensure status is "Running" when we get progress
      const statusElement = document.getElementById('job-status');
      if (statusElement && statusElement.textContent !== 'Running') {
        console.log('⚠️ Status not Running, fixing it now');
        statusElement.textContent = 'Running';
        statusElement.className = 'value badge running';
      }
    } else if (message.type === 'CURRENT_ITEM_UPDATE' && message.jobId === currentJobId) {
      console.log('📍 Current item update received:', message.currentItem);
      console.log('   Item:', message.itemNumber, '/', message.totalItems);
      console.log('   Page:', message.pageNumber);
      updateCurrentItem(message);
    } else if (message.type === 'SCRAPING_COMPLETED' && message.jobId === currentJobId) {
      console.log('✅ Scraping completed, updating UI');
      handleScrapingCompleted(message.result);
    } else if (message.type === 'SCRAPING_FAILED' && message.jobId === currentJobId) {
      console.log('❌ Scraping failed, updating UI');
      handleScrapingFailed(message.error);
    } else if (message.type === 'LOG_ENTRY' && message.log.jobId === currentJobId) {
      showLog(message.log.level, message.log.message);
    } else if (message.type === 'JOB_DELETED') {
      // Refresh jobs list when a job is deleted
      console.log('🗑️ Job deleted:', message.jobId);
      
      // If the deleted job was the currently selected one, clear selection
      if (message.jobId === currentJobId) {
        console.log('⚠️ Deleted job was currently selected, clearing selection');
        currentJobId = null;
      }
      
      // Reload jobs list
      loadJobs();
    } else if (message.type === 'OPEN_JOB_EDITOR') {
      // Open job editor when requested from Settings page
      console.log('🚀 Opening job editor from Settings page request');
      showJobEditor();
    }
    
    // Return true to keep channel open for async responses
    return true;
  });
  
  console.log('✅ Message listener ready and active');
  
  // Also poll status actively every second
  setInterval(async () => {
    if (!currentJobId) return;
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_JOB_STATUS',
        jobId: currentJobId
      });
      
      if (response.success && response.status) {
        const job = response.status;
        
        // Update status if job is running
        if (job.status === 'running') {
          const statusElement = document.getElementById('job-status');
          if (statusElement && statusElement.textContent !== 'Running') {
            console.log('🔄 Poll detected running job, updating status');
            statusElement.textContent = 'Running';
            statusElement.className = 'value badge running';
          }
          
          // Update progress if available
          if (job.progress) {
            updateProgress(job.progress);
          }
        }
      }
    } catch (error) {
      // Ignore polling errors
    }
  }, 1000); // Poll every second
}

/**
 * Update progress display
 */
function updateProgress(progress) {
  document.getElementById('items-count').textContent = progress.itemsScraped || 0;
  document.getElementById('pages-count').textContent = progress.currentPage || 0;
  
  // Update progress bar (estimated)
  const percentage = Math.min((progress.itemsScraped / 100) * 100, 100);
  document.getElementById('progress-fill').style.width = `${percentage}%`;
}

/**
 * Update current item being scraped
 */
function updateCurrentItem(message) {
  const display = document.getElementById('current-item-display');
  const textElement = document.getElementById('current-item-text');
  
  if (!display || !textElement) return;
  
  // Show the display
  display.classList.remove('hidden');
  
  // Format the message
  let text = '';
  if (message.pageNumber) {
    text += `Page ${message.pageNumber} - `;
  }
  text += `Item ${message.itemNumber}/${message.totalItems}: `;
  text += message.currentItem || 'Processing...';
  
  textElement.textContent = text;
  
  console.log('📍 Current item display updated:', text);
}

/**
 * Handle scraping completion
 */
function handleScrapingCompleted(result) {
  console.log('🎯 handleScrapingCompleted called with:', result);
  
  // Prevent multiple calls
  if (window._scrapingCompleteHandled) {
    console.log('⚠️ Already handled completion, skipping');
    return;
  }
  window._scrapingCompleteHandled = true;
  
  // Use setTimeout to ensure DOM is ready
  setTimeout(() => {
    // Update status badge
    const statusElement = document.getElementById('job-status');
    if (statusElement) {
      console.log('📊 BEFORE completion - Status element:', {
        text: statusElement.textContent,
        className: statusElement.className
      });
      
      statusElement.textContent = 'Completed';
      statusElement.className = 'value badge completed';
      
      console.log('📊 AFTER completion - Status element:', {
        text: statusElement.textContent,
        className: statusElement.className
      });
      
      console.log('✅ Status element updated to: Completed');
    } else {
      console.error('❌ Status element not found!');
    }
    
    // Show/hide buttons
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const progressSection = document.getElementById('progress-section');
    
    if (startBtn) {
      startBtn.classList.remove('hidden');
      startBtn.style.display = ''; // Force display
      startBtn.disabled = false; // Re-enable button
      startBtn.textContent = 'Start Scraping'; // Reset text
      console.log('✅ Start button: visible, enabled, text reset');
    } else {
      console.error('❌ Start button not found!');
    }
    
    if (stopBtn) {
      stopBtn.classList.add('hidden');
      stopBtn.style.display = 'none'; // Force hide
      console.log('✅ Stop button hidden');
    } else {
      console.error('❌ Stop button not found!');
    }
    
    if (progressSection) {
      progressSection.classList.add('hidden');
      console.log('✅ Progress section hidden');
    }
    
    // Hide current item display
    const currentItemDisplay = document.getElementById('current-item-display');
    if (currentItemDisplay) {
      currentItemDisplay.classList.add('hidden');
      console.log('✅ Current item display hidden');
    }
    
    // Stop timer
    stopTimer();
    console.log('✅ Timer stopped');
    
    console.log('🎉 UI update complete - Ready for next scrape!');
  }, 100);
  
  // Show completion message immediately
  const itemCount = result.itemsScraped || result.items?.length || 0;
  showLog('success', `✅ Scraping completed! ${itemCount} items scraped.`);
}

/**
 * Handle scraping failure
 */
function handleScrapingFailed(error) {
  console.log('❌ handleScrapingFailed called with:', error);
  
  updateJobStatus('failed');
  
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  
  // Reset start button
  if (startBtn) {
    startBtn.classList.remove('hidden');
    startBtn.disabled = false;
    startBtn.textContent = 'Start Scraping';
    console.log('✅ Start button reset after failure');
  }
  
  // Hide stop button
  if (stopBtn) {
    stopBtn.classList.add('hidden');
  }
  
  document.getElementById('progress-section').classList.add('hidden');
  
  stopTimer();
  
  showLog('error', `❌ Scraping failed: ${error}`);
}

/**
 * Start timer
 */
function startTimer() {
  stopTimer();
  
  timerInterval = setInterval(() => {
    if (startTime) {
      const elapsed = Date.now() - startTime;
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      document.getElementById('time-elapsed').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }, 1000);
}

/**
 * Stop timer
 */
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/**
 * Show log entry
 */
function showLog(level, message) {
  const container = document.getElementById('logs-container');
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="log-time">${time}</span>${message}`;
  
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
  
  // Limit log entries
  while (container.children.length > 50) {
    container.removeChild(container.firstChild);
  }
}

/**
 * Clear logs
 */
function clearLogs() {
  document.getElementById('logs-container').innerHTML = '';
}

/**
 * Toggle selector helper
 */
// Selector helper function removed - not needed anymore

// Job Editor Functions
let currentFields = [];

function showJobEditor(currentUrl) {
  document.getElementById('no-jobs-message').classList.add('hidden');
  document.getElementById('jobs-list').classList.add('hidden');
  document.getElementById('job-editor').classList.remove('hidden');
  document.getElementById('quick-start-url').value = currentUrl || '';
  document.getElementById('quick-job-id').value = '';
  document.getElementById('quick-fields-preview').classList.add('hidden');
  currentFields = [];
  
  // Initialize pagination toggle to Button mode (unchecked = button, checked = query)
  document.getElementById('pagination-type-toggle').checked = false;
  document.getElementById('pagination-button-group').classList.remove('hidden');
  document.getElementById('pagination-query-group').classList.add('hidden');
  document.getElementById('label-button').classList.add('active');
  document.getElementById('label-query').classList.remove('active');
}

function hideJobEditor() {
  document.getElementById('job-editor').classList.add('hidden');
  currentFields = [];

  // Restore the correct view based on whether jobs already exist
  if (jobs.length > 0) {
    showJobsList();
  } else {
    showNoJobsMessage();
  }
}

async function activateQuickSmartPicker() {
  const jobId = document.getElementById('quick-job-id').value.trim();
  
  if (!jobId) {
    alert('Please enter a Job ID first!');
    return;
  }

  try {
    // Get current tab (not the popup, but the actual webpage)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if tab is a valid web page (not extension page)
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      alert('Please navigate to the website you want to scrape first, then open the popup again.');
      return;
    }
    
    // Inject Smart Picker script into the WEBPAGE (not popup)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/smart-picker.js']
    });

    // Wait for script to load
    await new Promise(resolve => setTimeout(resolve, 300));

    // Activate Smart Picker on the WEBPAGE
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.SmartElementPicker === 'undefined') {
          alert('Smart Picker failed to load. Please try again.');
          return;
        }

        const picker = new window.SmartElementPicker();
        picker.activate((result) => {
          // Send result back to extension
          chrome.runtime.sendMessage({
            type: 'SMART_PICKER_RESULT',
            data: result
          });
        }, { skipPanel: true }); // Skip panel, auto-select all fields
      }
    });

    // Show feedback IN POPUP
    showStatus('✅ Smart Picker activated on page! Click an item on the website.', 'success');
    
    // Show persistent status in form
    document.getElementById('picker-status').classList.remove('hidden');
    
    // Add instruction text
    document.getElementById('quick-smart-picker-btn').textContent = '⏳ Waiting...';
    document.getElementById('quick-smart-picker-btn').disabled = true;

    // Listen for result from the webpage
    const messageListener = (message) => {
      if (message.type === 'SMART_PICKER_RESULT') {
        handleQuickPickerResult(message.data);
        chrome.runtime.onMessage.removeListener(messageListener);
        
        // Reset button
        document.getElementById('quick-smart-picker-btn').textContent = '🎯 Smart Picker';
        document.getElementById('quick-smart-picker-btn').disabled = false;
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    // Timeout after 60 seconds
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(messageListener);
      document.getElementById('quick-smart-picker-btn').textContent = '🎯 Smart Picker';
      document.getElementById('quick-smart-picker-btn').disabled = false;
    }, 60000);

  } catch (error) {
    console.error('Error activating Smart Picker:', error);
    showStatus('❌ Error: ' + error.message, 'error');
    document.getElementById('quick-smart-picker-btn').textContent = '🎯 Smart Picker';
    document.getElementById('quick-smart-picker-btn').disabled = false;
  }
}

function handleQuickPickerResult(data) {
  currentFields = data.fields;
  
  // Store item selector for later
  window.quickJobItemSelector = data.itemSelector;
  
  // Hide picker status
  document.getElementById('picker-status').classList.add('hidden');
  
  // Show fields preview with checkboxes
  const preview = document.getElementById('quick-fields-preview');
  const fieldsList = document.getElementById('quick-fields-list');
  
  preview.classList.remove('hidden');
  
  // Show item selector
  fieldsList.innerHTML = `
    <div class="field-item" style="background: #e8f5e9; border-color: #4CAF50;">
      <div class="field-content">
        <div class="field-name">📋 Item Selector</div>
        <div class="field-details">${data.itemSelector}</div>
      </div>
    </div>
  `;
  
  // Add each field with checkbox
  currentFields.forEach((field, index) => {
    const fieldHtml = `
      <label class="field-item" for="field-${index}">
        <input type="checkbox" id="field-${index}" data-index="${index}" checked>
        <div class="field-content">
          <div class="field-name">${field.name}</div>
          <div class="field-details">${field.selector} → ${field.attr} (${field.type})</div>
          ${field.preview ? `<div class="field-preview">"${field.preview}"</div>` : ''}
        </div>
      </label>
    `;
    fieldsList.innerHTML += fieldHtml;
  });
  
  // Add event listeners for select/deselect all
  document.getElementById('select-all-fields').onclick = () => {
    document.querySelectorAll('#quick-fields-list input[type="checkbox"]').forEach(cb => cb.checked = true);
  };
  
  document.getElementById('deselect-all-fields').onclick = () => {
    document.querySelectorAll('#quick-fields-list input[type="checkbox"]').forEach(cb => cb.checked = false);
  };
  
  // Show scraping mode section
  document.getElementById('scraping-mode-section').classList.remove('hidden');
  
  showStatus(`✅ Detected ${currentFields.length} fields! Select which ones to scrape.`, 'success');
}

async function saveQuickJob() {
  const jobId = document.getElementById('quick-job-id').value.trim();
  const startUrl = document.getElementById('quick-start-url').value;
  
  if (!jobId) {
    alert('Please enter a Job ID!');
    return;
  }
  
  if (currentFields.length === 0) {
    alert('Please use Smart Picker to detect fields first!');
    return;
  }
  
  // Get selected fields only
  const checkboxes = document.querySelectorAll('#quick-fields-list input[type="checkbox"]:checked');
  const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
  const selectedFields = currentFields.filter((_, index) => selectedIndices.includes(index));
  
  if (selectedFields.length === 0) {
    alert('Please select at least one field to scrape!');
    return;
  }
  
  const itemSelector = window.quickJobItemSelector || '.item';
  
  // Get scraping mode
  const scrapingMode = document.querySelector('input[name="scraping-mode"]:checked').value;
  
  // Create job config
  const jobConfig = {
    jobId,
    startUrl,
    listing: {
      itemSelector: itemSelector,
      fields: selectedFields.map(f => ({
        name: f.name,
        selector: f.selector,
        attr: f.attr,
        type: f.type,
        required: false
      }))
    },
    export: {
      format: 'csv',
      filename: `${jobId}.csv`,
      includeUtf8Bom: true
    },
    delays: {
      perActionMs: { min: 1000, max: 2000 }
    }
  };
  
  // Add pagination or infinite scroll config based on mode
  if (scrapingMode === 'pagination') {
    const isQueryParam = document.getElementById('pagination-type-toggle').checked;
    
    console.log('💾 [SAVE] Pagination mode selected');
    console.log('💾 [SAVE] Toggle checked:', isQueryParam);
    console.log('💾 [SAVE] Will save type:', isQueryParam ? 'queryParam' : 'button');
    
    jobConfig.pagination = {
      enabled: true,
      type: isQueryParam ? 'queryParam' : 'button',
      maxPages: parseInt(document.getElementById('pagination-max').value) || 10,
      delayMs: 2000
    };
    
    if (isQueryParam) {
      jobConfig.pagination.param = document.getElementById('pagination-param').value || 'page';
      console.log('💾 [SAVE] Query param:', jobConfig.pagination.param);
    } else {
      jobConfig.pagination.nextButtonSelector = document.getElementById('pagination-selector').value || 'a.next';
      console.log('💾 [SAVE] Button selector:', jobConfig.pagination.nextButtonSelector);
    }
    
    console.log('💾 [SAVE] Final pagination config:', jobConfig.pagination);
  } else if (scrapingMode === 'infinite') {
    jobConfig.infiniteScroll = {
      enabled: true,
      maxScrolls: parseInt(document.getElementById('infinite-max').value) || 10,
      delayMs: parseInt(document.getElementById('infinite-delay').value) || 3000
    };
  } else if (scrapingMode === 'load-more') {
    jobConfig.loadMore = {
      enabled: true,
      buttonSelector: document.getElementById('load-more-selector').value || '.load-more',
      maxClicks: parseInt(document.getElementById('load-more-max').value) || 10,
      delayMs: parseInt(document.getElementById('load-more-delay').value) || 2000
    };
  }
  
  // Save job
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  
  // Check if job already exists
  const existingIndex = jobs.findIndex(j => j.jobId === jobId);
  
  if (existingIndex >= 0) {
    // Update existing job
    jobs[existingIndex] = jobConfig;
  } else {
    // Add new job
    jobs.push(jobConfig);
  }
  
  await chrome.storage.local.set({ jobs });
  
  showStatus(`✅ Job saved with ${selectedFields.length} fields!`, 'success');
  
  // Reload popup to show jobs list
  setTimeout(async () => {
    hideJobEditor();
    await loadJobs();
  }, 1500);
}

function showStatus(message, type) {
  // Create temporary status message
  const status = document.createElement('div');
  status.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 15px;
    background: ${type === 'success' ? '#4CAF50' : '#f44336'};
    color: white;
    border-radius: 4px;
    font-size: 12px;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  status.textContent = message;
  document.body.appendChild(status);
  
  setTimeout(() => status.remove(), 3000);
}

/**
 * Handle scraping mode change
 */
function handleScrapingModeChange(event) {
  const mode = event.target.value;
  
  // Hide all config sections
  document.getElementById('pagination-options').classList.add('hidden');
  document.getElementById('infinite-options').classList.add('hidden');
  document.getElementById('load-more-options').classList.add('hidden');
  
  // Show relevant config section
  if (mode === 'pagination') {
    document.getElementById('pagination-options').classList.remove('hidden');
  } else if (mode === 'infinite') {
    document.getElementById('infinite-options').classList.remove('hidden');
  } else if (mode === 'load-more') {
    document.getElementById('load-more-options').classList.remove('hidden');
  }
}

/**
 * Handle pagination type toggle
 */
function handlePaginationTypeToggle(event) {
  const isQueryParam = event.target.checked;
  
  const buttonGroup = document.getElementById('pagination-button-group');
  const queryGroup = document.getElementById('pagination-query-group');
  const labelButton = document.getElementById('label-button');
  const labelQuery = document.getElementById('label-query');
  
  if (isQueryParam) {
    // Query Parameter mode
    buttonGroup.classList.add('hidden');
    queryGroup.classList.remove('hidden');
    labelButton.classList.remove('active');
    labelQuery.classList.add('active');
  } else {
    // Button mode
    buttonGroup.classList.remove('hidden');
    queryGroup.classList.add('hidden');
    labelButton.classList.add('active');
    labelQuery.classList.remove('active');
  }
}
