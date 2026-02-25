const minimizeContactout = async (page, options = {}) => {
  const timeoutMs = Number(options.timeoutMs || 2000);
  const selectors = [
    'button[data-testid="rollup-button"]',
    "button.header-actions__rollup-button",
  ];

  // 1. Fast evaluate click - check ContactOut frames first, then all frames, then main page
  const frames = page.frames();
  const contactoutFrames = frames.filter((f) => {
    const url = f.url() || "";
    const name = f.name() || "";
    return url.includes("contactout") || name.includes("contactout");
  });
  const targets = [...contactoutFrames, ...frames.filter((f) => !contactoutFrames.includes(f)), page];

  for (const target of targets) {
    try {
      const clicked = await target.evaluate((sels) => {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) {
            el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            return true;
          }
        }
        return false;
      }, selectors);
      if (clicked) return;
    } catch (error) {
      // cross-origin frame, skip
    }
  }

  // 2. Locator fallback
  for (const target of targets) {
    for (const sel of selectors) {
      try {
        const loc = target.locator(sel);
        const count = await loc.count();
        if (count > 0) {
          await loc.first().click({ force: true, timeout: Math.min(timeoutMs, 1000) });
          return;
        }
      } catch (error) {
        // continue
      }
    }
  }

  // Silent failure - minimize is non-critical
  console.log("[contactout] minimize button not found, skipping");
};

module.exports = { minimizeContactout };
