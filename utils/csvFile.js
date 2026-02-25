const fs = require("fs");
const path = require("path");

const ensureParentDir = (filePath) => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
};

const ensureCsvHeader = (filePath, header) => {
  ensureParentDir(filePath);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${header}\n`, "utf8");
  }
};

const appendCsvRow = (filePath, row) => {
  ensureParentDir(filePath);
  fs.appendFileSync(filePath, `${row}\n`, "utf8");
};

/**
 * Load all LinkedIn URLs already written to the CSV file.
 * Returns a Set of lowercase LinkedIn URLs for O(1) dedup lookups.
 * The linkedInUrl is expected at column index `colIndex` (0-based).
 */
const loadExistingLinkedInUrls = (filePath, colIndex = 8) => {
  const urls = new Set();
  if (!fs.existsSync(filePath)) {
    return urls;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    // Skip header (line 0), process data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // Simple CSV parse — handles quoted fields
      const cols = parseCsvLine(line);
      const url = (cols[colIndex] || "").trim().toLowerCase();
      if (url) {
        urls.add(url);
      }
    }
  } catch (error) {
    // If file is corrupted, start fresh
    console.log(`[csv] warning: could not load existing URLs: ${error.message}`);
  }
  return urls;
};

/**
 * Minimal CSV line parser that handles quoted fields with commas.
 */
const parseCsvLine = (line) => {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
};

module.exports = {
  ensureCsvHeader,
  appendCsvRow,
  loadExistingLinkedInUrls,
};
