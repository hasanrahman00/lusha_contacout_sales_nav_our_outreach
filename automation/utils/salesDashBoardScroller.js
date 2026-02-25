const { waitForAnyVisible, waitForLeadCountStable } = require("./dom");

const randInt = (min, max) => {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
};

/**
 * Full human-like scroll of the Sales Nav results list.
 * Scrolls down in small increments with random pauses, like a real user reading.
 * Continues until we hit the bottom (scroll position stops changing).
 */
const salesDashBoardScroller = async (page, opts = {}) => {
  const {
    trackerSelector = "a[data-control-name^='view_lead_panel']",
    scrollSelector = null,
    stepPx = 250,
    minDelayMs = 300,
    maxDelayMs = 700,
    pauseChance = 0.15,
    pauseMinMs = 800,
    pauseMaxMs = 1500,
    highlight = false,
    timeoutMs = 30000,
    maxRounds = 50,
    bottomStallLimit = 3,
  } = opts;

  await waitForAnyVisible(page, [trackerSelector], timeoutMs);

  const result = await page.evaluate(async (cfg) => {
    const delay = (ms) => new Promise((res) => setTimeout(res, ms));
    const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

    // Find the scrollable container
    let el = null;
    if (cfg.scrollSelector) {
      el = document.querySelector(cfg.scrollSelector);
    }
    if (!el) {
      const cands = Array.from(document.querySelectorAll("main, section, div, ul, ol"))
        .filter((n) => n.scrollHeight > n.clientHeight && n.offsetHeight > 300)
        .sort((a, b) => b.clientHeight - a.clientHeight);
      el = cands[0] || null;
    }
    if (!el) {
      return { status: "no-scroll-container", leadCount: 0 };
    }
    if (cfg.highlight) {
      el.style.outline = "2px solid red";
    }

    let lastTop = -1;
    let sameCount = 0;
    let rounds = 0;

    while (rounds < cfg.maxRounds) {
      // Random scroll distance (human doesn't scroll exactly the same each time)
      const step = rand(Math.floor(cfg.stepPx * 0.6), Math.floor(cfg.stepPx * 1.4));
      el.scrollBy({ top: step, behavior: "smooth" });

      // Random delay between scrolls (reading speed varies)
      await delay(rand(cfg.minDelayMs, cfg.maxDelayMs));

      // Occasionally pause longer — like a human stopping to read a profile
      if (Math.random() < cfg.pauseChance) {
        await delay(rand(cfg.pauseMinMs, cfg.pauseMaxMs));
      }

      const curr = el.scrollTop;
      if (curr === lastTop) {
        sameCount += 1;
        if (sameCount >= cfg.bottomStallLimit) {
          const leadCount = document.querySelectorAll('div[data-x-search-result="LEAD"]').length;
          return { status: "scroll-complete", leadCount };
        }
      } else {
        sameCount = 0;
        lastTop = curr;
      }
      rounds += 1;
    }

    const leadCount = document.querySelectorAll('div[data-x-search-result="LEAD"]').length;
    return { status: "scroll-max-rounds", leadCount };
  }, {
    scrollSelector,
    stepPx,
    minDelayMs,
    maxDelayMs,
    pauseChance,
    pauseMinMs,
    pauseMaxMs,
    highlight,
    maxRounds,
    bottomStallLimit,
  });

  return result;
};

/**
 * Human-like scroll wrapper.
 * Scrolls the full page slowly, then waits for lead count to stabilise.
 */
const humanScrollSalesDashboard = async (page, opts = {}) => {
  const scrollResult = await salesDashBoardScroller(page, {
    trackerSelector: opts.trackerSelector,
    scrollSelector: opts.scrollSelector,
    stepPx: opts.stepPx || 250,
    minDelayMs: opts.minDelayMs || 300,
    maxDelayMs: opts.maxDelayMs || 700,
    pauseChance: opts.pauseChance || 0.15,
    pauseMinMs: opts.pauseMinMs || 800,
    pauseMaxMs: opts.pauseMaxMs || 1500,
    highlight: opts.highlight || false,
    timeoutMs: opts.timeoutMs || 30000,
    maxRounds: opts.maxRounds || 50,
    bottomStallLimit: opts.bottomStallLimit || 3,
  });

  // After scrolling, wait for all lazy-loaded cards to settle in the DOM
  const finalCount = await waitForLeadCountStable(page, {
    timeoutMs: opts.stableTimeoutMs || 5000,
    stableMs: opts.stableMs || 800,
    minCount: 1,
  });

  console.log(`[scroll] ${scrollResult.status} — ${finalCount} leads in DOM after stabilisation`);
  return { ...scrollResult, finalLeadCount: finalCount };
};

module.exports = {
  salesDashBoardScroller,
  humanScrollSalesDashboard,
};
