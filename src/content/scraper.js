// Content script injected into pages for scraping
import { WorkflowOrchestrator } from '../core/workflow-orchestrator.js';
import { DataExporter, DataValidator } from '../core/data-export.js';

let currentWorkflow = null;
let isScraping = false;

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true;
});

/**
 * Handle messages
 */
async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'START_WORKFLOW':
        await startWorkflow(message.config);
        sendResponse({ success: true });
        break;

      case 'STOP_WORKFLOW':
        stopWorkflow();
        sendResponse({ success: true });
        break;

      case 'SCRAPE_DETAIL_FIELDS':
        const data = await scrapeDetailFields(message.fields, message.jobId);
        sendResponse({ success: true, data });
        break;

      case 'TOGGLE_SELECTOR_HELPER':
        toggleSelectorHelper();
        sendResponse({ success: true });
        break;

      case 'ACTIVATE_SMART_PICKER':
        activateSmartPicker();
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('Content script error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Start scraping workflow
 */
async function startWorkflow(config) {
  if (isScraping) {
    throw new Error('Scraping already in progress');
  }

  isScraping = true;
  
  try {
    // Show compliance warning if needed
    if (config.compliance?.requireUserConsentPerHost) {
      const consent = await showComplianceWarning(config.startUrl);
      if (!consent) {
        throw new Error('User declined scraping consent');
      }
    }

    // Create workflow orchestrator
    currentWorkflow = new WorkflowOrchestrator(config);
    
    // Start scraping
    const result = await currentWorkflow.start();
    
    // Validate data
    const validator = new DataValidator(config);
    const validation = validator.validateAll(result.items);
    
    // Export data
    const exporter = new DataExporter(config);
    const exportResult = await exporter.exportData(result.items);
    
    // Send completion notification
    chrome.runtime.sendMessage({
      type: 'SCRAPING_COMPLETED',
      jobId: config.jobId,
      result: {
        ...result,
        validation,
        export: exportResult
      }
    });

    isScraping = false;
    currentWorkflow = null;
  } catch (error) {
    isScraping = false;
    currentWorkflow = null;
    
    chrome.runtime.sendMessage({
      type: 'SCRAPING_FAILED',
      jobId: config.jobId,
      error: error.message
    });
    
    throw error;
  }
}

/**
 * Stop workflow
 */
function stopWorkflow() {
  if (currentWorkflow) {
    isScraping = false;
    currentWorkflow = null;
  }
}

/**
 * Scrape detail fields from current page
 */
async function scrapeDetailFields(fields, jobId) {
  const { ScrapingEngine } = await import('../core/scraping-engine.js');
  const engine = new ScrapingEngine({ jobId, listing: { fields } });
  
  await engine.waitForDOMReady();
  
  const data = {};
  for (const fieldConfig of fields) {
    data[fieldConfig.name] = engine.extractField(document.body, fieldConfig);
  }
  
  return data;
}

/**
 * Show compliance warning dialog
 */
async function showComplianceWarning(url) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      padding: 30px;
      border-radius: 8px;
      max-width: 500px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;

    dialog.innerHTML = `
      <h2 style="margin-top: 0; color: #333;">Scraping Consent Required</h2>
      <p style="color: #666; line-height: 1.6;">
        You are about to scrape data from:<br>
        <strong>${url}</strong>
      </p>
      <p style="color: #666; line-height: 1.6;">
        Please ensure you have:
        <ul style="text-align: left;">
          <li>Permission to scrape this website</li>
          <li>Reviewed the site's robots.txt and Terms of Service</li>
          <li>Configured appropriate delays to be respectful</li>
        </ul>
      </p>
      <p style="color: #999; font-size: 14px;">
        Proceeding confirms you understand these requirements.
      </p>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button id="scraper-decline" style="
          padding: 10px 20px;
          border: 1px solid #ccc;
          background: white;
          border-radius: 4px;
          cursor: pointer;
        ">Decline</button>
        <button id="scraper-accept" style="
          padding: 10px 20px;
          border: none;
          background: #4CAF50;
          color: white;
          border-radius: 4px;
          cursor: pointer;
        ">Accept & Continue</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    document.getElementById('scraper-accept').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(true);
    });

    document.getElementById('scraper-decline').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(false);
    });
  });
}

/**
 * Toggle selector helper overlay
 */
let selectorHelperActive = false;
let selectorOverlay = null;

function toggleSelectorHelper() {
  if (selectorHelperActive) {
    deactivateSelectorHelper();
  } else {
    activateSelectorHelper();
  }
}

function activateSelectorHelper() {
  selectorHelperActive = true;

  // Create overlay
  selectorOverlay = document.createElement('div');
  selectorOverlay.id = 'scraper-selector-overlay';
  selectorOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999998;
    pointer-events: none;
  `;
  document.body.appendChild(selectorOverlay);

  // Create info panel
  const infoPanel = document.createElement('div');
  infoPanel.id = 'scraper-selector-info';
  infoPanel.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: white;
    padding: 15px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    z-index: 999999;
    font-family: monospace;
    font-size: 12px;
    max-width: 400px;
  `;
  infoPanel.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 10px;">Element Selector</div>
    <div id="selector-css" style="margin-bottom: 5px;">CSS: <span style="color: #0066cc;"></span></div>
    <div id="selector-xpath" style="margin-bottom: 10px;">XPath: <span style="color: #0066cc;"></span></div>
    <button id="selector-close" style="
      padding: 5px 10px;
      border: none;
      background: #f44336;
      color: white;
      border-radius: 4px;
      cursor: pointer;
    ">Close (Esc)</button>
  `;
  document.body.appendChild(infoPanel);

  // Add event listeners
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown);

  document.getElementById('selector-close').addEventListener('click', deactivateSelectorHelper);
}

function deactivateSelectorHelper() {
  selectorHelperActive = false;

  // Remove overlay and info panel
  if (selectorOverlay) {
    selectorOverlay.remove();
    selectorOverlay = null;
  }

  const infoPanel = document.getElementById('scraper-selector-info');
  if (infoPanel) {
    infoPanel.remove();
  }

  // Remove event listeners
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown);

  // Remove highlight
  const highlight = document.getElementById('scraper-highlight');
  if (highlight) {
    highlight.remove();
  }
}

function handleMouseMove(event) {
  const element = event.target;
  
  // Don't highlight our own elements
  if (element.id === 'scraper-selector-info' || 
      element.closest('#scraper-selector-info') ||
      element.id === 'scraper-highlight') {
    return;
  }

  highlightElement(element);
  updateSelectorInfo(element);
}

function handleClick(event) {
  event.preventDefault();
  event.stopPropagation();

  const element = event.target;
  
  if (element.id === 'scraper-selector-info' || element.closest('#scraper-selector-info')) {
    return;
  }

  // Copy CSS selector to clipboard
  const cssSelector = generateCSSSelector(element);
  navigator.clipboard.writeText(cssSelector);
  
  // Show copied notification
  showNotification('Selector copied to clipboard!');
}

function handleKeyDown(event) {
  if (event.key === 'Escape') {
    deactivateSelectorHelper();
  }
}

function highlightElement(element) {
  let highlight = document.getElementById('scraper-highlight');
  
  if (!highlight) {
    highlight = document.createElement('div');
    highlight.id = 'scraper-highlight';
    highlight.style.cssText = `
      position: absolute;
      border: 2px solid #4CAF50;
      background: rgba(76, 175, 80, 0.1);
      pointer-events: none;
      z-index: 999997;
    `;
    document.body.appendChild(highlight);
  }

  const rect = element.getBoundingClientRect();
  highlight.style.top = `${rect.top + window.scrollY}px`;
  highlight.style.left = `${rect.left + window.scrollX}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
}

function updateSelectorInfo(element) {
  const cssSelector = generateCSSSelector(element);
  const xpathSelector = generateXPath(element);

  const cssSpan = document.querySelector('#selector-css span');
  const xpathSpan = document.querySelector('#selector-xpath span');

  if (cssSpan) cssSpan.textContent = cssSelector;
  if (xpathSpan) xpathSpan.textContent = xpathSelector;
}

function generateCSSSelector(element) {
  if (element.id) {
    return `#${element.id}`;
  }

  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    
    if (current.className) {
      const classes = current.className.split(' ').filter(c => c.trim());
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

function generateXPath(element) {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let index = 1;
    let sibling = current.previousElementSibling;

    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    const tagName = current.tagName.toLowerCase();
    path.unshift(`${tagName}[${index}]`);
    current = current.parentElement;
  }

  return '//' + path.join('/');
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #4CAF50;
    color: white;
    padding: 15px 30px;
    border-radius: 8px;
    z-index: 1000000;
    font-family: sans-serif;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 2000);
}

console.log('Web scraper content script loaded');

/**
 * Activate Smart Picker
 */
function activateSmartPicker() {
  // Check if SmartElementPicker is loaded
  if (typeof window.SmartElementPicker === 'undefined') {
    console.error('SmartElementPicker not loaded');
    return;
  }

  const picker = new window.SmartElementPicker();
  
  picker.activate((result) => {
    // Send result back to options page
    chrome.runtime.sendMessage({
      type: 'SMART_PICKER_RESULT',
      data: result
    });
  });
}
