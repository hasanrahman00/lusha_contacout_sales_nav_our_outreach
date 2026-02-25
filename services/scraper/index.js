const { getPage, disconnectBrowser } = require("../browser/launch");
const { waitForSalesNavReady } = require("../../automation/utils/dom");

const startScraper = async (job) => {
  const { browser, context, page } = await getPage();
  if (job?.listUrl) {
    await page.goto(job.listUrl, { waitUntil: "domcontentloaded" });
    await waitForSalesNavReady(page).catch(() => null);
  }
  return { page, browser, context, job };
};

const stopScraper = async (session) => {
  if (!session) {
    return;
  }
  await disconnectBrowser();
};

module.exports = {
  startScraper,
  stopScraper,
};
