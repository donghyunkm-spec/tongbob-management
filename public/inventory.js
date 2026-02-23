// ==========================================
// 1. 변수 선언 및 초기화 (덮어쓰기)
// ==========================================

// 전역 변수
let items = {};
let inventory = {};          // 현재 화면에 입력 중인 값 (초기값: 0/빈칸)
let lastSavedInventory = {}; // [NEW] 서버에 저장된 마지막 값 (불러오기용 백업)
let dailyUsage = {};
let holidays = {
    'store': [], 'store_open': [],
    '고센유통': [], '한강유통(고기)': [], '인터넷발주': []
};
let lastOrderDates = {};
let recentHistory = [];

// 화면 상태 변수
let currentLocation = '1루'; // '1루' or '3루'
let currentStandardVendor = 'all';
let currentSortOrder = 'default';
let showWeeklyForced = false;
let checkDateOffset = 0;
let currentConfirmItems = {}; 
let currentWarnings = {};
let manageSortMode = '1루';

// 재고확인 필터 변수
let checkSearchText = '';
let checkSortKey = 'vendor';
let checkVendorFilter = 'all';

const vendorIdMap = {
    'store': 'store', '고센유통': 'goshen',
    '한강유통(고기)': 'meat', '인터넷발주': 'internet'
};

const API_BASE = ''; // 같은 서버에서 동작하므로 빈 문자열 (상대경로 사용)
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

// 초기화 함수
async function initInventoryTab() {
    if (!isInventoryAuthorized()) return;
  
    await loadInventoryDataAll();
    renderUnifiedInventoryForm();
    loadHolidays();
}

// 데이터 로드 함수 (저장된 값 백업하기)
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
        
        // [핵심] 서버에서 가져온 값은 lastSavedInventory에 보관
        if(invData.success) {
            lastSavedInventory = invData.inventory || {}; 
        }
        
        if(usageData.success) dailyUsage = usageData.usage;
        if(lastData.success) lastOrderDates = lastData.lastOrders;
        if(holData.success) holidays = holData.holidays;
        if(!holidays['store_open']) holidays['store_open'] = []; // 호환성

        await loadRecentInventory();
    } catch (e) {
        console.error("데이터 로드 실패", e);
    }
}

// [NEW] 최근 값 불러오기 기능
function recallLastInput() {
    if(!confirm(`${currentLocation}의 마지막 저장된 재고값을 불러오시겠습니까?\n(현재 입력한 내용은 덮어씌워집니다)`)) return;

    // 현재 위치(1루 or 3루)에 해당하는 키만 복사
    const prefix = `${currentLocation}_`;
    let count = 0;
    
    // 백업해둔 데이터(lastSavedInventory)에서 현재 매장 것만 가져옴
    Object.keys(lastSavedInventory).forEach(key => {
        if(key.startsWith(prefix)) {
            inventory[key] = lastSavedInventory[key];
            count++;
        }
    });

    renderUnifiedInventoryForm();
    showAlert(`${count}개 품목 값을 불러왔습니다.`, 'success');
}

// [NEW] 입력 초기화 기능
function resetCurrentInput() {
    if(!confirm(`${currentLocation} 입력값을 모두 0으로 초기화하시겠습니까?`)) return;
    
    const prefix = `${currentLocation}_`;
    Object.keys(inventory).forEach(key => {
        if(key.startsWith(prefix)) {
            delete inventory[key]; // 값을 비움
        }
    });
    
    renderUnifiedInventoryForm();
    showAlert(`${currentLocation} 입력이 초기화되었습니다.`, 'info');
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
    else if (tabName === 'manual') renderManual();
    else if (tabName === 'orderHistory') loadOrderHistory();
}

// [수정] 재고 확인 렌더링 (날짜별 로직 추가)
// [수정] 재고 확인 렌더링 (필터/정렬/정보표시 기능 추가)
function renderInventoryCheck() {
    const container = document.getElementById('inventoryCheckList');
    const dateDisplay = document.getElementById('checkDateDisplay');
    const orderBtn = document.getElementById('btnStartOrder');
    
    if (!container) return;

    // 1. 날짜 계산 및 표시
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + checkDateOffset);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    let dayLabel = `${targetDate.getMonth()+1}/${targetDate.getDate()}`;
    if (checkDateOffset === 0) dayLabel += " (오늘)";
    else if (checkDateOffset === -1) dayLabel += " (어제)";
    else if (checkDateOffset === 1) dayLabel += " (내일)";
    
    if(dateDisplay) dateDisplay.innerText = dayLabel;

    // 2. 발주 버튼 활성화 여부
    if(orderBtn) orderBtn.style.display = (checkDateOffset === 0) ? 'block' : 'none';

    // 3. 데이터 준비 (현재 메모리 or 과거 기록)
    let displayInventory = {};
    let lastSaveDate1 = null;
    let lastSaveDate3 = null;

    if (checkDateOffset === 0) {
        // 오늘: inventory에 값이 있으면 사용, 없으면 lastSavedInventory 폴백
        const hasInput1 = Object.keys(inventory).some(k => k.startsWith('1루_') && !k.startsWith('meta_'));
        const hasInput3 = Object.keys(inventory).some(k => k.startsWith('3루_') && !k.startsWith('meta_'));

        // 1루 데이터
        if (hasInput1) {
            Object.keys(inventory).filter(k => k.startsWith('1루_')).forEach(k => displayInventory[k] = inventory[k]);
            lastSaveDate1 = '오늘 입력중';
        } else {
            Object.keys(lastSavedInventory).filter(k => k.startsWith('1루_') && !k.startsWith('meta_')).forEach(k => displayInventory[k] = lastSavedInventory[k]);
            lastSaveDate1 = lastSavedInventory['meta_last_save_1루'] || '기록없음';
        }

        // 3루 데이터
        if (hasInput3) {
            Object.keys(inventory).filter(k => k.startsWith('3루_')).forEach(k => displayInventory[k] = inventory[k]);
            lastSaveDate3 = '오늘 입력중';
        } else {
            Object.keys(lastSavedInventory).filter(k => k.startsWith('3루_') && !k.startsWith('meta_')).forEach(k => displayInventory[k] = lastSavedInventory[k]);
            lastSaveDate3 = lastSavedInventory['meta_last_save_3루'] || '기록없음';
        }
    } else if (checkDateOffset > 0) {
        container.innerHTML = `<div style="padding:50px; text-align:center; color:#999;">미래의 데이터는 볼 수 없습니다.</div>`;
        return;
    } else {
        const record = recentHistory.find(r => r.date === dateStr);
        if (record) {
            Object.values(record.inventory).forEach(vendorObj => Object.assign(displayInventory, vendorObj));
            lastSaveDate1 = dateStr;
            lastSaveDate3 = dateStr;
        } else {
            container.innerHTML = `<div style="padding:50px; text-align:center; color:#999;">${dateStr} 기록이 없습니다.</div>`;
            return;
        }
    }

    // 4. [NEW] 데이터 가공 (리스트 평탄화)
    let allCheckItems = [];
    Object.keys(items).forEach(vendor => {
        items[vendor].forEach(item => {
            const rawItemKey = `${vendor}_${item.품목명}`;
            const stock1 = displayInventory[`1루_${rawItemKey}`] || 0;
            const stock3 = displayInventory[`3루_${rawItemKey}`] || 0;
            const totalStock = stock1 + stock3;
            const usage = dailyUsage[rawItemKey] || 0;
            const diff = totalStock - usage; 

            allCheckItems.push({
                ...item,
                vendor,
                rawItemKey,
                stock1,
                stock3,
                totalStock,
                usage,
                diff
            });
        });
    });

    // 5. [NEW] 필터링 적용
    let filteredItems = allCheckItems.filter(item => {
        // 업체 필터
        if (checkVendorFilter !== 'all' && item.vendor !== checkVendorFilter) return false;
        // 검색어 필터
        if (checkSearchText && !item.품목명.includes(checkSearchText)) return false;
        return true;
    });

    // 6. [NEW] 정렬 적용
    if (checkSortKey === 'diff_asc') {
        filteredItems.sort((a, b) => a.diff - b.diff); // 부족한 순 (작은값 먼저)
    } else if (checkSortKey === 'diff_desc') {
        filteredItems.sort((a, b) => b.diff - a.diff); // 여유있는 순
    } else if (checkSortKey === 'name') {
        filteredItems.sort((a, b) => a.품목명.localeCompare(b.품목명));
    } else {
        // vendor (기본): 업체명 -> 품목순서
        // 평탄화된 리스트이므로 다시 묶어서 보여주거나 정렬로 처리
        // 여기서는 단순 정렬로 처리 (업체명 > 품목명)
        filteredItems.sort((a, b) => {
            if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
            // 기존 sortKey가 있다면 사용, 없으면 이름순
            const sortA = (currentLocation === '1루') ? (a.sort1 ?? 9999) : (a.sort3 ?? 9999);
            const sortB = (currentLocation === '1루') ? (b.sort1 ?? 9999) : (b.sort3 ?? 9999);
            return sortA - sortB;
        });
    }

    // 7. [NEW] 컨트롤 바 HTML 생성 (필터/정렬 UI)
    // 날짜 불일치 경고 확인
    const formatDateLabel = (dateStr) => {
        if (!dateStr || dateStr === '기록없음') return '기록없음';
        if (dateStr === '오늘 입력중') return '오늘 입력중';
        const d = new Date(dateStr);
        return `${d.getMonth()+1}/${d.getDate()}`;
    };

    const date1Label = formatDateLabel(lastSaveDate1);
    const date3Label = formatDateLabel(lastSaveDate3);
    const isMismatch = checkDateOffset === 0 && lastSaveDate1 !== lastSaveDate3 &&
                       lastSaveDate1 !== '오늘 입력중' && lastSaveDate3 !== '오늘 입력중';

    let dateInfoHtml = '';
    if (checkDateOffset === 0) {
        dateInfoHtml = `
            <div style="margin-bottom:8px; padding:8px 10px; background:#fff; border-radius:5px; border:1px solid #ddd; font-size:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span><strong>1루</strong> 기준: <span style="color:#1976d2;">${date1Label}</span></span>
                    <span><strong>3루</strong> 기준: <span style="color:#1976d2;">${date3Label}</span></span>
                </div>
                ${isMismatch ? `
                <div style="margin-top:6px; padding:6px 8px; background:#fff3e0; border:1px solid #ffb74d; border-radius:4px; color:#e65100;">
                    <strong>⚠️ 주의:</strong> 1루와 3루 재고 기준일이 다릅니다! 발주 전 최신 재고를 입력해주세요.
                </div>` : ''}
            </div>
        `;
    }

    let controlHtml = dateInfoHtml + `
        <div class="check-controls" style="margin-bottom:10px; display:flex; gap:5px; flex-wrap:wrap; background:#f1f3f5; padding:8px; border-radius:5px;">
            <select onchange="updateCheckVendor(this.value)" style="width:auto; padding:5px; font-size:12px; height:32px;">
                <option value="all" ${checkVendorFilter==='all'?'selected':''}>전체 업체</option>
                <option value="고센유통" ${checkVendorFilter==='고센유통'?'selected':''}>고센</option>
                <option value="한강유통(고기)" ${checkVendorFilter==='한강유통(고기)'?'selected':''}>고기</option>
                <option value="인터넷발주" ${checkVendorFilter==='인터넷발주'?'selected':''}>인터넷</option>
            </select>

            <input type="text" placeholder="품목명 검색" value="${checkSearchText}"
                oninput="updateCheckSearch(this.value)"
                style="flex:1; min-width:100px; padding:5px; height:32px; font-size:13px;">

            <div class="sort-btn-group" style="display:flex; gap:2px;">
                <button onclick="updateCheckSort('vendor')" class="sort-btn ${checkSortKey==='vendor'?'active':''}" title="업체별 보기">📂</button>
                <button onclick="updateCheckSort('name')" class="sort-btn ${checkSortKey==='name'?'active':''}" title="이름순">가나다</button>
                <button onclick="updateCheckSort('diff_asc')" class="sort-btn ${checkSortKey==='diff_asc'?'active':''}" title="부족한 순">🔥부족</button>
            </div>
        </div>
    `;

    // 8. 테이블 그리기
    let tableHtml = `
        <table class="check-table">
            <thead>
                <tr>
                    <th style="min-width:110px;">품목명</th>
                    <th>1루</th>
                    <th>3루</th>
                    <th style="background:#e3f2fd;">합계</th>
                    <th>1일사용</th>
                    <th>차이</th>
                </tr>
            </thead>
            <tbody>
    `;

    // 그룹 헤더 표시 여부 (기본 정렬일 때만 업체 구분선 표시)
    let lastVendor = '';

    if (filteredItems.length === 0) {
        tableHtml += `<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">검색 결과가 없습니다.</td></tr>`;
    } else {
        filteredItems.forEach(item => {
            // 정렬 모드가 'vendor'일 때만 업체 헤더 삽입
            if (checkSortKey === 'vendor' && item.vendor !== lastVendor) {
                tableHtml += `<tr style="background:#f8f9fa;"><td colspan="6" style="text-align:left; font-size:12px; font-weight:bold; color:#555; padding-left:10px;">📦 ${item.vendor}</td></tr>`;
                lastVendor = item.vendor;
            }

            let displayUnit = item.발주단위;
            if (item.vendor === '한강유통(고기)') displayUnit = getMeatVendorInfo(item.품목명).inputUnit;

            const diffClass = (item.diff >= 0) ? 'diff-plus' : 'diff-minus';
            const diffSign = (item.diff > 0) ? '+' : '';

            // [NEW] 임계값/최소발주량 뱃지 생성
            let infoBadge = '';
            if (item.thresholdQty || item.minOrderQty) {
                infoBadge = `<div style="margin-top:2px; font-size:10px; color:#e65100; display:inline-block; background:#fff3e0; padding:1px 4px; border-radius:3px; border:1px solid #ffe0b2;">
                    📉임계:${item.thresholdQty!==null ? item.thresholdQty : '-'} / 📦최소:${item.minOrderQty!==null ? item.minOrderQty : '-'}
                </div>`;
            }

            // 정렬 모드가 vendor가 아닐 땐 품목명 옆에 업체명 작게 표시
            let vendorBadge = '';
            if (checkSortKey !== 'vendor') {
                vendorBadge = `<span style="font-size:10px; color:#888; background:#eee; padding:1px 3px; border-radius:2px; margin-right:4px;">${item.vendor.substr(0,2)}</span>`;
            }

            tableHtml += `
                <tr>
                    <td style="text-align:left; line-height:1.3;">
                        ${vendorBadge}${item.품목명}
                        ${infoBadge}
                    </td>
                    <td>${item.stock1}</td>
                    <td>${item.stock3}</td>
                    <td class="check-val" style="background:#e3f2fd;">${item.totalStock}</td>
                    <td>${item.usage}</td>
                    <td class="${diffClass} check-val">${diffSign}${parseFloat(item.diff.toFixed(1))}</td>
                </tr>
            `;
        });
    }

    tableHtml += `</tbody></table>`;
    container.innerHTML = controlHtml + tableHtml;
}

// [NEW] 재고확인 탭용 헬퍼 함수들
function updateCheckVendor(val) {
    checkVendorFilter = val;
    renderInventoryCheck();
}

function updateCheckSearch(val) {
    checkSearchText = val;
    renderInventoryCheck();
}

function updateCheckSort(key) {
    checkSortKey = key;
    renderInventoryCheck();
}

// [신규] 발주 프로세스 시작 버튼 (경고창 -> 발주창)
function triggerOrderProcess() {
    console.log('[DEBUG] 발주진행 버튼 클릭됨');
    console.log('[DEBUG] checkDateOffset:', checkDateOffset);

    if (checkDateOffset !== 0) {
        showAlert('오늘 날짜에서만 발주가 가능합니다.', 'error');
        return;
    }

    // 1루/3루 재고 기준일 불일치 경고
    const lastSaveDate1 = lastSavedInventory['meta_last_save_1루'];
    const lastSaveDate3 = lastSavedInventory['meta_last_save_3루'];
    const hasInput1 = Object.keys(inventory).some(k => k.startsWith('1루_') && !k.startsWith('meta_'));
    const hasInput3 = Object.keys(inventory).some(k => k.startsWith('3루_') && !k.startsWith('meta_'));

    // 오늘 입력 중이 아니고, 날짜가 다르면 경고
    if (!hasInput1 && !hasInput3 && lastSaveDate1 !== lastSaveDate3) {
        const msg = `⚠️ 1루와 3루 재고 기준일이 다릅니다!\n\n` +
                    `• 1루: ${lastSaveDate1 || '기록없음'}\n` +
                    `• 3루: ${lastSaveDate3 || '기록없음'}\n\n` +
                    `정확한 발주를 위해 최신 재고를 입력해주세요.\n그래도 발주를 진행하시겠습니까?`;
        if (!confirm(msg)) return;
    }

    console.log('[DEBUG] items:', items);
    console.log('[DEBUG] inventory:', inventory);

    // 기존의 검증 로직 호출
    checkOrderConfirmation();
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

// 3. 재고 입력 화면 렌더링 (교체)
function renderUnifiedInventoryForm() {
    const formContainer = document.getElementById('inventoryForm');
    if (!formContainer) return;
    
    // 1. 저장된 날짜 확인 로직
    const todayStr = new Date().toISOString().split('T')[0];
    
    // 1루 마지막 저장일 확인
    const lastDate1 = inventory['meta_last_save_1루'] || '기록없음';
    const isToday1 = (lastDate1 === todayStr);
    // 날짜 포맷 예쁘게 (2024-05-20 -> 5/20)
    const displayDate1 = isToday1 ? '오늘 완료' : (lastDate1 === '기록없음' ? '기록없음' : lastDate1.substring(5).replace('-','/') + ' (과거)');
    const badgeStyle1 = isToday1 
        ? 'background:#e8f5e9; color:#2e7d32; border:1px solid #c8e6c9;' // 오늘: 초록
        : 'background:#fff3e0; color:#e65100; border:1px solid #ffe0b2;'; // 과거: 주황
        
    // 3루 마지막 저장일 확인
    const lastDate3 = inventory['meta_last_save_3루'] || '기록없음';
    const isToday3 = (lastDate3 === todayStr);
    const displayDate3 = isToday3 ? '오늘 완료' : (lastDate3 === '기록없음' ? '기록없음' : lastDate3.substring(5).replace('-','/') + ' (과거)');
    const badgeStyle3 = isToday3 
        ? 'background:#e8f5e9; color:#2e7d32; border:1px solid #c8e6c9;' 
        : 'background:#fff3e0; color:#e65100; border:1px solid #ffe0b2;';

    // 2. 매장별 테마 색상 설정
    const theme = currentLocation === '1루'
        ? { bg: '#e3f2fd', border: '#1976d2', accent: '#1565c0', light: '#bbdefb', icon: '🔵' }
        : { bg: '#fff3e0', border: '#f57c00', accent: '#e65100', light: '#ffe0b2', icon: '🟠' };

    // 3. 상단 HTML 구성
    let html = `
        <!-- 현재 매장 강조 배너 -->
        <div style="background:${theme.accent}; color:white; padding:12px 16px; margin:-10px -10px 15px -10px; text-align:center; font-size:18px; font-weight:bold; letter-spacing:1px;">
            ${theme.icon} 지금 ${currentLocation} 재고 입력 중 ${theme.icon}
        </div>

        <div class="sticky-header-bar" style="border:2px solid ${theme.border}; background:${theme.bg};">
            <div style="display:flex; gap:5px; flex:1;">
                <button class="btn-loc-select ${currentLocation==='1루'?'active':''}" onclick="setLocation('1루')"
                    style="${currentLocation==='1루' ? 'background:#1976d2; color:white; border-color:#1565c0;' : ''}">
                    🔵 1루
                    <span style="display:block; font-size:10px; font-weight:normal; margin-top:2px;">${isToday1 ? '✅' : '⚠️'}</span>
                </button>
                <button class="btn-loc-select ${currentLocation==='3루'?'active':''}" onclick="setLocation('3루')"
                    style="${currentLocation==='3루' ? 'background:#f57c00; color:white; border-color:#e65100;' : ''}">
                    🟠 3루
                    <span style="display:block; font-size:10px; font-weight:normal; margin-top:2px;">${isToday3 ? '✅' : '⚠️'}</span>
                </button>
            </div>
            <button onclick="saveInventory()" class="btn-sticky-action" style="background:${theme.accent};">💾 ${currentLocation} 저장</button>
        </div>

        <div style="margin-bottom:10px; display:flex; gap:5px; font-size:12px; justify-content:center;">
            <div style="padding:4px 8px; border-radius:12px; ${badgeStyle1}">
                1루 저장: <strong>${displayDate1}</strong>
            </div>
            <div style="padding:4px 8px; border-radius:12px; ${badgeStyle3}">
                3루 저장: <strong>${displayDate3}</strong>
            </div>
        </div>

        <div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; background:${theme.light}; padding:8px; border-radius:8px; border:1px solid ${theme.border};">
            <div style="display:flex; gap:5px;">
                <button onclick="recallLastInput()" class="btn-recall">🔄 불러오기</button>
                <button onclick="resetCurrentInput()" class="btn-reset">🗑️ 초기화</button>
            </div>

            <div style="display:flex; gap:5px;">
                 <button id="toggleWeeklyBtn" onclick="toggleWeeklyItems()" class="btn-option">
                    ${showWeeklyForced ? '✅ 주간포함' : '주간숨김'}
                 </button>
                 <button onclick="showLongTermNoOrder()" class="btn-option" style="color:#d32f2f;">
                    ⚠️ 미발주
                 </button>
            </div>
        </div>
    `;

    const today = new Date();
    const isTuesday = today.getDay() === 2;

    // 일반 품목과 인터넷 발주 품목 분리
    let regularItems = [];
    let internetItems = [];

    Object.keys(items).forEach(vendor => {
        items[vendor].forEach(item => {
            const sortKey = (currentLocation === '1루') ? (item.sort1 ?? 9999) : (item.sort3 ?? 9999);
            const itemData = { ...item, vendor, sortKey };

            if (vendor === '인터넷발주') {
                internetItems.push(itemData);
            } else {
                regularItems.push(itemData);
            }
        });
    });

    // 정렬
    const sortFn = currentSortOrder === 'lastOrder'
        ? (a, b) => {
            const dateA = lastOrderDates[`${a.vendor}_${a.품목명}`] || '0000-00-00';
            const dateB = lastOrderDates[`${b.vendor}_${b.품목명}`] || '0000-00-00';
            return dateA.localeCompare(dateB);
        }
        : (a, b) => a.sortKey - b.sortKey;

    regularItems.sort(sortFn);
    internetItems.sort(sortFn);

    // 품목 행 렌더링 헬퍼 함수
    function renderItemRow(item) {
        if (item.locations && item.locations.length > 0) {
            if (!item.locations.includes(currentLocation)) return '';
        }
        // 인터넷발주 품목은 weekly 필터 무시 (항상 표시)
        if (item.관리주기 === 'weekly' && !isTuesday && !showWeeklyForced && item.vendor !== '인터넷발주') return '';

        const rawItemKey = `${item.vendor}_${item.품목명}`;
        const locItemKey = `${currentLocation}_${rawItemKey}`;

        const currentStock = inventory[locItemKey];
        const displayValue = (currentStock === undefined || currentStock === 0) ? '' : currentStock;

        let yesterdayStock = '-';
        if (lastSavedInventory[locItemKey] !== undefined) {
            yesterdayStock = lastSavedInventory[locItemKey];
        }

        let displayUnit = item.발주단위;
        if (item.vendor === '한강유통(고기)') displayUnit = getMeatVendorInfo(item.품목명).inputUnit;

        const lastDate = lastOrderDates[rawItemKey];
        const daysSince = lastDate ? getDaysSince(lastDate) : 999;
        const isAlert = (daysSince >= 7);

        return `
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
                        <span>최근</span>
                    </div>

                    <div class="irc-input-wrapper">
                        <input type="number" id="current_${locItemKey}" class="irc-input"
                            value="${displayValue}"
                            placeholder="0" inputmode="decimal"
                            onchange="updateInventoryMemory('${locItemKey}', this.value)">
                    </div>
                    <span style="font-size:12px; margin-left:2px; color:#555; width:20px;">${displayUnit}</span>
                </div>
            </div>
        `;
    }

    // 일반 품목 섹션
    let hasRegularItems = false;
    html += `<div style="background:white; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1);">`;
    regularItems.forEach(item => {
        const rowHtml = renderItemRow(item);
        if (rowHtml) {
            hasRegularItems = true;
            html += rowHtml;
        }
    });
    html += `</div>`;

    // 인터넷 발주 품목 섹션 (하단에 분리)
    let hasInternetItems = false;
    let internetHtml = '';
    internetItems.forEach(item => {
        const rowHtml = renderItemRow(item);
        if (rowHtml) {
            hasInternetItems = true;
            internetHtml += rowHtml;
        }
    });

    if (hasInternetItems) {
        html += `
            <div style="margin-top:15px; background:#e3f2fd; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1); border:2px solid #90caf9;">
                <div style="background:#1976D2; color:white; padding:8px 12px; font-weight:bold; font-size:13px;">
                    🛒 인터넷 발주 품목
                </div>
                ${internetHtml}
            </div>
        `;
    }

    if (!hasRegularItems && !hasInternetItems) {
        html += '<p style="text-align:center; padding:20px;">표시할 품목이 없습니다.</p>';
    }

    formContainer.innerHTML = html;
}

// 1루/3루 탭 변경
function setLocation(loc) {
    // 같은 매장이면 무시
    if (currentLocation === loc) return;

    // 현재 입력값이 있는지 확인
    const prefix = `${currentLocation}_`;
    const hasInput = Object.keys(inventory).some(k => k.startsWith(prefix) && !k.startsWith('meta_'));

    if (hasInput) {
        const msg = `현재 ${currentLocation} 재고를 입력 중입니다.\n\n` +
                    `${loc}(으)로 전환하시겠습니까?\n` +
                    `(입력값은 저장됩니다)`;
        if (!confirm(msg)) return;
    }

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
    saveCurrentInputToMemory(); 

    // [NEW] 현재 작업 중인 위치(1루/3루)에 '오늘 날짜' 도장을 찍습니다.
    const todayStr = new Date().toISOString().split('T')[0]; // "2024-05-20" 형식
    inventory[`meta_last_save_${currentLocation}`] = todayStr;

    const saveBtn = document.querySelector('.btn-sticky-action');
    if(saveBtn) {
        saveBtn.textContent = '⏳ 저장중...';
        saveBtn.disabled = true;
    }

    try {
        const response = await fetch(`${API_BASE}/api/inventory/current`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inventory: inventory })
        });
        const result = await response.json();
        
        if (result.success) {
            lastSavedInventory = { ...result.inventory };
            inventory = result.inventory; 
            
            // 저장 후 화면을 다시 그려서 날짜 배지를 갱신합니다.
            renderUnifiedInventoryForm();
            
            showAlert('저장되었습니다.', 'success');
        } else {
            showAlert('저장 실패: 서버 오류', 'error');
        }
    } catch (e) {
        console.error(e);
        showAlert('저장 실패 (네트워크 오류)', 'error');
    } finally {
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
    // 1. 발주할 것(confirmItems)과 안할 것(checkItems) 분리
    const confirmItems = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [] };
    const checkItems = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [] };
    const dangerItems = []; // 🚨 재고 0인데 발주 안되는 품목

    let missingInputCount = 0; // 재고 0개인 품목 수
    const today = new Date();
    const isTuesday = today.getDay() === 2;

    for (const vendor in items) {
        const vendorItems = items[vendor];
        const daysNeeded = getDaysUntilNextDelivery(vendor);

        vendorItems.forEach(item => {
            // 화요일이 아니면 weekly 품목은 발주 계산에서 제외 (인터넷발주는 예외)
            if (item.관리주기 === 'weekly' && !isTuesday && vendor !== '인터넷발주') return;
            const rawItemKey = `${vendor}_${item.품목명}`;
            
            // 통합 재고 계산
            const stock1 = inventory[`1루_${rawItemKey}`] || 0;
            const stock3 = inventory[`3루_${rawItemKey}`] || 0;
            const totalStock = stock1 + stock3;
            
            const usage = dailyUsage[rawItemKey] || 0;
            const neededTotal = usage * daysNeeded; 
            
            // 발주량 계산
            let orderAmountRaw = Math.max(0, neededTotal - totalStock);
            
            // 임계값/최소발주량 로직
            if (item.thresholdQty && item.minOrderQty) {
                if (totalStock <= item.thresholdQty) orderAmountRaw = item.minOrderQty;
                else orderAmountRaw = 0;
            }
            
            // 단위 및 수량 보정
            let displayQty = 0;
            let displayUnit = item.발주단위;
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
            
            const itemData = {
                ...item,
                itemKey: rawItemKey,
                currentStock: totalStock,
                orderAmount: displayQty,
                displayUnit,
                daysNeeded
            };

            // 분류 작업
            if (displayQty > 0) {
                confirmItems[vendor].push(itemData);
            } else {
                checkItems[vendor].push(itemData);
                // 발주도 안 하는데 재고도 0이면 위험 → dangerItems에 추가
                if(totalStock === 0) {
                    missingInputCount++;
                    dangerItems.push({ ...itemData, vendor });
                }
            }
        });
    }

    currentConfirmItems = confirmItems;
    showConfirmModal(confirmItems, checkItems, missingInputCount, dangerItems);
}

function showConfirmModal(confirmItems, checkItems, missingInputCount, dangerItems) {
    const modal = document.getElementById('confirmModal');
    const content = document.getElementById('confirmContent');

    let html = '';
    let hasOrder = false;

    // --- [0부] 🚨 재고 0 경고 (맨 위에 표시) ---
    if (dangerItems && dangerItems.length > 0) {
        html += `<div style="background:#ffebee; border:3px solid #f44336; border-radius:8px; padding:12px; margin-bottom:20px;">
            <h3 style="color:#c62828; margin:0 0 10px 0; font-size:16px;">🚨 재고 0 경고 (${dangerItems.length}개)</h3>
            <p style="font-size:12px; color:#c62828; margin-bottom:10px;">아래 품목들은 재고가 0인데 발주 목록에 없습니다. 확인해주세요!</p>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">`;

        dangerItems.forEach(item => {
            html += `<span style="background:#f44336; color:white; padding:6px 12px; border-radius:20px; font-size:13px; font-weight:bold;">
                ${item.품목명} <span style="font-size:11px; opacity:0.9;">(${item.vendor.substr(0,2)})</span>
            </span>`;
        });

        html += `</div></div>`;
    }

    // --- [1부] 발주 예정 리스트 (오렌지색 테두리 강조) ---
    html += `<div style="background:#fff3e0; border:2px solid #ff9800; border-radius:8px; padding:10px; margin-bottom:20px;">
        <h3 style="color:#e65100; margin-top:0; border-bottom:1px solid #ffe0b2; padding-bottom:5px;">📦 발주 예정 품목</h3>`;

    for (const vendor in confirmItems) {
        const list = confirmItems[vendor];
        if (list.length > 0) {
            hasOrder = true;
            html += `<h4 style="margin:10px 0 5px 0; font-size:14px;">${vendor}</h4>
            <table class="confirm-table" style="background:white;">
                <thead><tr><th>품목</th><th>현재재고</th><th>발주량</th></tr></thead>
                <tbody>`;
            list.forEach((i, idx) => {
                html += `<tr>
                    <td style="font-weight:bold;">${i.품목명}</td>
                    <td>${i.currentStock}</td>
                    <td>
                        <input type="number" value="${i.orderAmount}" 
                               data-vendor="${vendor}" data-index="${idx}"
                               onchange="updateOrderAmount('${vendor}', ${idx}, this.value)"
                               style="width:60px; padding:4px; text-align:right; font-weight:bold; border:2px solid #1976D2; border-radius:4px;">
                        ${i.displayUnit}
                    </td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }
    }
    if(!hasOrder) html += `<p style="text-align:center; color:#666;">발주할 품목이 없습니다.</p>`;
    html += `</div>`;

    // --- [2부] 미발주 품목 검토 (회색 박스) ---
    html += `<div style="background:#f1f3f5; border:1px solid #ddd; border-radius:8px; padding:10px;">
        <h3 style="color:#333; margin-top:0; display:flex; justify-content:space-between; align-items:center;">
            <span>📋 기타 품목 (발주X)</span>
            <button onclick="toggleCheckList()" style="font-size:12px; padding:4px 8px; background:white; border:1px solid #999; border-radius:4px; cursor:pointer;">펼치기/접기</button>
        </h3>

        <div id="checkListContainer" style="display:none; max-height:300px; overflow-y:auto;">`;

    for (const vendor in checkItems) {
        const list = checkItems[vendor];
        if (list.length > 0) {
            html += `<h4 style="margin:10px 0 5px 0; font-size:13px; color:#555;">${vendor}</h4>
            <table class="confirm-table" style="background:white; font-size:12px;">
                <thead><tr><th>품목</th><th>현재재고</th><th>상태</th></tr></thead>
                <tbody>`;
            list.forEach(i => {
                // 재고 0이면 빨간색 배경으로 강조
                const stockStyle = i.currentStock === 0 ? 'color:red; font-weight:bold; background:#ffebee;' : '';
                const statusIcon = i.currentStock === 0 ? '⚠️ 0개' : '✔️ 충분';
                
                html += `<tr style="${stockStyle}">
                    <td>${i.품목명}</td>
                    <td>${i.currentStock} ${i.displayUnit}</td>
                    <td>${statusIcon}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }
    }
    html += `</div></div>`;

    content.innerHTML = html;
    modal.classList.add('active');
}

// [추가] 토글 함수
function toggleCheckList() {
    const el = document.getElementById('checkListContainer');
    if(el.style.display === 'none') el.style.display = 'block';
    else el.style.display = 'none';
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

// [NEW] 발주량 수정 함수
function updateOrderAmount(vendor, index, newValue) {
    const value = parseFloat(newValue) || 0;
    if (currentConfirmItems[vendor] && currentConfirmItems[vendor][index]) {
        currentConfirmItems[vendor][index].orderAmount = value;
        console.log(`[DEBUG] ${vendor} - ${currentConfirmItems[vendor][index].품목명}: ${value}로 수정됨`);
    }
}

async function proceedToOrder() {
    closeConfirmModal();
    const orderData = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [] };
    const currentInventoryCopy = { ...inventory };

    // currentConfirmItems의 수정된 값을 사용
    for (const vendor in currentConfirmItems) {
        const items = currentConfirmItems[vendor];
        items.forEach(item => {
            if (item.orderAmount > 0) {
                orderData[vendor].push({
                    ...item,
                    orderAmount: item.orderAmount,
                    daysNeeded: item.daysNeeded,
                    displayUnit: item.displayUnit
                });
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
    showInvTab('orderHistory');
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

// 2. 설명서 렌더링 함수 추가 (맨 아래나 적절한 곳에 추가)
function renderManual() {
    const container = document.getElementById('manualContent');
    if(!container) return;

    container.innerHTML = `
        <div style="padding:10px;">
            <h2 style="text-align:center; color:#333; margin-bottom:20px;">📘 재고관리 시스템 사용 설명서</h2>

            <div class="manual-box">
                <h3 class="manual-title">1️⃣ 발주량은 어떻게 계산되나요?</h3>
                <div class="manual-content">
                    <p>시스템은 두 가지 방식으로 발주량을 자동 계산합니다.</p>
                    
                    <div class="manual-card">
                        <h4>🅰️ 일반 방식 (사용량 기준)</h4>
                        <p>하루에 얼마나 쓰는지(사용량)를 기준으로, 배송 오는 날까지 버틸 양을 계산합니다.</p>
                        <div class="manual-formula">
                            (일일 사용량 × 다음 배송까지 남은 일수) - 현재 재고 = <strong>발주량</strong>
                        </div>
                        <ul>
                            <li><strong>예시:</strong> 하루에 양파 2kg 씀. 다음 배송은 2일 뒤 옴. 현재 1kg 있음.</li>
                            <li>필요량(4kg) - 재고(1kg) = <strong>3kg 발주</strong></li>
                            <li>⚠️ <strong>주의:</strong> [사용량] 탭에서 하루 소비량을 정확히 입력해야 정확합니다!</li>
                        </ul>
                    </div>

                    <div class="manual-card warning">
                        <h4>🅱️ 임계값 방식 (비상 재고 기준)</h4>
                        <p>사용량과 상관없이, <strong>"재고가 너무 적으면 무조건 주문"</strong>하는 안전장치입니다.</p>
                        <div class="manual-formula">
                            현재 재고 < 임계값(위험선) ➡️ <strong>최소 발주량만큼 무조건 주문!</strong>
                        </div>
                        <ul>
                            <li><strong>예시:</strong> 식용유 임계값 2통. 현재 1통 남음.</li>
                            <li>다음 배송일이 언제든 상관없이 <strong>최소 발주량</strong>만큼 즉시 주문 들어감.</li>
                            <li>설정은 [품목관리] 탭에서 수정 가능합니다.</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div class="manual-box">
                <h3 class="manual-title">2️⃣ 1루와 3루 입력은 따로 하나요?</h3>
                <div class="manual-content">
                    <p>네, 각 매장에서 본인 구역 재고만 세어서 입력하면 됩니다.</p>
                    <ul>
                        <li><strong>[1루] 버튼</strong> 누르고 재고 입력 후 <span class="badge-btn">💾 저장</span></li>
                        <li><strong>[3루] 버튼</strong> 누르고 재고 입력 후 <span class="badge-btn">💾 저장</span></li>
                        <li>시스템이 자동으로 <strong>(1루 재고 + 3루 재고)</strong>를 합쳐서 총 재고를 파악합니다.</li>
                    </ul>
                    <p class="tip-box">
                        💡 <strong>TIP:</strong> 저장 버튼을 누르면 날짜 도장이 찍힙니다.<br>
                        화면 상단에 <span style="color:#2e7d32; font-weight:bold;">1루 저장: 오늘 완료</span> 라고 뜨면 잘 된 것입니다.<br>
                        <span style="color:#e65100; font-weight:bold;">(과거)</span>라고 뜨면 아직 오늘 입력을 안 한 상태입니다.
                    </p>
                </div>
            </div>

            <div class="manual-box">
                <h3 class="manual-title">3️⃣ 발주 보내기</h3>
                <div class="manual-content">
                    <ol>
                        <li><strong>[🔎 재고확인]</strong> 탭으로 이동합니다.</li>
                        <li><span class="badge-btn" style="background:#ff5722;">🚀 발주 진행</span> 버튼을 누릅니다.</li>
                        <li>팝업창이 <strong>두 부분</strong>으로 나뉩니다.
                            <ul>
                                <li>📦 <strong>위쪽(주황색):</strong> 실제로 주문 들어갈 품목들</li>
                                <li>📋 <strong>아래쪽(회색):</strong> 주문 안 하는 품목들 (재고 0개인 것 확인용)</li>
                            </ul>
                        </li>
                        <li>이상 없으면 <strong>[다음]</strong> → <strong>[카카오톡 복사]</strong> 하여 단톡방에 붙여넣기!</li>
                    </ol>
                </div>
            </div>
            
            <div style="text-align:center; color:#888; margin-top:30px; font-size:12px;">
                시스템 문의: 사장님 (010-XXXX-XXXX)
            </div>
        </div>
    `;
}