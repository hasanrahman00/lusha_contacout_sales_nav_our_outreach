const fs = require("fs");
const path = require("path");
const { ensureCsvHeader, appendCsvRow, loadExistingLinkedInUrls } = require("../utils/csvFile");
const { dataDir } = require("../config/paths");
const { createJob, updateJob, getJob } = require("./jobStore");
const { startScraper, stopScraper } = require("./scraperSession");
const { extractLushaContacts } = require("../automation/lusha/extract");
const { clickLushaMinimize, clickLushaBadge } = require("../automation/lusha/actions");
const { clickContactoutBadge } = require("../automation/contactout/actions");
const { extractContactoutData } = require("../automation/contactout/extract");
const { minimizeContactout } = require("../automation/contactout/minimize");
const { extractSalesNavLeads } = require("../automation/salesNav/extract");
const { humanScrollSalesDashboard } = require("../automation/utils/salesDashBoardScroller");
const { clickNextPageWithRetry, getPageInfo, getLeadListKey } = require("../automation/utils/pagination");
const { waitForAnyVisible, waitForSalesNavReady, waitForLeadCountStable } = require("../automation/utils/dom");
const { disconnectBrowser } = require("./browser/launch");
const { createTracker } = require("./pageTracker");

const sessions = new Map();

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

const csvHeader =
  "URL Number,Page Number,Full Name,First Name,Last Name,Title,Company Name,Person Address,LinkedIn URL,Website,Website_one";

const escapeCsvValue = (value) => {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
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

// ─── Extension Detection ────────────────────────────────────────────────────

const hasLushaContacts = async (page, timeoutMs = 2000) => {
  const selectors = [
    "[data-test-id='bulk-contact-container-with-data']",
    ".bulk-contact-profile-container",
  ];

  // Check main page first
  try {
    await waitForAnyVisible(page, selectors, Math.min(timeoutMs, 1500));
    return true;
  } catch (error) {
    // not in main page, check iframe
  }

  // Check inside Lusha iframe (where it actually renders)
  const lushaFrame = page.frames().find((f) => {
    const url = f.url() || "";
    return f.name() === "LU__extension_iframe" || url.includes("lusha");
  });
  if (!lushaFrame) return false;

  try {
    await waitForAnyVisible(lushaFrame, selectors, timeoutMs);
    return true;
  } catch (error) {
    return false;
  }
};

const hasContactoutContacts = async (page, timeoutMs = 2000) => {
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
      if (name && name !== "LU__extension_iframe") continue;
      const found = await frame.evaluate(() => {
        const root = document.querySelector("#root");
        const loginBtn = document.querySelector(".login-btn, .lusha-login button");
        const loginText = document.querySelector(".lusha-login");
        return Boolean(root && (loginBtn || loginText));
      });
      if (found) return true;
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
        const root = document.querySelector("#root");
        const loginBtn = Array.from(document.querySelectorAll("button")).find((b) =>
          /login|sign up/i.test(b.textContent || "")
        );
        const headerLogo = document.querySelector('[data-testid="header-logo"]');
        const signupTitle = Array.from(document.querySelectorAll("h1")).some((h) =>
          /sign up/i.test(h.textContent || "")
        );
        return Boolean(root && (loginBtn || signupTitle) && headerLogo);
      });
      if (found) return true;
    } catch (error) {
      // ignore
    }
  }
  return false;
};

// ─── Page-to-Page Merge Logic ───────────────────────────────────────────────
//
// RULES:
// 1. Sales Nav records are the master list — always appended
// 2. Lusha merge: match by cleaned firstName only. If no match → skip
// 3. ContactOut merge: match by cleaned firstName first, else lastName fallback.
//    But if Website column is already enriched by Lusha → skip (don't overwrite)
// 4. All merging is PAGE-SCOPED — only this page's extension data merges with
//    this page's Sales Nav records
// 5. Duplicates tracked by LinkedIn URL — never append same profile twice

/**
 * Merge Lusha domains into Sales Nav records (page-scoped).
 * Match: salesNav.firstName === lusha.firstName (case-insensitive).
 * Only fills if record has no domains yet.
 */
const mergeLushaDomains = (salesNavRecords, lushaRecords) => {
  if (!Array.isArray(lushaRecords) || lushaRecords.length === 0) {
    return;
  }

  let matched = 0;
  for (const lusha of lushaRecords) {
    const lushaFirst = (lusha.firstName || "").toLowerCase().trim();
    if (!lushaFirst || !lusha.domains || lusha.domains.length === 0) {
      continue;
    }

    // Find matching Sales Nav record by firstName
    const match = salesNavRecords.find(
      (rec) =>
        rec &&
        (rec.firstName || "").toLowerCase().trim() === lushaFirst &&
        (!rec.domains || rec.domains.length === 0)
    );

    if (match) {
      match.domains = [...lusha.domains];
      match._enrichedBy = "lusha";
      matched += 1;
    }
    // If no match → skip (as specified)
  }
  console.log(`[merge:lusha] matched ${matched}/${lushaRecords.length} records`);
};

/**
 * Merge ContactOut domains into Sales Nav records (page-scoped).
 * Match priority:
 *   1. salesNav.firstName === contactout.firstName
 *   2. salesNav.lastName === contactout.lastName (fallback)
 * Skip if Website column already enriched by Lusha.
 */
const mergeContactoutDomains = (salesNavRecords, contactoutRecords) => {
  if (!Array.isArray(contactoutRecords) || contactoutRecords.length === 0) {
    return;
  }

  let matched = 0;
  for (const co of contactoutRecords) {
    const coFirst = (co.firstName || "").toLowerCase().trim();
    const coLast = (co.lastName || "").toLowerCase().trim();
    if ((!coFirst && !coLast) || !co.domains || co.domains.length === 0) {
      continue;
    }

    // Find matching Sales Nav record
    let match = null;

    // Priority 1: firstName match
    if (coFirst) {
      match = salesNavRecords.find(
        (rec) =>
          rec &&
          (rec.firstName || "").toLowerCase().trim() === coFirst &&
          (!rec.domains || rec.domains.length === 0)
      );
    }

    // Priority 2: lastName fallback (only if firstName didn't match)
    if (!match && coLast) {
      match = salesNavRecords.find(
        (rec) =>
          rec &&
          (rec.lastName || "").toLowerCase().trim() === coLast &&
          (!rec.domains || rec.domains.length === 0)
      );
    }

    if (match) {
      // Skip if already enriched by Lusha
      if (match._enrichedBy === "lusha" && match.domains && match.domains.length > 0) {
        continue;
      }
      match.domains = [...co.domains];
      match._enrichedBy = "contactout";
      matched += 1;
    }
  }
  console.log(`[merge:contactout] matched ${matched}/${contactoutRecords.length} records`);
};

// ─── Per-Page Extraction Flow (PARALLEL) ─────────────────────────────────────
//
// Timeline:
//
//  ┌─ LANE A: Scroll page (loads lead cards into DOM) ─────────────────────┐
//  │  humanScrollSalesDashboard()                                          │
//  └───────────────────────────────────────────────────────────────────────┘
//        ↕ PARALLEL — these operate on different DOM areas
//  ┌─ LANE B: Open Lusha sidebar (extension populates its iframe) ────────┐
//  │  clickLushaBadge() → wait for container visible                       │
//  └───────────────────────────────────────────────────────────────────────┘
//                              │
//               both lanes done ▼
//        ┌─────────────────────┬─────────────────────────┐
//        │ Extract Sales Nav   │  Extract Lusha contacts  │  ← PARALLEL
//        │ (reads LEAD cards)  │  (reads Lusha iframe)    │
//        └─────────────────────┴─────────────────────────┘
//                              │
//                     merge Lusha → Sales Nav (in memory)
//                     minimize Lusha
//                              │
//                     open ContactOut badge  ← SEQUENTIAL (shares overlay)
//                     extract ContactOut
//                     merge ContactOut → Sales Nav (in memory)
//                     minimize ContactOut
//                              │
//                     dedup by LinkedIn URL → write CSV
//

const runPageExtraction = async ({ page, job, filePath, pageIndex, total, urlNumber, seenUrls }) => {
  const timings = {
    scrollMs: 0,
    lushaBadgeMs: 0,
    parallelPhase1Ms: 0,
    salesNavExtractMs: 0,
    lushaExtractMs: 0,
    parallelPhase2Ms: 0,
    contactoutExtractMs: 0,
    csvWriteMs: 0,
  };
  const flowStart = Date.now();
  let lushaSeconds = 0;
  let lushaCount = 0;
  let contactoutSeconds = 0;
  let contactoutCount = 0;
  let lushaLoginExpired = false;

  if (!page) {
    return { added: 0, total: total || 0 };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 1 — PARALLEL: Scroll page + Open Lusha badge simultaneously
  // ════════════════════════════════════════════════════════════════════════════
  //
  // WHY SAFE: Scroll operates on the main results container.
  //           Lusha badge click triggers the extension iframe overlay.
  //           They don't interfere with each other.

  const tPhase1 = Date.now();

  // Lane A: Scroll the page (loads all 25 lead cards into DOM)
  const scrollPromise = (async () => {
    const tScroll = Date.now();
    await humanScrollSalesDashboard(page, {
      stepPx: Number(process.env.HUMAN_SCROLL_STEP_PX || 250),
      minDelayMs: Number(process.env.HUMAN_SCROLL_MIN_DELAY_MS || 300),
      maxDelayMs: Number(process.env.HUMAN_SCROLL_MAX_DELAY_MS || 700),
      pauseChance: Number(process.env.HUMAN_SCROLL_PAUSE_CHANCE || 0.15),
      pauseMinMs: Number(process.env.HUMAN_SCROLL_PAUSE_MIN_MS || 800),
      pauseMaxMs: Number(process.env.HUMAN_SCROLL_PAUSE_MAX_MS || 1500),
      timeoutMs: Number(process.env.HUMAN_SCROLL_TIMEOUT_MS || 30000),
      maxRounds: Number(process.env.HUMAN_SCROLL_MAX_ROUNDS || 50),
      bottomStallLimit: Number(process.env.HUMAN_SCROLL_BOTTOM_STALL_LIMIT || 3),
      stableTimeoutMs: 5000,
      stableMs: 800,
    });
    timings.scrollMs = Date.now() - tScroll;
  })();

  // Lane B: Click Lusha badge + wait for its data container to appear
  const lushaReadyPromise = (async () => {
    const tBadge = Date.now();
    try {
      await clickLushaBadge(page, Number(process.env.LUSHA_BADGE_TIMEOUT_MS || 5000));
    } catch (error) {
      console.log(`[lusha] badge click failed: ${error.message}`);
    }
    // Wait for Lusha container to appear (extension loads in parallel with scroll)
    const visible = await hasLushaContacts(page, Number(process.env.LUSHA_WAIT_TIMEOUT_MS || 8000));
    if (!visible) {
      const loginExpired = await detectLushaLoginPanel(page);
      if (loginExpired) {
        lushaLoginExpired = true;
      }
    }
    timings.lushaBadgeMs = Date.now() - tBadge;
    return visible;
  })();

  // Wait for BOTH lanes to complete
  const [, lushaDataReady] = await Promise.all([scrollPromise, lushaReadyPromise]);
  timings.parallelPhase1Ms = Date.now() - tPhase1;

  if (lushaLoginExpired) {
    throw new Error("Lusha login expired. Please re-login in your Chrome profile.");
  }

  console.log(
    `[phase1][page:${pageIndex}] parallel done in ${timings.parallelPhase1Ms}ms (scroll=${timings.scrollMs}ms, lushaBadge=${timings.lushaBadgeMs}ms)`
  );

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 2 — PARALLEL: Extract Sales Nav + Extract Lusha simultaneously
  // ════════════════════════════════════════════════════════════════════════════
  //
  // WHY SAFE: Sales Nav reads from div[data-x-search-result="LEAD"] in main doc.
  //           Lusha reads from LU__extension_iframe (separate DOM tree).
  //           Zero overlap in selectors or DOM nodes.

  const tPhase2 = Date.now();

  // Lane A: Extract Sales Nav lead data
  const salesNavPromise = (async () => {
    const tSalesNav = Date.now();
    const records = await extractSalesNavLeads(page);
    timings.salesNavExtractMs = Date.now() - tSalesNav;
    return records;
  })();

  // Lane B: Extract Lusha contacts (only if sidebar loaded)
  const lushaPromise = (async () => {
    if (!lushaDataReady) {
      console.log(`[lusha][page:${pageIndex}] no contacts visible, skipping extraction`);
      return [];
    }
    const lushaStart = Date.now();
    try {
      const lushaRecords = await extractLushaContacts(page, {
        maxCards: 25,
        debug: true,
        retryOnTimeout: true,
      });
      timings.lushaExtractMs = Date.now() - lushaStart;
      lushaSeconds = Number((timings.lushaExtractMs / 1000).toFixed(2));
      lushaCount = lushaRecords.length;
      return lushaRecords;
    } catch (error) {
      console.log(`[lusha][page:${pageIndex}] extract error: ${error.message}`);
      timings.lushaExtractMs = Date.now() - lushaStart;
      return [];
    }
  })();

  // Wait for BOTH extractions
  const [records, lushaRecords] = await Promise.all([salesNavPromise, lushaPromise]);
  timings.parallelPhase2Ms = Date.now() - tPhase2;

  console.log(
    `[phase2][page:${pageIndex}] parallel done in ${timings.parallelPhase2Ms}ms (salesNav=${timings.salesNavExtractMs}ms/${records.length} leads, lusha=${timings.lushaExtractMs}ms/${lushaCount} contacts)`
  );

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 3 — SEQUENTIAL: Merge Lusha → Minimize Lusha → ContactOut
  // ════════════════════════════════════════════════════════════════════════════
  //
  // WHY SEQUENTIAL: Lusha and ContactOut share the overlay/sidebar space.
  //                 Must minimize Lusha before opening ContactOut.

  // Merge Lusha domains into Sales Nav records (in memory)
  mergeLushaDomains(records, lushaRecords);
  updateJob(job.id, { lushaSeconds });

  // Minimize Lusha sidebar → immediately open ContactOut
  try {
    await clickLushaMinimize(page, { timeoutMs: 1000, preferFrame: true });
  } catch (error) {
    // non-critical
  }

  // Open ContactOut badge immediately after Lusha minimizes (no unnecessary delay)
  try {
    try {
      await clickContactoutBadge(page, {
        timeoutMs: Number(process.env.CONTACTOUT_CLICK_TIMEOUT_MS || 2000),
        skipReadyWait: true,
        perFrameWaitMs: Number(process.env.CONTACTOUT_FRAME_WAIT_MS || 80),
        mainDocWaitMs: Number(process.env.CONTACTOUT_MAIN_WAIT_MS || 150),
        postMinimizeDelayMs: Number(process.env.CONTACTOUT_MINIMIZE_DELAY_MS || 80),
        maxFrames: Number(process.env.CONTACTOUT_MAX_FRAMES || 6),
      });
    } catch (error) {
      console.log(`[contactout] badge click failed: ${error.message}`);
    }

    const expectedLeadKey = await getLeadListKey(page).catch(() => null);
    const contactoutStart = Date.now();
    const contactoutData = await extractContactoutData(page, {
      timeoutMs: Number(process.env.CONTACTOUT_TIMEOUT_MS || 12000),
      debug: true,
      minResults: 1,
      retryDelayMs: Number(process.env.CONTACTOUT_RETRY_DELAY_MS || 300),
      maxRetries: Number(process.env.CONTACTOUT_MAX_RETRIES || 3),
      expectedLeadKey,
    }).catch(() => []);
    timings.contactoutExtractMs = Date.now() - contactoutStart;
    contactoutSeconds = Number((timings.contactoutExtractMs / 1000).toFixed(2));
    contactoutCount = contactoutData.length;

    // Merge ContactOut → Sales Nav (skip if Lusha already enriched)
    mergeContactoutDomains(records, contactoutData);

    // Minimize ContactOut sidebar
    try {
      await minimizeContactout(page, { timeoutMs: 1000 });
    } catch (error) {
      // non-critical
    }
  } catch (error) {
    if (error && error.message && error.message.includes("login expired")) {
      throw error;
    }
    console.log(`[contactout][page:${pageIndex}] error: ${error.message}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 4 — Deduplicate by LinkedIn URL and write to CSV
  // ════════════════════════════════════════════════════════════════════════════

  let added = 0;
  let skippedDuplicates = 0;
  const tCsv = Date.now();
  for (const record of records) {
    record.urlNumber = urlNumber;
    record.pageNumber = pageIndex;

    // Dedup by LinkedIn URL
    const liUrl = (record.linkedInUrl || "").toLowerCase().trim();
    if (liUrl && seenUrls.has(liUrl)) {
      skippedDuplicates += 1;
      continue;
    }

    appendCsvRow(filePath, toCsvRow(record));
    if (liUrl) {
      seenUrls.add(liUrl);
    }
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
    duplicatesSkipped: (getJob(job.id)?.duplicatesSkipped || 0) + skippedDuplicates,
    pageIndex,
  });

  const savedMs = timings.scrollMs + timings.lushaBadgeMs - timings.parallelPhase1Ms;
  console.log(
    `[timing][page:${pageIndex}] phase1=${timings.parallelPhase1Ms}ms phase2=${timings.parallelPhase2Ms}ms contactout=${timings.contactoutExtractMs}ms csv=${timings.csvWriteMs}ms TOTAL=${Math.round(flowSeconds * 1000)}ms (saved ~${savedMs}ms via parallel)`
  );
  console.log(
    `[page:${pageIndex}] added=${added} duplicatesSkipped=${skippedDuplicates} totalSoFar=${nextTotal}`
  );
  return { added, total: nextTotal };
};

// ─── Paginated Extraction Loop ─────────────────────────────────────────────

const runPaginatedExtraction = async ({ page, job, filePath, initialTotal, tracker, seenUrls }) => {
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
      result = await runPageExtraction({ page, job, filePath, pageIndex, total, urlNumber, seenUrls });
    } catch (error) {
      const message = String(error.message || error);
      updateJob(job.id, { status: "Failed", error: message, ...tracker.getPosition() });
      await disconnectBrowser();
      return { total, failed: true, error: message };
    }
    total = result.total;

    // ✅ Persist position after each successful page (for resume)
    updateJob(job.id, {
      ...tracker.getPosition(),
      total,
      lastSuccessfulUrlIndex: tracker.currentUrlIndex(),
      lastSuccessfulPageIndex: tracker.currentPageIndex(),
    });

    if (!page) {
      break;
    }

    // ─── Scroll back to top before pagination ────────────────────────────
    try {
      await page.evaluate(() => {
        const pag = document.querySelector(".artdeco-pagination");
        if (pag) pag.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      await page.waitForTimeout(500);
    } catch (error) {
      // non-critical
    }

    console.log(`[pagination] url:${urlNumber} page:${pageIndex} done, moving next...`);
    const expectedNext = lastPageNumber ? lastPageNumber + 1 : null;
    const next = await clickNextPageWithRetry(page, {
      timeoutMs: Number(process.env.NEXT_PAGE_TIMEOUT_MS || 12000),
      expectedNext,
      maxRetries: 3,
    });
    if (!next.moved) {
      const reason = next.reason || "no-move";
      if (reason === "disabled") {
        console.log("[pagination] reached last page for this URL");
        break;
      }
      console.log(`[pagination] all retries exhausted: ${reason}`);

      // For page-mismatch after retries, try URL-based recovery
      if (reason.includes("page-mismatch") && expectedNext) {
        try {
          const currentUrl = page.url();
          const url = new URL(currentUrl);
          url.searchParams.set("page", String(expectedNext));
          console.log(`[pagination] final URL recovery attempt to page ${expectedNext}`);
          await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
          await waitForSalesNavReady(page);
          await waitForLeadCountStable(page, { timeoutMs: 5000, stableMs: 600 }).catch(() => null);
          const info = await getPageInfo(page);
          if (info.pageNumber === expectedNext) {
            lastPageNumber = expectedNext;
            tracker.advancePage();
            continue;
          }
        } catch (error) {
          // recovery failed
        }
      }

      // For timeouts, check current page state and try to continue
      const currentInfo = await getPageInfo(page).catch(() => null);
      if (currentInfo?.pageNumber && currentInfo.pageNumber > (lastPageNumber || 0)) {
        console.log(`[pagination] recovered — current page ${currentInfo.pageNumber}`);
        lastPageNumber = currentInfo.pageNumber;
        tracker.advancePage();
        continue;
      }

      const errorMessage = `Pagination failed after 3 retries: ${reason}`;
      console.log(`[pagination] ${errorMessage} — stopping this URL gracefully`);
      // ✅ Don't fail the entire job — just stop this URL and move to next
      break;
    }

    // Strict page tracking
    if (next.pageNumber && lastPageNumber && next.pageNumber !== lastPageNumber + 1) {
      console.log(
        `[pagination] page mismatch: expected ${lastPageNumber + 1}, got ${next.pageNumber}`
      );
      // ✅ Don't fail — log warning and continue from what we got
      console.log(`[pagination] accepting page ${next.pageNumber} and continuing`);
    }
    lastPageNumber = next.pageNumber || (lastPageNumber ? lastPageNumber + 1 : null);
    tracker.advancePage();
  }
  if (maxPagesEnv && tracker.currentPageIndex() > maxPages) {
    console.log(`[pagination] stopped at MAX_PAGES=${maxPages}`);
  }
  return { total, failed: false };
};

// ─── Start Job ─────────────────────────────────────────────────────────────

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

  // ✅ Load existing LinkedIn URLs for dedup (empty for new job)
  const seenUrls = loadExistingLinkedInUrls(filePath, 8);
  console.log(`[dedup] loaded ${seenUrls.size} existing LinkedIn URLs from CSV`);

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
        console.log(
          `[multi-url] navigating to URL ${tracker.currentUrlNumber()} (${tracker.currentUrlIndex() + 1}/${normalizedUrls.length})`
        );
        try {
          await page.goto(tracker.currentUrl(), { waitUntil: "domcontentloaded" });
          await waitForSalesNavReady(page).catch(() => null);
          await waitForLeadCountStable(page, { timeoutMs: 5000, stableMs: 600 }).catch(() => null);
        } catch (error) {
          console.log(`[multi-url] navigation failed: ${error.message}`);
          // ✅ Don't fail entire job — skip this URL and move to next
          updateJob(job.id, {
            error: `URL ${tracker.currentUrlNumber()} navigation failed: ${error.message}`,
            ...tracker.getPosition(),
          });
          const advanced = tracker.advanceUrl();
          if (!advanced) break;
          continue;
        }
      }
    }

    updateJob(job.id, { ...tracker.getPosition() });

    const result = await runPaginatedExtraction({
      page,
      job,
      filePath,
      initialTotal: totalAccumulated,
      tracker,
      seenUrls,
    });

    totalAccumulated = result.total;

    if (result.failed) {
      // ✅ For multi-URL: if one URL fails, log and try next instead of killing job
      if (normalizedUrls.length > 1 && !tracker.isFinished()) {
        console.log(`[multi-url] URL ${tracker.currentUrlNumber()} failed, moving to next`);
        updateJob(job.id, {
          error: result.error || "Extraction failed for one URL",
          total: totalAccumulated,
          ...tracker.getPosition(),
        });
        const advanced = tracker.advanceUrl();
        if (!advanced) break;
        continue;
      }
      return updateJob(job.id, {
        status: "Failed",
        error: result.error || "Extraction failed",
        total: totalAccumulated,
        ...tracker.getPosition(),
      });
    }

    // Advance to next URL
    const advanced = tracker.advanceUrl();
    if (!advanced) break;
  }

  const keepBrowser =
    String(process.env.KEEP_BROWSER_AFTER_JOB || "true").toLowerCase() === "true";
  const session = sessions.get(job.id);
  if (!keepBrowser && session) {
    await stopScraper(session);
    sessions.delete(job.id);
  }
  return updateJob(job.id, { status: "Completed", total: totalAccumulated });
};

// ─── Resume Job ────────────────────────────────────────────────────────────

const resumeJob = async (id) => {
  const job = getJob(id);
  if (!job) {
    return null;
  }
  if (job.status === "Running") {
    return job;
  }
  ensureCsvHeader(job.filePath, csvHeader);

  // ✅ Reconstruct tracker from last SUCCESSFUL position (not attempted)
  const resumeUrlIndex = job.lastSuccessfulUrlIndex || job.urlIndex || 0;
  const resumePageIndex = job.lastSuccessfulPageIndex || job.pageIndex || 1;
  // Start from the NEXT page after the last successful one
  const nextPageIndex = resumePageIndex + 1;

  const resumeJob_ = {
    ...job,
    urlIndex: resumeUrlIndex,
    pageIndex: nextPageIndex,
  };

  const tracker = createTracker(resumeJob_);
  const resumeUrl = tracker.currentUrl();

  // ✅ Load existing LinkedIn URLs for dedup on resume
  const seenUrls = loadExistingLinkedInUrls(job.filePath, 8);
  console.log(`[resume:dedup] loaded ${seenUrls.size} existing LinkedIn URLs from CSV`);

  try {
    const session = await startScraper({ ...job, listUrl: resumeUrl });
    sessions.set(job.id, session);
  } catch (error) {
    updateJob(job.id, { status: "Failed", error: String(error.message || error) });
    throw error;
  }

  updateJob(job.id, { status: "Running", error: null });

  const session = sessions.get(job.id);
  const page = session?.page;

  // Navigate directly to the resume page
  if (page && tracker.currentPageIndex() > 1) {
    try {
      const currentUrl = new URL(resumeUrl);
      currentUrl.searchParams.set("page", String(tracker.currentPageIndex()));
      console.log(
        `[resume] navigating to URL ${tracker.currentUrlNumber()}, page ${tracker.currentPageIndex()}`
      );
      await page.goto(currentUrl.toString(), { waitUntil: "domcontentloaded" });
      await waitForSalesNavReady(page).catch(() => null);
      await waitForLeadCountStable(page, { timeoutMs: 5000, stableMs: 600 }).catch(() => null);
    } catch (error) {
      console.log(
        `[resume] failed to navigate to page ${tracker.currentPageIndex()}, starting from page 1`
      );
      tracker.setPosition(tracker.currentUrlIndex(), 1);
    }
  }

  let totalAccumulated = job.total || 0;
  const normalizedUrls = job.urls || [{ urlNumber: 1, url: job.listUrl }];

  // Continue from current URL through remaining URLs
  while (!tracker.isFinished()) {
    const currentJob = getJob(job.id);
    if (currentJob && currentJob.status === "Stopped") break;

    // Navigate to next URL if we've advanced past the resume URL
    if (tracker.currentUrlIndex() > resumeUrlIndex) {
      if (page) {
        console.log(
          `[resume] navigating to URL ${tracker.currentUrlNumber()} (${tracker.currentUrlIndex() + 1}/${normalizedUrls.length})`
        );
        try {
          await page.goto(tracker.currentUrl(), { waitUntil: "domcontentloaded" });
          await waitForSalesNavReady(page).catch(() => null);
          await waitForLeadCountStable(page, { timeoutMs: 5000, stableMs: 600 }).catch(() => null);
        } catch (error) {
          console.log(`[resume] navigation failed for URL ${tracker.currentUrlNumber()}: ${error.message}`);
          const advanced = tracker.advanceUrl();
          if (!advanced) break;
          continue;
        }
      }
    }

    updateJob(job.id, { ...tracker.getPosition() });

    const result = await runPaginatedExtraction({
      page,
      job,
      filePath: job.filePath,
      initialTotal: totalAccumulated,
      tracker,
      seenUrls,
    });

    totalAccumulated = result.total;

    if (result.failed) {
      if (normalizedUrls.length > 1 && !tracker.isFinished()) {
        console.log(`[resume] URL ${tracker.currentUrlNumber()} failed, moving to next`);
        const advanced = tracker.advanceUrl();
        if (!advanced) break;
        continue;
      }
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

  const keepBrowser =
    String(process.env.KEEP_BROWSER_AFTER_JOB || "true").toLowerCase() === "true";
  if (!keepBrowser && session) {
    await stopScraper(session);
    sessions.delete(job.id);
  }
  return updateJob(job.id, { status: "Completed", total: totalAccumulated });
};

// ─── Stop / Complete / Fail / Delete ──────────────────────────────────────

const stopJob = async (id) => {
  const job = getJob(id);
  if (!job) {
    return null;
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
  return updateJob(id, { status: "Completed" });
};

const failJob = (id, error) => {
  const job = getJob(id);
  if (!job) {
    return null;
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