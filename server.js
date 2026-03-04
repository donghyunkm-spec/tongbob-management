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
            '인터넷발주': []
        };
        writeJson(INVENTORY_ITEMS_FILE, initialItems);
    }
    if (!fs.existsSync(INVENTORY_HOLIDAYS_FILE)) {
        const initialHolidays = { 'store': [], '고센유통': [], '한강유통(고기)': [], '인터넷발주': [] };
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

    if (password === ADMIN_PW) res.json({ success: true, role: 'admin', name: '사장님' });
    else if (password === MANAGER_PW) res.json({ success: true, role: 'manager', name: '관리자' });
    else if (password === STAFF_PW) res.json({ success: true, role: 'viewer', name: '직원' });
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
        addLog(actor, '직원등록', `${newStaff.length}명`, '일괄등록');
        res.json({ success: true });
    } else res.status(500).json({ success: false });
});

app.put('/api/staff/:id', (req, res) => {
    const { updates, actor } = req.body;
    let staff = readJson(STAFF_FILE, []);
    const idx = staff.findIndex(s => s.id == req.params.id);
    
    if (idx !== -1) {
        staff[idx] = { ...staff[idx], ...updates };
        writeJson(STAFF_FILE, staff);
        addLog(actor, '직원수정', staff[idx].name, '정보수정');
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
        // endDate는 유지 (실제 퇴사일이 있을 수 있음)
        
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
        addLog(actor, '근무변경', target.name, `${date} ${type}`);
        
        const todayStr = new Date().toISOString().split('T')[0];
        if (date === todayStr) {
            const msg = getDailyScheduleMessage(new Date());
            await sendToKakao(`📢 [긴급] 당일 근무 변경 알림\n(${actor}님 수정)\n\n${msg}`);
            const changeLabel = type === 'off' ? '임시 휴무 처리' : type === 'work' ? '임시 출근 등록' : '원래 스케줄로 복귀';
            const detailedMsg = getDailyScheduleMessageDetailed(new Date());
            await sendToTelegram(`📢 [당일 근무 변경]\n✏️ ${target.name} → ${changeLabel}\n(${actor}님 수정)\n\n📋 전체 근무현황\n${detailedMsg}`);
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
        addLog(actor, '대타등록', name, `${date} ${time}`);
        const todayStr = new Date().toISOString().split('T')[0];
        if (date === todayStr) {
            const msg = getDailyScheduleMessage(new Date());
            await sendToKakao(`📢 [긴급] 대타 등록 알림\n(${actor}님 등록)\n\n${msg}`);
        }
        const regDateObj = new Date(date + 'T00:00:00');
        const scheduleMsg = getDailyScheduleMessage(regDateObj);
        await sendToTelegram(`👤 [일일 알바 등록]\n이름: ${name}\n날짜: ${date}\n시간: ${time}\n등록자: ${actor}\n\n📋 해당일 전체 근무현황\n${scheduleMsg}`);
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
    const { inventory } = req.body;
    writeJson(INVENTORY_CURRENT_FILE, inventory);
    
    // 즉시 응답 전송 (사용자 경험 개선)
    res.json({ success: true, inventory: inventory });
    
    // 히스토리 저장은 비동기로 처리 (응답 후 백그라운드 작업)
    setImmediate(() => {
        try {
            let history = readJson(INVENTORY_HISTORY_FILE, []);
            const now = new Date();
            const historyRecord = {
                date: now.toISOString().split('T')[0],
                time: now.toTimeString().split(' ')[0].substring(0, 5),
                inventory: {}
            };
            
            // itemKey 예: "1루_고센유통_양파" 또는 "고센유통_양파"
            for (const itemKey in inventory) {
                const parts = itemKey.split('_');
                let vendor;
                
                // "1루_고센유통_양파" 형식인 경우
                if (parts[0] === '1루' || parts[0] === '3루') {
                    vendor = parts[1]; // "고센유통"
                } else {
                    // "고센유통_양파" 형식인 경우 (하위 호환성)
                    vendor = parts[0];
                }
                
                if (!historyRecord.inventory[vendor]) historyRecord.inventory[vendor] = {};
                historyRecord.inventory[vendor][itemKey] = inventory[itemKey];
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
                // 요일별 시간 우선 사용
                let timeStr = (s.dayTimes && s.dayTimes[dayName]) ? s.dayTimes[dayName] : s.time;
                if (s.exceptions && s.exceptions[dateKey]) {
                    if (s.exceptions[dateKey].type === 'work') { isWorking = true; timeStr = s.exceptions[dateKey].time; }
                } else { if (s.workDays.includes(dayName)) isWorking = true; }
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
                    link: { web_url: 'https://chogajipreservation-production.up.railway.app', mobile_web_url: 'https://chogajipreservation-production.up.railway.app' }
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
    let meat = 0, food = 0, etcDaily = 0, sales = 0;
    
    // 자동 계산을 위한 변수
    let cardSalesTotal = 0;
    let deliverySalesTotal = 0;
    
    // 일일 데이터 합산
    if (accData.daily) {
        Object.keys(accData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                const d = accData.daily[date];
                sales += (d.sales || 0);
                meat += (d.meat || 0);
                food += (d.food || 0);
                etcDaily += (d.etc || 0);
                
                // 수수료 계산용 합산
                cardSalesTotal += (d.card || 0);
                deliverySalesTotal += (d.delivery || 0); 
            }
        });
    }

    const m = (accData.monthly && accData.monthly[monthStr]) ? accData.monthly[monthStr] : {};

    // 수수료/배달비/카드비는 실시간 계산값 우선
    const commission = Math.floor(sales * 0.30);       
    const deliveryFee = Math.floor(deliverySalesTotal * 0.0495); 
    const cardFee = Math.floor(cardSalesTotal * 0.016); 

    const internet = m.internet || 0;
    const water = m.water || 0;
    const cleaning = m.cleaning || 0;
    const operMgmt = m.operMgmt || 0;
    const cctv = m.cctv || 0;
    const etcFixed = m.etc_fixed || 0;

    const staffTotal = calculateServerStaffCost(staffData, monthStr);

    const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const ratio = currentDay / lastDay;

    const itemsPred = {
        commission: commission, 
        deliveryFee: deliveryFee,
        cardFee: cardFee,
        
        internet: Math.floor(internet * ratio),
        water: Math.floor(water * ratio),
        cleaning: Math.floor(cleaning * ratio),
        operMgmt: Math.floor(operMgmt * ratio),
        cctv: Math.floor(cctv * ratio),
        etcFixed: Math.floor(etcFixed * ratio),
        staff: Math.floor(staffTotal * ratio),
        
        meat: meat, 
        food: food, 
        etc: etcDaily
    };
    
    const costPred = Object.values(itemsPred).reduce((a,b)=>a+b, 0);
    const profitPred = sales - costPred;
    
    const costFull = meat + food + etcDaily + staffTotal + 
                     commission + deliveryFee + cardFee + 
                     internet + water + cleaning + operMgmt + cctv + etcFixed;
                     
    const profitReal = sales - costFull;

    return { sales, profitPred, profitReal, items: itemsPred };
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

        let msg = `[📅 ${today.getMonth()+1}월 ${today.getDate()}일 경영 브리핑]\n\n`;
        msg += `■ 매출: ${formatMoney(data.sales)}원\n`;
        msg += `■ 예상순익: ${formatMoney(data.profitPred)}원\n`;
        msg += `■ 실질손익: ${formatMoney(data.profitReal)}원 (고정비 완납기준)`;
        
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
        let isWorking = false;
        // 요일별 시간 우선 사용
        let timeStr = (s.dayTimes && s.dayTimes[dayKey]) ? s.dayTimes[dayKey] : s.time;
        if (s.exceptions && s.exceptions[dateStr]) {
            const ex = s.exceptions[dateStr];
            if (ex.type === 'work') { isWorking = true; timeStr = ex.time; }
        } else { if (s.workDays.includes(dayKey)) isWorking = true; }
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
        let timeStr = (s.dayTimes && s.dayTimes[dayKey]) ? s.dayTimes[dayKey] : s.time;
        if (s.exceptions && s.exceptions[dateStr]) {
            const ex = s.exceptions[dateStr];
            if (ex.type === 'work') workers.push({ name: s.name, time: ex.time });
            else if (ex.type === 'off') offWorkers.push(s.name);
        } else {
            if (s.workDays.includes(dayKey)) workers.push({ name: s.name, time: timeStr });
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

cron.schedule('30 11 * * *', async () => {
    try {
        const today = new Date();
        const msg = getDailyScheduleMessage(today);
        await sendToKakao(`[📅 ${today.getMonth()+1}/${today.getDate()} 근무자 브리핑]\n\n${msg}`);
    } catch (e) { console.error(e); }
}, { timezone: "Asia/Seoul" });

cron.schedule('0 11 * * *', () => {
    generateAndSendBriefing();
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
app.get('/api/backup/all', (req, res) => {
    try {
        const backupData = {
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
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="backup_${new Date().toISOString().split('T')[0]}.json"`);
        res.json(backupData);
    } catch(e) {
        console.error('백업 실패:', e);
        res.status(500).json({ error: '백업 생성 실패' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});