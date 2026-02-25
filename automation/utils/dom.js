const waitForAnyVisible = async (target, selectors, timeoutMs) => {
  const start = Date.now();
  for (;;) {
    for (const selector of selectors) {
      try {
        const locator = target.locator(selector);
        const count = await locator.count();
        if (count > 0) {
          const first = locator.first();
          if (await first.isVisible()) {
            return first;
          }
        }
      } catch (error) {
        // ignore and keep trying
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for page content to be visible");
    }
    await target.waitForTimeout(150);
  }
};

const waitForSalesNavReady = async (page, timeoutMs = 30000) => {
  await page.waitForLoadState("load", { timeout: timeoutMs });

  const selectors = [
    "main",
    "div.search-results__result-item",
    "section.search-results__result-list",
    "div.search-results__result-list",
    "[data-test-search-results]",
  ];

  await waitForAnyVisible(page, selectors, timeoutMs);
};

/**
 * Wait until the lead card count on the page stabilises.
 * Sales Nav lazy-loads cards as you scroll — this waits for all 25 to appear.
 */
const waitForLeadCountStable = async (page, { timeoutMs = 10000, stableMs = 800, minCount = 1 } = {}) => {
  const start = Date.now();
  let lastCount = 0;
  let stableSince = Date.now();

  for (;;) {
    const count = await page.evaluate(() => {
      return document.querySelectorAll('div[data-x-search-result="LEAD"]').length;
    }).catch(() => 0);

    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    }

    // Stable for long enough and has minimum results
    if (count >= minCount && Date.now() - stableSince >= stableMs) {
      return count;
    }

    if (Date.now() - start > timeoutMs) {
      return lastCount;
    }
    await page.waitForTimeout(200);
  }
};

const getExtensionSelectors = (name) => {
  const lower = name.toLowerCase();
  if (lower === "lusha") {
    return [
      "#LU__extension_badge_main",
      "#LU__extension_badge_wrapper",
      "#LU__extension_badge_logo",
      "[aria-label*='Lusha']",
      "[title*='Lusha']",
      "xpath=//*[contains(@class,'lusha') and (self::div or self::button)]",
      "xpath=//*[contains(., 'Lusha') and (self::div or self::button)]",
      "xpath=//img[contains(@alt,'Lusha')]/ancestor::*[self::div or self::button]",
    ];
  }
  return [];
};

const clickExtensionIcon = async (page, name, timeoutMs = 15000) => {
  const selectors = getExtensionSelectors(name);
  if (!selectors.length) {
    throw new Error(`Unknown extension name: ${name}`);
  }
  const el = await waitForAnyVisible(page, selectors, timeoutMs);
  await el.scrollIntoViewIfNeeded();
  try {
    await el.click();
  } catch (error) {
    await el.click({ force: true });
  }
};

module.exports = {
  waitForAnyVisible,
  waitForSalesNavReady,
  waitForLeadCountStable,
  clickExtensionIcon,
};
