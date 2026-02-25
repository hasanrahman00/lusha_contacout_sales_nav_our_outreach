const express = require("express");
const { startJob } = require("../../services/jobRunner");

const router = express.Router();

router.post("/run", async (req, res) => {
  const listName = String(req.body.listName || "").trim();
  const listUrl = String(req.body.listUrl || "").trim();
  const urls = Array.isArray(req.body.urls) ? req.body.urls : null;

  if (!listName) {
    return res.status(400).json({ message: "List name is required" });
  }

  let inputMode = "single";
  let normalizedUrls = null;

  if (urls && urls.length > 0) {
    inputMode = "csv";
    normalizedUrls = urls
      .map((entry, i) => ({
        urlNumber: Number(entry.urlNumber) || i + 1,
        url: String(entry.url || "").trim(),
      }))
      .filter((entry) => entry.url && entry.url.startsWith("http"));

    // Deduplicate URLs
    const seen = new Set();
    normalizedUrls = normalizedUrls.filter((entry) => {
      if (seen.has(entry.url)) return false;
      seen.add(entry.url);
      return true;
    });

    if (normalizedUrls.length === 0) {
      return res.status(400).json({ message: "No valid URLs found in CSV" });
    }
  } else if (!listUrl) {
    return res.status(400).json({ message: "LinkedIn URL or CSV file is required" });
  }

  try {
    const job = await startJob({ listName, listUrl, urls: normalizedUrls, inputMode });
    return res.status(201).json(job);
  } catch (error) {
    return res.status(500).json({ message: String(error.message || error) });
  }
});

module.exports = router;
