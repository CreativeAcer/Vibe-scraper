// Data export module for CSV and JSON formats
export class DataExporter {
  constructor(config) {
    this.config = config;
  }

  /**
   * Export data based on config format
   */
  async exportData(items) {
    const format = this.config.export?.format || 'json';
    
    if (format === 'csv') {
      return await this.exportCSV(items);
    } else {
      return await this.exportJSON(items);
    }
  }

  /**
   * Export data as JSON
   */
  async exportJSON(items) {
    const filename = this.config.export?.filename || `scrape_${Date.now()}.json`;
    const jsonData = JSON.stringify(items, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    
    await this.downloadBlob(blob, filename);
    
    return {
      success: true,
      filename,
      itemCount: items.length
    };
  }

  /**
   * Export data as CSV with UTF-8 BOM support
   */
  async exportCSV(items) {
    if (items.length === 0) {
      throw new Error('No items to export');
    }

    const filename = this.config.export?.filename || `scrape_${Date.now()}.csv`;
    const includeBOM = this.config.export?.bom !== false;

    // Get all unique field names (column headers)
    const fields = this.getFieldNames(items);
    
    // Build CSV content
    let csvContent = '';
    
    // Add BOM for UTF-8 if requested
    if (includeBOM) {
      csvContent = '\uFEFF';
    }

    // Add header row
    csvContent += fields.map(field => this.escapeCSVValue(field)).join(',') + '\n';

    // Add data rows
    for (const item of items) {
      const row = fields.map(field => {
        const value = item[field];
        return this.escapeCSVValue(value);
      });
      csvContent += row.join(',') + '\n';
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    await this.downloadBlob(blob, filename);

    return {
      success: true,
      filename,
      itemCount: items.length,
      fieldCount: fields.length
    };
  }

  /**
   * Get all unique field names from items
   */
  getFieldNames(items) {
    const fieldSet = new Set();
    
    // If schema is defined, use field order from schema
    if (this.config.listing?.fields) {
      for (const field of this.config.listing.fields) {
        fieldSet.add(field.name);
      }
    }

    // Add any additional fields found in data
    for (const item of items) {
      for (const key of Object.keys(item)) {
        fieldSet.add(key);
      }
    }

    return Array.from(fieldSet);
  }

  /**
   * Escape CSV value
   */
  escapeCSVValue(value) {
    if (value === null || value === undefined) {
      return '';
    }

    // Convert to string
    let strValue = String(value);

    // Check if value needs escaping
    if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n') || strValue.includes('\r')) {
      // Escape double quotes by doubling them
      strValue = strValue.replace(/"/g, '""');
      // Wrap in quotes
      return `"${strValue}"`;
    }

    return strValue;
  }

  /**
   * Download blob as file
   */
  async downloadBlob(blob, filename) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          // Clean up object URL after download starts
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          resolve(downloadId);
        }
      });
    });
  }

  /**
   * Export to webhook (HTTP POST)
   */
  async exportToWebhook(items, webhookUrl) {
    const maxRetries = 3;
    const batchSize = 100;
    
    // Split items into batches
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    const results = [];
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      let success = false;
      let lastError = null;

      for (let attempt = 0; attempt < maxRetries && !success; attempt++) {
        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              batch: batchIndex + 1,
              totalBatches: batches.length,
              items: batch,
              timestamp: new Date().toISOString()
            }),
            timeout: 30000
          });

          if (response.ok) {
            success = true;
            results.push({ batch: batchIndex + 1, success: true });
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (error) {
          lastError = error;
          
          if (attempt < maxRetries - 1) {
            // Exponential backoff
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!success) {
        results.push({ 
          batch: batchIndex + 1, 
          success: false, 
          error: lastError?.message 
        });
      }
    }

    return {
      success: results.every(r => r.success),
      results,
      totalItems: items.length,
      totalBatches: batches.length
    };
  }

  /**
   * Chunk large datasets for export
   */
  async exportInChunks(items, chunkSize = 1000) {
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }

    const exports = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const filename = this.config.export?.filename || 'scrape';
      const baseName = filename.replace(/\.(csv|json)$/, '');
      const ext = this.config.export?.format === 'csv' ? 'csv' : 'json';
      const chunkFilename = `${baseName}_part${i + 1}.${ext}`;

      const result = await this.exportData(chunk);
      exports.push({ ...result, chunk: i + 1, totalChunks: chunks.length });
    }

    return {
      success: true,
      exports,
      totalItems: items.length,
      totalChunks: chunks.length
    };
  }
}

/**
 * Validate data against schema
 */
export class DataValidator {
  constructor(config) {
    this.config = config;
  }

  /**
   * Validate a single item
   */
  validateItem(item) {
    const errors = [];
    const fields = this.config.listing?.fields || [];

    for (const fieldConfig of fields) {
      const value = item[fieldConfig.name];

      // Check required fields
      if (fieldConfig.required && (value === null || value === undefined || value === '')) {
        errors.push({
          field: fieldConfig.name,
          error: 'Required field is missing'
        });
      }

      // Type validation
      if (value !== null && value !== undefined && fieldConfig.type) {
        const isValid = this.validateType(value, fieldConfig.type);
        if (!isValid) {
          errors.push({
            field: fieldConfig.name,
            error: `Invalid type, expected ${fieldConfig.type}`
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate type
   */
  validateType(value, expectedType) {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'date':
        return !isNaN(Date.parse(value));
      case 'url':
        try {
          new URL(value);
          return true;
        } catch {
          return false;
        }
      default:
        return true;
    }
  }

  /**
   * Validate all items and return report
   */
  validateAll(items) {
    const results = items.map(item => this.validateItem(item));
    const validItems = results.filter(r => r.valid).length;
    const invalidItems = results.filter(r => !r.valid);

    return {
      totalItems: items.length,
      validItems,
      invalidItems: invalidItems.length,
      validPercentage: (validItems / items.length) * 100,
      errors: invalidItems
    };
  }
}
