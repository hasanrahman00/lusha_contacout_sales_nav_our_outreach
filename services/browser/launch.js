const { chromium } = require("playwright-core");
const { spawn } = require("child_process");
const http = require("http");
const { CDP_PORT, CDP_URL, CHROME_PATH, USER_DATA_DIR } = require("../../config/browser");

let browser = null;
let chromeProcess = null;

/**
 * Check if Chrome is already listening on the CDP port.
 */
const isChromeRunning = () => {
  return new Promise((resolve) => {
    const req = http.get(`${CDP_URL}/json/version`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const info = JSON.parse(data);
          if (info && info.webSocketDebuggerUrl) {
            resolve(true);
          } else {
            resolve(false);
          }
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
};

/**
 * Launch Chrome with the user data dir and remote debugging port.
 * Returns the child process handle.
 */
const launchChrome = () => {
  console.log(`[browser] launching Chrome...`);
  console.log(`[browser]   path: ${CHROME_PATH}`);
  console.log(`[browser]   profile: ${USER_DATA_DIR}`);
  console.log(`[browser]   CDP port: ${CDP_PORT}`);

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--start-maximized",
  ];

  const child = spawn(CHROME_PATH, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });

  // Don't let Chrome block our Node process from exiting
  child.unref();

  child.on("error", (err) => {
    console.error(`[browser] Chrome launch failed: ${err.message}`);
    console.error(`[browser] Make sure CHROME_PATH is correct: ${CHROME_PATH}`);
  });

  child.on("exit", (code) => {
    console.log(`[browser] Chrome process exited (code: ${code})`);
    chromeProcess = null;
  });

  return child;
};

/**
 * Wait for Chrome's CDP endpoint to become available.
 */
const waitForChromeReady = async (timeoutMs = 30000) => {
  const start = Date.now();
  const pollMs = 500;

  while (Date.now() - start < timeoutMs) {
    const running = await isChromeRunning();
    if (running) {
      console.log(`[browser] Chrome CDP ready on port ${CDP_PORT}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `Chrome did not start within ${timeoutMs / 1000}s. Check CHROME_PATH and USER_DATA_DIR.`
  );
};

/**
 * Ensure Chrome is running with CDP, launching it if needed.
 * Then connect via Playwright CDP.
 *
 * Flow:
 *   1. Is Chrome already on the CDP port? → connect directly
 *   2. Not running? → auto-launch with your profile → wait for CDP ready → connect
 *
 * You never need to open a CMD manually.
 */
const connectBrowser = async () => {
  if (browser && browser.isConnected()) {
    return browser;
  }

  // Step 1: Check if Chrome is already running on the CDP port
  const alreadyRunning = await isChromeRunning();

  if (!alreadyRunning) {
    // Step 2: Auto-launch Chrome with the profile
    chromeProcess = launchChrome();

    // Step 3: Wait for CDP to be ready
    await waitForChromeReady(30000);
  } else {
    console.log(`[browser] Chrome already running on port ${CDP_PORT}`);
  }

  // Step 4: Connect Playwright to Chrome via CDP
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log(`[browser] Playwright connected to Chrome`);
  } catch (error) {
    // Sometimes the first connect attempt fails right after Chrome launches
    console.log(`[browser] first connect attempt failed, retrying in 2s...`);
    await new Promise((r) => setTimeout(r, 2000));
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log(`[browser] Playwright connected to Chrome (retry)`);
  }

  return browser;
};

const getPage = async () => {
  const b = await connectBrowser();
  const contexts = b.contexts();
  const context = contexts.length > 0 ? contexts[0] : await b.newContext();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  return { browser: b, context, page };
};

/**
 * Disconnect Playwright from Chrome.
 * Does NOT kill Chrome — your profile stays open so extensions/cookies persist.
 */
const disconnectBrowser = async () => {
  if (browser) {
    try {
      await browser.close().catch(() => {});
    } catch (error) {
      // ignore disconnect errors
    }
    browser = null;
  }
};

/**
 * Kill the Chrome process entirely (only used on server shutdown if needed).
 */
const killChrome = () => {
  if (chromeProcess) {
    try {
      chromeProcess.kill();
    } catch (error) {
      // ignore
    }
    chromeProcess = null;
  }
};

module.exports = {
  connectBrowser,
  getPage,
  disconnectBrowser,
  killChrome,
  isChromeRunning,
};
