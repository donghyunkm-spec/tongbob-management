// inventory-check.js - 재고 확인 및 발주 프로세스

// ==========================================
// 재고 확인 렌더링
// ==========================================
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

    // 3. 데이터 준비
    let displayInventory = {};
    let lastSaveDate1 = null;
    let lastSaveDate3 = null;

    if (checkDateOffset === 0) {
        const hasInput1 = Object.keys(inventory).some(k => k.startsWith('1루_') && !k.startsWith('meta_'));
        const hasInput3 = Object.keys(inventory).some(k => k.startsWith('3루_') && !k.startsWith('meta_'));

        if (hasInput1) {
            Object.keys(inventory).filter(k => k.startsWith('1루_')).forEach(k => displayInventory[k] = inventory[k]);
            lastSaveDate1 = '오늘 입력중';
        } else {
            Object.keys(lastSavedInventory).filter(k => k.startsWith('1루_') && !k.startsWith('meta_')).forEach(k => displayInventory[k] = lastSavedInventory[k]);
            lastSaveDate1 = lastSavedInventory['meta_last_save_1루'] || '기록없음';
        }

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

    // 4. 데이터 가공
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

    // 5. 필터링
    let filteredItems = allCheckItems.filter(item => {
        if (checkVendorFilter !== 'all' && item.vendor !== checkVendorFilter) return false;
        if (checkSearchText && !item.품목명.includes(checkSearchText)) return false;
        return true;
    });

    // 6. 정렬
    if (checkSortKey === 'diff_asc') {
        filteredItems.sort((a, b) => a.diff - b.diff);
    } else if (checkSortKey === 'diff_desc') {
        filteredItems.sort((a, b) => b.diff - a.diff);
    } else if (checkSortKey === 'name') {
        filteredItems.sort((a, b) => a.품목명.localeCompare(b.품목명));
    } else {
        filteredItems.sort((a, b) => {
            if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
            const sortA = (currentLocation === '1루') ? (a.sort1 ?? 9999) : (a.sort3 ?? 9999);
            const sortB = (currentLocation === '1루') ? (b.sort1 ?? 9999) : (b.sort3 ?? 9999);
            return sortA - sortB;
        });
    }

    // 7. 컨트롤 바 HTML
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

    let lastVendor = '';

    if (filteredItems.length === 0) {
        tableHtml += `<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">검색 결과가 없습니다.</td></tr>`;
    } else {
        filteredItems.forEach(item => {
            if (checkSortKey === 'vendor' && item.vendor !== lastVendor) {
                tableHtml += `<tr style="background:#f8f9fa;"><td colspan="6" style="text-align:left; font-size:12px; font-weight:bold; color:#555; padding-left:10px;">📦 ${item.vendor}</td></tr>`;
                lastVendor = item.vendor;
            }

            let displayUnit = item.발주단위;
            if (item.vendor === '한강유통(고기)') displayUnit = getMeatVendorInfo(item.품목명).inputUnit;

            const diffClass = (item.diff >= 0) ? 'diff-plus' : 'diff-minus';
            const diffSign = (item.diff > 0) ? '+' : '';

            let infoBadge = '';
            if (item.thresholdQty || item.minOrderQty) {
                infoBadge = `<div style="margin-top:2px; font-size:10px; color:#e65100; display:inline-block; background:#fff3e0; padding:1px 4px; border-radius:3px; border:1px solid #ffe0b2;">
                    📉임계:${item.thresholdQty!==null ? item.thresholdQty : '-'} / 📦최소:${item.minOrderQty!==null ? item.minOrderQty : '-'}
                </div>`;
            }

            let vendorBadge = '';
            if (checkSortKey !== 'vendor') {
                vendorBadge = `<span style="font-size:10px; color:#888; background:#eee; padding:1px 3px; border-radius:2px; margin-right:4px;">${item.vendor.substr(0,2)}</span>`;
            }

            const servingBadge = item.servings && item.servings.length > 0
                ? `<div style="font-size:10px; color:#1565c0; margin-top:1px;">📏 ${getServingDisplayText(item)}</div>`
                : '';

            tableHtml += `
                <tr>
                    <td style="text-align:left; line-height:1.3;">
                        ${vendorBadge}${item.품목명}
                        ${infoBadge}
                        ${servingBadge}
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

// ==========================================
// 필터/정렬 헬퍼
// ==========================================
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

function changeCheckDate(delta) {
    checkDateOffset += delta;
    renderInventoryCheck();
}

function scrollToVendor(vendor) {
    const section = document.getElementById(`vendor-section-${vendor}`);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ==========================================
// 배송일 계산
// ==========================================
function getDaysUntilNextDelivery(vendor) {
    const today = new Date();
    let daysCount = 0;
    let checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() + 1);

    for (let i = 0; i < 7; i++) {
        const dateStr = checkDate.toISOString().split('T')[0];
        const dow = checkDate.getDay();

        const isStoreRegularHoliday = (dow === 1);
        const isStoreTempHoliday = holidays['store'] && holidays['store'].includes(dateStr);
        const isStoreTempOpen = holidays['store_open'] && holidays['store_open'].includes(dateStr);
        const isStoreClosed = (isStoreRegularHoliday && !isStoreTempOpen) || isStoreTempHoliday;

        const isSundayForVendor = (vendor === '고센유통' || vendor === '한강유통(고기)') && dow === 0;
        const isVendorHoliday = holidays[vendor] && holidays[vendor].includes(dateStr);
        const isDeliveryPossible = !isSundayForVendor && !isVendorHoliday;

        if (i === 0) {
            if (!isStoreClosed) {
                daysCount++;
            }
        } else {
            if (isDeliveryPossible) {
                break;
            }
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

    let deliveryDate = new Date(today);
    deliveryDate.setDate(deliveryDate.getDate() + 1);

    for (let i = 0; i < 7; i++) {
        const dow = deliveryDate.getDay();
        const dateStr = deliveryDate.toISOString().split('T')[0];

        const isStoreRegularHoliday = (dow === 1);
        const isStoreTempHoliday = holidays['store'] && holidays['store'].includes(dateStr);
        const isStoreTempOpen = holidays['store_open'] && holidays['store_open'].includes(dateStr);
        const isStoreOpen = (!isStoreRegularHoliday || isStoreTempOpen) && !isStoreTempHoliday;

        const isSundayForVendor = (vendor === '고센유통' || vendor === '한강유통(고기)') && dow === 0;
        const isVendorHoliday = holidays[vendor] && holidays[vendor].includes(dateStr);
        const isDeliveryPossible = !isSundayForVendor && !isVendorHoliday;

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

// ==========================================
// 발주 프로세스
// ==========================================
function triggerOrderProcess() {
    console.log('[DEBUG] 발주진행 버튼 클릭됨');
    console.log('[DEBUG] checkDateOffset:', checkDateOffset);

    if (checkDateOffset !== 0) {
        showAlert('오늘 날짜에서만 발주가 가능합니다.', 'error');
        return;
    }

    const lastSaveDate1 = lastSavedInventory['meta_last_save_1루'];
    const lastSaveDate3 = lastSavedInventory['meta_last_save_3루'];
    const hasInput1 = Object.keys(inventory).some(k => k.startsWith('1루_') && !k.startsWith('meta_'));
    const hasInput3 = Object.keys(inventory).some(k => k.startsWith('3루_') && !k.startsWith('meta_'));

    if (!hasInput1 && !hasInput3 && lastSaveDate1 !== lastSaveDate3) {
        const msg = `⚠️ 1루와 3루 재고 기준일이 다릅니다!\n\n` +
                    `• 1루: ${lastSaveDate1 || '기록없음'}\n` +
                    `• 3루: ${lastSaveDate3 || '기록없음'}\n\n` +
                    `정확한 발주를 위해 최신 재고를 입력해주세요.\n그래도 발주를 진행하시겠습니까?`;
        if (!confirm(msg)) return;
    }

    console.log('[DEBUG] items:', items);
    console.log('[DEBUG] inventory:', inventory);

    checkOrderConfirmation();
}

function checkOrderConfirmation() {
    const confirmItems = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [] };
    const checkItems = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [] };
    const dangerItems = [];

    let missingInputCount = 0;
    const today = new Date();
    const isTuesday = today.getDay() === 2;

    for (const vendor in items) {
        const vendorItems = items[vendor];
        const daysNeeded = getDaysUntilNextDelivery(vendor);

        vendorItems.forEach(item => {
            if (item.관리주기 === 'weekly' && !isTuesday && vendor !== '인터넷발주') return;
            if (item.발주제외) return;  // 발주제외 품목 스킵
            const rawItemKey = `${vendor}_${item.품목명}`;

            const stock1 = inventory[`1루_${rawItemKey}`] || 0;
            const stock3 = inventory[`3루_${rawItemKey}`] || 0;
            const totalStock = stock1 + stock3;

            const usage = dailyUsage[rawItemKey] || 0;
            const neededTotal = usage * daysNeeded;

            let orderAmountRaw = Math.max(0, neededTotal - totalStock);

            if (item.thresholdQty && item.minOrderQty) {
                if (totalStock <= item.thresholdQty) orderAmountRaw = item.minOrderQty;
                else orderAmountRaw = 0;
            }

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

            if (displayQty > 0) {
                confirmItems[vendor].push(itemData);
            } else {
                checkItems[vendor].push(itemData);
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

    // 재고 0 경고
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

    // 발주 예정 리스트
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

    // 미발주 품목
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

function toggleCheckList() {
    const el = document.getElementById('checkListContainer');
    if(el.style.display === 'none') el.style.display = 'block';
    else el.style.display = 'none';
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

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

    for (const vendor in currentConfirmItems) {
        const vendorItems = currentConfirmItems[vendor];
        vendorItems.forEach(item => {
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
        const vendorItems = orderData[vendor];
        if (vendorItems.length > 0) {
            let actionBtn = (vendor === '한강유통(고기)')
                ? `<button onclick="goToOrderHistory()" class="btn-goto-history">📂 내역</button>`
                : `<button onclick="copyVendorOrder('${vendor}')" class="btn-mini-kakao">💬 복사</button>`;

            html += `
                <div class="order-section">
                    <div class="order-section-header">
                        <h3>${vendor} (${vendorItems[0].daysNeeded}일치)</h3>
                        ${actionBtn}
                    </div>
                    <div class="order-items" id="order_${vendor}">`;
            vendorItems.forEach(item => {
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

function copyToKakao() {
    const today = new Date();
    const month = today.getMonth() + 1;
    const date = today.getDate();
    const time = `${today.getHours()}:${String(today.getMinutes()).padStart(2, '0')}`;

    let copyText = `📦 [발주 리스트]\n📅 ${month}/${date} (${time}) 작성\n----------------------------\n`;

    const orderSections = document.querySelectorAll('.order-section');

    orderSections.forEach(section => {
        const vendorFullText = section.querySelector('h3').textContent;
        const vendor = vendorFullText.split('(')[0].trim();
        const itemsText = section.querySelector('.order-items').innerText;

        const dInfo = getDeliveryInfo(vendor);

        copyText += `\n■ ${vendor}\n`;
        copyText += `   ${dInfo.month}월 ${dInfo.date}일 ${dInfo.dayOfWeek}요일 입고 (${dInfo.days}일치)\n`;

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

// ==========================================
// 인분 현황 모달
// ==========================================
function showServingOverview() {
    const modal = document.getElementById('servingOverviewModal');
    const content = document.getElementById('servingOverviewContent');

    // 현재 재고 데이터 수집
    let displayInventory = {};
    Object.keys(inventory).filter(k => !k.startsWith('meta_')).forEach(k => displayInventory[k] = inventory[k]);
    // lastSaved도 합치기 (입력 안 된 매장 보완)
    Object.keys(lastSavedInventory).filter(k => !k.startsWith('meta_')).forEach(k => {
        if (displayInventory[k] === undefined) displayInventory[k] = lastSavedInventory[k];
    });

    // 인분 정보가 있는 품목만 수집
    let servingItems = [];
    Object.keys(items).forEach(vendor => {
        items[vendor].forEach(item => {
            if (!item.servings || item.servings.length === 0) return;

            const rawKey = `${vendor}_${item.품목명}`;
            const stock1 = displayInventory[`1루_${rawKey}`] || 0;
            const stock3 = displayInventory[`3루_${rawKey}`] || 0;
            const totalStock = stock1 + stock3;

            const calculated = item.servings.map(s => ({
                name: s.name || '',
                servings: Math.floor(totalStock * s.perUnit)
            }));

            servingItems.push({
                품목명: item.품목명,
                vendor: vendor,
                발주단위: item.발주단위,
                totalStock: totalStock,
                servingCalcs: calculated
            });
        });
    });

    if (servingItems.length === 0) {
        content.innerHTML = `
            <div style="text-align:center; padding:30px; color:#999;">
                <p style="font-size:16px; margin-bottom:10px;">인분 정보가 설정된 품목이 없습니다.</p>
                <p style="font-size:13px;">품목관리 탭에서 품목을 수정(✏️)하여<br>"인분 정보"를 추가해주세요.</p>
            </div>`;
        modal.classList.add('active');
        return;
    }

    let html = `
        <div style="background:#e8f5e9; border:1px solid #a5d6a7; border-radius:6px; padding:10px; margin-bottom:12px; font-size:12px; color:#2e7d32;">
            현재 재고 기준으로 각 품목이 몇 인분 분량인지 보여줍니다.
        </div>
    `;

    // 품목별 카드 형태로 표시
    servingItems.forEach(item => {
        const vendorShort = item.vendor.substr(0, 2);

        html += `
            <div style="background:white; border:1px solid #e0e0e0; border-radius:8px; padding:12px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div>
                        <span style="font-size:10px; background:#e3f2fd; color:#1565c0; padding:2px 5px; border-radius:3px;">${vendorShort}</span>
                        <strong style="margin-left:5px; font-size:15px;">${item.품목명}</strong>
                    </div>
                    <div style="font-size:13px; color:#666;">
                        현재 <strong style="color:#333;">${item.totalStock}</strong> ${item.발주단위}
                    </div>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">`;

        item.servingCalcs.forEach(calc => {
            const label = calc.name ? calc.name : '';
            const color = calc.servings <= 0 ? '#f44336' : calc.servings <= 50 ? '#ff9800' : '#4caf50';
            const bgColor = calc.servings <= 0 ? '#ffebee' : calc.servings <= 50 ? '#fff3e0' : '#e8f5e9';

            html += `
                <div style="background:${bgColor}; border:1px solid ${color}; border-radius:6px; padding:8px 12px; flex:1; min-width:120px; text-align:center;">
                    ${label ? `<div style="font-size:11px; color:#666; margin-bottom:3px;">${label}</div>` : ''}
                    <div style="font-size:22px; font-weight:bold; color:${color};">${calc.servings}</div>
                    <div style="font-size:11px; color:#888;">인분</div>
                </div>`;
        });

        html += `</div></div>`;
    });

    content.innerHTML = html;
    modal.classList.add('active');
}

function closeServingOverview() {
    document.getElementById('servingOverviewModal').classList.remove('active');
}
