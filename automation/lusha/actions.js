const { waitForAnyVisible, waitForSalesNavReady, clickExtensionIcon } = require("../utils/dom");

const getLushaFrame = (page) => {
  return page.frames().find((f) => {
    const url = f.url() || "";
    return f.name() === "LU__extension_iframe" || url.includes("lusha");
  }) || null;
};

const clickLushaMinimize = async (page, options = {}) => {
  const timeoutMs = Number(options.timeoutMs || 1500);
  const preferFrame = options.preferFrame !== false;
  const selectors = [
    ".minimize-icon-container img[alt='Minimize']",
    ".minimize-icon-container",
    "xpath=//img[@alt='Minimize']/ancestor::*[self::div or self::button]",
  ];

  const tryFastScriptClick = async () => {
    const lushaFrame = getLushaFrame(page);
    if (!lushaFrame) {
      return false;
    }
    try {
      const clicked = await lushaFrame.evaluate(() => {
        const btn = document.querySelector('.minimize-icon-container img[alt="Minimize"], .minimize-icon-container');
        if (btn) {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }
        return false;
      });
      return clicked;
    } catch (error) {
      return false;
    }
  };

  const tryInFrame = async () => {
    const lushaFrame = getLushaFrame(page);
    if (!lushaFrame) {
      return false;
    }
    try {
      const el = await waitForAnyVisible(lushaFrame, selectors, timeoutMs);
      await el.scrollIntoViewIfNeeded();
      try {
        await el.click();
      } catch (error) {
        await el.click({ force: true });
      }
      return true;
    } catch (error) {
      return false;
    }
  };

  const tryMainDoc = async () => {
    try {
      const el = await waitForAnyVisible(page, selectors, timeoutMs);
      await el.scrollIntoViewIfNeeded();
      try {
        await el.click();
      } catch (error) {
        await el.click({ force: true });
      }
      return true;
    } catch (error) {
      return false;
    }
  };

  if (preferFrame) {
    if (await tryFastScriptClick()) return;
    if (await tryInFrame()) return;
  }

  if (await tryMainDoc()) return;
  if (await tryInFrame()) return;

  throw new Error("Lusha minimize button not found");
};

const clickLushaBadge = async (page, timeoutMs = 15000) => {
  await waitForSalesNavReady(page, timeoutMs);
  await clickExtensionIcon(page, "lusha", timeoutMs);
};

module.exports = {
  clickLushaBadge,
  clickLushaMinimize,
};
