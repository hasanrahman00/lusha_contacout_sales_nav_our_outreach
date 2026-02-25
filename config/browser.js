const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const CDP_URL = process.env.CDP_URL || `http://127.0.0.1:${CDP_PORT}`;
const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR =
  process.env.USER_DATA_DIR || "C:\\Chrome_Prospeo_Clone";

module.exports = {
  CDP_PORT,
  CDP_URL,
  CHROME_PATH,
  USER_DATA_DIR,
};
