# DentalPro — Practice Management Software

A full-featured dental practice management desktop app built with Electron + SQLite.

---

## Features

- **Patient Management** — Full patient records with demographics, insurance, allergies, notes
- **Tooth Chart** — Visual dental chart with treatment status indicators
- **Treatment Plans** — Track procedures by tooth, code, status, fee, provider
- **Appointment Scheduling** — Day/calendar view with provider color coding
- **Billing & Insurance** — Track fees, insurance payments, patient payments, balances
- **Dashboard** — Stats overview with today's schedule and recent patients

---

## Setup & Installation

### Requirements
- [Node.js](https://nodejs.org) v18 or later
- npm (comes with Node.js)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Launch the app
npm start
```

That's it! The SQLite database is created automatically on first launch at:
- **Windows:** `%APPDATA%\dental-pro\dental.db`
- **macOS:** `~/Library/Application Support/dental-pro/dental.db`
- **Linux:** `~/.config/dental-pro/dental.db`

### Sample Data
The app comes pre-loaded with:
- 5 sample patients
- 5 today's appointments
- Sample treatment plans
- Sample billing records
- 3 providers (Dr. Smith, Dr. Johnson, Dr. Williams)

---

## Building for Distribution

```bash
# Install electron-builder
npm install --save-dev electron-builder

# Build for your platform
npx electron-builder build
```

---

## Project Structure

```
opendent-electron/
├── Main.js      # Electron main process + SQLite DB + IPC handlers
├── Preload.js   # Secure IPC bridge (contextBridge)
├── Index.html   # App shell + navigation
├── styles.css   # All styles
├── app.js       # UI logic (Dashboard, Patients, Schedule, Billing)
└── package.json
```

---

## Tech Stack
- **Electron** — Cross-platform desktop app
- **better-sqlite3** — Fast, synchronous SQLite database
- **Vanilla JS** — No framework dependencies, lightweight and fast
- **IBM Plex Sans** — Clean, professional typography
