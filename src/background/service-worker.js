// Background service worker for Manifest V3
let activeJobs = new Map();
let jobLogs = new Map();

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async response
});

// Listen for commands (keyboard shortcuts)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-selector-helper') {
    toggleSelectorHelper();
  }
});

/**
 * Handle messages from content scripts and popup
 */
async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'START_SCRAPING':
        // Get active tab since sender.tab is undefined from side panel
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
          throw new Error('No active tab found');
        }
        await startScrapingJob(message.config, activeTab);
        sendResponse({ success: true });
        break;

      case 'STOP_SCRAPING':
        await stopScrapingJob(message.jobId);
        sendResponse({ success: true });
        break;

      case 'GET_JOB_STATUS':
        const status = getJobStatus(message.jobId);
        sendResponse({ success: true, status });
        break;

      case 'GET_JOBS':
        const jobs = await getAllJobs();
        sendResponse({ success: true, jobs });
        break;
      
      case 'SCRAPE_QUERY_PARAM_PAGE':
        // Handle query parameter pagination - fetch and parse
        const pageData = await scrapeQueryParamPage(message.url, message.config);
        // pageData already has {success, items, count} structure
        sendResponse(pageData);
        break;

      case 'SAVE_JOB_CONFIG':
        await saveJobConfig(message.config);
        sendResponse({ success: true });
        break;

      case 'DELETE_JOB_CONFIG':
        await deleteJobConfig(message.jobId);
        sendResponse({ success: true });
        break;

      case 'LOG_ENTRY':
        storeLogEntry(message.log);
        sendResponse({ success: true });
        break;

      case 'GET_LOGS':
        const logs = getLogsForJob(message.jobId);
        sendResponse({ success: true, logs });
        break;

      case 'NAVIGATE_TO_URL':
        await navigateToUrl(message.url, sender.tab?.id);
        sendResponse({ success: true });
        break;

      case 'PROGRESS_UPDATE':
        updateJobProgress(message.jobId, message.progress);
        sendResponse({ success: true });
        break;
      
      case 'CURRENT_ITEM_UPDATE':
        // Relay current item update to popup
        console.log('🔄 Relaying current item update to popup:', message.currentItem?.substring(0, 50));
        chrome.runtime.sendMessage({
          type: 'CURRENT_ITEM_UPDATE',
          jobId: message.jobId,
          currentItem: message.currentItem,
          itemNumber: message.itemNumber,
          totalItems: message.totalItems,
          pageNumber: message.pageNumber
        }).catch(() => {}); // Ignore if popup closed
        sendResponse({ success: true });
        break;

      case 'SCRAPING_COMPLETED':
        handleScrapingCompleted(message.jobId, message.result);
        sendResponse({ success: true });
        break;

      case 'SCRAPING_FAILED':
        handleScrapingFailed(message.jobId, message.error);
        sendResponse({ success: true });
        break;

      case 'PAGINATION_DETECTED':
        // Relay from content script (sender.tab is set) to popup
        chrome.runtime.sendMessage({
          type: 'PAGINATION_DETECTED',
          result: message.result,
          error: message.error,
        }).catch(() => {}); // Ignore if popup is closed
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Start a scraping job
 */
async function startScrapingJob(config, tab) {
  const jobId = config.jobId || `job_${Date.now()}`;

  console.log('🎯 Starting scraping job:', jobId);

  // Initialize job state
  activeJobs.set(jobId, {
    jobId,
    config,
    status: 'running',
    startTime: new Date().toISOString(),
    progress: {
      itemsScraped: 0,
      currentPage: 1
    },
    tabId: tab?.id
  });

  jobLogs.set(jobId, []);

  // Inject content script and start scraping
  try {
    console.log('📝 Injecting scraper-runner.js...');
    
    // Inject simple scraper runner (no modules)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/scraper-runner.js']
    });

    console.log('✅ Script injected, waiting for initialization...');
    
    // Wait for script to initialize and set up message listeners
    // Try multiple times with increasing delays
    let connected = false;
    const maxAttempts = 5;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const delay = attempt * 500; // 500ms, 1000ms, 1500ms, etc.
      console.log(`⏳ Attempt ${attempt}/${maxAttempts}: Waiting ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      try {
        // Try to ping the content script
        await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
        console.log('✅ Content script is ready!');
        connected = true;
        break;
      } catch (error) {
        console.log(`⚠️ Attempt ${attempt} failed:`, error.message);
        if (attempt === maxAttempts) {
          throw new Error('Content script did not respond after multiple attempts');
        }
      }
    }

    if (!connected) {
      throw new Error('Failed to connect to content script');
    }

    console.log('🚀 Starting scraping workflow...');
    
    // Start the scraping workflow
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'START_WORKFLOW',
      config
    });
    
    console.log('✅ Workflow started:', response);

    addLog(jobId, 'info', 'Scraping job started');
  } catch (error) {
    console.error('❌ Failed to start scraping:', error);
    activeJobs.delete(jobId);
    throw new Error(`Failed to start scraping: ${error.message}`);
  }
}

/**
 * Stop a scraping job
 */
async function stopScrapingJob(jobId) {
  const job = activeJobs.get(jobId);
  
  if (!job) {
    throw new Error('Job not found');
  }

  if (job.tabId) {
    try {
      await chrome.tabs.sendMessage(job.tabId, {
        type: 'STOP_WORKFLOW'
      });
    } catch (error) {
      console.error('Error stopping workflow:', error);
    }
  }

  job.status = 'stopped';
  job.endTime = new Date().toISOString();
  
  addLog(jobId, 'info', 'Scraping job stopped by user');
}

/**
 * Get job status
 */
function getJobStatus(jobId) {
  return activeJobs.get(jobId) || null;
}

/**
 * Get all jobs from storage
 */
async function getAllJobs() {
  const result = await chrome.storage.local.get('jobs');
  return result.jobs || [];
}

/**
 * Save job configuration
 */
async function saveJobConfig(config) {
  const jobs = await getAllJobs();
  const existingIndex = jobs.findIndex(j => j.jobId === config.jobId);

  if (existingIndex >= 0) {
    jobs[existingIndex] = config;
  } else {
    jobs.push(config);
  }

  await chrome.storage.local.set({ jobs });
}

/**
 * Delete job configuration
 */
async function deleteJobConfig(jobId) {
  console.log('🗑️ Deleting job config:', jobId);
  const jobs = await getAllJobs();
  const filtered = jobs.filter(j => j.jobId !== jobId);
  await chrome.storage.local.set({ jobs: filtered }); // FIX: Save filtered array
  console.log('✅ Job deleted. Remaining jobs:', filtered.length);
  
  // Also stop the job if it's running
  if (activeJobs.has(jobId)) {
    await stopScrapingJob(jobId);
    activeJobs.delete(jobId);
    jobLogs.delete(jobId);
  }
  
  // Broadcast to all listeners (popup, options page) that job was deleted
  chrome.runtime.sendMessage({
    type: 'JOB_DELETED',
    jobId: jobId,
    remainingJobs: filtered.length
  }).catch(() => {
    // Ignore if no listeners
    console.log('No listeners for JOB_DELETED broadcast');
  });
}

/**
 * Store log entry
 */
function storeLogEntry(log) {
  const logs = jobLogs.get(log.jobId) || [];
  logs.push(log);
  jobLogs.set(log.jobId, logs);
}

/**
 * Add log entry
 */
function addLog(jobId, level, message, context = {}) {
  const log = {
    timestamp: new Date().toISOString(),
    level,
    jobId,
    message,
    context
  };
  storeLogEntry(log);
}

/**
 * Get logs for job
 */
function getLogsForJob(jobId) {
  return jobLogs.get(jobId) || [];
}

/**
 * Update job progress
 */
function updateJobProgress(jobId, progress) {
  const job = activeJobs.get(jobId);
  if (job) {
    job.progress = { ...job.progress, ...progress };
    
    // Broadcast to all popups
    chrome.runtime.sendMessage({
      type: 'JOB_PROGRESS_UPDATE',
      jobId,
      progress: job.progress
    }).catch(() => {});
  }
}

/**
 * Handle scraping completion
 */
function handleScrapingCompleted(jobId, result) {
  console.log('🎯 Service Worker: Scraping completed', jobId, result);
  
  const job = activeJobs.get(jobId);
  
  if (job) {
    job.status = 'completed';
    job.endTime = new Date().toISOString();
    job.result = result;
    
    addLog(jobId, 'info', `Scraping completed. Extracted ${result.itemsScraped} items`);
    
    console.log('📢 Broadcasting SCRAPING_COMPLETED to popup');
    
    // Broadcast to popup (ignore errors if popup is closed)
    chrome.runtime.sendMessage({
      type: 'SCRAPING_COMPLETED',
      jobId,
      result
    }).catch(() => {
      // Silently ignore - popup might be closed, which is normal
    });
  } else {
    console.warn('⚠️ Job not found:', jobId);
  }
}

/**
 * Handle scraping failure
 */
function handleScrapingFailed(jobId, error) {
  const job = activeJobs.get(jobId);
  
  if (job) {
    job.status = 'failed';
    job.endTime = new Date().toISOString();
    job.error = error;
    
    addLog(jobId, 'error', `Scraping failed: ${error}`);
    
    // Broadcast to popup
    chrome.runtime.sendMessage({
      type: 'SCRAPING_FAILED',
      jobId,
      error
    }).catch(() => {});
  }
}

/**
 * Navigate to URL
 */
async function navigateToUrl(url, tabId) {
  if (tabId) {
    await chrome.tabs.update(tabId, { url });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
}

/**
 * Toggle selector helper
 */
async function toggleSelectorHelper() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab) {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'TOGGLE_SELECTOR_HELPER'
    });
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('Web Scraper Pro installed');
    
    // Initialize default settings
    await chrome.storage.local.set({
      jobs: [],
      settings: {
        defaultDelays: { min: 1000, max: 2000 },
        maxConcurrentRequests: 3,
        telemetryEnabled: false
      }
    });

    // Open options page
    chrome.runtime.openOptionsPage();
  }
});

console.log('Background service worker loaded');

// Handle side panel opening when icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Open side panel for this window
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error('Error opening side panel:', error);
  }
});

/**
 * Scrape a page via query parameter (fetch approach)
 */
async function scrapeQueryParamPage(url, config) {
  console.log('📄 [BACKGROUND] Fetching page:', url);

  try {
    // credentials: 'include' forwards the user's existing session cookies so
    // authenticated sites work without any extra login flow.
    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeScraper/1.0)' }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    console.log('✅ [BACKGROUND] Page fetched, HTML length:', html.length);

    return {
      success: true,
      html: html,
      url: url
    };

  } catch (error) {
    console.error('❌ [BACKGROUND] Error fetching page:', error);
    return {
      success: false,
      error: error.message,
      items: []
    };
  }
}
