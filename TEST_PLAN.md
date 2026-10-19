# Hackathon Logger - Quality Assurance & Test Plan 🧪

This document provides a comprehensive end-to-end testing protocol for the **Hackathon Logger** Chrome Extension and Google Apps Script backend. It details test environment configuration, manual and automated verification scenarios, resilient selector tracking, and a verification checklist.

---

## 1. Test Environment Setup

### 1.1 Google Sheet Configuration
1. Create a new Google Sheet named **`Hackathon Logger`**.
2. Set up the sheet with the following standard layout:
   - **Row 1**: Title / Banner (`HACKATHON TRACKER DASHBOARD`)
   - **Row 2**: Labels:
     - `A2`: `TOTAL CONTESTS`
     - `B2`: `OPEN APPLICATIONS`
     - `C2`: `UPCOMING SUBMISSIONS`
   - **Row 3**: Formulas:
     - `A3`: `=COUNTA(A6:A)`
     - `B3`: `=COUNTIF(E6:E, "Open")`
     - `C3`: `=COUNTIF(D6:D, ">="&TODAY())`
   - **Row 4**: Blank row separator.
   - **Row 5 (Header Row)**:
     - `A5`: `Hackathon Name`
     - `B5`: `Category`
     - `C5`: `Application Deadline`
     - `D5`: `PPT Submission Deadline`
     - `E5`: `Status`
     - `F5`: `Platform / Format`
     - `G5`: `Event Link`
   - **Row 6 (Seed Data Row)**: Add one sample row with formatting (borders, background color, font family, and date number formats) to serve as a baseline formatting template.
     - `A6`: `Sample Hackathon 2026`
     - `B6`: `AI / Web3`
     - `C6`: `2026-12-31`
     - `D6`: `2026-12-20`
     - `E6`: `=IF(C6="","",IF(C6<TODAY(),"Closed","Open"))` *(or literal `Open`)*
     - `F6`: `Devpost (Online)`
     - `G6`: `https://sample2026.devpost.com`

### 1.2 Google Apps Script Deployment
1. Open the Google Sheet, go to **Extensions** → **Apps Script**.
2. Paste the contents of [`apps-script/Code.gs`](file:///home/ayush/Desktop/HackathonLogger/apps-script/Code.gs).
3. Set `var SHARED_TOKEN = 'test_secret_token_xyz_789';`.
4. Click **Deploy** → **New deployment** → **Web app**.
5. Set **Execute as**: `Me`, **Who has access**: `Anyone`.
6. Deploy and copy the Web App URL (`WEBHOOK_URL`).

### 1.3 Chrome Extension Installation
1. Navigate to `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the [`extension`](file:///home/ayush/Desktop/HackathonLogger/extension) folder.
4. Right-click the extension icon in the Chrome toolbar, click **Options**, and fill in:
   - **Webhook URL**: `WEBHOOK_URL`
   - **Shared Token**: `test_secret_token_xyz_789`
5. Click **Save** and verify the success prompt.

---

## 2. Test Scenarios

### Scenario A: New Registration on Devpost
- **Target Platform**: Devpost (e.g. `https://amazonappdev2026.devpost.com`)
- **Action**:
  1. Open Devpost hackathon event page in Chrome.
  2. Inspect the page to confirm JSON-LD / schema metadata is present.
  3. Click the **Register for this hackathon** button.
  4. Complete the registration or submit confirmation modal.
- **Expected Results**:
  1. Extension displays a subtle confirmation toast: *"Hackathon registered and logged!"*.
  2. A new row is appended to the Google Sheet directly after the last data row.
  3. Verify logged row fields:
     - **Hackathon Name**: Matches page header / `og:title`.
     - **Category**: Matches theme/tags (e.g. `Developer Tools`, `Cloud`).
     - **Application Deadline**: Parsed date in `YYYY-MM-DD` or native Date format.
     - **PPT Submission Deadline**: Round 1 deadline if present, or blank.
     - **Status**: `Open` (or formula calculated).
     - **Platform / Format**: `Devpost (Online)` or `Devpost (In-Person)`.
     - **Event Link**: Normalized link (e.g. `https://amazonappdev2026.devpost.com`).

---

### Scenario B: New Registration on Devfolio
- **Target Platform**: Devfolio (e.g. `https://ethindia2026.devfolio.co`)
- **Action**:
  1. Open Devfolio hackathon page.
  2. Click the **Apply with Devfolio** / **Apply Now** button.
  3. Confirm application submission in modal.
- **Expected Results**:
  1. Extension extracts data directly from `window.__NEXT_DATA__`.
  2. Google Sheet receives a new row with accurate start/end dates.
  3. Category correctly reflects Devfolio tracks or general category.
  4. Platform is recorded as `Devfolio (Online)` or `Devfolio (In-Person)`.

---

### Scenario C: New Registration on Unstop
- **Target Platform**: Unstop (e.g. `https://unstop.com/hackathons/sample-hackathon`)
- **Action**:
  1. Open Unstop hackathon details page.
  2. Click the **Register** button.
  3. Progress through the team/individual registration prompt.
- **Expected Results**:
  1. MutationObserver or click handler intercepts the registration action.
  2. Sheet adds a new entry with exact deadline date from Unstop countdown timer or details panel.
  3. Platform recorded as `Unstop`.

---

### Scenario D: Duplicate Detection (Exact & Normalized Link)
- **Action**:
  1. Re-navigate to the Devpost hackathon registered in Scenario A.
  2. Click the register/status button again, or manually trigger the logger for the same URL with variations (e.g. `https://amazonappdev2026.devpost.com/?ref=share#overview`).
- **Expected Results**:
  1. The Webhook normalizes the link (stripping protocol, trailing slash, and query parameters) and detects existing entry.
  2. **No new row is inserted** in the Google Sheet.
  3. Backend returns `{ status: 'duplicate', row: N }`.
  4. Extension toast notifies: *"Hackathon is already logged"*.

---

### Scenario E: Update Blank Cells in Existing Row
- **Action**:
  1. In the Google Sheet, locate an existing hackathon row.
  2. Manually delete the value in the **Category** column (making it completely blank).
  3. Re-trigger registration for that hackathon from the browser.
- **Expected Results**:
  1. Backend identifies the duplicate row by link or fuzzy name.
  2. The empty **Category** cell is automatically backfilled with scraped category data.
  3. All other existing cells remain untouched.
  4. Backend returns `{ status: 'updated', row: N }`.
  5. Extension toast confirms: *"Existing hackathon details updated!"*.

---

### Scenario F: Past Deadline Status Evaluation
- **Action**:
  1. Navigate to an archived or past hackathon page whose application deadline is prior to today's date.
  2. Trigger registration capture.
- **Expected Results**:
  1. If the sheet uses a literal status column, `isPastDeadline` evaluates to `true` and writes `Status = Closed`.
  2. If the sheet uses a formula (e.g. `=IF(C6<TODAY(),"Closed","Open")`), the relative formula is copied down and evaluates to `Closed`.
  3. **OPEN APPLICATIONS** count in summary block does NOT increment.

---

### Scenario G: Summary Block Formula Integrity
- **Action**:
  1. Note initial counts in the summary dashboard:
     - `TOTAL CONTESTS` = $N$
     - `OPEN APPLICATIONS` = $K$
  2. Log a new open hackathon via the extension.
- **Expected Results**:
  1. A row is inserted below the existing rows without disturbing formulas in Rows 1–3.
  2. Google Sheet formulas dynamically update:
     - `TOTAL CONTESTS` updates to $N + 1$.
     - `OPEN APPLICATIONS` updates to $K + 1$.
  3. No formula errors (`#REF!`, `#VALUE!`) occur in the summary block.

---

### Scenario H: Offline Buffering & Automatic Retry
- **Action**:
  1. Open DevTools in Chrome (`F12`), go to the **Network** tab, and toggle **Offline**.
  2. Visit a hackathon page and click **Register**.
  3. Reconnect network by selecting **No throttling (Online)** in DevTools.
- **Expected Results**:
  1. When offline, extension catches the network error and queues the payload into `chrome.storage.local`.
  2. Toast informs user: *"Offline: Registration queued for sync"*.
  3. When back online, `background.js` detects network recovery (`navigator.onLine` / `chrome.alarms` retry loop), sends the queued item, and clears the queue.
  4. Row appears in the Google Sheet upon reconnection.

---

### Scenario I: Single Page Application (SPA) Client-Side Navigation
- **Action**:
  1. On Devfolio or Unstop, navigate from one hackathon page directly to another hackathon page using client-side navigation (without a full page reload).
  2. Click **Apply** on the second hackathon.
- **Expected Results**:
  1. The content script listens to `popstate` / `history.pushState` or DOM changes.
  2. The scraped metadata corresponds to the **second** hackathon, not the stale data from the first hackathon.
  3. Correct second hackathon row is appended to the Google Sheet.

---

## 3. Fragile Selectors Table

Web platform frontends evolve frequently. This table catalogues all selector touchpoints, their risk levels, and maintenance procedures:

| Platform | Selector / Pattern | Purpose | Risk Level | How to Fix / Resilient Alternative |
| :--- | :--- | :--- | :---: | :--- |
| **Devpost** | `a#register-to-participate`, `a[href*="/register"]` | Register button click detection | **HIGH** | Inspect button on Devpost; update selector in `extension/adapters/devpost.js`. Alternatively, listen to URL change to `/register`. |
| **Devpost** | `script[type="application/ld+json"]` | Scraping name, description, deadlines | **LOW** | Standard schema.org JSON; if missing, fallback to `meta[property="og:title"]` and `.deadline-time`. |
| **Devfolio** | `button[id*="apply-button"]`, `button:has-text("Apply")` | Apply button trigger | **HIGH** | Use text content match (`Array.from(document.querySelectorAll('button')).find(b => /apply/i.test(b.textContent))`). |
| **Devfolio** | `script#__NEXT_DATA__` | Event dates, tracks, submission rounds | **LOW** | Hydration JSON payload structure; verify path `props.pageProps.hackathon` in `extension/adapters/devfolio.js`. |
| **Unstop** | `button.register-btn`, `button:contains("Register")` | Multi-step register trigger | **HIGH** | Inspect Unstop registration CTA; update selector in `extension/adapters/unstop.js`. |
| **Unstop** | `div.dates-details, span.deadline` | Application deadline text | **HIGH** | DOM class obfuscation; extract deadline from `__INITIAL_STATE__` or script tags if classes change. |
| **Devpost API** | `POST https://*.devpost.com/participants` | Network request interception | **MEDIUM** | Platform API endpoints change versioning; update `webRequest` filter in `background.js`. |
| **Devfolio API**| `POST https://api.devfolio.co/api/hackathons/*/apply` | Network confirmation intercept | **MEDIUM** | Check Network tab in DevTools for latest GraphQL/REST endpoint; update matching regex in adapter. |
| **All Platforms**| Toast / Success modal: `"You're registered!"` | Registration success verification | **LOW** | Monitor DOM mutation for confirmation text containing `/registered|applied|success/i`. |

### Maintenance Workflow when Platform Selectors Change:
1. Open Chrome DevTools (`F12`) on the broken platform.
2. Inspect the changed button, modal, or metadata element.
3. Open the corresponding adapter file in [`extension/adapters/`](file:///home/ayush/Desktop/HackathonLogger/extension/adapters/).
4. Update the selector string or fallback extraction chain.
5. Go to `chrome://extensions` and click the **Reload** (🔄) icon on Hackathon Logger.

---

## 4. Manual Verification Checklist

Use this checklist before releasing or deploying new updates:

- [ ] **Apps Script Deployment**:
  - [ ] Web app deployed with access set to *Anyone*.
  - [ ] `SHARED_TOKEN` configured and matches extension options.
  - [ ] GET request to Web App URL returns `{ status: "ok" }`.
- [ ] **Google Sheet Structure**:
  - [ ] KPI block present in rows 1–3 with active formulas.
  - [ ] Header row present with `Hackathon Name` and `Event Link`.
  - [ ] Seed data row formatted with borders, colors, and date formats.
- [ ] **Extension Configuration**:
  - [ ] Unpacked extension loads in Chrome without console warnings.
  - [ ] Options page persists Webhook URL and Token to `chrome.storage.sync`.
  - [ ] Bad token returns `Unauthorized` error toast.
- [ ] **Platform Registration Flow**:
  - [ ] Devpost: Registration click logs new row with name, deadline, and platform.
  - [ ] Devfolio: Next.js metadata extracts clean deadlines and tags.
  - [ ] Unstop: Multi-step registration records accurate dates.
- [ ] **Data Integrity & Deduplication**:
  - [ ] Duplicate event registration returns `status: duplicate` without inserting extra row.
  - [ ] Clearing one cell (e.g. Category) and re-logging updates the empty cell only (`status: updated`).
  - [ ] Row formatting matches previous row seamlessly.
  - [ ] Formula columns (e.g. dynamic Status) copy down with correct relative references.
  - [ ] Summary counts (`TOTAL CONTESTS`, `OPEN APPLICATIONS`) increment appropriately.
- [ ] **Resilience & Edge Cases**:
  - [ ] Offline registrations buffer in queue and dispatch automatically when back online.
  - [ ] Client-side SPA navigation scrapes updated event data rather than previous page cache.
  - [ ] Non-ASCII or special characters in hackathon titles are encoded and logged cleanly.
