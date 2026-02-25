const { startScraper, stopScraper } = require("./scraper");

const startSession = async (job) => {
  return startScraper(job);
};

const stopSession = async (session) => {
  return stopScraper(session);
};

module.exports = {
  startScraper: startSession,
  stopScraper: stopSession,
};
