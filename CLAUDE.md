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
- 03:00: Auto-backup to `data/backups/` (14-day retention, max 14 files)
- 09:00: Telegram daily schedule notification
- 10:00: Telegram inventory alerts — long-term no-order items (≥5 days, sorted oldest first with date) + full stock status by vendor (per-location quantities)
- 11:00: Kakao daily business briefing (`generateAndSendBriefing`)
- 11:30: Kakao staff schedule notification

**Debug:** `GET /api/debug/files` lists files in the data directory — useful for troubleshooting Railway volume mount issues.

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
- `inventory-misc.js` - Orders, history, holidays UI, cost analysis

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

**Inventory Ordering — Three Mechanisms (inventory-check.js):**
1. **Consumption-based** (default): `(dailyUsage × daysUntilNextDelivery) - totalStock`. Applies when no threshold is set.
2. **Threshold-based**: If `totalStock ≤ thresholdQty`, order exactly `minOrderQty`; otherwise 0. Overrides mechanism 1.
3. **Per-location minimum** (`minStockPerLocation`, optional): For each location, if stock < minimum, `Math.ceil(minimum - stock)` is added. Final order = `max(mechanism 1 or 2 result, total location deficit)`. Useful for sauce/broth items where each store needs at least N spare units.

**Weekly Items:** Items with `관리주기: 'weekly'` are normally shown/calculated on Tuesdays only. Two exceptions:
- **Input form**: If the current location hasn't been saved since this week's Tuesday (`getThisWeekTuesday()`), weekly items remain visible on subsequent days until entered.
- **Order calculation**: Weekly items with `dailyUsage > 0` are included in order calculations every day, not just Tuesdays.

**Item Sort Per Location:** Each item has independent `sort1` (1루) and `sort3` (3루) sort indices. The item management tab has three modes: "전체" (all items, no reordering), "1루 순서" (only 1루 items, reorderable), "3루 순서" (only 3루 items, reorderable). Items only appear in location tabs matching their `locations` array.

**Daily Usage in Item Edit:** The item edit modal includes a daily usage field that reads/writes `dailyUsage[vendor_itemName]` and persists to `/api/inventory/daily-usage` on save, so usage can be set from item management without visiting the dedicated usage tab.

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

**Schedule Exceptions:** Staff records include `exceptions[dateStr]` for per-day overrides with `type` (`work`/`off`) and optional `time` fields. Temp workers are stored via `POST /api/staff/temp` and use `isTemp: true`.

**Day-specific Times:** Staff can have a `dayTimes` object (e.g., `{ "월": "09:00-18:00", "화": "10:00-19:00" }`) for per-weekday time variations alongside the default `time` field.

**Item Cost Management:** Items optionally have `unitCost` (number, won per unit) and `costHistory` (array of `{date, unitCost}` entries). When `unitCost` changes in the edit modal, the old value is appended to `costHistory`. Cost data is displayed in the inventory check table (원가 column), order confirmation modal (예상원가), cost analysis tab (💰원가), and telegram/kakao briefings. Items without `unitCost` default to 0 and show "-" in cost columns.

**Graceful Defaults:** `readJson()` returns a default value (empty array/object) when files are missing or unreadable, so the server never crashes on missing data files.

**Dependencies:** Express, CORS, node-cron, axios (used for Kakao/Telegram API calls).

## Language

The codebase, comments, and UI are in Korean. Variable names and API paths use English.
