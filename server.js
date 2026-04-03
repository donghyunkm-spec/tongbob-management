// server.js (통합 최신 버전)
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// === [설정] 카카오 등 (환경변수에서 읽음) ===
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY || '';
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI || 'http://localhost:3000/oauth/kakao';

// === [설정] 텔레그램 ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// === [데이터 경로 설정] ===
const isRailway = process.env.RAILWAY_VOLUME_MOUNT_PATH !== undefined;
const actualDataPath = isRailway 
    ? process.env.RAILWAY_VOLUME_MOUNT_PATH 
    : path.join(__dirname, 'data');

if (!fs.existsSync(actualDataPath)) {
    fs.mkdirSync(actualDataPath, { recursive: true });
}

// === [파일 경로 정의] ===
// 1. 매장관리용
const STAFF_FILE = path.join(actualDataPath, 'staff.json');
const LOG_FILE = path.join(actualDataPath, 'logs.json');
const ACCOUNTING_FILE = path.join(actualDataPath, 'accounting.json');
const KAKAO_TOKEN_FILE = path.join(actualDataPath, 'kakao_token.json');

// 2. 재고관리용 (Inventory)
const INVENTORY_ITEMS_FILE = path.join(actualDataPath, 'items.json');
const INVENTORY_CURRENT_FILE = path.join(actualDataPath, 'inventory.json');
const INVENTORY_USAGE_FILE = path.join(actualDataPath, 'daily_usage.json');
const INVENTORY_ORDERS_FILE = path.join(actualDataPath, 'orders.json');
const INVENTORY_HOLIDAYS_FILE = path.join(actualDataPath, 'holidays.json');
const INVENTORY_LAST_ORDERS_FILE = path.join(actualDataPath, 'last_orders.json');
const INVENTORY_HISTORY_FILE = path.join(actualDataPath, 'inventory_history.json');


// === 파일 초기화 (없으면 빈 파일 생성) ===
function initFile(file, defaultData) {
    if (!fs.existsSync(file)) {
        try {
            fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
            console.log(`📄 파일 생성됨: ${file}`);
        } catch (err) {
            console.error(`❌ 파일 생성 실패 (${file}):`, err.message);
        }
    }
}

initFile(STAFF_FILE, []);
initFile(LOG_FILE, []);
initFile(ACCOUNTING_FILE, { monthly: {}, daily: {} });
initFile(KAKAO_TOKEN_FILE, []);

// === [유틸리티 함수] ===
function readJson(file, defaultVal = []) {
    try {
        if (!fs.existsSync(file)) return defaultVal;
        const content = fs.readFileSync(file, 'utf8');
        return content ? JSON.parse(content) : defaultVal;
    } catch (e) {
        console.error(`Read Error (${file}):`, e.message);
        return defaultVal;
    }
}

function writeJson(file, data) {
    try {
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error(`Write Error (${file}):`, e.message);
        return false;
    }
}

// 특정 날짜에 해당하는 직원 스케줄 반환 (이력 기반)
function getScheduleForDate(staff, dateStr) {
    if (!staff.scheduleHistory || staff.scheduleHistory.length === 0) {
        return { workDays: staff.workDays || [], time: staff.time || '', dayTimes: staff.dayTimes || {} };
    }
    const sorted = [...staff.scheduleHistory].sort((a, b) => a.from.localeCompare(b.from));
    let result = sorted[0];
    for (const entry of sorted) {
        if (entry.from <= dateStr) result = entry;
    }
    return result;
}

function addLog(actor, action, target, details) {
    let logs = readJson(LOG_FILE, []);
    logs.unshift({
        id: Date.now(),
        timestamp: new Date().toISOString(),
        actor, action, target, details
    });
    if (logs.length > 1000) logs.pop();
    writeJson(LOG_FILE, logs);
}

// [초기화] 재고관리 필수 파일 생성
function initializeInventoryData() {
    if (!fs.existsSync(INVENTORY_ITEMS_FILE)) {
        const initialItems = {
            '고센유통': [],
            '한강유통(고기)': [],
            '인터넷발주': [],
            '기타': []
        };
        writeJson(INVENTORY_ITEMS_FILE, initialItems);
    }
    if (!fs.existsSync(INVENTORY_HOLIDAYS_FILE)) {
        const initialHolidays = { 'store': [], '고센유통': [], '한강유통(고기)': [], '인터넷발주': [], '기타': [] };
        writeJson(INVENTORY_HOLIDAYS_FILE, initialHolidays);
    }
    // 나머지 파일들은 readJson 호출 시 기본값으로 처리됨
}
initializeInventoryData();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // index.html, staff.js, inventory.js 등이 여기 있어야 함

// =======================
// [API] 직원 관리 & 로그인
// =======================
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin1234!';
    const MANAGER_PW = process.env.MANAGER_PASSWORD || 'manager1234';
    const STAFF_PW = process.env.STAFF_PASSWORD || 'staff1234';
    const INVENTORY_PW = process.env.INVENTORY_PASSWORD || 'inventory1234';

    if (password === ADMIN_PW) res.json({ success: true, role: 'admin', name: '사장님' });
    else if (password === MANAGER_PW) res.json({ success: true, role: 'manager', name: '관리자' });
    else if (password === STAFF_PW) res.json({ success: true, role: 'viewer', name: '직원' });
    else if (password === INVENTORY_PW) res.json({ success: true, role: 'inventory', name: '재고담당' });
    else res.status(401).json({ success: false });
});

app.get('/api/staff', (req, res) => {
    const includeDeleted = req.query.includeDeleted === 'true';
    const role = req.query.role || 'viewer';
    let staff = readJson(STAFF_FILE, []);

    // ✅ 삭제된 직원 필터링 (includeDeleted=true가 아닌 경우)
    if (!includeDeleted) {
        staff = staff.filter(s => !s.deleted);
    }

    // ✅ admin이 아니면 급여 정보 제거
    if (role !== 'admin') {
        staff = staff.map(s => {
            const { salary, salaryType, ...rest } = s;
            return rest;
        });
    }

    res.json({ success: true, data: staff });
});

app.post('/api/staff', (req, res) => {
    const { staffList, actor } = req.body;
    let staff = readJson(STAFF_FILE, []);
    const newStaff = staffList.map(s => ({ ...s, id: Date.now() + Math.floor(Math.random()*1000) }));
    staff.push(...newStaff);
    
    if (writeJson(STAFF_FILE, staff)) {
        const nameList = newStaff.map(s => s.name).join(', ');
        addLog(actor, '직원등록', nameList, `${newStaff.length}명 등록`);
        res.json({ success: true });
    } else res.status(500).json({ success: false });
});

app.put('/api/staff/:id', (req, res) => {
    const { updates, actor, scheduleChangeDate } = req.body;
    let staff = readJson(STAFF_FILE, []);
    const idx = staff.findIndex(s => s.id == req.params.id);

    if (idx !== -1) {
        const old = staff[idx];
        const changed = [];

        // 스케줄 변경 감지 → 이력 기록
        const scheduleChanged =
            (updates.workDays !== undefined && JSON.stringify(updates.workDays || []) !== JSON.stringify(old.workDays || [])) ||
            (updates.time !== undefined && (updates.time || '') !== (old.time || '')) ||
            (updates.dayTimes !== undefined && JSON.stringify(updates.dayTimes || {}) !== JSON.stringify(old.dayTimes || {}));

        if (scheduleChanged) {
            const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
            const effectiveDate = scheduleChangeDate || kstToday;
            const history = old.scheduleHistory ? [...old.scheduleHistory] : [];

            if (history.length === 0) {
                // 최초 이력: 입사일 또는 알 수 없는 과거부터 현재 스케줄 적용
                history.push({
                    from: old.startDate || '2000-01-01',
                    workDays: old.workDays || [],
                    time: old.time || '',
                    dayTimes: old.dayTimes || {}
                });
            }
            // 같은 날짜 이력이 이미 있으면 덮어쓰기, 없으면 추가
            const existingIdx = history.findIndex(h => h.from === effectiveDate);
            const newEntry = {
                from: effectiveDate,
                workDays: updates.workDays !== undefined ? updates.workDays : (old.workDays || []),
                time: updates.time !== undefined ? updates.time : (old.time || ''),
                dayTimes: updates.dayTimes !== undefined ? updates.dayTimes : (old.dayTimes || {})
            };
            if (existingIdx >= 0) history[existingIdx] = newEntry;
            else history.push(newEntry);

            updates.scheduleHistory = history;
        }

        if (updates.name !== undefined && updates.name !== old.name)
            changed.push(`이름: ${old.name}→${updates.name}`);
        if (updates.position !== undefined && updates.position !== old.position)
            changed.push(`직책: ${old.position||'없음'}→${updates.position}`);
        if (updates.time !== undefined && updates.time !== old.time)
            changed.push(`출퇴근시간: ${old.time||'미설정'}→${updates.time||'미설정'}`);
        if (updates.workDays !== undefined && JSON.stringify((updates.workDays||[]).slice().sort()) !== JSON.stringify((old.workDays||[]).slice().sort()))
            changed.push(`근무요일: ${(old.workDays||[]).join(',')||'없음'}→${(updates.workDays||[]).join(',')||'없음'}`);
        if (updates.salary !== undefined && String(updates.salary) !== String(old.salary))
            changed.push(`급여 변경`);
        if (updates.salaryType !== undefined && updates.salaryType !== old.salaryType)
            changed.push(`급여유형: ${old.salaryType||'없음'}→${updates.salaryType}`);
        if (updates.startDate !== undefined && updates.startDate !== old.startDate)
            changed.push(`입사일: ${old.startDate||'없음'}→${updates.startDate||'없음'}`);
        if (updates.endDate !== undefined && updates.endDate !== old.endDate)
            changed.push(`퇴사일: ${old.endDate||'없음'}→${updates.endDate||'없음'}`);
        if (updates.paidUntil !== undefined && updates.paidUntil !== old.paidUntil)
            changed.push(`급여지급일: ${old.paidUntil||'없음'}→${updates.paidUntil||'없음'}`);
        if (updates.roles !== undefined && JSON.stringify((updates.roles||[]).slice().sort()) !== JSON.stringify((old.roles||[]).slice().sort()))
            changed.push(`역할: ${(old.roles||[]).join(',')||'없음'}→${(updates.roles||[]).join(',')||'없음'}`);
        if (updates.dayTimes !== undefined && JSON.stringify(updates.dayTimes) !== JSON.stringify(old.dayTimes||{}))
            changed.push(`요일별시간 변경`);

        const detail = changed.length > 0 ? changed.join(' / ') : '정보수정 (변경사항 없음)';

        staff[idx] = { ...old, ...updates };
        writeJson(STAFF_FILE, staff);
        addLog(actor, '직원수정', staff[idx].name, detail);
        res.json({ success: true });
    } else res.status(404).json({ success: false });
});

app.delete('/api/staff/:id', (req, res) => {
    const actor = req.query.actor || 'Unknown';
    let staff = readJson(STAFF_FILE, []);
    const target = staff.find(s => s.id == req.params.id);
    
    if (target) {
        // ✅ 소프트 삭제: 데이터는 유지하고 플래그만 설정
        const today = new Date().toISOString().split('T')[0];
        target.deleted = true;
        target.deletedAt = new Date().toISOString();
        target.deletedBy = actor;
        
        // ✅ endDate가 없으면 오늘 날짜로 자동 설정 (급여 계산용)
        if (!target.endDate) {
            target.endDate = today;
            target.autoEndDate = true; // 복구 시 자동 제거 대상
        }
        
        if (writeJson(STAFF_FILE, staff)) {
            addLog(actor, '직원삭제', target.name, '퇴사 처리 (데이터 보관)');
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false });
        }
    } else {
        res.status(404).json({ success: false, message: '직원을 찾을 수 없습니다.' });
    }
});

// ✅ 직원 복구 API
app.post('/api/staff/:id/restore', (req, res) => {
    const { actor } = req.body;
    let staff = readJson(STAFF_FILE, []);
    const target = staff.find(s => s.id == req.params.id);
    
    if (target && target.deleted) {
        // 복구 처리
        target.deleted = false;
        delete target.deletedAt;
        delete target.deletedBy;
        // 삭제 시 자동으로 세팅된 endDate는 복구 시 제거 (직접 입력한 퇴사일은 유지)
        if (target.autoEndDate) {
            delete target.endDate;
            delete target.autoEndDate;
        }
        
        if (writeJson(STAFF_FILE, staff)) {
            addLog(actor || 'Unknown', '직원복구', target.name, '복직 처리');
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false });
        }
    } else {
        res.status(404).json({ success: false, message: '복구할 직원을 찾을 수 없습니다.' });
    }
});

app.post('/api/staff/exception', async (req, res) => {
    const { id, date, type, time, actor } = req.body;
    let staff = readJson(STAFF_FILE, []);
    const target = staff.find(s => s.id == id);
    
    if (target) {
        if (!target.exceptions) target.exceptions = {};
        if (type === 'delete') delete target.exceptions[date];
        else target.exceptions[date] = { type, time };
        
        writeJson(STAFF_FILE, staff);
        const exceptionLabel = type === 'off'
            ? `임시 휴무 (${date})`
            : type === 'work'
                ? `임시 출근 (${date}${time ? ' ' + time : ''})`
                : `예외 삭제 - 원래 스케줄 복귀 (${date})`;
        addLog(actor, '근무변경', target.name, exceptionLabel);
        
        const todayStr = new Date().toISOString().split('T')[0];
        if (date === todayStr) {
            try {
                // 원래 스케줄 기준으로 변경 전 상태 파악
                const todayObj = new Date();
                const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const dayKey = dayMap[todayObj.getDay()];
                const schedule = getScheduleForDate(target, todayStr);
                const wasScheduledToWork = schedule.workDays.includes(dayKey);
                const beforeLabel = wasScheduledToWork ? '근무' : '휴무';
                const afterLabel = type === 'off' ? '임시휴무' : type === 'work' ? '임시근무' : beforeLabel;
                const changeDesc = `${target.name}: ${beforeLabel} → ${afterLabel}`;

                const msg = getDailyScheduleMessage(todayObj);
                await sendToKakao(`📢 [긴급] 당일 근무 변경 알림\n(${actor}님 수정)\n\n🔄 ${changeDesc}\n\n${msg}`);
                const detailedMsg = getDailyScheduleMessageDetailed(todayObj);
                await sendToTelegram(`📢 [당일 근무 변경]\n🔄 ${changeDesc}\n(${actor}님 수정)\n\n📋 전체 근무현황\n${detailedMsg}`);
            } catch (e) {
                console.error('알림 전송 실패:', e.message);
            }
        }
        res.json({ success: true });
    } else res.status(404).json({ success: false });
});

app.post('/api/staff/temp', async (req, res) => {
    const { name, date, time, salary, actor } = req.body;
    let staff = readJson(STAFF_FILE, []);
    
    const newWorker = {
        id: Date.now(),
        name: name,
        position: '알바(대타)',
        workDays: [],
        salaryType: 'hourly',
        salary: parseInt(salary) || 0,
        time: '',
        exceptions: { [date]: { type: 'work', time: time } }
    };

    staff.push(newWorker);
    
    if (writeJson(STAFF_FILE, staff)) {
        addLog(actor, '대타등록', name, `일일알바 등록 (${date} ${time})`);
        try {
            const todayStr = new Date().toISOString().split('T')[0];
            if (date === todayStr) {
                const msg = getDailyScheduleMessage(new Date());
                await sendToKakao(`📢 [긴급] 대타 등록 알림\n(${actor}님 등록)\n\n${msg}`);
            }
            const regDateObj = new Date(date + 'T00:00:00');
            const scheduleMsg = getDailyScheduleMessage(regDateObj);
            await sendToTelegram(`👤 [일일 알바 등록]\n이름: ${name}\n날짜: ${date}\n시간: ${time}\n등록자: ${actor}\n\n📋 해당일 전체 근무현황\n${scheduleMsg}`);
        } catch (e) {
            console.error('알림 전송 실패:', e.message);
        }
        res.json({ success: true });
    } else res.status(500).json({ success: false });
});

// =======================
// [API] 가계부
// =======================
app.get('/api/accounting', (req, res) => {
    const data = readJson(ACCOUNTING_FILE, { monthly: {}, daily: {} });
    res.json({ success: true, data });
});

app.post('/api/accounting/daily', (req, res) => {
    const { date, data: dayData, actor } = req.body; // staff.js 변수명에 맞게 수정
    let accData = readJson(ACCOUNTING_FILE, { monthly: {}, daily: {} });
    
    if (!accData.daily) accData.daily = {};
    accData.daily[date] = dayData;
    
    writeJson(ACCOUNTING_FILE, accData);
    addLog(actor, '일매출', date, '저장됨');
    res.json({ success: true });
});

// [수정] PUT 메서드 사용 (staff.js와 통일)
app.put('/api/accounting/monthly', (req, res) => {
    const { month, data: monthData, actor } = req.body; // staff.js 변수명에 맞게 수정
    let accData = readJson(ACCOUNTING_FILE, { monthly: {}, daily: {} });
    
    if (!accData.monthly) accData.monthly = {};
    accData.monthly[month] = monthData;
    
    writeJson(ACCOUNTING_FILE, accData);
    addLog(actor, '월고정비', month, '저장됨');
    res.json({ success: true });
});

// ==========================================
// [API 2] 재고 관리 (Inventory) - 추가됨
// ==========================================

// 1. 품목 정보
app.get('/api/inventory/items', (req, res) => {
    res.json({ success: true, items: readJson(INVENTORY_ITEMS_FILE, {}) });
});
app.post('/api/inventory/items', (req, res) => {
    const { items } = req.body;
    writeJson(INVENTORY_ITEMS_FILE, items);
    res.json({ success: true });
});

// 2. 현재 재고
app.get('/api/inventory/current', (req, res) => {
    res.json({ success: true, inventory: readJson(INVENTORY_CURRENT_FILE, {}) });
});
app.post('/api/inventory/current', (req, res) => {
    const { inventory: incomingData, location } = req.body;

    // 위치별 머지 저장: 기존 데이터를 읽고 해당 위치 키만 덮어쓰기
    const existing = readJson(INVENTORY_CURRENT_FILE, {});
    let merged;

    if (location) {
        // 위치 지정 저장: 해당 위치 키만 교체, 나머지 보존
        const prefix = `${location}_`;
        merged = { ...existing };

        // 기존 데이터에서 해당 위치 키 제거
        Object.keys(merged).forEach(key => {
            if (key.startsWith(prefix) && !key.startsWith('meta_')) {
                delete merged[key];
            }
        });

        // 새 데이터에서 해당 위치 키와 meta 키 추가
        Object.keys(incomingData).forEach(key => {
            if (key.startsWith(prefix) || key === `meta_last_save_${location}`) {
                merged[key] = incomingData[key];
            }
        });

        // 창고 전용 품목: 창고 탭에서 해당 품목의 1루/3루 값만 저장
        if (location === '창고') {
            const itemsData = readJson(INVENTORY_ITEMS_FILE, {});
            const warehouseOnlyKeys = new Set();
            Object.keys(itemsData).forEach(vendor => {
                (itemsData[vendor] || []).forEach(item => {
                    if (item.locations && item.locations.length === 1 && item.locations[0] === '창고') {
                        warehouseOnlyKeys.add(`${vendor}_${item.품목명}`);
                    }
                });
            });

            Object.keys(incomingData).forEach(key => {
                if ((key.startsWith('1루_') || key.startsWith('3루_')) && !key.startsWith('meta_')) {
                    const loc = key.startsWith('1루_') ? '1루' : '3루';
                    const rawKey = key.substring(loc.length + 1);
                    if (warehouseOnlyKeys.has(rawKey)) {
                        merged[key] = incomingData[key];
                    }
                }
            });
        }
    } else {
        // 하위 호환: location 없으면 기존처럼 통째로 저장
        merged = incomingData;
    }

    const writeResult = writeJson(INVENTORY_CURRENT_FILE, merged);

    if (!writeResult) {
        console.error('재고 저장 실패: 파일 쓰기 오류');
        return res.status(500).json({ success: false, error: '파일 저장 실패' });
    }

    // 즉시 응답 전송 (사용자 경험 개선)
    res.json({ success: true, inventory: merged });

    // 히스토리 저장은 비동기로 처리 (응답 후 백그라운드 작업)
    setImmediate(() => {
        try {
            let history = readJson(INVENTORY_HISTORY_FILE, []);
            const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
            const historyRecord = {
                date: now.toISOString().split('T')[0],
                time: now.toISOString().split('T')[1].substring(0, 5),
                inventory: {}
            };

            // itemKey 예: "1루_고센유통_양파"
            for (const itemKey in merged) {
                if (itemKey.startsWith('meta_')) continue; // meta 키는 히스토리에서 제외
                const parts = itemKey.split('_');
                let vendor;

                if (parts[0] === '1루' || parts[0] === '3루' || parts[0] === '창고') {
                    vendor = parts[1];
                } else {
                    vendor = parts[0];
                }

                if (!historyRecord.inventory[vendor]) historyRecord.inventory[vendor] = {};
                historyRecord.inventory[vendor][itemKey] = merged[itemKey];
            }

            history.push(historyRecord);
            if (history.length > 100) history = history.slice(-100);
            writeJson(INVENTORY_HISTORY_FILE, history);
        } catch (e) {
            console.error('히스토리 저장 실패:', e);
        }
    });
});

// 3. 하루 사용량
app.get('/api/inventory/daily-usage', (req, res) => {
    res.json({ success: true, usage: readJson(INVENTORY_USAGE_FILE, {}) });
});
app.post('/api/inventory/daily-usage', (req, res) => {
    const { usage } = req.body;
    writeJson(INVENTORY_USAGE_FILE, usage);
    res.json({ success: true });
});

// 4. 마지막 발주일
app.get('/api/inventory/last-orders', (req, res) => {
    res.json({ success: true, lastOrders: readJson(INVENTORY_LAST_ORDERS_FILE, {}) });
});

// 5. 발주 저장
app.post('/api/inventory/orders', (req, res) => {
    const orderRecord = req.body;
    let orders = readJson(INVENTORY_ORDERS_FILE, []);
    
    const existingIndex = orders.findIndex(o => o.date === orderRecord.date);
    if (existingIndex !== -1) orders[existingIndex] = orderRecord;
    else orders.push(orderRecord);
    
    writeJson(INVENTORY_ORDERS_FILE, orders);
    
    // 마지막 발주일 업데이트
    let lastOrders = readJson(INVENTORY_LAST_ORDERS_FILE, {});
    const today = orderRecord.date;
    for (const vendor in orderRecord.orders) {
        orderRecord.orders[vendor].forEach(item => {
            const itemKey = `${vendor}_${item.품목명}`;
            lastOrders[itemKey] = today;
        });
    }
    writeJson(INVENTORY_LAST_ORDERS_FILE, lastOrders);

    res.json({ success: true });

    // 텔레그램 발주 요약 발송 (비동기, 실패해도 응답에 영향 없음)
    try {
        const itemsData = readJson(INVENTORY_ITEMS_FILE, {});
        const currentInventory = readJson(INVENTORY_CURRENT_FILE, {});
        sendOrderTelegramSummary(orderRecord, itemsData, currentInventory);
    } catch (e) {
        console.error('텔레그램 발주 요약 발송 실패:', e.message);
    }
});

// 6. 발주 내역 조회
app.get('/api/inventory/orders', (req, res) => {
    // 간단하게 전체 리턴 후 프론트에서 필터링하거나, 여기서 필터링 가능
    // 파일 기반이므로 전체 읽어서 리턴
    res.json({ success: true, orders: readJson(INVENTORY_ORDERS_FILE, []) });
});

// 7. 재고 내역 조회
app.get('/api/inventory/history', (req, res) => {
    res.json({ success: true, history: readJson(INVENTORY_HISTORY_FILE, []) });
});

// 8. 휴일 관리
app.get('/api/inventory/holidays', (req, res) => {
    res.json({ success: true, holidays: readJson(INVENTORY_HOLIDAYS_FILE, {}) });
});
app.post('/api/inventory/holidays', (req, res) => {
    const { holidays } = req.body;
    writeJson(INVENTORY_HOLIDAYS_FILE, holidays);
    res.json({ success: true });
});

// =======================
// [API] 로그 & 백업
// =======================
app.get('/api/logs', (req, res) => {
    const logs = readJson(LOG_FILE, []);
    res.json({ success: true, data: logs });
});

// [NEW] 백업 기능 추가
app.get('/api/backup', (req, res) => {
    const backupData = {
        staff: readJson(STAFF_FILE, []),
        accounting: readJson(ACCOUNTING_FILE, { monthly: {}, daily: {} }),
        logs: readJson(LOG_FILE, [])
    };
    res.json({ success: true, data: backupData });
});

// =======================
// [API] 카카오톡 알림
// =======================
app.get('/oauth/kakao', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('인증 실패: code 없음');

    try {
        const tokenResponse = await axios.post('https://kauth.kakao.com/oauth/token', null, {
            params: {
                grant_type: 'authorization_code',
                client_id: KAKAO_REST_API_KEY,
                redirect_uri: KAKAO_REDIRECT_URI,
                code: code
            },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token, refresh_token, expires_in, refresh_token_expires_in } = tokenResponse.data;

        const userResponse = await axios.get('https://kapi.kakao.com/v2/user/me', {
            headers: { 'Authorization': `Bearer ${access_token}` }
        });

        const userId = userResponse.data.id;
        const userNickname = userResponse.data.properties?.nickname || '사장님';

        const newTokens = {
            access_token,
            refresh_token,
            expires_in,
            refresh_token_expires_in,
            createdAt: new Date().toISOString()
        };

        let tokenList = readJson(KAKAO_TOKEN_FILE, []);
        const existingIdx = tokenList.findIndex(t => t.userId === userId);

        if (existingIdx !== -1) {
            tokenList[existingIdx] = { userId, nickname: userNickname, ...newTokens, updatedAt: new Date().toISOString() };
        } else {
            tokenList.push({ userId, nickname: userNickname, ...newTokens, updatedAt: new Date().toISOString() });
        }
        writeJson(KAKAO_TOKEN_FILE, tokenList);
        res.send(`<h1>✅ 로그인 성공!</h1><p>${userNickname}님 등록 완료.</p>`);
    } catch (error) {
        console.error('카카오 로그인 실패:', error.message);
        res.send(`로그인 실패: ${error.message}`);
    }
});

function calculateServerStaffCost(staffList, monthStr) {
    if (!staffList || !Array.isArray(staffList)) return 0;
    const [y, m] = monthStr.split('-');
    const year = parseInt(y);
    const month = parseInt(m);
    const lastDayObj = new Date(year, month, 0);
    const totalDaysInMonth = lastDayObj.getDate();
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let totalPay = 0;
    staffList.forEach(s => {
        const sDate = s.startDate ? new Date(s.startDate) : null;
        const eDate = s.endDate ? new Date(s.endDate) : null;
        const isEmployedAt = (dVal) => {
            const t = new Date(year, month - 1, dVal); t.setHours(0,0,0,0);
            if (sDate) { const start = new Date(sDate); start.setHours(0,0,0,0); if (t < start) return false; }
            if (eDate) { const end = new Date(eDate); end.setHours(0,0,0,0); if (t > end) return false; }
            return true;
        };

        if (s.salaryType === 'monthly') {
            let employedDays = 0;
            for (let d = 1; d <= totalDaysInMonth; d++) { if (isEmployedAt(d)) employedDays++; }
            if (employedDays === totalDaysInMonth) totalPay += (s.salary || 0);
            else totalPay += Math.floor((s.salary || 0) / totalDaysInMonth * employedDays);
        } else {
            let hours = 0;
            for (let d = 1; d <= totalDaysInMonth; d++) {
                if (!isEmployedAt(d)) continue;
                const dateKey = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const dateObj = new Date(year, month - 1, d);
                const dayName = dayMap[dateObj.getDay()];
                let isWorking = false;
                // 스케줄 이력 기반으로 해당 날짜의 스케줄 조회
                const schedule = getScheduleForDate(s, dateKey);
                let timeStr = (schedule.dayTimes && schedule.dayTimes[dayName]) ? schedule.dayTimes[dayName] : schedule.time;
                if (s.exceptions && s.exceptions[dateKey]) {
                    const ex = s.exceptions[dateKey];
                    if (ex.type === 'work') { isWorking = true; timeStr = ex.time; }
                    else if (ex.type === 'off') { isWorking = false; }
                } else { if (schedule.workDays.includes(dayName)) isWorking = true; }
                if (isWorking && timeStr && timeStr.includes('~')) {
                    const [start, end] = timeStr.split('~');
                    const [sh, sm] = start.trim().split(':').map(Number);
                    const [eh, em] = end.trim().split(':').map(Number);
                    let h = (eh * 60 + em) - (sh * 60 + sm);
                    if (h < 0) h += 24 * 60;
                    hours += (h / 60);
                }
            }
            totalPay += Math.floor(hours * (s.salary || 0));
        }
    });
    return totalPay;
}

async function sendToKakao(text) {
    let tokenList = readJson(KAKAO_TOKEN_FILE, []);
    if (!Array.isArray(tokenList) || tokenList.length === 0) return;

    for (let i = 0; i < tokenList.length; i++) {
        let user = tokenList[i];
        try {
            await axios.post('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
                template_object: JSON.stringify({
                    object_type: 'text', text: text,
                    link: { web_url: 'https://tongbob-management-production.up.railway.app', mobile_web_url: 'https://tongbob-management-production.up.railway.app' }
                })
            }, { headers: { 'Authorization': `Bearer ${user.access_token}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
        } catch (error) { console.error('전송 실패:', error.message); }
    }
}

async function sendToTelegram(text) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text
        });
    } catch (e) {
        console.error('텔레그램 전송 실패:', e.message);
    }
}

async function sendOrderTelegramSummary(orderRecord, itemsData, currentInventory) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;

    const date = orderRecord.date || '';
    const time = orderRecord.time || '';

    // 1. 발주 품목 요약
    let orderLines = [];
    let orderTotalCount = 0;
    for (const vendor in orderRecord.orders) {
        const vendorItems = orderRecord.orders[vendor];
        if (!vendorItems || vendorItems.length === 0) continue;
        orderLines.push(`\n📦 ${vendor}`);
        vendorItems.forEach(item => {
            const unit = item.displayUnit || item.발주단위 || '';
            orderLines.push(`  ${item.품목명} ${item.orderAmount}${unit}`);
            orderTotalCount++;
        });
    }

    if (orderTotalCount === 0) return; // 발주 품목 없으면 발송 안 함

    // 2. 인분 현황 계산 (판매메뉴별)
    // 현재 재고 수집
    let stockMap = {}; // "vendor_품목명" → totalStock
    for (const key in currentInventory) {
        if (key.startsWith('meta_')) continue;
        // key: "1루_vendor_itemName" or "3루_vendor_itemName"
        const parts = key.match(/^(1루|3루|창고)_(.+)$/);
        if (!parts) continue;
        const rawKey = parts[2];
        stockMap[rawKey] = (stockMap[rawKey] || 0) + (currentInventory[key] || 0);
    }

    // 발주량 수집
    let orderMap = {};
    for (const vendor in orderRecord.orders) {
        (orderRecord.orders[vendor] || []).forEach(oi => {
            const key = `${vendor}_${oi.품목명}`;
            orderMap[key] = (orderMap[key] || 0) + (oi.orderAmount || 0);
        });
    }

    // 판매메뉴별 그룹핑
    let menuMap = {};    // 메뉴명 → [{품목명, currentServings, afterServings}]
    let noNameItems = [];

    for (const vendor in itemsData) {
        (itemsData[vendor] || []).forEach(item => {
            if (!item.servings || item.servings.length === 0) return;
            const rawKey = `${vendor}_${item.품목명}`;
            const currentTotal = stockMap[rawKey] || 0;
            const orderQty = orderMap[rawKey] || 0;
            const afterTotal = currentTotal + orderQty;

            item.servings.forEach(s => {
                const menuName = (s.name || '').trim();
                const entry = {
                    품목명: item.품목명,
                    currentServings: Math.round(currentTotal * s.perUnit * 100) / 100,
                    afterServings: Math.round(afterTotal * s.perUnit * 100) / 100,
                    orderQty: orderQty,
                    unit: item.발주단위 || ''
                };
                if (!menuName) {
                    noNameItems.push(entry);
                } else {
                    if (!menuMap[menuName]) menuMap[menuName] = [];
                    menuMap[menuName].push(entry);
                }
            });
        });
    }

    // 3. 메시지 조합
    let msg = `📋 발주 완료 (${date} ${time})\n`;
    msg += `총 ${orderTotalCount}개 품목 발주`;
    msg += orderLines.join('\n');

    // 인분 현황
    const menuNames = Object.keys(menuMap).sort();
    if (menuNames.length > 0 || noNameItems.length > 0) {
        msg += `\n\n━━━━━━━━━━━━━━━━━━`;
        msg += `\n📏 인분 현황 (현재→발주후)`;

        menuNames.forEach(menuName => {
            const ingredients = menuMap[menuName];
            const currentMin = Math.min(...ingredients.map(i => i.currentServings));
            const afterMin = Math.min(...ingredients.map(i => i.afterServings));
            msg += `\n\n🍽 ${menuName}: ${currentMin}→${afterMin}인분`;

            ingredients.sort((a, b) => a.afterServings - b.afterServings);
            ingredients.forEach(ing => {
                const arrow = ing.orderQty > 0 ? `${ing.currentServings}→${ing.afterServings}` : `${ing.currentServings}`;
                const bottleneckMark = ing.afterServings === afterMin ? '⚠' : '';
                msg += `\n  ${bottleneckMark}${ing.품목명}: ${arrow}인분`;
            });
        });

        if (noNameItems.length > 0) {
            msg += `\n\n📦 기타`;
            noNameItems.forEach(ing => {
                const arrow = ing.orderQty > 0 ? `${ing.currentServings}→${ing.afterServings}` : `${ing.currentServings}`;
                msg += `\n  ${ing.품목명}: ${arrow}인분`;
            });
        }
    }

    await sendToTelegram(msg);
}

app.post('/api/kakao/send-briefing', async (req, res) => {
    const { actor } = req.body;
    try {
        await generateAndSendBriefing(); 
        addLog(actor, '카톡발송', '통합브리핑', '수동발송 완료');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 고정비 및 비용 계산 로직 업데이트 (자동계산 로직 추가)
function extractStoreCosts(accData, staffData, monthStr, currentDay) {
    let meat = 0, food = 0, etcDaily = 0;
    let sales1 = 0, sales3 = 0;
    let delivery1 = 0, delivery3 = 0;

    // 일일 데이터 합산
    if (accData.daily) {
        Object.keys(accData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                const d = accData.daily[date];
                sales1 += (d.sales1 || 0);
                sales3 += (d.sales3 || 0);
                delivery1 += (d.delivery1 || 0);
                delivery3 += (d.delivery3 || 0);
                meat += (d.meat || 0);
                food += (d.food || 0);
                etcDaily += (d.etc || 0);
            }
        });
    }

    const sales = sales1 + sales3;
    const deliverySalesTotal = delivery1 + delivery3;

    const m = (accData.monthly && accData.monthly[monthStr]) ? accData.monthly[monthStr] : {};

    // 수수료: 아모제(28.5%) + 통빱(2.5%) + 배달(6%)
    const commission = Math.floor(sales * 0.285) + Math.floor(sales * 0.025);
    const deliveryFee = Math.floor(deliverySalesTotal * 0.06);
    const cardFee = 0;

    // 고정비 (1루 + 3루)
    const fixedMisc = (m.internet1||0) + (m.water1||0) + (m.cleaning1||0) +
                      (m.operMgmt1||0) + (m.cctv1||0) + (m.bizCard1||0) + (m.etc_fixed1||0) +
                      (m.insurance1||0) + (m.bizIncomeTax1||0) + (m.taxAccountant1||0) +
                      (m.internet3||0) + (m.water3||0) + (m.cleaning3||0) +
                      (m.operMgmt3||0) + (m.cctv3||0) + (m.bizCard3||0) + (m.etc_fixed3||0) +
                      (m.insurance3||0) + (m.bizIncomeTax3||0) + (m.taxAccountant3||0);

    const staffTotal = calculateServerStaffCost(staffData, monthStr);

    const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const ratio = currentDay / lastDay;

    const itemsPred = {
        commission: commission,
        deliveryFee: deliveryFee,
        cardFee: cardFee,

        fixedMisc: Math.floor(fixedMisc * ratio),
        staff: Math.floor(staffTotal * ratio),

        meat: meat,
        food: food,
        etc: etcDaily
    };

    const costPred = Object.values(itemsPred).reduce((a,b)=>a+b, 0);
    const profitPred = sales - costPred;

    const costFull = meat + food + etcDaily + staffTotal +
                     commission + deliveryFee + cardFee + fixedMisc;

    const profitReal = sales - costFull;

    return { sales, sales1, sales3, profitPred, profitReal, items: itemsPred, margin: sales > 0 ? ((profitPred / sales) * 100).toFixed(1) : '0.0' };
}

async function generateAndSendBriefing() {
    try {
        const today = new Date();
        const monthStr = today.toISOString().slice(0, 7);
        const dayNum = today.getDate();

        const acc = readJson(ACCOUNTING_FILE, { monthly: {}, daily: {} });
        const staff = readJson(STAFF_FILE, []);
        const data = extractStoreCosts(acc, staff, monthStr, dayNum);
        const formatMoney = (n) => n.toLocaleString();

        // 재고 원가 계산
        const inventoryItems = readJson(INVENTORY_ITEMS_FILE, {});
        const currentInv = readJson(INVENTORY_CURRENT_FILE, {});
        let invCost = 0;
        for (const vendor in inventoryItems) {
            (inventoryItems[vendor] || []).forEach(item => {
                const key = `${vendor}_${item.품목명}`;
                const s1 = currentInv[`1루_${key}`] || 0;
                const s3 = currentInv[`3루_${key}`] || 0;
                const sW = currentInv[`창고_${key}`] || 0;
                invCost += (item.unitCost || 0) * (s1 + s3 + sW);
            });
        }

        let msg = `[📅 ${today.getMonth()+1}월 ${today.getDate()}일 경영 브리핑]\n\n`;
        msg += `■ 매출: ${formatMoney(data.sales)}원\n`;
        msg += `■ 예상순익: ${formatMoney(data.profitPred)}원\n`;
        msg += `■ 실질손익: ${formatMoney(data.profitReal)}원 (고정비 완납기준)`;
        if (invCost > 0) {
            msg += `\n■ 재고원가: ${formatMoney(invCost)}원`;
            if (data.sales > 0) {
                msg += ` (원가율 ${(invCost / data.sales * 100).toFixed(1)}%)`;
            }
        }

        await sendToKakao(msg);
    } catch (e) { console.error('브리핑 실패:', e); }
}

function getDailyScheduleMessage(dateObj) {
    const staffList = readJson(STAFF_FILE, []);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayKey = dayMap[dateObj.getDay()];

    let workers = [];
    staffList.forEach(s => {
        if (s.deleted) return;
        // startDate/endDate 필터링
        const d0 = new Date(dateStr); d0.setHours(0,0,0,0);
        if (s.startDate) { const sd = new Date(s.startDate); sd.setHours(0,0,0,0); if (d0 < sd) return; }
        if (s.endDate) { const ed = new Date(s.endDate); ed.setHours(0,0,0,0); if (d0 > ed) return; }

        let isWorking = false;
        // scheduleHistory 기반 스케줄 조회
        const schedule = getScheduleForDate(s, dateStr);
        let timeStr = (schedule.dayTimes && schedule.dayTimes[dayKey]) ? schedule.dayTimes[dayKey] : schedule.time;
        if (s.exceptions && s.exceptions[dateStr]) {
            const ex = s.exceptions[dateStr];
            if (ex.type === 'work') { isWorking = true; timeStr = ex.time; }
        } else { if (schedule.workDays.includes(dayKey)) isWorking = true; }
        if (isWorking) workers.push({ name: s.name, time: timeStr });
    });

    if (workers.length === 0) return `근무자 없음`;
    let msg = `근무인원 ${workers.length}명\n`;
    workers.forEach(w => { msg += `- ${w.name}: ${w.time}\n`; });
    return msg;
}

function getDailyScheduleMessageDetailed(dateObj) {
    const staffList = readJson(STAFF_FILE, []);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayKey = dayMap[dateObj.getDay()];

    let workers = [];
    let offWorkers = [];
    staffList.forEach(s => {
        if (s.deleted) return;
        // startDate/endDate 필터링
        const d0 = new Date(dateStr); d0.setHours(0,0,0,0);
        if (s.startDate) { const sd = new Date(s.startDate); sd.setHours(0,0,0,0); if (d0 < sd) return; }
        if (s.endDate) { const ed = new Date(s.endDate); ed.setHours(0,0,0,0); if (d0 > ed) return; }

        // scheduleHistory 기반 스케줄 조회
        const schedule = getScheduleForDate(s, dateStr);
        let timeStr = (schedule.dayTimes && schedule.dayTimes[dayKey]) ? schedule.dayTimes[dayKey] : schedule.time;
        if (s.exceptions && s.exceptions[dateStr]) {
            const ex = s.exceptions[dateStr];
            if (ex.type === 'work') workers.push({ name: s.name, time: ex.time });
            else if (ex.type === 'off') offWorkers.push(s.name);
        } else {
            if (schedule.workDays.includes(dayKey)) workers.push({ name: s.name, time: timeStr });
        }
    });

    let msg = workers.length === 0 ? `근무자 없음\n` : `근무인원 ${workers.length}명\n`;
    workers.forEach(w => { msg += `- ${w.name}: ${w.time}\n`; });
    if (offWorkers.length > 0) {
        msg += `\n🚫 임시 휴무 ${offWorkers.length}명\n`;
        offWorkers.forEach(n => { msg += `- ${n}\n`; });
    }
    return msg;
}

cron.schedule('0 9 * * *', async () => {
    try {
        const today = new Date();
        const msg = getDailyScheduleMessage(today);
        const dateStr = `${today.getMonth()+1}월 ${today.getDate()}일`;
        await sendToTelegram(`📅 [${dateStr} 근무현황]\n\n${msg}`);
    } catch (e) { console.error('텔레그램 근무현황 전송 실패:', e); }
}, { timezone: "Asia/Seoul" });

cron.schedule('30 9 * * *', async () => {
    try {
        const today = new Date();
        const monthStr = today.toISOString().slice(0, 7);
        const dayNum = today.getDate();
        const acc = readJson(ACCOUNTING_FILE, { monthly: {}, daily: {} });
        const staff = readJson(STAFF_FILE, []);
        const data = extractStoreCosts(acc, staff, monthStr, dayNum);
        const fmt = (n) => n.toLocaleString();
        const dateStr = `${today.getMonth()+1}월 ${today.getDate()}일`;

        let msg = `💰 [${dateStr} 수익 현황]\n\n`;
        msg += `■ 총 매출: ${fmt(data.sales)}원\n`;
        msg += `  ├ 1루: ${fmt(data.sales1)}원\n`;
        msg += `  └ 3루: ${fmt(data.sales3)}원\n\n`;
        msg += `■ 예상순익: ${fmt(data.profitPred)}원 (마진 ${data.margin}%)\n`;
        msg += `■ 월간순익(고정비 완납): ${fmt(data.profitReal)}원`;

        await sendToTelegram(msg);
    } catch (e) { console.error('텔레그램 수익현황 전송 실패:', e); }
}, { timezone: "Asia/Seoul" });

cron.schedule('30 11 * * *', async () => {
    try {
        const today = new Date();
        const msg = getDailyScheduleMessage(today);
        await sendToKakao(`[📅 ${today.getMonth()+1}/${today.getDate()} 근무자 브리핑]\n\n${msg}`);
    } catch (e) { console.error(e); }
}, { timezone: "Asia/Seoul" });

cron.schedule('0 11 * * *', async () => {
    try {
        await generateAndSendBriefing();
    } catch (e) { console.error('브리핑 크론 실패:', e); }
}, { timezone: "Asia/Seoul" });

cron.schedule('0 10 * * *', async () => {
    try {
        const itemsData = readJson(INVENTORY_ITEMS_FILE, {});
        const lastOrders = readJson(INVENTORY_LAST_ORDERS_FILE, {});
        const today = new Date();

        // 모든 품목의 마지막 발주일 계산
        let itemList = [];
        for (const vendor in itemsData) {
            itemsData[vendor].forEach(item => {
                if (item.발주제외) return;
                const key = `${vendor}_${item.품목명}`;
                const lastDate = lastOrders[key];
                const daysSince = lastDate
                    ? Math.ceil((today - new Date(lastDate)) / (1000 * 60 * 60 * 24))
                    : 999;
                itemList.push({ name: item.품목명, vendor, lastDate, daysSince });
            });
        }

        // 오래된 순 정렬
        itemList.sort((a, b) => b.daysSince - a.daysSince);

        // 5일 이상 미발주 품목만
        const alertItems = itemList.filter(i => i.daysSince >= 5);

        if (alertItems.length > 0) {
            let msg = `⚠️ [장기 미발주 품목 알림]\n`;
            msg += `${today.getMonth()+1}/${today.getDate()} 기준, 5일 이상 미발주\n\n`;
            alertItems.forEach((item, idx) => {
                const dateDisplay = item.daysSince === 999
                    ? '발주기록없음'
                    : `${item.daysSince}일 전(${item.lastDate})`;
                msg += `${idx+1}. ${item.name} (${item.vendor.substr(0,2)}) - ${dateDisplay}\n`;
            });
            await sendToTelegram(msg);
        }

        // 전체 재고 현황 메시지
        const currentInventory = readJson(INVENTORY_CURRENT_FILE, {});
        let stockMsg = `📊 [전체 재고 현황]\n${today.getMonth()+1}/${today.getDate()} 기준\n`;

        const vendorOrder = ['고센유통', '한강유통(고기)', '인터넷발주', '기타'];
        vendorOrder.forEach(vendor => {
            if (!itemsData[vendor] || itemsData[vendor].length === 0) return;
            stockMsg += `\n📦 ${vendor}\n`;
            itemsData[vendor].forEach(item => {
                const key = `${vendor}_${item.품목명}`;
                const stock1 = currentInventory[`1루_${key}`] || 0;
                const stock3 = currentInventory[`3루_${key}`] || 0;
                const stockW = currentInventory[`창고_${key}`] || 0;
                const locations = item.locations || ['1루', '3루'];
                let stockParts = [];
                if (locations.includes('1루')) stockParts.push(`1루:${stock1}`);
                if (locations.includes('3루')) stockParts.push(`3루:${stock3}`);
                if (locations.includes('창고')) stockParts.push(`창고:${stockW}`);
                const stockText = stockParts.length === 1 ? stockParts[0] : stockParts.join(' / ');
                const total = stock1 + stock3 + stockW;
                const warn = total === 0 ? ' ⚠️' : '';
                stockMsg += `  ${item.품목명} → ${stockText} (합계:${total})${warn}\n`;
            });
        });

        // 재고 총 원가 추가
        let totalInvCost = 0;
        let vendorCostsMap = {};
        vendorOrder.forEach(vendor => {
            let vCost = 0;
            if (itemsData[vendor]) {
                itemsData[vendor].forEach(item => {
                    const key = `${vendor}_${item.품목명}`;
                    const s1 = currentInventory[`1루_${key}`] || 0;
                    const s3 = currentInventory[`3루_${key}`] || 0;
                    const sW = currentInventory[`창고_${key}`] || 0;
                    vCost += (item.unitCost || 0) * (s1 + s3 + sW);
                });
            }
            vendorCostsMap[vendor] = vCost;
            totalInvCost += vCost;
        });

        if (totalInvCost > 0) {
            stockMsg += `\n💰 재고 총 원가: ${totalInvCost.toLocaleString()}원\n`;
            vendorOrder.forEach(v => {
                if (vendorCostsMap[v] > 0) stockMsg += `  ${v}: ${vendorCostsMap[v].toLocaleString()}원\n`;
            });
        }

        await sendToTelegram(stockMsg);
    } catch (e) { console.error('미발주 알림 실패:', e); }
}, { timezone: "Asia/Seoul" });

// === [디버그용] 파일 저장 확인 API ===
app.get('/api/debug/files', (req, res) => {
    try {
        // 현재 설정된 저장 경로 확인
        const isRailway = process.env.RAILWAY_VOLUME_MOUNT_PATH !== undefined;
        const currentPath = isRailway 
            ? process.env.RAILWAY_VOLUME_MOUNT_PATH 
            : path.join(__dirname, 'data');

        // 폴더 내 파일 목록 읽기
        if (!fs.existsSync(currentPath)) {
            return res.json({ 
                status: 'Folder Not Found', 
                path: currentPath, 
                files: [] 
            });
        }

        const files = fs.readdirSync(currentPath).map(filename => {
            const stats = fs.statSync(path.join(currentPath, filename));
            return {
                name: filename,
                size: stats.size + ' bytes',
                modified: stats.mtime.toLocaleString()
            };
        });

        res.json({
            status: 'OK',
            environment: isRailway ? 'Railway Volume' : 'Local Disk',
            savePath: currentPath,
            fileCount: files.length,
            files: files
        });
    } catch (e) {
        res.json({ error: e.message });
    }
});

// === [백업] 전체 데이터 백업 API ===
const BACKUP_DIR = path.join(actualDataPath, 'backups');
const MAX_BACKUPS = 14; // 최대 14일치 보관

function collectBackupData() {
    return {
        timestamp: new Date().toISOString(),
        staff: readJson(STAFF_FILE, []),
        logs: readJson(LOG_FILE, []),
        accounting: readJson(ACCOUNTING_FILE, { monthly: {}, daily: {} }),
        inventory_items: readJson(INVENTORY_ITEMS_FILE, {}),
        inventory_current: readJson(INVENTORY_CURRENT_FILE, {}),
        inventory_usage: readJson(INVENTORY_USAGE_FILE, {}),
        inventory_orders: readJson(INVENTORY_ORDERS_FILE, []),
        inventory_holidays: readJson(INVENTORY_HOLIDAYS_FILE, {}),
        inventory_last_orders: readJson(INVENTORY_LAST_ORDERS_FILE, {}),
        inventory_history: readJson(INVENTORY_HISTORY_FILE, [])
    };
}

function runAutoBackup() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

        const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const dateStr = kstDate.toISOString().split('T')[0];
        const backupFile = path.join(BACKUP_DIR, `backup_${dateStr}.json`);

        const backupData = collectBackupData();
        fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
        console.log(`✅ 자동 백업 완료: ${backupFile}`);

        // 오래된 백업 삭제 (MAX_BACKUPS 초과분)
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
            .sort();
        if (files.length > MAX_BACKUPS) {
            const toDelete = files.slice(0, files.length - MAX_BACKUPS);
            toDelete.forEach(f => {
                try {
                    fs.unlinkSync(path.join(BACKUP_DIR, f));
                    console.log(`🗑️ 오래된 백업 삭제: ${f}`);
                } catch (unlinkErr) {
                    console.error(`백업 삭제 실패 (${f}):`, unlinkErr.message);
                }
            });
        }
    } catch (e) {
        console.error('❌ 자동 백업 실패:', e.message);
    }
}

// 매일 새벽 3시(KST) 자동 백업
cron.schedule('0 3 * * *', () => {
    console.log('⏰ 자동 백업 시작...');
    runAutoBackup();
}, { timezone: "Asia/Seoul" });

app.get('/api/backup/all', (req, res) => {
    try {
        const backupData = collectBackupData();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="backup_${new Date().toISOString().split('T')[0]}.json"`);
        res.json(backupData);
    } catch(e) {
        console.error('백업 실패:', e);
        res.status(500).json({ error: '백업 생성 실패' });
    }
});

// 저장된 자동 백업 목록 조회
app.get('/api/backup/list', (req, res) => {
    try {
        if (!fs.existsSync(BACKUP_DIR)) return res.json({ success: true, backups: [] });
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
            .sort()
            .reverse()
            .map(f => {
                const stats = fs.statSync(path.join(BACKUP_DIR, f));
                return { filename: f, size: stats.size, date: f.replace('backup_', '').replace('.json', '') };
            });
        res.json({ success: true, backups: files });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// 저장된 자동 백업 다운로드
app.get('/api/backup/download/:date', (req, res) => {
    try {
        const dateParam = req.params.date.replace(/[^0-9\-]/g, '');
        const filename = `backup_${dateParam}.json`;
        const filePath = path.join(BACKUP_DIR, filename);
        // Path traversal 방지
        if (!filePath.startsWith(BACKUP_DIR)) return res.status(400).json({ error: '잘못된 요청' });
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: '백업 파일 없음' });
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.sendFile(filePath);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});