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

    let lastSaveDateW = null;

    if (checkDateOffset === 0) {
        ['1루', '3루', '창고'].forEach(loc => {
            const hasInput = Object.keys(inventory).some(k => k.startsWith(`${loc}_`) && !k.startsWith('meta_'));
            if (hasInput) {
                Object.keys(inventory).filter(k => k.startsWith(`${loc}_`)).forEach(k => displayInventory[k] = inventory[k]);
                if (loc === '1루') lastSaveDate1 = '오늘 입력중';
                else if (loc === '3루') lastSaveDate3 = '오늘 입력중';
                else lastSaveDateW = '오늘 입력중';
            } else {
                Object.keys(lastSavedInventory).filter(k => k.startsWith(`${loc}_`) && !k.startsWith('meta_')).forEach(k => displayInventory[k] = lastSavedInventory[k]);
                const meta = lastSavedInventory[`meta_last_save_${loc}`] || '기록없음';
                if (loc === '1루') lastSaveDate1 = meta;
                else if (loc === '3루') lastSaveDate3 = meta;
                else lastSaveDateW = meta;
            }
        });
    } else if (checkDateOffset > 0) {
        container.innerHTML = `<div style="padding:50px; text-align:center; color:#999;">미래의 데이터는 볼 수 없습니다.</div>`;
        return;
    } else {
        const record = recentHistory.filter(r => r.date === dateStr).pop();
        if (record) {
            Object.values(record.inventory).forEach(vendorObj => Object.assign(displayInventory, vendorObj));
            lastSaveDate1 = dateStr;
            lastSaveDate3 = dateStr;
            lastSaveDateW = dateStr;
        } else {
            container.innerHTML = `<div style="padding:50px; text-align:center; color:#999;">${dateStr} 기록이 없습니다.</div>`;
            return;
        }
    }

    // 3.5. 예상재고 계산 (어제재고 + 발주량)
    let expectedOrderMap = {}; // rawItemKey → 발주량(재고단위)
    let expectedOrderDate = null;
    let hasExpectedData = false;

    // 예상재고 기준 재고: lastSavedInventory (어제 마감 재고)
    let expectedBaseInventory = {};
    Object.keys(lastSavedInventory).forEach(k => {
        if (!k.startsWith('meta_')) expectedBaseInventory[k] = lastSavedInventory[k];
    });

    if (checkDateOffset === 0 && allOrders.length > 0) {
        // 가장 최근 발주를 찾아서 예상재고 계산
        const sorted = [...allOrders].sort((a, b) => b.date.localeCompare(a.date));
        const latestOrder = sorted[0];

        if (latestOrder && latestOrder.orders) {
            expectedOrderDate = latestOrder.date;
            for (const vendor in latestOrder.orders) {
                (latestOrder.orders[vendor] || []).forEach(oi => {
                    const key = `${vendor}_${oi.품목명}`;
                    let amt = oi.orderAmount || 0;
                    // 발주단위 → 재고단위 변환
                    const itemDef = (items[vendor] || []).find(it => it.품목명 === oi.품목명);
                    if (itemDef && itemDef.재고단위 && itemDef.unitsPerOrder) {
                        amt = amt / itemDef.unitsPerOrder;
                    }
                    expectedOrderMap[key] = (expectedOrderMap[key] || 0) + amt;
                });
            }
            hasExpectedData = Object.keys(expectedOrderMap).length > 0;
        }
    }

    // 4. 데이터 가공
    let allCheckItems = [];
    Object.keys(items).forEach(vendor => {
        items[vendor].forEach(item => {
            const rawItemKey = `${vendor}_${item.품목명}`;
            const stock1 = displayInventory[`1루_${rawItemKey}`] || 0;
            const stock3 = displayInventory[`3루_${rawItemKey}`] || 0;
            const stockW = displayInventory[`창고_${rawItemKey}`] || 0;
            const totalStock = parseFloat((stock1 + stock3 + stockW).toFixed(2));
            const usage = dailyUsage[rawItemKey] || 0;
            const diff = parseFloat((totalStock - usage).toFixed(2));

            const cost = (item.unitCost || 0) * totalStock;

            const orderQty = expectedOrderMap[rawItemKey] || 0;
            // 예상재고 = 어제 마감 재고(lastSavedInventory) + 발주량
            const expStock1 = expectedBaseInventory[`1루_${rawItemKey}`] || 0;
            const expStock3 = expectedBaseInventory[`3루_${rawItemKey}`] || 0;
            const expStockW = expectedBaseInventory[`창고_${rawItemKey}`] || 0;
            const expBase = parseFloat((expStock1 + expStock3 + expStockW).toFixed(2));
            const expectedTotal = parseFloat((expBase + orderQty).toFixed(2));
            const expectedDiff = parseFloat((expectedTotal - usage).toFixed(2));

            allCheckItems.push({
                ...item,
                vendor,
                rawItemKey,
                stock1,
                stock3,
                stockW,
                totalStock,
                usage,
                diff,
                cost,
                orderQty,
                expectedTotal,
                expectedDiff
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
            const sortA = (currentLocation === '1루') ? (a.sort1 ?? 9999) : (currentLocation === '3루') ? (a.sort3 ?? 9999) : (a.sortW ?? 9999);
            const sortB = (currentLocation === '1루') ? (b.sort1 ?? 9999) : (currentLocation === '3루') ? (b.sort3 ?? 9999) : (b.sortW ?? 9999);
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
    const dateWLabel = formatDateLabel(lastSaveDateW);
    const allDates = [lastSaveDate1, lastSaveDate3, lastSaveDateW].filter(d => d && d !== '기록없음');
    const isMismatch = checkDateOffset === 0 && allDates.length > 1 &&
                       !allDates.every(d => d === allDates[0] || d === '오늘 입력중');

    let dateInfoHtml = '';
    if (checkDateOffset === 0) {
        dateInfoHtml = `
            <div style="margin-bottom:8px; padding:8px 10px; background:#fff; border-radius:5px; border:1px solid #ddd; font-size:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
                    <span><strong>1루</strong>: <span style="color:#1976d2;">${date1Label}</span></span>
                    <span><strong>3루</strong>: <span style="color:#1976d2;">${date3Label}</span></span>
                    <span><strong>창고</strong>: <span style="color:#1976d2;">${dateWLabel}</span></span>
                </div>
                ${isMismatch ? `
                <div style="margin-top:6px; padding:6px 8px; background:#fff3e0; border:1px solid #ffb74d; border-radius:4px; color:#e65100;">
                    <strong>⚠️ 주의:</strong> 위치별 재고 기준일이 다릅니다! 발주 전 최신 재고를 입력해주세요.
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
                <option value="기타" ${checkVendorFilter==='기타'?'selected':''}>기타</option>
            </select>

            <input type="text" placeholder="품목명 검색" value="${checkSearchText}"
                oninput="updateCheckSearch(this.value)"
                style="flex:1; min-width:100px; padding:5px; height:32px; font-size:13px;">

            <div class="sort-btn-group" style="display:flex; gap:2px;">
                <button onclick="updateCheckSort('vendor')" class="sort-btn ${checkSortKey==='vendor'?'active':''}" title="업체별 보기">📂</button>
                <button onclick="updateCheckSort('name')" class="sort-btn ${checkSortKey==='name'?'active':''}" title="이름순">가나다</button>
                <button onclick="updateCheckSort('diff_asc')" class="sort-btn ${checkSortKey==='diff_asc'?'active':''}" title="부족한 순">🔥부족</button>
            </div>
            ${hasExpectedData ? `<button onclick="toggleExpectedStock()" style="padding:8px 14px; font-size:13px; font-weight:bold; border:2px solid ${showExpectedStock ? '#2e7d32' : '#ff9800'}; background:${showExpectedStock ? '#2e7d32' : '#fff3e0'}; color:${showExpectedStock ? 'white' : '#e65100'}; border-radius:20px; cursor:pointer; white-space:nowrap; ${showExpectedStock ? '' : 'animation:pulse 1.5s infinite;'}" title="어제재고+발주량 예상재고">📦 예상재고</button>` : ''}
        </div>
    `;

    if (hasExpectedData && showExpectedStock) {
        controlHtml += `
            <div style="margin-bottom:8px; padding:8px 10px; background:#e8f5e9; border-radius:5px; border:1px solid #a5d6a7; font-size:12px; color:#2e7d32;">
                📦 <strong>예상재고</strong>: ${expectedOrderDate} 재고 + 발주량 (배송 도착 가정)
            </div>
        `;
    }

    // 8. 테이블 그리기
    const showExp = hasExpectedData && showExpectedStock;
    let tableHtml = `
        <table class="check-table">
            <thead>
                <tr>
                    <th style="min-width:110px;">품목명</th>
                    <th>1루</th>
                    <th>3루</th>
                    <th>창고</th>
                    <th style="background:#e3f2fd;">합계</th>
                    ${showExp ? '<th style="background:#c8e6c9;">발주</th><th style="background:#a5d6a7;">예상</th>' : ''}
                    <th>1일사용</th>
                    <th>차이</th>
                </tr>
            </thead>
            <tbody>
    `;

    let lastVendor = '';

    const colSpan = showExp ? 9 : 7;

    if (filteredItems.length === 0) {
        tableHtml += `<tr><td colspan="${colSpan}" style="text-align:center; padding:20px; color:#999;">검색 결과가 없습니다.</td></tr>`;
    } else {
        filteredItems.forEach(item => {
            if (checkSortKey === 'vendor' && item.vendor !== lastVendor) {
                tableHtml += `<tr style="background:#f8f9fa;"><td colspan="${colSpan}" style="text-align:left; font-size:12px; font-weight:bold; color:#555; padding-left:10px;">📦 ${item.vendor}</td></tr>`;
                lastVendor = item.vendor;
            }

            let displayUnit = item.재고단위 || item.발주단위;
            if (!item.재고단위 && item.vendor === '한강유통(고기)') displayUnit = getMeatVendorInfo(item.품목명).inputUnit;

            const diffClass = (item.diff >= 0) ? 'diff-plus' : 'diff-minus';
            const diffSign = (item.diff > 0) ? '+' : '';

            const stockUnitTag = item.재고단위 ? `<span style="font-size:10px; color:#fff; background:#5c6bc0; padding:1px 4px; border-radius:3px; font-weight:bold; margin-left:2px;">${item.재고단위}</span>` : '';

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
                    <td>${parseFloat(item.stock1.toFixed(2))}${stockUnitTag}</td>
                    <td>${parseFloat(item.stock3.toFixed(2))}${stockUnitTag}</td>
                    <td>${parseFloat(item.stockW.toFixed(2))}${stockUnitTag}</td>
                    <td class="check-val" style="background:#e3f2fd;">${parseFloat(item.totalStock.toFixed(2))}${stockUnitTag}</td>
                    ${showExp ? `
                    <td style="background:#e8f5e9; color:#2e7d32; font-weight:bold;">${item.orderQty > 0 ? '+' + parseFloat(item.orderQty.toFixed(2)) : '-'}</td>
                    <td style="background:#c8e6c9; font-weight:bold;">${item.orderQty > 0 ? parseFloat(item.expectedTotal.toFixed(2)) : parseFloat(item.totalStock.toFixed(2))}${stockUnitTag}</td>
                    ` : ''}
                    <td>${parseFloat(item.usage.toFixed(2))}${stockUnitTag}</td>
                    <td class="${showExp && item.orderQty > 0 ? (item.expectedDiff >= 0 ? 'diff-plus' : 'diff-minus') : diffClass} check-val">${showExp && item.orderQty > 0 ? ((item.expectedDiff > 0 ? '+' : '') + parseFloat(item.expectedDiff.toFixed(1))) : (diffSign + parseFloat(item.diff.toFixed(1)))}</td>
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

function toggleExpectedStock() {
    showExpectedStock = !showExpectedStock;
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

    const locs = ['1루', '3루', '창고'];
    const locDates = locs.map(loc => ({ loc, date: lastSavedInventory[`meta_last_save_${loc}`] }));
    const hasAnyInput = locs.some(loc => Object.keys(inventory).some(k => k.startsWith(`${loc}_`) && !k.startsWith('meta_')));
    const uniqueDates = [...new Set(locDates.map(d => d.date).filter(Boolean))];

    if (!hasAnyInput && uniqueDates.length > 1) {
        const msg = `⚠️ 위치별 재고 기준일이 다릅니다!\n\n` +
                    locDates.map(d => `• ${d.loc}: ${d.date || '기록없음'}`).join('\n') +
                    `\n\n정확한 발주를 위해 최신 재고를 입력해주세요.\n그래도 발주를 진행하시겠습니까?`;
        if (!confirm(msg)) return;
    }

    console.log('[DEBUG] items:', items);
    console.log('[DEBUG] inventory:', inventory);

    checkOrderConfirmation();
}

function checkOrderConfirmation() {
    const confirmItems = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [], '기타': [] };
    const checkItems = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [], '기타': [] };
    const dangerItems = [];
    const sourceAlertItems = []; // 원재료 연결 품목 중 부족한 것

    let missingInputCount = 0;
    const today = new Date();
    const isTuesday = today.getDay() === 2;

    for (const vendor in items) {
        const vendorItems = items[vendor];
        const daysNeeded = getDaysUntilNextDelivery(vendor);

        vendorItems.forEach(item => {
            // 원재료 연결 품목: 발주제외 여부와 관계없이 재고 부족 시 알림
            if (item.sourceItems && item.sourceItems.length > 0) {
                const rawItemKey = `${vendor}_${item.품목명}`;
                const stock1 = inventory[`1루_${rawItemKey}`] || 0;
                const stock3 = inventory[`3루_${rawItemKey}`] || 0;
                const stockW = inventory[`창고_${rawItemKey}`] || 0;
                const totalStock = stock1 + stock3 + stockW;
                const usage = dailyUsage[rawItemKey] || 0;
                const neededTotal = usage * daysNeeded;
                if (totalStock < neededTotal || totalStock === 0) {
                    sourceAlertItems.push({
                        품목명: item.품목명,
                        currentStock: totalStock,
                        sourceItems: item.sourceItems,
                        발주단위: item.발주단위
                    });
                }
                return;
            }
            if (item.발주제외) return;  // 발주제외 품목 스킵
            const rawItemKey = `${vendor}_${item.품목명}`;
            // 주간품목: 사용량 있으면 매일 계산, 없으면 화요일만
            if (item.관리주기 === 'weekly' && !isTuesday && vendor !== '인터넷발주') {
                const weeklyUsage = dailyUsage[rawItemKey] || 0;
                if (weeklyUsage === 0) return;
            }

            const stock1 = inventory[`1루_${rawItemKey}`] || 0;
            const stock3 = inventory[`3루_${rawItemKey}`] || 0;
            const stockW = inventory[`창고_${rawItemKey}`] || 0;
            const totalStock = stock1 + stock3 + stockW;

            const usage = dailyUsage[rawItemKey] || 0;
            const neededTotal = usage * daysNeeded;

            let orderAmountRaw = Math.max(0, neededTotal - totalStock);

            if (item.thresholdQty && item.minOrderQty) {
                // 재고단위가 있으면 임계값/최소발주량을 재고단위로 변환해서 비교
                let thresholdInStock = item.thresholdQty;
                let minOrderInStock = item.minOrderQty;
                if (item.재고단위 && item.unitsPerOrder) {
                    thresholdInStock = item.thresholdQty / item.unitsPerOrder;
                    minOrderInStock = item.minOrderQty / item.unitsPerOrder;
                }
                if (totalStock <= thresholdInStock) orderAmountRaw = minOrderInStock;
                else orderAmountRaw = 0;
            }

            // 매장별 최소재고 체크: 각 매장 재고가 최소값 미만이면 부족분 추가
            if (item.minStockPerLocation) {
                const minStock = item.minStockPerLocation;
                let locationDeficit = 0;
                const locations = item.locations || ['1루', '3루'];
                locations.forEach(loc => {
                    const locStock = inventory[`${loc}_${rawItemKey}`] || 0;
                    if (locStock < minStock) {
                        locationDeficit += Math.ceil(minStock - locStock);
                    }
                });
                orderAmountRaw = Math.max(orderAmountRaw, locationDeficit);
            }

            let displayQty = 0;
            let displayUnit = item.발주단위;
            if (item.재고단위 && item.unitsPerOrder) {
                // 재고단위→발주단위 변환: orderAmountRaw(재고단위) × unitsPerOrder = 발주단위
                // 예) 삼겹살: 4팩 × 5 = 20kg / 우동: 5봉 × 0.125 = 0.625 → ceil = 1박스
                displayUnit = item.발주단위;
                if (orderAmountRaw > 0) displayQty = Math.ceil(orderAmountRaw * item.unitsPerOrder);
            } else if (vendor === '한강유통(고기)') {
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
    showConfirmModal(confirmItems, checkItems, missingInputCount, dangerItems, sourceAlertItems);
}

function showConfirmModal(confirmItems, checkItems, missingInputCount, dangerItems, sourceAlertItems) {
    const modal = document.getElementById('confirmModal');
    const content = document.getElementById('confirmContent');

    let html = '';
    let hasOrder = false;

    // 원재료 연결 품목 알림
    if (sourceAlertItems && sourceAlertItems.length > 0) {
        html += `<div style="background:#e8eaf6; border:3px solid #5c6bc0; border-radius:8px; padding:12px; margin-bottom:20px;">
            <h3 style="color:#283593; margin:0 0 10px 0; font-size:16px;">🔗 원재료 확인 필요 (${sourceAlertItems.length}개)</h3>
            <p style="font-size:12px; color:#283593; margin-bottom:10px;">아래 품목은 직접 발주하지 않고 원재료를 주문해야 합니다.</p>`;
        sourceAlertItems.forEach(item => {
            html += `<div style="background:white; border:1px solid #9fa8da; border-radius:6px; padding:10px; margin-bottom:8px;">
                <div style="font-weight:bold; font-size:14px; color:#283593; margin-bottom:4px;">
                    📌 ${item.품목명} <span style="font-size:12px; color:#666; font-weight:normal;">(현재 ${parseFloat(item.currentStock.toFixed(1))} ${item.발주단위})</span>
                </div>
                <div style="font-size:13px; color:#333;">
                    👉 발주 원재료: <strong style="color:#e65100;">${item.sourceItems.join(', ')}</strong>
                </div>
            </div>`;
        });
        html += `</div>`;
    }

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
                const stockUnitLabel = i.재고단위 || '';
                html += `<tr>
                    <td style="font-weight:bold;">${i.품목명}</td>
                    <td>${parseFloat(i.currentStock.toFixed(1))}${stockUnitLabel ? '<span style="font-size:10px; color:#fff; background:#5c6bc0; padding:1px 4px; border-radius:3px; font-weight:bold; margin-left:2px;">' + stockUnitLabel + '</span>' : ''}</td>
                    <td>
                        <input type="number" value="${i.orderAmount}"
                               data-vendor="${vendor}" data-index="${idx}"
                               onchange="updateOrderAmount('${vendor}', ${idx}, this.value)"
                               style="width:60px; padding:4px; text-align:right; font-weight:bold; border:2px solid #1976D2; border-radius:4px;">
                        <span style="font-size:12px; color:#fff; background:#e65100; padding:2px 5px; border-radius:4px; font-weight:bold;">${i.displayUnit}</span>
                    </td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }
    }
    if(!hasOrder) {
        html += `<p style="text-align:center; color:#666;">발주할 품목이 없습니다.</p>`;
    } else {
        let grandTotal = 0;
        for (const v in confirmItems) {
            confirmItems[v].forEach(i => { grandTotal += (i.unitCost || 0) * i.orderAmount; });
        }
        if (grandTotal > 0) {
            html += `<div style="text-align:right; font-size:16px; font-weight:bold; color:#e65100; margin-top:10px; padding:10px; background:#fff8e1; border-radius:6px;">
                총 발주 예상원가: ${grandTotal.toLocaleString()}원
            </div>`;
        }
    }
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
                    <td>${parseFloat(i.currentStock.toFixed(1))} ${i.displayUnit}</td>
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
    const orderData = { '고센유통': [], '한강유통(고기)': [], '인터넷발주': [], '기타': [] };
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
let servingViewMode = 'current'; // 'current' or 'afterOrder'

function fmtServings(v) {
    if (v === 0) return '0';
    if (Number.isInteger(v)) return v.toString();
    const s = v.toFixed(2);
    return s.replace(/\.?0+$/, '');
}

function showServingOverview(mode) {
    if (mode) servingViewMode = mode;
    const modal = document.getElementById('servingOverviewModal');
    const content = document.getElementById('servingOverviewContent');

    // 현재 재고 데이터 수집
    // 위치별로: 오늘 저장된 데이터가 있으면 그것을, 아니면 lastSavedInventory(어제 데이터) 사용
    let displayInventory = {};
    ['1루', '3루', '창고'].forEach(loc => {
        const todayStr = new Date().toISOString().split('T')[0];
        const lastSaveDate = lastSavedInventory[`meta_last_save_${loc}`];
        const isTodaySaved = lastSaveDate === todayStr;

        if (isTodaySaved) {
            // 오늘 저장된 데이터 → inventory에서 가져옴 (입력 중 값 반영)
            const hasInput = Object.keys(inventory).some(k => k.startsWith(`${loc}_`) && !k.startsWith('meta_'));
            if (hasInput) {
                Object.keys(inventory).filter(k => k.startsWith(`${loc}_`) && !k.startsWith('meta_')).forEach(k => displayInventory[k] = inventory[k]);
            } else {
                Object.keys(lastSavedInventory).filter(k => k.startsWith(`${loc}_`) && !k.startsWith('meta_')).forEach(k => displayInventory[k] = lastSavedInventory[k]);
            }
        } else {
            // 오늘 미입력 → lastSavedInventory(어제 저장 데이터) 그대로 사용
            Object.keys(lastSavedInventory).filter(k => k.startsWith(`${loc}_`) && !k.startsWith('meta_')).forEach(k => displayInventory[k] = lastSavedInventory[k]);
        }
    });

    // 발주 데이터 수집
    let orderMap = {};
    const hasOrderData = currentConfirmItems && Object.keys(currentConfirmItems).some(v => currentConfirmItems[v] && currentConfirmItems[v].length > 0);
    if (hasOrderData) {
        for (const vendor in currentConfirmItems) {
            (currentConfirmItems[vendor] || []).forEach(oi => {
                const key = `${vendor}_${oi.품목명}`;
                orderMap[key] = (orderMap[key] || 0) + (oi.orderAmount || 0);
            });
        }
    }

    // 판매메뉴별로 재그룹핑: { "도시락": [{품목명, servings, ...}, ...], "국수": [...] }
    let menuMap = {};    // 용도명 → [{재료정보}]
    let noNameItems = []; // 용도명 없는 품목 (단독 표시)
    let hasAnyServing = false;

    Object.keys(items).forEach(vendor => {
        items[vendor].forEach(item => {
            if (!item.servings || item.servings.length === 0) return;
            hasAnyServing = true;

            const rawKey = `${vendor}_${item.품목명}`;
            const stock1 = displayInventory[`1루_${rawKey}`] || 0;
            const stock3 = displayInventory[`3루_${rawKey}`] || 0;
            const stockW = displayInventory[`창고_${rawKey}`] || 0;
            const currentTotal = stock1 + stock3 + stockW;
            const orderQty = orderMap[rawKey] || 0;
            const afterOrderTotal = currentTotal + orderQty;
            const useTotal = (servingViewMode === 'afterOrder') ? afterOrderTotal : currentTotal;

            item.servings.forEach(s => {
                const menuName = (s.name || '').trim();
                // 재고단위가 발주단위와 다른 경우 (예: 삼겹살 팩→kg) 변환 적용
                const convertedTotal = (item.재고단위 && item.unitsPerOrder) ? useTotal * item.unitsPerOrder : useTotal;
                const rawServings = convertedTotal * s.perUnit;
                const servingCount = Math.round(rawServings * 100) / 100;
                const entry = {
                    품목명: item.품목명,
                    vendor: vendor,
                    발주단위: item.발주단위,
                    currentTotal: currentTotal,
                    orderQty: orderQty,
                    afterOrderTotal: afterOrderTotal,
                    perUnit: s.perUnit,
                    servings: servingCount
                };

                if (!menuName) {
                    noNameItems.push(entry);
                } else {
                    if (!menuMap[menuName]) menuMap[menuName] = [];
                    menuMap[menuName].push(entry);
                }
            });
        });
    });

    if (!hasAnyServing) {
        content.innerHTML = `
            <div style="text-align:center; padding:30px; color:#999;">
                <p style="font-size:16px; margin-bottom:10px;">인분 정보가 설정된 품목이 없습니다.</p>
                <p style="font-size:13px;">품목관리 탭에서 품목을 수정(✏️)하여<br>"인분 정보"를 추가해주세요.</p>
            </div>`;
        modal.classList.add('active');
        return;
    }

    const isAfter = servingViewMode === 'afterOrder';

    // 토글 버튼
    const currentActive = !isAfter ? 'background:#1565c0; color:white;' : 'background:#e0e0e0; color:#333;';
    const afterActive = isAfter ? 'background:#ff5722; color:white;' : 'background:#e0e0e0; color:#333;';
    const afterDisabled = !hasOrderData ? 'opacity:0.4; pointer-events:none;' : '';

    let html = `
        <div style="display:flex; gap:0; margin-bottom:12px; border-radius:8px; overflow:hidden; border:1px solid #ddd;">
            <button onclick="showServingOverview('current')" style="flex:1; padding:10px; border:none; font-size:14px; font-weight:bold; cursor:pointer; ${currentActive}">
                📦 현재 재고
            </button>
            <button onclick="showServingOverview('afterOrder')" style="flex:1; padding:10px; border:none; font-size:14px; font-weight:bold; cursor:pointer; ${afterActive} ${afterDisabled}">
                🚚 발주 후 예상
            </button>
        </div>
    `;

    if (isAfter && hasOrderData) {
        html += `<div style="background:#fff3e0; border:1px solid #ffb74d; border-radius:6px; padding:10px; margin-bottom:12px; font-size:12px; color:#e65100;">
            현재 재고 + 발주 수량 합산 기준입니다.
        </div>`;
    }

    // 판매메뉴별 카드 렌더링
    const menuNames = Object.keys(menuMap).sort();

    menuNames.forEach(menuName => {
        const ingredients = menuMap[menuName];
        // 병목 = 가장 적은 인분수
        const bottleneck = Math.min(...ingredients.map(i => i.servings));
        const bnColor = bottleneck <= 0 ? '#f44336' : bottleneck <= 50 ? '#ff9800' : '#4caf50';
        const bnBg = bottleneck <= 0 ? '#ffebee' : bottleneck <= 50 ? '#fff3e0' : '#e8f5e9';

        html += `
            <div style="background:white; border:1px solid #e0e0e0; border-radius:10px; margin-bottom:14px; overflow:hidden;">
                <div style="background:${bnBg}; border-bottom:2px solid ${bnColor}; padding:12px 14px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:17px; font-weight:bold; color:#333;">🍽 ${menuName}</div>
                    <div style="text-align:right;">
                        <div style="font-size:24px; font-weight:bold; color:${bnColor};">${fmtServings(bottleneck)}</div>
                        <div style="font-size:11px; color:#888;">인분 가능</div>
                    </div>
                </div>
                <div style="padding:10px 14px;">`;

        // 재료별 바 차트 형태로 표시
        const maxServings = Math.max(...ingredients.map(i => i.servings), 1);

        ingredients.sort((a, b) => a.servings - b.servings); // 적은 순 (병목이 위로)

        ingredients.forEach(ing => {
            const ratio = Math.min(100, (ing.servings / maxServings) * 100);
            const isBottleneck = ing.servings === bottleneck;
            const barColor = ing.servings <= 0 ? '#f44336' : ing.servings <= 50 ? '#ff9800' : '#4caf50';
            const fmtStock = (v) => Number.isInteger(v) ? v : parseFloat(v.toFixed(2));
            const stockInfo = isAfter && ing.orderQty > 0
                ? `${fmtStock(ing.currentTotal)}+${fmtStock(ing.orderQty)}=${fmtStock(ing.afterOrderTotal)}${ing.발주단위}`
                : `${fmtStock(isAfter ? ing.afterOrderTotal : ing.currentTotal)}${ing.발주단위}`;

            html += `
                <div style="margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                        <div style="font-size:13px;">
                            ${isBottleneck ? '<span style="color:#f44336; font-weight:bold;">▸ </span>' : ''}
                            <strong>${ing.품목명}</strong>
                            <span style="font-size:11px; color:#999; margin-left:4px;">(${stockInfo})</span>
                        </div>
                        <div style="font-size:14px; font-weight:bold; color:${barColor};">${fmtServings(ing.servings)}인분</div>
                    </div>
                    <div style="background:#f0f0f0; border-radius:4px; height:8px; overflow:hidden;">
                        <div style="background:${barColor}; height:100%; width:${ratio}%; border-radius:4px; transition:width 0.3s;"></div>
                    </div>
                </div>`;
        });

        html += `</div></div>`;
    });

    // 용도명 없는 단독 품목들
    if (noNameItems.length > 0) {
        html += `
            <div style="background:white; border:1px solid #e0e0e0; border-radius:10px; margin-bottom:14px; overflow:hidden;">
                <div style="background:#f5f5f5; border-bottom:1px solid #e0e0e0; padding:10px 14px;">
                    <div style="font-size:15px; font-weight:bold; color:#666;">📦 기타 품목</div>
                </div>
                <div style="padding:10px 14px;">`;

        noNameItems.forEach(ing => {
            const color = ing.servings <= 0 ? '#f44336' : ing.servings <= 50 ? '#ff9800' : '#4caf50';
            const fmtStock = (v) => Number.isInteger(v) ? v : parseFloat(v.toFixed(2));
            const stockInfo = isAfter && ing.orderQty > 0
                ? `${fmtStock(ing.currentTotal)}+${fmtStock(ing.orderQty)}=${fmtStock(ing.afterOrderTotal)}${ing.발주단위}`
                : `${fmtStock(isAfter ? ing.afterOrderTotal : ing.currentTotal)}${ing.발주단위}`;

            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #f0f0f0;">
                    <div style="font-size:13px;">
                        <strong>${ing.품목명}</strong>
                        <span style="font-size:11px; color:#999; margin-left:4px;">(${stockInfo})</span>
                    </div>
                    <div style="font-size:15px; font-weight:bold; color:${color};">${fmtServings(ing.servings)}인분</div>
                </div>`;
        });

        html += `</div></div>`;
    }

    content.innerHTML = html;
    modal.classList.add('active');
}

function closeServingOverview() {
    servingViewMode = 'current';
    document.getElementById('servingOverviewModal').classList.remove('active');
}
