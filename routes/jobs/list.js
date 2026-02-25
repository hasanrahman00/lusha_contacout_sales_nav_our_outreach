const express = require("express");
const { listJobs } = require("../../services/jobStore");

const router = express.Router();

router.get("/", (req, res) => {
  return res.json(listJobs());
});

module.exports = router;
