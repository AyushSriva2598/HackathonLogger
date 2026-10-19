# ⚡ Team Hackathon Logger

> **Centralized hackathon tracker for our team.**  
> Whenever any teammate registers for a hackathon on Devpost, Devfolio, Unstop, MLH, etc., it automatically syncs into our **shared Google Sheet**!

---

## 📦 Teammate Quick-Start Guide (< 30 Seconds)

No Google Apps Script setup or spreadsheet configuration required for teammates! Everything is piped into our master team sheet automatically.

### 1. Download
Click below to download the extension package:

👉 **[⬇️ Download HackathonLogger-extension.zip](HackathonLogger-extension.zip)**

### 2. Install in Google Chrome
1. Extract (unzip) `HackathonLogger-extension.zip`.
2. Open Google Chrome and go to:
   ```text
   chrome://extensions
   ```
3. Turn **ON** the **Developer mode** toggle (top-right corner).
4. Click **Load unpacked** (top-left corner).
5. Select the unzipped **`extension`** folder.
6. Click the puzzle icon (🧩) in Chrome's toolbar and pin **Hackathon Logger** (📌).

> **Done!** Whenever you register for a hackathon, it will automatically log to our team sheet.

---

## 🎯 How It Works For Teammates

### Option A: Automatic Detection (Zero-Click)
Just register for a hackathon on any supported platform:
- **Devpost**
- **Devfolio**
- **Unstop**
- **Hack2skill**
- **DoraHacks**
- **Major League Hacking (MLH)**

When you click Register/Apply and complete the registration, the extension detects it and shows a small toast:  
**`✓ Logged to sheet`**.

### Option B: 1-Click Manual Logging (Toolbar Popup)
If you want to log any hackathon page immediately or verify details before submitting:
1. Click the **Hackathon Logger icon** in Chrome's toolbar.
2. Review the pre-filled fields (Name, Deadlines, Mode, Category).
3. Click **`⚡ Log This Hackathon to Sheet`**.
4. You'll see an instant confirmation: `✓ Success! Added to Google Sheet at Row N.`

---

## 🛡️ Team Deduplication & Safety

- **No Duplicate Rows**: If multiple teammates register for the same hackathon, the extension detects the duplicate via link and title fuzzy matching. It will **not** create duplicate rows.
- **Smart Backfill**: If a teammate has already logged a hackathon, subsequent submissions only backfill empty cells (like missing categories or PPT submission deadlines) without touching any existing notes.
- **Summary Dashboard**: Our sheet's KPI blocks (`TOTAL CONTESTS`, `OPEN APPLICATIONS`, etc.) update and expand automatically.

---

## ⚙️ Team Lead Setup (One-Time Only)

*(Only the owner of the Google Sheet needs to perform these steps once).*

### 1. Deploy the Web App
1. Open our team's Google Sheet (`Hackathon Logger`).
2. Go to **Extensions** → **Apps Script**.
3. Paste the contents of [`apps-script/Code.gs`](apps-script/Code.gs).
4. Set `SHARED_TOKEN` at line 20:
   ```javascript
   var SHARED_TOKEN = 'your_team_secret_token';
   ```
5. Click **Deploy** → **New deployment** → **Web app**:
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
6. Copy your **Web App URL**.

### 2. Pre-Configure for Teammates (Zero-Setup Distribution)
To ensure teammates don't even have to open the Options page:
1. Open [`extension/config.js`](extension/config.js).
2. Set your actual Web App URL and Token as defaults:
   ```javascript
   HackathonLogger.config = {
     APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycb.../exec',
     APPS_SCRIPT_TOKEN: 'your_team_secret_token',
     ...
   };
   ```
3. Re-zip the extension folder:
   ```bash
   zip -r HackathonLogger-extension.zip extension/
   ```
4. Now, any teammate who unzips and loads the extension is **100% connected with zero manual setup**!

---

## 🔒 Privacy & Permissions

- The extension **never reads form inputs or personal information** (like names, resumes, or phone numbers).
- It only reads publicly visible hackathon metadata (event name, submission deadlines, categories, and event links).
- All communication goes directly from the teammate's browser to your team's Google Apps Script Webhook.

---

## 📄 License
MIT License. Built for internal team hackathon tracking.
