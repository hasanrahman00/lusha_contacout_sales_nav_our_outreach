const express = require("express");
const { stopJob } = require("../../services/jobRunner");

const router = express.Router();

router.post("/:id/stop", async (req, res) => {
  const job = await stopJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }
  return res.json(job);
});

module.exports = router;
