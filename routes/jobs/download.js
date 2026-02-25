const express = require("express");
const fs = require("fs");
const { getJob } = require("../../services/jobStore");

const router = express.Router();

router.get("/:id/download", (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.filePath) {
    return res.status(404).json({ message: "File not found" });
  }
  if (!fs.existsSync(job.filePath)) {
    return res.status(404).json({ message: "File not found" });
  }
  return res.download(job.filePath);
});

module.exports = router;
