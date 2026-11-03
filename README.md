# Campus Lost & Found Management System

**Campus Lost and Found Management System with Collection Verification and Organiser Tracking Using AWS Cloud**

A responsive web application for managing lost and found items on a college campus, featuring secure collection verification by authorised organisers, audit trails, and cloud-ready architecture.

---

## 🚀 Quick Start — Run Locally (No AWS Needed)

### Prerequisites
- A modern web browser (Chrome, Edge, Firefox)
- A simple HTTP server (see options below)

### Option A: Python HTTP Server (Recommended)
```bash
# Navigate to the project folder
cd "c:\Users\manju's pc\OneDrive\Pictures\Desktop\Project\AWS"

# Start a local server
python -m http.server 8080
```
Then open **http://localhost:8080** in your browser.

### Option B: VS Code Live Server
1. Install the "Live Server" extension in VS Code.
2. Right-click `index.html` → **Open with Live Server**.

### Option C: Node.js
```bash
npx -y serve .
```

> ⚠️ **Important:** Do NOT open `index.html` directly as a file (`file://...`) — image uploads and some features may not work correctly. Use an HTTP server.

---

## 📋 Features

| Feature | Status |
|---------|--------|
| Dashboard with summary stats | ✅ Working |
| Search items by name | ✅ Working |
| Filter by category, status, collection | ✅ Working |
| Report a lost item with photo | ✅ Working |
| Report a found item with photo | ✅ Working |
| Item detail view (modal) | ✅ Working |
| Organiser login | ✅ Working (demo) |
| Collection confirmation | ✅ Working (demo) |
| Collection history / audit trail | ✅ Working |
| Mobile responsive | ✅ Working |
| AWS backend (Lambda functions) | ✅ Created |
| AWS adapter (frontend) | ✅ Created |
| Cognito authentication | ✅ Created |
| AWS deployment guide | ✅ Complete |
| Project report | ✅ Complete |
| Viva questions (20) | ✅ Complete |

---

## 🔐 Demo Credentials

| Field | Value |
|-------|-------|
| Username | `admin@campus.edu` |
| Password | `demo123` |

---

## 📂 Project Structure

```
AWS/
├── index.html              # Main HTML page (single-page app)
├── README.md               # This file
├── .gitignore              # Files to exclude from Git
├── css/
│   ├── styles.css          # Core design system & tokens
│   ├── components.css      # Component-specific styles
│   └── responsive.css      # Mobile & tablet breakpoints
├── js/
│   ├── config.js           # App configuration & mode detection
│   ├── data-adapter.js     # Data layer abstraction (Local / AWS)
│   ├── aws-adapter.js      # AWS API adapter (calls API Gateway)
│   ├── demo-data.js        # Sample data for demo mode
│   ├── auth.js             # Authentication (demo + Cognito)
│   ├── app.js              # Main application controller
│   ├── env.example.js      # Template for AWS config
│   └── env.js              # Your AWS config (git-ignored)
├── lambda/
│   ├── get_items/          # GET /items — list & filter items
│   ├── get_item/           # GET /items/{id} — single item
│   ├── create_item/        # POST /items — new lost/found report
│   ├── confirm_collection/ # POST /items/{id}/collect — verify handover
│   ├── get_collection_history/  # GET /collection-history
│   ├── get_upload_url/     # POST /upload-url — S3 pre-signed upload
│   └── get_image_url/      # GET /images/{key} — S3 pre-signed download
├── docs/
│   ├── AWS_DEPLOYMENT_GUIDE.md  # Step-by-step AWS setup
│   ├── PROJECT_REPORT.md        # Full project report
│   ├── VIVA_QUESTIONS.md        # 20 viva Q&A
│   └── TESTING_CHECKLIST.md     # Complete testing checklist
```

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────┐
│              Browser (Frontend)             │
│  HTML + CSS + JavaScript                    │
│  ┌─────────────────────────────────────┐    │
│  │  App Controller (app.js)            │    │
│  │  ├── Navigation & Page Routing      │    │
│  │  ├── Dashboard & Stats Rendering    │    │
│  │  ├── Search & Filters               │    │
│  │  ├── Report Forms                   │    │
│  │  ├── Item Detail Modal              │    │
│  │  └── Collection Confirmation        │    │
│  └─────────────┬───────────────────────┘    │
│                │                            │
│  ┌─────────────▼───────────────────────┐    │
│  │  Data Adapter (data-adapter.js)     │    │
│  │  Switches between:                  │    │
│  │  • LocalAdapter (demo mode)         │    │
│  │  • AwsAdapter (AWS mode - Phase 3)  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Auth Module (auth.js)              │    │
│  │  • Demo login (local mode)          │    │
│  │  • Cognito auth (AWS mode - Ph 4)   │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

---

## 🔄 Development Modes

### LOCAL DEMO MODE (current)
- All data stored in browser memory
- Resets when you refresh the page
- 10 pre-loaded sample items
- Simulated organiser login
- Clearly labelled as "DEMO"

### AWS MODE (Phases 3-5)
- Real DynamoDB persistence
- S3 image storage with pre-signed URLs
- Cognito authentication
- API Gateway + Lambda backend
- Activated by creating `js/env.js`

---

## 🧪 Testing Checklist (Local Demo)

- [ ] Open dashboard — see 10 sample items and stat cards
- [ ] Search for "charger" — see filtered results
- [ ] Filter by category "Electronics" — see matching items
- [ ] Filter by collection status "Collected" — see 2 collected items
- [ ] Click an item card — see detail modal with badges and info
- [ ] Go to "Report Lost" — fill form and submit → new item appears
- [ ] Go to "Report Found" — fill form with photo → see preview
- [ ] Go to "History" — see 2 demo collection records
- [ ] Click "Organiser" → see login page
- [ ] Login with `admin@campus.edu` / `demo123`
- [ ] See organiser panel with pending items
- [ ] Click a pending item → see collection form at bottom
- [ ] Enter claimant name and confirm → item becomes "Collected"
- [ ] Check History page → see new collection record
- [ ] Try collecting an already-collected item → see error
- [ ] Sign out → organiser features hidden
- [ ] Resize browser to mobile → check responsive layout

---

## ⚠️ What is Simulated vs Real

| Aspect | Local Demo | AWS Mode |
|--------|-----------|----------|
| Data storage | Browser memory | DynamoDB |
| Image storage | Data URL in memory | S3 with pre-signed URLs |
| Authentication | Hardcoded demo creds | Cognito JWT |
| API calls | In-memory functions | API Gateway + Lambda |
| Collection audit | In-memory array | DynamoDB append-only |
| Persistence | Resets on refresh | Permanent |

---

## 🔌 Switching to AWS Mode

1. Copy `js/env.example.js` to `js/env.js`
2. Fill in your AWS resource identifiers (see `docs/AWS_DEPLOYMENT_GUIDE.md`)
3. Add `<script src="js/env.js"></script>` in `index.html` before config.js
4. The app automatically detects AWS config and switches mode
5. Console will show: `[Config] AWS mode activated`

## 📖 Progress

- [x] **Phase 1:** Frontend & local demo mode
- [x] **Phase 2:** Testing, bug fixes, found-item suggestions
- [x] **Phase 3:** AWS backend (Lambda, API Gateway, DynamoDB schema, AWS adapter)
- [x] **Phase 4:** Cognito authentication (integrated in auth.js)
- [x] **Phase 5:** S3 pre-signed uploads/downloads, CloudWatch logging
- [x] **Phase 6:** Deployment guide, project report, viva questions, testing checklist

## 📚 Documentation

| Document | Location |
|----------|----------|
| AWS Deployment Guide | `docs/AWS_DEPLOYMENT_GUIDE.md` |
| Project Report | `docs/PROJECT_REPORT.md` |
| Viva Questions (20) | `docs/VIVA_QUESTIONS.md` |
| Testing Checklist | `docs/TESTING_CHECKLIST.md` |

---

## 📄 License

This is a college project for educational purposes.
