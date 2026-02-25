const { waitForAnyVisible, waitForSalesNavReady } = require("./dom");

const getPageInfo = async (page) => {
  return page.evaluate(() => {
    const url = window.location.href;
    let pageNumber = null;
    try {
      const u = new URL(url);
      const p = u.searchParams.get('page');
      if (p) {
        const n = Number(p);
        pageNumber = Number.isFinite(n) ? n : null;
      }
    } catch (e) {
      // ignore
    }
    if (!pageNumber) {
      const active = document.querySelector('[aria-current="true"]')
        || document.querySelector('.artdeco-pagination__indicator--number.active')
        || document.querySelector('li.artdeco-pagination__indicator--number.active');
      if (active) {
        const text = (active.textContent || '').trim();
        const m = text.match(/\d+/);
        if (m) {
          pageNumber = Number(m[0]);
        }
      }
    }
    return { url, pageNumber };
  });
};

const getLeadListKey = async (page) => {
  return page.evaluate(() => {
    const selectors = [
      'a[data-control-name^="view_lead_panel"]',
      'div.search-results__result-item a',
      'li.search-results__result-item a',
      'a[data-test-search-result-link]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.textContent || '').trim();
        const href = el.getAttribute('href') || '';
        if (text || href) {
          return text + '||' + href;
        }
      }
    }
    return null;
  });
};

const clickNextPage = async (page, { timeoutMs = 15000, expectedNext = null } = {}) => {
  await waitForSalesNavReady(page, timeoutMs);
  const nextSelectors = [
    "button[aria-label='Next'].artdeco-pagination__button--next",
    "button.artdeco-pagination__button--next",
    "xpath=//button[@aria-label='Next']",
  ];
  const nextBtn = await waitForAnyVisible(page, nextSelectors, timeoutMs);
  const disabled = await nextBtn.getAttribute("disabled");
  const ariaDisabled = await nextBtn.getAttribute("aria-disabled");
  if (disabled !== null || String(ariaDisabled).toLowerCase() === "true") {
    return { moved: false, reason: "disabled" };
  }
  const before = await getPageInfo(page);
  const beforeLeadKey = await getLeadListKey(page).catch(() => null);
  try {
    await nextBtn.click();
  } catch (error) {
    await nextBtn.click({ force: true });
  }
  try {
    const start = Date.now();
    for (;;) {
      const after = await getPageInfo(page);
      if (after.url !== before.url || after.pageNumber !== before.pageNumber) {
        break;
      }
      if (Date.now() - start > timeoutMs) {
        return { moved: false, reason: "page-change-timeout" };
      }
      await page.waitForTimeout(100);
    }
  } catch (error) {
    return { moved: false, reason: "page-change-timeout" };
  }
  if (beforeLeadKey) {
    try {
      const start = Date.now();
      for (;;) {
        const key = await getLeadListKey(page);
        if (key && key !== beforeLeadKey) {
          break;
        }
        if (Date.now() - start > timeoutMs) {
          return { moved: false, reason: "leadlist-timeout" };
        }
        await page.waitForTimeout(100);
      }
    } catch (error) {
      return { moved: false, reason: "leadlist-timeout" };
    }
  }
  await waitForSalesNavReady(page, timeoutMs);
  const after = await getPageInfo(page);
  if (expectedNext && after.pageNumber && after.pageNumber !== expectedNext) {
    return { moved: false, reason: "page-mismatch", pageNumber: after.pageNumber };
  }
  return { moved: true, pageNumber: after.pageNumber };
};

const clickNextPageWithRetry = async (page, { timeoutMs = 15000, expectedNext = null, maxRetries = 3 } = {}) => {
  let lastResult = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await clickNextPage(page, { timeoutMs, expectedNext });
      if (result.moved) {
        return result;
      }
      // disabled = last page, no retry needed
      if (result.reason === "disabled") {
        return result;
      }
      lastResult = result;
      console.log(`[pagination] attempt ${attempt}/${maxRetries} failed: ${result.reason}`);

      if (attempt < maxRetries) {
        // Scroll pagination into view before retry
        try {
          await page.evaluate(() => {
            const pag = document.querySelector(".artdeco-pagination");
            if (pag) pag.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        } catch (error) {
          // ignore
        }
        const retryDelay = 500 + Math.random() * 500;
        await page.waitForTimeout(retryDelay);

        // On page-mismatch, try navigating via URL param
        if (result.reason === "page-mismatch" && expectedNext) {
          try {
            const currentUrl = page.url();
            const url = new URL(currentUrl);
            url.searchParams.set("page", String(expectedNext));
            console.log(`[pagination] retry via URL navigation to page ${expectedNext}`);
            await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
            await waitForSalesNavReady(page, timeoutMs);
            const info = await getPageInfo(page);
            if (info.pageNumber === expectedNext) {
              return { moved: true, pageNumber: expectedNext };
            }
          } catch (error) {
            console.log(`[pagination] URL navigation retry failed: ${error.message}`);
          }
        }
      }
    } catch (error) {
      lastResult = { moved: false, reason: `error: ${error.message || error}` };
      console.log(`[pagination] attempt ${attempt}/${maxRetries} error: ${error.message || error}`);
      if (attempt < maxRetries) {
        const retryDelay = 500 + Math.random() * 500;
        await page.waitForTimeout(retryDelay);
      }
    }
  }
  return lastResult || { moved: false, reason: "max-retries-exhausted" };
};

module.exports = {
  getPageInfo,
  getLeadListKey,
  clickNextPage,
  clickNextPageWithRetry,
};
