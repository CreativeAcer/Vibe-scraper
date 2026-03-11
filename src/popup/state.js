/**
 * Shared mutable state for the Vibe Scraper popup.
 * Imported as a singleton by all popup modules.
 */
export const state = {
  currentJobId: null,
  jobs: [],
  startTime: null,
  timerInterval: null,
  currentFields: [],
  serverUp: false,
};
