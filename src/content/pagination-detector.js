// Pagination type auto-detector
// Injected on-demand when user clicks "Auto-detect mode" in the popup.

if (typeof window.__VS_PAGINATION_DETECTOR_LOADED__ === 'undefined') {
  window.__VS_PAGINATION_DETECTOR_LOADED__ = true;

  // ── Helpers (copied from scraper-runner.js / smart-picker.js) ──────────────

  function safeQuery(sel, root) {
    try { return (root || document).querySelector(sel); } catch { return null; }
  }

  function safeQueryAll(sel, root) {
    try { return Array.from((root || document).querySelectorAll(sel)); } catch { return []; }
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    if (el.classList.contains('disabled')) return true;
    if (el.parentElement && el.parentElement.classList.contains('disabled')) return true;
    if (el.style.pointerEvents === 'none') return true;
    try { if (getComputedStyle(el).pointerEvents === 'none') return true; } catch { /* ignore */ }
    return false;
  }

  function looksLikeNext(el) {
    const text = el.textContent.trim().toLowerCase();
    const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
    const rel  = (el.getAttribute('rel') || '').toLowerCase();
    const id   = (el.id || '').toLowerCase();
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

  function generateSpecificSelector(element) {
    const tagName = element.tagName.toLowerCase();
    if (element.id) return `#${element.id}`;
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ')
        .filter(c => c.trim() && !c.includes(':'))
        .slice(0, 2);
      if (classes.length > 0) return `${tagName}.${classes.join('.')}`;
    }
    const attrs = ['data-dt-idx', 'data-testid', 'data-action', 'type', 'role', 'aria-label'];
    for (const attr of attrs) {
      const value = element.getAttribute(attr);
      if (value) return `${tagName}[${attr}="${value}"]`;
    }
    // Path fallback
    let current = element;
    const path = [];
    while (current && current !== document.body) {
      let sel = current.tagName.toLowerCase();
      if (current.id) { path.unshift(`#${current.id}`); break; }
      if (current.className && typeof current.className === 'string') {
        const cls = current.className.split(' ').filter(c => c.trim() && !c.includes(':'));
        if (cls.length > 0) sel += `.${cls[0]}`;
      }
      path.unshift(sel);
      current = current.parentElement;
      if (path.length >= 3) break;
    }
    return path.join(' > ');
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  function isFakeHref(href) {
    if (!href) return true;
    const h = href.trim();
    return h === '' || h === '#' || h.startsWith('javascript:') || h.startsWith('void(');
  }

  const PAGE_PARAM_RE = /[?&](page|p|pg|offset|start)=(\d+)/i;
  const PATH_PAGE_RE  = /\/p(?:age)?\/(\d+)/i;

  function containsPageParam(href) {
    return PAGE_PARAM_RE.test(href) || PATH_PAGE_RE.test(href);
  }

  function extractParamName(href) {
    const m = href.match(PAGE_PARAM_RE);
    return m ? m[1].toLowerCase() : null;
  }

  function extractPageParamFromSearch(search) {
    const params = new URLSearchParams(search);
    for (const name of ['page', 'p', 'pg', 'offset', 'start']) {
      if (params.has(name)) return name;
    }
    return null;
  }

  function scoreToConfidence(score) {
    if (score >= 60) return 'high';
    if (score >= 35) return 'medium';
    return 'low';
  }

  // ── Pagination container discovery ──────────────────────────────────────────

  function findPaginationContainer() {
    const selectors = [
      'nav[aria-label*="pag" i]',
      '[role="navigation"]',
      '.pagination',
      '.pager',
      '.paginator',
      'ul.pages',
      '.page-numbers',
      '.wp-pagenavi',
      '.nav-links',
      'nav',
    ];
    for (const sel of selectors) {
      const el = safeQuery(sel);
      if (el) {
        const children = safeQueryAll('a, li', el);
        if (children.length >= 2) return el;
      }
    }
    return null;
  }

  // ── Main detection function ──────────────────────────────────────────────────

  function detectPaginationType() {
    const scores = {
      queryParam: 0,
      button:     0,
      'load-more': 0,
      infinite:   0,
      single:     10,
    };
    const evidence = {
      queryParam: [],
      button:     [],
      'load-more': [],
      infinite:   [],
      single:     ['Default fallback — no other pattern matched'],
    };

    const container = findPaginationContainer();
    let extractedParam = null;

    // ── BLOCK A: queryParam ─────────────────────────────────────────────────

    const linkRelNext = safeQuery('link[rel="next"]');
    if (linkRelNext && linkRelNext.href && !isFakeHref(linkRelNext.href)) {
      scores.queryParam += 50;
      evidence.queryParam.push(`Found <link rel="next"> in <head>: ${linkRelNext.href}`);
    }

    const aRelNext = safeQuery('a[rel="next"]');
    if (aRelNext && aRelNext.href && !isFakeHref(aRelNext.href)) {
      if (containsPageParam(aRelNext.href)) {
        scores.queryParam += 50;
        evidence.queryParam.push('Found <a rel="next"> with page URL');
        extractedParam = extractedParam || extractParamName(aRelNext.href);
      } else {
        scores.queryParam += 30;
        evidence.queryParam.push('Found <a rel="next"> (no page param in href)');
      }
    }

    if (container) {
      const allAnchors  = safeQueryAll('a', container);
      const realAnchors = allAnchors.filter(a => !isFakeHref(a.getAttribute('href')));
      const pageAnchors = realAnchors.filter(a => containsPageParam(a.href));

      if (pageAnchors.length >= 3) {
        scores.queryParam += 40;
        evidence.queryParam.push(`Found ${pageAnchors.length} pagination links with page parameter`);
        extractedParam = extractedParam || extractParamName(pageAnchors[0].href);
      } else if (pageAnchors.length >= 1) {
        scores.queryParam += 20;
        evidence.queryParam.push(`Found ${pageAnchors.length} pagination link(s) with page parameter`);
        extractedParam = extractedParam || extractParamName(pageAnchors[0].href);
      }

      const pathAnchors = realAnchors.filter(a => PATH_PAGE_RE.test(a.href));
      if (pathAnchors.length >= 1) {
        scores.queryParam += 35;
        evidence.queryParam.push('Found /page/N URL pattern in pagination links');
      }

      if (realAnchors.length >= 3 && pageAnchors.length === 0 && pathAnchors.length === 0) {
        scores.queryParam += 20;
        evidence.queryParam.push(`Found ${realAnchors.length} real-URL pagination links`);
      }
    }

    const currentParam = extractPageParamFromSearch(window.location.search);
    if (currentParam) {
      scores.queryParam += 15;
      evidence.queryParam.push(`Current URL contains page parameter: "${currentParam}"`);
      extractedParam = extractedParam || currentParam;
    }

    // ── BLOCK B: button (AJAX) ──────────────────────────────────────────────

    const dtElem = safeQuery('[data-dt-idx]');
    if (dtElem) {
      scores.button += 70;
      evidence.button.push('DataTables pagination detected ([data-dt-idx] elements present)');
    }

    if (container) {
      const allAnchors  = safeQueryAll('a', container);
      const fakeAnchors = allAnchors.filter(a => isFakeHref(a.getAttribute('href')));
      const nextFake    = fakeAnchors.find(a => looksLikeNext(a));
      if (nextFake) {
        scores.button += 40;
        evidence.button.push('Found Next anchor with non-navigating href (AJAX navigation)');
      } else if (fakeAnchors.length > 0) {
        scores.button += 20;
        evidence.button.push(`Found ${fakeAnchors.length} fake-href anchor(s) in pagination container`);
      }
    }

    // Check all looksLikeNext candidates outside container too
    let foundButtonNext = false;
    for (const el of safeQueryAll('a, button')) {
      if (!looksLikeNext(el)) continue;
      if (el.tagName === 'BUTTON') {
        scores.button += 25;
        evidence.button.push('Next control is a <button> element');
        foundButtonNext = true;
        break;
      }
      if (isFakeHref(el.getAttribute('href'))) {
        scores.button += 35;
        evidence.button.push('Found Next anchor with AJAX-style href');
        foundButtonNext = true;
        break;
      }
    }

    // Scan inline scripts for pushState/replaceState
    const inlineScripts = safeQueryAll('script:not([src])')
      .map(s => s.textContent).join('\n');
    if (inlineScripts.includes('pushState') || inlineScripts.includes('replaceState')) {
      scores.button += 20;
      evidence.button.push('Page scripts use pushState/replaceState (SPA navigation detected)');
    }

    // ── BLOCK C: load-more ──────────────────────────────────────────────────

    let loadMoreEl = null;
    for (const el of safeQueryAll('button, a, [role="button"]')) {
      if (/(load|show|view|see|fetch)\s*more/i.test(el.textContent)) {
        loadMoreEl = el;
        scores['load-more'] += 60;
        evidence['load-more'].push(`Found "Load More" button: "${el.textContent.trim().substring(0, 40)}"`);
        break;
      }
    }

    const loadMoreDataEl = safeQuery(
      '[data-action="load-more"], [data-load-more], [data-behavior="load-more"]'
    );
    if (loadMoreDataEl) {
      if (!loadMoreEl) loadMoreEl = loadMoreDataEl;
      scores['load-more'] += 50;
      evidence['load-more'].push('Found data-load-more attribute on element');
    }

    if (scores.queryParam < 20) {
      scores['load-more'] += 20;
      evidence['load-more'].push('No numbered pagination links found');
    }

    if (scores.button < 35) {
      scores['load-more'] += 15;
      evidence['load-more'].push('No Next button candidate found');
    }

    if (loadMoreEl) {
      // Check it's unique — not part of a numbered series
      const similar = safeQueryAll('button, a, [role="button"]')
        .filter(el => /(load|show|view|see|fetch)\s*more/i.test(el.textContent));
      if (similar.length === 1) {
        scores['load-more'] += 20;
        evidence['load-more'].push('Single load-more trigger found (not a series)');
      }
    }

    // ── BLOCK D: infinite scroll ────────────────────────────────────────────

    const sentinelSelectors = [
      '.sentinel',
      '[data-infinite]',
      '.infinite-scroll-sentinel',
      '.js-infinite-scroll',
      '#infinite-scroll-trigger',
      '[data-infinite-scroll-trigger]',
    ];
    let foundSentinel = false;
    for (const sel of sentinelSelectors) {
      if (safeQuery(sel)) {
        scores.infinite += 60;
        evidence.infinite.push(`Found infinite scroll sentinel: "${sel}"`);
        foundSentinel = true;
        break;
      }
    }

    if (!foundSentinel) {
      const classSelectors = ['.infinite-scroll', '[data-infinite-scroll]'];
      for (const sel of classSelectors) {
        if (safeQuery(sel)) {
          scores.infinite += 40;
          evidence.infinite.push(`Found infinite scroll class/attribute: "${sel}"`);
          break;
        }
      }
    }

    if (inlineScripts.includes('IntersectionObserver')) {
      scores.infinite += 20;
      evidence.infinite.push('Page scripts reference IntersectionObserver');
    }

    const scrollable = safeQueryAll('div, section, main, article').find(el => {
      if (el === document.body || el === document.documentElement) return false;
      try {
        const s = getComputedStyle(el);
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.children.length > 10;
      } catch { return false; }
    });
    if (scrollable) {
      scores.infinite += 30;
      evidence.infinite.push('Found scrollable non-body container with many child items');
    }

    if (scores.queryParam < 20 && scores.button < 35 && scores['load-more'] < 30) {
      if (document.body.scrollHeight > window.innerHeight * 3) {
        scores.infinite += 25;
        evidence.infinite.push('No pagination controls found; page has large scrollable content');
      }
    }

    // ── Rank and build result ───────────────────────────────────────────────

    const ranked = [
      { type: 'queryParam',  score: scores.queryParam,     evidence: evidence.queryParam },
      { type: 'button',      score: scores.button,         evidence: evidence.button },
      { type: 'load-more',   score: scores['load-more'],   evidence: evidence['load-more'] },
      { type: 'infinite',    score: scores.infinite,       evidence: evidence.infinite },
      { type: 'single',      score: scores.single,         evidence: evidence.single },
    ]
      .map(r => ({ ...r, confidence: scoreToConfidence(r.score) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];

    // Extract config values for the winning type
    const config = {
      paginationType:     best.type,
      pageParam:          null,
      nextButtonSelector: null,
      loadMoreSelector:   null,
      evidence:           best.evidence,
    };

    if (best.type === 'queryParam') {
      config.pageParam = extractedParam || 'page';
    } else if (best.type === 'button') {
      const nextEl = safeQueryAll('a, button')
        .find(el => looksLikeNext(el) && !isDisabled(el));
      if (nextEl) config.nextButtonSelector = generateSpecificSelector(nextEl);
    } else if (best.type === 'load-more') {
      if (loadMoreEl) config.loadMoreSelector = generateSpecificSelector(loadMoreEl);
    }

    console.log('🔍 Pagination detection results:', ranked.map(r => `${r.type}:${r.score}`).join(', '));
    console.log('🏆 Best match:', best.type, `(${best.confidence})`, best.evidence);

    return { ranked, best, config };
  }

} // end guard

// Message listener — always re-registers on each inject
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ACTIVATE_PAGINATION_DETECTOR') {
    console.log('🔍 Pagination detector: running analysis...');
    try {
      const result = detectPaginationType();
      chrome.runtime.sendMessage({ type: 'PAGINATION_DETECTED', result });
      sendResponse({ success: true });
    } catch (err) {
      console.error('Pagination detector error:', err);
      chrome.runtime.sendMessage({ type: 'PAGINATION_DETECTED', error: err.message });
      sendResponse({ success: false, error: err.message });
    }
  }
  return true;
});
