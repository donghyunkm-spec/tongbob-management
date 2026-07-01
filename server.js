// server.js (통합 최신 버전)
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const zlib = require('zlib');
const cron = require('node-cron');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// === [설정] 카카오 등 (환경변수 우선, 없으면 통빱 프로덕션 기본값) ===
// 기본값은 public/kakao-auth.html 의 로그인 설정과 일치해야 함 (client_id/redirect_uri 동일 필수)
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY || 'b93a072ab458557243baf45e12f2a011';
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI || 'https://tongbob-management-production.up.railway.app/oauth/kakao';

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
const ATTENDANCE_FILE = path.join(actualDataPath, 'attendance.json');       // 알바 출퇴근 기록 { staffId: [ {id,date,start,end,minutes,note,createdAt,updatedAt} ] }
const ATTENDANCE_LOG_FILE = path.join(actualDataPath, 'attendance_logs.json'); // 수정/삭제 이력 (최대 1000)

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
initFile(ATTENDANCE_FILE, {});
initFile(ATTENDANCE_LOG_FILE, []);

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
    const tmp = file + '.tmp';
    try {
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
        return true;
    } catch (e) {
        console.error(`Write Error (${file}):`, e.message);
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
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

// === [출퇴근] 유틸리티 ===
// "HH:MM" -> 분(0~1439). 유효하지 않으면 null
function parseHM(str) {
    if (typeof str !== 'string') return null;
    const m = str.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
}

// 근무 분 계산 (자정 넘김 자동 처리: 퇴근<=출근이면 다음날로 간주)
function calcWorkMinutes(start, end) {
    const s = parseHM(start), e = parseHM(end);
    if (s === null || e === null) return null;
    let diff = e - s;
    if (diff <= 0) diff += 24 * 60; // 자정 넘김
    return diff;
}

// 출퇴근 수정/삭제 이력 기록
function addAttLog(staffId, staffName, action, actor, detail) {
    const logs = readJson(ATTENDANCE_LOG_FILE, []);
    logs.unshift({
        id: Date.now() + Math.floor(Math.random() * 1000),
        timestamp: new Date().toISOString(),
        staffId, staffName, action, actor, detail
    });
    if (logs.length > 1000) logs.pop();
    writeJson(ATTENDANCE_LOG_FILE, logs);
}

// 기록 목록 + 통계 계산
function buildAttStats(records) {
    const list = [...(records || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const days = list.length;
    const totalMin = list.reduce((sum, r) => sum + (r.minutes || 0), 0);
    const maxMin = list.reduce((mx, r) => Math.max(mx, r.minutes || 0), 0);
    const avgMin = days > 0 ? Math.round(totalMin / days) : 0;
    return { records: list, days, totalMin, avgMin, maxMin };
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
app.use('/api/backup/restore', express.json({ limit: '50mb' }));
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

    // ✅ admin이 아니면 급여 정보 + 출퇴근 토큰/기기(비밀값) 제거
    if (role !== 'admin') {
        staff = staff.map(s => {
            const { salary, salaryType, attToken, attDevice, attDeviceBoundAt, ...rest } = s;
            return { ...rest, hasAttToken: !!attToken };
        });
    } else {
        staff = staff.map(s => ({ ...s, hasAttToken: !!s.attToken, attDeviceBound: !!s.attDevice }));
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
        if (updates.memo !== undefined && (updates.memo || '') !== (old.memo || ''))
            changed.push(`메모 변경`);
        if (updates.idCardIssued !== undefined && (updates.idCardIssued !== false) !== (old.idCardIssued !== false))
            changed.push(`ID카드: ${old.idCardIssued === false ? '미발급' : '발급'}→${updates.idCardIssued === false ? '미발급' : '발급'}`);
        if (updates.roles !== undefined && JSON.stringify((updates.roles||[]).slice().sort()) !== JSON.stringify((old.roles||[]).slice().sort()))
            changed.push(`역할: ${(old.roles||[]).join(',')||'없음'}→${(updates.roles||[]).join(',')||'없음'}`);
        if (updates.dayTimes !== undefined && JSON.stringify(updates.dayTimes) !== JSON.stringify(old.dayTimes||{}))
            changed.push(`요일별시간 변경`);

        const detail = changed.length > 0 ? changed.join(' / ') : '정보수정 (변경사항 없음)';

        staff[idx] = { ...old, ...updates };
        if (!writeJson(STAFF_FILE, staff)) {
            return res.status(500).json({ success: false, error: '파일 저장 실패' });
        }
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
    
    if (!target) {
        return res.status(404).json({ success: false, message: '복구할 직원을 찾을 수 없습니다.' });
    }

    const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
    const isExpiredEndDate = !target.deleted && target.endDate && target.endDate < kstToday;

    if (target.deleted) {
        // 소프트 삭제된 직원 복구
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
    } else if (isExpiredEndDate) {
        // 퇴사일이 지나서 자동 분류된 직원 → 퇴사일 비우고 복귀
        const prevEndDate = target.endDate;
        delete target.endDate;
        delete target.autoEndDate;

        if (writeJson(STAFF_FILE, staff)) {
            addLog(actor || 'Unknown', '직원복구', target.name, `퇴사일(${prevEndDate}) 해제`);
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false });
        }
    } else {
        res.status(400).json({ success: false, message: '복구 대상이 아닙니다.' });
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

        if (!writeJson(STAFF_FILE, staff)) {
            return res.status(500).json({ success: false, error: '파일 저장 실패' });
        }
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
// [API] 알바 출퇴근 (attendance)
// =======================

// --- [관리자] 출퇴근 링크(토큰) 발급/재발급 ---
app.post('/api/staff/:id/att-token', (req, res) => {
    const { actor } = req.body || {};
    let staff = readJson(STAFF_FILE, []);
    const target = staff.find(s => s.id == req.params.id);
    if (!target) return res.status(404).json({ success: false, error: '직원 없음' });

    const isReissue = !!target.attToken;
    target.attToken = crypto.randomBytes(24).toString('base64url'); // 32자 URL-safe
    delete target.attDevice;        // 재발급 시 기기 등록 초기화
    delete target.attDeviceBoundAt;
    if (!writeJson(STAFF_FILE, staff)) return res.status(500).json({ success: false });
    addLog(actor || '사장님', '출퇴근링크', target.name, isReissue ? '링크 재발급' : '링크 발급');
    res.json({ success: true, token: target.attToken });
});

// --- [관리자] 출퇴근 링크 해제 ---
app.delete('/api/staff/:id/att-token', (req, res) => {
    const { actor } = req.body || {};
    let staff = readJson(STAFF_FILE, []);
    const target = staff.find(s => s.id == req.params.id);
    if (!target) return res.status(404).json({ success: false, error: '직원 없음' });
    delete target.attToken;
    delete target.attDevice;
    delete target.attDeviceBoundAt;
    if (!writeJson(STAFF_FILE, staff)) return res.status(500).json({ success: false });
    addLog(actor || '사장님', '출퇴근링크', target.name, '링크 해제');
    res.json({ success: true });
});

// --- [관리자] 등록 기기 초기화 (폰 교체/오등록 시 다음 접속 기기로 재등록) ---
app.post('/api/staff/:id/att-device-reset', (req, res) => {
    const { actor } = req.body || {};
    let staff = readJson(STAFF_FILE, []);
    const target = staff.find(s => s.id == req.params.id);
    if (!target) return res.status(404).json({ success: false, error: '직원 없음' });
    delete target.attDevice;
    delete target.attDeviceBoundAt;
    if (!writeJson(STAFF_FILE, staff)) return res.status(500).json({ success: false });
    addLog(actor || '사장님', '출퇴근링크', target.name, '등록 기기 초기화');
    res.json({ success: true });
});

// --- [관리자] 월별 출퇴근 요약 (알바별 총시간/근무일수/평균/하루최대) ---
app.get('/api/attendance/summary', (req, res) => {
    const month = req.query.month; // "YYYY-MM", 없으면 전체
    const staff = readJson(STAFF_FILE, []);
    const att = readJson(ATTENDANCE_FILE, {});
    // 토큰이 발급된 직원 = 관리 대상 알바
    const albas = staff.filter(s => s.attToken && !s.deleted);
    const result = albas.map(s => {
        let records = att[s.id] || [];
        if (month) records = records.filter(r => (r.date || '').startsWith(month));
        const stats = buildAttStats(records);
        return {
            id: s.id, name: s.name,
            days: stats.days, totalMin: stats.totalMin,
            avgMin: stats.avgMin, maxMin: stats.maxMin,
            records: stats.records
        };
    });
    res.json({ success: true, data: result });
});

// --- [관리자] 출퇴근 수정/삭제 이력 ---
app.get('/api/attendance/logs', (req, res) => {
    res.json({ success: true, data: readJson(ATTENDANCE_LOG_FILE, []) });
});

// --- [관리자/테스트] 출퇴근 요약 미리보기 & 즉시 전송 ---
// GET /api/attendance/digest?date=YYYY-MM-DD (기본: 어제)  &send=1(카톡+텔레그램)|kakao|telegram
app.get('/api/attendance/digest', async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : getKstYesterday();
    const text = getAttendanceDigest(date);
    const send = req.query.send;
    if (send === '1' || send === 'kakao') { try { await sendToKakao(text); } catch (e) {} }
    if (send === '1' || send === 'telegram') { try { await sendToTelegram(text); } catch (e) {} }
    res.json({ success: true, date, sent: send || null, text });
});

// 기기 잠금(1폰 고정) 사용 여부. true로 바꾸면 다시 활성화됨.
const ALBA_DEVICE_LOCK = false;

// 토큰 + 기기 확인. 미등록이면 현재 기기(deviceId)로 자동 고정.
// return: { code:'OK'|'NOTFOUND'|'NODEVICE'|'MISMATCH', target }
function resolveAlba(token, deviceId) {
    const staff = readJson(STAFF_FILE, []);
    const target = staff.find(s => s.attToken && s.attToken === token && !s.deleted);
    if (!target) return { code: 'NOTFOUND' };
    if (!deviceId) return { code: 'NODEVICE', target };
    if (!target.attDevice) {
        target.attDevice = deviceId;
        target.attDeviceBoundAt = new Date().toISOString();
        writeJson(STAFF_FILE, staff);
        return { code: 'OK', target };
    }
    if (target.attDevice === deviceId) return { code: 'OK', target };
    return { code: 'MISMATCH', target };
}

// 알바 API 공통 게이트. 통과 시 staff 반환, 실패 시 응답 전송 후 null 반환.
function albaGate(req, res) {
    // 기기 잠금이 꺼져 있으면 토큰만 확인 (아무 브라우저/기기에서나 접속 가능)
    if (!ALBA_DEVICE_LOCK) {
        const staff = readJson(STAFF_FILE, []).find(s => s.attToken && s.attToken === req.params.token && !s.deleted);
        if (!staff) { res.status(404).json({ success: false, error: 'invalid_token' }); return null; }
        return staff;
    }
    const deviceId = (req.get('X-Device-Id') || '').trim();
    const r = resolveAlba(req.params.token, deviceId);
    if (r.code === 'NOTFOUND') { res.status(404).json({ success: false, error: 'invalid_token' }); return null; }
    if (r.code === 'NODEVICE') { res.status(400).json({ success: false, error: 'no_device' }); return null; }
    if (r.code === 'MISMATCH') { res.status(403).json({ success: false, error: 'device_mismatch' }); return null; }
    return r.target;
}

// --- [알바] 토큰으로 본인 정보 + 기록 + 통계 조회 ---
app.get('/api/alba/:token', (req, res) => {
    const staff = albaGate(req, res);
    if (!staff) return;
    const att = readJson(ATTENDANCE_FILE, {});
    const stats = buildAttStats(att[staff.id] || []);
    res.json({ success: true, name: staff.name, ...stats });
});

// --- [알바] 출퇴근 기록 추가 ---
app.post('/api/alba/:token/record', (req, res) => {
    const staff = albaGate(req, res);
    if (!staff) return;
    const { date, start, end, note } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ success: false, error: 'bad date' });
    const minutes = calcWorkMinutes(start, end);
    if (minutes === null) return res.status(400).json({ success: false, error: 'bad time' });

    const att = readJson(ATTENDANCE_FILE, {});
    if (!att[staff.id]) att[staff.id] = [];
    const now = new Date().toISOString();
    const record = { id: Date.now() + Math.floor(Math.random() * 1000), date, start, end, minutes, note: note || '', createdAt: now, updatedAt: now };
    att[staff.id].push(record);
    if (!writeJson(ATTENDANCE_FILE, att)) return res.status(500).json({ success: false });
    addAttLog(staff.id, staff.name, '입력', staff.name, `${date} ${start}~${end} (${Math.floor(minutes/60)}시간 ${minutes%60}분)`);
    res.json({ success: true, record });
});

// --- [알바] 출퇴근 기록 수정 ---
app.put('/api/alba/:token/record/:rid', (req, res) => {
    const staff = albaGate(req, res);
    if (!staff) return;
    const { date, start, end, note } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ success: false, error: 'bad date' });
    const minutes = calcWorkMinutes(start, end);
    if (minutes === null) return res.status(400).json({ success: false, error: 'bad time' });

    const att = readJson(ATTENDANCE_FILE, {});
    const list = att[staff.id] || [];
    const rec = list.find(r => r.id == req.params.rid);
    if (!rec) return res.status(404).json({ success: false, error: 'record not found' });
    const before = `${rec.date} ${rec.start}~${rec.end}`;
    rec.date = date; rec.start = start; rec.end = end; rec.minutes = minutes; rec.note = note || '';
    rec.updatedAt = new Date().toISOString();
    if (!writeJson(ATTENDANCE_FILE, att)) return res.status(500).json({ success: false });
    addAttLog(staff.id, staff.name, '수정', staff.name, `${before} → ${date} ${start}~${end}`);
    res.json({ success: true, record: rec });
});

// --- [알바] 출퇴근 기록 삭제 ---
app.delete('/api/alba/:token/record/:rid', (req, res) => {
    const staff = albaGate(req, res);
    if (!staff) return;
    const att = readJson(ATTENDANCE_FILE, {});
    const list = att[staff.id] || [];
    const idx = list.findIndex(r => r.id == req.params.rid);
    if (idx === -1) return res.status(404).json({ success: false, error: 'record not found' });
    const rec = list[idx];
    list.splice(idx, 1);
    att[staff.id] = list;
    if (!writeJson(ATTENDANCE_FILE, att)) return res.status(500).json({ success: false });
    addAttLog(staff.id, staff.name, '삭제', staff.name, `${rec.date} ${rec.start}~${rec.end}`);
    res.json({ success: true });
});

// --- [알바] 토큰 페이지 서빙 (관리시스템과 분리된 독립 페이지) ---
app.get('/alba/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'alba.html'));
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

    if (!writeJson(ACCOUNTING_FILE, accData)) {
        return res.status(500).json({ success: false, error: '파일 저장 실패' });
    }
    addLog(actor, '일매출', date, '저장됨');
    res.json({ success: true });
});

// [수정] PUT 메서드 사용 (staff.js와 통일)
app.put('/api/accounting/monthly', (req, res) => {
    const { month, data: monthData, actor } = req.body; // staff.js 변수명에 맞게 수정
    let accData = readJson(ACCOUNTING_FILE, { monthly: {}, daily: {} });

    if (!accData.monthly) accData.monthly = {};
    accData.monthly[month] = monthData;

    if (!writeJson(ACCOUNTING_FILE, accData)) {
        return res.status(500).json({ success: false, error: '파일 저장 실패' });
    }
    addLog(actor, '월고정비', month, '저장됨');
    res.json({ success: true });
});

// ==========================================
// [API 1-B] 매출 상세분석 (POS 엑셀 리포트 기반)
//  - data 폴더의 "시간대별 분석 현황_{1루,3루}.xlsx" + "메뉴별 매출 순위 집계_{1루,3루}.xlsx" 파싱
//  - 같은 파일명으로 새 리포트를 덮어쓰면 자동 갱신됨 (mtime 캐시)
// ==========================================

// --- 최소 XLSX 파서 (외부 의존성 없이 zip + sharedStrings 해석) ---
function _xlsxReadZip(file) {
    const buf = fs.readFileSync(file);
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip');
    const cdOffset = buf.readUInt32LE(eocd + 16);
    const cdCount = buf.readUInt16LE(eocd + 10);
    let p = cdOffset;
    const entries = {};
    for (let n = 0; n < cdCount; n++) {
        const method = buf.readUInt16LE(p + 10);
        const compSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const lfh = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        const lnl = buf.readUInt16LE(lfh + 26);
        const lel = buf.readUInt16LE(lfh + 28);
        const ds = lfh + 30 + lnl + lel;
        const cd = buf.slice(ds, ds + compSize);
        entries[name] = method === 0 ? cd : zlib.inflateRawSync(cd);
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}
function _xlsxDecode(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/_x000D_/g, '');
}
// 시트를 [{A:val, B:val, ...}, ...] 형태의 행 배열로 파싱 (셀 r 속성 기준, 빈 셀 무시)
function _xlsxParse(file) {
    const z = _xlsxReadZip(file);
    let shared = [];
    if (z['xl/sharedStrings.xml']) {
        const ss = z['xl/sharedStrings.xml'].toString('utf8');
        shared = ss.split(/<si>/).slice(1).map(si =>
            _xlsxDecode([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
    }
    const sheetName = Object.keys(z).filter(k => /xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
    const xml = z[sheetName].toString('utf8');
    const rows = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const o = {};
        // 자기닫힘(<c .../>) 빈 셀과 일반 셀 모두 처리
        for (const c of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const col = c[1], attrs = c[2] || '', inner = c[3] || '';
            const t = (attrs.match(/t="([^"]*)"/) || [])[1];
            const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
            const im = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
            let v = vm ? vm[1] : (im ? _xlsxDecode(im[1]) : undefined);
            if (v === undefined) continue;
            if (t === 's') v = shared[parseInt(v)];
            o[col] = v;
        }
        if (Object.keys(o).length) rows.push(o);
    }
    return rows;
}

// 엑셀 일련번호 -> 'YYYY-MM-DD' (UTC 기준)
function _excelSerialToDate(serial) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}
const _DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
// 시간대 컬럼(E~AB) -> 시(0~23) 매핑 (AM01:00 ~ PM12:00=자정)
const _TIME_COLS = (() => {
    const letters = ['E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB'];
    // E=AM01(1) ... O=AM11(11), P=AM12(12,정오), Q=PM01(13) ... AB=PM12(0,자정)
    return letters.map((c, idx) => {
        const h = (idx + 1) % 24; // E->1, ... AB->0
        return [c, h];
    });
})();
const _START_THRESHOLD = 200000; // 매출 시작 시간대 판정 임계 (이 금액 이상 처음 발생한 시각)

function _loadTimeReport(file) {
    const rows = _xlsxParse(file);
    const days = [];
    for (const r of rows) {
        if (!r.D || !/^\d+$/.test(String(r.D))) continue;      // 일자(일련번호) 행만
        if (!r.B || !String(r.B).startsWith('184')) continue;   // 데이터 행만 (가맹점코드)
        const serial = parseInt(r.D);
        const dt = _excelSerialToDate(serial);
        const hours = _TIME_COLS.map(([c, h]) => ({ h, v: parseInt(r[c] || 0) || 0 }));
        const total = parseInt(r.AC || 0) || 0;
        days.push({
            date: dt.toISOString().slice(0, 10),
            dow: dt.getUTCDay(),
            month: dt.getUTCMonth() + 1,
            hours, total
        });
    }
    return days;
}
function _loadMenuReport(file) {
    const rows = _xlsxParse(file);
    const items = [];
    for (const r of rows) {
        const code = r.E, name = r.F;
        if (!code || !/^\d+$/.test(String(code))) continue;     // 메뉴코드 있는 행만 (합계행 제외)
        if (!name || name === '0') continue;
        items.push({
            name,
            price: parseInt(r.G || 0) || 0,
            cnt: parseInt(r.I || 0) || 0,
            gross: parseInt(r.AC || 0) || 0   // 총판매금액
        });
    }
    return items;
}

// 활성 시간대 목록 (데이터가 한 번이라도 발생한 시각, 정렬)
function _activeHours(days) {
    const set = new Set();
    days.forEach(d => d.hours.forEach(x => { if (x.v > 0) set.add(x.h); }));
    return [...set].sort((a, b) => a - b);
}
function _avg(arr, pick) {
    if (!arr.length) return 0;
    return arr.reduce((s, x) => s + pick(x), 0) / arr.length;
}

// 1) 일별 평균 + 월별 (영업일 = 매출>0 인 날, 휴무 = 매출 0 인 날)
function _buildDaily(days) {
    const op = days.filter(d => d.total > 0);
    const byMonth = {};
    days.forEach(d => {
        const m = byMonth[d.month] || (byMonth[d.month] = { month: d.month, op: 0, closed: 0, total: 0 });
        if (d.total > 0) { m.op++; m.total += d.total; } else m.closed++;
    });
    const months = Object.values(byMonth).sort((a, b) => a.month - b.month)
        .map(m => ({ ...m, avg: m.op ? Math.round(m.total / m.op) : 0 }));
    return {
        operatingDays: op.length,
        closedDays: days.length - op.length,
        totalSales: op.reduce((s, d) => s + d.total, 0),
        avgPerDay: op.length ? Math.round(_avg(op, d => d.total)) : 0,
        byMonth: months
    };
}

// 2) 요일별 평균 (월요일 등 데이터 없는 요일은 정기휴무로 표기)
function _buildWeekday(days) {
    const wk = {};
    for (let i = 0; i < 7; i++) wk[i] = { dow: i, name: _DOW_KR[i], op: 0, closed: 0, total: 0, max: 0, min: Infinity };
    days.forEach(d => {
        const w = wk[d.dow];
        if (d.total > 0) {
            w.op++; w.total += d.total;
            if (d.total > w.max) w.max = d.total;
            if (d.total < w.min) w.min = d.total;
        } else w.closed++;
    });
    // 월(1)~일(0) 순서로 정렬
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.map(i => {
        const w = wk[i];
        return {
            dow: i, name: w.name, op: w.op, closed: w.closed,
            avg: w.op ? Math.round(w.total / w.op) : 0,
            max: w.op ? w.max : 0,
            min: w.op ? w.min : 0,
            hasData: w.op > 0 || w.closed > 0
        };
    });
}

// 3) 경기 시작 시간대별 시간 분포 (입장 후 매출 램프업 패턴)
function _buildStartGroups(days, hoursAxis) {
    const op = days.filter(d => d.total > 0);
    const firstSaleHour = (d) => {
        for (const x of d.hours) { if (x.v >= _START_THRESHOLD) return x.h; }
        // 임계 미만이면 가장 매출 큰 시각
        let best = null, bv = -1;
        d.hours.forEach(x => { if (x.v > bv) { bv = x.v; best = x.h; } });
        return best;
    };
    const groups = {};
    op.forEach(d => {
        const s = firstSaleHour(d);
        if (s === null) return;
        (groups[s] = groups[s] || []).push(d);
    });
    const build = (list) => {
        const cnt = list.length;
        const hourly = hoursAxis.map(h => {
            const sum = list.reduce((s, d) => {
                const cell = d.hours.find(x => x.h === h);
                return s + (cell ? cell.v : 0);
            }, 0);
            return { hour: h, avg: cnt ? Math.round(sum / cnt) : 0, sum };
        });
        const grandTotal = hourly.reduce((s, x) => s + x.sum, 0);
        hourly.forEach(x => { x.pct = grandTotal ? +(x.sum / grandTotal * 100).toFixed(1) : 0; });
        let peak = hourly[0];
        hourly.forEach(x => { if (x.avg > peak.avg) peak = x; });
        return { hourly, peakHour: peak ? peak.hour : null };
    };
    const result = Object.keys(groups).map(Number).sort((a, b) => a - b).map(s => {
        const list = groups[s];
        const dowCounts = {};
        list.forEach(d => { dowCounts[d.dow] = (dowCounts[d.dow] || 0) + 1; });
        const b = build(list);
        return {
            startHour: s,
            days: list.length,
            avgTotal: Math.round(_avg(list, d => d.total)),
            dowCounts,
            hourly: b.hourly,
            peakHour: b.peakHour
        };
    });
    // 전체 평균 프로파일도 포함
    const overall = build(op);
    return { groups: result, overall: { days: op.length, hourly: overall.hourly, peakHour: overall.peakHour, avgTotal: op.length ? Math.round(_avg(op, d => d.total)) : 0 } };
}

// 4) 메뉴별 매출 (경기당 평균 판매량 포함)
function _buildMenu(items, operatingDays) {
    const total = items.reduce((s, m) => s + m.gross, 0);
    const totalCnt = items.reduce((s, m) => s + m.cnt, 0);
    const sorted = [...items].sort((a, b) => b.gross - a.gross).map(m => ({
        name: m.name,
        price: m.price,
        cnt: m.cnt,
        gross: m.gross,
        pct: total ? +(m.gross / total * 100).toFixed(1) : 0,
        perGame: operatingDays ? +(m.cnt / operatingDays).toFixed(1) : 0
    }));
    return {
        items: sorted,
        total, totalCnt,
        avgOrderPrice: totalCnt ? Math.round(total / totalCnt) : 0
    };
}

// 두 매장 시간대 데이터를 날짜 기준으로 합산
function _combineTimeDays(a, b) {
    const map = {};
    const add = (d) => {
        const cur = map[d.date] || (map[d.date] = { date: d.date, dow: d.dow, month: d.month, hours: _TIME_COLS.map(([c, h]) => ({ h, v: 0 })), total: 0 });
        cur.total += d.total;
        d.hours.forEach((x, i) => { cur.hours[i].v += x.v; });
    };
    a.forEach(add); b.forEach(add);
    return Object.values(map).sort((x, y) => x.date.localeCompare(y.date));
}
function _combineMenu(a, b) {
    const map = {};
    [...a, ...b].forEach(m => {
        const cur = map[m.name] || (map[m.name] = { name: m.name, price: m.price, cnt: 0, gross: 0 });
        cur.cnt += m.cnt; cur.gross += m.gross;
    });
    return Object.values(map);
}

function _buildStoreAnalysis(timeDays, menuItems) {
    const daily = _buildDaily(timeDays);
    const hoursAxis = _activeHours(timeDays);
    return {
        daily,
        weekday: _buildWeekday(timeDays),
        hoursAxis,
        time: _buildStartGroups(timeDays, hoursAxis),
        menu: _buildMenu(menuItems, daily.operatingDays),
        period: timeDays.length ? { start: timeDays[0].date, end: timeDays[timeDays.length - 1].date, days: timeDays.length } : null
    };
}

const _SALES_FILES = {
    '1루': { time: '시간대별 분석 현황_1루.xlsx', menu: '메뉴별 매출 순위 집계_1루.xlsx' },
    '3루': { time: '시간대별 분석 현황_3루.xlsx', menu: '메뉴별 매출 순위 집계_3루.xlsx' }
};
let _salesAnalysisCache = { key: null, data: null };

function _mtimeKey() {
    const parts = [];
    for (const store of Object.keys(_SALES_FILES)) {
        for (const k of ['time', 'menu']) {
            const f = path.join(actualDataPath, _SALES_FILES[store][k]);
            parts.push(fs.existsSync(f) ? String(fs.statSync(f).mtimeMs) : '0');
        }
    }
    return parts.join('|');
}

function buildSalesAnalysis() {
    const stores = {};
    let raw = {};
    let anyFile = false;
    for (const store of Object.keys(_SALES_FILES)) {
        const tf = path.join(actualDataPath, _SALES_FILES[store].time);
        const mf = path.join(actualDataPath, _SALES_FILES[store].menu);
        if (!fs.existsSync(tf) || !fs.existsSync(mf)) continue;
        anyFile = true;
        const timeDays = _loadTimeReport(tf);
        const menuItems = _loadMenuReport(mf);
        raw[store] = { timeDays, menuItems };
        stores[store] = _buildStoreAnalysis(timeDays, menuItems);
    }
    if (!anyFile) return { available: false };
    // 합산
    if (raw['1루'] && raw['3루']) {
        const combinedTime = _combineTimeDays(raw['1루'].timeDays, raw['3루'].timeDays);
        const combinedMenu = _combineMenu(raw['1루'].menuItems, raw['3루'].menuItems);
        stores['합산'] = _buildStoreAnalysis(combinedTime, combinedMenu);
    }
    return { available: true, stores, storeOrder: ['합산', '1루', '3루'].filter(s => stores[s]) };
}

app.get('/api/sales-analysis', (req, res) => {
    try {
        const key = _mtimeKey();
        if (_salesAnalysisCache.key !== key) {
            _salesAnalysisCache = { key, data: buildSalesAnalysis() };
        }
        res.json({ success: true, ...(_salesAnalysisCache.data) });
    } catch (e) {
        console.error('sales-analysis error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// POS 리포트 엑셀 업로드 (운영 볼륨에 저장). store=1루|3루, type=time|menu
// 파일 본문은 raw 바이너리로 전송됨 (의존성 없이 처리)
app.post('/api/sales-analysis/upload', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
    try {
        const store = req.query.store;
        const type = req.query.type;
        const actor = req.query.actor || '?';
        if (!_SALES_FILES[store] || !['time', 'menu'].includes(type)) {
            return res.status(400).json({ success: false, error: '잘못된 store/type' });
        }
        const buf = req.body;
        if (!Buffer.isBuffer(buf) || buf.length < 100) {
            return res.status(400).json({ success: false, error: '빈 파일이거나 본문이 없습니다' });
        }
        // xlsx(zip) 시그니처 검증 (PK..)
        if (!(buf[0] === 0x50 && buf[1] === 0x4B)) {
            return res.status(400).json({ success: false, error: 'xlsx 파일이 아닙니다' });
        }
        const targetName = _SALES_FILES[store][type];
        const target = path.join(actualDataPath, targetName);
        fs.writeFileSync(target, buf);
        _salesAnalysisCache = { key: null, data: null }; // 캐시 무효화
        addLog(actor, '매출분석', targetName, '리포트 업로드');
        res.json({ success: true, file: targetName });
    } catch (e) {
        console.error('sales-analysis upload error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
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
    if (!writeJson(INVENTORY_ITEMS_FILE, items)) {
        return res.status(500).json({ success: false, error: '파일 저장 실패' });
    }
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
    if (!writeJson(INVENTORY_USAGE_FILE, usage)) {
        return res.status(500).json({ success: false, error: '파일 저장 실패' });
    }
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

    if (!writeJson(INVENTORY_ORDERS_FILE, orders)) {
        return res.status(500).json({ success: false, error: '발주 저장 실패' });
    }

    // 마지막 발주일 업데이트
    let lastOrders = readJson(INVENTORY_LAST_ORDERS_FILE, {});
    const today = orderRecord.date;
    for (const vendor in orderRecord.orders) {
        orderRecord.orders[vendor].forEach(item => {
            const itemKey = `${vendor}_${item.품목명}`;
            lastOrders[itemKey] = today;
        });
    }
    if (!writeJson(INVENTORY_LAST_ORDERS_FILE, lastOrders)) {
        return res.status(500).json({ success: false, error: '발주일 저장 실패' });
    }

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
    if (!writeJson(INVENTORY_HOLIDAYS_FILE, holidays)) {
        return res.status(500).json({ success: false, error: '파일 저장 실패' });
    }
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

// 카카오 access_token 자동 갱신 (만료 임박/만료 시 refresh_token으로 재발급)
async function refreshKakaoTokens() {
    let tokenList = readJson(KAKAO_TOKEN_FILE, []);
    if (!Array.isArray(tokenList) || tokenList.length === 0) return;
    let changed = false;
    for (const user of tokenList) {
        if (!user.refresh_token) continue;
        // 아직 넉넉히 유효하면 스킵 (발급 후 경과 < 만료 - 10분)
        const issuedAt = new Date(user.updatedAt || user.createdAt || 0).getTime();
        const ttlMs = (user.expires_in || 21600) * 1000;
        if (Date.now() - issuedAt < ttlMs - 10 * 60 * 1000) continue;
        try {
            const resp = await axios.post('https://kauth.kakao.com/oauth/token', null, {
                params: {
                    grant_type: 'refresh_token',
                    client_id: KAKAO_REST_API_KEY,
                    refresh_token: user.refresh_token
                },
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const d = resp.data || {};
            if (d.access_token) { user.access_token = d.access_token; changed = true; }
            if (d.refresh_token) user.refresh_token = d.refresh_token; // 새 refresh_token이 올 때만
            if (d.expires_in) user.expires_in = d.expires_in;
            user.updatedAt = new Date().toISOString();
        } catch (e) {
            console.error('카카오 토큰 갱신 실패:', e.response?.data || e.message);
        }
    }
    if (changed) writeJson(KAKAO_TOKEN_FILE, tokenList);
}

async function sendToKakao(text) {
    await refreshKakaoTokens(); // 보내기 전 토큰 갱신 (만료 시 자동 재발급)
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
    const fixedMisc = (m.internet1||0) + (m.water1||0) + (m.electricity1||0) + (m.cleaning1||0) +
                      (m.operMgmt1||0) + (m.cctv1||0) + (m.bizCard1||0) + (m.cardFee1||0) +
                      (m.loanRepay1||0) + (m.etc_fixed1||0) +
                      (m.insurance1||0) + (m.bizIncomeTax1||0) + (m.taxAccountant1||0) +
                      (m.internet3||0) + (m.water3||0) + (m.electricity3||0) + (m.cleaning3||0) +
                      (m.operMgmt3||0) + (m.cctv3||0) + (m.bizCard3||0) + (m.cardFee3||0) +
                      (m.loanRepay3||0) + (m.etc_fixed3||0) +
                      (m.insurance3||0) + (m.bizIncomeTax3||0) + (m.taxAccountant3||0);

    const staffTotal = calculateServerStaffCost(staffData, monthStr);

    const [yr, mo] = monthStr.split('-').map(Number);
    const lastDay = new Date(yr, mo, 0).getDate();
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

// 분 -> "6시간", "3시간 20분", "40분"
function fmtMinKo(min) {
    min = min || 0;
    const h = Math.floor(min / 60), m = min % 60;
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0) return `${h}시간`;
    return `${m}분`;
}

// 특정 날짜(dateStr "YYYY-MM-DD") 알바 출퇴근 요약 메시지 생성
function getAttendanceDigest(dateStr) {
    const staff = readJson(STAFF_FILE, []);
    const att = readJson(ATTENDANCE_FILE, {});
    const albas = staff.filter(s => s.attToken && !s.deleted);

    // 해당 날짜 기록 모으기 (출근시각 순 정렬)
    const entries = [];
    albas.forEach(s => {
        (att[s.id] || []).filter(r => r.date === dateStr).forEach(r => {
            entries.push({ name: s.name, start: r.start, end: r.end, minutes: r.minutes || 0, note: r.note || '' });
        });
    });
    entries.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(dateStr + 'T00:00:00Z').getUTCDay()];
    const [y, m, d] = dateStr.split('-').map(Number);
    const header = `📋 ${m}월 ${d}일 (${dow}) 통빱 출퇴근현황`;

    let dayPart;
    if (entries.length === 0) {
        dayPart = `${header}\n\n입력된 출퇴근 내역이 없습니다.`;
    } else {
        let totalMin = 0;
        const lines = entries.map(e => {
            totalMin += e.minutes;
            const noteStr = e.note ? ` (${e.note})` : '';
            return `${e.name}: ${e.start}~${e.end} ${fmtMinKo(e.minutes)}${noteStr}`;
        });
        dayPart = `${header}\n\n${lines.join('\n')}\n\n합계 ${entries.length}명 / ${fmtMinKo(totalMin)}`;
    }

    // 이번달(해당 날짜가 속한 달) 알바별 근무 누계 (총시간 많은 순)
    const month = dateStr.slice(0, 7); // "YYYY-MM"
    const monthAgg = [];
    albas.forEach(s => {
        const recs = (att[s.id] || []).filter(r => (r.date || '').startsWith(month));
        if (recs.length === 0) return;
        const tot = recs.reduce((sum, r) => sum + (r.minutes || 0), 0);
        monthAgg.push({ name: s.name, days: recs.length, minutes: tot });
    });
    monthAgg.sort((a, b) => b.minutes - a.minutes);

    let monthPart = '';
    if (monthAgg.length > 0) {
        const mlines = monthAgg.map(a => `${a.name}: ${a.days}일 / ${fmtMinKo(a.minutes)}`);
        monthPart = `\n\n📆 ${m}월 근무 누계\n${mlines.join('\n')}`;
    }

    return dayPart + monthPart;
}

// KST 기준 어제 날짜 "YYYY-MM-DD"
function getKstYesterday() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    kst.setUTCDate(kst.getUTCDate() - 1);
    return kst.toISOString().slice(0, 10);
}

cron.schedule('0 9 * * *', async () => {
    try {
        const today = new Date();
        const msg = getDailyScheduleMessage(today);
        const dateStr = `${today.getMonth()+1}월 ${today.getDate()}일`;
        await sendToTelegram(`📅 [${dateStr} 근무현황]\n\n${msg}`);
    } catch (e) { console.error('텔레그램 근무현황 전송 실패:', e); }
}, { timezone: "Asia/Seoul" });

// 매일 오전 9시: 어제 알바 출퇴근 요약을 카톡 + 텔레그램으로 전송
cron.schedule('0 9 * * *', async () => {
    try {
        const digest = getAttendanceDigest(getKstYesterday());
        await sendToKakao(digest);
        await sendToTelegram(digest);
    } catch (e) { console.error('출퇴근 요약 전송 실패:', e); }
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

async function sendBackupToTelegram(backupData, dateStr) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        const jsonStr = JSON.stringify(backupData);
        const buffer = Buffer.from(jsonStr, 'utf-8');
        const form = new FormData();
        form.append('chat_id', TELEGRAM_CHAT_ID);
        form.append('document', buffer, { filename: `backup_${dateStr}.json`, contentType: 'application/json' });
        form.append('caption', `📦 자동 백업 완료 (${dateStr})\n📊 직원: ${(backupData.staff || []).length}명 | 품목: ${Object.values(backupData.inventory_items || {}).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0)}개`);
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders(),
            maxContentLength: 50 * 1024 * 1024
        });
        console.log('✅ 텔레그램 백업 전송 완료');
    } catch (e) {
        console.error('텔레그램 백업 전송 실패:', e.message);
    }
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

        // 텔레그램으로 백업 파일 전송
        sendBackupToTelegram(backupData, dateStr);

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

// 백업 데이터로 복원
app.post('/api/backup/restore', (req, res) => {
    try {
        const data = req.body;
        if (!data || !data.timestamp) {
            return res.status(400).json({ success: false, message: '유효하지 않은 백업 데이터' });
        }

        // 복원 전 현재 데이터를 안전 백업
        const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const safetyStr = kstDate.toISOString().replace(/[:.]/g, '-');
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const currentData = collectBackupData();
        fs.writeFileSync(path.join(BACKUP_DIR, `pre_restore_${safetyStr}.json`), JSON.stringify(currentData, null, 2));

        // 각 데이터 파일 복원
        const restored = [];
        const fileMap = {
            staff: STAFF_FILE,
            logs: LOG_FILE,
            accounting: ACCOUNTING_FILE,
            inventory_items: INVENTORY_ITEMS_FILE,
            inventory_current: INVENTORY_CURRENT_FILE,
            inventory_usage: INVENTORY_USAGE_FILE,
            inventory_orders: INVENTORY_ORDERS_FILE,
            inventory_holidays: INVENTORY_HOLIDAYS_FILE,
            inventory_last_orders: INVENTORY_LAST_ORDERS_FILE,
            inventory_history: INVENTORY_HISTORY_FILE
        };

        for (const [key, filePath] of Object.entries(fileMap)) {
            if (data[key] !== undefined) {
                writeJson(filePath, data[key]);
                restored.push(key);
            }
        }

        addLog({ actor: req.body._actor || 'admin', action: '데이터복원', target: '전체', details: `백업시점: ${data.timestamp}, 복원항목: ${restored.length}개` });

        res.json({ success: true, message: `${restored.length}개 항목 복원 완료`, restored });
    } catch(e) {
        console.error('복원 실패:', e);
        res.status(500).json({ success: false, message: '복원 실패: ' + e.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});