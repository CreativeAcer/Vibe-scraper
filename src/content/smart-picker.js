// Smart Element Picker V2 - Improved button handling and activation
// Prevent duplicate declaration if script is injected multiple times
if (typeof window.SmartElementPicker === 'undefined') {

class SmartElementPicker {
  constructor() {
    this.active = false;
    this.selectedElement = null;
    this.overlay = null;
    this.panel = null;
    this.onSelectCallback = null;
    this.panelMode = false; // Track if we're in panel selection mode
  }

  activate(callback, options = {}) {
    if (this.active) {
      console.log('Smart Picker already active');
      return;
    }
    
    console.log('🎯 Smart Picker: Activating...');
    this.active = true;
    this.panelMode = false;
    this.onSelectCallback = callback;
    this.skipPanel = options.skipPanel || false; // NEW: Skip panel, auto-confirm all fields
    this.createOverlay();
    this.attachEventListeners();
    console.log('✅ Smart Picker: Active! Click on an item to select it.');
  }

  deactivate() {
    this.active = false;
    this.panelMode = false;
    this.removeOverlay();
    this.removeEventListeners();
    this.selectedElement = null;
    console.log('🎯 Smart Picker: Deactivated');
  }

  createOverlay() {
    // Highlight element
    this.highlight = document.createElement('div');
    this.highlight.id = 'smart-picker-highlight';
    this.highlight.style.cssText = `
      position: absolute;
      border: 3px solid #667eea;
      background: rgba(102, 126, 234, 0.1);
      pointer-events: none;
      z-index: 999997;
      transition: all 0.1s ease;
      display: none;
    `;
    document.body.appendChild(this.highlight);

    // Banner
    this.banner = document.createElement('div');
    this.banner.id = 'smart-picker-banner';
    this.banner.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px 30px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 15px;
    `;
    this.banner.innerHTML = `
      <span>🎯 <strong>Smart Picker Active:</strong> Click on an item to select it</span>
      <button id="smart-picker-cancel" style="
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid white;
        color: white;
        padding: 5px 15px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      ">Cancel (Esc)</button>
    `;
    document.body.appendChild(this.banner);

    // Cancel button handler - normal click
    const cancelBtn = this.banner.querySelector('#smart-picker-cancel');
    cancelBtn.onclick = () => this.deactivate();
  }

  removeOverlay() {
    if (this.highlight) this.highlight.remove();
    if (this.banner) this.banner.remove();
    if (this.panel) this.panel.remove();
  }

  attachEventListeners() {
    this.mouseMoveHandler = this.handleMouseMove.bind(this);
    this.clickHandler = this.handleClick.bind(this);
    this.keyHandler = this.handleKey.bind(this);

    document.addEventListener('mousemove', this.mouseMoveHandler, false);
    document.addEventListener('click', this.clickHandler, true);
    document.addEventListener('keydown', this.keyHandler, false);
  }

  removeEventListeners() {
    document.removeEventListener('mousemove', this.mouseMoveHandler, false);
    document.removeEventListener('click', this.clickHandler, true);
    document.removeEventListener('keydown', this.keyHandler, false);
  }

  handleMouseMove(event) {
    // Don't highlight if panel is open or over our elements
    if (this.panelMode || this.isOurElement(event.target)) {
      this.highlight.style.display = 'none';
      return;
    }

    this.highlightElement(event.target);
  }

  handleClick(event) {
    const element = event.target;

    // If panel is open and click is on our panel, allow it
    if (this.panelMode && this.isOurElement(element)) {
      console.log('🎯 Panel interaction - allowing');
      return; // Let the click through
    }

    // If panel is open and click is outside, ignore
    if (this.panelMode) {
      console.log('🎯 Panel open - ignoring outside click');
      return;
    }

    // Check if it's our banner
    if (this.isOurElement(element)) {
      console.log('🎯 Banner click - allowing');
      return;
    }

    // This is element selection
    console.log('🎯 Selecting element:', element);
    event.preventDefault();
    event.stopPropagation();
    
    this.selectElement(element);
    return false;
  }

  handleKey(event) {
    if (event.key === 'Escape') {
      this.deactivate();
    }
  }

  isOurElement(element) {
    return element && (
      element.id === 'smart-picker-banner' ||
      element.id === 'smart-picker-highlight' ||
      element.id === 'smart-picker-panel' ||
      element.closest('#smart-picker-banner') ||
      element.closest('#smart-picker-panel')
    );
  }

  highlightElement(element) {
    const rect = element.getBoundingClientRect();
    this.highlight.style.display = 'block';
    this.highlight.style.top = `${rect.top + window.scrollY}px`;
    this.highlight.style.left = `${rect.left + window.scrollX}px`;
    this.highlight.style.width = `${rect.width}px`;
    this.highlight.style.height = `${rect.height}px`;
  }

  selectElement(element) {
    this.selectedElement = element;
    this.highlight.style.display = 'none';
    
    const analysis = this.analyzeElement(element);
    
    // If skipPanel is true, immediately confirm all fields
    if (this.skipPanel) {
      console.log('🎯 Smart Picker: Auto-confirming all fields (skipPanel mode)');
      this.autoConfirmAllFields(analysis);
      return;
    }
    
    // Otherwise show the panel
    this.showFieldSelectionPanel(analysis);
    
    // Switch to panel mode
    this.panelMode = true;
  }

  autoConfirmAllFields(analysis) {
    // Automatically select all detected fields with preview
    // NOTE: DOM element references are intentionally excluded — they cannot be
    // serialized by chrome.runtime.sendMessage (structured clone throws DataCloneError).
    const result = {
      itemSelector: analysis.itemSelector,
      fields: analysis.fields.map(f => ({
        name: f.name,
        selector: f.selector,
        attr: f.attr,
        type: f.type,
        preview: f.preview
      }))
    };

    console.log('✅ Confirmed selection:', result);
    
    if (this.onSelectCallback) {
      this.onSelectCallback(result);
    }
    
    this.deactivate();
  }

  analyzeElement(element) {
    const fields = [];
    const seenSelectors = new Set();
    
    // Generate a selector that finds ALL similar items, not just this one
    const itemSelector = this.generateItemSelector(element);

    const findFields = (el, depth = 0) => {
      if (depth > 5) return;

      Array.from(el.children).forEach(child => {
        const relativeSelector = this.generateRelativeSelector(element, child);
        
        if (seenSelectors.has(relativeSelector)) return;
        seenSelectors.add(relativeSelector);

        const text = child.textContent.trim();
        const hasText = text.length > 0 && text.length < 200;
        const fieldName = this.suggestFieldName(child, text);

        if (hasText) {
          fields.push({
            name: fieldName,
            selector: relativeSelector,
            attr: 'text',
            type: this.guessType(text),
            preview: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
            element: child
          });
        }

        if (child.tagName === 'A' && child.href) {
          fields.push({
            name: fieldName + '_url',
            selector: relativeSelector,
            attr: 'href',
            type: 'url',
            preview: child.href,
            element: child
          });
        }

        if ((child.tagName === 'IMG' || child.tagName === 'SOURCE') && child.src) {
          fields.push({
            name: fieldName + '_image',
            selector: relativeSelector,
            attr: 'src',
            type: 'url',
            preview: child.src,
            element: child
          });
        }

        Array.from(child.attributes).forEach(attr => {
          if (attr.name.startsWith('data-')) {
            fields.push({
              name: attr.name.replace('data-', ''),
              selector: relativeSelector,
              attr: attr.name,
              type: 'string',
              preview: attr.value,
              element: child
            });
          }
        });

        findFields(child, depth + 1);
      });
    };

    findFields(element);

    return {
      itemSelector,
      fields: this.deduplicateFields(fields),
      element
    };
  }

  deduplicateFields(fields) {
    const seen = new Map();
    fields.forEach(field => {
      const key = `${field.selector}-${field.attr}`;
      if (!seen.has(key)) {
        seen.set(key, field);
      }
    });
    return Array.from(seen.values());
  }

  generateItemSelector(element) {
    // Generate a selector that matches ALL similar items on entire page
    // Not just siblings - search globally!
    
    const tagName = element.tagName.toLowerCase();
    
    console.log(`🔍 Analyzing ${tagName} element...`);
    
    // Strategy 1: If element has classes, use them (GLOBAL search)
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ')
        .filter(c => c.trim() 
          && !c.includes(':') // Filter Tailwind pseudo-classes like group-hover:shadow-lg
          && !c.match(/^(active|selected|hover|focus|first|last|odd|even)$/i));
      
      if (classes.length > 0) {
        const selector = `${tagName}.${classes[0]}`;
        const matches = document.querySelectorAll(selector);
        
        if (matches.length > 1) {
          console.log(`✅ Using class selector: ${selector} (matches ${matches.length} items across entire page)`);
          return selector;
        }
      }
    }
    
    // Strategy 2: Try with multiple classes if single class didn't work
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ')
        .filter(c => c.trim() 
          && !c.includes(':') // Filter Tailwind pseudo-classes
          && !c.match(/^(active|selected|hover|focus|first|last|odd|even)$/i));
      
      if (classes.length > 1) {
        const selector = `${tagName}.${classes.slice(0, 2).join('.')}`;
        const matches = document.querySelectorAll(selector);
        
        if (matches.length > 1) {
          console.log(`✅ Using multi-class selector: ${selector} (matches ${matches.length} items)`);
          return selector;
        }
      }
    }
    
    // Strategy 3: Just the tag name (GLOBAL search)
    const tagMatches = document.querySelectorAll(tagName);
    if (tagMatches.length > 1) {
      console.log(`✅ Using simple tag selector: ${tagName} (matches ${tagMatches.length} items across entire page)`);
      return tagName;
    }
    
    // Strategy 4: Check for data attributes
    const dataAttrs = Array.from(element.attributes)
      .filter(attr => attr.name.startsWith('data-'))
      .slice(0, 1);
    
    if (dataAttrs.length > 0) {
      const selector = `${tagName}[${dataAttrs[0].name}]`;
      const matches = document.querySelectorAll(selector);
      
      if (matches.length > 1) {
        console.log(`✅ Using data attribute selector: ${selector} (matches ${matches.length} items)`);
        return selector;
      }
    }
    
    // Fallback: generate a full CSS path so we never return undefined
    console.warn(`⚠️ Could only generate specific selector for 1 item`);
    return this.generateCSSSelector(element);
  }
  
  generateSpecificSelector(element) {
    // Generate a selector for THIS SPECIFIC element (for buttons, not items)
    const tagName = element.tagName.toLowerCase();
    const parts = [tagName];
    
    console.log('🎯 Generating specific selector for single element...');
    
    // Try ID first (most specific)
    if (element.id) {
      const selector = `#${element.id}`;
      console.log(`✅ Using ID: ${selector}`);
      return selector;
    }
    
    // Try classes
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ')
        .filter(c => c.trim() && !c.includes(':'))
        .slice(0, 2); // Use first 2 classes
      
      if (classes.length > 0) {
        const selector = `${tagName}.${classes.join('.')}`;
        console.log(`✅ Using classes: ${selector}`);
        return selector;
      }
    }
    
    // Try attributes that might identify the button
    const attrs = ['data-testid', 'data-action', 'type', 'role', 'aria-label'];
    for (const attr of attrs) {
      const value = element.getAttribute(attr);
      if (value) {
        const selector = `${tagName}[${attr}="${value}"]`;
        console.log(`✅ Using attribute: ${selector}`);
        return selector;
      }
    }
    
    // Try text content for buttons
    if (tagName === 'button' || tagName === 'a') {
      const text = element.textContent.trim();
      if (text && text.length < 50) {
        // Create selector with :contains-like approach using XPath alternative
        const selector = `${tagName}`;
        console.log(`✅ Using tag with text hint: ${selector} (text: "${text}")`);
        return selector;
      }
    }
    
    // Fallback: nth-child approach
    let current = element;
    const path = [];
    
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        path.unshift(`#${current.id}`);
        break;
      }
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.split(' ')
          .filter(c => c.trim() && !c.includes(':'))
          .slice(0, 1);
        if (classes.length > 0) {
          selector += `.${classes[0]}`;
        }
      }
      
      path.unshift(selector);
      current = current.parentElement;
      
      if (path.length >= 3) break; // Limit depth
    }
    
    const finalSelector = path.join(' > ');
    console.log(`✅ Using path selector: ${finalSelector}`);
    return finalSelector;
  }

  generateParentSelector(element) {
    // Generate a simple selector for the parent
    if (element.id) return `#${element.id}`;
    
    const tagName = element.tagName.toLowerCase();
    
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ')
        .filter(c => c.trim() && !c.includes(':')) // Filter Tailwind pseudo-classes
        .slice(0, 2);
      
      if (classes.length > 0) {
        return `${tagName}.${classes.join('.')}`;
      }
    }
    
    return tagName;
  }

  generateCSSSelector(element) {
    if (element.id) return `#${element.id}`;

    const path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.split(' ')
          .filter(c => c.trim() && !c.includes(':')); // Filter Tailwind pseudo-classes
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).join('.');
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  generateRelativeSelector(parent, child) {
    if (child === parent) return '';

    const path = [];
    let current = child;

    while (current && current !== parent) {
      let selector = current.tagName.toLowerCase();
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.split(' ')
          .filter(c => c.trim() && !c.includes(':')); // Filter Tailwind pseudo-classes
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).join('.');
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' ');
  }

  suggestFieldName(element, text) {
    const className = element.className?.toString().toLowerCase() || '';
    
    if (className.includes('title') || className.includes('name')) return 'title';
    if (className.includes('price') || className.includes('cost')) return 'price';
    if (className.includes('description') || className.includes('desc')) return 'description';
    if (className.includes('date') || className.includes('time')) return 'date';
    if (className.includes('author')) return 'author';
    if (className.includes('category')) return 'category';
    if (className.includes('rating')) return 'rating';

    if (element.tagName === 'H1' || element.tagName === 'H2' || element.tagName === 'H3') return 'title';
    if (element.tagName === 'A') return 'link';
    if (element.tagName === 'IMG') return 'image';
    if (element.tagName === 'TIME') return 'date';

    if (text.match(/^\$?\d+[.,]?\d*$/)) return 'price';
    if (text.match(/^\d{4}-\d{2}-\d{2}/)) return 'date';

    return 'field';
  }

  guessType(text) {
    if (text.match(/^\$?\d+[.,]?\d*$/)) return 'number';
    if (text.match(/^\d{4}-\d{2}-\d{2}/) || text.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) return 'date';
    if (text.match(/^(yes|no|true|false|on|off)$/i)) return 'boolean';
    if (text.match(/^https?:\/\//)) return 'url';
    return 'string';
  }

  showFieldSelectionPanel(analysis) {
    this.panel = document.createElement('div');
    this.panel.id = 'smart-picker-panel';
    this.panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
      z-index: 2147483647;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const fieldsHTML = analysis.fields.map((field, index) => `
      <div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
        <label style="display: flex; align-items: start; gap: 12px; cursor: pointer;">
          <input type="checkbox" data-index="${index}" checked style="margin-top: 3px; width: 18px; height: 18px;">
          <div style="flex: 1;">
            <div style="font-weight: 500; color: #333; margin-bottom: 4px;">${field.name}</div>
            <div style="font-size: 12px; color: #999; font-family: monospace; margin-bottom: 4px;">
              ${field.selector} → ${field.attr} (${field.type})
            </div>
            <div style="font-size: 12px; color: #666; font-style: italic;">Preview: "${field.preview}"</div>
          </div>
        </label>
      </div>
    `).join('');

    this.panel.innerHTML = `
      <h2 style="margin: 0 0 10px 0; color: #333; font-size: 20px;">🎯 Select Fields to Scrape</h2>
      <p style="color: #666; margin: 0 0 20px 0; font-size: 14px;">
        Found ${analysis.fields.length} possible fields. Select which ones you want to extract:
      </p>
      <div id="field-list">${fieldsHTML}</div>
      <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 20px;">
        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #555;">Item Selector:</label>
          <input type="text" id="item-selector-input" value="${analysis.itemSelector}" readonly
            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; 
                   font-family: monospace; font-size: 13px; background: #f9f9f9;">
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button id="panel-cancel" style="padding: 10px 20px; border: 1px solid #ddd; background: white; 
                                          border-radius: 6px; cursor: pointer; font-size: 14px;">Cancel</button>
          <button id="panel-confirm" style="padding: 10px 20px; border: none; 
                                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                                            color: white; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">
            Use Selected Fields
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.panel);

    // Button handlers - use onclick for reliability
    this.panel.querySelector('#panel-cancel').onclick = () => this.deactivate();
    this.panel.querySelector('#panel-confirm').onclick = () => this.confirmSelection(analysis);

    console.log('✅ Panel created with working buttons');
  }

  confirmSelection(analysis) {
    const checkboxes = this.panel.querySelectorAll('input[type="checkbox"]:checked');
    const selectedFields = Array.from(checkboxes).map(cb => {
      const index = parseInt(cb.dataset.index);
      return analysis.fields[index];
    });

    const result = {
      itemSelector: analysis.itemSelector,
      fields: selectedFields.map(f => ({
        name: f.name,
        selector: f.selector,
        attr: f.attr,
        type: f.type
      }))
    };

    console.log('✅ Confirmed selection:', result);

    if (this.onSelectCallback) {
      this.onSelectCallback(result);
    }

    this.deactivate();
  }
}

window.SmartElementPicker = SmartElementPicker;
console.log('✅ Smart Picker class defined');

} else {
  console.log('⚠️ Smart Picker already defined, skipping');
}

// Message listener for remote activation
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ACTIVATE_SMART_PICKER') {
    console.log('📨 Received ACTIVATE_SMART_PICKER message');
    
    const picker = new SmartElementPicker();
    
    picker.activate((result) => {
      console.log('✅ Smart Picker result:', result);
      
      // Send back to popup
      if (message.singleElement) {
        // For next button/load more detection - use specific selector
        const clickedElement = result.selectedElement;
        const specificSelector = picker.generateSpecificSelector(clickedElement);
        
        chrome.runtime.sendMessage({
          type: 'ELEMENT_SELECTED',
          selector: specificSelector,
          element: {
            tag: clickedElement.tagName.toLowerCase(),
            text: clickedElement.textContent?.trim().substring(0, 30) || ''
          }
        });
      } else {
        // For regular field detection
        chrome.runtime.sendMessage({
          type: 'FIELDS_DETECTED',
          data: result
        });
      }
    }, {
      skipPanel: message.skipPanel || false
    });
    
    sendResponse({ success: true });
  }
  
  return true;
});

console.log('✅ Smart Picker: Message listener ready');
