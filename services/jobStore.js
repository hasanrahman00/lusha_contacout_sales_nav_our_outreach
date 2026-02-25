const fs = require("fs");
const path = require("path");
const { v4: uuid } = require("uuid");
const jobsFile = path.join(__dirname, "..", "data", "jobs.json");

const jobs = new Map();

function saveJobsToDisk() {
  try {
    const dir = path.dirname(jobsFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const arr = Array.from(jobs.values());
    fs.writeFileSync(jobsFile, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.log(`[jobStore] save warning: ${e.message}`);
  }
}

function loadJobsFromDisk() {
  try {
    if (fs.existsSync(jobsFile)) {
      const arr = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
      arr.forEach((job) => jobs.set(job.id, job));
    }
  } catch (e) {
    // ignore disk errors
  }
}

loadJobsFromDisk();

const createJob = ({ listName, listUrl, urls, inputMode, filePath }) => {
  const id = uuid();
  const name = `${listName} #${id.slice(0, 8)}`;
  const job = {
    id,
    name,
    listName,
    listUrl: listUrl || (urls && urls[0] ? urls[0].url : ""),
    urls: urls || null,
    inputMode: inputMode || "single",
    status: "Running",
    total: 0,
    duplicatesSkipped: 0,
    filePath,
    startedAt: new Date().toISOString(),
    urlIndex: 0,
    pageIndex: 1,
    lastSuccessfulUrlIndex: 0,
    lastSuccessfulPageIndex: 0,
  };
  jobs.set(id, job);
  saveJobsToDisk();
  return job;
};

const updateJob = (id, patch) => {
  const current = jobs.get(id);
  if (!current) {
    return null;
  }
  const next = { ...current, ...patch };
  jobs.set(id, next);
  saveJobsToDisk();
  return next;
};

const getJob = (id) => jobs.get(id);

const listJobs = () => Array.from(jobs.values());

const removeJob = (id) => {
  jobs.delete(id);
  saveJobsToDisk();
};

module.exports = {
  createJob,
  updateJob,
  getJob,
  listJobs,
  removeJob,
};
