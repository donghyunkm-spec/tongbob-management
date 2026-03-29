// staff.js - 메인 진입점 (전역 변수, 초기화, 탭 전환)

// ==========================================
// 1. 전역 변수 선언
// ==========================================
let currentUser = null;
let staffList = [];
let currentDate = new Date();
let calendarDate = new Date();
let currentWeekStartDate = new Date();

// 가계부용 전역 변수
let accountingData = { daily: {}, monthly: {} };
let currentAccDate = new Date().toISOString().split('T')[0];
let currentDashboardDate = new Date();
let selectedPredStore = 'all';
let selectedDashStore = 'all';

// 매장 이름 (UI 표시용)
const storeNameKr = '통빱';

// 요일 맵핑
const DAY_MAP = { 'Sun':'일', 'Mon':'월', 'Tue':'화', 'Wed':'수', 'Thu':'목', 'Fri':'금', 'Sat':'토' };
const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ==========================================
// 2. DOMContentLoaded 초기화
// ==========================================
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

    // 주간 기준일 초기화 (월요일 시작)
    const today = new Date();
    const day = today.getDay();
    currentWeekStartDate.setDate(today.getDate() - (day === 0 ? 6 : day - 1));

    // 일일입력 날짜 기본값: 오늘
    const accDateEl = document.getElementById('accDate');
    if (accDateEl && !accDateEl.value) {
        accDateEl.value = new Date().toISOString().split('T')[0];
    }

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

// ==========================================
// 3. UI 초기 설정
// ==========================================
function initStoreSettings() {
    const dispDiv = document.getElementById('divDisposable');
    if(dispDiv) dispDiv.style.display = 'none';
    const delivDiv = document.getElementById('divDeliveryFee');
    if(delivDiv) delivDiv.style.display = 'none';
}

// ==========================================
// 4. 탭 전환 함수
// ==========================================
function switchTab(tabName) {
    document.querySelectorAll('.main-tabs > .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const targetBtn = document.querySelector(`.main-tabs > button[onclick="switchTab('${tabName}')"]`);
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
        if(typeof initInventoryTab === 'function') {
            initInventoryTab();
        }
    } else if(tabName === 'manual') {
        // 첫 진입 시 활성 서브탭 렌더링
        const activeManualSub = document.querySelector('.manual-sub-content[style*="display:block"]');
        if (!activeManualSub || activeManualSub.id === 'manual-inventory') {
            if(typeof renderManual === 'function') renderManual();
        }
    }
}

function switchManualTab(subName) {
    document.querySelectorAll('.manual-sub-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('[id^="manual-tab-btn-"]').forEach(el => el.classList.remove('active'));

    const content = document.getElementById(`manual-${subName}`);
    if(content) content.style.display = 'block';

    const btn = document.getElementById(`manual-tab-btn-${subName}`);
    if(btn) btn.classList.add('active');

    if(subName === 'inventory' && typeof renderManual === 'function') renderManual();
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
