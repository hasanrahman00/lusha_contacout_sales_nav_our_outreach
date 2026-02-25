const { waitForAnyVisible } = require("./dom");

const randInt = (min, max) => {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
};

const salesDashBoardScroller = async (page, opts = {}) => {
  const {
    trackerSelector = "a[data-control-name^='view_lead_panel']",
    scrollSelector = null,
    maxSteps = 40,
    stepPx = 200,
    minDelayMs = 200,
    maxDelayMs = 550,
    highlight = false,
    timeoutMs = 15000,
    maxRounds = 20,
    bottomStallLimit = 4,
  } = opts;

  await waitForAnyVisible(page, [trackerSelector], timeoutMs);

  const result = await page.evaluate(async (cfg) => {
    const delay = (ms) => new Promise((res) => setTimeout(res, ms));
    const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
    let el = null;
    if (cfg.scrollSelector) {
      el = document.querySelector(cfg.scrollSelector);
    }
    if (!el) {
      const cands = Array.from(document.querySelectorAll('main, section, div, ul, ol'))
        .filter((n) => n.scrollHeight > n.clientHeight && n.offsetHeight > 300)
        .sort((a, b) => b.clientHeight - a.clientHeight);
      el = cands[0] || null;
    }
    if (!el) {
      return 'no-scroll-container';
    }
    if (cfg.highlight) {
      el.style.outline = '2px solid red';
    }
    let lastTop = -1;
    let same = 0;
    let rounds = 0;
    while (rounds < cfg.maxRounds) {
      for (let i = 0; i < cfg.maxSteps; i++) {
        el.scrollBy({ top: cfg.stepPx, behavior: 'smooth' });
        await delay(rand(cfg.minDelayMs, cfg.maxDelayMs));
        const curr = el.scrollTop;
        if (curr === lastTop) {
          same += 1;
          if (same >= cfg.bottomStallLimit) {
            return 'scroll-complete';
          }
        } else {
          same = 0;
          lastTop = curr;
        }
      }
      rounds += 1;
    }
    return 'scroll-max-rounds';
  }, {
    scrollSelector,
    maxSteps,
    stepPx,
    minDelayMs,
    maxDelayMs,
    highlight,
    maxRounds,
    bottomStallLimit,
  });

  return result;
};

const humanScrollSalesDashboard = async (page, opts = {}) => {
  const steps = randInt(opts.minSteps || 2, opts.maxSteps || 3);
  return salesDashBoardScroller(page, {
    trackerSelector: opts.trackerSelector,
    scrollSelector: opts.scrollSelector,
    maxSteps: steps,
    stepPx: opts.stepPx || 300,
    minDelayMs: opts.minDelayMs || 50,
    maxDelayMs: opts.maxDelayMs || 150,
    highlight: opts.highlight || false,
    timeoutMs: opts.timeoutMs || 15000,
    maxRounds: opts.maxRounds || 5,
    bottomStallLimit: opts.bottomStallLimit || 2,
  });
};

module.exports = {
  salesDashBoardScroller,
  humanScrollSalesDashboard,
};
