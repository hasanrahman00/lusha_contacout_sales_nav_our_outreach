const fs = require("fs");
const path = require("path");
const { ensureCsvHeader, appendCsvRow } = require("../utils/csvFile");
const { dataDir } = require("../config/paths");
const { createJob, updateJob, getJob } = require("./jobStore");
const { startScraper, stopScraper } = require("./scraperSession");
const { extractLushaContacts } = require("../automation/lusha/extract");
const { clickLushaMinimize, clickLushaBadge } = require("../automation/lusha/actions");
const { clickContactoutBadge } = require("../automation/contactout/actions");
const { extractContactoutData } = require("../automation/contactout/extract");
const { minimizeContactout } = require("../automation/contactout/minimize");
const { extractSalesNavLeads } = require("../automation/salesNav/extract");
const { cleanName } = require("../utils/nameCleaner");
const { humanScrollSalesDashboard } = require("../automation/utils/salesDashBoardScroller");
const { clickNextPage, clickNextPageWithRetry, getPageInfo, getLeadListKey } = require("../automation/utils/pagination");
const { waitForAnyVisible, waitForSalesNavReady } = require("../automation/utils/dom");
const { disconnectBrowser } = require("./browser/launch");
const { createTracker } = require("./pageTracker");

const intervals = new Map();
const sessions = new Map();

const normalizeName = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
};

const createCsvPath = (listName) => {
  const safe = normalizeName(listName || "job");
  const stamp = Date.now();
  return path.join(dataDir, `${safe}-${stamp}.csv`);
};

const csvHeader = "URL Number,Page Number,Full Name,First Name,Last Name,Title,Company Name,Person Address,LinkedIn URL,Website,Website_one";

const escapeCsvValue = (value) => {
  const text = String(value ?? "");
  if (text.includes("\"") || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/\"/g, '""')}"`;
  }
  return text;
};

const toCsvRow = (record) => {
  const domains = Array.isArray(record.domains) ? record.domains : [];
  return [
    escapeCsvValue(record.urlNumber ?? ""),
    escapeCsvValue(record.pageNumber ?? ""),
    escapeCsvValue(record.fullName),
    escapeCsvValue(record.firstName),
    escapeCsvValue(record.lastName),
    escapeCsvValue(record.title || ""),
    escapeCsvValue(record.companyName),
    escapeCsvValue(record.location || ""),
    escapeCsvValue(record.linkedInUrl || ""),
    escapeCsvValue(domains[0] || ""),
    escapeCsvValue(domains[1] || ""),
  ].join(",");
};

const mergeDomains = (records, extensionRecords) => {
  if (!Array.isArray(records) || !Array.isArray(extensionRecords)) {
    return records;
  }
  for (const ext of extensionRecords) {
    const extRawName = String(ext.fullName || "");
    const extCleaned = cleanName(extRawName);
    const extFirstName = extCleaned.split(/\s+/)[0]?.toLowerCase();
    const extDomains = Array.isArray(ext.domains) ? ext.domains : [];
    if (!extFirstName || extDomains.length === 0) {
      continue;
    }
    for (const record of records) {
      if (!record) {
        continue;
      }
      const firstNameMatch =
        record.firstName && record.firstName.toLowerCase() === extFirstName;
      if (firstNameMatch) {
        if (!record.domains || record.domains.length === 0) {
          record.domains = [...extDomains];
        }
        break;
      }
    }
  }
  return records;
};

const hasLushaContacts = async (page, timeoutMs = 1500) => {
  const selectors = [
    "[data-test-id='bulk-contact-container-with-data']",
    ".bulk-contact-profile-container",
  ];
  try {
    await waitForAnyVisible(page, selectors, timeoutMs);
    return true;
  } catch (error) {
    return false;
  }
};

const hasContactoutContacts = async (page, timeoutMs = 1500) => {
  try {
    await waitForAnyVisible(page, ["[data-testid='contact-information']"], timeoutMs);
    return true;
  } catch (error) {
    return false;
  }
};

const detectLushaLoginPanel = async (page) => {
  for (const frame of page.frames()) {
    try {
      const name = frame.name() || "";
      if (name && name !== "LU__extension_iframe") {
        continue;
      }
      const found = await frame.evaluate(() => {
        const root = document.querySelector('#root');
        const loginBtn = document.querySelector('.login-btn, .lusha-login button');
        const loginText = document.querySelector('.lusha-login');
        return Boolean(root && (loginBtn || loginText));
      });
      if (found) {
        return true;
      }
    } catch (error) {
      // ignore
    }
  }
  return false;
};

const detectContactoutLoginPanel = async (page) => {
  for (const frame of page.frames()) {
    try {
      const found = await frame.evaluate(() => {
        const root = document.querySelector('#root');
        const loginBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          /login|sign up/i.test((b.textContent || ''))
        );
        const headerLogo = document.querySelector('[data-testid="header-logo"]');
        const signupTitle = Array.from(document.querySelectorAll('h1')).some((h) =>
          /sign up/i.test(h.textContent || '')
        );
        return Boolean(root && (loginBtn || signupTitle) && headerLogo);
      });
      if (found) {
        return true;
      }
    } catch (error) {
      // ignore
    }
  }
  return false;
};

const runPageExtraction = async ({ page, job, filePath, pageIndex, total, urlNumber }) => {
  const extractDelayMs = Number(process.env.EXTRACT_DELAY_MS || 50);
  const timings = {
    preExtractMs: 0,
    scrollMs: 0,
    salesNavExtractMs: 0,
    lushaExtractMs: 0,
    lushaMinimizeMs: 0,
    contactoutClickMs: 0,
    contactoutExtractMs: 0,
    csvWriteMs: 0,
  };
  const flowStart = Date.now();

  // 1. Pre-extraction delay
  if (extractDelayMs > 0 && page) {
    const tPre = Date.now();
    await page.waitForTimeout(extractDelayMs);
    timings.preExtractMs = Date.now() - tPre;
  }

  // 2. Click Lusha badge to activate extension
  if (page) {
    try {
      await clickLushaBadge(page, Number(process.env.LUSHA_BADGE_TIMEOUT_MS || 4000));
    } catch (error) {
      // keep going
    }
  }

  // 3. Human scroll the dashboard
  if (page) {
    const tScroll = Date.now();
    await humanScrollSalesDashboard(page, {
      minSteps: Number(process.env.HUMAN_SCROLL_MIN_STEPS || 2),
      maxSteps: Number(process.env.HUMAN_SCROLL_MAX_STEPS || 3),
      stepPx: Number(process.env.HUMAN_SCROLL_STEP_PX || 300),
      minDelayMs: Number(process.env.HUMAN_SCROLL_MIN_DELAY_MS || 50),
      maxDelayMs: Number(process.env.HUMAN_SCROLL_MAX_DELAY_MS || 150),
      timeoutMs: Number(process.env.HUMAN_SCROLL_TIMEOUT_MS || 15000),
      maxRounds: Number(process.env.HUMAN_SCROLL_MAX_ROUNDS || 5),
      bottomStallLimit: Number(process.env.HUMAN_SCROLL_BOTTOM_STALL_LIMIT || 2),
    });
    timings.scrollMs = Date.now() - tScroll;
  }

  // 4. Extract lead data from Sales Nav DOM
  const tSalesNav = Date.now();
  const records = page ? await extractSalesNavLeads(page) : [];
  timings.salesNavExtractMs = Date.now() - tSalesNav;

  // 5. Extract Lusha domains and merge by first name
  let lushaSeconds = 0;
  try {
    if (page) {
      const lushaVisible = await hasLushaContacts(page, 800);
      if (!lushaVisible) {
        const lushaLogin = await detectLushaLoginPanel(page);
        if (lushaLogin) {
          throw new Error("Lusha login expired. Please re-login in your Chrome profile.");
        }
      }
      const lushaStart = Date.now();
      const lushaRecords = await extractLushaContacts(page, { maxCards: 25, debug: true, retryOnTimeout: true });
      timings.lushaExtractMs = Date.now() - lushaStart;
      lushaSeconds = Number((timings.lushaExtractMs / 1000).toFixed(2));
      mergeDomains(records, lushaRecords);

      // 6. Minimize Lusha
      const tMin = Date.now();
      await clickLushaMinimize(page, { timeoutMs: 800, preferFrame: true });
      timings.lushaMinimizeMs = Date.now() - tMin;
    }
  } catch (error) {
    if (error && error.message && error.message.includes("login expired")) {
      throw error;
    }
  }
  updateJob(job.id, { lushaSeconds });

  // 7. Click ContactOut badge and extract domains immediately
  let contactoutSeconds = 0;
  try {
    if (page) {
      const tClick = Date.now();
      await clickContactoutBadge(page, {
        timeoutMs: Number(process.env.CONTACTOUT_CLICK_TIMEOUT_MS || 1500),
        skipReadyWait: true,
        perFrameWaitMs: Number(process.env.CONTACTOUT_FRAME_WAIT_MS || 50),
        mainDocWaitMs: Number(process.env.CONTACTOUT_MAIN_WAIT_MS || 100),
        postMinimizeDelayMs: Number(process.env.CONTACTOUT_MINIMIZE_DELAY_MS || 50),
        maxFrames: Number(process.env.CONTACTOUT_MAX_FRAMES || 6),
      });
      timings.contactoutClickMs = Date.now() - tClick;
      const expectedLeadKey = await getLeadListKey(page).catch(() => null);
      const contactoutStart = Date.now();
      const contactoutData = await extractContactoutData(page, {
        timeoutMs: Number(process.env.CONTACTOUT_TIMEOUT_MS || 10000),
        debug: true,
        minResults: 1,
        retryDelayMs: Number(process.env.CONTACTOUT_RETRY_DELAY_MS || 200),
        maxRetries: Number(process.env.CONTACTOUT_MAX_RETRIES || 2),
        expectedLeadKey,
      }).catch(() => []);
      timings.contactoutExtractMs = Date.now() - contactoutStart;
      contactoutSeconds = Number((timings.contactoutExtractMs / 1000).toFixed(2));
      mergeDomains(records, contactoutData);

      // 7.5. Minimize ContactOut sidebar
      try {
        await minimizeContactout(page, { timeoutMs: 800 });
      } catch (error) {
        // non-critical, continue
      }
    }
  } catch (error) {
    if (error && error.message && error.message.includes("login expired")) {
      throw error;
    }
  }

  // 8. Write all records to CSV
  let added = 0;
  const tCsv = Date.now();
  for (const record of records) {
    record.urlNumber = urlNumber;
    record.pageNumber = pageIndex;
    appendCsvRow(filePath, toCsvRow(record));
    added += 1;
  }
  timings.csvWriteMs = Date.now() - tCsv;

  const extractSeconds = Number((lushaSeconds + contactoutSeconds).toFixed(2));
  const flowSeconds = Number(((Date.now() - flowStart) / 1000).toFixed(2));
  const nextTotal = (total || 0) + added;
  updateJob(job.id, {
    lushaSeconds,
    contactoutSeconds,
    extractSeconds,
    totalSeconds: flowSeconds,
    total: nextTotal,
    pageIndex,
  });
  console.log(
    `[timing][page:${pageIndex}] scroll=${timings.scrollMs}ms salesNav=${timings.salesNavExtractMs}ms lushaExtract=${timings.lushaExtractMs}ms lushaMin=${timings.lushaMinimizeMs}ms contactoutClick=${timings.contactoutClickMs}ms contactoutExtract=${timings.contactoutExtractMs}ms total=${Math.round(flowSeconds * 1000)}ms`
  );
  console.log(`[timing][page:${pageIndex}] csvWrite=${timings.csvWriteMs}ms rows=${added}`);
  return { added, total: nextTotal };
};

const runPaginatedExtraction = async ({ page, job, filePath, initialTotal, tracker }) => {
  let total = initialTotal || 0;
  const maxPagesEnv = process.env.MAX_PAGES;
  const maxPages = Number.isFinite(Number(maxPagesEnv)) ? Number(maxPagesEnv) : 100;
  let lastPageNumber = null;
  if (page) {
    const info = await getPageInfo(page).catch(() => null);
    lastPageNumber = info?.pageNumber ?? null;
  }
  for (let i = 0; i < maxPages; i += 1) {
    // Check if job was stopped
    const currentJob = getJob(job.id);
    if (currentJob && currentJob.status === "Stopped") {
      console.log("[pagination] job stopped by user");
      return { total, failed: false };
    }

    const pageIndex = tracker.currentPageIndex();
    const urlNumber = tracker.currentUrlNumber();

    let result;
    try {
      result = await runPageExtraction({ page, job, filePath, pageIndex, total, urlNumber });
    } catch (error) {
      const message = String(error.message || error);
      updateJob(job.id, { status: "Failed", error: message, ...tracker.getPosition() });
      await disconnectBrowser();
      return { total, failed: true, error: message };
    }
    total = result.total;
    // Persist position after each successful page
    updateJob(job.id, { ...tracker.getPosition(), total });

    if (!page) {
      break;
    }
    console.log(`[pagination] url:${urlNumber} page:${pageIndex} done, moving next...`);
    const expectedNext = lastPageNumber ? lastPageNumber + 1 : null;
    const next = await clickNextPageWithRetry(page, {
      timeoutMs: Number(process.env.NEXT_PAGE_TIMEOUT_MS || 10000),
      expectedNext,
      maxRetries: 3,
    });
    if (!next.moved) {
      const reason = next.reason || "no-move";
      if (reason === "disabled") {
        console.log("[pagination] reached last page");
        break;
      }
      // After all retries exhausted, log but don't crash
      console.log(`[pagination] all retries exhausted: ${reason}`);
      if (reason.includes("page-mismatch")) {
        // Page mismatch after retries = data integrity risk, stop gracefully
        const errorMessage = `Pagination stopped after retries: ${reason}`;
        updateJob(job.id, { status: "Failed", error: errorMessage, ...tracker.getPosition() });
        return { total, failed: true, error: errorMessage };
      }
      // For timeouts, try to continue from current position
      console.log("[pagination] attempting to continue from current page state");
      const currentInfo = await getPageInfo(page).catch(() => null);
      if (currentInfo?.pageNumber && currentInfo.pageNumber > (lastPageNumber || 0)) {
        lastPageNumber = currentInfo.pageNumber;
        tracker.advancePage();
        continue;
      }
      const errorMessage = `Pagination failed after 3 retries: ${reason}`;
      updateJob(job.id, { status: "Failed", error: errorMessage, ...tracker.getPosition() });
      return { total, failed: true, error: errorMessage };
    }
    // Strict page tracking - only update on confirmed navigation
    if (next.pageNumber && lastPageNumber && next.pageNumber !== lastPageNumber + 1) {
      console.log(`[pagination] page mismatch after move: expected ${lastPageNumber + 1}, got ${next.pageNumber}`);
      const errorMessage = `Pagination page mismatch: expected ${lastPageNumber + 1}, got ${next.pageNumber}`;
      updateJob(job.id, { status: "Failed", error: errorMessage, ...tracker.getPosition() });
      return { total, failed: true, error: errorMessage };
    }
    lastPageNumber = next.pageNumber || (lastPageNumber ? lastPageNumber + 1 : null);
    tracker.advancePage();
  }
  if (maxPagesEnv && tracker.currentPageIndex() > maxPages) {
    console.log(`[pagination] stopped at MAX_PAGES=${maxPages}`);
  }
  return { total, failed: false };
};

const startJob = async ({ listName, listUrl, urls, inputMode }) => {
  const filePath = createCsvPath(listName);
  ensureCsvHeader(filePath, csvHeader);

  // Normalize: wrap single URL into array format for uniform handling
  const normalizedUrls = urls || [{ urlNumber: 1, url: listUrl }];
  const effectiveInputMode = inputMode || "single";

  const job = createJob({
    listName,
    listUrl: listUrl || normalizedUrls[0]?.url || "",
    urls: normalizedUrls,
    inputMode: effectiveInputMode,
    filePath,
  });

  const tracker = createTracker(job);

  try {
    const session = await startScraper({ ...job, listUrl: tracker.currentUrl() });
    sessions.set(job.id, session);
  } catch (error) {
    updateJob(job.id, { status: "Failed", error: String(error.message || error) });
    throw error;
  }

  let totalAccumulated = 0;

  // Loop over each URL
  while (!tracker.isFinished()) {
    const currentJob = getJob(job.id);
    if (currentJob && currentJob.status === "Stopped") break;

    const session = sessions.get(job.id);
    const page = session?.page;

    // For subsequent URLs, navigate to the next URL
    if (tracker.currentUrlIndex() > 0) {
      if (page) {
        console.log(`[multi-url] navigating to URL ${tracker.currentUrlNumber()} (${tracker.currentUrlIndex() + 1}/${normalizedUrls.length})`);
        await page.goto(tracker.currentUrl(), { waitUntil: "domcontentloaded" });
        await waitForSalesNavReady(page).catch(() => null);
      }
    }

    updateJob(job.id, { ...tracker.getPosition() });

    const result = await runPaginatedExtraction({
      page,
      job,
      filePath,
      initialTotal: totalAccumulated,
      tracker,
    });

    totalAccumulated = result.total;

    if (result.failed) {
      return updateJob(job.id, {
        status: "Failed",
        error: result.error || "Extraction failed",
        total: totalAccumulated,
        ...tracker.getPosition(),
      });
    }

    // Advance to next URL
    const advanced = tracker.advanceUrl();
    if (!advanced) break; // All URLs processed
  }

  const keepBrowser = String(process.env.KEEP_BROWSER_AFTER_JOB || "true").toLowerCase() === "true";
  const session = sessions.get(job.id);
  if (!keepBrowser && session) {
    await stopScraper(session);
    sessions.delete(job.id);
  }
  return updateJob(job.id, { status: "Completed", total: totalAccumulated });
};

const resumeJob = async (id) => {
  const job = getJob(id);
  if (!job) {
    return null;
  }
  if (job.status === "Running") {
    return job;
  }
  ensureCsvHeader(job.filePath, csvHeader);

  // Reconstruct tracker from saved position
  const tracker = createTracker(job);
  const resumeUrl = tracker.currentUrl();

  try {
    const session = await startScraper({ ...job, listUrl: resumeUrl });
    sessions.set(job.id, session);
  } catch (error) {
    updateJob(job.id, { status: "Failed", error: String(error.message || error) });
    throw error;
  }

  updateJob(job.id, { status: "Running" });

  const session = sessions.get(job.id);
  const page = session?.page;

  // If resuming mid-URL at a specific page, navigate directly to that page
  if (page && tracker.currentPageIndex() > 1) {
    try {
      const currentUrl = new URL(resumeUrl);
      currentUrl.searchParams.set("page", String(tracker.currentPageIndex()));
      console.log(`[resume] navigating to URL ${tracker.currentUrlNumber()}, page ${tracker.currentPageIndex()}`);
      await page.goto(currentUrl.toString(), { waitUntil: "domcontentloaded" });
      await waitForSalesNavReady(page).catch(() => null);
    } catch (error) {
      console.log(`[resume] failed to navigate to page ${tracker.currentPageIndex()}, starting from page 1`);
      tracker.setPosition(tracker.currentUrlIndex(), 1);
    }
  }

  let totalAccumulated = job.total || 0;
  const savedUrlIndex = job.urlIndex || 0;
  const normalizedUrls = job.urls || [{ urlNumber: 1, url: job.listUrl }];

  // Continue from current URL through remaining URLs
  while (!tracker.isFinished()) {
    const currentJob = getJob(job.id);
    if (currentJob && currentJob.status === "Stopped") break;

    // If not the URL we resumed on, navigate to it
    if (tracker.currentUrlIndex() > savedUrlIndex) {
      if (page) {
        console.log(`[resume] navigating to URL ${tracker.currentUrlNumber()} (${tracker.currentUrlIndex() + 1}/${normalizedUrls.length})`);
        await page.goto(tracker.currentUrl(), { waitUntil: "domcontentloaded" });
        await waitForSalesNavReady(page).catch(() => null);
      }
    }

    updateJob(job.id, { ...tracker.getPosition() });

    const result = await runPaginatedExtraction({
      page,
      job,
      filePath: job.filePath,
      initialTotal: totalAccumulated,
      tracker,
    });

    totalAccumulated = result.total;

    if (result.failed) {
      return updateJob(job.id, {
        status: "Failed",
        error: result.error || "Extraction failed",
        total: totalAccumulated,
        ...tracker.getPosition(),
      });
    }

    const advanced = tracker.advanceUrl();
    if (!advanced) break;
  }

  const keepBrowser = String(process.env.KEEP_BROWSER_AFTER_JOB || "true").toLowerCase() === "true";
  if (!keepBrowser && session) {
    await stopScraper(session);
    sessions.delete(job.id);
  }
  return updateJob(job.id, { status: "Completed", total: totalAccumulated });
};

const stopJob = async (id) => {
  const job = getJob(id);
  if (!job) {
    return null;
  }
  if (intervals.has(id)) {
    clearInterval(intervals.get(id));
    intervals.delete(id);
  }
  if (sessions.has(id)) {
    await stopScraper(sessions.get(id));
    sessions.delete(id);
  }
  return updateJob(id, { status: "Stopped" });
};

const completeJob = (id) => {
  const job = getJob(id);
  if (!job) {
    return null;
  }
  if (intervals.has(id)) {
    clearInterval(intervals.get(id));
    intervals.delete(id);
  }
  return updateJob(id, { status: "Completed" });
};

const failJob = (id, error) => {
  const job = getJob(id);
  if (!job) {
    return null;
  }
  if (intervals.has(id)) {
    clearInterval(intervals.get(id));
    intervals.delete(id);
  }
  return updateJob(id, { status: "Failed", error });
};

const deleteJobFile = (job) => {
  if (!job) {
    return;
  }
  if (job.filePath && fs.existsSync(job.filePath)) {
    fs.unlinkSync(job.filePath);
  }
};

module.exports = {
  startJob,
  resumeJob,
  stopJob,
  completeJob,
  failJob,
  deleteJobFile,
};
