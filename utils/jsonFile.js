const fs = require("fs");

const readJson = (filePath, fallback) => {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw) {
    return fallback;
  }
  return JSON.parse(raw);
};

const writeJson = (filePath, data) => {
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, json, "utf8");
};

const ensureJsonFile = (filePath, defaultValue) => {
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, defaultValue);
  }
};

module.exports = {
  readJson,
  writeJson,
  ensureJsonFile,
};
