let currentStandardVendor = 'all';
let items = {};
let inventory = {}; // 키 포맷 변경: "1루_업체_품목명", "3루_업체_품목명"
let dailyUsage = {};
let holidays = {
    'store': [],         // 임시 휴무
    'store_open': [],    // [NEW] 임시 영업 (월요일 경기 등)
    '고센유통': [],
    '한강유통(고기)': [],
    '인터넷발주': []
};
let lastOrderDates = {};
let recentHistory = []; 

// 화면 상태 변수
let currentSortOrder = 'default'; 
let allItemsWithInfo = []; 
let currentWarnings = {}; 
let showWeeklyForced = false; 
// [추가] 재고 확인 탭용 날짜 변수
let checkDateOffset = 0; // 0: 오늘, -1: 어제 ...

// [NEW] 현재 작업 중인 매장 위치 (1루 or 3루)
let currentLocation = '1루'; // '1루' or '3루'
let manageSortMode = '1루';  // '1루' or '3루'

const vendorIdMap = {
    'store': 'store',
    '고센유통': 'goshen',
    '한강유통(고기)': 'meat',
    '인터넷발주': 'internet'
};

const API_BASE = '';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// staff.js의 currentUser 참조
function isInventoryAuthorized() {
    if (typeof currentUser === 'undefined' || !currentUser) {
        alert("로그인이 필요합니다.");
        openLoginModal(); 
        return false;
    }
    return true;
}

// 초기화
async function initInventoryTab() {
    if (!isInventoryAuthorized()) return;
    await loadInventoryDataAll();
    renderUnifiedInventoryForm();
    loadHolidays();
}

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
        if(invData.success) inventory = invData.inventory;
        if(usageData.success) dailyUsage = usageData.usage;
        if(lastData.success) lastOrderDates = lastData.lastOrders;
        if(holData.success) holidays = holData.holidays;
        if(!holidays['store_open']) holidays['store_open'] = []; // 호환성

        await loadRecentInventory();
    } catch (e) {
        console.error("데이터 로드 실패", e);
    }
}

// 기존 showInvTab 함수 수정 (check 탭 진입 시 초기화)
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
        checkDateOffset = 0; // 탭 들어오면 '오늘'로 리셋
        renderInventoryCheck();
    } else if (tabName === 'standard') {
        selectStandardVendor('all'); 
    } else if (tabName === 'manageItems') {
        renderManageItems(); 
    } else if (tabName === 'holidays') loadHolidays();
    else if (tabName === 'orderHistory') loadOrderHistory();
}

// [수정] 재고 확인 렌더링 (날짜별 로직 추가)
function renderInventoryCheck() {
    const container = document.getElementById('inventoryCheckList');
    const dateDisplay = document.getElementById('checkDateDisplay');
    const orderBtn = document.getElementById('btnStartOrder');
    
    if (!container) return;

    // 1. 날짜 계산 및 표시
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + checkDateOffset);
    const dateStr = targetDate.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    
    // 헤더 텍스트 설정
    let dayLabel = `${targetDate.getMonth()+1}/${targetDate.getDate()}`;
    if (checkDateOffset === 0) dayLabel += " (오늘)";
    else if (checkDateOffset === -1) dayLabel += " (어제)";
    else if (checkDateOffset === 1) dayLabel += " (내일)";
    
    if(dateDisplay) dateDisplay.innerText = dayLabel;

    // 2. 발주 버튼 활성화 여부 (오늘일 때만 가능)
    if(orderBtn) {
        if (checkDateOffset === 0) {
            orderBtn.style.display = 'block';
        } else {
            orderBtn.style.display = 'none';
        }
    }

    // 3. 데이터 준비
    let displayInventory = {};
    
    if (checkDateOffset === 0) {
        // 오늘: 현재 작업 중인 메모리 사용
        displayInventory = { ...inventory };
    } else if (checkDateOffset > 0) {
        // 미래
        container.innerHTML = `<div style="padding:50px; text-align:center; color:#999;">미래의 데이터는 볼 수 없습니다.</div>`;
        return;
    } else {
        // 과거: recentHistory에서 찾기
        const record = recentHistory.find(r => r.date === dateStr);
        if (record) {
            // 구조 평탄화 (history는 { vendor: { key: val } } 구조일 수 있음)
            // server.js의 저장 구조에 따라 다르지만, 여기서는 history에 1루/3루 키가 다 들어있다고 가정
            // 만약 history가 vendor별로 묶여있다면 풀어줘야 함.
            // server.js 코드를 보니 history.inventory[vendor][itemKey] = val 형태임.
            Object.values(record.inventory).forEach(vendorObj => {
                Object.assign(displayInventory, vendorObj);
            });
        } else {
            container.innerHTML = `<div style="padding:50px; text-align:center; color:#999;">${dateStr} 기록이 없습니다.</div>`;
            return;
        }
    }

    // 4. 테이블 그리기
    let html = `
        <table class="check-table">
            <thead>
                <tr>
                    <th>품목명</th>
                    <th>1루</th>
                    <th>3루</th>
                    <th style="background:#e3f2fd;">합계</th>
                    <th>1일사용</th>
                    <th>차이</th>
                </tr>
            </thead>
            <tbody>
    `;

    // 전체 품목 순회 (업체별)
    Object.keys(items).forEach(vendor => {
        const vendorItems = items[vendor];
        // 업체명 헤더 (Sticky 아님, 스크롤 됨)
        html += `<tr style="background:#f8f9fa;"><td colspan="6" style="text-align:left; font-size:12px; font-weight:bold; color:#555; padding-left:10px;">📦 ${vendor}</td></tr>`;

        vendorItems.forEach(item => {
            const rawItemKey = `${vendor}_${item.품목명}`;
            const stock1 = displayInventory[`1루_${rawItemKey}`] || 0;
            const stock3 = displayInventory[`3루_${rawItemKey}`] || 0;
            const totalStock = stock1 + stock3;
            const usage = dailyUsage[rawItemKey] || 0;
            const diff = totalStock - usage; // 차이 = 합계 - 사용량

            let displayUnit = item.발주단위;
            if (vendor === '한강유통(고기)') displayUnit = getMeatVendorInfo(item.품목명).inputUnit;

            // 차이 색상: 양수면 초록, 음수면 빨강
            const diffClass = (diff >= 0) ? 'diff-plus' : 'diff-minus';
            const diffSign = (diff > 0) ? '+' : '';

            html += `
                <tr>
                    <td>${item.품목명}</td>
                    <td>${stock1}</td>
                    <td>${stock3}</td>
                    <td class="check-val" style="background:#e3f2fd;">${totalStock}</td>
                    <td>${usage}</td>
                    <td class="${diffClass} check-val">${diffSign}${parseFloat(diff.toFixed(1))}</td>
                </tr>
            `;
        });
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

// [신규] 발주 프로세스 시작 버튼 (경고창 -> 발주창)
function triggerOrderProcess() {
    console.log('[DEBUG] 발주진행 버튼 클릭됨');
    console.log('[DEBUG] checkDateOffset:', checkDateOffset);
    
    if (checkDateOffset !== 0) {
        showAlert('오늘 날짜에서만 발주가 가능합니다.', 'error');
        return;
    }
    
    console.log('[DEBUG] items:', items);
    console.log('[DEBUG] inventory:', inventory);
    
    // 기존의 검증 로직 호출
    checkOrderConfirmation();
}



// 메인 화면 표시
async function showMainScreen() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display = 'block';
    
    await loadData();
    await loadRecentInventory(); 
    renderUnifiedInventoryForm();
    renderStandardForm();
    loadHolidays();
}

// 데이터 로드
async function loadData() {
    try {
        const itemsRes = await fetch(`${API_BASE}/api/inventory/items`);
        const itemsData = await itemsRes.json();
        if (itemsData.success) {
            items = itemsData.items;
        }
        
        const inventoryRes = await fetch(`${API_BASE}/api/inventory/current`);
        const inventoryData = await inventoryRes.json();
        if (inventoryData.success) {
            inventory = inventoryData.inventory;
        }
        
        const usageRes = await fetch(`${API_BASE}/api/inventory/daily-usage`);
        const usageData = await usageRes.json();
        if (usageData.success) {
            dailyUsage = usageData.usage;
        }
        
        const lastOrderRes = await fetch(`${API_BASE}/api/inventory/last-orders`);
        const lastOrderData = await lastOrderRes.json();
        if (lastOrderData.success) {
            lastOrderDates = lastOrderData.lastOrders;
        }
        
    } catch (error) {
        console.error('데이터 로드 실패 (로컬 모드일 수 있음):', error);
    }
}

// 탭 전환
function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const btn = document.querySelector(`button[onclick="showTab('${tabName}')"]`);
    if(btn) btn.classList.add('active');

    const content = document.getElementById(`${tabName}-tab`);
    if(content) content.classList.add('active');
    
    if (tabName === 'inventory') {
        renderUnifiedInventoryForm();
    } else if (tabName === 'standard') {
        renderStandardForm();
    } else if (tabName === 'holidays') {
        loadHolidays();
    } else if (tabName === 'inventoryHistory') {
        loadInventoryHistory();
    } else if (tabName === 'orderHistory') {
        loadOrderHistory();
    } else if (tabName === 'manageItems') {
        renderManageItems();
    }
}

function scrollToVendor(vendor) {
    const section = document.getElementById(`vendor-section-${vendor}`);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// === [기타 공통 함수들] ===
function toggleWeeklyItems() {
    showWeeklyForced = !showWeeklyForced;
    renderUnifiedInventoryForm();
}

// 입력값 메모리 저장
function saveCurrentInputToMemory() {
    // 현재 화면에 있는 input들만 읽어서 inventory 메모리에 업데이트
    const inputs = document.querySelectorAll('input[id^="current_"]');
    inputs.forEach(input => {
        if (!input) return;
        const key = input.id.replace('current_', '');
        const val = input.value.trim();
        inventory[key] = val === '' ? 0 : parseFloat(val);
    });
}

function renderUnifiedInventoryForm() {
    const formContainer = document.getElementById('inventoryForm');
    if (!formContainer) return;
    
    // 상단 컨트롤 바 (Sticky) - 여기가 유일한 컨트롤 영역이 됩니다.
    let html = `
        <div class="sticky-header-bar">
            <div style="display:flex; gap:5px; flex:1;">
                <button class="btn-loc-select ${currentLocation==='1루'?'active':''}" onclick="setLocation('1루')">⚾ 1루</button>
                <button class="btn-loc-select ${currentLocation==='3루'?'active':''}" onclick="setLocation('3루')">⚾ 3루</button>
            </div>
            <button onclick="saveInventory()" class="btn-sticky-action">💾 저장</button>
        </div>
        
        <div style="margin-bottom:10px; display:flex; gap:10px; justify-content:flex-end; font-size:12px;">
             <button class="filter-btn" id="sortOrderBtn" onclick="toggleSortOrder()" style="padding:5px 10px; border:1px solid #ddd; background:white; border-radius:15px;">
                ${currentSortOrder === 'lastOrder' ? '📅 기본 순서로' : '📅 발주일 오래된 순'}
             </button>
             <button id="toggleWeeklyBtn" onclick="toggleWeeklyItems()" style="padding:5px 10px; border:1px solid #ddd; background:white; border-radius:15px;">
                ${showWeeklyForced ? '✅ 주간품목 포함' : '🔄 주간품목 보기'}
             </button>
             <button class="filter-btn" onclick="showLongTermNoOrder()" style="padding:5px 10px; border:1px solid #ddd; background:white; border-radius:15px; color:#d32f2f;">
                ⚠️ 미발주
             </button>
        </div>
    `;

    const today = new Date();
    const isTuesday = today.getDay() === 2;
    
    let allDisplayItems = [];
    Object.keys(items).forEach(vendor => {
        items[vendor].forEach(item => {
            const sortKey = (currentLocation === '1루') ? (item.sort1 ?? 9999) : (item.sort3 ?? 9999);
            allDisplayItems.push({ ...item, vendor, sortKey });
        });
    });

    // 정렬 로직
    if (currentSortOrder === 'lastOrder') {
        allDisplayItems.sort((a, b) => {
            const dateA = lastOrderDates[`${a.vendor}_${a.품목명}`] || '0000-00-00';
            const dateB = lastOrderDates[`${b.vendor}_${b.품목명}`] || '0000-00-00';
            return dateA.localeCompare(dateB); // 오래된(작은) 날짜가 먼저 오도록
        });
    } else {
        allDisplayItems.sort((a, b) => a.sortKey - b.sortKey);
    }

    let hasItems = false;
    html += `<div style="background:white; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1);">`;

    allDisplayItems.forEach(item => {
        // [NEW] 위치 필터링: 현재 위치에 해당하지 않는 품목은 표시 안 함
        if (item.locations && item.locations.length > 0) {
            if (!item.locations.includes(currentLocation)) {
                return; // skip
            }
        }
        // locations 필드가 없는 기존 품목은 모든 위치에서 표시 (하위 호환성)
        
        if (item.관리주기 === 'weekly' && !isTuesday && !showWeeklyForced) return;

        hasItems = true;
        const rawItemKey = `${item.vendor}_${item.품목명}`;
        const locItemKey = `${currentLocation}_${rawItemKey}`;
        
        const currentStock = inventory[locItemKey] || 0;
        
        // 전일 재고 찾기
        let yesterdayStock = '-';
        let prevVal = null;
        const lastRecord = recentHistory.find(r => r.date !== today.toISOString().split('T')[0]);
        if (lastRecord && lastRecord.inventory[item.vendor]) {
             // 데이터 구조 호환성 체크 (벤더별 묶음 vs 플랫 키)
             // 기존 server.js 로직상 history.inventory[vendor][locItemKey] 형태로 저장됨
             prevVal = lastRecord.inventory[item.vendor][locItemKey];
             if(prevVal !== undefined) yesterdayStock = prevVal;
        }

        let displayUnit = item.발주단위;
        if (item.vendor === '한강유통(고기)') displayUnit = getMeatVendorInfo(item.품목명).inputUnit;
        
        const lastDate = lastOrderDates[rawItemKey];
        const daysSince = lastDate ? getDaysSince(lastDate) : 999;
        const isAlert = (daysSince >= 7);

        html += `
            <div class="item-row-compact" style="${item.중요도 === '상' ? 'background-color:#fff8e1;' : ''}">
                <div class="irc-name">
                    <span>
                        ${item.품목명} 
                        <span style="font-weight:normal; font-size:11px; color:#888;">(${item.vendor.substr(0,2)})</span>
                        ${isAlert ? '<span style="color:red; font-size:10px;">⚠️</span>' : ''}
                        ${item.관리주기 === 'weekly' ? '<span style="color:blue; font-size:10px;">[주간]</span>' : ''}
                    </span>
                </div>
                
                <div class="irc-controls">
                    <div class="irc-stat-box prev-stat">
                        <span class="irc-stat-val" style="color:#888;">${yesterdayStock}</span>
                        <span>전일</span>
                    </div>

                    <button type="button" class="btn-up-copy" 
                        onclick="setStockValue('${locItemKey}', ${prevVal !== null ? prevVal : 0})"
                        style="margin-right:5px;">
                        불러<br>오기
                    </button>

                    <div class="irc-input-wrapper">
                        <input type="number" id="current_${locItemKey}" class="irc-input" 
                            value="${currentStock === 0 ? '' : currentStock}" 
                            placeholder="0" inputmode="decimal" 
                            onchange="updateInventoryMemory('${locItemKey}', this.value)">
                    </div>
                    <span style="font-size:12px; margin-left:2px; color:#555; width:20px;">${displayUnit}</span>
                </div>
            </div>
        `;
    });
    
    html += `</div>`;
    if (!hasItems) html += '<p style="text-align:center; padding:20px;">표시할 품목이 없습니다.</p>';
    formContainer.innerHTML = html;
}

function renderItemGroup(vendor, item, locItemKey, rawItemKey, lastOrderDate, daysSince) {
    // locItemKey: 1루_고센유통_양파 (현재 입력창 ID용)
    // rawItemKey: 고센유통_양파 (데이터 조회용)
    
    const currentStock = inventory[locItemKey] || 0;
    const usage = dailyUsage[rawItemKey] || 0; // 사용량은 통합 관리
    
    // 어제 재고 확인 (같은 위치의 어제 재고)
    let yesterdayStock = null;
    const todayStr = new Date().toISOString().split('T')[0];
    const lastRecord = recentHistory.find(r => r.date !== todayStr);
    if (lastRecord && lastRecord.inventory[vendor]) {
         // 과거 기록도 위치별 키로 저장되어 있다고 가정
         const val = lastRecord.inventory[vendor][locItemKey];
         if (val !== undefined) yesterdayStock = val;
    }

    let displayUnit = item.발주단위;
    if (vendor === '한강유통(고기)') {
        const meatVendorInfo = getMeatVendorInfo(item.품목명);
        displayUnit = meatVendorInfo.inputUnit;
    }
    
    const displayStockValue = (currentStock === 0) ? '' : currentStock;
    
    // 발주 표시 등은 기존과 동일
    let lastOrderDisplay = '';
    if (lastOrderDate) {
        const daysColor = daysSince > 10 ? '#f44336' : (daysSince > 7 ? '#ef6c00' : '#999');
        lastOrderDisplay = `<span style="font-size:11px; font-weight:normal; color:${daysColor}; margin-left:8px;">📅 ${daysSince}일전</span>`;
    }

    let prevValueDisplay = '-';
    let btnDisabled = 'disabled';
    let btnOnClick = '';

    if (yesterdayStock !== null) {
        prevValueDisplay = yesterdayStock;
        btnDisabled = '';
        btnOnClick = `onclick="setStockValue('${locItemKey}', ${yesterdayStock})"`;
    }

    let cycleBadge = '';
    if (item.관리주기 === 'weekly') {
        cycleBadge = `<span style="background-color:#E3F2FD; color:#1565C0; font-size:11px; padding:2px 6px; border-radius:4px; margin-left:6px; border: 1px solid #BBDEFB; font-weight:bold;">매주 화요일</span>`;
    }

    // HTML 구조
    return `
        <div class="item-group compact-group">
            <div class="item-header-compact">
                <span class="item-name" style="display: flex; align-items: center; flex-wrap: wrap;">
                    ${item.품목명}
                    ${cycleBadge} ${lastOrderDisplay}
                </span>
                ${item.중요도 ? `<span class="item-importance importance-${item.중요도}">${item.중요도}</span>` : ''}
            </div>

            <div class="inventory-row-controls">
                <div class="control-cell prev-cell">
                    <span class="cell-label">전일(${currentLocation})</span>
                    <div class="prev-value-box">
                        <span class="value">${prevValueDisplay}</span>
                        <span class="unit">${displayUnit}</span>
                    </div>
                </div>

                <div class="control-cell btn-cell">
                    <span class="cell-label">어제값</span>
                    <button type="button" class="btn-same ${yesterdayStock !== null ? '' : 'disabled'}" ${btnOnClick} ${btnDisabled}>↑</button>
                </div>

                <div class="control-cell input-cell">
                    <span class="cell-label">현재재고(${currentLocation})</span>
                    <div class="input-wrapper">
                        <input type="number" id="current_${locItemKey}" value="${displayStockValue}" 
                               min="0" step="0.1" inputmode="decimal" placeholder="0" onchange="updateInventoryMemory('${locItemKey}', this.value)">
                        <span class="unit">${displayUnit}</span>
                    </div>
                </div>
                
                <div class="control-cell usage-cell">
                    <span class="cell-label">통합사용</span>
                    <div class="usage-wrapper">
                        <span class="usage-value">${usage}</span>
                        <span class="unit">${displayUnit}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// 1루/3루 탭 변경
function setLocation(loc) {
    saveCurrentInputToMemory();
    currentLocation = loc;
    renderUnifiedInventoryForm();
}


function captureStandardInput() {
    // 전체 업체 다 훑어서 저장 (탭이 'all'일 수도 있으므로)
    Object.keys(items).forEach(vendor => {
        items[vendor].forEach(item => {
            const itemKey = `${vendor}_${item.품목명}`;
            const input = document.getElementById(`usage_${itemKey}`);
            if (input) dailyUsage[itemKey] = input.value === '' ? 0 : parseFloat(input.value);
        });
    });
}

// 2. [수정] 업체 탭 변경 함수
function selectStandardVendor(vendor) {
    // 탭을 바꾸기 전에, 현재 입력된 값들을 먼저 저장(캡처)함
    captureStandardInput();
    currentStandardVendor = vendor;
    renderStandardForm();
}

function renderStandardForm() {
    const formContainer = document.getElementById('standardForm');
    if (!formContainer) return;
    
    let headerHtml = `
        <div class="sticky-header-bar">
            <div class="vendor-selector" style="margin:0; flex:1; display:flex; gap:5px; overflow-x:auto;">
                <button class="vendor-btn ${currentStandardVendor==='all'?'active':''}" onclick="selectStandardVendor('all')">전체</button>
                <button class="vendor-btn ${currentStandardVendor==='고센유통'?'active':''}" onclick="selectStandardVendor('고센유통')">고센</button>
                <button class="vendor-btn ${currentStandardVendor==='한강유통(고기)'?'active':''}" onclick="selectStandardVendor('한강유통(고기)')">고기</button>
                <button class="vendor-btn ${currentStandardVendor==='인터넷발주'?'active':''}" onclick="selectStandardVendor('인터넷발주')">인터넷</button>
            </div>
            <button onclick="saveStandard()" class="btn-sticky-action" style="background:#1976D2;">💾 저장</button>
        </div>
    `;

    const targetVendors = (currentStandardVendor === 'all') ? Object.keys(items) : [currentStandardVendor];
    let listHtml = '<div style="background:white; border-radius:8px; border:1px solid #eee;">';
    
    targetVendors.forEach(vendor => {
        items[vendor].forEach(item => {
            const itemKey = `${vendor}_${item.품목명}`;
            const usage = dailyUsage[itemKey] || 0;
            let displayUnit = item.발주단위;
            if (vendor === '한강유통(고기)') displayUnit = getMeatVendorInfo(item.품목명).inputUnit;

            listHtml += `
                <div class="standard-row" style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:bold;">
                        <span style="font-size:10px; background:#eee; padding:2px 4px; border-radius:3px; margin-right:5px; color:#555;">${vendor}</span>
                        ${item.품목명}
                    </div>
                    <div style="display:flex; align-items:center;">
                        <input type="number" id="usage_${itemKey}" value="${usage===0?'':usage}" 
                            placeholder="0" inputmode="decimal" 
                            style="width:70px; padding:8px; text-align:right; border:1px solid #ddd; border-radius:4px; font-size:15px; font-weight:bold;">
                        <span style="margin-left:5px; font-size:12px; width:30px;">${displayUnit}</span>
                    </div>
                </div>
            `;
        });
    });
    listHtml += '</div>';
    formContainer.innerHTML = headerHtml + listHtml;
}

// [수정 3] 저장 함수 (저장 후 UI가 깨지지 않도록 보장)
async function saveInventory() {
    saveCurrentInputToMemory(); // 1. 현재 입력값 메모리에 저장

    // 버튼 피드백 (저장 중...)
    const saveBtn = document.querySelector('.btn-sticky-action');
    if(saveBtn) {
        saveBtn.textContent = '⏳ 저장중...';
        saveBtn.disabled = true;
    }

    try {
        // 2. 서버로 전송
        const response = await fetch(`${API_BASE}/api/inventory/current`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inventory: inventory })
        });
        const result = await response.json();
        
        if (result.success) {
            inventory = result.inventory; // 서버에서 최신본 동기화
            showAlert('저장되었습니다.', 'success');
        } else {
            showAlert('저장 실패: 서버 오류', 'error');
        }
    } catch (e) {
        console.error(e);
        showAlert('저장 실패 (네트워크 오류)', 'error');
    } finally {
        // 버튼 상태만 복구 (전체 폼 재렌더링 제거)
        if(saveBtn) {
            saveBtn.textContent = '💾 저장';
            saveBtn.disabled = false;
        }
    }
}

// [신규] 재고 확인 탭 날짜 변경
function changeCheckDate(delta) {
    checkDateOffset += delta;
    renderInventoryCheck();
}

function getDaysUntilNextDelivery(vendor) {
    const today = new Date();
    let daysCount = 0;
    let checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() + 1); // 내일부터 시작
    
    // 최대 7일까지만 확인
    for (let i = 0; i < 7; i++) {
        const dateStr = checkDate.toISOString().split('T')[0];
        const dow = checkDate.getDay();
        
        // 가게 휴무 여부
        const isStoreRegularHoliday = (dow === 1); // 월요일
        const isStoreTempHoliday = holidays['store'] && holidays['store'].includes(dateStr);
        const isStoreTempOpen = holidays['store_open'] && holidays['store_open'].includes(dateStr);
        const isStoreClosed = (isStoreRegularHoliday && !isStoreTempOpen) || isStoreTempHoliday;
        
        // 업체 배송 가능 여부
        const isSundayForVendor = (vendor === '고센유통' || vendor === '한강유통(고기)') && dow === 0;
        const isVendorHoliday = holidays[vendor] && holidays[vendor].includes(dateStr);
        const isDeliveryPossible = !isSundayForVendor && !isVendorHoliday;
        
        // 내일(i=0)은 항상 포함 (오늘 발주하는 이유)
        if (i === 0) {
            // 가게가 영업하는 날만 재료 소모
            if (!isStoreClosed) {
                daysCount++;
            }
        } else {
            // 그 다음날부터: 배송 가능한 날이면 루프 종료
            if (isDeliveryPossible) {
                break;
            }
            
            // 배송 불가능한 날이라면 버텨야 함
            // 단, 가게가 쉬는 날은 재료를 안 쓰므로 카운트 안 함
            if (!isStoreClosed) {
                daysCount++;
            }
        }
        
        checkDate.setDate(checkDate.getDate() + 1);
    }
   
    return Math.max(1, daysCount);
}

function getDeliveryInfo(vendor) {
    const today = new Date();
    const daysNeeded = getDaysUntilNextDelivery(vendor);
    
    // 실제 배송일 찾기 (다음 배송 가능하고 가게도 영업하는 날)
    let deliveryDate = new Date(today);
    deliveryDate.setDate(deliveryDate.getDate() + 1); // 내일부터
    
    for (let i = 0; i < 7; i++) {
        const dow = deliveryDate.getDay();
        const dateStr = deliveryDate.toISOString().split('T')[0];
        
        // 가게 영업 여부
        const isStoreRegularHoliday = (dow === 1); // 월요일
        const isStoreTempHoliday = holidays['store'] && holidays['store'].includes(dateStr);
        const isStoreTempOpen = holidays['store_open'] && holidays['store_open'].includes(dateStr);
        const isStoreOpen = (!isStoreRegularHoliday || isStoreTempOpen) && !isStoreTempHoliday;
        
        // 업체 배송 가능 여부
        const isSundayForVendor = (vendor === '고센유통' || vendor === '한강유통(고기)') && dow === 0;
        const isVendorHoliday = holidays[vendor] && holidays[vendor].includes(dateStr);
        const isDeliveryPossible = !isSundayForVendor && !isVendorHoliday;
        
        // 배송 가능하고 가게도 영업하는 날
        if (isDeliveryPossible && isStoreOpen) {
            break;
        }
        deliveryDate.setDate(deliveryDate.getDate() + 1);
    }
    
    const year = deliveryDate.getFullYear();
    const month = deliveryDate.getMonth() + 1;
    const date = deliveryDate.getDate();
    const dayOfWeek = WEEKDAYS[deliveryDate.getDay()];
    
    return {
        deliveryDate: deliveryDate,
        year: year,
        month: month,
        date: date,
        dayOfWeek: dayOfWeek,
        shortFormat: `${month}/${date}(${dayOfWeek})`,
        fullFormat: `${year}년 ${month}월 ${date}일 ${dayOfWeek}요일`,
        days: daysNeeded
    };
}

// 발주 확인 로직
function checkOrderConfirmation() {
    console.log('[DEBUG] checkOrderConfirmation 시작');
    const confirmItems = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [] };
    
    for (const vendor in items) {
        const vendorItems = items[vendor];
        console.log(`[DEBUG] ${vendor} 품목 수:`, vendorItems.length);
        const daysNeeded = getDaysUntilNextDelivery(vendor); // 다음 배송일까지 필요한 일수
        
        vendorItems.forEach(item => {
            const rawItemKey = `${vendor}_${item.품목명}`;
            
            // 통합 재고 (1루 + 3루)
            const stock1 = inventory[`1루_${rawItemKey}`] || 0;
            const stock3 = inventory[`3루_${rawItemKey}`] || 0;
            const totalStock = stock1 + stock3;
            
            const usage = dailyUsage[rawItemKey] || 0;
            const neededTotal = usage * daysNeeded; // 배송 전까지 필요한 양
            
            let orderAmountRaw = Math.max(0, neededTotal - totalStock); // 부족분
            
            // 🔥 [NEW] 임계값/최소발주량 로직 적용
            if (item.thresholdQty && item.minOrderQty) {
                // 임계값과 최소발주량이 모두 설정된 경우
                if (totalStock <= item.thresholdQty) {
                    // 재고가 임계값 이하면 무조건 최소발주량으로 발주
                    orderAmountRaw = item.minOrderQty;
                } else {
                    // 재고가 임계값 초과면 발주 안함
                    orderAmountRaw = 0;
                }
            }
            // 설정 안된 경우는 기존 방식대로 (orderAmountRaw 그대로 사용)
            
            let displayQty = 0;
            let displayUnit = item.발주단위;

            // 단위 변환 (고기 등)
            if (vendor === '한강유통(고기)') {
                const meatInfo = getMeatVendorInfo(item.품목명);
                displayUnit = meatInfo.unit;
                if (orderAmountRaw > 0) {
                    const packs = Math.ceil(orderAmountRaw / meatInfo.weight);
                    displayQty = (meatInfo.type === 'weight' && meatInfo.unit === 'kg') ? packs * meatInfo.weight : packs;
                }
            } else if (vendor === '고센유통') {
                if (orderAmountRaw > 0) displayQty = Math.ceil(orderAmountRaw);
            } else {
                displayQty = Math.round(orderAmountRaw * 10) / 10;
            }
            
            // 0개라도 리스트에는 포함시켜서 보여주는 게 좋음 (상태 확인용)
            // 하지만 모달에는 '발주할 것'만 띄우는 게 일반적.
            // 여기서는 0개 이상인 것만 담되, 중요 품목이 0이면 경고
            let reason = '';
            if (displayQty === 0 && item.중요도 === '상' && totalStock < neededTotal) {
                 // 재고가 부족한데 발주량이 0? (단위 이슈 등) -> 일단 포함
                 reason = '확인필요';
            }
            
            if (displayQty > 0 || reason) {
                const obj = {
                    ...item,
                    itemKey: rawItemKey,
                    currentStock: totalStock,
                    stock1, stock3,
                    orderAmount: displayQty,
                    displayUnit,
                    reason,
                    daysNeeded // 며칠치인지
                };
                confirmItems[vendor].push(obj);
            }
        });
    }

    // 발주할 게 있든 없든 모달 띄우기 (사용자 피드백 확실하게)
    showConfirmModal(confirmItems);
}

// 모달 표시
function showConfirmModal(confirmItems) {
    console.log('[DEBUG] showConfirmModal 호출됨');
    console.log('[DEBUG] confirmItems:', confirmItems);
    
    const modal = document.getElementById('confirmModal');
    const content = document.getElementById('confirmContent');
    
    console.log('[DEBUG] modal element:', modal);
    console.log('[DEBUG] content element:', content);
    
    let html = '';
    let hasAnyItem = false;
    
    for (const vendor in confirmItems) {
        const list = confirmItems[vendor];
        if (list.length > 0) {
            hasAnyItem = true;
            const dInfo = getDeliveryInfo(vendor); 
            html += `<div class="delivery-info-box">
                <h3>📦 ${dInfo.fullFormat} 배송 품목</h3>
                <p style="font-size:14px; color:#666;">${vendor} ${dInfo.days}일치로 계산된 재고량입니다</p>
            </div>
            <table class="confirm-table">
                <thead><tr><th>품목</th><th>재고(1루+3루)</th><th>발주량</th></tr></thead>
                <tbody>`;
            
            list.forEach(i => {
                html += `<tr>
                    <td>${i.품목명}<br><span style="font-size:10px;color:red">${i.reason}</span></td>
                    <td>${i.currentStock} <span style="font-size:10px; color:#888;">(${i.stock1}+${i.stock3})</span></td>
                    <td><strong style="color:#1976D2; font-size:15px;">${i.orderAmount} ${i.displayUnit}</strong></td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }
    }

    if (!hasAnyItem) {
        html = `
            <div style="text-align:center; padding:30px;">
                <p style="font-size:16px; margin-bottom:10px;">✅ 모든 재고가 충분합니다.</p>
                <p style="color:#888; font-size:13px;">(설정된 사용량 기반)</p>
            </div>
        `;
    }

    content.innerHTML = html;
    console.log('[DEBUG] 모달 HTML 설정 완료');
    console.log('[DEBUG] modal 현재 class:', modal.className);
    
    modal.classList.add('active');
    console.log('[DEBUG] modal active 클래스 추가 후:', modal.className);
    console.log('[DEBUG] 모달 표시 완료');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

async function proceedToOrder() {
    closeConfirmModal();
    const orderData = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [] };
    const currentInventoryCopy = { ...inventory };

    for (const vendor in items) {
        const vendorItems = items[vendor];
        const daysNeeded = getDaysUntilNextDelivery(vendor);
        
        vendorItems.forEach(item => {
            const rawItemKey = `${vendor}_${item.품목명}`;
            const s1 = inventory[`1루_${rawItemKey}`] || 0;
            const s3 = inventory[`3루_${rawItemKey}`] || 0;
            const totalStock = s1 + s3;
            const usage = dailyUsage[rawItemKey] || 0;
            const needed = usage * daysNeeded;
            let rawAmt = Math.max(0, needed - totalStock);
            
            // 🔥 [NEW] 임계값/최소발주량 로직 적용
            if (item.thresholdQty && item.minOrderQty) {
                if (totalStock <= item.thresholdQty) {
                    rawAmt = item.minOrderQty;
                } else {
                    rawAmt = 0;
                }
            }
            
            let finalQty = 0;
            let finalUnit = item.발주단위;
            
            if (vendor === '한강유통(고기)') {
                const mInfo = getMeatVendorInfo(item.품목명);
                finalUnit = mInfo.unit;
                if(rawAmt > 0) finalQty = (mInfo.type==='weight' && mInfo.unit==='kg') 
                    ? Math.ceil(rawAmt/mInfo.weight)*mInfo.weight : Math.ceil(rawAmt/mInfo.weight);
            } else if (vendor === '고센유통') {
                if(rawAmt > 0) finalQty = Math.ceil(rawAmt);
            } else {
                finalQty = Math.round(rawAmt*10)/10;
            }

            if (finalQty > 0) {
                orderData[vendor].push({ ...item, orderAmount: finalQty, daysNeeded, displayUnit: finalUnit });
            }
        });
    }
    
    // 서버 전송
    const today = new Date();
    const orderRecord = {
        date: today.toISOString().split('T')[0],
        time: today.toTimeString().split(' ')[0].substring(0, 5),
        orders: orderData,
        inventory: currentInventoryCopy,
        warnings: currentWarnings 
    };

    try {
        await fetch(`${API_BASE}/api/inventory/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderRecord)
        });
        currentWarnings = {}; 
        showOrderModal(orderData);
    } catch (error) { console.error(error); }
}

function showOrderModal(orderData) {
    const modal = document.getElementById('orderModal');
    const content = document.getElementById('orderContent');
    let html = '';
    
    for (const vendor in orderData) {
        const items = orderData[vendor];
        if (items.length > 0) {
            let actionBtn = (vendor === '한강유통(고기)') 
                ? `<button onclick="goToOrderHistory()" class="btn-goto-history">📂 내역</button>`
                : `<button onclick="copyVendorOrder('${vendor}')" class="btn-mini-kakao">💬 복사</button>`;

            html += `
                <div class="order-section">
                    <div class="order-section-header">
                        <h3>${vendor} (${items[0].daysNeeded}일치)</h3>
                        ${actionBtn}
                    </div>
                    <div class="order-items" id="order_${vendor}">`;
            items.forEach(item => {
                const displayUnit = item.displayUnit || item.발주단위;
                html += `${item.품목명} ${item.orderAmount}${displayUnit}\n`;
            });
            html += `</div></div>`;
        }
    }
    
    if (!html) html = '<p style="text-align: center; color: #999;">발주할 품목이 없습니다.</p>';
    content.innerHTML = html;
    modal.classList.add('active');
}

function goToOrderHistory() {
    closeOrderModal();
    document.getElementById('orderDateFilter').valueAsDate = new Date();
    showTab('orderHistory'); 
    loadOrderHistory();      
}

function copyVendorOrder(vendor) {
    const itemContainer = document.getElementById(`order_${vendor}`);
    if (!itemContainer) return;
    const itemsText = itemContainer.textContent.trim();
    
    const dInfo = getDeliveryInfo(vendor);
    
    let copyText = (vendor === '고센유통') 
        ? `안녕하세요 통빱입니다.\n${dInfo.month}월 ${dInfo.date}일 ${dInfo.dayOfWeek}요일 입고 품목 주문합니다.\n\n${itemsText}\n\n감사합니다.`
        : `안녕하세요 통빱입니다.\n${dInfo.month}월 ${dInfo.date}일 ${dInfo.dayOfWeek}요일 입고 품목 주문합니다.\n\n${itemsText}\n\n감사합니다.`;
    
    navigator.clipboard.writeText(copyText).then(() => {
        showAlert(`${vendor} 발주서 복사 완료!`, 'success');
    });
}

function closeOrderModal() {
    document.getElementById('orderModal').classList.remove('active');
    renderUnifiedInventoryForm();
}

// inventory.js - 기존 copyToKakao 함수 교체
function copyToKakao() {
    const today = new Date();
    const month = today.getMonth() + 1;
    const date = today.getDate();
    const time = `${today.getHours()}:${String(today.getMinutes()).padStart(2, '0')}`;

    let copyText = `📦 [발주 리스트]\n📅 ${month}/${date} (${time}) 작성\n----------------------------\n`;
    
    // 화면에 렌더링된 데이터를 기반으로 텍스트 생성
    const orderSections = document.querySelectorAll('.order-section');
    
    orderSections.forEach(section => {
        const vendorFullText = section.querySelector('h3').textContent; // "고센유통 (2일치)" 형태
        const vendor = vendorFullText.split('(')[0].trim(); // 업체명만 추출
        const itemsText = section.querySelector('.order-items').innerText;
        
        // 업체별 배송일 정보 가져오기
        const dInfo = getDeliveryInfo(vendor);
        
        copyText += `\n■ ${vendor}\n`;
        copyText += `   ${dInfo.month}월 ${dInfo.date}일 ${dInfo.dayOfWeek}요일 입고 (${dInfo.days}일치)\n`;
        
        // 품목 리스트
        const lines = itemsText.split('\n');
        lines.forEach(line => {
            if(line.trim()) {
                copyText += `   ▫️ ${line.trim()}\n`; 
            }
        });
    });
    
    copyText += `\n----------------------------\n통빱 재고관리`;

    navigator.clipboard.writeText(copyText).then(() => {
        showAlert('발주 리스트 복사 완료! 📋', 'success');
    }).catch(err => {
        console.error('복사 실패:', err);
        showAlert('복사 실패', 'error');
    });
}

function captureStandardInput() {
    Object.keys(items).forEach(vendor => {
        items[vendor].forEach(item => {
            const itemKey = `${vendor}_${item.품목명}`;
            const input = document.getElementById(`usage_${itemKey}`);
            if (input) dailyUsage[itemKey] = input.value === '' ? 0 : parseFloat(input.value);
        });
    });
}

async function saveStandard() {
    captureStandardInput();
    try {
        const response = await fetch(`${API_BASE}/api/inventory/daily-usage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usage: dailyUsage })
        });
        if (await response.json().then(r=>r.success)) showAlert('사용량이 저장되었습니다.', 'success');
    } catch (e) { console.error(e); }
}



async function loadHolidays() {
    try {
        const response = await fetch(`${API_BASE}/api/inventory/holidays`);
        const result = await response.json();
        
        if (result.success) {
            holidays = result.holidays;
            renderAllHolidays();
        }
    } catch (error) {
        console.error('휴일 로드 실패:', error);
    }
}

function renderAllHolidays() {
    // vendorIdMap을 이용해 동적으로 ID를 생성하여 호출
    renderHolidayList('store', `${vendorIdMap['store']}HolidayList`);
    renderHolidayList('고센유통', `${vendorIdMap['고센유통']}HolidayList`);
    renderHolidayList('한강유통(고기)', `${vendorIdMap['한강유통(고기)']}HolidayList`);
    renderHolidayList('인터넷발주', `${vendorIdMap['인터넷발주']}HolidayList`);
}

function renderHolidayList(type, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const holidayList = holidays[type] || [];
    
    if (holidayList.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 15px;">등록된 휴일이 없습니다.</p>';
        return;
    }
    
    let html = '';
    holidayList.forEach((dateStr, index) => {
        const date = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = WEEKDAYS[date.getDay()];
        
        html += `
            <div class="holiday-item">
                <span class="holiday-date">${dateStr}(${dayOfWeek})</span>
                <button class="btn-danger" onclick="removeHoliday('${type}', ${index})">삭제</button>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// ==========================================================
// [휴일] 임시 영업일 추가
// ==========================================================
async function addHoliday(type) {
    let idPrefix = vendorIdMap[type];
    if (type === 'store_open') idPrefix = 'storeOpen'; // 매핑 예외

    const dateInput = document.getElementById(`${idPrefix}HolidayDate`);
    if(!dateInput) return;
    const date = dateInput.value;
    if(!date) return showAlert('날짜 선택', 'error');

    if(!holidays[type]) holidays[type] = [];
    if(holidays[type].includes(date)) return showAlert('이미 등록됨', 'error');

    holidays[type].push(date);
    holidays[type].sort();

    // 서버 저장
    try {
        await fetch(`${API_BASE}/api/inventory/holidays`, {
            method: 'POST', 
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ holidays })
        });
        dateInput.value = '';
        renderAllHolidays(); // store_open 렌더링 포함하도록 수정 필요
        showAlert('설정되었습니다.', 'success');
    } catch(e) { console.error(e); }
}

async function removeHoliday(type, index) {
    if (!confirm('이 휴일을 삭제하시겠습니까?')) return;
    
    holidays[type].splice(index, 1);
    
    try {
        const response = await fetch(`${API_BASE}/api/inventory/holidays`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ holidays })
        });
        
        const result = await response.json();
        if (result.success) {
            renderAllHolidays();
            showAlert('휴일이 삭제되었습니다.', 'success');
        }
    } catch (error) {
        console.error('휴일 삭제 오류:', error);
        showAlert('휴일 삭제 실패', 'error');
    }
}

async function loadInventoryHistory() {
    try {
        let dateInput = document.getElementById('invHistoryDate');
        if (!dateInput.value) {
            dateInput.valueAsDate = new Date();
        }
        const selectedDate = dateInput.value;
        const vendor = document.getElementById('invHistoryVendor').value;
        
        const response = await fetch(`${API_BASE}/api/inventory/history?period=90&vendor=${vendor}`);
        const result = await response.json();
        
        if (result.success) {
            const historyRecord = result.history.find(r => r.date === selectedDate);
            renderInventoryHistory(historyRecord, vendor);
        }
    } catch (error) {
        console.error('재고 내역 로드 실패:', error);
        showAlert('재고 내역 로드 실패', 'error');
    }
}

function renderInventoryHistory(record, vendorFilter) {
    const container = document.getElementById('inventoryHistoryList');
    if (!container) return;
    
    if (!record) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 30px;">해당 날짜의 저장된 재고 기록이 없습니다.</p>';
        return;
    }

    let html = `
        <div class="history-card-header" style="margin-bottom: 15px;">
            <span style="font-weight:bold; font-size:1.1em;">📅 ${record.date} 재고 현황</span>
            <span class="history-time-badge">저장 시간: ${record.time}</span>
        </div>
        <table class="excel-table">
            <thead>
                <tr>
                    <th style="width: 100px;">업체</th>
                    <th>품목명</th>
                    <th style="width: 100px;">재고수량</th>
                </tr>
            </thead>
            <tbody>
    `;

    let hasData = false;
    const vendorOrder = ['고센유통', '한강유통(고기)', '인터넷발주'];
    
    vendorOrder.forEach(vendorName => {
        if (vendorFilter !== 'all' && vendorFilter !== vendorName) return;

        if (record.inventory[vendorName]) {
            const vendorInventory = record.inventory[vendorName];
            const masterItems = items[vendorName] || [];

            masterItems.forEach(item => {
                const itemKey = `${vendorName}_${item.품목명}`;
                if (vendorInventory[itemKey] !== undefined) {
                    hasData = true;
                    const stock = vendorInventory[itemKey];
                    let displayUnit = item.발주단위;
                    if (vendorName === '한강유통(고기)') {
                        const meatVendorInfo = getMeatVendorInfo(item.품목명);
                        displayUnit = meatVendorInfo.inputUnit;
                    }

                    html += `
                        <tr>
                            <td style="font-weight:bold; color:#555;">${vendorName}</td>
                            <td class="text-left">${item.품목명}</td>
                            <td>${stock} ${displayUnit}</td>
                        </tr>
                    `;
                }
            });
        }
    });

    html += `</tbody></table>`;
    
    if (!hasData) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 30px;">해당 조건의 재고 데이터가 없습니다.</p>';
    } else {
        container.innerHTML = html;
    }
}

async function loadOrderHistory() {
    try {
        let dateInput = document.getElementById('orderDateFilter');
        if (!dateInput.value) {
            dateInput.valueAsDate = new Date();
        }
        const selectedDate = dateInput.value;
        const vendorFilter = document.getElementById('orderVendorFilter').value;
        
        const response = await fetch(`${API_BASE}/api/inventory/orders?vendor=${vendorFilter}`);
        const result = await response.json(); 
        
        if (result.success) {
            const filteredOrders = result.orders.filter(order => {
                return (order.date === selectedDate);
            });
            renderOrderHistory(filteredOrders, vendorFilter);
        }
    } catch (error) {
        console.error('발주 내역 로드 실패:', error);
    }
}

function renderOrderHistory(orders, vendorFilter) {
    const container = document.getElementById('orderHistoryList');
    if (!container) return;
    
    if (!orders || orders.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 30px;">해당 날짜의 발주 내역이 없습니다.</p>';
        return;
    }
    
    let html = `
        <table class="excel-table">
            <thead>
                <tr>
                    <th style="width: 80px;">시간</th>
                    <th style="width: 80px;">업체</th>
                    <th>품목명</th>
                    <th style="width: 80px;">수량</th>
                    <th style="width: 80px;">현재재고</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    let hasData = false;

    orders.forEach(order => {
        const vendorsToShow = (vendorFilter === 'all') 
            ? Object.keys(order.orders) 
            : [vendorFilter];

        vendorsToShow.forEach(vendorName => {
            const items = order.orders[vendorName];
            if (items && items.length > 0) {
                hasData = true;
                items.forEach(item => {
                    const displayUnit = item.displayUnit || item.발주단위;
                    const itemKey = `${vendorName}_${item.품목명}`;
                    const currentStock = order.inventory ? (order.inventory[itemKey] || 0) : '-';
                    
                    html += `
                        <tr>
                            <td>${order.time}</td>
                            <td style="font-weight:bold;">${vendorName}</td>
                            <td class="text-left">${item.품목명}</td>
                            <td>${item.orderAmount} ${displayUnit}</td>
                            <td>${currentStock} ${displayUnit}</td>
                        </tr>
                    `;
                });
            }
        });
    });

    html += `</tbody></table>`;
    
    if (!hasData) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 30px;">선택한 업체의 발주 내역이 없습니다.</p>';
    } else {
        container.innerHTML = html;
    }
}

function getDaysSince(dateString) {
    if (!dateString) return 999;
    const diff = Math.abs(new Date() - new Date(dateString));
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function showAlert(msg, type){
    const div = document.createElement('div');
    div.className = `alert ${type}`;
    div.innerText = msg;
    document.getElementById('alertContainer').appendChild(div);
    setTimeout(()=>div.remove(), 3000);
}

function getMeatVendorInfo(itemName) {
    let info = { type: 'weight', weight: 1, unit: 'kg', inputUnit: 'kg' };
    const weightMatch = itemName.match(/\/(\d+(?:\.\d+)?)kg\//);
    if (weightMatch) info.weight = parseFloat(weightMatch[1]);
    const unitMatch = itemName.match(/(box|pak|kg|통|ea)$/i);
    if (unitMatch) info.unit = unitMatch[1].toLowerCase();
    return info;
}

function renderManageItems() {
    const container = document.getElementById('manageItemsList');
    
    // [NEW] 필터 값 가져오기
    const selectedVendor = document.getElementById('manageVendorSelect')?.value || 'all';
    
    // [UI 개선] 상단 컨트롤 (Sticky) - 라디오 버튼 대신 토글 스타일 적용
    let headerHtml = `
        <div class="sticky-header-bar" style="background:#f8f9fa; flex-direction: column; align-items: stretch;">
            <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <h4 style="margin:0; font-size:14px; color:#333;">🔢 정렬 기준 선택</h4>
                <button onclick="saveItemChanges()" class="btn-sticky-action" style="background:#455a64; font-size:12px; padding:6px 12px;">💾 순서 저장</button>
            </div>

            <div class="sort-toggle-group">
                <label class="sort-toggle-label ${manageSortMode==='1루' ? 'checked' : ''}">
                    <input type="radio" name="sortMode" value="1루" 
                        ${manageSortMode==='1루' ? 'checked' : ''} 
                        onchange="changeSortMode(this.value)"> 
                    ⚾ 1루 매장 순서
                </label>
                <label class="sort-toggle-label ${manageSortMode==='3루' ? 'checked' : ''}">
                    <input type="radio" name="sortMode" value="3루" 
                        ${manageSortMode==='3루' ? 'checked' : ''} 
                        onchange="changeSortMode(this.value)"> 
                    ⚾ 3루 매장 순서
                </label>
            </div>
        </div>
        
        <div style="margin-bottom:10px; color:#666; font-size:11px; text-align:center; background:#fff3e0; padding:5px; border-radius:4px;">
            💡 위아래 화살표(▲▼)를 눌러 <strong>선택된 매장의 순서</strong>를 변경하세요.
        </div>
    `;

    // 2. 통합 리스트 생성 (전역 정렬을 위해) - [NEW] 필터 적용
    let flatList = [];
    
    // [NEW] 선택된 업체에 따라 필터링
    const vendorsToShow = (selectedVendor === 'all') 
        ? Object.keys(items) 
        : [selectedVendor];
    
    vendorsToShow.forEach(vendor => {
        if (!items[vendor]) return; // 업체가 없으면 스킵
        items[vendor].forEach((item, idx) => {
            flatList.push({
                ...item,
                vendor: vendor,
                originalIdx: idx, // 원본 배열에서의 인덱스
                sortKey: (manageSortMode === '1루') ? (item.sort1 ?? 9999) : (item.sort3 ?? 9999)
            });
        });
    });

    // 현재 모드 기준으로 정렬
    flatList.sort((a, b) => a.sortKey - b.sortKey);

    // 3. 리스트 렌더링
    let listHtml = '<ul style="list-style:none; padding:0;">';
    flatList.forEach((item, visualIdx) => {
        listHtml += `
            <li class="manage-row-global">
                <div style="display:flex; flex-direction:column; gap:2px; margin-right:10px;">
                    <button onclick="moveGlobalSort(${visualIdx}, -1)" style="border:1px solid #ddd; background:white; padding:2px 8px; cursor:pointer;">▲</button>
                    <button onclick="moveGlobalSort(${visualIdx}, 1)" style="border:1px solid #ddd; background:white; padding:2px 8px; cursor:pointer;">▼</button>
                </div>
                
                <div class="mrg-info">
                    <span style="font-size:11px; background:#e3f2fd; color:#1565C0; padding:2px 4px; border-radius:3px;">${item.vendor}</span>
                    <span style="font-weight:bold; margin-left:5px;">${item.품목명}</span>
                    <span style="color:#999; font-size:12px;">(현재순서: ${item.sortKey===9999 ? '없음' : item.sortKey})</span>
                    ${item.locations && item.locations.length > 0 
                        ? `<span style="background:#e8f5e9; color:#2e7d32; font-size:10px; padding:2px 5px; border-radius:3px; margin-left:5px;">📍 ${item.locations.join(', ')}</span>` 
                        : '<span style="background:#f5f5f5; color:#888; font-size:10px; padding:2px 5px; border-radius:3px; margin-left:5px;">📍 모든 위치</span>'}
                    ${item.thresholdQty || item.minOrderQty 
                        ? `<span style="background:#fff3e0; color:#e65100; font-size:10px; padding:2px 5px; border-radius:3px; margin-left:5px;">
                            📊 임계:${item.thresholdQty || '-'} / 최소:${item.minOrderQty || '-'}
                           </span>` 
                        : ''}
                </div>
                
                <div class="mrg-actions">
                     <button class="btn-edit" style="padding:5px 10px;" onclick="openEditItemModal('${item.vendor}', ${item.originalIdx})">✏️</button>
                     <button class="btn-delete" style="padding:5px 10px;" onclick="deleteItem('${item.vendor}', ${item.originalIdx})">🗑️</button>
                </div>
            </li>
        `;
    });
    listHtml += '</ul>';

    container.innerHTML = headerHtml + listHtml;
}

// [핵심] 전역 정렬 이동 함수 (업체 구분 없이 Swap)
function moveGlobalSort(visualIdx, direction) {
    // 1. 전체 리스트를 다시 구성하여 현재 순서를 파악
    let flatList = [];
    Object.keys(items).forEach(vendor => {
        items[vendor].forEach((item, idx) => {
            flatList.push({
                itemRef: item, // 참조 전달 (원본 수정용)
                sortKey: (manageSortMode === '1루') ? (item.sort1 ?? 9999) : (item.sort3 ?? 9999)
            });
        });
    });
    
    // 정렬
    flatList.sort((a, b) => a.sortKey - b.sortKey);

    // 2. 스왑 대상 확인
    const targetIdx = visualIdx + direction;
    if (targetIdx < 0 || targetIdx >= flatList.length) return;

    const current = flatList[visualIdx];
    const target = flatList[targetIdx];

    // 3. 순서값 재할당 (Swap)
    // 만약 sortKey가 9999 등 엉망이면, 현재 시각적 인덱스로 싹 정리해주는 게 안전함
    // 하지만 간단하게는 두 값만 바꿈 (단, 9999인 경우 초기화 필요)
    
    // 전체 재정렬 (안전한 방법: 0부터 다시 번호 매기기)
    flatList.forEach((obj, idx) => {
        if (manageSortMode === '1루') obj.itemRef.sort1 = idx;
        else obj.itemRef.sort3 = idx;
    });

    // 이제 Swap
    const tempSort = (manageSortMode === '1루') ? current.itemRef.sort1 : current.itemRef.sort3;
    const targetSort = (manageSortMode === '1루') ? target.itemRef.sort1 : target.itemRef.sort3;

    if (manageSortMode === '1루') {
        current.itemRef.sort1 = targetSort;
        target.itemRef.sort1 = tempSort; // 사실 위에서 인덱스로 재할당했으므로 visualIdx와 targetIdx를 바꾸는 것과 같음
        
        // 인덱스 기반 스왑 로직 수정:
        // 위 forEach에서 이미 0,1,2... 로 할당됨.
        // visualIdx의 sort값 = visualIdx, targetIdx의 sort값 = targetIdx 상태임.
        // 따라서 서로 값을 교환:
        current.itemRef.sort1 = targetIdx;
        target.itemRef.sort1 = visualIdx;
        
    } else {
        current.itemRef.sort3 = targetIdx;
        target.itemRef.sort3 = visualIdx;
    }

    renderManageItems();
}

function changeSortMode(mode) {
    manageSortMode = mode;
    renderManageItems();
}

function moveItemSort(vendor, visualIdx, direction) {
    // 1. 해당 벤더의 아이템들을 현재 모드 기준으로 정렬된 상태로 가져옴
    let list = items[vendor];
    let displayList = list.map((item, idx) => ({ item, idx })); // idx는 원본 인덱스
    
    displayList.sort((a, b) => {
        const valA = (manageSortMode==='1루') ? (a.item.sort1 ?? 9999) : (a.item.sort3 ?? 9999);
        const valB = (manageSortMode==='1루') ? (b.item.sort1 ?? 9999) : (b.item.sort3 ?? 9999);
        return valA - valB;
    });

    const targetVisualIdx = visualIdx + direction;
    if (targetVisualIdx < 0 || targetVisualIdx >= displayList.length) return;

    // 2. 두 아이템의 sort 값을 교환 (또는 재할당)
    // 간단하게: 현재 화면 순서대로 0, 1, 2... 재부여 후 스왑
    displayList.forEach((obj, i) => {
        if (manageSortMode === '1루') obj.item.sort1 = i;
        else obj.item.sort3 = i;
    });
    
    // 스왑
    const currentObj = displayList[visualIdx];
    const targetObj = displayList[targetVisualIdx];
    
    if (manageSortMode === '1루') {
        const temp = currentObj.item.sort1;
        currentObj.item.sort1 = targetObj.item.sort1;
        targetObj.item.sort1 = temp;
    } else {
        const temp = currentObj.item.sort3;
        currentObj.item.sort3 = targetObj.item.sort3;
        targetObj.item.sort3 = temp;
    }
    
    // 3. 재렌더링
    renderManageItems();
}


function moveItem(vendor, index, direction) {
    const list = items[vendor];
    const newIndex = index + direction;
    
    if (newIndex < 0 || newIndex >= list.length) return; 
    
    const temp = list[index];
    list[index] = list[newIndex];
    list[newIndex] = temp;
    
    renderManageItems(); 
}

async function deleteItem(vendor, index) {
    if (!confirm('정말 이 품목을 삭제하시겠습니까? (재고 데이터도 함께 사라질 수 있습니다)')) return;
    
    const deletedItem = items[vendor][index];
    items[vendor].splice(index, 1);
    
    // 서버에 즉시 저장
    try {
        const res = await fetch(`${API_BASE}/api/inventory/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items })
        });
        const result = await res.json();
        
        if (result.success) {
            showAlert(`'${deletedItem.품목명}' 삭제되었습니다.`, 'success');
            renderManageItems();
        } else {
            // 실패 시 복구
            items[vendor].splice(index, 0, deletedItem);
            showAlert('삭제 실패: 서버 오류', 'error');
        }
    } catch (e) {
        // 실패 시 복구
        items[vendor].splice(index, 0, deletedItem);
        showAlert('삭제 실패: 네트워크 오류', 'error');
        console.error(e);
    }
}

// [수정됨] 새 품목 추가 (중요도, 관리주기, 위치 정보 포함, 서버 저장 포함)
async function addNewItem() {
    const vendor = document.getElementById('newItemVendor').value;
    const name = document.getElementById('newItemName').value.trim();
    const unit = document.getElementById('newItemUnit').value.trim();
    const importance = document.getElementById('newItemImportance').value;
    const cycle = document.getElementById('newItemCycle').value;
    
    // [NEW] 위치 정보 수집
    const loc1 = document.getElementById('newItemLoc1');
    const loc3 = document.getElementById('newItemLoc3');
    const locations = [];
    if (loc1 && loc1.checked) locations.push('1루');
    if (loc3 && loc3.checked) locations.push('3루');
    
    if (!name) {
        showAlert('품목명을 입력하세요', 'error');
        return;
    }
    
    if (locations.length === 0) {
        showAlert('최소 1개 이상의 위치를 선택하세요', 'error');
        return;
    }
    
    if (!items[vendor]) items[vendor] = [];
    
    const exists = items[vendor].some(i => i.품목명 === name);
    if (exists) {
        showAlert('이미 존재하는 품목입니다.', 'error');
        return;
    }
    
    const newItem = {
        "품목명": name,
        "발주단위": unit || '개',
        "중요도": importance,
        "관리주기": cycle,
        "locations": locations  // [NEW] 위치 정보
    };
    
    items[vendor].push(newItem);
    
    // 서버에 즉시 저장
    try {
        const res = await fetch(`${API_BASE}/api/inventory/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items })
        });
        const result = await res.json();
        
        if (result.success) {
            document.getElementById('newItemName').value = '';
            document.getElementById('newItemUnit').value = '';
            if (loc1) loc1.checked = true;
            if (loc3) loc3.checked = true;
            
            showAlert(`'${name}' 추가되었습니다. (위치: ${locations.join(', ')})`, 'success');
            
            if (document.getElementById('manageVendorSelect').value === vendor) {
                renderManageItems();
            }
        } else {
            // 실패 시 복구
            items[vendor].pop();
            showAlert('추가 실패: 서버 오류', 'error');
        }
    } catch (e) {
        // 실패 시 복구
        items[vendor].pop();
        showAlert('추가 실패: 네트워크 오류', 'error');
        console.error(e);
    }
}

// [NEW] 수정 모달 열기
function openEditItemModal(vendor, index) {
    const item = items[vendor][index];
    if (!item) return;

    document.getElementById('editVendor').value = vendor;
    document.getElementById('editIndex').value = index;
    
    document.getElementById('editName').value = item.품목명;
    document.getElementById('editUnit').value = item.발주단위;
    document.getElementById('editImportance').value = item.중요도 || '중';
    document.getElementById('editCycle').value = item.관리주기 || 'daily';
    
    // 🔥 [NEW] 임계값/최소발주량 설정
    document.getElementById('editThreshold').value = item.thresholdQty || '';
    document.getElementById('editMinOrder').value = item.minOrderQty || '';
    
    // [NEW] 위치 정보 설정
    const editLoc1 = document.getElementById('editLoc1');
    const editLoc3 = document.getElementById('editLoc3');
    if (editLoc1 && editLoc3) {
        const locations = item.locations || ['1루', '3루']; // 기본값: 모든 위치
        editLoc1.checked = locations.includes('1루');
        editLoc3.checked = locations.includes('3루');
    }

    document.getElementById('editItemModal').classList.add('active');
}

// [NEW] 수정 모달 닫기
function closeEditItemModal() {
    document.getElementById('editItemModal').classList.remove('active');
}

// [NEW] 수정사항 저장
function saveEditItem() {
    const vendor = document.getElementById('editVendor').value;
    const index = parseInt(document.getElementById('editIndex').value);
    
    const newName = document.getElementById('editName').value.trim();
    const newUnit = document.getElementById('editUnit').value.trim();
    const newImp = document.getElementById('editImportance').value;
    const newCycle = document.getElementById('editCycle').value;
    
    // 🔥 [NEW] 임계값/최소발주량 수집
    const thresholdVal = document.getElementById('editThreshold').value.trim();
    const minOrderVal = document.getElementById('editMinOrder').value.trim();
    const newThreshold = thresholdVal ? parseFloat(thresholdVal) : null;
    const newMinOrder = minOrderVal ? parseFloat(minOrderVal) : null;
    
    // [NEW] 위치 정보 수집
    const editLoc1 = document.getElementById('editLoc1');
    const editLoc3 = document.getElementById('editLoc3');
    const newLocations = [];
    if (editLoc1 && editLoc1.checked) newLocations.push('1루');
    if (editLoc3 && editLoc3.checked) newLocations.push('3루');

    if (!newName) {
        showAlert('품목명을 입력해주세요.', 'error');
        return;
    }
    
    if (newLocations.length === 0) {
        showAlert('최소 1개 이상의 위치를 선택하세요', 'error');
        return;
    }

    // 데이터 업데이트
    items[vendor][index] = {
        ...items[vendor][index],
        "품목명": newName,
        "발주단위": newUnit,
        "중요도": newImp,
        "관리주기": newCycle,
        "locations": newLocations,  // [NEW] 위치 정보
        "thresholdQty": newThreshold,  // 🔥 [NEW] 임계값
        "minOrderQty": newMinOrder     // 🔥 [NEW] 최소발주량
    };

    closeEditItemModal();
    renderManageItems(); // 리스트 새로고침
    showAlert('수정되었습니다. 하단의 [저장] 버튼을 눌러 확정하세요.', 'success');
}

// 품목 관리 저장 수정
async function saveItemChanges() {
    try {
        const res = await fetch(`${API_BASE}/api/inventory/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items })
        });
        const result = await res.json();
        
        if (result.success) {
            showAlert('품목 설정이 서버에 저장되었습니다.', 'success');
        } else {
            showAlert('서버 저장 실패', 'error');
        }
        renderUnifiedInventoryForm(); 
    } catch (e) {
        console.error(e);
        showAlert(`에러 발생: ${e.message}`, 'error'); // 로컬 저장 메시지 제거
        renderUnifiedInventoryForm();
    }
}

async function loadRecentInventory() {
    try {
        const response = await fetch(`${API_BASE}/api/inventory/history?period=5&vendor=all`);
        const result = await response.json();
        
        if (result.success && result.history) {
            recentHistory = result.history; 
        }
    } catch (error) {
        console.error('최근 재고 로드 실패:', error);
    }
}

function toggleSortOrder() {
    currentSortOrder = (currentSortOrder === 'default') ? 'lastOrder' : 'default';
    
    const btn = document.getElementById('sortOrderBtn');
    if (currentSortOrder === 'lastOrder') {
        btn.classList.add('active');
        btn.textContent = '📅 기본 순서로';
    } else {
        btn.classList.remove('active');
        btn.textContent = '📅 발주일 오래된 순';
    }
    
    renderUnifiedInventoryForm();
}

let currentNoOrderPeriod = 5;

function showLongTermNoOrder() {
    currentNoOrderPeriod = 5;
    const modal = document.getElementById('noOrderModal');
    modal.classList.add('active');
    filterNoOrderPeriod(5);
}

function closeNoOrderModal() {
    document.getElementById('noOrderModal').classList.remove('active');
}

function filterNoOrderPeriod(days) {
    currentNoOrderPeriod = days;
    
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    const content = document.getElementById('noOrderContent');
    const today = new Date();
    let html = '';
    
    for (const vendor in items) {
        const vendorItems = items[vendor] || [];
        const longTermItems = [];
        
        vendorItems.forEach(item => {
            const itemKey = `${vendor}_${item.품목명}`;
            const lastOrderDate = lastOrderDates[itemKey];
            
            if (!lastOrderDate) {
                longTermItems.push({...item, daysSince: 999, lastOrderDate: '기록없음'});
            } else {
                const daysSince = getDaysSince(lastOrderDate);
                if (daysSince >= days) {
                    longTermItems.push({...item, daysSince, lastOrderDate});
                }
            }
        });
        
        if (longTermItems.length > 0) {
            longTermItems.sort((a, b) => b.daysSince - a.daysSince);
            
            html += `
                <div class="no-order-vendor-section">
                    <h4>📦 ${vendor}</h4>
                    <table class="no-order-table">
                        <thead>
                            <tr>
                                <th>품목명</th>
                                <th>마지막 발주</th>
                                <th>경과일</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            longTermItems.forEach(item => {
                html += `
                    <tr>
                        <td>${item.품목명}</td>
                        <td>${item.lastOrderDate}</td>
                        <td style="color: ${item.daysSince > 10 ? '#f44336' : '#ef6c00'}; font-weight: bold;">
                            ${item.daysSince === 999 ? '-' : item.daysSince + '일'}
                        </td>
                    </tr>
                `;
            });
            
            html += `</tbody></table></div>`;
        }
    }
    
    if (!html) {
        html = '<p style="text-align: center; color: #999; padding: 30px;">해당 기간의 미발주 품목이 없습니다.</p>';
    }
    
    content.innerHTML = html;
}

function updateInventoryMemory(key, val) {
    inventory[key] = val === '' ? 0 : parseFloat(val);
}

function setStockValue(key, val) {
    const input = document.getElementById(`current_${key}`);
    if(input) {
        input.value = val;
        inventory[key] = parseFloat(val);
        input.style.backgroundColor = '#e8f5e9';
        setTimeout(()=>input.style.backgroundColor='white', 300);
    }
}