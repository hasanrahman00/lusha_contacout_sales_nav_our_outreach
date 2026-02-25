const express = require("express");
const { resumeJob } = require("../../services/jobRunner");

const router = express.Router();

router.post("/:id/run", async (req, res) => {
  const job = await resumeJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }
  return res.json(job);
});

module.exports = router;
