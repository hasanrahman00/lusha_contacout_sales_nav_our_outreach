# Sales Nav Scraper v2.0

Automated lead extraction from LinkedIn Sales Navigator with Lusha & ContactOut enrichment.

## What's New in v2

### Data Integrity Fixes
- **Full-page scrolling** — Human-like scroll now traverses the entire results page (250px steps with random pauses) instead of just 600-900px. Waits for lead count to stabilise before extracting, ensuring all 25 leads per page are captured.
- **Duplicate prevention** — Every LinkedIn URL is tracked in a Set. Same profile is never appended to CSV twice, even across pages or URLs.
- **Page-scoped merging** — Lusha and ContactOut data only merges with Sales Nav records from the *same page*, preventing cross-page data mixing.
- **Consistent name cleaning** — All three sources (Sales Nav, Lusha, ContactOut) now use the same `cleanName()` function before matching, eliminating mismatches from prefixes, suffixes, or formatting differences.

### Merge Logic (Updated)
1. **Sales Nav** records are extracted and become the master list
2. **Lusha** merge: match by `firstName` only. No match → skip (don't force-merge wrong data)
3. **ContactOut** merge: match by `firstName` first, fallback to `lastName`. But if Website column is already enriched by Lusha → skip (don't overwrite)

### Multi-URL & Resume
- **CSV upload** properly deduplicates URLs before starting
- **Resilient multi-URL** — if one URL fails (navigation error, pagination issue), the job continues to the next URL instead of dying
- **Resume from exact position** — job stores `lastSuccessfulUrlIndex` and `lastSuccessfulPageIndex`. On resume, it starts from the *next* page after the last successfully completed one
- **Duplicate-safe resume** — on resume, loads all existing LinkedIn URLs from the CSV file to avoid re-appending already-scraped leads

### Scrolling & Timing
- **Slower human-like scrolling** — 300-700ms between scroll steps (was 50-150ms), with 15% chance of a longer 800-1500ms "reading pause"
- **Random scroll distances** — ±40% variation in step size to look natural
- **Lead count stabilisation** — after scrolling, waits up to 5s for the number of `[data-x-search-result="LEAD"]` elements to stop changing
- **Interleaved extraction** — scroll → Lusha open/extract/close → ContactOut open/extract/close → merge → append (sequential, not racing)

### Pagination Recovery
- **Page mismatch no longer kills the job** — logs a warning and continues from whatever page we landed on
- **URL-based fallback** — if button click pagination fails, tries direct URL navigation with `?page=N`
- **Graceful stop** — pagination failures on one URL don't prevent processing remaining URLs

## Setup

```bash
npm install
npm start
```

Open http://localhost:3005

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3005 | Server port |
| `CDP_PORT` | 9223 | Chrome DevTools Protocol port |
| `KEEP_BROWSER_AFTER_JOB` | true | Keep browser open after job completes |
| `MAX_PAGES` | 100 | Max pages to scrape per URL |
| `HUMAN_SCROLL_STEP_PX` | 250 | Scroll step size in pixels |
| `HUMAN_SCROLL_MIN_DELAY_MS` | 300 | Min delay between scroll steps |
| `HUMAN_SCROLL_MAX_DELAY_MS` | 700 | Max delay between scroll steps |
| `HUMAN_SCROLL_PAUSE_CHANCE` | 0.15 | Probability of a longer reading pause |
| `LUSHA_BADGE_TIMEOUT_MS` | 5000 | Timeout for Lusha badge click |
| `CONTACTOUT_TIMEOUT_MS` | 12000 | Timeout for ContactOut extraction |
| `NEXT_PAGE_TIMEOUT_MS` | 12000 | Timeout for page navigation |
