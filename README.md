# 🌊 Vibe Scraper

A powerful Chrome extension for web scraping with multiple pagination modes, smart field detection, and real-time visual feedback.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Chrome](https://img.shields.io/badge/chrome-extension-orange.svg)

## ✨ Features

### 🎯 Smart Scraping Modes

- **📄 Single Page** - Scrape current page only
- **🔘 Button Pagination** - Auto-click "Next" buttons with smart detection
- **🔗 Query Parameter Pagination** - Background fetch for URL-based pagination (e.g., `?page=2`)
- **♾️ Infinite Scroll** - Auto-scroll with configurable delays and limits
- **🔄 Load More** - Auto-click "Load More" buttons

### 🧠 Smart Features

- **Smart Picker** - Click any item to auto-detect fields and selectors
- **Smart Detect** - Auto-detect Next/Load More buttons by clicking them
- **Real-time Progress** - Visual overlay showing current item, page, and total count
- **Beautiful Toggle UI** - iOS-style switch between Button and Query Param pagination

### 💾 Export Options

- CSV export with UTF-8 BOM support
- JSON export
- Configurable field mapping
- Automatic filename generation

---

## 🚀 Quick Start

### Installation

1. Download the latest release or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `Vibe-scraper` folder

### Basic Usage

1. **Open the sidebar** - Click the extension icon
2. **Create a job**:
   - Enter a Job ID (e.g., "products")
   - Select scraping mode
3. **Use Smart Picker**:
   - Click "🎯 Smart Picker"
   - Click any item on the page
   - Fields are auto-detected!
4. **Start scraping** - Click "▶️ Start Scraping"
5. **Download results** - CSV downloads automatically when complete

---

## 📖 Documentation

### Scraping Modes Explained

#### 📄 Single Page
Scrapes only the current page you're viewing.

**Use when:**
- You need data from one specific page
- No pagination required

**Example:**
```
https://example.com/products
→ Scrapes 24 items from this page only
```

---

#### 🔘 Button Pagination
Automatically clicks "Next" buttons to navigate through pages.

**Use when:**
- Site has visible Next/Previous buttons
- Content loads via traditional pagination
- Single Page Apps (SPAs) with dynamic content

**Configuration:**
- **Next Button Selector**: CSS selector for the button (or use 🎯 Detect)
- **Max Pages**: Maximum pages to scrape (default: 10)

**Smart Detection:**
Click the 🎯 button, then click the "Next" button on the page - the selector is auto-filled!

**Example:**
```
Page 1: Scrape items → Click "Next"
Page 2: Scrape items → Click "Next"
Page 3: Scrape items → Done
```

---

#### 🔗 Query Parameter Pagination
Fetches pages via URL parameters without page reload.

**Use when:**
- URLs have `?page=X` format
- Server-side rendered HTML
- No JavaScript required for content
- Want faster scraping (no DOM waits)

**Configuration:**
- **Parameter Name**: URL parameter (e.g., "page")
- **Max Pages**: Maximum pages to fetch

**How it works:**
1. Content script scrapes page 1
2. Background script fetches page 2 HTML via `fetch()`
3. Content script parses HTML with DOMParser
4. Repeat for all pages

**Example:**
```
Page 1: https://example.com?page=1 (scraped from DOM)
Page 2: https://example.com?page=2 (fetched in background)
Page 3: https://example.com?page=3 (fetched in background)
→ No page reload, no state loss!
```

**Limitations:**
- Only works with static HTML
- Won't work on SPAs requiring JavaScript
- For SPAs, use Button Pagination instead

---

#### ♾️ Infinite Scroll
Automatically scrolls down to load more content.

**Use when:**
- Content loads on scroll (e.g., social media feeds)
- No "Load More" button
- Continuous scrolling behavior

**Configuration:**
- **Max Scrolls**: Maximum scroll attempts (default: 10)
- **Delay**: Milliseconds between scrolls (default: 3000ms)

**Example:**
```
Scroll 1 → Wait 3s → Scrape new items
Scroll 2 → Wait 3s → Scrape new items
Scroll 3 → Done
```

---

#### 🔄 Load More Button
Automatically clicks "Load More" buttons.

**Use when:**
- Site has a "Load More", "Show More", or "View More" button
- Content loads dynamically after clicking

**Configuration:**
- **Button Selector**: CSS selector for the button (or use 🎯 Detect)
- **Max Clicks**: Maximum clicks (default: 10)

**Smart Detection:**
Click the 🎯 button, then click the "Load More" button - selector auto-filled!

**Example:**
```
Click "Load More" → Wait → Scrape 12 new items
Click "Load More" → Wait → Scrape 12 new items
Button disappears → Done
```

---

### Smart Picker

The Smart Picker automatically detects:
- **Item selector** - Finds all similar items on the page
- **Field selectors** - Extracts text, links, images from each item
- **Field names** - Auto-generates names (title, price, url, etc.)

**How to use:**
1. Click "🎯 Smart Picker"
2. Click any item on the page (e.g., a product card)
3. Fields are detected automatically
4. Review in the preview panel
5. Start scraping!

**What it detects:**
- Text content (product titles, descriptions)
- Links (href attributes)
- Images (src attributes)
- Prices (numerical text)
- And more...

---

### Configuration Options

#### Sidebar (Quick Start)
- Fast job creation
- Smart Picker integration
- All 5 scraping modes
- Toggle between Button/Query Param
- Real-time field preview

#### Settings Page
- Advanced job management
- Visual mode selector with icons
- Edit existing jobs
- Export/import configurations
- Job history

---

## 🛠️ Technical Details

### Architecture

```
┌─────────────────────────────────────┐
│ Sidebar (popup.html/popup.js)      │
│ - Quick job creation                │
│ - User interface                    │
└─────────────┬───────────────────────┘
              │
              ↓ (chrome.tabs.sendMessage)
┌─────────────────────────────────────┐
│ Content Script (scraper-runner.js)  │
│ - DOM access                         │
│ - Smart Picker                       │
│ - Item extraction                    │
│ - Query param: HTML parsing          │
└─────────────┬───────────────────────┘
              │
              ↓ (chrome.runtime.sendMessage)
┌─────────────────────────────────────┐
│ Background (service-worker.js)      │
│ - Job management                     │
│ - Query param: HTTP fetching         │
│ - Message routing                    │
└─────────────────────────────────────┘
```

### Query Parameter Pagination - How It Works

**Problem:** Traditional navigation causes page reload → state loss → can't continue scraping.

**Solution:** Split responsibilities:

1. **Background Script**: Fetches HTML via `fetch()` API
   ```javascript
   const response = await fetch('https://example.com?page=2');
   const html = await response.text();
   return { html, url };
   ```

2. **Content Script**: Parses HTML with DOMParser (has DOM APIs)
   ```javascript
   const parser = new DOMParser();
   const doc = parser.parseFromString(html, 'text/html');
   const items = doc.querySelectorAll(itemSelector);
   ```

**Benefits:**
- ✅ No page reload
- ✅ State preserved
- ✅ Faster scraping
- ✅ Works with any URL-based pagination

---

### File Structure

```
Vibe-scraper/
├── manifest.json              # Extension configuration
├── src/
│   ├── popup/                 # Sidebar UI
│   │   ├── popup.html
│   │   ├── popup.js          # Job creation, Smart Picker
│   │   └── popup.css         # Compact 380px design
│   ├── options/               # Settings page
│   │   ├── options.html
│   │   ├── options.js
│   │   └── options.css
│   ├── content/               # Content scripts
│   │   ├── scraper-runner.js # Main scraping engine
│   │   └── smart-picker.js   # Smart field detection
│   └── background/
│       └── service-worker.js # Background tasks
└── public/
    └── icons/                 # Extension icons
```

---

### Dependencies

- **Chrome Extension APIs**:
  - `chrome.scripting` - Script injection
  - `chrome.tabs` - Tab management
  - `chrome.storage` - Job storage
  - `chrome.sidePanel` - Sidebar UI
  - `chrome.runtime` - Messaging

- **Built-in APIs**:
  - `DOMParser` - HTML parsing (content script)
  - `fetch()` - HTTP requests (background)
  - `querySelector()` - DOM querying

**No external libraries required!** Pure vanilla JavaScript.

---

## 🎨 UI Design

### Compact Sidebar (380px)
- Optimized for space efficiency
- All controls visible without scrolling
- Professional appearance
- Font sizes: 12px body, 11px labels, 10px small text

### Beautiful Toggle Switch
- iOS-style design
- Smooth 0.3s animations
- Blue active state (#2196F3)
- Clear visual feedback

### Real-time Overlay
- Shows current item being scraped
- Page number and progress (X/Y)
- Total items scraped
- Extracting/Complete status

---

## 🔧 Development

### Setup

```bash
# Clone the repository
git clone https://github.com/CreativeAcer/Vibe-scraper.git
cd Vibe-scraper

# Load in Chrome
# 1. Open chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select the Vibe-scraper folder
```

### Making Changes

The extension uses Manifest V3 with no build process required.

**Edit and reload:**
1. Make changes to source files
2. Go to `chrome://extensions`
3. Click reload button on Vibe Scraper
4. Test changes

### Testing

**Test sites:**
- https://scrapingtest.com/ecommerce/pagination - Button pagination
- https://scrapingtest.com/ecommerce/load-more - Load More buttons
- Any site with `?page=X` URLs - Query param

**Test each mode:**
1. Single Page
2. Button Pagination (with Detect)
3. Query Param Pagination
4. Infinite Scroll
5. Load More (with Detect)

---

## 📝 Changelog

### Version 1.0.0 (2025-01-19)

**Features:**
- ✅ 5 scraping modes (Single, Button, Query Param, Infinite, Load More)
- ✅ Smart Picker with auto field detection
- ✅ Smart Detect for buttons
- ✅ Beautiful toggle UI (380px compact)
- ✅ Query param multi-page via background fetch
- ✅ Real-time progress overlay
- ✅ Stop button functionality
- ✅ CSV/JSON export

**Technical:**
- ✅ Background-orchestrated pagination for query params
- ✅ DOMParser in content script (service worker compatible)
- ✅ Relative URL resolution
- ✅ Stop flag for graceful termination
- ✅ Message channel timeout fix

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

**Areas for contribution:**
- Additional scraping modes
- More smart detection patterns
- UI improvements
- Bug fixes
- Documentation

---

## 📄 License

MIT License - see LICENSE file for details

---

## 🐛 Known Limitations

1. **Query Parameter Pagination**:
   - Only works with static HTML
   - Won't work on SPAs requiring JavaScript
   - Use Button mode for SPAs

2. **Smart Picker**:
   - Works best with consistent HTML structure
   - May need manual adjustment for complex layouts

3. **CORS Restrictions**:
   - Some sites may block background fetch requests
   - Button pagination will work as alternative

---

## 💡 Tips & Tricks

### Best Practices

1. **Start Small**: Test with Max Pages = 2 first
2. **Use Smart Detect**: Let the extension find selectors
3. **Check Console**: Open DevTools to see debug logs
4. **Save Jobs**: Use Settings page to manage configurations
5. **Export Early**: Download CSV after successful test run

### Troubleshooting

**No items found?**
- Check if selector matches items: `document.querySelectorAll('your-selector')`
- Use Smart Picker to auto-detect

**Pagination not working?**
- Verify Next button selector
- Use Smart Detect (🎯)
- Check if it's a SPA (use Button mode)

**Query param returns no data?**
- Site might need JavaScript (use Button mode)
- Check if URL actually changes pages
- Verify parameter name is correct

---

## 📞 Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check existing issues for solutions
- Include console logs for bug reports

---

**Made with ❤️ for the web scraping community**
