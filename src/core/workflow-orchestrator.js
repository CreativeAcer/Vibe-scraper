// Workflow orchestrator for pagination, infinite scroll, and detail page navigation
import { ScrapingEngine, Logger } from './scraping-engine.js';

export class WorkflowOrchestrator {
  constructor(config) {
    this.config = config;
    this.engine = new ScrapingEngine(config);
    this.logger = new Logger(config.jobId);
    this.allItems = [];
    this.seenUrls = new Set();
    this.currentPage = 1;
  }

  /**
   * Main entry point to start scraping
   */
  async start() {
    try {
      this.logger.info('Starting scraping workflow', { url: this.config.startUrl });

      // Navigate to start URL
      await this.navigateToUrl(this.config.startUrl);

      // Wait for DOM
      await this.engine.waitForDOMReady();

      // Handle different workflow types
      if (this.config.infiniteScroll?.enabled) {
        await this.handleInfiniteScroll();
      } else if (this.config.pagination) {
        await this.handlePagination();
      } else {
        // Single page scraping
        await this.scrapCurrentPage();
      }

      this.logger.info('Scraping completed', { totalItems: this.allItems.length });
      
      return {
        success: true,
        items: this.allItems,
        stats: {
          totalItems: this.allItems.length,
          totalPages: this.currentPage,
          startTime: this.startTime,
          endTime: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error('Scraping workflow failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Handle pagination workflow
   */
  async handlePagination() {
    const pagination = this.config.pagination;
    const maxPages = pagination.maxPages || 10;
    let hasNextPage = true;
    let consecutiveEmptyPages = 0;

    while (hasNextPage && this.currentPage <= maxPages) {
      this.logger.info(`Scraping page ${this.currentPage}/${maxPages}`);

      // Scrap current page
      const items = await this.scrapCurrentPage();

      if (items.length === 0) {
        consecutiveEmptyPages++;
        if (pagination.stopOnNoNewItems && consecutiveEmptyPages >= 2) {
          this.logger.info('No new items found, stopping pagination');
          break;
        }
      } else {
        consecutiveEmptyPages = 0;
      }

      // Check if we've reached the limit
      if (this.config.limits?.maxItems && this.allItems.length >= this.config.limits.maxItems) {
        this.logger.info('Reached max items limit');
        break;
      }

      // Find and navigate to next page
      hasNextPage = await this.navigateToNextPage();

      if (hasNextPage) {
        // Random delay between pages
        const delay = this.engine.getRandomDelay(pagination.delayMs);
        this.logger.info(`Waiting ${delay}ms before next page`);
        await this.engine.delay(delay);
        this.currentPage++;

        // Save progress checkpoint
        await this.saveCheckpoint();
      }
    }
  }

  /**
   * Navigate to next page based on pagination config
   */
  async navigateToNextPage() {
    const pagination = this.config.pagination;

    try {
      if (pagination.type === 'queryParam') {
        // URL-based pagination
        const nextPage = this.currentPage + 1;
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set(pagination.param, nextPage);
        
        await this.navigateToUrl(currentUrl.href);
        await this.engine.waitForDOMReady();
        return true;
      } else if (pagination.type === 'button' && pagination.nextButtonSelector) {
        // Button-based pagination
        const nextButton = document.querySelector(pagination.nextButtonSelector);
        
        if (!nextButton || nextButton.disabled) {
          return false;
        }

        nextButton.click();
        await this.engine.delay(2000); // Wait for page load
        await this.engine.waitForDOMReady();
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Error navigating to next page', { error: error.message });
      return false;
    }
  }

  /**
   * Handle infinite scroll workflow
   */
  async handleInfiniteScroll() {
    const scrollConfig = this.config.infiniteScroll;
    const maxScrolls = scrollConfig.maxScrolls || 20;
    let scrollCount = 0;
    let previousItemCount = 0;
    let noNewItemsCount = 0;

    while (scrollCount < maxScrolls) {
      this.logger.info(`Scroll iteration ${scrollCount + 1}/${maxScrolls}`);

      // Scrap current viewport
      const items = await this.scrapCurrentPage();
      
      // Check if we got new items
      if (this.allItems.length === previousItemCount) {
        noNewItemsCount++;
        if (noNewItemsCount >= 3) {
          this.logger.info('No new items after multiple scrolls, stopping');
          break;
        }
      } else {
        noNewItemsCount = 0;
        previousItemCount = this.allItems.length;
      }

      // Check limits
      if (this.config.limits?.maxItems && this.allItems.length >= this.config.limits.maxItems) {
        this.logger.info('Reached max items limit');
        break;
      }

      // Scroll to bottom
      const scrolled = await this.scrollToBottom();
      if (!scrolled) {
        this.logger.info('Cannot scroll further, stopping');
        break;
      }

      // Random delay
      const delay = this.engine.getRandomDelay(scrollConfig.delayMs);
      await this.engine.delay(delay);

      scrollCount++;

      // Save checkpoint
      await this.saveCheckpoint();
    }
  }

  /**
   * Scroll to bottom of page
   */
  async scrollToBottom() {
    const previousHeight = document.body.scrollHeight;
    
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'smooth'
    });

    // Wait for new content to load
    await this.engine.delay(1500);

    const newHeight = document.body.scrollHeight;
    return newHeight > previousHeight;
  }

  /**
   * Scrap items from current page
   */
  async scrapCurrentPage() {
    try {
      // Wait for item selector to appear
      await this.engine.waitForSelector(this.config.listing.itemSelector, 5000);
    } catch (error) {
      this.logger.warn('Item selector not found on page');
      return [];
    }

    // Extract items
    const items = await this.engine.extractListingItems(document);
    
    // Handle detail page navigation if configured
    if (this.config.listing.detail?.followLink) {
      await this.enrichItemsWithDetailData(items);
    }

    // Deduplicate
    const newItems = this.deduplicateItems(items);
    this.allItems.push(...newItems);

    // Send progress update
    this.sendProgressUpdate();

    return newItems;
  }

  /**
   * Enrich items with detail page data
   */
  async enrichItemsWithDetailData(items) {
    const detailConfig = this.config.listing.detail;
    const maxConcurrent = 3; // Limit concurrent detail page loads

    for (let i = 0; i < items.length; i += maxConcurrent) {
      const batch = items.slice(i, Math.min(i + maxConcurrent, items.length));
      
      await Promise.all(batch.map(async (item) => {
        try {
          const detailUrl = item[detailConfig.followLink.attr] || 
                          (item.url ? item.url : null);
          
          if (!detailUrl) {
            return;
          }

          // Open detail page in new tab
          const detailData = await this.scrapeDetailPage(detailUrl, detailConfig.fields);
          
          // Merge detail data into item
          Object.assign(item, detailData);

          // Random delay
          const delay = this.engine.getRandomDelay(this.config.delays?.perActionMs || { min: 500, max: 1500 });
          await this.engine.delay(delay);
        } catch (error) {
          this.logger.error(`Error scraping detail page for item`, { error: error.message });
        }
      }));
    }
  }

  /**
   * Scrape detail page (executed via message to background)
   */
  async scrapeDetailPage(url, fields) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'SCRAPE_DETAIL_PAGE',
        url,
        fields,
        jobId: this.config.jobId
      }, (response) => {
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  /**
   * Deduplicate items based on configured keys
   */
  deduplicateItems(items) {
    if (!this.config.listing.dedupe?.keys) {
      return items;
    }

    const newItems = [];
    const keys = this.config.listing.dedupe.keys;

    for (const item of items) {
      const dedupeKey = keys.map(k => item[k]).join('|');
      
      if (!this.seenUrls.has(dedupeKey)) {
        this.seenUrls.add(dedupeKey);
        newItems.push(item);
      }
    }

    this.logger.info(`Deduplicated: ${items.length - newItems.length} duplicates removed`);
    return newItems;
  }

  /**
   * Navigate to URL (via message to background)
   */
  async navigateToUrl(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'NAVIGATE_TO_URL',
        url,
        jobId: this.config.jobId
      }, (response) => {
        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  /**
   * Save progress checkpoint
   */
  async saveCheckpoint() {
    const checkpoint = {
      jobId: this.config.jobId,
      currentPage: this.currentPage,
      itemsScraped: this.allItems.length,
      timestamp: new Date().toISOString()
    };

    await chrome.storage.local.set({
      [`checkpoint_${this.config.jobId}`]: checkpoint
    });
  }

  /**
   * Send progress update to popup
   */
  sendProgressUpdate() {
    chrome.runtime.sendMessage({
      type: 'PROGRESS_UPDATE',
      jobId: this.config.jobId,
      progress: {
        itemsScraped: this.allItems.length,
        currentPage: this.currentPage,
        timestamp: new Date().toISOString()
      }
    }).catch(() => {});
  }
}
