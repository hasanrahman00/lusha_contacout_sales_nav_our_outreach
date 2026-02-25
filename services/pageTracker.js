class PageTracker {
  constructor(job) {
    this._urls = job.urls || [{ urlNumber: 1, url: job.listUrl }];
    this._urlIndex = job.urlIndex || 0;
    this._pageIndex = job.pageIndex || 1;
    this._completedPages = new Set(); // Track "urlIndex:pageIndex" combos
  }

  currentUrlIndex() {
    return this._urlIndex;
  }

  currentPageIndex() {
    return this._pageIndex;
  }

  currentUrl() {
    return this._urls[this._urlIndex]?.url || "";
  }

  currentUrlNumber() {
    return this._urls[this._urlIndex]?.urlNumber || this._urlIndex + 1;
  }

  totalUrls() {
    return this._urls.length;
  }

  advancePage() {
    this._completedPages.add(`${this._urlIndex}:${this._pageIndex}`);
    this._pageIndex += 1;
    return this.getPosition();
  }

  advanceUrl() {
    this._urlIndex += 1;
    this._pageIndex = 1;
    if (this._urlIndex >= this._urls.length) {
      return null;
    }
    return this.getPosition();
  }

  isFinished() {
    return this._urlIndex >= this._urls.length;
  }

  setPosition(urlIndex, pageIndex) {
    this._urlIndex = urlIndex;
    this._pageIndex = pageIndex;
  }

  getPosition() {
    return {
      urlIndex: this._urlIndex,
      pageIndex: this._pageIndex,
      urlNumber: this.currentUrlNumber(),
    };
  }

  isPageCompleted(urlIndex, pageIndex) {
    return this._completedPages.has(`${urlIndex}:${pageIndex}`);
  }

  validatePageTransition(actualPageNumber) {
    return actualPageNumber === this._pageIndex;
  }
}

const createTracker = (job) => new PageTracker(job);

module.exports = { createTracker };
