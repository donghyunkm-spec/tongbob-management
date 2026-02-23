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
let selectedPredStore = 'all'; // 예상순익 매장 선택: 'all', '1', '3'
let selectedDashStore = 'all'; // 월간분석 매장 선택: 'all', '1', '3'


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
        userInfoDiv.style.display = 'flex';
    }
    
    const userNameSpan = document.getElementById('userName');
    if(userNameSpan) {
        userNameSpan.textContent = `${user.name} (${user.role === 'admin' ? '사장' : user.role === 'manager' ? '점장' : '직원'})`;
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
        
        const backupSection = document.getElementById('backupSection');
        if(backupSection) backupSection.style.display = 'block';
        
        const backupBtn = document.getElementById('adminBackupBtn');
        if(backupBtn) backupBtn.style.display = 'block';
        
        try { await loadLogs(); } catch(e) {}
    }
    
    // 매니저는 예상순익, 월간분석 탭 숨김
    if (user.role === 'manager') {
        const predTab = document.getElementById('tab-prediction');
        const dashTab = document.getElementById('tab-dashboard');
        if(predTab) predTab.style.display = 'none';
        if(dashTab) dashTab.style.display = 'none';
    }
    
    const activeTab = document.querySelector('.tab-content.active');
    if(activeTab && activeTab.id === 'accounting-content') {
        try { await loadAccountingData(); } catch(e) {}
    }
    try { renderManageList(); } catch(e) {}
}

// 로그아웃 함수
function logout() {
    if (!confirm('로그아웃 하시겠습니까?')) return;
    
    // localStorage 클리어
    localStorage.removeItem('staffUser');
    
    // 현재 사용자 초기화
    currentUser = null;
    
    // 페이지 새로고침
    location.reload();
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

// [수정] 일일 데이터 로드 - 1루/3루 분리
function loadDailyAccounting() {
    const datePicker = document.getElementById('accDate').value;
    if (!datePicker) return;

    const dayData = (accountingData.daily && accountingData.daily[datePicker]) ? accountingData.daily[datePicker] : {};
    
    // 1루 매출
    if(document.getElementById('inpCard1')) document.getElementById('inpCard1').value = dayData.card1 || '';
    if(document.getElementById('inpCash1')) document.getElementById('inpCash1').value = dayData.cash1 || '';
    if(document.getElementById('inpDelivery1')) document.getElementById('inpDelivery1').value = dayData.delivery1 || '';
    if(document.getElementById('inpTransfer1')) document.getElementById('inpTransfer1').value = dayData.transfer1 || '';
    
    // 3루 매출
    if(document.getElementById('inpCard3')) document.getElementById('inpCard3').value = dayData.card3 || '';
    if(document.getElementById('inpCash3')) document.getElementById('inpCash3').value = dayData.cash3 || '';
    if(document.getElementById('inpDelivery3')) document.getElementById('inpDelivery3').value = dayData.delivery3 || '';
    if(document.getElementById('inpTransfer3')) document.getElementById('inpTransfer3').value = dayData.transfer3 || '';

    // 지출 (공통)
    document.getElementById('inpFood').value = dayData.food || ''; 
    document.getElementById('inpMeat').value = dayData.meat || ''; 
    document.getElementById('inpEtc').value = dayData.etc || ''; 
    
    // 메모 (각각)
    if(document.getElementById('inpNote1')) document.getElementById('inpNote1').value = dayData.note1 || '';
    if(document.getElementById('inpNote3')) document.getElementById('inpNote3').value = dayData.note3 || '';
}

// [수정] 일일 데이터 저장 - 1루/3루 분리
async function saveDailyAccounting() {
    if (!currentUser) { alert("로그인이 필요합니다."); openLoginModal(); return; }
    if (!['admin', 'manager'].includes(currentUser.role)) { alert("권한이 없습니다."); return; }

    const dateStr = document.getElementById('accDate').value;
    if (!dateStr) { alert('날짜를 선택해주세요.'); return; }

    // 1루 매출 입력
    const card1 = parseInt(document.getElementById('inpCard1').value) || 0;
    const cash1 = parseInt(document.getElementById('inpCash1').value) || 0;
    const delivery1 = parseInt(document.getElementById('inpDelivery1').value) || 0;
    const transfer1 = parseInt(document.getElementById('inpTransfer1').value) || 0; // 참고용
    
    // 3루 매출 입력
    const card3 = parseInt(document.getElementById('inpCard3').value) || 0;
    const cash3 = parseInt(document.getElementById('inpCash3').value) || 0;
    const delivery3 = parseInt(document.getElementById('inpDelivery3').value) || 0;
    const transfer3 = parseInt(document.getElementById('inpTransfer3').value) || 0; // 참고용

    // 지출 입력 (공통)
    const food = parseInt(document.getElementById('inpFood').value) || 0; // 고센유통
    const meat = parseInt(document.getElementById('inpMeat').value) || 0; // 고기
    const etc = parseInt(document.getElementById('inpEtc').value) || 0;   // 기타
    
    // 메모 (각각)
    const note1 = document.getElementById('inpNote1').value || '';
    const note3 = document.getElementById('inpNote3').value || '';

    // 매출 합산 (계좌이체 제외)
    const sales1 = card1 + cash1 + delivery1;
    const sales3 = card3 + cash3 + delivery3;
    const totalSales = sales1 + sales3;
    const totalCost = food + meat + etc;

    if (totalSales === 0 && totalCost === 0) {
        if(!confirm(`${dateStr} 입력된 금액이 0원입니다. 저장하시겠습니까?`)) return;
    }

    const data = {
        // 1루 매출
        card1, cash1, delivery1, transfer1, sales1,
        // 3루 매출
        card3, cash3, delivery3, transfer3, sales3,
        // 전체 매출
        sales: totalSales, 
        // 지출
        food, meat, etc, cost: totalCost, 
        // 메모
        note1, note3
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

    const setVal = (id, val) => { 
        const el = document.getElementById(id);
        if(el) el.value = val || ''; 
    };

    // 1루 고정비
    setVal('fixInternet1', mData.internet1);
    setVal('fixWater1', mData.water1);
    setVal('fixCleaning1', mData.cleaning1);
    setVal('fixOperMgmt1', mData.operMgmt1);
    setVal('fixCCTV1', mData.cctv1);
    setVal('fixBizCard1', mData.bizCard1);
    setVal('fixEtc1', mData.etc_fixed1);

    // 3루 고정비
    setVal('fixInternet3', mData.internet3);
    setVal('fixWater3', mData.water3);
    setVal('fixCleaning3', mData.cleaning3);
    setVal('fixOperMgmt3', mData.operMgmt3);
    setVal('fixCCTV3', mData.cctv3);
    setVal('fixBizCard3', mData.bizCard3);
    setVal('fixEtc3', mData.etc_fixed3);
}
// [수정] 고정비 저장 (PUT 메서드 사용)

async function saveFixedCost() {
    if (!currentUser) { openLoginModal(); return; }
    if (!['admin', 'manager'].includes(currentUser.role)) { alert("권한이 없습니다."); return; }

    const monthStr = getMonthStr(currentDashboardDate);
    
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? (parseInt(el.value) || 0) : 0;
    };
    
    const data = {
        // 1루 고정비
        internet1: getVal('fixInternet1'),
        water1: getVal('fixWater1'),
        cleaning1: getVal('fixCleaning1'),
        operMgmt1: getVal('fixOperMgmt1'),
        cctv1: getVal('fixCCTV1'),
        bizCard1: getVal('fixBizCard1'),
        etc_fixed1: getVal('fixEtc1'),
        
        // 3루 고정비
        internet3: getVal('fixInternet3'),
        water3: getVal('fixWater3'),
        cleaning3: getVal('fixCleaning3'),
        operMgmt3: getVal('fixOperMgmt3'),
        cctv3: getVal('fixCCTV3'),
        bizCard3: getVal('fixBizCard3'),
        etc_fixed3: getVal('fixEtc3')
    };

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

// 예상순익 매장 선택
function selectPredStore(store) {
    selectedPredStore = store;
    
    // 버튼 스타일 업데이트
    document.querySelectorAll('#acc-prediction .store-select-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'white';
    });
    
    const activeBtn = document.getElementById('predStore' + (store === 'all' ? 'All' : store));
    if(activeBtn) {
        activeBtn.classList.add('active');
        const color = store === 'all' ? '#4a148c' : (store === '1' ? '#1976D2' : '#0288D1');
        activeBtn.style.background = color;
        activeBtn.style.color = 'white';
    }
    
    renderPredictionStats();
}

// 월간분석 매장 선택
function selectDashStore(store) {
    selectedDashStore = store;
    
    // 버튼 스타일 업데이트
    document.querySelectorAll('#acc-dashboard .store-select-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'white';
    });
    
    const activeBtn = document.getElementById('dashStore' + (store === 'all' ? 'All' : store));
    if(activeBtn) {
        activeBtn.classList.add('active');
        const color = store === 'all' ? '#333' : (store === '1' ? '#1976D2' : '#0288D1');
        activeBtn.style.background = color;
        activeBtn.style.color = 'white';
    }
    
    renderDashboardStats();
}

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
    let salesTotal1 = 0, salesTotal3 = 0;
    let deliverySalesTotal1 = 0, deliverySalesTotal3 = 0;
    let cardSalesTotal1 = 0, cardSalesTotal3 = 0;
    let foodTotal = 0, meatTotal = 0, etcTotal = 0;

    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                const d = accountingData.daily[date];
                
                // 1루 매출
                salesTotal1 += (d.sales1 || 0);
                deliverySalesTotal1 += (d.delivery1 || 0);
                cardSalesTotal1 += (d.card1 || 0);
                
                // 3루 매출
                salesTotal3 += (d.sales3 || 0);
                deliverySalesTotal3 += (d.delivery3 || 0);
                cardSalesTotal3 += (d.card3 || 0);
                
                // 공통 지출 (전체)
                foodTotal += (d.food || 0);
                meatTotal += (d.meat || 0);
                etcTotal += (d.etc || 0);
            }
        });
    }

    const totalSales = salesTotal1 + salesTotal3;
    
    // 2. 매출 비율 계산
    const ratio1 = totalSales > 0 ? (salesTotal1 / totalSales) : 0.5;
    const ratio3 = totalSales > 0 ? (salesTotal3 / totalSales) : 0.5;

    // 3. 선택된 매장에 따라 계산
    let salesTotal, deliverySalesTotal, cardSalesTotal;
    let fixedMisc, commission, deliveryFee, cardFee;
    let food, meat, etc;
    
    // 인건비 (전체)
    const estimatedStaffCost = getEstimatedStaffCost(monthStr);
    let staffCost;
    
    if (selectedPredStore === '1') {
        // === 1루만 ===
        salesTotal = salesTotal1;
        deliverySalesTotal = deliverySalesTotal1;
        cardSalesTotal = cardSalesTotal1;
        
        // 1루 수수료
        commission = Math.floor(salesTotal1 * 0.30);
        deliveryFee = Math.floor(deliverySalesTotal1 * 0.0495);
        cardFee = Math.floor(cardSalesTotal1 * 0.016);
        
        // 1루 고정비
        fixedMisc = (mData.internet1||0) + (mData.water1||0) + (mData.cleaning1||0) + 
                    (mData.operMgmt1||0) + (mData.cctv1||0) + (mData.bizCard1||0) + (mData.etc_fixed1||0);
        
        // 매출 비율로 배분
        staffCost = Math.floor(estimatedStaffCost * ratio1);
        food = Math.floor(foodTotal * ratio1);
        meat = Math.floor(meatTotal * ratio1);
        etc = Math.floor(etcTotal * ratio1);
        
    } else if (selectedPredStore === '3') {
        // === 3루만 ===
        salesTotal = salesTotal3;
        deliverySalesTotal = deliverySalesTotal3;
        cardSalesTotal = cardSalesTotal3;
        
        // 3루 수수료
        commission = Math.floor(salesTotal3 * 0.30);
        deliveryFee = Math.floor(deliverySalesTotal3 * 0.0495);
        cardFee = Math.floor(cardSalesTotal3 * 0.016);
        
        // 3루 고정비
        fixedMisc = (mData.internet3||0) + (mData.water3||0) + (mData.cleaning3||0) + 
                    (mData.operMgmt3||0) + (mData.cctv3||0) + (mData.bizCard3||0) + (mData.etc_fixed3||0);
        
        // 매출 비율로 배분
        staffCost = Math.floor(estimatedStaffCost * ratio3);
        food = Math.floor(foodTotal * ratio3);
        meat = Math.floor(meatTotal * ratio3);
        etc = Math.floor(etcTotal * ratio3);
        
    } else {
        // === 전체 ===
        salesTotal = salesTotal1 + salesTotal3;
        deliverySalesTotal = deliverySalesTotal1 + deliverySalesTotal3;
        cardSalesTotal = cardSalesTotal1 + cardSalesTotal3;
        
        // 전체 수수료
        commission = Math.floor(salesTotal1 * 0.30) + Math.floor(salesTotal3 * 0.30);
        deliveryFee = Math.floor(deliverySalesTotal1 * 0.0495) + Math.floor(deliverySalesTotal3 * 0.0495);
        cardFee = Math.floor(cardSalesTotal1 * 0.016) + Math.floor(cardSalesTotal3 * 0.016);
        
        // 전체 고정비
        fixedMisc = (mData.internet1||0) + (mData.water1||0) + (mData.cleaning1||0) + 
                    (mData.operMgmt1||0) + (mData.cctv1||0) + (mData.bizCard1||0) + (mData.etc_fixed1||0) +
                    (mData.internet3||0) + (mData.water3||0) + (mData.cleaning3||0) + 
                    (mData.operMgmt3||0) + (mData.cctv3||0) + (mData.bizCard3||0) + (mData.etc_fixed3||0);
        
        // 전체 (배분 없음)
        staffCost = estimatedStaffCost;
        food = foodTotal;
        meat = meatTotal;
        etc = etcTotal;
    }

    // 4. 최종 비용 계산
    const salesBasedCost = commission + deliveryFee + cardFee;
    const timeBasedCostFull = fixedMisc + staffCost;
    const timeBasedCostApplied = Math.floor(timeBasedCostFull * ratio);
    const variableCost = food + meat + etc;
    
    const totalCurrentCost = variableCost + salesBasedCost + timeBasedCostApplied;
    const netProfit = salesTotal - totalCurrentCost;
    const margin = salesTotal > 0 ? ((netProfit / salesTotal) * 100).toFixed(1) : 0;

    // 5. UI 업데이트
    document.getElementById('predTotalSales').textContent = salesTotal.toLocaleString() + '원';
    document.getElementById('predTotalCost').textContent = totalCurrentCost.toLocaleString() + '원';
    
    const profitEl = document.getElementById('predNetProfit');
    profitEl.textContent = netProfit.toLocaleString() + '원';
    profitEl.style.color = netProfit >= 0 ? '#fff' : '#ffab91';
    document.getElementById('predMargin').textContent = `보정 마진율: ${margin}%`;

    // 6. 상세 바 차트 렌더링
    renderCostList('predCostList', mData, staffCost, ratio, salesTotal, totalCurrentCost, monthStr, {
        commission: commission,
        deliveryFee: deliveryFee,
        cardFee: cardFee,
        fixedMisc: fixedMisc,
        food: food,
        meat: meat,
        etc: etc
    });
}
// 월간 분석
function renderDashboardStats() {
    const monthStr = getMonthStr(currentDashboardDate);
    const mData = (accountingData.monthly && accountingData.monthly[monthStr]) ? accountingData.monthly[monthStr] : {};
    
    let sales1 = { card:0, cash:0, delivery:0, total:0 };
    let sales3 = { card:0, cash:0, delivery:0, total:0 };
    let foodTotal = 0, meatTotal = 0, etcTotal = 0;

    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                const d = accountingData.daily[date];
                
                // 1루 매출
                sales1.card += (d.card1||0);
                sales1.cash += (d.cash1||0);
                sales1.delivery += (d.delivery1||0);
                sales1.total += (d.sales1||0);
                
                // 3루 매출
                sales3.card += (d.card3||0);
                sales3.cash += (d.cash3||0);
                sales3.delivery += (d.delivery3||0);
                sales3.total += (d.sales3||0);
                
                // 공통 지출
                foodTotal += (d.food||0);
                meatTotal += (d.meat||0);
                etcTotal += (d.etc||0);
            }
        });
    }

    const totalSales = sales1.total + sales3.total;
    
    // 매출 비율 계산
    const ratio1 = totalSales > 0 ? (sales1.total / totalSales) : 0.5;
    const ratio3 = totalSales > 0 ? (sales3.total / totalSales) : 0.5;

    // 선택된 매장에 따라 표시
    let sales, fixedMisc, commission, deliveryFee, cardFee;
    let food, meat, etc;
    
    // 인건비 (전체)
    const totalStaffCost = getEstimatedStaffCost(monthStr);
    let staffCost;
    
    if (selectedDashStore === '1') {
        // === 1루만 ===
        sales = sales1;
        
        // 1루 수수료
        commission = Math.floor(sales1.total * 0.30);
        deliveryFee = Math.floor(sales1.delivery * 0.0495);
        cardFee = Math.floor(sales1.card * 0.016);
        
        // 1루 고정비
        fixedMisc = (mData.internet1||0) + (mData.water1||0) + (mData.cleaning1||0) + 
                    (mData.operMgmt1||0) + (mData.cctv1||0) + (mData.bizCard1||0) + (mData.etc_fixed1||0);
        
        // 매출 비율로 배분
        staffCost = Math.floor(totalStaffCost * ratio1);
        food = Math.floor(foodTotal * ratio1);
        meat = Math.floor(meatTotal * ratio1);
        etc = Math.floor(etcTotal * ratio1);
        
    } else if (selectedDashStore === '3') {
        // === 3루만 ===
        sales = sales3;
        
        // 3루 수수료
        commission = Math.floor(sales3.total * 0.30);
        deliveryFee = Math.floor(sales3.delivery * 0.0495);
        cardFee = Math.floor(sales3.card * 0.016);
        
        // 3루 고정비
        fixedMisc = (mData.internet3||0) + (mData.water3||0) + (mData.cleaning3||0) + 
                    (mData.operMgmt3||0) + (mData.cctv3||0) + (mData.bizCard3||0) + (mData.etc_fixed3||0);
        
        // 매출 비율로 배분
        staffCost = Math.floor(totalStaffCost * ratio3);
        food = Math.floor(foodTotal * ratio3);
        meat = Math.floor(meatTotal * ratio3);
        etc = Math.floor(etcTotal * ratio3);
        
    } else {
        // === 전체 ===
        sales = {
            card: sales1.card + sales3.card,
            cash: sales1.cash + sales3.cash,
            delivery: sales1.delivery + sales3.delivery,
            total: sales1.total + sales3.total
        };
        
        // 전체 수수료
        commission = Math.floor(sales1.total * 0.30) + Math.floor(sales3.total * 0.30);
        deliveryFee = Math.floor(sales1.delivery * 0.0495) + Math.floor(sales3.delivery * 0.0495);
        cardFee = Math.floor(sales1.card * 0.016) + Math.floor(sales3.card * 0.016);
        
        // 전체 고정비
        fixedMisc = (mData.internet1||0) + (mData.water1||0) + (mData.cleaning1||0) + 
                    (mData.operMgmt1||0) + (mData.cctv1||0) + (mData.bizCard1||0) + (mData.etc_fixed1||0) +
                    (mData.internet3||0) + (mData.water3||0) + (mData.cleaning3||0) + 
                    (mData.operMgmt3||0) + (mData.cctv3||0) + (mData.bizCard3||0) + (mData.etc_fixed3||0);
        
        // 전체 (배분 없음)
        staffCost = totalStaffCost;
        food = foodTotal;
        meat = meatTotal;
        etc = etcTotal;
    }

    // 최종 비용 계산
    const variableCost = food + meat + etc;
    const totalCost = variableCost + commission + deliveryFee + cardFee + fixedMisc + staffCost;
    const netProfit = sales.total - totalCost;
    const margin = sales.total > 0 ? ((netProfit / sales.total) * 100).toFixed(1) : 0;

    // UI 업데이트
    document.getElementById('dashTotalSales').textContent = sales.total.toLocaleString() + '원';
    document.getElementById('dashTotalCost').textContent = totalCost.toLocaleString() + '원';
    
    const profitEl = document.getElementById('dashNetProfit');
    profitEl.textContent = netProfit.toLocaleString() + '원';
    profitEl.style.color = netProfit >= 0 ? '#fff' : '#ffab91';
    document.getElementById('dashMargin').textContent = `순이익률: ${margin}%`;
    
    if(document.getElementById('dashStaffCost')) 
        document.getElementById('dashStaffCost').textContent = staffCost.toLocaleString();

    renderDashboardCharts(sales, totalCost, mData, staffCost, variableCost, monthStr);
}
// [수정] 예상 순익 (Prediction) 및 월간 분석 차트 (Cost List)
function renderCostList(containerId, mData, staffCost, ratio, salesTotal, totalCost, monthStr, calculatedCosts = null) {
    const el = document.getElementById(containerId);
    if(!el) return;
    
    if(totalCost === 0) { el.innerHTML = '<div style="text-align:center; padding:10px; color:#999;">데이터 없음</div>'; return; }

    let cFood, cMeat, cEtc;
    let fCommission, fDelivery, fCardFee, fMisc, fStaff;

    // A. 예상순익/월간분석 탭에서 호출된 경우 (calculatedCosts 있음)
    if (calculatedCosts) {
        fCommission = calculatedCosts.commission;
        fDelivery = calculatedCosts.deliveryFee;
        fCardFee = calculatedCosts.cardFee;
        
        // 시간비례 고정비 (예상순익에서만 ratio 적용)
        fMisc = Math.floor(calculatedCosts.fixedMisc * ratio);
        
        // 인건비 (예상순익에서만 ratio 적용)
        fStaff = Math.floor(staffCost * ratio);
        
        // 이미 배분된 값 사용
        cFood = calculatedCosts.food || 0;
        cMeat = calculatedCosts.meat || 0;
        cEtc = calculatedCosts.etc || 0;
    } 
    // B. 기존 방식 (calculatedCosts 없음 - 레거시)
    else {
        // 전체 합산
        cFood = 0;
        cMeat = 0;
        cEtc = 0;
        
        if (accountingData.daily) {
            Object.keys(accountingData.daily).forEach(date => {
                if (date.startsWith(monthStr)) {
                    cFood += (accountingData.daily[date].food||0);
                    cMeat += (accountingData.daily[date].meat||0);
                    cEtc += (accountingData.daily[date].etc||0);
                }
            });
        }
        
        fCommission = mData.commission || 0;
        fDelivery = mData.deliveryFee || 0;
        fCardFee = mData.cardFee || 0;
        
        const fixedMiscSum = (mData.internet||0) + (mData.water||0) + (mData.cleaning||0) + 
                             (mData.operMgmt||0) + (mData.cctv||0) + (mData.etc_fixed||0);
        fMisc = fixedMiscSum;
        fStaff = staffCost;
    }

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
        const res = await fetch(`/api/staff?role=${currentUser?.role || 'viewer'}`);
        const json = await res.json();
        staffList = json.data;
        
        // ✅ 역할 필드 초기화 추가
        staffList.forEach(s => {
            if (!s.roles) {
                s.roles = ['일반'];
            }
        });
        
        renderDailyView();
        renderWeeklyView();
        renderMonthlyView();
        renderManageList();
        
    } catch(e) { console.error("데이터 로드 실패"); }
}

// ✅ 관리 탭 전환 (현재 직원 / 삭제된 직원)
function switchManageTab(tab) {
    if (!currentUser) {
        openLoginModal();
        return;
    }
    
    // 삭제된 직원 탭은 관리자만
    if (tab === 'deleted' && currentUser.role !== 'admin') {
        alert('관리자만 접근 가능합니다.');
        return;
    }
    
    // 탭 버튼 스타일 변경
    document.getElementById('activeStaffTab').classList.remove('active');
    document.getElementById('deletedStaffTab').classList.remove('active');
    
    if (tab === 'active') {
        document.getElementById('activeStaffTab').classList.add('active');
        document.getElementById('activeStaffSection').style.display = 'block';
        document.getElementById('deletedStaffSection').style.display = 'none';
        renderManageList();
    } else {
        document.getElementById('deletedStaffTab').classList.add('active');
        document.getElementById('activeStaffSection').style.display = 'none';
        document.getElementById('deletedStaffSection').style.display = 'block';
        loadDeletedStaff();
    }
}

function renderManageList() {
    const list = document.getElementById('manageStaffList');
    if(!list) return;
    list.innerHTML = '';
    
    const isAdmin = currentUser && currentUser.role === 'admin';
    
    // ✅ 정렬: 1. 월급 직원 먼저(금액 많은 순), 2. 전문분야 있는 직원
    const sortedStaff = [...staffList].sort((a, b) => {
        // 1순위: 월급 직원 먼저
        const aIsMonthly = a.salaryType === 'monthly' ? 1 : 0;
        const bIsMonthly = b.salaryType === 'monthly' ? 1 : 0;
        if (aIsMonthly !== bIsMonthly) return bIsMonthly - aIsMonthly;
        
        // 2순위: 월급 직원끼리는 금액 많은 순
        if (aIsMonthly && bIsMonthly) {
            return (b.salary || 0) - (a.salary || 0);
        }
        
        // 3순위: 전문분야 있는 직원 우선
        const aHasSpecial = (a.roles && a.roles.some(r => r !== '일반')) ? 1 : 0;
        const bHasSpecial = (b.roles && b.roles.some(r => r !== '일반')) ? 1 : 0;
        return bHasSpecial - aHasSpecial;
    });

    sortedStaff.forEach(s => {
        const daysStr = s.workDays.map(d => DAY_MAP[d]).join(',');
        const salaryInfo = isAdmin ? 
            `<div style="font-size:12px; color:#28a745; margin-top:3px;">
                💰 ${s.salaryType === 'monthly' ? '월급' : '시급'}: ${s.salary ? s.salary.toLocaleString() : '0'}원
             </div>` : '';

        // ✅ 역할 배지 추가
        const roles = s.roles || ['일반'];
        const rolesBadge = roles.map(r => {
            const roleColors = {
                '포스': '#e91e63',
                '삼겹살': '#ff5722',
                '국수': '#ff9800',
                '일반': '#9e9e9e'
            };
            return `<span style="background:${roleColors[r] || '#999'}; color:white; padding:2px 6px; border-radius:3px; font-size:11px; margin-right:3px;">${r}</span>`;
        }).join('');

        list.innerHTML += `
            <div class="reservation-item">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="font-size:16px;">${s.name}</strong> 
                        <span style="font-size:12px; color:#666;">(${s.time})</span>
                        <div style="font-size:13px; margin-top:5px;">${rolesBadge}</div>
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

// ✅ 삭제된 직원 목록 로드
async function loadDeletedStaff() {
    if (!currentUser || currentUser.role !== 'admin') {
        alert('관리자만 접근 가능합니다.');
        return;
    }
    
    try {
        const res = await fetch(`/api/staff?includeDeleted=true&role=${currentUser?.role || 'viewer'}`);
        const json = await res.json();
        const deletedStaff = json.data.filter(s => s.deleted);
        renderDeletedStaffList(deletedStaff);
    } catch(e) {
        console.error('삭제된 직원 로드 실패:', e);
    }
}

// ✅ 삭제된 직원 목록 렌더링
function renderDeletedStaffList(deletedStaff) {
    const list = document.getElementById('deletedStaffList');
    if(!list) return;
    
    list.innerHTML = '';
    
    if (deletedStaff.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#999; padding:20px;">삭제된 직원이 없습니다.</p>';
        return;
    }
    
    deletedStaff.forEach(s => {
        const deletedDate = new Date(s.deletedAt);
        const now = new Date();
        const daysPassed = Math.floor((now - deletedDate) / (1000 * 60 * 60 * 24));
        const canPermanentDelete = daysPassed >= 30;
        
        const deletedInfo = `
            <div style="font-size:12px; color:#999; margin-top:5px;">
                🗑️ 삭제일: ${deletedDate.toLocaleDateString('ko-KR')} (${daysPassed}일 경과)
                <br/>👤 삭제자: ${s.deletedBy || '알 수 없음'}
            </div>
        `;
        
        const roles = s.roles || ['일반'];
        const rolesBadge = roles.map(r => {
            const roleColors = {
                '포스': '#e91e63',
                '삼겹살': '#ff5722',
                '국수': '#ff9800',
                '일반': '#9e9e9e'
            };
            return `<span style="background:${roleColors[r] || '#999'}; color:white; padding:2px 6px; border-radius:3px; font-size:11px; margin-right:3px;">${r}</span>`;
        }).join('');
        
        list.innerHTML += `
            <div class="reservation-item" style="background:#f5f5f5; border-left:4px solid #999;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="font-size:16px; color:#666;">${s.name}</strong> 
                        <span style="font-size:12px; color:#999;">(${s.time})</span>
                        <div style="font-size:13px; margin-top:5px;">${rolesBadge}</div>
                        ${deletedInfo}
                    </div>
                    <div style="display:flex; gap:5px; flex-direction:column;">
                        <button class="edit-btn" onclick="restoreStaff(${s.id})" style="background:#4CAF50;">복구</button>
                        <button class="delete-btn" onclick="permanentDeleteStaff(${s.id}, ${canPermanentDelete})" 
                                ${!canPermanentDelete ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
                            완전삭제 ${!canPermanentDelete ? '(30일 후)' : ''}
                        </button>
                    </div>
                </div>
            </div>`;
    });
}

// ✅ 직원 복구
async function restoreStaff(id) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert('관리자만 가능합니다.');
        return;
    }
    
    if (!confirm('이 직원을 복구하시겠습니까?')) return;
    
    try {
        const res = await fetch(`/api/staff/${id}/restore`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ actor: currentUser.name })
        });
        
        const json = await res.json();
        if (json.success) {
            alert('직원이 복구되었습니다.');
            await loadStaffData();
            await loadDeletedStaff();
        } else {
            alert('복구 실패: ' + (json.message || '알 수 없는 오류'));
        }
    } catch(e) {
        console.error('복구 실패:', e);
        alert('복구 중 오류가 발생했습니다.');
    }
}

// ✅ 완전 삭제
async function permanentDeleteStaff(id, canDelete) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert('관리자만 가능합니다.');
        return;
    }
    
    if (!canDelete) {
        alert('삭제 후 30일이 지나야 완전 삭제가 가능합니다.');
        return;
    }
    
    if (!confirm('⚠️ 경고: 이 작업은 되돌릴 수 없습니다.\n\n직원의 모든 데이터가 영구적으로 삭제됩니다.\n정말 완전 삭제하시겠습니까?')) return;
    
    // 한 번 더 확인
    const confirmText = prompt('완전 삭제를 진행하려면 "영구삭제" 를 입력하세요:');
    if (confirmText !== '영구삭제') {
        alert('취소되었습니다.');
        return;
    }
    
    try {
        const res = await fetch(`/api/staff/${id}/permanent?actor=${encodeURIComponent(currentUser.name)}`, {
            method: 'DELETE'
        });
        
        const json = await res.json();
        if (json.success) {
            alert('완전 삭제되었습니다.');
            await loadDeletedStaff();
        } else {
            alert('삭제 실패: ' + (json.message || '알 수 없는 오류'));
        }
    } catch(e) {
        console.error('완전 삭제 실패:', e);
        alert('삭제 중 오류가 발생했습니다.');
    }
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

    // ✅ 역할 체크박스 설정 추가
    const roles = target.roles || ['일반'];
    document.getElementById('edit-role-일반').checked = roles.includes('일반');
    document.getElementById('edit-role-포스').checked = roles.includes('포스');
    document.getElementById('edit-role-삼겹살').checked = roles.includes('삼겹살');
    document.getElementById('edit-role-국수').checked = roles.includes('국수');

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

    // ✅ 역할 수집
    const roles = [];
    if (document.getElementById('edit-role-일반').checked) roles.push('일반');
    if (document.getElementById('edit-role-포스').checked) roles.push('포스');
    if (document.getElementById('edit-role-삼겹살').checked) roles.push('삼겹살');
    if (document.getElementById('edit-role-국수').checked) roles.push('국수');

    if (roles.length === 0) {
        alert('최소 하나의 역할을 선택해주세요.');
        return;
    }

    const updates = { time, startDate, endDate, roles };
    
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

// ==========================================
// 스마트 역할 배치 함수 (일별/월별 공통 사용)
// ==========================================
function calculateSmartRoleCount(workers) {
    // ✅ 0단계: 임시휴무 직원 제외
    const activeWorkers = workers.filter(w => !w.isTempOff);
    
    // 1단계: 직원 분류
    let specialistStaff = [];  // 전문 역할만 1개 가진 직원
    let multiRoleStaff = [];   // 2개 이상 전문 역할 가진 직원
    let generalStaff = [];     // 일반만 가진 직원
    
    activeWorkers.forEach(w => {
        const roles = w.roles || ['일반'];
        const specialRoles = roles.filter(r => r !== '일반');
        
        if (roles.includes('일반') && specialRoles.length === 0) {
            generalStaff.push(w);
        } else if (specialRoles.length === 1) {
            specialistStaff.push(w);
        } else if (specialRoles.length >= 2) {
            multiRoleStaff.push(w);
        }
    });

    // 2단계: 전문가 우선 배치 (1개 역할만 가진 사람)
    let posCount = 0, samCount = 0, noodleCount = 0;
    
    specialistStaff.forEach(w => {
        const roles = w.roles || ['일반'];
        const role = roles.find(r => r !== '일반');
        
        if (role === '포스') posCount++;
        else if (role === '삼겹살') samCount++;
        else if (role === '국수') noodleCount++;
    });

    // 3단계: 멀티 역할 직원을 부족한 파트에 우선 배치 (1명당 1개 파트만)
    multiRoleStaff.forEach(w => {
        const roles = w.roles || ['일반'];
        const specialRoles = roles.filter(r => r !== '일반');
        
        // 부족한 순서대로 정렬
        let needs = [];
        if (posCount < 2 && specialRoles.includes('포스')) {
            needs.push({ role: '포스', count: posCount, priority: 2 - posCount });
        }
        if (samCount < 2 && specialRoles.includes('삼겹살')) {
            needs.push({ role: '삼겹살', count: samCount, priority: 2 - samCount });
        }
        if (noodleCount < 2 && specialRoles.includes('국수')) {
            needs.push({ role: '국수', count: noodleCount, priority: 2 - noodleCount });
        }
        
        // 가장 부족한 파트에 배치 (1개 파트만)
        if (needs.length > 0) {
            needs.sort((a, b) => b.priority - a.priority);
            const assignedRole = needs[0].role;
            
            if (assignedRole === '포스') posCount++;
            else if (assignedRole === '삼겹살') samCount++;
            else if (assignedRole === '국수') noodleCount++;
        } else {
            // 모든 파트가 충분하면 첫 번째 역할에 배치
            if (specialRoles[0] === '포스') posCount++;
            else if (specialRoles[0] === '삼겹살') samCount++;
            else if (specialRoles[0] === '국수') noodleCount++;
        }
    });

    // 4단계: "일반" 직원은 보조 역할만 (카운트에 포함 안 함)
    // 일반 직원은 posCount, samCount, noodleCount에 추가하지 않음!
    
    return { posCount, samCount, noodleCount };
}

function renderDailyView() {
    const container = document.getElementById('dailyStaffList');
    if (!container) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const day = currentDate.getDate();
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayMap = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayMap[currentDate.getDay()];

    const dayDisplay = document.getElementById('currentDateDisplay');
    if(dayDisplay) dayDisplay.textContent = `${month}월 ${day}일 (${dayName})`;

    // ✅ 근무자 목록 수집 (임시휴무도 포함)
    let workers = [];
    
    staffList.forEach(s => {
        let isWorking = false;
        let timeStr = s.time;
        let isTempOff = false;

        if (s.exceptions && s.exceptions[dateStr]) {
            const ex = s.exceptions[dateStr];
            if (ex.type === 'work') {
                isWorking = true;
                timeStr = ex.time;
            } else if (ex.type === 'off') {
                isWorking = true; // ✅ 임시휴무도 목록에 표시
                isTempOff = true;
            }
        } else {
            const dayKey = DAY_KEYS[currentDate.getDay()];
            if (s.workDays && s.workDays.includes(dayKey)) {
                isWorking = true;
            }
        }

        if (isWorking) {
            const roles = s.roles || ['일반'];
            workers.push({
                name: s.name,
                time: timeStr,
                position: s.position,
                roles: roles,
                id: s.id,
                assignedRole: null,
                salaryType: s.salaryType, // ✅ 정렬을 위해 추가
                salary: s.salary, // ✅ 정렬을 위해 추가
                isTempOff: isTempOff // ✅ 임시휴무 여부
            });
        }
    });
    
    // ✅ 정렬: 1. 월급 직원 먼저, 2. 출근시간 순, 3. 전문분야 우선
    workers.sort((a, b) => {
        // 1순위: 월급 직원 우선
        const aIsMonthly = a.salaryType === 'monthly' ? 1 : 0;
        const bIsMonthly = b.salaryType === 'monthly' ? 1 : 0;
        if (aIsMonthly !== bIsMonthly) return bIsMonthly - aIsMonthly;
        
        // 2순위: 출근시간 빠른 순
        const aStartTime = getStartTimeValue(a.time);
        const bStartTime = getStartTimeValue(b.time);
        if (aStartTime !== bStartTime) return aStartTime - bStartTime;
        
        // 3순위: 전문분야 있는 직원 우선 (일반만 있으면 후순위)
        const aHasSpecial = a.roles.some(r => r !== '일반') ? 1 : 0;
        const bHasSpecial = b.roles.some(r => r !== '일반') ? 1 : 0;
        return bHasSpecial - aHasSpecial;
    });

    // ✅ 임시휴무 직원 제외한 실제 근무자
    const activeWorkers = workers.filter(w => !w.isTempOff);
    const totalCount = activeWorkers.length;

    // ✅ 스마트 배치 로직으로 역할별 카운트 계산 (임시휴무 제외)
    const roleCounts = calculateSmartRoleCount(activeWorkers);
    let posCount = roleCounts.posCount;
    let samCount = roleCounts.samCount;
    let noodleCount = roleCounts.noodleCount;
    
    // ✅ 배치된 역할 정보를 activeWorkers에 반영 (UI 표시용)
    let specialistStaff = [];
    let multiRoleStaff = [];
    let generalStaff = [];
    
    activeWorkers.forEach(w => {
        const specialRoles = w.roles.filter(r => r !== '일반');
        if (w.roles.includes('일반') && specialRoles.length === 0) {
            generalStaff.push(w);
        } else if (specialRoles.length === 1) {
            specialistStaff.push(w);
        } else if (specialRoles.length >= 2) {
            multiRoleStaff.push(w);
        }
    });
    
    // 전문가 배치
    specialistStaff.forEach(w => {
        w.assignedRole = w.roles.find(r => r !== '일반');
    });
    
    // 멀티 역할 배치 (부족한 파트 우선)
    let tempPos = specialistStaff.filter(w => w.roles.includes('포스')).length;
    let tempSam = specialistStaff.filter(w => w.roles.includes('삼겹살')).length;
    let tempNoodle = specialistStaff.filter(w => w.roles.includes('국수')).length;
    
    multiRoleStaff.forEach(w => {
        const specialRoles = w.roles.filter(r => r !== '일반');
        let needs = [];
        if (tempPos < 2 && specialRoles.includes('포스')) {
            needs.push({ role: '포스', priority: 2 - tempPos });
        }
        if (tempSam < 2 && specialRoles.includes('삼겹살')) {
            needs.push({ role: '삼겹살', priority: 2 - tempSam });
        }
        if (tempNoodle < 2 && specialRoles.includes('국수')) {
            needs.push({ role: '국수', priority: 2 - tempNoodle });
        }
        
        if (needs.length > 0) {
            needs.sort((a, b) => b.priority - a.priority);
            w.assignedRole = needs[0].role;
            if (needs[0].role === '포스') tempPos++;
            else if (needs[0].role === '삼겹살') tempSam++;
            else if (needs[0].role === '국수') tempNoodle++;
        } else {
            w.assignedRole = specialRoles[0];
        }
    });
    
    // 일반 직원 배치
    generalStaff.forEach(w => {
        w.assignedRole = '일반';
    });

    // ✅ 알림 메시지 생성
    let alertMessages = [];
    let alertLevel = 'normal';

    // 총 인원 체크 (9명 이하 부족, 13명 이상 과다)
    if (totalCount <= 9) {
        alertMessages.push(`⚠️ 총 근무인원이 부족합니다 (${totalCount}명, 최소 10명 필요)`);
        alertLevel = 'danger';
    } else if (totalCount >= 13) {
        alertMessages.push(`⚠️ 총 근무인원이 너무 많습니다 (${totalCount}명, 최대 12명 권장)`);
        alertLevel = 'danger';
    }

    // 숙련자 인원 체크 (각 파트당 2명 필요)
    if (posCount < 2) {
        const lack = 2 - posCount;
        alertMessages.push(`🔴 포스 인원이 ${lack}명 부족합니다 (현재 ${posCount}명)`);
        alertLevel = 'danger';
    }
    if (samCount < 2) {
        const lack = 2 - samCount;
        alertMessages.push(`🔴 삼겹살 인원이 ${lack}명 부족합니다 (현재 ${samCount}명)`);
        alertLevel = 'danger';
    }
    if (noodleCount < 2) {
        const lack = 2 - noodleCount;
        alertMessages.push(`🔴 국수 인원이 ${lack}명 부족합니다 (현재 ${noodleCount}명)`);
        alertLevel = 'danger';
    }

    // ✅ 인원수 요약 HTML
    let summaryHtml = `
        <div style="background:#f5f5f5; padding:10px; margin-bottom:15px; border-radius:5px; display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:10px; text-align:center;">
            <div><strong>총 인원</strong><br/><span style="font-size:20px; color:${totalCount >= 10 && totalCount <= 12 ? '#4CAF50' : '#f44336'}">${totalCount}명</span></div>
            <div><strong>🎯 포스</strong><br/><span style="font-size:20px; color:${posCount === 2 ? '#4CAF50' : '#f44336'}">${posCount}명</span></div>
            <div><strong>🥩 삼겹살</strong><br/><span style="font-size:20px; color:${samCount === 2 ? '#4CAF50' : '#f44336'}">${samCount}명</span></div>
            <div><strong>🍜 국수</strong><br/><span style="font-size:20px; color:${noodleCount === 2 ? '#4CAF50' : '#f44336'}">${noodleCount}명</span></div>
        </div>
    `;

    // ✅ 알림 영역
    if (alertMessages.length > 0) {
        const bgColor = alertLevel === 'danger' ? '#ffebee' : '#fff3e0';
        const borderColor = alertLevel === 'danger' ? '#f44336' : '#ff9800';
        summaryHtml = `
            <div style="background:${bgColor}; border-left:5px solid ${borderColor}; padding:15px; margin-bottom:15px; border-radius:5px;">
                ${alertMessages.map(msg => `<div style="margin-bottom:5px; font-weight:bold;">${msg}</div>`).join('')}
            </div>
        ` + summaryHtml;
    }

    const badge = document.getElementById('dailyCountBadge');
    if(badge) {
        badge.textContent = `총 ${totalCount}명`;
        badge.style.background = (totalCount >= 10 && totalCount <= 12 && posCount === 2 && samCount === 2 && noodleCount === 2) ? '#4CAF50' : '#f44336';
    }

    // ✅ 근무자 카드
    let cardsHtml = '';
    if (workers.length === 0) {
        cardsHtml = '<p style="text-align:center; color:#999; padding:20px;">오늘은 휴무일입니다.</p>';
    } else {
        workers.forEach(w => {
            const roleColors = {
                '포스': '#e91e63',
                '삼겹살': '#ff5722',
                '국수': '#ff9800',
                '일반': '#9e9e9e'
            };
            
            // 배치된 역할 강조 표시
            let rolesBadge = '';
            if (w.assignedRole) {
                const displayRole = w.assignedRole === '일반' ? '일반' : w.assignedRole;
                const bgColor = roleColors[displayRole] || '#999';
                rolesBadge = `<span style="background:${bgColor}; color:white; padding:3px 8px; border-radius:3px; font-size:12px; margin-right:3px; font-weight:bold; border: 2px solid #fff; box-shadow: 0 0 0 2px ${bgColor};">✓ ${w.assignedRole}</span>`;
                
                // 나머지 가능한 역할 (흐리게)
                w.roles.forEach(r => {
                    if (r !== displayRole && r !== '일반') {
                        rolesBadge += `<span style="background:#ccc; color:#666; padding:2px 6px; border-radius:3px; font-size:11px; margin-right:3px; opacity:0.6;">${r}</span>`;
                    }
                });
            } else {
                // assignedRole이 없는 경우 (이전 방식)
                rolesBadge = w.roles.map(r => {
                    return `<span style="background:${roleColors[r] || '#999'}; color:white; padding:2px 6px; border-radius:3px; font-size:11px; margin-right:3px;">${r}</span>`;
                }).join('');
            }

            // ✅ 임시휴무 직원 스타일 및 버튼 처리
            const cardClass = w.isTempOff ? 'reservation-item temp-off-row' : 'reservation-item';
            const nameStyle = w.isTempOff ? 'style="opacity:0.6;"' : '';
            const timeDisplay = w.isTempOff ? '⛔ 임시휴무' : (w.time || '시간 미정');
            
            const actionButtons = currentUser && currentUser.role !== 'viewer' ? 
                (w.isTempOff ? 
                    `<div style="display:flex; gap:5px;">
                        <button onclick="cancelException(${w.id}, '${dateStr}')" style="padding:5px 10px; background:#4CAF50; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">✓ 복구</button>
                    </div>` :
                    `<div style="display:flex; gap:5px;">
                        <button onclick="openTimeChangeModal(${w.id}, '${dateStr}')" style="padding:5px 10px; background:#17a2b8; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">시간변경</button>
                        <button onclick="markTempOff(${w.id}, '${dateStr}')" style="padding:5px 10px; background:#f44336; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">임시휴무</button>
                    </div>`
                ) : '';

            cardsHtml += `
                <div class="${cardClass}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div style="flex:1;" ${nameStyle}>
                            <div style="margin-bottom:5px;">
                                <strong style="font-size:16px;">${w.name}</strong>
                                <span style="color:#666; font-size:13px; margin-left:8px;">${w.position || '직원'}</span>
                            </div>
                            <div style="margin-bottom:5px;">${rolesBadge}</div>
                            <div class="reservation-time">${timeDisplay}</div>
                        </div>
                        ${actionButtons}
                    </div>
                </div>
            `;
        });
    }

    container.innerHTML = summaryHtml + cardsHtml;
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
            // ✅ 입사일/퇴사일 체크 추가
            const loopDateObj = new Date(dateStr);
            loopDateObj.setHours(0, 0, 0, 0);
            
            if (s.startDate) {
                const startDateObj = new Date(s.startDate);
                startDateObj.setHours(0, 0, 0, 0);
                if (loopDateObj < startDateObj) return; // 입사 전이면 표시 안함
            }
            
            if (s.endDate) {
                const endDateObj = new Date(s.endDate);
                endDateObj.setHours(0, 0, 0, 0);
                if (loopDateObj > endDateObj) return; // 퇴사 후면 표시 안함
            }
            
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
        let tempWorkers = []; // 임시 워커 목록
        
        staffList.forEach(staff => {
            // ✅ 입사일/퇴사일 체크
            const currentIterDateObj = new Date(dateStr);
            currentIterDateObj.setHours(0, 0, 0, 0);
            
            if (staff.startDate) {
                const startDateObj = new Date(staff.startDate);
                startDateObj.setHours(0, 0, 0, 0);
                if (currentIterDateObj < startDateObj) return;
            }
            
            if (staff.endDate) {
                const endDateObj = new Date(staff.endDate);
                endDateObj.setHours(0, 0, 0, 0);
                if (currentIterDateObj > endDateObj) return;
            }
            
            let isWorking = false;
            let isTempOff = false;
            
            // ✅ 예외 처리 (임시 근무 / 임시 휴무)
            if (staff.exceptions && staff.exceptions[dateStr]) {
                const exType = staff.exceptions[dateStr].type;
                if (exType === 'work') {
                    isWorking = true;
                } else if (exType === 'off') {
                    // 임시 휴무 - 카운트에서 제외
                    isTempOff = true;
                    isWorking = false;
                }
            } else {
                if (staff.workDays && staff.workDays.includes(dayKey)) isWorking = true;
            }
            
            if (isWorking && !isTempOff) {
                count++;
                tempWorkers.push({ roles: staff.roles || ['일반'], isTempOff: false });
            }
        });
        
        // ✅ 스마트 배치 로직으로 역할별 카운트
        const roleCounts = calculateSmartRoleCount(tempWorkers);
        let posCount = roleCounts.posCount;
        let samCount = roleCounts.samCount;
        let noodleCount = roleCounts.noodleCount;
        
        let dayClass = '';
        if (currentIterDate.getDay() === 0) dayClass = 'sunday';
        if (currentIterDate.getDay() === 6) dayClass = 'saturday';
        if (currentIterDate.getDate() === realToday.getDate() && 
            currentIterDate.getMonth() === realToday.getMonth() && 
            currentIterDate.getFullYear() === realToday.getFullYear()) {
            dayClass += ' today-highlight';
        }

        // ✅ 알림 체크 (총 인원 10~12명, 각 숙련자 역할 정확히 2명)
        let hasAlert = false;
        if (count <= 9 || count >= 13 || posCount !== 2 || samCount !== 2 || noodleCount !== 2) {
            hasAlert = true;
        }

        const badgeColor = hasAlert ? '#f44336' : '#4CAF50';
        let countStyle = `background: ${badgeColor}; color: white;`;

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

async function markTempOff(id, dateStr) {
    if (!currentUser) { openLoginModal(); return; }
    if (!confirm('이 직원을 임시 휴무 처리하시겠습니까?')) return;
    await callExceptionApi({ id, date: dateStr, type: 'off' });
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
    if (!currentUser || currentUser.role !== 'admin') { 
        alert("사장님만 가능한 기능입니다."); 
        return; 
    }

    if (!confirm('전체 데이터를 백업하시겠습니까?\n백업 파일들이 로컬 PC에 다운로드됩니다.')) {
        return;
    }

    try {
        const response = await fetch('/api/backup/all');
        
        if (!response.ok) {
            throw new Error('백업 생성 실패');
        }
        
        const backupData = await response.json();
        
        // 파일명 날짜/시간 형식
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
        const prefix = `backup_${dateStr}_${timeStr}`;
        
        // 각 카테고리별로 파일 생성
        const files = [
            { name: `${prefix}_staff.json`, data: backupData.staff },
            { name: `${prefix}_logs.json`, data: backupData.logs },
            { name: `${prefix}_accounting.json`, data: backupData.accounting },
            { name: `${prefix}_items.json`, data: backupData.inventory_items },
            { name: `${prefix}_inventory.json`, data: backupData.inventory_current },
            { name: `${prefix}_daily_usage.json`, data: backupData.inventory_usage },
            { name: `${prefix}_orders.json`, data: backupData.inventory_orders },
            { name: `${prefix}_holidays.json`, data: backupData.inventory_holidays },
            { name: `${prefix}_last_orders.json`, data: backupData.inventory_last_orders },
            { name: `${prefix}_inventory_history.json`, data: backupData.inventory_history }
        ];
        
        // 각 파일 순차적으로 다운로드
        for (const file of files) {
            const blob = new Blob([JSON.stringify(file.data, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            // 브라우저가 파일을 처리할 시간 확보
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        alert(`백업이 완료되었습니다!\n총 ${files.length}개 파일이 다운로드되었습니다.\n다운로드 폴더를 확인하세요.`);
        
        // 백업 로그 남기기
        await fetch('/api/logs', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                actor: currentUser.name,
                action: '데이터백업',
                target: '전체 시스템',
                details: `${files.length}개 파일 백업 완료`
            })
        });
        
    } catch (e) { 
        console.error(e); 
        alert('백업 중 오류가 발생했습니다: ' + e.message);
    }
}

// ==========================================
// 직원 등록/수정 모달 함수들
// ==========================================

function openAddModal() {
    if (!currentUser || currentUser.role === 'viewer') {
        alert('권한이 없습니다.');
        return;
    }

    document.getElementById('staffModalTitle').textContent = '직원 등록';
    document.getElementById('staffId').value = '';
    document.getElementById('staffName').value = '';
    document.getElementById('staffPosition').value = '';
    document.getElementById('staffSalaryType').value = 'hourly';
    document.getElementById('staffSalary').value = '';
    document.getElementById('staffTime').value = '';
    document.getElementById('staffStartDate').value = '';
    document.getElementById('staffEndDate').value = '';

    DAY_KEYS.forEach(day => {
        const checkbox = document.getElementById(`day-${day}`);
        if (checkbox) checkbox.checked = false;
    });

    // ✅ 역할 체크박스 초기화
    document.getElementById('role-일반').checked = true;
    document.getElementById('role-포스').checked = false;
    document.getElementById('role-삼겹살').checked = false;
    document.getElementById('role-국수').checked = false;

    document.getElementById('staffModal').style.display = 'flex';
}

function closeStaffModal() {
    document.getElementById('staffModal').style.display = 'none';
}

async function saveStaff() {
    const id = document.getElementById('staffId').value;
    const name = document.getElementById('staffName').value.trim();
    const position = document.getElementById('staffPosition').value.trim();
    const salaryType = document.getElementById('staffSalaryType').value;
    const salary = parseInt(document.getElementById('staffSalary').value) || 0;
    const time = document.getElementById('staffTime').value.trim();
    const startDate = document.getElementById('staffStartDate').value;
    const endDate = document.getElementById('staffEndDate').value;

    if (!name) {
        alert('이름을 입력하세요.');
        return;
    }

    const workDays = [];
    DAY_KEYS.forEach(day => {
        const checkbox = document.getElementById(`day-${day}`);
        if (checkbox && checkbox.checked) {
            workDays.push(day);
        }
    });

    // ✅ 역할 수집
    const roles = [];
    if (document.getElementById('role-일반').checked) roles.push('일반');
    if (document.getElementById('role-포스').checked) roles.push('포스');
    if (document.getElementById('role-삼겹살').checked) roles.push('삼겹살');
    if (document.getElementById('role-국수').checked) roles.push('국수');

    if (roles.length === 0) {
        alert('최소 하나의 역할을 선택해주세요.');
        return;
    }

    const staffData = {
        name, position, salaryType, salary, workDays, time, startDate, endDate, roles
    };

    try {
        if (id) {
            // 수정
            const res = await fetch(`/api/staff/${id}`, {
                method: 'PUT',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ updates: staffData, actor: currentUser.name })
            });
            const json = await res.json();
            if (json.success) {
                alert('직원 정보가 수정되었습니다.');
                closeStaffModal();
                loadStaffData();
            } else {
                alert('수정 실패');
            }
        } else {
            // 등록
            staffData.id = Date.now();
            const res = await fetch('/api/staff', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ staffList: [staffData], actor: currentUser.name })
            });
            const json = await res.json();
            if (json.success) {
                alert('직원이 등록되었습니다.');
                closeStaffModal();
                loadStaffData();
            } else {
                alert('등록 실패');
            }
        }
    } catch (e) {
        console.error(e);
        alert('서버 통신 오류');
    }
}

// 근무 예외 처리 모달
function openExceptionModal(staffId, dateStr) {
    if (!currentUser || currentUser.role === 'viewer') {
        alert('권한이 없습니다.');
        return;
    }

    const staff = staffList.find(s => s.id === staffId);
    if (!staff) return;

    document.getElementById('exceptionStaffName').textContent = staff.name;
    document.getElementById('exceptionDate').textContent = dateStr;
    document.getElementById('exceptionStaffId').value = staffId;
    document.getElementById('exceptionDateVal').value = dateStr;

    let currentException = null;
    if (staff.exceptions && staff.exceptions[dateStr]) {
        currentException = staff.exceptions[dateStr];
    }

    if (currentException) {
        document.getElementById('exceptionType').value = currentException.type;
        if (currentException.time) {
            const [start, end] = currentException.time.split('~');
            const [sh, sm] = start.trim().split(':');
            const [eh, em] = end.trim().split(':');
            document.getElementById('exStartHour').value = sh;
            document.getElementById('exStartMin').value = sm;
            document.getElementById('exEndHour').value = eh;
            document.getElementById('exEndMin').value = em;
        }
    } else {
        document.getElementById('exceptionType').value = 'work';
        if (staff.time) {
            const [start, end] = staff.time.split('~');
            const [sh, sm] = start.trim().split(':');
            const [eh, em] = end.trim().split(':');
            document.getElementById('exStartHour').value = sh;
            document.getElementById('exStartMin').value = sm;
            document.getElementById('exEndHour').value = eh;
            document.getElementById('exEndMin').value = em;
        }
    }

    document.getElementById('exceptionModal').style.display = 'flex';
}

function closeExceptionModal() {
    document.getElementById('exceptionModal').style.display = 'none';
}

async function saveException() {
    const staffId = parseInt(document.getElementById('exceptionStaffId').value);
    const dateStr = document.getElementById('exceptionDateVal').value;
    const type = document.getElementById('exceptionType').value;

    const sh = document.getElementById('exStartHour').value;
    const sm = document.getElementById('exStartMin').value;
    const eh = document.getElementById('exEndHour').value;
    const em = document.getElementById('exEndMin').value;
    const timeStr = `${sh}:${sm}~${eh}:${em}`;

    try {
        await fetch('/api/staff/exception', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                id: staffId, 
                date: dateStr, 
                type: type, 
                time: timeStr,
                actor: currentUser.name 
            })
        });
        closeExceptionModal();
        loadStaffData();
    } catch(e) { 
        alert('오류 발생'); 
    }
}

async function deleteException() {
    const staffId = parseInt(document.getElementById('exceptionStaffId').value);
    const dateStr = document.getElementById('exceptionDateVal').value;

    try {
        await fetch('/api/staff/exception', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                id: staffId, 
                date: dateStr, 
                type: 'delete',
                actor: currentUser.name 
            })
        });
        closeExceptionModal();
        loadStaffData();
    } catch(e) { 
        alert('오류 발생'); 
    }
}

// ==========================================
// 백업 기능
// ==========================================

async function downloadBackup() {
    if (!currentUser) {
        alert('로그인이 필요합니다.');
        openLoginModal();
        return;
    }
    
    // 관리자만 백업 가능
    if (currentUser.role !== 'admin') {
        alert('관리자만 백업을 다운로드할 수 있습니다.');
        return;
    }
    
    if (!confirm('전체 데이터를 백업하시겠습니까?\n백업 파일들이 로컬 PC에 다운로드됩니다.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/backup/all');
        
        if (!response.ok) {
            throw new Error('백업 생성 실패');
        }
        
        const backupData = await response.json();
        
        // 파일명 날짜/시간 형식
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
        const prefix = `backup_${dateStr}_${timeStr}`;
        
        // 각 카테고리별로 파일 생성
        const files = [
            { name: `${prefix}_staff.json`, data: backupData.staff },
            { name: `${prefix}_logs.json`, data: backupData.logs },
            { name: `${prefix}_accounting.json`, data: backupData.accounting },
            { name: `${prefix}_items.json`, data: backupData.inventory_items },
            { name: `${prefix}_inventory.json`, data: backupData.inventory_current },
            { name: `${prefix}_daily_usage.json`, data: backupData.inventory_usage },
            { name: `${prefix}_orders.json`, data: backupData.inventory_orders },
            { name: `${prefix}_holidays.json`, data: backupData.inventory_holidays },
            { name: `${prefix}_last_orders.json`, data: backupData.inventory_last_orders },
            { name: `${prefix}_inventory_history.json`, data: backupData.inventory_history }
        ];
        
        // 각 파일 순차적으로 다운로드
        for (const file of files) {
            const blob = new Blob([JSON.stringify(file.data, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            // 브라우저가 파일을 처리할 시간 확보
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        alert(`백업이 완료되었습니다!\n총 ${files.length}개 파일이 다운로드되었습니다.\n다운로드 폴더를 확인하세요.`);
        
        // 백업 로그 남기기
        await fetch('/api/logs', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                actor: currentUser.name,
                action: '데이터백업',
                target: '전체 시스템',
                details: `${files.length}개 파일 백업 완료`
            })
        });
        
    } catch(e) {
        console.error('백업 실패:', e);
        alert('백업 중 오류가 발생했습니다: ' + e.message);
    }
}