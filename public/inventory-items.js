// inventory-items.js - 품목 관리 CRUD

// ==========================================
// 품목 관리 목록 렌더링
// ==========================================
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
                <label class="sort-toggle-label ${manageSortMode==='all' ? 'checked' : ''}">
                    <input type="radio" name="sortMode" value="all"
                        ${manageSortMode==='all' ? 'checked' : ''}
                        onchange="changeSortMode(this.value)">
                    📋 전체
                </label>
                <label class="sort-toggle-label ${manageSortMode==='1루' ? 'checked' : ''}">
                    <input type="radio" name="sortMode" value="1루"
                        ${manageSortMode==='1루' ? 'checked' : ''}
                        onchange="changeSortMode(this.value)">
                    ⚾ 1루 순서
                </label>
                <label class="sort-toggle-label ${manageSortMode==='3루' ? 'checked' : ''}">
                    <input type="radio" name="sortMode" value="3루"
                        ${manageSortMode==='3루' ? 'checked' : ''}
                        onchange="changeSortMode(this.value)">
                    ⚾ 3루 순서
                </label>
            </div>
        </div>

        ${manageSortMode !== 'all' ? `<div style="margin-bottom:10px; color:#666; font-size:11px; text-align:center; background:#fff3e0; padding:5px; border-radius:4px;">
            💡 위아래 화살표(▲▼)를 눌러 <strong>선택된 매장의 순서</strong>를 변경하세요.
        </div>` : ''}
    `;

    // 2. sort 값 없는 품목에 자동 번호 부여 (초기화) - 전체 모드에서는 불필요
    const isAllMode = manageSortMode === 'all';
    const sortProp = (manageSortMode === '3루') ? 'sort3' : 'sort1';
    if (!isAllMode) {
        let maxSort = -1;
        Object.keys(items).forEach(vendor => {
            if (!items[vendor]) return;
            items[vendor].forEach(item => {
                if (typeof item[sortProp] === 'number') maxSort = Math.max(maxSort, item[sortProp]);
            });
        });
        Object.keys(items).forEach(vendor => {
            if (!items[vendor]) return;
            items[vendor].forEach(item => {
                if (typeof item[sortProp] !== 'number') {
                    maxSort++;
                    item[sortProp] = maxSort;
                }
            });
        });
    }

    // 3. 통합 리스트 생성 (전역 정렬을 위해) - [NEW] 필터 적용
    let flatList = [];

    // [NEW] 선택된 업체에 따라 필터링
    const vendorsToShow = (selectedVendor === 'all')
        ? Object.keys(items)
        : [selectedVendor];

    vendorsToShow.forEach(vendor => {
        if (!items[vendor]) return; // 업체가 없으면 스킵
        items[vendor].forEach((item, idx) => {
            // 매장별 모드에서는 해당 매장 품목만 표시
            if (!isAllMode) {
                const locations = item.locations || ['1루', '3루'];
                if (!locations.includes(manageSortMode)) return;
            }

            flatList.push({
                ...item,
                vendor: vendor,
                originalIdx: idx,
                sortKey: isAllMode ? idx : (item[sortProp] ?? 9999)
            });
        });
    });

    // 현재 모드 기준으로 정렬 (전체 모드에서는 업체별 원본 순서)
    if (!isAllMode) flatList.sort((a, b) => a.sortKey - b.sortKey);

    // 3. 리스트 렌더링
    let listHtml = '<ul style="list-style:none; padding:0;">';
    flatList.forEach((item, visualIdx) => {
        listHtml += `
            <li class="manage-row-global">
                ${!isAllMode ? `<div style="display:flex; flex-direction:column; gap:2px; margin-right:10px;">
                    <button onclick="moveGlobalSort(${visualIdx}, -1)" style="border:1px solid #ddd; background:white; padding:2px 8px; cursor:pointer;">▲</button>
                    <button onclick="moveGlobalSort(${visualIdx}, 1)" style="border:1px solid #ddd; background:white; padding:2px 8px; cursor:pointer;">▼</button>
                </div>` : ''}

                <div class="mrg-info">
                    <span style="font-size:11px; background:#e3f2fd; color:#1565C0; padding:2px 4px; border-radius:3px;">${item.vendor}</span>
                    <span style="font-weight:bold; margin-left:5px;">${item.품목명}</span>
                    ${!isAllMode ? `<span style="color:#999; font-size:12px;">(현재순서: ${item.sortKey===9999 ? '없음' : item.sortKey})</span>` : ''}
                    ${item.locations && item.locations.length > 0
                        ? `<span style="background:#e8f5e9; color:#2e7d32; font-size:10px; padding:2px 5px; border-radius:3px; margin-left:5px;">📍 ${item.locations.join(', ')}</span>`
                        : '<span style="background:#f5f5f5; color:#888; font-size:10px; padding:2px 5px; border-radius:3px; margin-left:5px;">📍 모든 위치</span>'}
                    ${item.minStockPerLocation
                        ? `<span style="background:#e8eaf6; color:#283593; font-size:10px; padding:2px 5px; border-radius:3px; margin-left:5px;">
                            🏪 매장별 최소:${item.minStockPerLocation}
                           </span>`
                        : ''}
                    ${item.thresholdQty || item.minOrderQty
                        ? `<span style="background:#fff3e0; color:#e65100; font-size:10px; padding:2px 5px; border-radius:3px; margin-left:5px;">
                            📊 임계:${item.thresholdQty || '-'} / 최소:${item.minOrderQty || '-'}
                           </span>`
                        : ''}
                    ${(() => { const u = dailyUsage[`${item.vendor}_${item.품목명}`]; return u ? `<span style="background:#f3e5f5; color:#6a1b9a; font-size:10px; padding:2px 5px; border-radius:3px; margin-left:5px;">📦 사용량:${u}/${item.발주단위||'단위'}</span>` : ''; })()}
                    ${item.발주제외
                        ? `<span style="background:#ffebee; color:#c62828; font-size:10px; padding:2px 5px; border-radius:3px; margin-left:5px;">🚫 발주제외</span>`
                        : ''}
                    ${item.servings && item.servings.length > 0
                        ? `<div style="font-size:11px; color:#1565c0; margin-top:2px;">📏 ${item.servings.map(s => (s.name ? s.name + ' ' : '') + s.perUnit + '인분/' + (item.발주단위||'단위')).join(' · ')}</div>`
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

// ==========================================
// 전역 정렬 이동 (업체 구분 없이 Swap)
// ==========================================
function moveGlobalSort(visualIdx, direction) {
    // 1. 전체 리스트를 다시 구성하여 현재 순서를 파악
    let flatList = [];
    Object.keys(items).forEach(vendor => {
        items[vendor].forEach((item, idx) => {
            // 해당 매장에 속하지 않는 품목은 스킵
            const locations = item.locations || ['1루', '3루'];
            if (!locations.includes(manageSortMode)) return;

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

    // 3. 전체 재정렬 (안전한 방법: 0부터 다시 번호 매기기)
    flatList.forEach((obj, idx) => {
        if (manageSortMode === '1루') obj.itemRef.sort1 = idx;
        else obj.itemRef.sort3 = idx;
    });

    // 이제 Swap
    if (manageSortMode === '1루') {
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

// ==========================================
// 업체별 정렬 이동
// ==========================================
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

    // 2. 두 아이템의 sort 값을 교환
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

// ==========================================
// 품목 삭제
// ==========================================
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

// ==========================================
// 새 품목 추가
// ==========================================
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

    const servingName = document.getElementById('newServingName')?.value.trim() || '';
    const servingPerUnit = parseFloat(document.getElementById('newServingPerUnit')?.value) || 0;

    // 새 품목의 sort 값: 전체 품목 중 최대값 + 1
    let maxSort1 = -1, maxSort3 = -1;
    Object.keys(items).forEach(v => {
        if (!items[v]) return;
        items[v].forEach(it => {
            if (typeof it.sort1 === 'number') maxSort1 = Math.max(maxSort1, it.sort1);
            if (typeof it.sort3 === 'number') maxSort3 = Math.max(maxSort3, it.sort3);
        });
    });

    const newItem = {
        "품목명": name,
        "발주단위": unit || '개',
        "중요도": importance,
        "관리주기": cycle,
        "locations": locations,
        "sort1": maxSort1 + 1,
        "sort3": maxSort3 + 1
    };
    if (servingPerUnit > 0) {
        newItem.servings = [{ name: servingName, perUnit: servingPerUnit }];
    }

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
            const newServName = document.getElementById('newServingName');
            const newServPU = document.getElementById('newServingPerUnit');
            if (newServName) newServName.value = '';
            if (newServPU) newServPU.value = '';
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

// ==========================================
// 수정 모달
// ==========================================
function openEditItemModal(vendor, index) {
    const item = items[vendor][index];
    if (!item) return;

    document.getElementById('editVendor').value = vendor;
    document.getElementById('editIndex').value = index;

    // 거래처 선택
    const editVendorSelect = document.getElementById('editVendorSelect');
    if (editVendorSelect) editVendorSelect.value = vendor;

    document.getElementById('editName').value = item.품목명;
    document.getElementById('editUnit').value = item.발주단위;
    document.getElementById('editImportance').value = item.중요도 || '중';
    document.getElementById('editCycle').value = item.관리주기 || 'daily';

    // 매장별 최소재고 설정
    document.getElementById('editMinStockPerLocation').value = item.minStockPerLocation || '';

    // 임계값/최소발주량 설정
    document.getElementById('editThreshold').value = item.thresholdQty || '';
    document.getElementById('editMinOrder').value = item.minOrderQty || '';

    // 발주제외 설정
    const editSkipOrder = document.getElementById('editSkipOrder');
    if (editSkipOrder) editSkipOrder.checked = item.발주제외 || false;

    // 원재료 연결 설정
    const editSourceItems = document.getElementById('editSourceItems');
    if (editSourceItems) editSourceItems.value = (item.sourceItems || []).join(', ');

    // 하루 사용량 설정
    const usageKey = `${vendor}_${item.품목명}`;
    const editDailyUsage = document.getElementById('editDailyUsage');
    if (editDailyUsage) {
        const usage = dailyUsage[usageKey] || 0;
        editDailyUsage.value = usage > 0 ? usage : '';
    }
    const editDailyUsageUnit = document.getElementById('editDailyUsageUnit');
    if (editDailyUsageUnit) editDailyUsageUnit.textContent = item.발주단위 || '';

    // 인분 정보 설정 (구조화된 servings)
    const container = document.getElementById('editServingsContainer');
    if (container) {
        container.innerHTML = '';
        if (item.servings && item.servings.length > 0) {
            item.servings.forEach(s => addEditServingRow(s.name || '', s.perUnit || ''));
        } else if (item.servingInfo) {
            // 이전 텍스트 형식 호환: 빈 행 하나 추가
            addEditServingRow('', '');
        }
    }

    // 위치 정보 설정
    const editLoc1 = document.getElementById('editLoc1');
    const editLoc3 = document.getElementById('editLoc3');
    if (editLoc1 && editLoc3) {
        const locations = item.locations || ['1루', '3루']; // 기본값: 모든 위치
        editLoc1.checked = locations.includes('1루');
        editLoc3.checked = locations.includes('3루');
    }

    document.getElementById('editItemModal').classList.add('active');
}

function closeEditItemModal() {
    document.getElementById('editItemModal').classList.remove('active');
}

function saveEditItem() {
    const vendor = document.getElementById('editVendor').value;
    const index = parseInt(document.getElementById('editIndex').value);

    const newName = document.getElementById('editName').value.trim();
    const newUnit = document.getElementById('editUnit').value.trim();
    const newImp = document.getElementById('editImportance').value;
    const newCycle = document.getElementById('editCycle').value;

    // 매장별 최소재고 수집
    const minStockPerLocVal = document.getElementById('editMinStockPerLocation').value.trim();
    const newMinStockPerLocation = minStockPerLocVal ? parseFloat(minStockPerLocVal) : null;

    // 임계값/최소발주량 수집
    const thresholdVal = document.getElementById('editThreshold').value.trim();
    const minOrderVal = document.getElementById('editMinOrder').value.trim();
    const newThreshold = thresholdVal ? parseFloat(thresholdVal) : null;
    const newMinOrder = minOrderVal ? parseFloat(minOrderVal) : null;

    // 거래처 변경 수집
    const newVendor = document.getElementById('editVendorSelect').value;

    // 발주제외 수집
    const editSkipOrder = document.getElementById('editSkipOrder');
    const newSkipOrder = editSkipOrder ? editSkipOrder.checked : false;

    // 원재료 연결 수집
    const editSourceItems = document.getElementById('editSourceItems');
    const sourceItemsRaw = editSourceItems ? editSourceItems.value.trim() : '';
    const newSourceItems = sourceItemsRaw ? sourceItemsRaw.split(',').map(s => s.trim()).filter(s => s) : [];

    // 하루 사용량 수집
    const editDailyUsage = document.getElementById('editDailyUsage');
    const newDailyUsage = editDailyUsage ? parseFloat(editDailyUsage.value) || 0 : 0;

    // 인분 정보 수집 (구조화)
    const newServings = getEditServings();

    // 위치 정보 수집
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
    const updatedItem = {
        ...items[vendor][index],
        "품목명": newName,
        "발주단위": newUnit,
        "중요도": newImp,
        "관리주기": newCycle,
        "locations": newLocations,
        "minStockPerLocation": newMinStockPerLocation,
        "thresholdQty": newThreshold,
        "minOrderQty": newMinOrder,
        "발주제외": newSkipOrder,
        "servings": newServings.length > 0 ? newServings : undefined
    };
    if (newSourceItems.length > 0) {
        updatedItem.sourceItems = newSourceItems;
    } else {
        delete updatedItem.sourceItems;
    }
    // 이전 텍스트 형식 제거
    delete updatedItem.servingInfo;

    // 거래처 변경 처리
    if (newVendor !== vendor) {
        items[vendor].splice(index, 1);
        if (!items[newVendor]) items[newVendor] = [];
        items[newVendor].push(updatedItem);
    } else {
        items[vendor][index] = updatedItem;
    }

    // 하루 사용량 저장
    const usageKey = `${newVendor}_${newName}`;
    dailyUsage[usageKey] = newDailyUsage;
    // 비동기로 사용량 서버 저장 (실패해도 UI 블로킹 안함)
    fetch(`${API_BASE}/api/inventory/daily-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usage: dailyUsage })
    }).catch(e => console.error('사용량 저장 실패:', e));

    closeEditItemModal();
    renderManageItems();
    showAlert('수정되었습니다. 하단의 [저장] 버튼을 눌러 확정하세요.', 'success');
}

// ==========================================
// 품목 변경사항 저장
// ==========================================
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
        showAlert(`에러 발생: ${e.message}`, 'error');
        renderUnifiedInventoryForm();
    }
}

// ==========================================
// 인분 정보 편집 헬퍼
// ==========================================
function addEditServingRow(name, perUnit) {
    const container = document.getElementById('editServingsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:5px; margin-bottom:5px; align-items:center;';
    row.innerHTML = `
        <input type="text" class="serving-name" value="${name || ''}" placeholder="용도 (예: 도시락)" style="flex:1; padding:6px; font-size:13px; border:1px solid #ddd; border-radius:4px;">
        <input type="number" class="serving-per-unit" value="${perUnit || ''}" placeholder="인분수" step="0.1" style="width:70px; padding:6px; font-size:13px; border:1px solid #ddd; border-radius:4px;">
        <span style="font-size:11px; color:#666; white-space:nowrap;">/1단위</span>
        <button type="button" onclick="this.parentElement.remove()" style="background:#f44336; color:white; border:none; border-radius:3px; padding:4px 8px; cursor:pointer; font-size:14px;">×</button>
    `;
    container.appendChild(row);
}

function getEditServings() {
    const rows = document.querySelectorAll('#editServingsContainer > div');
    const servings = [];
    rows.forEach(row => {
        const name = row.querySelector('.serving-name').value.trim();
        const perUnit = parseFloat(row.querySelector('.serving-per-unit').value);
        if (perUnit > 0) {
            servings.push({ name: name, perUnit: perUnit });
        }
    });
    return servings;
}

// 인분 표시 텍스트 생성 헬퍼
function getServingDisplayText(item) {
    if (!item.servings || item.servings.length === 0) return '';
    const unit = item.발주단위 || '단위';
    return item.servings.map(s => {
        const label = s.name ? s.name + ' ' : '';
        return `${label}${s.perUnit}인분/${unit}`;
    }).join(' · ');
}
