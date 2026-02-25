const express = require("express");
const { getJob, removeJob } = require("../../services/jobStore");
const { stopJob, deleteJobFile } = require("../../services/jobRunner");

const router = express.Router();

router.delete("/:id", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }
  await stopJob(job.id);
  deleteJobFile(job);
  removeJob(job.id);
  return res.json({ message: "Job deleted" });
});

module.exports = router;
