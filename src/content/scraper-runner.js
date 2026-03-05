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
  
  // ── Click helper ────────────────────────────────────────────────────────────
  //
  // Runs the click in the PAGE's main JS world via a script tag injection.
  // This is more reliable than el.click() from an isolated content-script
  // because some framework event handlers (jQuery plugins, DataTables, React
  // synthetic events, etc.) only respond to events that originate in the
  // main world.
  //
  // If the page's CSP blocks inline script tags the attribute won't be removed,
  // and we fall back to el.click() from the content-script world.
  //
  function clickElement(el) {
    const key = `__vs_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    el.setAttribute('data-vs-click', key);
    try {
      const s = document.createElement('script');
      s.textContent = `(function(){var e=document.querySelector('[data-vs-click="${key}"]');if(e){e.removeAttribute('data-vs-click');e.click();}})();`;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (_) { /* ignore */ }
    // If attribute is still present the script didn't run → fall back
    if (el.hasAttribute('data-vs-click')) {
      el.removeAttribute('data-vs-click');
      console.log('ℹ️ Script injection blocked — falling back to el.click()');
      el.click();
    }
  }

  // ── Shared DOM-change utility ───────────────────────────────────────────────
  //
  // Sets up a MutationObserver SYNCHRONOUSLY (so it catches even synchronous
  // DOM changes that happen inside el.click()), then calls `isChanged()` after
  // each DOM-settle period.  Resolves true once isChanged() returns true, or
  // false when timeoutMs expires with no meaningful change.
  //
  // MUST be called BEFORE the click that triggers the change.
  //
  function waitForDOMChange(isChanged, settleMs = 300, timeoutMs = 8000) {
    return new Promise(resolve => {
      let settleTimer = null;

      const done = (v) => {
        clearTimeout(settleTimer);
        clearTimeout(hardTimer);
        observer.disconnect();
        resolve(v);
      };

      const hardTimer = setTimeout(() => {
        console.warn('⚠️ waitForDOMChange: timed out after', timeoutMs, 'ms');
        done(false);
      }, timeoutMs);

      const observer = new MutationObserver(() => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (isChanged()) done(true);
          // else: DOM settled but content not yet relevant — keep watching
        }, settleMs);
      });

      observer.observe(document.body, {
        childList:       true,
        subtree:         true,
        characterData:   true,
        attributes:      true,
        // Limit attribute noise to layout-relevant attributes
        attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-selected', 'display'],
      });
    });
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
          loadMoreBtn.getAttribute('aria-disabled') === 'true' ||
          loadMoreBtn.style.display === 'none' ||
          loadMoreBtn.style.visibility === 'hidden' ||
          loadMoreBtn.classList.contains('disabled') ||
          loadMoreBtn.classList.contains('hidden')) {
        console.log('⚠️ Load More button is disabled or hidden - no more items');
        break;
      }
      
      // Helper: only count/read VISIBLE items so client-side pagination
      // (which hides rows with display:none instead of removing them)
      // is handled correctly.
      // offsetParent === null means the element is not rendered (display:none,
      // visibility:hidden, or a hidden ancestor) — catches both inline-style
      // and CSS-class-based hiding (e.g. DataTables .dt-hide).
      const getVisible = () =>
        Array.from(document.querySelectorAll(itemSelector)).filter(
          el => el.offsetParent !== null
        );

      const visibleBefore  = getVisible();
      const countBefore    = visibleBefore.length;
      const firstTxtBefore = visibleBefore[0]?.textContent?.trim().substring(0, 80) || '';
      const lastTxtBefore  = visibleBefore[visibleBefore.length - 1]?.textContent?.trim().substring(0, 80) || '';
      console.log(`   Visible items before click: ${countBefore}`);

      // Set up change detection BEFORE clicking.
      // This is critical: synchronous DOM changes (client-side pagination)
      // happen inside el.click() and would be missed if we set up the
      // observer afterward.
      const changePromise = waitForDOMChange(() => {
        const items     = getVisible();
        const count     = items.length;
        const firstTxt  = items[0]?.textContent?.trim().substring(0, 80) || '';
        const lastTxt   = items[items.length - 1]?.textContent?.trim().substring(0, 80) || '';
        return count !== countBefore || firstTxt !== firstTxtBefore || lastTxt !== lastTxtBefore;
      }, 300, delayMs + 4000);

      // Click the button (runs in main world for framework compatibility)
      console.log('   🖱️ Clicking Load More button...');
      clickElement(loadMoreBtn);

      // Wait for DOM to change and stabilise
      const contentChanged = await changePromise;
      console.log(`   Content changed: ${contentChanged}`);

      const visibleAfter  = getVisible();
      const countAfter    = visibleAfter.length;
      const firstTxtAfter = visibleAfter[0]?.textContent?.trim().substring(0, 80) || '';
      console.log(`   Visible items after click: ${countAfter}`);

      // Auto-detect mode:
      //   Append  — more items are now visible (standard Load More)
      //   Replace — same count but content changed (AJAX replace / pagination-as-Load-More)
      const appendedCount = countAfter - countBefore;
      const isReplaceMode = appendedCount === 0 && firstTxtAfter !== firstTxtBefore;

      // Helper: extract field values from a single item element
      const extractItem = (item) => {
        const itemData = {};
        for (const field of listing.fields) {
          try {
            const element = item.querySelector(field.selector);
            if (element) {
              let value;
              switch (field.attr) {
                case 'text': value = element.textContent.trim(); break;
                case 'href': value = element.href; break;
                case 'src':  value = element.src;  break;
                default:     value = element.getAttribute(field.attr);
              }
              itemData[field.name] = value;
            } else {
              itemData[field.name] = null;
            }
          } catch { itemData[field.name] = null; }
        }
        return itemData;
      };

      if (appendedCount > 0) {
        // ── Append mode ───────────────────────────────────────────────────
        console.log(`   📊 Append mode: ${appendedCount} new items added`);
        const newItems = visibleAfter.slice(countBefore);

        for (const item of newItems) {
          const itemData = extractItem(item);
          allResults.push(itemData);
          safeSendMessage({
            type: 'CURRENT_ITEM_UPDATE',
            jobId: jobId,
            currentItem: itemData[listing.fields[0]?.name] || 'Item',
            itemNumber: allResults.length,
            totalItems: countAfter,
            pageNumber: i + 2,
          });
        }

        console.log(`   ✅ Scraped ${appendedCount} new items (total: ${allResults.length})`);
        noNewItemsCount = 0;
        clickCount++;

        safeSendMessage({
          type: 'PROGRESS_UPDATE',
          jobId: jobId,
          progress: {
            itemsScraped: allResults.length,
            currentPage:  clickCount + 1,
            totalItems:   allResults.length,
            percentage:   Math.round(((clickCount + 1) / maxClicks) * 100),
          },
        });

      } else if (isReplaceMode) {
        // ── Replace mode ──────────────────────────────────────────────────
        // The visible items were swapped out (e.g. DataTables in Load-More
        // disguise, or a paginated AJAX endpoint used as Load More).
        // Scrape ALL currently visible items — they are all new.
        console.log(`   📊 Replace mode: ${countAfter} items replaced`);

        for (const item of visibleAfter) {
          const itemData = extractItem(item);
          allResults.push(itemData);
          safeSendMessage({
            type: 'CURRENT_ITEM_UPDATE',
            jobId: jobId,
            currentItem: itemData[listing.fields[0]?.name] || 'Item',
            itemNumber: allResults.length,
            totalItems: countAfter,
            pageNumber: i + 2,
          });
        }

        console.log(`   ✅ Scraped ${countAfter} replaced items (total: ${allResults.length})`);
        noNewItemsCount = 0;
        clickCount++;

        safeSendMessage({
          type: 'PROGRESS_UPDATE',
          jobId: jobId,
          progress: {
            itemsScraped: allResults.length,
            currentPage:  clickCount + 1,
            totalItems:   allResults.length,
            percentage:   Math.round(((clickCount + 1) / maxClicks) * 100),
          },
        });

      } else {
        console.log(`   ⚠️ No new items detected`);
        noNewItemsCount++;
        if (noNewItemsCount >= 3) {
          console.log('🛑 Stopping: No new items after 3 Load More clicks');
          break;
        }
      }
      
      // Update overlay
      updateScrapingOverlay(
        allResults.length,
        countAfter,
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
      
      // Scroll to bottom — try a scrollable container first, fall back to window
      console.log('   📜 Scrolling to bottom...');
      const scrollTarget = Array.from(document.querySelectorAll('*')).find(el => {
        if (el === document.body || el === document.documentElement) return false;
        const s = getComputedStyle(el);
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
               el.scrollHeight > el.clientHeight + 200;
      });
      if (scrollTarget) {
        scrollTarget.scrollTop = scrollTarget.scrollHeight;
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
      
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
    console.log('🔍 Looking for next page... (type:', pagination.type, ')');

    // Query param pagination is handled entirely by the background script.
    // The content script only scrapes the current page.
    if (pagination.type === 'queryParam') {
      return false;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function safeQuery(sel) {
      try { return document.querySelector(sel); } catch { return null; }
    }

    function safeQueryAll(sel) {
      try { return Array.from(document.querySelectorAll(sel)); } catch { return []; }
    }

    /** Returns true when an element should be treated as non-interactive */
    function isDisabled(el) {
      if (!el) return true;
      if (el.disabled) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      if (el.classList.contains('disabled')) return true;
      if (el.getAttribute('tabindex') === '-1') return true;
      // inline style check (fast)
      if (el.style.pointerEvents === 'none') return true;
      // computed style check (catches CSS classes like .disabled { pointer-events:none })
      try {
        if (getComputedStyle(el).pointerEvents === 'none') return true;
      } catch { /* ignore */ }
      return false;
    }

    /** Returns true when an element looks like a "next page" control */
    function looksLikeNext(el) {
      const text  = el.textContent.trim().toLowerCase();
      const aria  = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
      const rel   = (el.getAttribute('rel') || '').toLowerCase();
      const id    = (el.id || '').toLowerCase();
      return (
        ['next', '>', '›', '»', '→'].includes(text) ||
        text.endsWith('next') ||
        aria.includes('next') ||
        rel === 'next' ||
        id.includes('next') ||
        el.classList.contains('next') ||
        el.classList.contains('next-page') ||
        el.classList.contains('pagination-next') ||
        el.classList.contains('page-next') ||
        el.classList.contains('pager-next')
      );
    }

    /** Reads the current page number from the URL or from an active DOM indicator */
    function getCurrentPageNumber() {
      const urlParam = new URLSearchParams(window.location.search).get('page');
      if (urlParam) return parseInt(urlParam);
      // Try common active-page DOM patterns
      const active = document.querySelector(
        '.pagination .active a, .pagination .current, [aria-current="page"], .page-item.active .page-link'
      );
      if (active) {
        const n = parseInt(active.textContent.trim());
        if (!isNaN(n)) return n;
      }
      return 1;
    }

    // ── DataTables resolver ──────────────────────────────────────────────────

    function resolveDataTablesNext(anyDtElem) {
      const container =
        anyDtElem.closest('.dataTables_paginate, [role="navigation"], nav, .pagination') ||
        anyDtElem.parentElement?.parentElement ||
        document;
      const all = Array.from(container.querySelectorAll('[data-dt-idx]'));

      // Strategy 1: find the element that looks like "Next"
      const dtNext = all.find(el => looksLikeNext(el));
      if (dtNext) {
        if (isDisabled(dtNext)) {
          console.log('🛑 DataTables "Next" is disabled — last page');
          return null;
        }
        return dtNext;
      }

      // Strategy 2: find the active page number, return page+1 button
      const active = all.find(el =>
        el.classList.contains('current') || el.classList.contains('active')
      );
      if (active) {
        const n = parseInt(active.textContent.trim());
        if (!isNaN(n)) {
          const nextBtn = all.find(el =>
            parseInt(el.textContent.trim()) === n + 1 && !isDisabled(el)
          );
          return nextBtn || null;
        }
      }
      return null;
    }

    // ── Numbered-pagination resolver ─────────────────────────────────────────
    // Used when the user's selector matches numbered page links (e.g. "1 2 3 4 …")
    // instead of a true "Next" button.

    function resolveNumberedNext(baseSelector) {
      const current = getCurrentPageNumber();
      const candidates = safeQueryAll(baseSelector)
        .filter(el => /^\d+$/.test(el.textContent.trim()))
        .map(el => ({ el, n: parseInt(el.textContent.trim()) }))
        .sort((a, b) => a.n - b.n);
      const found = candidates.find(({ n, el }) => n === current + 1 && !isDisabled(el));
      if (!found) {
        console.warn(`⚠️ No numbered button for page ${current + 1}. Available:`, candidates.map(c => c.n));
        return null;
      }
      return found.el;
    }

    // ── Universal next-button finder (priority order) ────────────────────────

    function findNextButton() {
      // 1. User-provided selector — highest priority
      if (pagination.nextButtonSelector) {
        const el = safeQuery(pagination.nextButtonSelector);
        if (el) {
          if (el.hasAttribute('data-dt-idx')) {
            console.log('📋 DataTables detected via user selector');
            return resolveDataTablesNext(el);
          }
          // If it resolved to a pure-number page link, find current+1 instead
          if (/^\d+$/.test(el.textContent.trim()) && !looksLikeNext(el)) {
            console.warn('⚠️ User selector resolved to a numbered page link — finding current+1');
            return resolveNumberedNext(pagination.nextButtonSelector);
          }
          if (!isDisabled(el)) return el;
        }
      }

      // 2. rel="next" — SEO/HTML standard, very reliable
      const relNext = document.querySelector('a[rel="next"]');
      if (relNext && !isDisabled(relNext)) return relNext;

      // 3. DataTables anywhere on the page
      const anyDt = document.querySelector('[data-dt-idx]');
      if (anyDt) {
        console.log('📋 DataTables pagination detected on page');
        return resolveDataTablesNext(anyDt);
      }

      // 4. aria-label / title containing "next"
      for (const el of document.querySelectorAll('[aria-label],[title]')) {
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
        if (label.includes('next') && !isDisabled(el)) return el;
      }

      // 5. Common CSS class patterns
      const classSelectors = [
        '.next:not(.disabled)',
        '.next-page:not(.disabled)',
        '.page-next:not(.disabled)',
        '.pagination-next:not(.disabled)',
        '.pager-next:not(.disabled)',
        '[data-action="next"]',
        '[data-page="next"]',
      ];
      for (const sel of classSelectors) {
        const el = safeQuery(sel);
        if (el && !isDisabled(el)) return el;
      }

      // 6. Text scan — all anchors and buttons
      for (const el of document.querySelectorAll('a, button')) {
        if (looksLikeNext(el) && !isDisabled(el)) return el;
      }

      return null;
    }

    // ── Change-detection helpers ──────────────────────────────────────────────

    const itemSel = listing?.itemSelector;

    // Return only VISIBLE items — offsetParent catches all forms of hiding
    // (inline style, CSS class, hidden attribute, hidden ancestor).
    function visibleItems() {
      if (!itemSel) return [];
      return Array.from(document.querySelectorAll(itemSel)).filter(
        el => el.offsetParent !== null
      );
    }

    function captureState() {
      const items = visibleItems();
      return {
        url:       window.location.href,
        count:     items.length,
        firstText: items[0]?.textContent?.trim().substring(0, 80) || '',
        lastText:  items[items.length - 1]?.textContent?.trim().substring(0, 80) || '',
      };
    }

    function stateChanged(a, b) {
      return a.url       !== b.url       ||
             a.count     !== b.count     ||
             a.firstText !== b.firstText ||
             a.lastText  !== b.lastText;
    }

    // ── Main flow ─────────────────────────────────────────────────────────────

    const nextButton = findNextButton();

    if (!nextButton) {
      console.log('❌ No next button found on page');
      return false;
    }

    if (isDisabled(nextButton)) {
      console.log('🛑 Next button is disabled — last page reached');
      return false;
    }

    console.log(
      '🖱️ Next button found:',
      nextButton.tagName,
      `"${nextButton.textContent.trim() || '(icon)'}"`,
      nextButton.href || ''
    );

    try { nextButton.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch { /* ignore */ }

    // IMPORTANT: create the changePromise (which sets up the MutationObserver)
    // BEFORE calling .click().  For client-side pagination the DOM is updated
    // synchronously inside click(), so an observer created afterward misses it.
    const before = captureState();
    const changePromise = waitForDOMChange(() => stateChanged(before, captureState()), 300, 8000);
    clickElement(nextButton);

    if (!(await changePromise)) {
      // Retry once — some buttons need focus first or fire on mousedown
      console.log('🔄 No change detected — retrying click once...');
      const before2 = captureState();
      const retryPromise = waitForDOMChange(() => stateChanged(before2, captureState()), 300, 5000);
      clickElement(nextButton);
      if (!(await retryPromise)) {
        console.warn('⚠️ Page did not change after two clicks — assuming last page');
        return false;
      }
    }

    return true;
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
