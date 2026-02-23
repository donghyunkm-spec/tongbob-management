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

## Architecture

### Backend (server.js)
Single Express.js server handling all API routes. Uses file-based JSON storage (no database).

**Data Storage:**
- Local development: `./data/` directory
- Railway deployment: Uses `RAILWAY_VOLUME_MOUNT_PATH` environment variable

**Environment Variables (see .env.example):**
- `KAKAO_REST_API_KEY` - Kakao OAuth API key
- `KAKAO_REDIRECT_URI` - OAuth callback URL
- `ADMIN_PASSWORD`, `MANAGER_PASSWORD`, `STAFF_PASSWORD` - Login credentials (defaults provided)

**API Modules:**
1. **Staff Management** (`/api/staff/*`) - Employee CRUD, schedule exceptions, temp workers, soft delete with 30-day retention
2. **Accounting** (`/api/accounting/*`) - Daily sales entry, monthly fixed costs
3. **Inventory** (`/api/inventory/*`) - Items by vendor, current stock, daily usage, orders, holidays
4. **Kakao Integration** (`/oauth/kakao`, `/api/kakao/*`) - OAuth login and notification sending via KakaoTalk

**Scheduled Tasks (node-cron):**
- 11:00 KST: Daily business briefing
- 11:30 KST: Staff schedule notification

### Frontend (public/)
Single-page application with vanilla JavaScript. No build process required.

- `index.html` - Main HTML with embedded styles
- `staff.js` - Staff management and accounting UI logic
- `inventory.js` - Inventory management UI logic
- `style.css` - Additional styles
- `kakao-auth.html` - Kakao OAuth callback page

### Data Files (data/)
All JSON files are auto-initialized if missing:
- `staff.json` - Employee records with schedule exceptions
- `accounting.json` - Monthly/daily financial data
- `items.json` - Inventory items grouped by vendor (고센유통, 한강유통(고기), 인터넷발주)
- `inventory.json` - Current stock levels
- `orders.json` - Order history
- `inventory_history.json` - Stock change history (max 100 entries)

## Key Patterns

**Soft Delete:** Staff deletion sets `deleted: true` with `deletedAt` timestamp. Permanent deletion allowed after 30 days.

**Inventory Keys:** Items use composite keys like `{location}_{vendor}_{itemName}` (e.g., `1루_고센유통_양파`)

**Staff Salary Calculation:** Supports both monthly (`salaryType: 'monthly'`) and hourly (`salaryType: 'hourly'`) with prorated calculations based on `startDate`/`endDate`.

**Login Roles:** Three roles with passwords configured via environment variables (admin, manager, viewer). See `.env.example` for defaults.

## Language

The codebase, comments, and UI are in Korean. Variable names and API paths use English.
