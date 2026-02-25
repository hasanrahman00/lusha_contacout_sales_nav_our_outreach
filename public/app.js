const state = {
  jobs: [],
  inputMode: "single",
  parsedUrls: null,
};

const listName = document.getElementById("listName");
const listUrl = document.getElementById("listUrl");
const listNameError = document.getElementById("listNameError");
const listUrlError = document.getElementById("listUrlError");
const runScraper = document.getElementById("runScraper");
const jobsBody = document.getElementById("jobsBody");
const toast = document.getElementById("toast");
const statTotal = document.getElementById("statTotal");
const statRunning = document.getElementById("statRunning");
const statCompleted = document.getElementById("statCompleted");
const statFailed = document.getElementById("statFailed");
const notifiedFailures = new Set();

// CSV upload elements
const tabSingle = document.getElementById("tabSingle");
const tabCsv = document.getElementById("tabCsv");
const singleUrlField = document.getElementById("singleUrlField");
const csvUploadField = document.getElementById("csvUploadField");
const csvFile = document.getElementById("csvFile");
const uploadArea = document.getElementById("uploadArea");
const fileSelected = document.getElementById("fileSelected");
const fileNameEl = document.getElementById("fileName");
const urlCountEl = document.getElementById("urlCount");
const clearFileBtn = document.getElementById("clearFile");
const csvFileError = document.getElementById("csvFileError");

const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
};

const formatSeconds = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "\u2014";
  }
  return Number(value).toFixed(2);
};

const updateRunDisabled = (loading = false) => {
  const hasName = Boolean(listName.value.trim());
  let hasInput = false;
  if (state.inputMode === "single") {
    hasInput = Boolean(listUrl.value.trim());
  } else {
    hasInput = Array.isArray(state.parsedUrls) && state.parsedUrls.length > 0;
  }
  const disabled = loading || !hasName || !hasInput;
  runScraper.disabled = disabled;
};

const setButtonLoading = (loading) => {
  const spinner = runScraper.querySelector(".spinner");
  const text = runScraper.querySelector(".btn-text");
  spinner.hidden = !loading;
  text.textContent = loading ? "Starting\u2026" : "Run Scraper";
  updateRunDisabled(loading);
};

const clearErrors = () => {
  listNameError.textContent = "";
  listUrlError.textContent = "";
  csvFileError.textContent = "";
  listName.classList.remove("error-border");
  listUrl.classList.remove("error-border");
};

const validateInputs = () => {
  clearErrors();
  let valid = true;
  if (!listName.value.trim()) {
    listNameError.textContent = "List name is required";
    listName.classList.add("error-border");
    valid = false;
  }
  if (state.inputMode === "single" && !listUrl.value.trim()) {
    listUrlError.textContent = "LinkedIn URL is required";
    listUrl.classList.add("error-border");
    valid = false;
  }
  if (state.inputMode === "csv" && (!state.parsedUrls || state.parsedUrls.length === 0)) {
    csvFileError.textContent = "Please upload a CSV file with URLs";
    valid = false;
  }
  return valid;
};

// --- Input Mode Tabs ---

const switchInputMode = (mode) => {
  state.inputMode = mode;
  tabSingle.classList.toggle("active", mode === "single");
  tabCsv.classList.toggle("active", mode === "csv");
  singleUrlField.style.display = mode === "single" ? "" : "none";
  csvUploadField.style.display = mode === "csv" ? "" : "none";
  clearErrors();
  updateRunDisabled(false);
};

tabSingle.addEventListener("click", () => switchInputMode("single"));
tabCsv.addEventListener("click", () => switchInputMode("csv"));

// --- CSV File Parsing ---

const parseCsvFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter((line) => line.trim());
        if (lines.length < 2) {
          reject(new Error("CSV must have a header row and at least one data row"));
          return;
        }
        // Skip header (line 0)
        const urls = [];
        const seen = new Set();
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(",");
          if (parts.length < 2) continue;
          const urlNumber = parseInt(parts[0].trim(), 10);
          const url = parts.slice(1).join(",").trim().replace(/^"|"$/g, "");
          if (url && url.startsWith("http") && !seen.has(url)) {
            seen.add(url);
            urls.push({ urlNumber: isNaN(urlNumber) ? i : urlNumber, url });
          }
        }
        if (urls.length === 0) {
          reject(new Error("No valid URLs found in CSV"));
          return;
        }
        resolve(urls);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
};

const handleFileSelect = async (file) => {
  csvFileError.textContent = "";
  try {
    const urls = await parseCsvFile(file);
    state.parsedUrls = urls;
    fileNameEl.textContent = file.name;
    urlCountEl.textContent = `${urls.length} URLs found`;
    fileSelected.style.display = "";
    uploadArea.style.display = "none";
    updateRunDisabled(false);
  } catch (err) {
    csvFileError.textContent = err.message;
    state.parsedUrls = null;
  }
};

// --- File Upload Handlers ---

uploadArea.addEventListener("click", () => csvFile.click());
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});
uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("dragover"));
uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
  if (e.dataTransfer.files.length > 0) {
    handleFileSelect(e.dataTransfer.files[0]);
  }
});
csvFile.addEventListener("change", (e) => {
  if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
});
clearFileBtn.addEventListener("click", () => {
  state.parsedUrls = null;
  csvFile.value = "";
  fileSelected.style.display = "none";
  uploadArea.style.display = "";
  updateRunDisabled(false);
});

// --- Stats ---

const updateStats = () => {
  const jobs = state.jobs;
  statTotal.textContent = jobs.length;
  statRunning.textContent = jobs.filter((j) => j.status === "Running").length;
  statCompleted.textContent = jobs.filter((j) => j.status === "Completed").length;
  statFailed.textContent = jobs.filter((j) => j.status === "Failed").length;
};

const icons = {
  play: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2.5l7 4.5-7 4.5V2.5z" fill="currentColor"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor"/><rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 7l3 3 3-3M3 12h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 4h9M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4 4v7.5a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const renderJobs = () => {
  jobsBody.innerHTML = "";
  if (state.jobs.length === 0) {
    jobsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                <rect x="8" y="14" width="40" height="28" rx="4" stroke="currentColor" stroke-width="1.5"/>
                <path d="M16 24h24M16 30h16M16 36h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="42" cy="36" r="3" stroke="currentColor" stroke-width="1.5"/>
              </svg>
            </div>
            <p>No jobs yet</p>
            <span>Create a new job above to get started</span>
          </div>
        </td>
      </tr>
    `;
    updateStats();
    return;
  }
  state.jobs.forEach((job) => {
    const badgeClass = job.status.toLowerCase();
    const isRunning = job.status === "Running";
    const toggleIcon = isRunning ? icons.pause : icons.play;
    const toggleLabel = isRunning ? "Pause" : "Run";

    // URL / Page info
    const urlPageInfo =
      job.urls && job.urls.length > 1
        ? `URL ${(job.urlIndex || 0) + 1}/${job.urls.length} \u00B7 Pg ${job.pageIndex || 1}`
        : `Page ${job.pageIndex || 1}`;

    const dupes = job.duplicatesSkipped || 0;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${job.name}</strong></td>
      <td class="mono">${urlPageInfo}</td>
      <td class="right mono">${job.total}</td>
      <td class="right mono" style="opacity:0.6">${dupes}</td>
      <td class="mono">${formatSeconds(job.lushaSeconds)}</td>
      <td class="mono">${formatSeconds(job.contactoutSeconds)}</td>
      <td class="mono">${formatSeconds(job.totalSeconds)}</td>
      <td><span class="badge ${badgeClass}">${job.status}</span></td>
      <td class="actions">
        <button class="btn ghost" data-action="toggle" data-id="${job.id}">
          ${toggleIcon} ${toggleLabel}
        </button>
        <button class="btn secondary" data-action="download" data-id="${job.id}" ${
          job.total === 0 ? "disabled" : ""
        }>
          ${icons.download} Download
        </button>
        <button class="btn danger" data-action="delete" data-id="${job.id}">
          ${icons.trash} Delete
        </button>
      </td>
    `;
    jobsBody.appendChild(row);
    if (job.status === "Failed" && job.error && !notifiedFailures.has(job.id)) {
      showToast(job.error);
      notifiedFailures.add(job.id);
    }
  });
  updateStats();
};

const fetchJobs = async () => {
  try {
    const res = await fetch("/api/jobs");
    state.jobs = await res.json();
    renderJobs();
  } catch (error) {
    // network error, retry next interval
  }
};

const runJob = async () => {
  if (!validateInputs()) {
    return;
  }
  setButtonLoading(true);

  const body = { listName: listName.value };
  if (state.inputMode === "single") {
    body.listUrl = listUrl.value;
  } else {
    body.urls = state.parsedUrls;
  }

  try {
    const res = await fetch("/api/jobs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      listNameError.textContent = data.message || "Failed to start job";
      setButtonLoading(false);
      return;
    }
    listName.value = "";
    listUrl.value = "";
    state.parsedUrls = null;
    csvFile.value = "";
    fileSelected.style.display = "none";
    uploadArea.style.display = "";
    setButtonLoading(false);
    fetchJobs();
  } catch (error) {
    listNameError.textContent = "Network error — check server is running";
    setButtonLoading(false);
  }
};

const handleAction = async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }
  const id = target.dataset.id;
  if (target.dataset.action === "toggle") {
    const job = state.jobs.find((item) => item.id === id);
    if (!job) {
      return;
    }
    if (job.status === "Running") {
      await fetch(`/api/jobs/${id}/stop`, { method: "POST" });
    } else {
      await fetch(`/api/jobs/${id}/run`, { method: "POST" });
    }
    fetchJobs();
    return;
  }
  if (target.dataset.action === "download") {
    window.location.href = `/api/jobs/${id}/download`;
    return;
  }
  if (target.dataset.action === "delete") {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    fetchJobs();
  }
};

runScraper.addEventListener("click", runJob);
jobsBody.addEventListener("click", handleAction);
listName.addEventListener("input", () => updateRunDisabled(false));
listUrl.addEventListener("input", () => updateRunDisabled(false));

setButtonLoading(false);
fetchJobs();
setInterval(fetchJobs, 4000);
