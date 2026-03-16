// inventory-input.js - 재고 입력/저장

// ==========================================
// 최근 값 불러오기/초기화
// ==========================================
function recallLastInput() {
    if(!confirm(`${currentLocation}의 마지막 저장된 재고값을 불러오시겠습니까?\n(현재 입력한 내용은 덮어씌워집니다)`)) return;

    const prefix = `${currentLocation}_`;
    let count = 0;

    Object.keys(lastSavedInventory).forEach(key => {
        if(key.startsWith(prefix)) {
            inventory[key] = lastSavedInventory[key];
            count++;
        }
    });

    renderUnifiedInventoryForm();
    showAlert(`${count}개 품목 값을 불러왔습니다.`, 'success');
}

function resetCurrentInput() {
    if(!confirm(`${currentLocation} 입력값을 모두 0으로 초기화하시겠습니까?`)) return;

    const prefix = `${currentLocation}_`;
    Object.keys(inventory).forEach(key => {
        if(key.startsWith(prefix)) {
            delete inventory[key];
        }
    });

    renderUnifiedInventoryForm();
    showAlert(`${currentLocation} 입력이 초기화되었습니다.`, 'info');
}

// ==========================================
// 입력값 메모리 관리
// ==========================================
function saveCurrentInputToMemory() {
    const inputs = document.querySelectorAll('input[id^="current_"]');
    inputs.forEach(input => {
        if (!input) return;
        const key = input.id.replace('current_', '');
        const val = input.value.trim();
        inventory[key] = val === '' ? 0 : parseFloat(val);
    });
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
        setTimeout(() => input.style.backgroundColor = 'white', 300);
    }
}

// ==========================================
// 주간품목 토글
// ==========================================
function toggleWeeklyItems() {
    showWeeklyForced = !showWeeklyForced;
    renderUnifiedInventoryForm();
}

// ==========================================
// 정렬 순서 토글
// ==========================================
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

// ==========================================
// 1루/3루 탭 변경
// ==========================================
function setLocation(loc) {
    if (currentLocation === loc) return;

    if (!confirm(`${loc}(으)로 전환하시겠습니까?`)) return;

    currentLocation = loc;
    renderUnifiedInventoryForm();
}

// ==========================================
// 재고 입력 화면 렌더링
// ==========================================
function renderUnifiedInventoryForm() {
    const formContainer = document.getElementById('inventoryForm');
    if (!formContainer) return;

    const todayStr = new Date().toISOString().split('T')[0];

    // 1루 마지막 저장일 확인
    const lastDate1 = inventory['meta_last_save_1루'] || '기록없음';
    const isToday1 = (lastDate1 === todayStr);
    const displayDate1 = isToday1 ? '오늘 완료' : (lastDate1 === '기록없음' ? '기록없음' : lastDate1.substring(5).replace('-','/') + ' (과거)');
    const badgeStyle1 = isToday1
        ? 'background:#e8f5e9; color:#2e7d32; border:1px solid #c8e6c9;'
        : 'background:#fff3e0; color:#e65100; border:1px solid #ffe0b2;';

    // 3루 마지막 저장일 확인
    const lastDate3 = inventory['meta_last_save_3루'] || '기록없음';
    const isToday3 = (lastDate3 === todayStr);
    const displayDate3 = isToday3 ? '오늘 완료' : (lastDate3 === '기록없음' ? '기록없음' : lastDate3.substring(5).replace('-','/') + ' (과거)');
    const badgeStyle3 = isToday3
        ? 'background:#e8f5e9; color:#2e7d32; border:1px solid #c8e6c9;'
        : 'background:#fff3e0; color:#e65100; border:1px solid #ffe0b2;';

    // 매장별 테마 색상
    const theme = currentLocation === '1루'
        ? { bg: '#e3f2fd', border: '#1976d2', accent: '#1565c0', light: '#bbdefb', icon: '🔵' }
        : { bg: '#fff3e0', border: '#f57c00', accent: '#e65100', light: '#ffe0b2', icon: '🟠' };

    let html = `
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

    const sortFn = currentSortOrder === 'lastOrder'
        ? (a, b) => {
            const dateA = lastOrderDates[`${a.vendor}_${a.품목명}`] || '0000-00-00';
            const dateB = lastOrderDates[`${b.vendor}_${b.품목명}`] || '0000-00-00';
            return dateA.localeCompare(dateB);
        }
        : (a, b) => a.sortKey - b.sortKey;

    regularItems.sort(sortFn);
    internetItems.sort(sortFn);

    function renderItemRow(item) {
        if (item.locations && item.locations.length > 0) {
            if (!item.locations.includes(currentLocation)) return '';
        }
        if (item.관리주기 === 'weekly' && !isTuesday && !showWeeklyForced && item.vendor !== '인터넷발주') return '';

        const rawItemKey = `${item.vendor}_${item.품목명}`;
        const locItemKey = `${currentLocation}_${rawItemKey}`;

        const currentStock = inventory[locItemKey];
        const displayValue = (currentStock === undefined || currentStock === 0) ? '' : currentStock;

        let prevStock = '-';
        if (lastSavedInventory[locItemKey] !== undefined) {
            prevStock = lastSavedInventory[locItemKey];
        }

        // 마지막 저장 날짜 (03/01 형식)
        const lastSaveDate = lastSavedInventory[`meta_last_save_${currentLocation}`];
        const prevDateLabel = lastSaveDate ? lastSaveDate.substring(5).replace('-', '/') : '-';

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
                    ${item.servings && item.servings.length > 0 ? `<div style="font-size:10px; color:#1565c0; font-weight:normal; margin-top:1px;">📏 ${getServingDisplayText(item)}</div>` : ''}
                </div>

                <div class="irc-controls">
                    <div class="irc-stat-box prev-stat">
                        <span class="irc-stat-val" style="color:#888;">${prevStock}</span>
                        <span>${prevDateLabel}</span>
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

// ==========================================
// 재고 저장
// ==========================================
async function saveInventory() {
    saveCurrentInputToMemory();

    const todayStr = new Date().toISOString().split('T')[0];
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

// ==========================================
// 사용량 관리
// ==========================================
function captureStandardInput() {
    Object.keys(items).forEach(vendor => {
        items[vendor].forEach(item => {
            const itemKey = `${vendor}_${item.품목명}`;
            const input = document.getElementById(`usage_${itemKey}`);
            if (input) dailyUsage[itemKey] = input.value === '' ? 0 : parseFloat(input.value);
        });
    });
}

function selectStandardVendor(vendor) {
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

async function saveStandard() {
    captureStandardInput();
    try {
        const response = await fetch(`${API_BASE}/api/inventory/daily-usage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usage: dailyUsage })
        });
        const result = await response.json();
        if (result.success) showAlert('사용량이 저장되었습니다.', 'success');
        else showAlert('사용량 저장 실패', 'error');
    } catch (e) { console.error(e); }
}
