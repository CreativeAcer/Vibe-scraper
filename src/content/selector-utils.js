/**
 * Shared CSS selector utility for Vibe Scraper content scripts.
 * Injected before smart-picker.js and pagination-detector.js.
 * Exposes window.__vibeUtils.generateSpecificSelector(element).
 */
(function () {
  window.__vibeUtils = window.__vibeUtils || {};

  /**
   * Generate a specific CSS selector for a single element (e.g. a button).
   * Priority: ID > classes > known attributes > DOM path fallback.
   */
  window.__vibeUtils.generateSpecificSelector = function generateSpecificSelector(element) {
    const tagName = element.tagName.toLowerCase();

    if (element.id) return `#${element.id}`;

    if (element.className && typeof element.className === 'string') {
      const classes = element.className
        .split(' ')
        .filter(c => c.trim() && !c.includes(':'))
        .slice(0, 2);
      if (classes.length > 0) return `${tagName}.${classes.join('.')}`;
    }

    const attrs = ['data-dt-idx', 'data-testid', 'data-action', 'type', 'role', 'aria-label'];
    for (const attr of attrs) {
      const value = element.getAttribute(attr);
      if (value) return `${tagName}[${attr}="${value}"]`;
    }

    // DOM path fallback (max 3 levels deep)
    let current = element;
    const path = [];
    while (current && current !== document.body) {
      let sel = current.tagName.toLowerCase();
      if (current.id) { path.unshift(`#${current.id}`); break; }
      if (current.className && typeof current.className === 'string') {
        const cls = current.className
          .split(' ')
          .filter(c => c.trim() && !c.includes(':'));
        if (cls.length > 0) sel += `.${cls[0]}`;
      }
      path.unshift(sel);
      current = current.parentElement;
      if (path.length >= 3) break;
    }
    return path.join(' > ');
  };
})();
