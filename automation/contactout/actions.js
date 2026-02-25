const { waitForAnyVisible } = require("../utils/dom");

const clickContactoutBadge = async (page, options = {}) => {
  const timeoutMs = Number(options.timeoutMs || 4000);

  // 1. Fast script click - check main doc + all frames in one pass
  const frames = page.frames();
  for (const target of [page, ...frames]) {
    try {
      const clicked = await target.evaluate(() => {
        const el = document.querySelector('#floating-button, #app #floating-button, img[alt="contactout"]');
        if (el) {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }
        return false;
      });
      if (clicked) return;
    } catch (error) {
      // cross-origin frame, skip
    }
  }

  // 2. Locator click - try contactout frames first, then others
  const contactoutFrames = frames.filter((f) => {
    const url = f.url() || "";
    const name = f.name() || "";
    return url.includes("contactout") || name.includes("contactout");
  });
  const targets = [...contactoutFrames, page, ...frames.filter((f) => !contactoutFrames.includes(f))];
  for (const target of targets) {
    try {
      const selectors = ["#floating-button", "#app #floating-button", "img[alt='contactout']"];
      const el = await waitForAnyVisible(target, selectors, Math.min(timeoutMs, 500));
      await el.click({ force: true });
      return;
    } catch (error) {
      // continue
    }
  }

  throw new Error("ContactOut badge not found");
};

module.exports = { clickContactoutBadge };
