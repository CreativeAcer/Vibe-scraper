// Simple scraper runner without modules - injected dynamically
(function() {
  // Prevent duplicate injection
  if (window.__SCRAPER_RUNNER_LOADED__) {
    console.log('⚠️ Scraper runner already loaded, skipping duplicate injection');
    return;
  }
  window.__SCRAPER_RUNNER_LOADED__ = true;
  
  console.log('🚀 Scraper runner loaded');
  
  // Safe message sending helper
  function safeSendMessage(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(err => {
        // Ignore "Extension context invalidated" errors (normal on reload)
        if (!err.message?.includes('Extension context invalidated')) {
          console.warn('⚠️ Message send failed:', err.message);
        }
        return Promise.reject(err); // Re-throw for caller's .catch()
      });
    } catch (error) {
      console.warn('⚠️ Message send error:', error.message);
      return Promise.reject(error);
    }
  }
  
  // Global flag to stop scraping
  let shouldStop = false;
  
  // Listen for START_WORKFLOW message
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Message received:', message.type);
    
    if (message.type === 'PING') {
      console.log('🏓 PING received, responding...');
      sendResponse({ success: true, ready: true });
      return true;
    }
    
    if (message.type === 'START_WORKFLOW') {
      // Reset stop flag
      shouldStop = false;
      
      // Send immediate response to prevent channel timeout
      sendResponse({ success: true, started: true });
      
      // Continue scraping asynchronously
      startScraping(message.config)
        .then((result) => {
          console.log('✅ Scraping completed');
          
          // Remove visual overlay
          removeScrapingOverlay();
          
          // Notify background that scraping is complete
          safeSendMessage({
            type: 'SCRAPING_COMPLETED',
            jobId: message.config.jobId,
            result: {
              itemsScraped: result.itemCount,
              success: true
            }
          });
        })
        .catch(error => {
          console.error('❌ Scraping error:', error);
          
          // Remove visual overlay
          removeScrapingOverlay();
          
          // Notify background of failure
          safeSendMessage({
            type: 'SCRAPING_FAILED',
            jobId: message.config.jobId,
            error: error.message
          });
        });
      
      return true; // Keep channel open (but we already responded)
    }
    
    if (message.type === 'STOP_WORKFLOW') {
      console.log('⏹️ Stop scraping requested');
      shouldStop = true; // Set stop flag
      removeScrapingOverlay(); // Remove overlay immediately
      sendResponse({ success: true, stopped: true });
      return true;
    }
  });
  
  // Simple scraping function with pagination and infinite scroll support
  async function startScraping(config) {
    console.log('🎯 Starting scraping with config:', config);
    
    // Show visual overlay on page
    showScrapingOverlay();
    
    const { listing, export: exportConfig, pagination, infiniteScroll, loadMore } = config;
    let allResults = [];
    let currentPage = 1;
    let hasMore = true;
    
    // Check scraping type
    const isInfiniteScroll = infiniteScroll && infiniteScroll.enabled;
    const isPagination = pagination && pagination.enabled;
    const isLoadMore = loadMore && loadMore.enabled;
    
    if (isLoadMore) {
      console.log('🔄 Load More Mode: Enabled');
      console.log(`   Load More button: ${loadMore.buttonSelector}`);
      console.log(`   Max clicks: ${loadMore.maxClicks || 10}`);
      console.log(`   Click delay: ${loadMore.delayMs || 2000}ms`);
      
      // Load More button scraping
      allResults = await scrapeWithLoadMore(listing, loadMore, config.jobId);
      
    } else if (isInfiniteScroll) {
      console.log('♾️ Infinite Scroll Mode: Enabled');
      console.log(`   Max scrolls: ${infiniteScroll.maxScrolls || 10}`);
      console.log(`   Scroll delay: ${infiniteScroll.delayMs || 2000}ms`);
      
      // Infinite scroll scraping
      allResults = await scrapeWithInfiniteScroll(listing, infiniteScroll, config.jobId);
      
    } else if (isPagination) {
      console.log(`📄 Pagination Mode: Enabled (max ${pagination.maxPages || 10} pages)`);
      console.log(`📊 Pagination config:`, pagination);
      console.log(`📊 Pagination type:`, pagination.type);
      console.log(`📊 Is queryParam?`, pagination.type === 'queryParam');
      console.log(`📊 Is button?`, pagination.type === 'button');
      
      // Check if it's query parameter pagination
      if (pagination.type === 'queryParam') {
        console.log('🔗 Query Parameter Pagination - Using background orchestration');
        
        // For query param, background script will handle fetching
        // We just scrape the first (current) page
        const currentPageResults = await scrapePage(listing, 1, 0);
        allResults = allResults.concat(currentPageResults);
        
        console.log(`✅ Page 1: Extracted ${currentPageResults.length} items`);
        
        // Now let background script fetch remaining pages
        const param = pagination.param || 'page';
        const baseUrl = new URL(window.location.href);
        
        for (let page = 2; page <= (pagination.maxPages || 10); page++) {
          // Check if user stopped scraping
          if (shouldStop) {
            console.log('⏹️ Scraping stopped by user');
            break;
          }
          
          console.log(`\n📄 Fetching page ${page} via background...`);
          
          // Update overlay to show we're fetching
          updateScrapingOverlay(0, 0, page, `Fetching page ${page}...`, allResults.length);
          
          // Build URL for next page
          baseUrl.searchParams.set(param, page.toString());
          const pageUrl = baseUrl.toString();
          
          console.log(`   URL: ${pageUrl}`);
          
          try {
            console.log(`📤 [CONTENT] Sending message to background...`);
            
            // Ask background to fetch the HTML
            const response = await chrome.runtime.sendMessage({
              type: 'SCRAPE_QUERY_PARAM_PAGE',
              url: pageUrl,
              config: config
            });
            
            console.log(`📥 [CONTENT] Response received:`, response);
            
            if (!response) {
              console.error(`❌ [CONTENT] No response from background!`);
              break;
            }
            
            if (!response.success) {
              console.error(`❌ [CONTENT] Background returned error:`, response.error);
              break;
            }
            
            if (!response.html) {
              console.error(`❌ [CONTENT] Response missing HTML`);
              break;
            }
            
            // Parse HTML using DOMParser (available in content script!)
            console.log(`🔍 [CONTENT] Parsing HTML with DOMParser...`);
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.html, 'text/html');
            
            // Extract items from parsed document
            const baseUrl = new URL(response.url);
            const items = [];
            const itemElements = doc.querySelectorAll(config.listing.itemSelector);
            
            console.log(`📊 [CONTENT] Found ${itemElements.length} items in parsed HTML`);
            
            for (const item of itemElements) {
              const itemData = {};
              
              for (const field of config.listing.fields) {
                try {
                  const element = item.querySelector(field.selector);
                  
                  if (element) {
                    let value;
                    
                    switch (field.attr) {
                      case 'text':
                        value = element.textContent.trim();
                        break;
                      case 'href':
                        const href = element.getAttribute('href');
                        value = href ? new URL(href, baseUrl).href : null;
                        break;
                      case 'src':
                        const src = element.getAttribute('src');
                        value = src ? new URL(src, baseUrl).href : null;
                        break;
                      default:
                        value = element.getAttribute(field.attr);
                    }
                    
                    itemData[field.name] = value;
                  } else {
                    itemData[field.name] = null;
                  }
                } catch (error) {
                  console.warn(`Field extraction failed: ${field.name}`, error);
                  itemData[field.name] = null;
                }
              }
              
              if (Object.keys(itemData).length > 0) {
                items.push(itemData);
              }
            }
            
            if (items.length === 0) {
              console.warn(`⚠️ [CONTENT] Page ${page} parsed but found 0 items`);
              break;
            }
            
            console.log(`✅ Page ${page}: Extracted ${items.length} items`);
            console.log(`   Sample item:`, items[0]);
            
            allResults = allResults.concat(items);
            console.log(`   Total so far: ${allResults.length} items`);
            
            // Update overlay with progress
            updateScrapingOverlay(
              items.length, 
              items.length, 
              page, 
              `Page ${page} complete`, 
              allResults.length
            );
              
            // Send progress update
            safeSendMessage({
              type: 'PROGRESS_UPDATE',
              jobId: config.jobId,
              progress: {
                itemsScraped: allResults.length,
                currentPage: page,
                totalItems: allResults.length,
                percentage: Math.round((page / (pagination.maxPages || 10)) * 100)
              }
            });
            
            // Delay between pages
            await new Promise(resolve => setTimeout(resolve, pagination.delayMs || 2000));
          } catch (error) {
            console.error(`❌ [CONTENT] Error in message handling for page ${page}:`, error);
            console.error(`   Error details:`, error.message);
            break;
          }
        }
        
        console.log(`✅ Query param pagination complete: ${allResults.length} total items`);
        
      } else {
        // Traditional button-based pagination
        console.log('🔘 Button Pagination - Using navigation');
        
        while (hasMore) {
          // Check if user stopped scraping
          if (shouldStop) {
            console.log('⏹️ Scraping stopped by user');
            break;
          }
          
          console.log(`\n📄 Scraping page ${currentPage}...`);
          
          // Update overlay for new page
          updateScrapingOverlay(0, 0, currentPage, `Loading page ${currentPage}...`, allResults.length);
          
          const pageResults = await scrapePage(listing, currentPage, allResults.length);
        
        // Check for duplicates (indicates pagination not working)
        if (currentPage > 1 && pageResults.length > 0) {
          // Check if we scraped the SAME page again (multiple matching items)
          // Not just if one item happens to be the same
          
          let matchCount = 0;
          const sampleSize = Math.min(5, pageResults.length); // Check first 5 items
          
          for (let i = 0; i < sampleSize; i++) {
            const newItem = pageResults[i];
            const newItemTitle = newItem.title || Object.values(newItem)[0];
            
            // Check if this item exists in previous results
            const exists = allResults.some(prevItem => {
              const prevItemTitle = prevItem.title || Object.values(prevItem)[0];
              return newItemTitle === prevItemTitle;
            });
            
            if (exists) {
              matchCount++;
            }
          }
          
          // If 3+ out of 5 items match, it's the same page
          if (matchCount >= 3) {
            console.error('❌ DUPLICATE DETECTED!');
            console.error(`   ${matchCount} out of ${sampleSize} items match previous pages`);
            console.error('   This means pagination is not working correctly');
            console.error('   Same page was scraped twice');
            console.error('   Stopping to avoid duplicate data...');
            hasMore = false;
            break;
          } else if (matchCount > 0) {
            console.log(`⚠️ ${matchCount} items overlap with previous pages (might be ok)`);
            console.log('✅ Continuing - not enough duplicates to indicate same page');
          } else {
            console.log('✅ No duplicates detected - pagination working correctly');
          }
        }
        
        allResults = allResults.concat(pageResults);
        
        console.log(`✅ Page ${currentPage}: Extracted ${pageResults.length} items (total: ${allResults.length})`);
        
        // Send progress update
        safeSendMessage({
          type: 'PROGRESS_UPDATE',
          jobId: config.jobId,
          progress: {
            itemsScraped: allResults.length,
            currentPage: currentPage,
            totalItems: allResults.length,
            percentage: 0
          }
        });
        
        // Check if we should continue to next page
        if (currentPage >= (pagination.maxPages || 10)) {
          console.log('🛑 Stopping: Max pages reached');
          hasMore = false;
        } else {
          const navigated = await goToNextPage(pagination, listing);
          
          if (!navigated) {
            console.log('🛑 Stopping: No more pages found');
            hasMore = false;
          } else {
            currentPage++;
            await new Promise(resolve => setTimeout(resolve, pagination.delayMs || 2000));
          }
        }
      } // End while (hasMore)
      } // End button pagination else
      
    } else {
      // Single page scraping
      console.log('📄 Single Page Mode');
      allResults = await scrapePage(listing, 1, 0);
    }
    
    console.log(`✅ Extracted ${allResults.length} items total`);
    
    // Export to CSV
    exportToCSV(allResults, exportConfig.filename || 'data.csv');
    
    // Return result for completion notification
    return {
      itemCount: allResults.length,
      pageCount: currentPage,
      success: true
    };
  }
  
  // Scrape with Load More button
  async function scrapeWithLoadMore(listing, loadMore, jobId) {
    const maxClicks = loadMore.maxClicks || 10;
    const delayMs = loadMore.delayMs || 2000;
    const buttonSelector = loadMore.buttonSelector;
    const itemSelector = listing.itemSelector;
    
    let allResults = [];
    let clickCount = 0;
    let noNewItemsCount = 0;
    
    console.log('🔄 Starting Load More button scraping...');
    console.log(`   Button selector: ${buttonSelector}`);
    console.log(`   Max clicks: ${maxClicks}`);
    
    // Initial scrape of visible items
    console.log('\n📊 Scraping initial items...');
    const initialResults = await scrapePage(listing, 1, 0);
    allResults = allResults.concat(initialResults);
    console.log(`✅ Initial scrape: ${initialResults.length} items`);
    
    // Send initial progress
    safeSendMessage({
      type: 'PROGRESS_UPDATE',
      jobId: jobId,
      progress: {
        itemsScraped: allResults.length,
        currentPage: 1,
        totalItems: allResults.length,
        percentage: Math.round((1 / maxClicks) * 100)
      }
    });
    
    // Click Load More button repeatedly
    for (let i = 0; i < maxClicks; i++) {
      console.log(`\n🔄 Click ${i + 1}/${maxClicks}`);
      
      // Find Load More button
      const loadMoreBtn = document.querySelector(buttonSelector);
      
      if (!loadMoreBtn) {
        console.log('⚠️ Load More button not found');
        console.log('   Possible reasons:');
        console.log('   - All items loaded');
        console.log('   - Button selector incorrect');
        console.log('   - Button hidden/removed');
        break;
      }
      
      // Check if button is disabled or hidden
      if (loadMoreBtn.disabled || 
          loadMoreBtn.style.display === 'none' || 
          loadMoreBtn.classList.contains('disabled')) {
        console.log('⚠️ Load More button is disabled or hidden - no more items');
        break;
      }
      
      // Count items before click
      const itemsBefore = document.querySelectorAll(itemSelector).length;
      console.log(`   Items before click: ${itemsBefore}`);
      
      // Click the button
      console.log('   🖱️ Clicking Load More button...');
      loadMoreBtn.click();
      
      // Wait for new items to load
      console.log(`   ⏳ Waiting ${delayMs}ms for items to load...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      // Count items after click
      const itemsAfter = document.querySelectorAll(itemSelector).length;
      console.log(`   Items after click: ${itemsAfter}`);
      
      const newItemsCount = itemsAfter - itemsBefore;
      
      if (newItemsCount > 0) {
        console.log(`   📊 ${newItemsCount} new items loaded, scraping...`);
        
        // Scrape the new items only
        const allItems = document.querySelectorAll(itemSelector);
        const newItems = Array.from(allItems).slice(itemsBefore);
        
        for (let j = 0; j < newItems.length; j++) {
          const item = newItems[j];
          const itemData = {};
          
          // Extract each field
          for (const field of listing.fields) {
            try {
              const element = item.querySelector(field.selector);
              
              if (element) {
                let value;
                
                switch (field.attr) {
                  case 'text':
                    value = element.textContent.trim();
                    break;
                  case 'href':
                    value = element.href;
                    break;
                  case 'src':
                    value = element.src;
                    break;
                  default:
                    value = element.getAttribute(field.attr);
                }
                
                itemData[field.name] = value;
              } else {
                itemData[field.name] = null;
              }
            } catch (error) {
              itemData[field.name] = null;
            }
          }
          
          allResults.push(itemData);
          
          // Send current item update
          safeSendMessage({
            type: 'CURRENT_ITEM_UPDATE',
            jobId: jobId,
            currentItem: itemData[listing.fields[0]?.name] || 'Item',
            itemNumber: allResults.length,
            totalItems: itemsAfter,
            pageNumber: i + 2 // +2 because we already did initial scrape
          });
        }
        
        console.log(`   ✅ Scraped ${newItemsCount} new items (total: ${allResults.length})`);
        noNewItemsCount = 0; // Reset counter
        clickCount++;
        
        // Send progress update
        safeSendMessage({
          type: 'PROGRESS_UPDATE',
          jobId: jobId,
          progress: {
            itemsScraped: allResults.length,
            currentPage: clickCount + 1,
            totalItems: allResults.length,
            percentage: Math.round(((clickCount + 1) / maxClicks) * 100)
          }
        });
        
      } else {
        console.log(`   ⚠️ No new items loaded`);
        noNewItemsCount++;
        
        // If no new items for 3 clicks in a row, stop
        if (noNewItemsCount >= 3) {
          console.log('🛑 Stopping: No new items loaded after 3 Load More clicks');
          break;
        }
      }
      
      // Update overlay
      updateScrapingOverlay(
        allResults.length,
        itemsAfter,
        clickCount + 1,
        `Loaded ${clickCount + 1} times`,
        allResults.length
      );
    }
    
    console.log(`\n✅ Load More scraping complete: ${allResults.length} total items after ${clickCount} clicks`);
    
    return allResults;
  }
  
  // Scrape with infinite scroll
  async function scrapeWithInfiniteScroll(listing, infiniteScroll, jobId) {
    const maxScrolls = infiniteScroll.maxScrolls || 10;
    const delayMs = infiniteScroll.delayMs || 2000;
    const itemSelector = listing.itemSelector;
    
    let allResults = [];
    let previousCount = 0;
    let scrollAttempts = 0;
    let noNewItemsCount = 0;
    
    console.log('♾️ Starting infinite scroll scraping...');
    
    for (let i = 0; i < maxScrolls; i++) {
      // Get current items
      const currentItems = document.querySelectorAll(itemSelector);
      const currentCount = currentItems.length;
      
      console.log(`\n🔄 Scroll ${i + 1}/${maxScrolls}`);
      console.log(`   Items on page: ${currentCount}`);
      
      // Scrape new items (only the ones we haven't scraped yet)
      const newItems = Array.from(currentItems).slice(previousCount);
      
      if (newItems.length > 0) {
        console.log(`   📊 Scraping ${newItems.length} new items...`);
        
        for (let j = 0; j < newItems.length; j++) {
          const item = newItems[j];
          const itemData = {};
          
          // Extract each field
          for (const field of listing.fields) {
            try {
              const element = item.querySelector(field.selector);
              
              if (element) {
                let value;
                
                switch (field.attr) {
                  case 'text':
                    value = element.textContent.trim();
                    break;
                  case 'href':
                    value = element.href;
                    break;
                  case 'src':
                    value = element.src;
                    break;
                  default:
                    value = element.getAttribute(field.attr);
                }
                
                itemData[field.name] = value;
              } else {
                itemData[field.name] = null;
              }
            } catch (error) {
              itemData[field.name] = null;
            }
          }
          
          allResults.push(itemData);
        }
        
        console.log(`   ✅ Scraped ${newItems.length} new items (total: ${allResults.length})`);
        noNewItemsCount = 0; // Reset counter
        
      } else {
        console.log(`   ⚠️ No new items found`);
        noNewItemsCount++;
        
        // If no new items for 3 scrolls in a row, stop
        if (noNewItemsCount >= 3) {
          console.log('🛑 Stopping: No new items loaded after 3 scroll attempts');
          break;
        }
      }
      
      // Send progress update
      safeSendMessage({
        type: 'PROGRESS_UPDATE',
        jobId: jobId,
        progress: {
          itemsScraped: allResults.length,
          currentPage: i + 1,
          totalItems: allResults.length,
          percentage: Math.round(((i + 1) / maxScrolls) * 100)
        }
      });
      
      // Check if we're at max scrolls
      if (i >= maxScrolls - 1) {
        console.log('🛑 Stopping: Max scrolls reached');
        break;
      }
      
      // Scroll to bottom
      console.log('   📜 Scrolling to bottom...');
      window.scrollTo(0, document.body.scrollHeight);
      
      // Wait for new content to load
      console.log(`   ⏳ Waiting ${delayMs}ms for content to load...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      previousCount = currentCount;
    }
    
    return allResults;
  }
  
  // Show scraping progress overlay
  function showScrapingOverlay() {
    // Remove existing overlay if any
    const existing = document.getElementById('scraper-progress-overlay');
    if (existing) existing.remove();
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'scraper-progress-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-width: 320px;
      max-width: 400px;
      animation: slideIn 0.3s ease-out;
    `;
    
    overlay.innerHTML = `
      <style>
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        #scraper-progress-overlay .header {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        #scraper-progress-overlay .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        #scraper-progress-overlay .stats {
          background: rgba(255,255,255,0.15);
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 12px;
        }
        #scraper-progress-overlay .stat-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 6px;
          font-size: 13px;
        }
        #scraper-progress-overlay .stat-row:last-child {
          margin-bottom: 0;
        }
        #scraper-progress-overlay .stat-label {
          opacity: 0.9;
        }
        #scraper-progress-overlay .stat-value {
          font-weight: 600;
        }
        #scraper-progress-overlay .current-item {
          background: rgba(255,255,255,0.2);
          padding: 10px;
          border-radius: 6px;
          font-size: 12px;
          line-height: 1.4;
          max-height: 80px;
          overflow: hidden;
          animation: pulse 2s ease-in-out infinite;
        }
        #scraper-progress-overlay .current-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          opacity: 0.8;
          margin-bottom: 4px;
        }
      </style>
      <div class="header">
        <div class="spinner"></div>
        <span>Web Scraper Pro</span>
      </div>
      <div class="stats">
        <div class="stat-row">
          <span class="stat-label">Items:</span>
          <span class="stat-value" id="overlay-items">0</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Page:</span>
          <span class="stat-value" id="overlay-page">1</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Progress:</span>
          <span class="stat-value" id="overlay-progress">0/0</span>
        </div>
      </div>
      <div class="current-item">
        <div class="current-label">📍 Currently Scraping:</div>
        <div id="overlay-current-item">Initializing...</div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    console.log('✅ Scraping overlay created');
    
    // Test update immediately
    setTimeout(() => {
      console.log('🧪 Testing overlay update...');
      updateScrapingOverlay(0, 0, 1, 'Testing overlay updates...', 0);
    }, 100);
  }
  
  // Update overlay with current item
  function updateScrapingOverlay(itemNumber, totalItems, pageNumber, itemPreview, totalScraped) {
    console.log('🎨 updateScrapingOverlay called:', {
      itemNumber,
      totalItems, 
      pageNumber,
      itemPreview: itemPreview?.substring(0, 50),
      totalScraped
    });
    
    const overlay = document.getElementById('scraper-progress-overlay');
    if (!overlay) {
      console.error('❌ Overlay element not found!');
      return;
    }
    
    const itemsEl = document.getElementById('overlay-items');
    const pageEl = document.getElementById('overlay-page');
    const progressEl = document.getElementById('overlay-progress');
    const currentEl = document.getElementById('overlay-current-item');
    
    console.log('📍 Overlay elements:', {
      overlay: !!overlay,
      itemsEl: !!itemsEl,
      pageEl: !!pageEl,
      progressEl: !!progressEl,
      currentEl: !!currentEl
    });
    
    if (itemsEl) {
      itemsEl.textContent = totalScraped || 0;
      console.log(`✅ Items updated: ${totalScraped}`);
    }
    if (pageEl) {
      pageEl.textContent = pageNumber || 1;
      console.log(`✅ Page updated: ${pageNumber}`);
    }
    if (progressEl) {
      progressEl.textContent = `${itemNumber}/${totalItems}`;
      console.log(`✅ Progress updated: ${itemNumber}/${totalItems}`);
    }
    if (currentEl) {
      const oldText = currentEl.textContent;
      currentEl.textContent = itemPreview || 'Processing...';
      const newText = currentEl.textContent;
      console.log(`✅ Current item updated:`);
      console.log(`   OLD: "${oldText}"`);
      console.log(`   NEW: "${newText}"`);
      console.log(`   Changed: ${oldText !== newText}`);
    } else {
      console.error(`❌ currentEl not found!`);
    }
  }
  
  // Remove overlay
  function removeScrapingOverlay() {
    const overlay = document.getElementById('scraper-progress-overlay');
    if (overlay) {
      overlay.style.animation = 'slideIn 0.3s ease-out reverse';
      setTimeout(() => overlay.remove(), 300);
      console.log('✅ Scraping overlay removed');
    }
  }
  
  // Scrape current page
  async function scrapePage(listing, pageNumber, previousItemsCount = 0) {
    const items = document.querySelectorAll(listing.itemSelector);
    
    console.log(`📊 Found ${items.length} items with selector: ${listing.itemSelector}`);
    console.log(`📊 Previous items count: ${previousItemsCount}`);
    
    if (items.length === 0) {
      console.warn(`⚠️ No items found on page ${pageNumber}`);
      return [];
    }
    
    const results = [];
    
    console.log(`🔄 Starting to process ${items.length} items...`);
    
    // Extract data from each item
    for (let i = 0; i < items.length; i++) {
      // Check if user stopped scraping
      if (shouldStop) {
        console.log('⏹️ Scraping stopped by user during item extraction');
        break;
      }
      
      console.log(`⚙️ Processing item ${i + 1}/${items.length}...`);
      
      const item = items[i];
      const itemData = {};
      
      // Update overlay FIRST (before extraction) with item number
      let totalScraped = previousItemsCount + results.length; // Items completed so far
      updateScrapingOverlay(i + 1, items.length, pageNumber, 'Extracting data...', totalScraped);
      
      // Extract each field
      for (const field of listing.fields) {
        try {
          const element = item.querySelector(field.selector);
          
          if (element) {
            let value;
            
            switch (field.attr) {
              case 'text':
                value = element.textContent.trim();
                break;
              case 'href':
                value = element.href;
                break;
              case 'src':
                value = element.src;
                break;
              default:
                value = element.getAttribute(field.attr);
            }
            
            itemData[field.name] = value;
            console.log(`  ✓ ${field.name}: ${value?.substring(0, 50)}...`);
          } else {
            itemData[field.name] = null;
            console.log(`  ✗ ${field.name}: element not found`);
          }
        } catch (error) {
          console.warn(`Field extraction failed: ${field.name}`, error);
          itemData[field.name] = null;
        }
      }
      
      results.push(itemData);
      console.log(`  ✅ Item ${i + 1} complete`);
      console.log(`  📦 itemData keys:`, Object.keys(itemData));
      console.log(`  📦 itemData values:`, Object.values(itemData).map(v => typeof v === 'string' ? v.substring(0, 30) : v));
      
      // Get item preview
      const itemPreview = getItemPreview(itemData);
      console.log(`📍 Item preview generated: "${itemPreview}"`);
      console.log(`📍 Preview length: ${itemPreview?.length} chars`);
      
      // Update visual overlay on page with ACTUAL preview
      totalScraped = previousItemsCount + results.length; // Recalculate after adding to results
      console.log(`📊 Updating overlay: item ${i + 1}/${items.length}, page ${pageNumber}, total ${totalScraped}`);
      console.log(`📊 Preview being sent to overlay: "${itemPreview?.substring(0, 80)}"`);
      updateScrapingOverlay(i + 1, items.length, pageNumber, itemPreview, totalScraped);
      
      // Small delay to allow DOM to update and make progress visible
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
      
      // Send current item update to popup
      safeSendMessage({
        type: 'CURRENT_ITEM_UPDATE',
        jobId: listing.jobId,
        currentItem: itemPreview,
        itemNumber: i + 1,
        totalItems: items.length,
        pageNumber: pageNumber
      }).then(() => {
        console.log(`  ✅ Current item update sent successfully`);
      }).catch((error) => {
        console.log(`  ⚠️ Current item update failed (popup might be closed):`, error.message);
      });
    }
    
    return results;
  }
  
  // Get preview text for current item
  function getItemPreview(itemData) {
    console.log('🔍 Getting item preview from:', JSON.stringify(itemData, null, 2));
    
    if (!itemData || typeof itemData !== 'object') {
      console.warn('⚠️ itemData is not an object:', itemData);
      return 'No data';
    }
    
    // Try to find most relevant field (case-insensitive)
    const priorityFields = ['title', 'name', 'product', 'product_name', 'product-name', 'heading', 'label'];
    
    // First try priority fields (case-insensitive)
    for (const fieldName of priorityFields) {
      // Try exact match first
      if (itemData[fieldName]) {
        const value = itemData[fieldName];
        if (value && typeof value === 'string' && value.trim()) {
          const preview = value.trim().substring(0, 100);
          console.log(`✅ Found priority field '${fieldName}': "${preview}"`);
          return preview;
        }
      }
      
      // Try case-insensitive match
      for (const [key, value] of Object.entries(itemData)) {
        if (key.toLowerCase() === fieldName.toLowerCase()) {
          if (value && typeof value === 'string' && value.trim()) {
            const preview = value.trim().substring(0, 100);
            console.log(`✅ Found priority field '${key}' (case-insensitive): "${preview}"`);
            return preview;
          }
        }
      }
    }
    
    // If no priority field, use first non-empty field
    console.log('⚠️ No priority field found, trying first non-empty field');
    for (const [key, value] of Object.entries(itemData)) {
      if (value && typeof value === 'string' && value.trim()) {
        const preview = `${key}: ${value.trim().substring(0, 80)}`;
        console.log(`✅ Using first field '${key}': "${preview}"`);
        return preview;
      }
    }
    
    console.log('⚠️ No preview field found at all, itemData keys:', Object.keys(itemData));
    return 'Item data extracted';
  }
  
  // Navigate to next page
  async function goToNextPage(pagination, listing) {
    console.log('🔍 Looking for next page...');
    console.log('   Pagination type:', pagination.type);
    
    // Handle URL query parameter pagination
    if (pagination.type === 'queryParam') {
      console.log('   Query parameter mode - single page only');
      console.log('   No navigation (user must manually go to next page)');
      return false; // Stop pagination, scrape current page only
    }
    
    // Handle button-based pagination
    console.log('   Button mode');
    console.log('   Selector:', pagination.nextButtonSelector);
    
    // Helper to get current page number from URL
    function getCurrentPageNumber() {
      const urlParams = new URLSearchParams(window.location.search);
      const pageParam = urlParams.get('page');
      return pageParam ? parseInt(pageParam) : 1;
    }
    
    // Helper to wait for page change
    async function waitForPageChange(itemSelector, firstItemTextBefore) {
      console.log('🔄 Waiting for page transition...');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log('🔄 Waiting for new content to load...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      for (let attempt = 0; attempt < 20; attempt++) {
        const firstItemAfter = document.querySelector(itemSelector);
        const firstItemTextAfter = firstItemAfter?.textContent?.trim().substring(0, 50) || '';
        
        console.log(`   Check ${attempt + 1}/20: "${firstItemTextAfter.substring(0, 30)}..."`);
        
        if (firstItemTextAfter && firstItemTextAfter !== firstItemTextBefore) {
          console.log('✅ Content changed!');
          console.log('   First item before:', firstItemTextBefore);
          console.log('   First item after:', firstItemTextAfter);
          await new Promise(resolve => setTimeout(resolve, 500));
          return true;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      console.warn('⚠️ Content did not change after multiple checks');
      console.log('🔄 Trying one more time with longer delay...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const finalCheck = document.querySelector(itemSelector);
      const finalText = finalCheck?.textContent?.trim().substring(0, 50) || '';
      
      if (finalText && finalText !== firstItemTextBefore) {
        console.log('✅ Content changed on final check!');
        return true;
      }
      
      console.warn('⚠️ Continuing anyway - will check if scraped data is different...');
      return true;
    }
    
    // Try to find next button
    let nextButton = document.querySelector(pagination.nextButtonSelector);
    
    if (!nextButton) {
      console.log('❌ Next button not found with provided selector');
      console.log('   Trying common next button patterns...');
      
      // Try common next button selectors
      const commonSelectors = [
        'a[aria-label*="next" i]',
        'a[aria-label*="Next"]',
        'button[aria-label*="next" i]',
        'a:contains("Next")',
        'a:contains("→")',
        'a:contains("›")',
        'a:contains("»")',
        'button:contains("Next")',
        '.pagination-next:not([href*="page="])', // Next button without page number
        '.next-page',
        '.page-next',
        'a.next'
      ];
      
      for (const selector of commonSelectors) {
        // Handle :contains pseudo-selector manually
        if (selector.includes(':contains')) {
          const match = selector.match(/^([^:]+):contains\("([^"]+)"\)$/);
          if (match) {
            const [, baseSelector, text] = match;
            const candidates = document.querySelectorAll(baseSelector);
            nextButton = Array.from(candidates).find(el => el.textContent.includes(text));
            if (nextButton) {
              console.log(`✅ Found with pattern: ${selector}`);
              break;
            }
          }
        } else {
          nextButton = document.querySelector(selector);
          if (nextButton) {
            console.log(`✅ Found with pattern: ${selector}`);
            break;
          }
        }
      }
      
      if (!nextButton) {
        console.log('   Available links:', document.querySelectorAll('a').length);
        console.log('   Available buttons:', document.querySelectorAll('button').length);
        return false;
      }
    }
    
    // DataTables / data-dt-idx pagination handling
    // data-dt-idx is a keyboard-navigation index, not a page number.
    // When the user's selector resolves to a data-dt-idx element we redirect to
    // the real "Next" control so we always advance exactly one page at a time.
    if (nextButton && nextButton.hasAttribute('data-dt-idx')) {
      console.log('📋 DataTables pagination detected (data-dt-idx)');

      // Walk up to find the pagination container
      const container = nextButton.closest('.dataTables_paginate, [role="navigation"]')
                      || nextButton.parentElement?.parentElement
                      || document;

      const allDtBtns = Array.from(container.querySelectorAll('[data-dt-idx]'));

      // Strategy 1: find the element with class "next" — DataTables always uses this
      const dtNext = allDtBtns.find(el =>
        el.classList.contains('next') ||
        el.textContent.trim().toLowerCase() === 'next' ||
        (el.getAttribute('aria-label') || '').toLowerCase().includes('next')
      );

      if (dtNext) {
        const isDisabled = dtNext.classList.contains('disabled') ||
                           dtNext.getAttribute('aria-disabled') === 'true' ||
                           dtNext.getAttribute('tabindex') === '-1';
        if (isDisabled) {
          console.log('🛑 DataTables "Next" is disabled — last page reached');
          return false;
        }
        nextButton = dtNext;
        console.log('✅ Using DataTables Next button:', nextButton.textContent.trim());
      } else {
        // Strategy 2: find the currently active page number, then click number+1
        const activePage = allDtBtns.find(el =>
          el.classList.contains('current') || el.classList.contains('active')
        );
        if (activePage) {
          const currentNum = parseInt(activePage.textContent.trim());
          if (!isNaN(currentNum)) {
            const nextNumBtn = allDtBtns.find(el => {
              const n = parseInt(el.textContent.trim());
              return n === currentNum + 1 && !el.classList.contains('disabled');
            });
            if (nextNumBtn) {
              nextButton = nextNumBtn;
              console.log(`✅ Clicking DataTables page ${currentNum + 1}`);
            } else {
              console.log('🛑 No next page available in DataTables — last page reached');
              return false;
            }
          }
        }
      }
    }

    // Additional check: If button has a page number in href, it's probably wrong
    if (nextButton.href && pagination.nextButtonSelector) {
      const url = new URL(nextButton.href, window.location.href);
      const pageParam = url.searchParams.get('page');
      
      if (pageParam && /^\d+$/.test(pageParam)) {
        // It's a numbered page link, not a "Next" button
        console.warn('⚠️ Selector found a numbered page link, not a Next button');
        console.warn('   Looking for actual Next button...');
        
        // Find the REAL next button (with arrow or "Next" text)
        const allLinks = Array.from(document.querySelectorAll('a'));
        const realNextButton = allLinks.find(link => {
          const text = link.textContent.trim().toLowerCase();
          const ariaLabel = link.getAttribute('aria-label')?.toLowerCase() || '';
          
          return (
            text.includes('next') ||
            text.includes('→') ||
            text.includes('›') ||
            text.includes('»') ||
            ariaLabel.includes('next') ||
            link.classList.contains('next') ||
            (text === '' && link.querySelector('svg')) // Icon-only button
          );
        });
        
        if (realNextButton) {
          console.log('✅ Found real Next button:', realNextButton.textContent.trim() || '(icon)');
          nextButton = realNextButton;
        } else {
          console.log('⚠️ No Next button found, will use numbered pagination');
          // Fall through to use numbered button logic below
        }
      }
    }
    
    // Universal numbered pagination handler
    const buttonText = nextButton.textContent.trim();
    if (/^\d+$/.test(buttonText)) {
      const buttonPageNumber = parseInt(buttonText);
      const currentPageNumber = getCurrentPageNumber();
      
      console.log('   Numbered pagination detected');
      console.log('   Button says:', buttonPageNumber);
      console.log('   Current page:', currentPageNumber);
      
      if (buttonPageNumber <= currentPageNumber) {
        console.warn('⚠️ First button found points to current or previous page');
        console.log('   Strategy: Find all numbered buttons and click the one AFTER current');
        
        // Get ALL pagination buttons/links with the same selector
        const allPaginationElements = Array.from(document.querySelectorAll(pagination.nextButtonSelector));
        console.log(`   Found ${allPaginationElements.length} pagination elements`);
        
        // Filter to only numbered buttons and sort by page number
        const numberedButtons = allPaginationElements
          .filter(el => /^\d+$/.test(el.textContent.trim()))
          .map(el => ({
            element: el,
            pageNumber: parseInt(el.textContent.trim())
          }))
          .sort((a, b) => a.pageNumber - b.pageNumber);
        
        console.log('   Numbered buttons found:', numberedButtons.map(b => b.pageNumber).join(', '));
        
        // Find button with page number = currentPage + 1
        const targetPageNumber = currentPageNumber + 1;
        const targetButton = numberedButtons.find(b => b.pageNumber === targetPageNumber);
        
        if (targetButton) {
          console.log(`✅ Found button for page ${targetPageNumber}`);
          nextButton = targetButton.element;
        } else {
          console.error(`❌ No button found for page ${targetPageNumber}`);
          console.error('   Available pages:', numberedButtons.map(b => b.pageNumber).join(', '));
          console.error('   Might be on last page or pagination incomplete');
          return false;
        }
      } else {
        console.log('✅ Button page number is valid (greater than current)');
      }
    }
    
    console.log('✅ Next button found:', nextButton);
    console.log('   Tag:', nextButton.tagName);
    console.log('   Text:', nextButton.textContent.trim());
    console.log('   Href:', nextButton.href || 'N/A');
    console.log('   Classes:', nextButton.className);
    console.log('   ID:', nextButton.id || 'N/A');
    
    // Validate that this is actually a "next" button
    const buttonTextLower = nextButton.textContent.trim().toLowerCase();
    const hasNextIndicator = buttonTextLower.includes('next') || 
                            buttonTextLower.includes('→') || 
                            buttonTextLower.includes('›') || 
                            buttonTextLower.includes('»') ||
                            nextButton.getAttribute('aria-label')?.toLowerCase().includes('next') ||
                            nextButton.classList.contains('next');
    
    if (!hasNextIndicator) {
      console.warn('⚠️ Warning: Button does not seem to be a "next" button');
      console.warn('   Text:', buttonTextLower);
      console.warn('   This might navigate to wrong page!');
    }
    
    // If it's a link, check the URL
    if (nextButton.href) {
      const currentPageNumber = getCurrentPageNumber();
      console.log('   Current page number:', currentPageNumber);
      
      // Check if href contains page parameter
      let hrefPageParam = null;
      try {
        const hrefUrl = new URL(nextButton.href);
        hrefPageParam = hrefUrl.searchParams.get('page');
      } catch (e) {
        console.log('ℹ️ Button href is not a navigable URL — relying on click + DOM change detection');
      }

      if (hrefPageParam) {
        const targetPage = parseInt(hrefPageParam);
        console.log('   Target page from href:', targetPage);
        
        if (targetPage <= currentPageNumber) {
          console.error('❌ ERROR: Next button points to page', targetPage, 'but we are on page', currentPageNumber);
          console.error('   This would navigate backwards or to same page!');
          console.error('   Href:', nextButton.href);
          console.error('   Selector might be wrong. Looking for alternatives...');
          
          // Try to find correct next button
          const allLinks = Array.from(document.querySelectorAll('a'));
          const nextPageLink = allLinks.find(link => {
            const url = new URL(link.href, window.location.href);
            const pageParam = url.searchParams.get('page');
            return pageParam && parseInt(pageParam) === currentPageNumber + 1;
          });
          
          if (nextPageLink) {
            console.log('✅ Found correct next page link:', nextPageLink.href);
            console.log('   Using this instead!');
            nextPageLink.click();
            
            // Continue with content detection using this corrected navigation
            const itemSelector = listing?.itemSelector || 'a.product-card-link';
            const firstItemBefore = document.querySelector(itemSelector);
            const firstItemTextBefore = firstItemBefore?.textContent?.trim().substring(0, 50) || '';
            
            return await waitForPageChange(itemSelector, firstItemTextBefore);
          } else {
            console.error('❌ Could not find correct next page link');
            return false;
          }
        } else {
          console.log('✅ Target page is correct:', targetPage);
        }
      }
    }
    
    // Check if button is disabled
    if (nextButton.disabled || 
        nextButton.classList.contains('disabled') ||
        nextButton.getAttribute('aria-disabled') === 'true') {
      console.log('❌ Next button is disabled');
      return false;
    }
    
    // Store current URL to detect navigation
    const currentUrl = window.location.href;
    console.log('   Current URL:', currentUrl);
    
    // Store first item's text to detect when content changes
    const itemSelector = listing?.itemSelector || 'a.product-card-link';
    console.log('   Item selector:', itemSelector);
    const firstItemBefore = document.querySelector(itemSelector);
    const firstItemTextBefore = firstItemBefore?.textContent?.trim().substring(0, 50) || '';
    console.log('   First item before click:', firstItemTextBefore);
    
    // Click the button
    console.log('🖱️ Clicking next button...');
    nextButton.click();
    
    // Wait for page to change and return
    return await waitForPageChange(itemSelector, firstItemTextBefore);
  }
  
  // Simple CSV export
  function exportToCSV(data, filename) {
    if (data.length === 0) {
      console.warn('No data to export');
      return;
    }
    
    // Get headers from first item
    const headers = Object.keys(data[0]);
    
    // Create CSV content
    let csv = headers.join(',') + '\n';
    
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        // Escape quotes and wrap in quotes if contains comma or quote
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      });
      csv += values.join(',') + '\n';
    }
    
    // Create download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log('📥 CSV downloaded:', filename);
  }
  
  console.log('✅ Scraper runner ready');
})();
