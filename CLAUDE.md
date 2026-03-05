# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

통빱 매장 관리 시스템 (Tongbob Store Management System) - A Korean restaurant/store management application for staff scheduling, accounting, and inventory management. Deployed on Railway.

## Commands

```bash
# Start the server (runs on port 3000 by default)
npm start

# Install dependencies
npm install
```

No test suite exists in this project.

## Architecture

### Backend (server.js)
Single Express.js file handling all API routes. Uses file-based JSON storage (no database).

**Data Storage:**
- Local development: `./data/` directory
- Railway deployment: Uses `RAILWAY_VOLUME_MOUNT_PATH` environment variable

**Environment Variables (see .env.example):**
- `KAKAO_REST_API_KEY` - Kakao OAuth API key
- `KAKAO_REDIRECT_URI` - OAuth callback URL
- `ADMIN_PASSWORD`, `MANAGER_PASSWORD`, `STAFF_PASSWORD` - Login credentials (defaults provided)
- `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` - Telegram bot notifications (optional; silently skipped if absent)

**API Groups:**
1. **Auth** (`/api/login`) - Password-based login returning role: `admin`, `manager`, or `viewer`
2. **Staff Management** (`/api/staff/*`) - Employee CRUD, schedule exceptions, temp workers; soft delete with 30-day retention before permanent removal
3. **Accounting** (`/api/accounting/*`) - Daily sales entry, monthly fixed costs
4. **Inventory** (`/api/inventory/*`) - Items by vendor, current stock, daily usage, orders, holidays, history
5. **Logs & Backup** (`/api/logs`, `/api/backup/*`) - Activity log (max 1000 entries); backup endpoints: `/api/backup/all` (download snapshot), `/api/backup/list` (list dated backups), `/api/backup/download/:date` (restore specific date)
6. **Kakao Integration** (`/oauth/kakao`, `/api/kakao/*`) - OAuth login and KakaoTalk notification sending
7. **Staff Restore** (`POST /api/staff/:id/restore`) - Restore soft-deleted staff before 30-day permanent deletion window

**Scheduled Tasks (node-cron, all KST):**
- 03:00: Auto-backup to `data/backups/` (30-day retention, max 30 files)
- 09:00: Telegram daily schedule notification
- 11:00: Kakao daily business briefing (`generateAndSendBriefing`)
- 11:30: Kakao staff schedule notification

### Frontend (public/)
Single-page application with vanilla JavaScript. No build process. Scripts are loaded in order in `index.html` and share global state through module-level variables.

**Staff module** (loaded in order):
- `staff.js` - Global variables, DOMContentLoaded init, tab switching
- `staff-auth.js` - Login modal, role-based access
- `staff-employee.js` - Employee CRUD UI
- `staff-accounting.js` - Accounting/sales UI
- `staff-schedule.js` - Schedule calendar UI

**Inventory module** (loaded in order):
- `inventory.js` - Global variables, init, tab switching
- `inventory-input.js` - Stock input UI
- `inventory-check.js` - Stock check/verification UI
- `inventory-items.js` - Item management UI
- `inventory-misc.js` - Orders, history, holidays UI

All API calls use `fetch()` directly.

### Data Files (data/)
All JSON files are auto-initialized if missing:
- `staff.json` - Employee records with schedule exceptions
- `accounting.json` - Monthly/daily financial data `{ monthly: {}, daily: {} }`
- `items.json` - Inventory items grouped by vendor (고센유통, 한강유통(고기), 인터넷발주)
- `inventory.json` - Current stock levels
- `daily_usage.json` - Daily usage records
- `orders.json` - Order history
- `last_orders.json` - Most recent order date per item, keyed as `{vendor}_{itemName}`
- `inventory_history.json` - Stock change history (max 100 entries)
- `holidays.json` - Store and vendor holiday schedules
- `logs.json` - Activity log (max 1000 entries)
- `kakao_token.json` - Kakao OAuth tokens

## Key Patterns

**Soft Delete:** Staff deletion sets `deleted: true` with `deletedAt` timestamp. Permanent deletion allowed after 30 days.

**Inventory Keys:** Items use composite keys like `{location}_{vendor}_{itemName}` (e.g., `1루_고센유통_양파`) in `inventory.json`. Last order keys omit location: `{vendor}_{itemName}`.

**Staff Salary Calculation:** Supports both monthly (`salaryType: 'monthly'`) and hourly (`salaryType: 'hourly'`) with prorated calculations based on `startDate`/`endDate`. Salary fields are stripped from API responses for non-admin roles.

**Role Access:** `admin` → full access including salary data; `manager` → most features; `viewer` (staff) → read-only schedule view.

**Schedule startDate/endDate Filtering:** All three schedule views (daily/weekly/monthly) must filter out staff whose `startDate` > target date or `endDate` < target date. The pattern used in weekly/monthly views is:
```js
const dateObj = new Date(dateStr); dateObj.setHours(0,0,0,0);
if (s.startDate) { const d = new Date(s.startDate); d.setHours(0,0,0,0); if (dateObj < d) return; }
if (s.endDate)   { const d = new Date(s.endDate);   d.setHours(0,0,0,0); if (dateObj > d) return; }
```
`renderDailyView()` in `staff-schedule.js` previously lacked this check — if adding new schedule views, always include it.

**Salary Report (`calculateMonthlySalary`):** Staff with 0 employed days this month (fully outside date range) are excluded from the report entirely.

**Schedule History:** Staff records include a `scheduleHistory` array of `{ from, workDays, time, dayTimes }` entries for tracking schedule changes over time. Always use `getScheduleForDate(staff, dateStr)` (server-side) to resolve the correct schedule for a given date — it picks the latest entry with `from <= dateStr`. When modifying a staff member's schedule, append to `scheduleHistory` rather than overwriting top-level fields.

**Accounting Daily Fields:** Daily entries under `accounting.json` include: `sales`, `meat`, `food`, `etc`, `card`, `delivery`. Card and delivery amounts are used to auto-calculate fees in the monthly briefing.

## Language

The codebase, comments, and UI are in Korean. Variable names and API paths use English.
