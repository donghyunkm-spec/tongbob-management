// inventory.js - 메인 진입점 (전역 변수, 초기화, 탭 전환)

// ==========================================
// 1. 전역 변수 선언
// ==========================================
let items = {};
let inventory = {};
let lastSavedInventory = {};
let dailyUsage = {};
let holidays = {
    'store': [], 'store_open': [],
    '고센유통': [], '한강유통(고기)': [], '인터넷발주': [], '기타': []
};
let lastOrderDates = {};
let recentHistory = [];

// 화면 상태 변수
let currentLocation = '1루';
let currentStandardVendor = 'all';
let currentSortOrder = 'default'; 
let showWeeklyForced = true;
let checkDateOffset = 0;
let currentConfirmItems = {};
let currentWarnings = {};
let manageSortMode = 'all';

// 재고확인 필터 변수
let checkSearchText = '';
let checkSortKey = 'vendor';
let checkVendorFilter = 'all';

// 미발주 모달용
let currentNoOrderPeriod = 5;

const vendorIdMap = {
    'store': 'store', '고센유통': 'goshen',
    '한강유통(고기)': 'meat', '인터넷발주': 'internet',
    '기타': 'etc_vendor'
};

const API_BASE = '';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ==========================================
// 2. 권한 확인
// ==========================================
function isInventoryAuthorized() {
    if (typeof currentUser === 'undefined' || !currentUser) {
        alert("로그인이 필요합니다.");
        openLoginModal();
        return false;
    }
    return true;
}

// ==========================================
// 3. 초기화 함수
// ==========================================
async function initInventoryTab() {
    if (!isInventoryAuthorized()) return;

    await loadInventoryDataAll();
    renderUnifiedInventoryForm();
    loadHolidays();
}

// ==========================================
// 4. 데이터 로드
// ==========================================
async function loadInventoryDataAll() {
    try {
        const [itemsRes, invRes, usageRes, lastRes, holRes] = await Promise.all([
            fetch('/api/inventory/items'),
            fetch('/api/inventory/current'),
            fetch('/api/inventory/daily-usage'),
            fetch('/api/inventory/last-orders'),
            fetch('/api/inventory/holidays')
        ]);

        const itemsData = await itemsRes.json();
        const invData = await invRes.json();
        const usageData = await usageRes.json();
        const lastData = await lastRes.json();
        const holData = await holRes.json();

        if(itemsData.success) items = itemsData.items;

        if(invData.success) {
            lastSavedInventory = invData.inventory || {};

            // 오늘 날짜 확인
            const todayStr = new Date().toISOString().split('T')[0];

            // 품목별 관리주기 맵 생성
            const itemCycleMap = {};
            Object.keys(items).forEach(vendor => {
                items[vendor].forEach(item => {
                    const key = `${vendor}_${item.품목명}`;
                    itemCycleMap[key] = item.관리주기 || 'daily';
                });
            });

            // 각 위치별로 inventory에 로드
            ['1루', '3루'].forEach(loc => {
                const lastSaveDate = lastSavedInventory[`meta_last_save_${loc}`];
                const prefix = `${loc}_`;

                if (lastSaveDate === todayStr) {
                    // 오늘 저장된 데이터면 모든 품목 로드
                    Object.keys(lastSavedInventory).forEach(key => {
                        if (key.startsWith(prefix)) {
                            inventory[key] = lastSavedInventory[key];
                        }
                    });
                    inventory[`meta_last_save_${loc}`] = lastSaveDate;
                } else {
                    // 다른 날짜면 weekly 품목만 로드 (daily는 0으로 초기화)
                    Object.keys(lastSavedInventory).forEach(key => {
                        if (key.startsWith(prefix) && !key.startsWith('meta_')) {
                            // key에서 vendor_품목명 추출
                            const itemKey = key.replace(prefix, '');
                            const cycle = itemCycleMap[itemKey] || 'daily';
                            if (cycle === 'weekly') {
                                inventory[key] = lastSavedInventory[key];
                            }
                        }
                    });
                }
            });
        }

        if(usageData.success) dailyUsage = usageData.usage;
        if(lastData.success) lastOrderDates = lastData.lastOrders;
        if(holData.success) holidays = holData.holidays;
        if(!holidays['store_open']) holidays['store_open'] = [];

        await loadRecentInventory();
    } catch (e) {
        console.error("데이터 로드 실패", e);
    }
}

// ==========================================
// 5. 탭 전환
// ==========================================
function showInvTab(tabName) {
    document.querySelectorAll('.inv-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('#inventory-content .tab').forEach(el => el.classList.remove('active'));

    const btn = document.querySelector(`button[onclick="showInvTab('${tabName}')"]`);
    if(btn) btn.classList.add('active');

    const content = document.getElementById(`${tabName}-tab`);
    if(content) content.style.display = 'block';

    if (tabName === 'inventory') {
        renderUnifiedInventoryForm();
    } else if (tabName === 'check') {
        checkDateOffset = 0;
        renderInventoryCheck();
    } else if (tabName === 'standard') {
        selectStandardVendor('all');
    } else if (tabName === 'manageItems') {
        renderManageItems();
    } else if (tabName === 'holidays') loadHolidays();
    else if (tabName === 'orderHistory') loadOrderHistory();
}

// ==========================================
// 6. 유틸리티 함수
// ==========================================
function showAlert(msg, type) {
    const div = document.createElement('div');
    div.className = `alert ${type}`;
    div.innerText = msg;
    document.getElementById('alertContainer').appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

function getDaysSince(dateString) {
    if (!dateString) return 999;
    const diff = Math.abs(new Date() - new Date(dateString));
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getThisWeekTuesday() {
    const now = new Date();
    const day = now.getDay(); // 0=일, 1=월, 2=화, ...
    const diff = day >= 2 ? day - 2 : day + 5; // 이번 주 화요일까지의 차이
    const tue = new Date(now);
    tue.setDate(now.getDate() - diff);
    return tue.toISOString().split('T')[0];
}

function getMeatVendorInfo(itemName) {
    let info = { type: 'weight', weight: 1, unit: 'kg', inputUnit: 'kg' };
    const weightMatch = itemName.match(/\/(\d+(?:\.\d+)?)kg\//);
    if (weightMatch) info.weight = parseFloat(weightMatch[1]);
    const unitMatch = itemName.match(/(box|pak|kg|통|ea)$/i);
    if (unitMatch) info.unit = unitMatch[1].toLowerCase();
    return info;
}

// ==========================================
// 7. 스크롤로 숫자 입력 값 변경 방지
// ==========================================
document.addEventListener('wheel', function(e) {
    if (e.target.type === 'number') {
        e.target.blur();
    }
}, { passive: true });
