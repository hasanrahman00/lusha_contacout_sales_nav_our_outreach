const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const publicDir = path.join(rootDir, "public");

module.exports = {
  rootDir,
  dataDir,
  publicDir,
};
