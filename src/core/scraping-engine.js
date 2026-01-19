// Core scraping engine with selector extraction and data normalization
export class ScrapingEngine {
  constructor(config) {
    this.config = config;
    this.logger = new Logger(config.jobId);
  }

  /**
   * Extract data from DOM using CSS or XPath selectors
   */
  extractField(element, fieldConfig) {
    try {
      let targetElement = element;

      // Support for CSS and XPath selectors
      if (fieldConfig.selector) {
        if (fieldConfig.selector.startsWith('//') || fieldConfig.selector.startsWith('(//')) {
          // XPath selector
          const result = document.evaluate(
            fieldConfig.selector,
            element,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          targetElement = result.singleNodeValue;
        } else {
          // CSS selector
          targetElement = element.querySelector(fieldConfig.selector);
        }
      }

      if (!targetElement) {
        if (fieldConfig.required) {
          throw new Error(`Required field not found: ${fieldConfig.name}`);
        }
        return null;
      }

      // Extract value based on attribute
      let value;
      switch (fieldConfig.attr) {
        case 'text':
          value = targetElement.textContent;
          break;
        case 'html':
        case 'innerHTML':
          value = targetElement.innerHTML;
          break;
        default:
          value = targetElement.getAttribute(fieldConfig.attr);
      }

      // Normalize and transform
      value = this.normalizeValue(value, fieldConfig);
      
      // Convert to correct data type
      value = this.convertType(value, fieldConfig.type);

      return value;
    } catch (error) {
      this.logger.error(`Error extracting field ${fieldConfig.name}`, { error: error.message, selector: fieldConfig.selector });
      if (fieldConfig.required) {
        throw error;
      }
      return null;
    }
  }

  /**
   * Normalize extracted value
   */
  normalizeValue(value, fieldConfig) {
    if (value === null || value === undefined) {
      return null;
    }

    // Trim whitespace
    if (typeof value === 'string') {
      value = value.trim();
    }

    // Apply transforms
    if (fieldConfig.transform) {
      if (fieldConfig.transform.remove) {
        for (const toRemove of fieldConfig.transform.remove) {
          value = value.replace(new RegExp(toRemove, 'g'), '');
        }
      }
      if (fieldConfig.transform.replace) {
        for (const [from, to] of Object.entries(fieldConfig.transform.replace)) {
          value = value.replace(new RegExp(from, 'g'), to);
        }
      }
    }

    return value;
  }

  /**
   * Convert value to specified data type
   */
  convertType(value, type) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    try {
      switch (type) {
        case 'number':
          const num = parseFloat(value.replace(/[^\d.-]/g, ''));
          return isNaN(num) ? null : num;
        
        case 'date':
          const date = new Date(value);
          return isNaN(date.getTime()) ? null : date.toISOString();
        
        case 'boolean':
          return value === 'true' || value === '1' || value === 'yes';
        
        case 'url':
          try {
            const url = new URL(value, window.location.href);
            return url.href;
          } catch {
            return value;
          }
        
        case 'string':
        default:
          return String(value);
      }
    } catch (error) {
      this.logger.warn(`Type conversion failed for type ${type}`, { value, error: error.message });
      return value;
    }
  }

  /**
   * Extract all items from a listing page
   */
  async extractListingItems(document) {
    const items = [];
    const itemElements = document.querySelectorAll(this.config.listing.itemSelector);

    this.logger.info(`Found ${itemElements.length} items on page`);

    for (let i = 0; i < itemElements.length; i++) {
      const element = itemElements[i];
      
      try {
        const item = {};
        
        // Extract all fields
        for (const fieldConfig of this.config.listing.fields) {
          item[fieldConfig.name] = this.extractField(element, fieldConfig);
        }

        // Add metadata
        item._scraped_at = new Date().toISOString();
        item._source_url = window.location.href;
        
        items.push(item);
      } catch (error) {
        this.logger.error(`Error extracting item ${i}`, { error: error.message });
        // Continue with next item
      }
    }

    return items;
  }

  /**
   * Wait for DOM to be ready (handle SPAs)
   */
  async waitForDOMReady(maxWaitMs = 10000) {
    if (document.readyState === 'complete') {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('DOM ready timeout'));
      }, maxWaitMs);

      if (document.readyState === 'complete') {
        clearTimeout(timeout);
        resolve();
      } else {
        window.addEventListener('load', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      }
    });
  }

  /**
   * Wait for specific selector to appear (for SPAs)
   */
  async waitForSelector(selector, maxWaitMs = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
      await this.delay(100);
    }

    throw new Error(`Selector ${selector} not found within ${maxWaitMs}ms`);
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get random delay based on config
   */
  getRandomDelay(config) {
    const min = config.min || 500;
    const max = config.max || 1500;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

/**
 * Simple logger utility
 */
class Logger {
  constructor(jobId) {
    this.jobId = jobId;
    this.logs = [];
  }

  log(level, message, context = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      jobId: this.jobId,
      message,
      context
    };
    
    this.logs.push(entry);
    console[level === 'error' ? 'error' : 'log'](`[${level.toUpperCase()}] ${message}`, context);
    
    // Send to background for storage
    chrome.runtime.sendMessage({
      type: 'LOG_ENTRY',
      log: entry
    }).catch(() => {});
  }

  info(message, context) {
    this.log('info', message, context);
  }

  warn(message, context) {
    this.log('warn', message, context);
  }

  error(message, context) {
    this.log('error', message, context);
  }

  getLogs() {
    return this.logs;
  }
}

export { Logger };
