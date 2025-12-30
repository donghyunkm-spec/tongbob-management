// staff.js - 단일 매장 통합 버전 (직원관리 + 가계부)

// ==========================================
// 1. 전역 변수 및 초기화
// ==========================================
let currentUser = null;
let staffList = [];
let currentDate = new Date();
let calendarDate = new Date();
let currentWeekStartDate = new Date();

// 가계부용 전역 변수
let accountingData = { daily: {}, monthly: {} };
let currentAccDate = new Date().toISOString().split('T')[0];
let currentDashboardDate = new Date(); // 가계부 조회 기준 월

// 매장 이름 (UI 표시용)
const storeNameKr = '통빱';

// 요일 맵핑
const DAY_MAP = { 'Sun':'일', 'Mon':'월', 'Tue':'화', 'Wed':'수', 'Thu':'목', 'Fri':'금', 'Sat':'토' };
const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

document.addEventListener('DOMContentLoaded', () => {
    document.title = `${storeNameKr} 관리자 모드`;
    
    // 테마 적용
    document.body.classList.add('theme-chogazip');

    // 헤더 텍스트 변경
    const titleEl = document.getElementById('pageTitle');
    if(titleEl) {
        titleEl.innerHTML = `🏠 ${storeNameKr} <span style="font-size:0.7em; opacity:0.8;">관리시스템</span>`;
    }

    // 초기 UI 설정
    initStoreSettings();

    // 주간 기준일 초기화
    const today = new Date();
    const day = today.getDay();
    currentWeekStartDate.setDate(today.getDate() - day);
    
    // 초기 데이터 로드
    loadStaffData();

    // 로그인 유지 확인 (localStorage + 3시간 타임아웃)
    const savedUserStr = localStorage.getItem('staffUser');
    
    if (savedUserStr) {
        try {
            const savedUser = JSON.parse(savedUserStr);
            const now = new Date().getTime();
            const threeHours = 3 * 60 * 60 * 1000;

            if (savedUser.loginTime && (now - savedUser.loginTime < threeHours)) {
                currentUser = savedUser;
                onLoginSuccess(currentUser); 
            } else {
                console.log('⌛ 로그인 세션이 만료되었습니다.');
                localStorage.removeItem('staffUser');
                currentUser = null;
                setTimeout(() => openLoginModal(), 500);
            }
        } catch (e) {
            console.error('로그인 정보 파싱 오류', e);
            localStorage.removeItem('staffUser');
            currentUser = null;
            setTimeout(() => openLoginModal(), 500);
        }
    } else {
        setTimeout(() => openLoginModal(), 500);
    } 
    
    // 시간 옵션 초기화
    initTimeOptions();
});

// UI 세팅
function initStoreSettings() {
    const dispDiv = document.getElementById('divDisposable');
    if(dispDiv) dispDiv.style.display = 'none';
    const delivDiv = document.getElementById('divDeliveryFee');
    if(delivDiv) delivDiv.style.display = 'none';
}

// ==========================================
// 2. 탭 전환 및 화면 제어
// ==========================================

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const targetBtn = document.querySelector(`.tabs > button[onclick="switchTab('${tabName}')"]`);
    if(targetBtn) targetBtn.classList.add('active');
    
    const contentId = (tabName === 'attendance') ? 'attendance-content' : `${tabName}-content`;
    const content = document.getElementById(contentId);
    if(content) content.classList.add('active');

    if(tabName === 'attendance') {
        const activeSub = document.querySelector('.att-sub-content.active');
        if(!activeSub || activeSub.id === 'att-daily') renderDailyView();
        else if(activeSub.id === 'att-weekly') renderWeeklyView();
        else if(activeSub.id === 'att-monthly') renderMonthlyView();
        else if(activeSub.id === 'att-manage') renderManageList();
        else if(activeSub.id === 'att-logs') loadLogs();
    }
    
    if(tabName === 'accounting') {
        loadAccountingData();
    } else if(tabName === 'inventory') {
        // [NEW] 재고 탭 초기화 호출 (inventory.js에 있는 함수)
        if(typeof initInventoryTab === 'function') {
            initInventoryTab();
        }
    }
}

function switchAttSubTab(subId, btn) {
    document.querySelectorAll('.att-sub-content').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('active');
    });

    const parentTabs = btn.parentElement;
    parentTabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    const targetDiv = document.getElementById(subId);
    if(targetDiv) {
        targetDiv.style.display = 'block';
        targetDiv.classList.add('active');
    }

    if(subId === 'att-daily') renderDailyView();
    else if(subId === 'att-weekly') renderWeeklyView();
    else if(subId === 'att-monthly') renderMonthlyView();
    else if(subId === 'att-manage') renderManageList();
    else if(subId === 'att-logs') loadLogs();
}

// 상세 항목 차트 렌더링
function renderDetailedCostChart(containerId, stats, salesTotal, totalCost) {
    const el = document.getElementById(containerId);
    if(!el) return;

    const items = [
        { label: '🥩 고기', val: stats.meat, color: '#ef5350' },
        { label: '🥬 삼시세끼', val: stats.food, color: '#8d6e63' },
        { label: '🏠 임대료', val: stats.rent, color: '#ab47bc' },
        { label: '👥 인건비', val: stats.staff, color: '#ba68c8' },
        { label: '💡 관리/공과', val: stats.utility, color: '#5c6bc0' },
        { label: '🍶 주류대출', val: stats.loan, color: '#ff9800' },
        { label: '🍺 주류/음료', val: stats.liquor, color: '#ce93d8' },
        { label: '🛵 배달수수료', val: stats.delivery, color: '#00bcd4' },
        { label: '🎸 기타통합', val: stats.etc, color: '#90a4ae' }
    ].sort((a,b) => b.val - a.val);

    let html = '';
    items.forEach(item => {
        if (item.val > 0) {
            const widthPct = Math.max((item.val / totalCost) * 100, 1);
            const textPct = salesTotal > 0 ? ((item.val / salesTotal) * 100).toFixed(1) : '0.0';
            html += `
            <div class="bar-row">
                <div class="bar-label" style="width:90px;">${item.label}</div>
                <div class="bar-track"><div class="bar-fill" style="width:${widthPct}%; background:${item.color};"></div></div>
                <div class="bar-value" style="width:70px;">${item.val.toLocaleString()} <span style="font-size:10px; color:#999;">(${textPct}%)</span></div>
            </div>`;
        }
    });
    el.innerHTML = html;
}

function switchAccSubTab(subTabId, btnElement) {
    document.querySelectorAll('.acc-sub-content').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('active');
    });
    
    if(btnElement) {
        const siblings = btnElement.parentElement.querySelectorAll('.tab');
        siblings.forEach(btn => btn.classList.remove('active'));
        btnElement.classList.add('active');
    } else {
        const accContent = document.getElementById('accounting-content');
        if(accContent) {
            accContent.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
            const targetBtn = accContent.querySelector(`button[onclick*="${subTabId}"]`);
            if(targetBtn) targetBtn.classList.add('active');
        }
    }

    const targetDiv = document.getElementById(subTabId);
    if(targetDiv) {
        targetDiv.style.display = 'block';
        targetDiv.classList.add('active');
        
        if (subTabId === 'acc-history') loadHistoryTable();
        else if (subTabId === 'acc-prediction') renderPredictionStats();
        else if (subTabId === 'acc-dashboard') renderDashboardStats();
        else if (subTabId === 'acc-monthly') loadMonthlyForm();
        else if (subTabId === 'acc-logs') loadAccountingLogs();
    }
}

// ==========================================
// 3. 로그인 및 권한 관리
// ==========================================
function openLoginModal() {
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginPassword').focus();
}
function closeLoginModal() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
}

async function tryLogin() {
    const pwd = document.getElementById('loginPassword').value;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        
        if (data.success) {
            const sessionData = {
                ...data,
                loginTime: new Date().getTime()
            };
            localStorage.setItem('staffUser', JSON.stringify(sessionData));
            onLoginSuccess(data);
            closeLoginModal();
        } else {
            const err = document.getElementById('loginError');
            if(err) {
                err.style.display = 'block';
                err.textContent = '비밀번호가 일치하지 않습니다.';
            }
        }
    } catch (e) { 
        console.error('로그인 에러:', e);
        alert('로그인 처리 중 오류가 발생했습니다.'); 
    }
}

async function onLoginSuccess(user) {
    currentUser = user;
    
    const loginBtn = document.getElementById('loginBtn');
    if(loginBtn) loginBtn.style.display = 'none';
    
    const userInfoDiv = document.getElementById('userInfo');
    if(userInfoDiv) {
        userInfoDiv.style.display = 'block';
        userInfoDiv.innerHTML = `${user.name} (${user.role === 'admin' ? '사장' : user.role === 'manager' ? '점장' : '직원'})`;
    }

    // 로그인 성공 시 재고관리 탭 표시
    const inventoryTab = document.getElementById('tab-inventory');
    if(inventoryTab) {
        inventoryTab.style.display = 'block'; // 버튼 보이게 설정
    }
    
    // 관리자(사장님) 전용 권한
    if (user.role === 'admin') {
        const bulkSection = document.getElementById('bulkSection');
        if(bulkSection) bulkSection.style.display = 'block';
        
        const salarySection = document.getElementById('salarySection');
        if(salarySection) salarySection.style.display = 'block';
        
        const backupBtn = document.getElementById('adminBackupBtn');
        if(backupBtn) backupBtn.style.display = 'block';
        
        try { await loadLogs(); } catch(e) {}
    }
    
    const activeTab = document.querySelector('.tab-content.active');
    if(activeTab && activeTab.id === 'accounting-content') {
        try { await loadAccountingData(); } catch(e) {}
    }
    try { renderManageList(); } catch(e) {}
}

// ==========================================
// 4. 가계부 (매출/지출/통계) 로직
// ==========================================

function getMonthStr(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function changeAccMonth(delta) {
    currentDashboardDate.setMonth(currentDashboardDate.getMonth() + delta);
    loadAccountingData(); 
}

function resetAccMonth() {
    currentDashboardDate = new Date();
    loadAccountingData();
}

// [수정] currentStore 제거 및 API 호출 단순화
async function loadAccountingData() {
    if (!currentUser) { 
        alert("로그인이 필요합니다.");
        openLoginModal(); 
        switchTab('attendance'); 
        return; 
    }
    
    try {
        const res = await fetch(`/api/accounting`);
        const json = await res.json();
        accountingData = json.data || { daily: {}, monthly: {} };
        if(!accountingData.daily) accountingData.daily = {};
        if(!accountingData.monthly) accountingData.monthly = {};
        updateDashboardUI();
    } catch(e) { console.error('회계 로드 실패', e); }
}

function updateDashboardUI() {
    const monthStr = getMonthStr(currentDashboardDate);
    const [y, m] = monthStr.split('-');
    
    const titleEl = document.getElementById('dashboardTitle');
    if(titleEl) titleEl.textContent = `${y}년 ${m}월`;
    const fixTitle = document.getElementById('fixCostTitle');
    if(fixTitle) fixTitle.textContent = `${m}월`;
    const fixBtn = document.getElementById('fixBtnMonth');
    if(fixBtn) fixBtn.textContent = `${m}월`;

    const activeSubTab = document.querySelector('.acc-sub-content.active');
    
    if (!activeSubTab) { switchAccSubTab('acc-daily'); return; }

    if (activeSubTab.id === 'acc-history') loadHistoryTable();
    else if (activeSubTab.id === 'acc-prediction') renderPredictionStats();
    else if (activeSubTab.id === 'acc-dashboard') renderDashboardStats();
    else if (activeSubTab.id === 'acc-monthly') loadMonthlyForm();
}

// [수정] 일일 데이터 로드 (돈통 정산 삭제, 새 필드 매핑)
function loadDailyAccounting() {
    const datePicker = document.getElementById('accDate').value;
    if (!datePicker) return;

    const dayData = (accountingData.daily && accountingData.daily[datePicker]) ? accountingData.daily[datePicker] : {};
    
    // 매출
    if(document.getElementById('inpCard')) document.getElementById('inpCard').value = dayData.card || '';
    if(document.getElementById('inpCash')) document.getElementById('inpCash').value = dayData.cash || '';
    if(document.getElementById('inpDelivery')) document.getElementById('inpDelivery').value = dayData.delivery || '';
    
    // 참고용 계좌이체
    if(document.getElementById('inpTransfer')) document.getElementById('inpTransfer').value = dayData.transfer || '';

    // 지출 (Food->고센유통)
    document.getElementById('inpFood').value = dayData.food || ''; 
    document.getElementById('inpMeat').value = dayData.meat || ''; 
    document.getElementById('inpEtc').value = dayData.etc || ''; 
    document.getElementById('inpNote').value = dayData.note || '';
}

// [수정] 일일 데이터 저장 (총매출 공식 변경)
async function saveDailyAccounting() {
    if (!currentUser) { alert("로그인이 필요합니다."); openLoginModal(); return; }
    if (!['admin', 'manager'].includes(currentUser.role)) { alert("권한이 없습니다."); return; }

    const dateStr = document.getElementById('accDate').value;
    if (!dateStr) { alert('날짜를 선택해주세요.'); return; }

    // 매출 입력
    const card = parseInt(document.getElementById('inpCard').value) || 0;
    const cash = parseInt(document.getElementById('inpCash').value) || 0;
    const delivery = parseInt(document.getElementById('inpDelivery').value) || 0;
    const transfer = parseInt(document.getElementById('inpTransfer').value) || 0; // 참고용

    // 지출 입력
    const food = parseInt(document.getElementById('inpFood').value) || 0; // 고센유통
    const meat = parseInt(document.getElementById('inpMeat').value) || 0; // 고기(유지)
    const etc = parseInt(document.getElementById('inpEtc').value) || 0;   // 기타
    const note = document.getElementById('inpNote').value || '';

    // [중요] 실제 매출 합산 (카드 + 현금 + 배달)
    const totalSales = card + cash + delivery;
    const totalCost = food + meat + etc;

    if (totalSales === 0 && totalCost === 0) {
        if(!confirm(`${dateStr} 입력된 금액이 0원입니다. 저장하시겠습니까?`)) return;
    }

    const data = {
        card, cash, delivery, transfer, 
        sales: totalSales, 
        food, meat, etc, cost: totalCost, 
        note
    };

    try {
        await fetch('/api/accounting/daily', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ date: dateStr, data: data, actor: currentUser.name })
        });
        
        if(!accountingData.daily) accountingData.daily = {};
        accountingData.daily[dateStr] = data;
        alert('저장되었습니다.');
        switchAccSubTab('acc-history');
    } catch(e) { 
        alert('저장 실패: 서버 오류'); 
    }
}

function applyHistoryFilter() {
    const filterKey = document.getElementById('historyFilterSelect').value;
    loadHistoryTable(filterKey);
}

function loadHistoryTable(filterKey = 'all') {
    const monthStr = getMonthStr(currentDashboardDate); 
    const tbody = document.getElementById('historyTableBody');
    const summaryDiv = document.getElementById('filterResultSummary');
    
    if(!tbody) return;
    tbody.innerHTML = '';
    
    let filteredSum = 0;
    let filteredCount = 0;
    
    const labelMap = {
        'card': '💳 카드', 'cash': '💵 현금', 'delivery': '🛵 배달',
        'sales': '💰 총매출',
        'food': '🥬 고센', 'meat': '🥩 고기', 'etc': '🍦 잡비'
    };

    const rows = []; 

    // 1) 일일 데이터 처리
    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (!date.startsWith(monthStr)) return; 
            
            const d = accountingData.daily[date];
            
            // 필터링
            let valToCheck = 0;
            if (filterKey === 'sales') valToCheck = d.sales;
            else if (filterKey !== 'all') valToCheck = d[filterKey];

            if (filterKey !== 'all') {
                if (!valToCheck) return;
                filteredSum += valToCheck;
                filteredCount++;
            }

            const totalSales = (d.sales||0);
            const totalCost = (d.cost||0);
            
            let details = [];
            
            if (filterKey !== 'all') {
                const label = labelMap[filterKey] || filterKey;
                details.push(`<span style="background:#fff9c4; font-weight:bold;">${label}: ${valToCheck.toLocaleString()}</span>`);
            } else {
                if(d.card) details.push(`💳${d.card.toLocaleString()}`);
                if(d.cash) details.push(`💵${d.cash.toLocaleString()}`);
                if(d.delivery) details.push(`🛵${d.delivery.toLocaleString()}`);
                if(d.transfer) details.push(`(이체:${d.transfer.toLocaleString()})`);
                
                if(d.food) details.push(`고센:${d.food.toLocaleString()}`);
                if(d.etc) details.push(`잡비:${d.etc.toLocaleString()}`);
            }

            if(d.note) details.push(`📝${d.note}`);

            rows.push({
                date: date, dayStr: `${date.substring(8)}일`,
                sales: totalSales, cost: totalCost,
                desc: details.join(' / '), type: 'daily'
            });
        });
    }

    // 2) [수정됨] 월말 고정비 처리 (변수명 업데이트)
    if (filterKey === 'all' && accountingData.monthly && accountingData.monthly[monthStr]) {
        const m = accountingData.monthly[monthStr];
        
        // *수정 포인트: 새로운 고정비 항목들로 합산 로직 변경*
        // 수수료, 배달비, 카드비 등 모든 고정비 항목 합산
        const fixedTotal = (m.commission||0) + (m.deliveryFee||0) + (m.cardFee||0) + 
                           (m.internet||0) + (m.water||0) + (m.cleaning||0) + 
                           (m.operMgmt||0) + (m.cctv||0) + (m.etc_fixed||0);
        
        if (fixedTotal > 0) {
            rows.push({
                date: `${monthStr}-99`, dayStr: `월말 고정`, 
                sales: 0, cost: fixedTotal,
                desc: `<span style="color:#00796b; font-weight:bold;">[고정비/수수료 합계]</span>`,
                type: 'fixed'
            });
        }
    }

    if (rows.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">내역이 없습니다.</td></tr>'; 
        if(summaryDiv) summaryDiv.style.display = 'none';
        return; 
    }

    if (filterKey !== 'all' && summaryDiv) {
        summaryDiv.style.display = 'block';
        const label = labelMap[filterKey] || filterKey;
        summaryDiv.innerHTML = `✅ ${label} 합계: ${filteredSum.toLocaleString()}원 (${filteredCount}건)`;
    } else if (summaryDiv) summaryDiv.style.display = 'none';

    rows.sort((a,b) => b.date.localeCompare(a.date));

    rows.forEach(r => {
        // 고정비는 수정 버튼 숨김 (고정비 탭에서 수정하라고 유도)
        const btn = r.type === 'fixed' ? '' : `<button onclick="editHistoryDate('${r.date}')" style="background:#607d8b; color:white; border:none; border-radius:3px; font-size:11px; padding:4px 8px;">수정</button>`;
        tbody.innerHTML += `
            <tr style="border-bottom:1px solid #eee; background:${r.type === 'fixed' ? '#e0f2f1' : 'white'};">
                <td><strong>${r.dayStr}</strong></td>
                <td style="color:#1976D2; text-align:right;">${r.sales.toLocaleString()}</td>
                <td style="color:#d32f2f; text-align:right;">${r.cost.toLocaleString()}</td>
                <td style="font-size:12px; color:#555;">${r.desc}</td>
                <td style="text-align:center;">${btn}</td>
            </tr>`;
    });
}

function editHistoryDate(date) {
    if (!currentUser || !['admin', 'manager'].includes(currentUser.role)) { alert("수정 권한이 없습니다"); return; }
    document.getElementById('accDate').value = date;
    loadDailyAccounting();
    switchAccSubTab('acc-daily');
    alert(`${date} 데이터를 불러왔습니다.\n수정 후 [저장하기]를 눌러주세요.`);
}

// [수정] 고정비 로드 (자동 계산 로직 추가)
function loadMonthlyForm() {
    const monthStr = getMonthStr(currentDashboardDate);
    const mData = (accountingData.monthly && accountingData.monthly[monthStr]) ? accountingData.monthly[monthStr] : {};

    const setVal = (id, val) => { if(document.getElementById(id)) document.getElementById(id).value = val || ''; };

    // 1. 수기 입력 항목 불러오기
    setVal('fixInternet', mData.internet);
    setVal('fixWater', mData.water);
    setVal('fixCleaning', mData.cleaning);
    setVal('fixOperMgmt', mData.operMgmt);
    setVal('fixCCTV', mData.cctv);
    setVal('fixEtc', mData.etc_fixed);
    setVal('fixNote', mData.note);

    // 2. [NEW] 수수료 항목 자동 계산 (일일 데이터 합산)
    let totalSales = 0;
    let deliverySales = 0;
    let cardSales = 0;

    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                const d = accountingData.daily[date];
                totalSales += (d.sales || 0);
                deliverySales += (d.delivery || 0);
                cardSales += (d.card || 0);
            }
        });
    }

    // 계산식 적용
    const autoCommission = Math.floor(totalSales * 0.30);
    const autoDeliveryFee = Math.floor(deliverySales * 0.0495);
    const autoCardFee = Math.floor(cardSales * 0.016);

    // UI에 적용 (비활성화 상태여도 값은 보임)
    setVal('fixCommission', autoCommission);
    setVal('fixDeliveryFee', autoDeliveryFee);
    setVal('fixCardFee', autoCardFee);
}

// [수정] 고정비 저장 (PUT 메서드 사용)
async function saveFixedCost() {
    if (!currentUser) { openLoginModal(); return; }
    if (!['admin', 'manager'].includes(currentUser.role)) { alert("권한이 없습니다."); return; }

    const monthStr = getMonthStr(currentDashboardDate);
    
    const getVal = (id) => parseInt(document.getElementById(id).value) || 0;
    
    // 자동계산 필드는 화면에 있는 값을 그대로 전송 (서버에서도 재계산하지만 확인용)
    const data = {
        commission: getVal('fixCommission'),
        deliveryFee: getVal('fixDeliveryFee'),
        cardFee: getVal('fixCardFee'),
        
        internet: getVal('fixInternet'),
        water: getVal('fixWater'),
        cleaning: getVal('fixCleaning'),
        operMgmt: getVal('fixOperMgmt'),
        cctv: getVal('fixCCTV'),
        etc_fixed: getVal('fixEtc'),
        note: document.getElementById('fixNote').value
    };

    // 저장 실패 원인이었던 POST -> PUT 변경
    try {
        const res = await fetch('/api/accounting/monthly', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ month: monthStr, data: data, actor: currentUser.name })
        });
        
        if (res.ok) {
            if(!accountingData.monthly) accountingData.monthly = {};
            accountingData.monthly[monthStr] = data;
            alert('저장되었습니다.');
            updateDashboardUI();
        } else {
            alert('저장 실패 (서버 오류)');
        }
    } catch(e) { 
        console.error(e);
        alert('저장 실패 (네트워크 오류)'); 
    }
}

// 분석 HTML 생성
function generateDetailAnalysisHtml(totalSales, varCost, deliverySales, alcSales, bevSales, alcCost, bevCost, delivCost) {
    let html = `<h4 style="color:#00796b; margin-bottom:10px; border-top:1px solid #eee; padding-top:15px;">🕵️ 유형별 원가 분석 (마진율)</h4>`;
    html += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">`;

    const alcRatio = alcSales > 0 ? ((alcCost / alcSales) * 100).toFixed(1) : '0.0';
    html += createAnalysisCard('🍺 주류 마진', 
        `주류매출: ${alcSales.toLocaleString()}`, 
        `주류매입: ${alcCost.toLocaleString()}`, 
        `원가율: <strong>${alcRatio}%</strong>`, '#fff3e0');

    const bevRatio = bevSales > 0 ? ((bevCost / bevSales) * 100).toFixed(1) : '0.0';
    html += createAnalysisCard('🥤 음료 마진', 
        `음료매출: ${bevSales.toLocaleString()}`, 
        `음료매입: ${bevCost.toLocaleString()}`, 
        `원가율: <strong>${bevRatio}%</strong>`, '#f3e5f5');

    const foodSales = Math.max(0, totalSales - alcSales - bevSales);
    const foodCost = varCost; 
    const foodRatio = foodSales > 0 ? ((foodCost / foodSales) * 100).toFixed(1) : '0.0';
    
    html += createAnalysisCard('🍳 식자재(안주) 효율', 
        `순수 음식매출: ${foodSales.toLocaleString()}`, 
        `식자재비: ${foodCost.toLocaleString()}`, 
        `원가율: <strong style="color:#d32f2f; font-size:15px;">${foodRatio}%</strong>`, '#e8f5e9');

    html += `</div>`;
    return html;
}

function createAnalysisCard(title, row1, row2, row3, bg) {
    return `
    <div style="background:${bg}; padding:10px; border-radius:8px; font-size:12px; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
        <div style="font-weight:bold; margin-bottom:5px; color:#455a64; border-bottom:1px dashed rgba(0,0,0,0.1); padding-bottom:3px;">${title}</div>
        <div style="color:#555;">${row1}</div>
        <div style="color:#555;">${row2}</div>
        <div style="margin-top:5px; font-size:13px; color:#333; text-align:right;">${row3}</div>
    </div>`;
}

// 예상 순익
function renderPredictionStats() {
    const today = new Date();
    const currentYear = currentDashboardDate.getFullYear();
    const currentMonth = currentDashboardDate.getMonth() + 1;
    const monthStr = getMonthStr(currentDashboardDate);

    // 날짜 비율 계산
    const lastDayOfThisMonth = new Date(currentYear, currentMonth, 0).getDate();
    let appliedDay = lastDayOfThisMonth;
    let ratio = 1.0;

    if (today.getFullYear() === currentYear && (today.getMonth() + 1) === currentMonth) {
        appliedDay = today.getDate();
        ratio = appliedDay / lastDayOfThisMonth;
    } else if (new Date(currentYear, currentMonth - 1, 1) > today) {
        appliedDay = 0; ratio = 0;
    }

    const ratioText = `${appliedDay}/${lastDayOfThisMonth}`;
    if(document.getElementById('predDateRatio')) document.getElementById('predDateRatio').textContent = ratioText;
    if(document.getElementById('predCostText')) document.getElementById('predCostText').textContent = `${ratioText}일치`;

    const mData = (accountingData.monthly && accountingData.monthly[monthStr]) ? accountingData.monthly[monthStr] : {};
    
    // 1. 일일 매출 및 변동비 집계
    let salesTotal = 0;
    let variableCostTotal = 0;
    
    // *수정: 수수료 계산을 위한 상세 매출 합계*
    let deliverySalesTotal = 0; 
    let cardSalesTotal = 0;

    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                const d = accountingData.daily[date];
                salesTotal += (d.sales || 0);
                variableCostTotal += (d.cost || 0);
                
                // 수수료 계산용
                deliverySalesTotal += (d.delivery || 0); 
                cardSalesTotal += (d.card || 0);
            }
        });
    }

    // 2. 비용 계산 분리
    
    // A. 매출 연동 수수료 (이미 발생한 매출에 대한 것이므로 비율 적용 X -> 100% 반영)
    const currCommission = Math.floor(salesTotal * 0.30);       // 총매출 30%
    const currDeliveryFee = Math.floor(deliverySalesTotal * 0.0495); // 배달매출 4.95%
    const currCardFee = Math.floor(cardSalesTotal * 0.016);      // 카드매출 1.6%
    
    const salesBasedCost = currCommission + currDeliveryFee + currCardFee;

    // B. 시간 연동 고정비 (날짜 비율 적용 O)
    const fixedMisc = (mData.internet||0) + (mData.water||0) + (mData.cleaning||0) + 
                      (mData.operMgmt||0) + (mData.cctv||0) + (mData.etc_fixed||0);
    
    const estimatedStaffCost = getEstimatedStaffCost(monthStr); // 인건비
    
    const timeBasedCostFull = fixedMisc + estimatedStaffCost;
    const timeBasedCostApplied = Math.floor(timeBasedCostFull * ratio); 

    // 3. 최종 합산
    const totalCurrentCost = variableCostTotal + salesBasedCost + timeBasedCostApplied;
    const netProfit = salesTotal - totalCurrentCost;
    const margin = salesTotal > 0 ? ((netProfit / salesTotal) * 100).toFixed(1) : 0;

    // UI 업데이트
    document.getElementById('predTotalSales').textContent = salesTotal.toLocaleString() + '원';
    document.getElementById('predTotalCost').textContent = totalCurrentCost.toLocaleString() + '원';
    
    const profitEl = document.getElementById('predNetProfit');
    profitEl.textContent = netProfit.toLocaleString() + '원';
    profitEl.style.color = netProfit >= 0 ? '#fff' : '#ffab91';
    document.getElementById('predMargin').textContent = `보정 마진율: ${margin}%`;

    // 상세 바 차트 렌더링 (파라미터 변경됨)
    // ratio: 시간연동비용에만 적용하기 위해 전달, salesBasedCost는 별도 전달
    renderCostList('predCostList', mData, estimatedStaffCost, ratio, salesTotal, totalCurrentCost, monthStr, {
        commission: currCommission,
        deliveryFee: currDeliveryFee,
        cardFee: currCardFee,
        fixedMisc: fixedMisc
    });
}

// 월간 분석
function renderDashboardStats() {
    const monthStr = getMonthStr(currentDashboardDate);
    const mData = (accountingData.monthly && accountingData.monthly[monthStr]) ? accountingData.monthly[monthStr] : {};
    
    let sales = { card:0, cash:0, delivery:0, total:0 };
    let variableCostTotal = 0; 

    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                const d = accountingData.daily[date];
                sales.card += (d.card||0); 
                sales.cash += (d.cash||0);
                sales.delivery += (d.delivery||0);
                sales.total += (d.sales||0); // 총매출 필드 사용
                
                variableCostTotal += (d.cost || 0); // 식자재 등
            }
        });
    }

    const staffCost = getEstimatedStaffCost(monthStr);

    // *수정: 고정비 합산 (새 변수명 적용)*
    const fixedTotal = (mData.commission||0) + (mData.deliveryFee||0) + (mData.cardFee||0) + 
                       (mData.internet||0) + (mData.water||0) + (mData.cleaning||0) + 
                       (mData.operMgmt||0) + (mData.cctv||0) + (mData.etc_fixed||0) + 
                       staffCost;

    const totalCost = fixedTotal + variableCostTotal;
    const netProfit = sales.total - totalCost;
    const margin = sales.total > 0 ? ((netProfit / sales.total) * 100).toFixed(1) : 0;

    document.getElementById('dashTotalSales').textContent = sales.total.toLocaleString() + '원';
    document.getElementById('dashTotalCost').textContent = totalCost.toLocaleString() + '원';
    
    const profitEl = document.getElementById('dashNetProfit');
    profitEl.textContent = netProfit.toLocaleString() + '원';
    profitEl.style.color = netProfit >= 0 ? '#fff' : '#ffab91'; 
    document.getElementById('dashMargin').textContent = `순이익률: ${margin}%`;
    
    // 인건비 항목이 없어서 추가하거나 기존 요소 활용
    if(document.getElementById('dashStaffCost')) document.getElementById('dashStaffCost').textContent = staffCost.toLocaleString();

    renderDashboardCharts(sales, totalCost, mData, staffCost, variableCostTotal, monthStr);
}

// [수정] 예상 순익 (Prediction) 및 월간 분석 차트 (Cost List)
function renderCostList(containerId, mData, staffCost, ratio, salesTotal, totalCost, monthStr, calculatedCosts = null) {
    const el = document.getElementById(containerId);
    if(!el) return;
    
    if(totalCost === 0) { el.innerHTML = '<div style="text-align:center; padding:10px; color:#999;">데이터 없음</div>'; return; }

    let cFood = 0, cMeat = 0, cEtc = 0;
    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                cFood += (accountingData.daily[date].food||0);
                cMeat += (accountingData.daily[date].meat||0);
                cEtc += (accountingData.daily[date].etc||0);
            }
        });
    }

    let fCommission, fDelivery, fCardFee, fMisc;

    // A. 예상순익 탭에서 호출된 경우 (이미 계산된 값 사용)
    if (calculatedCosts) {
        fCommission = calculatedCosts.commission;
        fDelivery = calculatedCosts.deliveryFee;
        fCardFee = calculatedCosts.cardFee;
        // 시간비례 고정비
        fMisc = Math.floor(calculatedCosts.fixedMisc * ratio);
    } 
    // B. 월간분석 탭에서 호출된 경우 (저장된 값 사용)
    else {
        fCommission = mData.commission || 0;
        fDelivery = mData.deliveryFee || 0;
        fCardFee = mData.cardFee || 0;
        
        const fixedMiscSum = (mData.internet||0) + (mData.water||0) + (mData.cleaning||0) + 
                             (mData.operMgmt||0) + (mData.cctv||0) + (mData.etc_fixed||0);
        fMisc = fixedMiscSum; // 월간분석은 전체이므로 ratio 1.0 (호출시 1.0으로 옴)
    }

    const fStaff = Math.floor(staffCost * ratio);

    const items = [
        { label: '🏠 수수료(30%)', val: fCommission, color: '#ab47bc' },
        { label: '🛵 배달수수료', val: fDelivery, color: '#00bcd4' },
        { label: '🥬 고센유통', val: cFood, color: '#8d6e63' },
        { label: '🥩 고기', val: cMeat, color: '#ef5350' },
        { label: '👥 인건비', val: fStaff, color: '#ba68c8' },
        { label: '💳 카드수수료', val: fCardFee, color: '#9575cd' },
        { label: '🔧 관리/기타', val: fMisc + cEtc, color: '#90a4ae' }
    ].sort((a,b) => b.val - a.val);

    let html = '';
    items.forEach(item => {
        if (item.val > 0) {
            const widthPct = Math.max((item.val / totalCost) * 100, 1);
            const textPct = salesTotal > 0 ? ((item.val / salesTotal) * 100).toFixed(1) : '0.0';
            html += `
            <div class="bar-row">
                <div class="bar-label">${item.label}</div>
                <div class="bar-track"><div class="bar-fill" style="width:${widthPct}%; background:${item.color};"></div></div>
                <div class="bar-value">${item.val.toLocaleString()} <span style="font-size:11px; color:#999;">(${textPct}%)</span></div>
            </div>`;
        }
    });
    el.innerHTML = html;
}

function renderDashboardCharts(sales, totalCost, mData, staffCost, variableCostTotal, monthStr) {
    const chartEl = document.getElementById('salesBreakdownChart');
    if(chartEl) {
        if(sales.total === 0) chartEl.innerHTML = '<div style="text-align:center; color:#999;">데이터 없음</div>';
        else {
            const renderBar = (l, v, c) => v > 0 ? `<div class="bar-row"><div class="bar-label">${l}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max((v/sales.total)*100,1)}%; background:${c};"></div></div><div class="bar-value">${v.toLocaleString()}</div></div>` : '';
                chartEl.innerHTML = `
                    ${renderBar('💳 카드', sales.card, '#42a5f5')}
                    ${renderBar('💵 현금', sales.cash, '#66bb6a')}
                    ${renderBar('🛵 배달', sales.delivery, '#ffa726')}`;
        }
    }
    // 월간 분석에서는 ratio 1.0, calculatedCosts 없음(null)으로 호출
    renderCostList('costBreakdownList', mData, staffCost, 1.0, sales.total, totalCost, monthStr, null);
}

// ==========================================
// 5. 직원 관리 (조회/등록/수정/삭제)
// ==========================================

async function loadStaffData() {
    try {
        const res = await fetch(`/api/staff`);
        const json = await res.json();
        staffList = json.data;
        
        renderDailyView();
        renderWeeklyView();
        renderMonthlyView();
        renderManageList();
        
    } catch(e) { console.error("데이터 로드 실패"); }
}

function renderManageList() {
    const list = document.getElementById('manageStaffList');
    if(!list) return;
    list.innerHTML = '';
    
    const isAdmin = currentUser && currentUser.role === 'admin';

    staffList.forEach(s => {
        const daysStr = s.workDays.map(d => DAY_MAP[d]).join(',');
        const salaryInfo = isAdmin ? 
            `<div style="font-size:12px; color:#28a745; margin-top:3px;">
                💰 ${s.salaryType === 'monthly' ? '월급' : '시급'}: ${s.salary ? s.salary.toLocaleString() : '0'}원
             </div>` : '';

        list.innerHTML += `
            <div class="reservation-item">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="font-size:16px;">${s.name}</strong> 
                        <span style="font-size:12px; color:#666;">(${s.time})</span>
                        <div style="font-size:13px; margin-top:5px;">📅 ${daysStr}</div>
                        ${salaryInfo}
                    </div>
                    <div>
                        <button class="edit-btn" onclick="openEditModal(${s.id})">수정</button>
                        <button class="delete-btn" onclick="deleteStaff(${s.id})">삭제</button>
                    </div>
                </div>
            </div>`;
    });
}

function openEditModal(id) {
    if (!currentUser) { openLoginModal(); return; }
    const target = staffList.find(s => s.id === id);
    if (!target) return;

    document.getElementById('editId').value = target.id;
    document.getElementById('editName').value = target.name;
    document.getElementById('editTime').value = target.time;
    
    document.getElementById('editStartDate').value = target.startDate || '';
    document.getElementById('editEndDate').value = target.endDate || '';
    
    const isAdmin = currentUser.role === 'admin';
    const salarySection = document.getElementById('modalSalarySection');
    if (isAdmin) {
        salarySection.style.display = 'block';
        document.getElementById('editSalaryType').value = target.salaryType || 'hourly';
        document.getElementById('editSalary').value = target.salary || 0;
    } else {
        salarySection.style.display = 'none';
    }
    document.getElementById('editModalOverlay').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editModalOverlay').style.display = 'none';
}

async function saveStaffEdit() {
    const id = parseInt(document.getElementById('editId').value);
    const time = document.getElementById('editTime').value;
    
    const startDate = document.getElementById('editStartDate').value || null;
    const endDate = document.getElementById('editEndDate').value || null;

    const salaryType = document.getElementById('editSalaryType').value;
    const salary = parseInt(document.getElementById('editSalary').value) || 0;

    const updates = { time, startDate, endDate };
    
    if (currentUser && currentUser.role === 'admin') {
        updates.salaryType = salaryType;
        updates.salary = salary;
    }

    try {
        await fetch(`/api/staff/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ updates: updates, actor: currentUser.name })
        });
        closeEditModal();
        loadStaffData();
        if(currentUser.role === 'admin') loadLogs();
    } catch(e) { alert('수정 실패'); }
}

async function deleteStaff(id) {
    if (!currentUser) { openLoginModal(); return; }
    if (!confirm('삭제하시겠습니까?')) return;
    await fetch(`/api/staff/${id}?actor=${encodeURIComponent(currentUser.name)}`, { method: 'DELETE' });
    loadStaffData();
    if(currentUser.role === 'admin') loadLogs();
}

async function processBulkText() {
    const text = document.getElementById('bulkText').value;
    if (!text.trim()) return;

    const lines = text.split('\n');
    const payload = [];
    
    lines.forEach((line) => {
       let parts = line.split(',').map(p => p.trim());
       if (parts.length < 3) parts = line.split(/\s+/);
       if(parts.length >= 3) {
           const name = parts[0];
           const dayStr = parts[1];
           let timeStr = parts[2];
           const workDays = [];
            for (let [eng, kor] of Object.entries(DAY_MAP)) {
                if (dayStr.includes(kor)) workDays.push(eng);
            }
           timeStr = timeStr.replace('시', '').replace(' ', '');
            if (timeStr.includes('~')) {
                const [start, end] = timeStr.split('~');
                const cleanStart = start.includes(':') ? start : start + ':00';
                const cleanEnd = end.includes(':') ? end : end + ':00';
                timeStr = `${cleanStart}~${cleanEnd}`;
            }
           if (name && workDays.length > 0) payload.push({ name, time: timeStr, workDays, position: '직원', salaryType:'hourly', salary:0 });
       }
    });

    if (payload.length > 0) {
        if(confirm(`${payload.length}명 등록하시겠습니까?`)) {
            try {
                const res = await fetch('/api/staff', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ staffList: payload, actor: currentUser.name })
                });
                const json = await res.json();
                if (json.success) {
                    alert('등록 완료!');
                    loadStaffData();
                    document.getElementById('bulkText').value = '';
                } else alert('실패');
            } catch (e) { alert('오류'); }
        }
    }
}

// ==========================================
// 6. 근무표 뷰 렌더링 (일별/주간/월별)
// ==========================================

function getStartTimeValue(timeStr) {
    if (!timeStr) return 99999;
    let start = timeStr.split('~')[0].trim().replace('시', '').replace(' ', '');
    if (!start.includes(':')) start += ':00';
    const [h, m] = start.split(':').map(Number);
    return (h * 60) + (m || 0);
}

function calculateDuration(timeStr) {
    if (!timeStr || !timeStr.includes('~')) return 0;
    const parts = timeStr.split('~');
    const [sh, sm] = parts[0].trim().split(':').map(Number);
    const [eh, em] = parts[1].trim().split(':').map(Number);
    
    const startMin = sh * 60 + (sm || 0);
    let endMin = eh * 60 + (em || 0);
    if (endMin < startMin) endMin += 24 * 60;
    return (endMin - startMin) / 60;
}

function renderDailyView() {
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayKey = dayMap[currentDate.getDay()];
    
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const dateDisplay = document.getElementById('currentDateDisplay');
    if(dateDisplay) dateDisplay.textContent = `${month}월 ${day}일 (${DAY_MAP[todayKey]})`;
    
    const container = document.getElementById('dailyStaffList');
    if(!container) return;
    container.innerHTML = '';

    let dailyWorkers = [];
    
    staffList.forEach(staff => {
        let isWorking = false;
        let workTime = staff.time;
        let isException = false;
        let isOff = false;

        if (staff.exceptions && staff.exceptions[dateStr]) {
            const ex = staff.exceptions[dateStr];
            if (ex.type === 'work') { 
                isWorking = true; workTime = ex.time; isException = true; 
            } else if (ex.type === 'off') {
                isWorking = true; 
                isException = true;
                isOff = true;
            }
        } else {
            if (staff.workDays.includes(todayKey)) {
                isWorking = true;
            }
        }
        
        if (isWorking) {
            dailyWorkers.push({ ...staff, displayTime: workTime, isException, isOff });
        }
    });

    const realWorkCount = dailyWorkers.filter(w => !w.isOff).length;
    
    const badge = document.getElementById('dailyCountBadge');
    if(badge) {
        badge.style.background = '#ff5722'; 
        
        if (realWorkCount >= 8) {
            badge.style.background = '#d32f2f';
            badge.innerHTML = `총 ${realWorkCount}명 근무<br><span style="font-size:11px; background:white; color:#d32f2f; padding:2px 5px; border-radius:4px; margin-top:4px; display:inline-block;">⚠️ 인원 과다 (비용 확인)</span>`;
        } else if (realWorkCount > 0 && realWorkCount <= 6) {
            badge.style.background = '#e65100'; 
            badge.innerHTML = `총 ${realWorkCount}명 근무<br><span style="font-size:11px; background:white; color:#e65100; padding:2px 5px; border-radius:4px; margin-top:4px; display:inline-block;">⚠️ 인원 부족? (확인)</span>`;
        } else {
            badge.textContent = `총 ${realWorkCount}명 근무`;
        }
    }
    
    dailyWorkers.sort((a,b) => {
        if(a.isOff && !b.isOff) return 1;
        if(!a.isOff && b.isOff) return -1;
        return getStartTimeValue(a.displayTime) - getStartTimeValue(b.displayTime);
    });

    if (dailyWorkers.length === 0) {
        container.innerHTML = '<div class="empty-state">근무자가 없습니다.</div>';
    } else {
        dailyWorkers.forEach(s => {
            let rowClass = s.isOff ? 'reservation-item temp-off-row' : 'reservation-item';
            let statusBadge = '';
            
            if (s.isOff) statusBadge = '<span class="badge" style="background:#9e9e9e; color:white;">⛔ 임시휴무</span>';
            else if (s.isException) statusBadge = '<span class="badge alternative-badge">변동</span>';

            let adminButtons = '';
            if (s.isOff) {
                adminButtons = `
                <div style="margin-top:5px; border-top:1px dashed #ccc; padding-top:5px; text-align:right;">
                     <button onclick="cancelException(${s.id}, '${dateStr}')" style="font-size:11px; padding:3px 6px; background:#666; color:white; border:none; border-radius:3px; cursor:pointer;">↩️ 휴무 취소 (근무복구)</button>
                </div>`;
            } else {
                adminButtons = `
                <div style="margin-top:5px; border-top:1px dashed #eee; padding-top:5px; text-align:right;">
                    <button onclick="openTimeChangeModal(${s.id}, '${dateStr}', '${s.displayTime}')" style="font-size:11px; padding:3px 6px; background:#17a2b8; color:white; border:none; border-radius:3px; cursor:pointer; margin-right:5px;">⏰ 시간변경</button>
                    <button onclick="setDailyException(${s.id}, '${dateStr}', 'off')" style="font-size:11px; padding:3px 6px; background:#dc3545; color:white; border:none; border-radius:3px; cursor:pointer;">⛔ 오늘휴무</button>
                </div>`;
            }

            container.innerHTML += `
                <div class="${rowClass}" style="border-left:5px solid ${s.isOff ? '#999' : '#4CAF50'};">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div>
                            <strong>${s.name}</strong> ${statusBadge}
                            <div class="reservation-time" style="font-size:14px; color:${s.isOff ? '#999' : '#0066cc'}; font-weight:bold; margin-top:2px;">
                                ${s.isOff ? '휴무' : s.displayTime}
                            </div>
                            <div style="font-size:12px; color:#666;">${s.position || '직원'}</div>
                        </div>
                    </div>
                    ${adminButtons}
                </div>`;
        });
    }
}

function changeDate(d) { currentDate.setDate(currentDate.getDate() + d); renderDailyView(); }
function resetToToday() { currentDate = new Date(); renderDailyView(); }

function renderWeeklyView() {
    const startWeek = new Date(currentWeekStartDate);
    const endWeek = new Date(currentWeekStartDate);
    endWeek.setDate(endWeek.getDate() + 6);
    
    const rangeDisplay = document.getElementById('weeklyRangeDisplay');
    if(rangeDisplay) rangeDisplay.textContent = `${startWeek.getMonth()+1}월 ${startWeek.getDate()}일 ~ ${endWeek.getMonth()+1}월 ${endWeek.getDate()}일`;

    const realToday = new Date(); 

    DAY_KEYS.forEach((k, index) => {
        const headerDate = new Date(currentWeekStartDate);
        headerDate.setDate(headerDate.getDate() + index);
        const headerEl = document.getElementById(`header-${k}`);
        if (headerEl) {
            const month = headerDate.getMonth() + 1;
            const day = headerDate.getDate();
            headerEl.innerHTML = `${month}/${day}<br>${DAY_MAP[k]}`;
        }
    });
    
    DAY_KEYS.forEach(k => {
        const col = document.getElementById(`col-${k}`);
        if(col) { col.innerHTML = ''; col.classList.remove('today-highlight'); }
    });

    for (let i = 0; i < 7; i++) {
        const loopDate = new Date(currentWeekStartDate);
        loopDate.setDate(loopDate.getDate() + i);
        
        const year = loopDate.getFullYear();
        const month = String(loopDate.getMonth() + 1).padStart(2, '0');
        const day = String(loopDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const dayKey = DAY_KEYS[i]; 

        if (loopDate.getDate() === realToday.getDate() && 
            loopDate.getMonth() === realToday.getMonth() && 
            loopDate.getFullYear() === realToday.getFullYear()) {
            const col = document.getElementById(`col-${dayKey}`);
            if(col) col.classList.add('today-highlight');
        }

        let dayWorkers = [];
        staffList.forEach(s => {
            let isWorking = false;
            let workTime = s.time;
            let isException = false;
            let isOff = false;

            if (s.exceptions && s.exceptions[dateStr]) {
                const ex = s.exceptions[dateStr];
                if (ex.type === 'work') { isWorking = true; workTime = ex.time; isException = true; }
                else if (ex.type === 'off') { isWorking = true; isOff = true; }
            } else {
                if (s.workDays.includes(dayKey)) isWorking = true;
            }
            if (isWorking) dayWorkers.push({ staff: s, time: workTime, isException, isOff });
        });

        dayWorkers.sort((a,b) => {
             if(a.isOff && !b.isOff) return 1;
             if(!a.isOff && b.isOff) return -1;
             return getStartTimeValue(a.time) - getStartTimeValue(b.time)
        });

        const col = document.getElementById(`col-${dayKey}`);
        if(col) {
            dayWorkers.forEach(w => {
                let cardClass = 'staff-card-weekly';
                let timeText = w.time;
                
                if (w.isOff) {
                    cardClass += ' off-exception';
                    timeText = '휴무';
                } else if (w.isException) {
                    cardClass += ' exception';
                }

                col.innerHTML += `
                    <div class="${cardClass}">
                        <strong>${w.staff.name}</strong>
                        <span>${timeText}</span>
                    </div>`;
            });
        }
    }
}

function openTimeChangeModal(id, dateStr, currentStr) {
    if (!currentUser) { openLoginModal(); return; }
    
    initTimeChangeOptions(); 

    document.getElementById('timeChangeId').value = id;
    document.getElementById('timeChangeDate').value = dateStr;
    document.getElementById('timeChangeModal').style.display = 'flex';
}

function closeTimeChangeModal() {
    document.getElementById('timeChangeModal').style.display = 'none';
}

function initTimeChangeOptions() {
    const hours = [];
    for(let i=0; i<=30; i++) {
        const val = i < 24 ? i : i - 24; 
        const txt = i < 24 ? `${i}` : `(익일)${i-24}`;
        const valStr = String(val).padStart(2, '0');
        hours.push(`<option value="${valStr}">${txt}</option>`);
    }
    const html = hours.join('');
    
    const els = ['tcStartHour', 'tcEndHour'];
    els.forEach(id => {
        const el = document.getElementById(id);
        if(el && el.children.length === 0) {
            el.innerHTML = html;
            if(id === 'tcStartHour') el.value = "18";
            if(id === 'tcEndHour') el.value = "23";
        }
    });
}

async function submitTimeChange() {
    const id = parseInt(document.getElementById('timeChangeId').value);
    const dateStr = document.getElementById('timeChangeDate').value;
    
    const sh = document.getElementById('tcStartHour').value;
    const sm = document.getElementById('tcStartMin').value;
    const eh = document.getElementById('tcEndHour').value;
    const em = document.getElementById('tcEndMin').value;
    
    const newTime = `${sh}:${sm}~${eh}:${em}`;
    
    await callExceptionApi({ id, date: dateStr, type: 'work', time: newTime });
    alert('시간이 변경되었습니다.');
    closeTimeChangeModal();
}

async function cancelException(id, dateStr) {
    if(!confirm('휴무 설정을 취소하고 원래 근무로 되돌리시겠습니까?')) return;
    
    try {
        await fetch('/api/staff/exception', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                id: id, 
                date: dateStr, 
                type: 'delete',
                actor: currentUser.name 
            })
        });
        alert('휴무가 취소되고 원래 근무로 복구되었습니다.');
        loadStaffData();
    } catch(e) { 
        console.error('휴무 복구 실패:', e);
        alert('복구 실패'); 
    }
}

function changeWeek(weeks) { currentWeekStartDate.setDate(currentWeekStartDate.getDate() + (weeks * 7)); renderWeeklyView(); }
function resetToThisWeek() {
    const today = new Date();
    const day = today.getDay();
    currentWeekStartDate = new Date(today);
    currentWeekStartDate.setDate(today.getDate() - day);
    renderWeeklyView();
}

function renderMonthlyView() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const monthDisplay = document.getElementById('monthDisplay');
    if(monthDisplay) monthDisplay.textContent = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay(); 
    const totalDays = lastDay.getDate();

    const container = document.getElementById('calendarBody');
    if(!container) return;
    container.innerHTML = '';
    const realToday = new Date();

    for (let i = 0; i < startDayOfWeek; i++) {
        container.innerHTML += `<div class="calendar-day empty"></div>`;
    }

    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let day = 1; day <= totalDays; day++) {
        const currentIterDate = new Date(year, month, day);
        const dayKey = dayMap[currentIterDate.getDay()];
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        
        let count = 0;
        staffList.forEach(staff => {
            let isWorking = false;
            if (staff.exceptions && staff.exceptions[dateStr]) {
                if (staff.exceptions[dateStr].type === 'work') isWorking = true;
            } else {
                if (staff.workDays.includes(dayKey)) isWorking = true;
            }
            if(isWorking) count++;
        });
        
        let dayClass = '';
        if (currentIterDate.getDay() === 0) dayClass = 'sunday';
        if (currentIterDate.getDay() === 6) dayClass = 'saturday';
        if (currentIterDate.getDate() === realToday.getDate() && 
            currentIterDate.getMonth() === realToday.getMonth() && 
            currentIterDate.getFullYear() === realToday.getFullYear()) {
            dayClass += ' today-highlight';
        }

        let countStyle = 'background: #e3f2fd; color: #1565c0;';
        if (count > 0 && (count <= 6 || count >= 8)) {
            countStyle = 'background: #ffebee; color: #d32f2f; border: 1px solid #ffcdd2;';
        }

        container.innerHTML += `
            <div class="calendar-day ${dayClass}" onclick="goToDailyDetail(${year}, ${month}, ${day})">
                <span class="calendar-date-num">${day}</span>
                ${count > 0 ? `<span class="calendar-staff-count" style="${countStyle} padding: 4px; border-radius: 4px; text-align: center; font-size: 12px; font-weight: bold; margin-top: 5px; display: block;">근무 ${count}명</span>` : ''}
            </div>`;
    }
}

function changeMonth(d) { calendarDate.setMonth(calendarDate.getMonth() + d); renderMonthlyView(); }
function resetToThisMonth() { calendarDate = new Date(); renderMonthlyView(); }

function goToDailyDetail(year, month, day) { 
    currentDate = new Date(year, month, day); 
    switchTab('attendance');
    const dailyBtn = document.querySelector('button[onclick*="att-daily"]');
    if(dailyBtn) switchAttSubTab('att-daily', dailyBtn);
}

// ==========================================
// 7. 기타 기능 (급여/로그/예외처리)
// ==========================================

function calculateMonthlySalary() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); 
    
    const lastDayObj = new Date(year, month + 1, 0);
    const totalDaysInMonth = lastDayObj.getDate(); 
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    let salaryReport = [];

    staffList.forEach(s => {
        const sDate = s.startDate ? new Date(s.startDate) : null;
        const eDate = s.endDate ? new Date(s.endDate) : null;
        
        const isEmployedAt = (targetDate) => {
            const t = new Date(targetDate); t.setHours(0,0,0,0);
            if (sDate) { const start = new Date(sDate); start.setHours(0,0,0,0); if (t < start) return false; }
            if (eDate) { const end = new Date(eDate); end.setHours(0,0,0,0); if (t > end) return false; }
            return true;
        };

        if (s.salaryType === 'monthly') {
            let employedDays = 0;
            let statusText = '만근';

            for (let d = 1; d <= totalDaysInMonth; d++) {
                const currentDay = new Date(year, month, d);
                if (isEmployedAt(currentDay)) employedDays++;
            }

            let finalPay = s.salary || 0;
            if (employedDays < totalDaysInMonth) {
                finalPay = Math.floor((s.salary / totalDaysInMonth) * employedDays);
                statusText = `${employedDays}일 재직 (일할)`;
            }

            salaryReport.push({ name: s.name, type: '월급', workCount: statusText, totalHours: '-', amount: finalPay });
            return;
        }

        let totalHours = 0;
        let workCount = 0;
        
        for (let d = 1; d <= totalDaysInMonth; d++) {
            const currentDate = new Date(year, month, d);
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const dayKey = dayMap[currentDate.getDay()];
            
            if (!isEmployedAt(currentDate)) continue;

            let isWorking = false;
            let timeStr = s.time;

            if (s.exceptions && s.exceptions[dateStr]) {
                const ex = s.exceptions[dateStr];
                if (ex.type === 'work') { isWorking = true; timeStr = ex.time; }
                else if (ex.type === 'off') { isWorking = false; }
            } else {
                if (s.workDays.includes(dayKey)) isWorking = true;
            }

            if (isWorking) { workCount++; totalHours += calculateDuration(timeStr); }
        }

        salaryReport.push({
            name: s.name, type: '시급',
            workCount: workCount + '일', totalHours: totalHours.toFixed(1) + '시간',
            amount: Math.floor(totalHours * (s.salary || 0))
        });
    });

    const tbody = document.getElementById('salaryTableBody');
    tbody.innerHTML = '';
    let totalAll = 0;
    
    salaryReport.forEach(r => {
        totalAll += r.amount;
        tbody.innerHTML += `
            <tr>
                <td>${r.name}${(r.workCount.includes('일할')) ? '<br><span style="font-size:10px; color:red;">(중도 입/퇴사)</span>' : ''}</td>
                <td><span class="badge" style="background:${r.type === '월급'?'#28a745':'#17a2b8'}; color:white; padding:3px 6px; border-radius:4px; font-size:11px;">${r.type}</span></td>
                <td style="font-size:12px;">${r.workCount}<br>${r.type==='시급' ? '('+r.totalHours+')' : ''}</td>
                <td style="text-align:right; font-weight:bold;">${r.amount.toLocaleString()}원</td>
            </tr>`;
    });
    document.getElementById('totalSalaryAmount').textContent = `총 지출 예상: ${totalAll.toLocaleString()}원`;
    document.getElementById('salaryModal').style.display = 'flex';
}

function closeSalaryModal() { document.getElementById('salaryModal').style.display = 'none'; }

function getEstimatedStaffCost(monthStr, targetStaffList = null) {
    const list = targetStaffList || staffList; 
    
    const [y, m] = monthStr.split('-');
    const year = parseInt(y);
    const month = parseInt(m);

    const lastDayObj = new Date(year, month, 0); 
    const totalDaysInMonth = lastDayObj.getDate();
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    let totalPay = 0;

    list.forEach(s => {
        const sDate = s.startDate ? new Date(s.startDate) : null;
        const eDate = s.endDate ? new Date(s.endDate) : null;

        const isEmployedAt = (targetDate) => {
            const t = new Date(targetDate); t.setHours(0,0,0,0);
            if (sDate) { const start = new Date(sDate); start.setHours(0,0,0,0); if (t < start) return false; }
            if (eDate) { const end = new Date(eDate); end.setHours(0,0,0,0); if (t > end) return false; }
            return true;
        };

        if (s.salaryType === 'monthly') {
            let employedDays = 0;
            for (let d = 1; d <= totalDaysInMonth; d++) {
                if (isEmployedAt(new Date(year, month-1, d))) employedDays++;
            }
            if (employedDays === totalDaysInMonth) totalPay += (s.salary || 0);
            else totalPay += Math.floor((s.salary || 0) / totalDaysInMonth * employedDays);

        } else {
            let hours = 0;
            for (let d = 1; d <= totalDaysInMonth; d++) {
                const dateObj = new Date(year, month-1, d);
                const dateKey = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const dayName = dayMap[dateObj.getDay()];
                
                if (!isEmployedAt(dateObj)) continue; 

                let isWorking = false;
                let timeStr = s.time;

                if (s.exceptions && s.exceptions[dateKey]) {
                    if (s.exceptions[dateKey].type === 'work') { isWorking = true; timeStr = s.exceptions[dateKey].time; }
                } else {
                    if (s.workDays.includes(dayName)) isWorking = true;
                }
                if (isWorking) hours += calculateDuration(timeStr);
            }
            totalPay += Math.floor(hours * (s.salary || 0));
        }
    });
    return totalPay;
}

async function setDailyException(id, dateStr, action) {
    if (!currentUser) { openLoginModal(); return; }
    if (action === 'off') {
        if (!confirm('이 직원을 오늘 명단에서 제외(휴무)하시겠습니까?')) return;
        await callExceptionApi({ id, date: dateStr, type: 'off' });
    } else if (action === 'time') {
        const newTime = prompt('오늘만 적용할 근무 시간을 입력하세요 (예: 18:00~22:00)');
        if (!newTime) return;
        await callExceptionApi({ id, date: dateStr, type: 'work', time: newTime });
    }
}

function initTimeOptions() {
    const hours = [];
    for(let i=0; i<=30; i++) {
        const val = i < 24 ? i : i - 24; 
        const txt = i < 24 ? `${i}` : `(익일)${i-24}`;
        const valStr = String(val).padStart(2, '0');
        hours.push(`<option value="${valStr}">${txt}</option>`);
    }
    const html = hours.join('');
    
    const startEl = document.getElementById('tempStartHour');
    const endEl = document.getElementById('tempEndHour');
    
    if(startEl) {
        startEl.innerHTML = html;
        startEl.value = "18"; 
    }
    if(endEl) {
        endEl.innerHTML = html;
        endEl.value = "23"; 
    }
}

function addTempWorker() {
    if (!currentUser) { openLoginModal(); return; }
    
    document.getElementById('tempName').value = '';
    document.getElementById('tempSalary').value = '10000'; 
    
    const dataList = document.getElementById('staffNameList');
    if (dataList && typeof staffList !== 'undefined') {
        const options = staffList
            .filter(s => s.salaryType !== 'monthly') 
            .map(s => `<option value="${s.name}">`)
            .join('');
        
        dataList.innerHTML = options;
    }

    document.getElementById('tempWorkerModal').style.display = 'flex';
}

function closeTempModal() {
    document.getElementById('tempWorkerModal').style.display = 'none';
}

function autoFillSalary(inputName) {
    if (!inputName) return;

    const todayStr = new Date().toISOString().split('T')[0];
    
    const target = staffList.find(s => {
        if (s.name !== inputName) return false;
        if (s.endDate && s.endDate < todayStr) return false;
        return true;
    });

    const finalTarget = target || staffList.find(s => s.name === inputName);

    if (finalTarget && finalTarget.salary) {
        document.getElementById('tempSalary').value = finalTarget.salary;
    }
}

async function saveTempWorker() {
    const name = document.getElementById('tempName').value.trim();
    const salary = document.getElementById('tempSalary').value;
    
    const sh = document.getElementById('tempStartHour').value;
    const sm = document.getElementById('tempStartMin').value;
    const eh = document.getElementById('tempEndHour').value;
    const em = document.getElementById('tempEndMin').value;

    if (!name) { alert('이름을 입력해주세요.'); return; }
    if (!salary) { alert('시급을 입력해주세요.'); return; }

    const timeStr = `${sh}:${sm}~${eh}:${em}`;
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const existingStaff = staffList.find(s => s.name === name);

    if (existingStaff) {
        if(!confirm(`${name}님은 이미 등록된 직원입니다.\n기존 정보에 오늘 근무를 추가하시겠습니까?`)) return;
        
        await callExceptionApi({ 
            id: existingStaff.id, 
            date: dateStr, 
            type: 'work', 
            time: timeStr 
        });
        alert('기존 직원 근무 일정에 추가되었습니다.');
        closeTempModal();
        
    } else {
        try {
            const res = await fetch('/api/staff/temp', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    name: name, 
                    date: dateStr, 
                    time: timeStr, 
                    salary: salary, 
                    actor: currentUser.name 
                })
            });
            const json = await res.json();
            if (json.success) { 
                alert('임시 근무자가 등록되었습니다.');
                closeTempModal();
                loadStaffData(); 
            } else {
                alert('등록 실패');
            }
        } catch(e) { console.error(e); alert('서버 통신 오류'); }
    }
}

async function callExceptionApi(payload) {
    try {
        await fetch('/api/staff/exception', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ ...payload, actor: currentUser.name })
        });
        loadStaffData();
    } catch(e) { alert('오류 발생'); }
}

async function loadLogs() {
    try {
        const res = await fetch(`/api/logs`);
        const json = await res.json();
        const tbody = document.getElementById('logTableBody');
        
        if(tbody) {
            tbody.innerHTML = '';
            if (!json.data || json.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">기록이 없습니다.</td></tr>';
                return;
            }

            const staffActions = ['직원등록', '직원수정', '직원삭제', '근무변경', '대타등록'];
            const filteredLogs = json.data.filter(log => staffActions.includes(log.action));

            if (filteredLogs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">직원/근무 관련 기록이 없습니다.</td></tr>';
                return;
            }

            filteredLogs.forEach(log => {
                const date = new Date(log.timestamp).toLocaleString('ko-KR', {
                    month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
                });
                tbody.innerHTML += `
                    <tr>
                        <td>${date}</td>
                        <td>${log.actor}</td>
                        <td class="log-action-${log.action}">${log.action}</td>
                        <td>${log.target}</td>
                        <td>${log.details}</td>
                    </tr>`;
            });
        }
    } catch(e) { console.error("로그 로드 실패", e); }
}

async function loadAccountingLogs() {
    try {
        const res = await fetch(`/api/logs`);
        const json = await res.json();
        const tbody = document.getElementById('accLogTableBody');
        
        if(tbody) {
            tbody.innerHTML = '';
            if (!json.data || json.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">기록이 없습니다.</td></tr>';
                return;
            }

            const accountingActions = ['매출입력', '매출수정', '매출삭제', '월간지출', '선결제충전', '선결제사용', '선결제취소'];
            const filteredLogs = json.data.filter(log => accountingActions.includes(log.action));

            if (filteredLogs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">매입/매출 관련 기록이 없습니다.</td></tr>';
                return;
            }

            filteredLogs.forEach(log => {
                const date = new Date(log.timestamp).toLocaleString('ko-KR', {
                    month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
                });
                tbody.innerHTML += `
                    <tr>
                        <td>${date}</td>
                        <td>${log.actor}</td>
                        <td class="log-action-${log.action}">${log.action}</td>
                        <td>${log.target}</td>
                        <td>${log.details}</td>
                    </tr>`;
            });
        }
    } catch(e) { console.error("회계 로그 로드 실패", e); }
}

async function downloadAllData() {
    if (!currentUser || currentUser.role !== 'admin') { alert("사장님만 가능한 기능입니다."); return; }

    if (!confirm(`모든 데이터를 다운로드하시겠습니까?\n(직원, 매출, 로그 포함)`)) return;

    try {
        const res = await fetch(`/api/backup`);
        // 백업 API가 서버에 구현되어 있어야 함 (기존 코드에선 경로만 있었음)
        // 만약 서버에 /api/backup이 없다면 작동하지 않을 수 있음
        // (제공해주신 server.js에는 /api/backup 라우트가 없습니다. 필요시 추가 필요)
        
        if(res.status === 404) {
            alert("서버에 백업 기능이 구현되지 않았습니다.");
            return;
        }

        const json = await res.json();

        if (json.success) {
            const dataStr = JSON.stringify(json.data, null, 2);
            const date = new Date();
            const dateStr = date.getFullYear() + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
            const fileName = `backup_${dateStr}.json`;

            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            alert("다운로드가 완료되었습니다.");
        } else alert("백업 데이터 생성 실패");
    } catch (e) { console.error(e); alert("서버 통신 오류"); }
}