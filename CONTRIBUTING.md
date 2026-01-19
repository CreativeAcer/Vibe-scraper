# Contributing to Vibe Scraper 🌊

First off, thank you for considering contributing to Vibe Scraper! It's people like you that make Vibe Scraper such a great tool.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Coding Guidelines](#coding-guidelines)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)

---

## 🤝 Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

### Our Standards

- Be respectful and inclusive
- Be patient and welcoming
- Be collaborative
- Focus on what is best for the community
- Show empathy towards others

---

## 💡 How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

**When reporting a bug, include:**
- Chrome version
- Extension version
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)
- Console logs (F12 → Console)

**Template:**
```markdown
**Chrome Version:** 120.0.6099.109
**Extension Version:** 1.0.0
**URL Being Scraped:** https://example.com

**Steps to Reproduce:**
1. Open sidebar
2. Create job with X settings
3. Click start scraping
4. ...

**Expected:** Should scrape 24 items
**Actual:** Only scraped 1 item
**Console Errors:** [Paste here]
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues.

**When suggesting an enhancement:**
- Use a clear, descriptive title
- Provide detailed description of the feature
- Explain why this would be useful
- Include mockups/examples if applicable

### Pull Requests

We actively welcome your pull requests!

**Good first issues:**
- Documentation improvements
- UI/UX enhancements
- Bug fixes
- New scraping patterns
- Test coverage

---

## 🛠️ Development Setup

### Prerequisites

- Chrome browser (latest stable)
- Git
- Text editor (VS Code recommended)

### Setup Steps

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub
   ```

2. **Clone your fork**
   ```bash
   git clone https://github.com/Creativeacer/Vibe-scraper.git
   cd Vibe-scraper
   ```

3. **Load extension in Chrome**
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `Vibe-scraper` folder

4. **Make changes**
   - Edit files in `src/`
   - Test your changes

5. **Reload extension**
   - Go to `chrome://extensions`
   - Click reload button on Vibe Scraper

### Project Structure

```
Vibe-scraper/
├── manifest.json          # Extension config
├── src/
│   ├── popup/            # Sidebar UI
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── options/          # Settings page
│   │   ├── options.html
│   │   ├── options.js
│   │   └── options.css
│   ├── content/          # Content scripts
│   │   ├── scraper-runner.js
│   │   └── smart-picker.js
│   └── background/
│       └── service-worker.js
└── public/
    └── icons/
```

---

## 📝 Coding Guidelines

### JavaScript Style

- **No semicolons** (except where required)
- **2 spaces** for indentation
- **Single quotes** for strings
- **Template literals** for multi-line strings
- **camelCase** for variables and functions
- **PascalCase** for classes
- **UPPER_SNAKE_CASE** for constants

### Code Examples

**Good:**
```javascript
async function scrapePage(selector, maxItems = 10) {
  const items = document.querySelectorAll(selector)
  const results = []
  
  for (const item of items) {
    const data = extractData(item)
    results.push(data)
  }
  
  return results
}
```

**Avoid:**
```javascript
async function scrapePage(selector, maxItems) {
  if (!maxItems) maxItems = 10; // Use default parameter instead
  var items = document.querySelectorAll(selector); // Use const/let
  var results = []; // Use const
  
  for (var i = 0; i < items.length; i++) { // Use for...of
    results.push(extractData(items[i]));
  }
  
  return results;
}
```

### Comments

- Use `//` for single-line comments
- Use `/* */` for multi-line comments
- Add comments for complex logic
- Keep comments up-to-date

**Good:**
```javascript
// Check if user stopped scraping
if (shouldStop) {
  console.log('⏹️ Scraping stopped by user')
  break
}
```

### Console Logging

Use emoji prefixes for better readability:

```javascript
console.log('📄 Starting pagination...')     // Info
console.log('✅ Successfully scraped 24 items') // Success
console.warn('⚠️ No items found')             // Warning
console.error('❌ Scraping failed:', error)   // Error
console.log('🔍 Looking for selector...')    // Debug
```

### Error Handling

Always handle errors gracefully:

```javascript
try {
  const data = await scrapePage(config)
  return { success: true, data }
} catch (error) {
  console.error('❌ Error:', error)
  return { success: false, error: error.message }
}
```

---

## 📤 Commit Guidelines

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat:** New feature
- **fix:** Bug fix
- **docs:** Documentation changes
- **style:** Code style changes (formatting, etc.)
- **refactor:** Code refactoring
- **test:** Adding tests
- **chore:** Maintenance tasks

### Examples

**Good commits:**
```
feat(pagination): add query parameter support

- Implemented background fetch for URL-based pagination
- Added DOMParser in content script
- Resolves relative URLs to absolute

Closes #42
```

```
fix(stop-button): stop button now terminates scraping

Added shouldStop flag and checks in all loops

Fixes #38
```

```
docs(readme): update installation instructions

Added screenshots and improved quick start section
```

**Avoid:**
```
fixed stuff
updated files
changes
```

---

## 🔀 Pull Request Process

### Before Submitting

1. **Test thoroughly**
   - Test on multiple websites
   - Check all 5 scraping modes
   - Verify no console errors

2. **Update documentation**
   - Update README if needed
   - Add comments to complex code
   - Update CHANGELOG

3. **Follow style guidelines**
   - Consistent formatting
   - Meaningful variable names
   - Clean, readable code

### Submission

1. **Create a branch**
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes**
   ```bash
   git add .
   git commit -m "feat: your feature description"
   ```

3. **Push to your fork**
   ```bash
   git push origin feat/your-feature-name
   ```

4. **Open a Pull Request**
   - Go to the original repository
   - Click "New Pull Request"
   - Select your branch
   - Fill in the PR template

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Code refactoring

## Testing
- [ ] Tested on Chrome (version X)
- [ ] Tested all scraping modes
- [ ] No console errors
- [ ] Documentation updated

## Screenshots (if applicable)
[Add screenshots]

## Related Issues
Closes #X
```

### Review Process

1. Maintainer will review your PR
2. Address any feedback
3. Once approved, PR will be merged
4. Your contribution will be credited!

---

## 🎯 Good First Issues

New to the project? Look for issues tagged with:
- `good first issue`
- `documentation`
- `help wanted`
- `beginner-friendly`

**Suggested areas:**
- Improve error messages
- Add more debug logging
- Enhance UI/UX
- Write documentation
- Add code comments
- Fix typos

---

## 🐛 Debugging Tips

### Chrome DevTools

```javascript
// Add this to your code for debugging
debugger; // Pauses execution

// Check selector matches
document.querySelectorAll('your-selector')

// Test extraction
const item = document.querySelector('.item')
const title = item.querySelector('.title')?.textContent
```

### Extension Console

1. **Popup/Sidebar Console:**
   - Right-click popup → Inspect

2. **Background Console:**
   - chrome://extensions → Service Worker → Inspect

3. **Content Script Console:**
   - F12 on the webpage

### Common Issues

**"No items found"**
- Check selector with `document.querySelectorAll()`
- Verify page has loaded
- Try Smart Picker

**"Next button not working"**
- Verify selector with `document.querySelector()`
- Check if it's a SPA
- Use Smart Detect

**"State lost on navigation"**
- Use Query Param mode instead of Button
- Check if it's static HTML vs SPA

---

## 📚 Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [CSS Selectors Reference](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors)
- [Web Scraping Best Practices](https://www.scrapehero.com/web-scraping-best-practices/)

---

## 💬 Questions?

- Open an issue with the `question` label
- Check existing issues and discussions
- Read the documentation

---

## 🙏 Thank You!

Your contributions make Vibe Scraper better for everyone!

**Contributors will be:**
- Listed in the README
- Credited in release notes
- Part of the Vibe Scraper community

---

**Happy Contributing!** 🌊
