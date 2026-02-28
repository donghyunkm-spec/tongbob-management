// staff-accounting.js - 가계부 및 대시보드

// ==========================================
// 월 문자열 유틸
// ==========================================
function getMonthStr(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

// ==========================================
// 월 이동
// ==========================================
function changeAccMonth(delta) {
    currentDashboardDate.setMonth(currentDashboardDate.getMonth() + delta);
    loadAccountingData();
}

function resetAccMonth() {
    currentDashboardDate = new Date();
    loadAccountingData();
}

// ==========================================
// 회계 데이터 로드
// ==========================================
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

// ==========================================
// 대시보드 UI 업데이트
// ==========================================
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

// ==========================================
// 일일 데이터 로드
// ==========================================
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

// ==========================================
// 일일 데이터 저장
// ==========================================
async function saveDailyAccounting() {
    if (!currentUser) { alert("로그인이 필요합니다."); openLoginModal(); return; }
    if (!['admin', 'manager'].includes(currentUser.role)) { alert("권한이 없습니다."); return; }

    const dateStr = document.getElementById('accDate').value;
    if (!dateStr) { alert('날짜를 선택해주세요.'); return; }

    // 1루 매출 입력
    const card1 = parseInt(document.getElementById('inpCard1').value) || 0;
    const cash1 = parseInt(document.getElementById('inpCash1').value) || 0;
    const delivery1 = parseInt(document.getElementById('inpDelivery1').value) || 0;
    const transfer1 = parseInt(document.getElementById('inpTransfer1').value) || 0;

    // 3루 매출 입력
    const card3 = parseInt(document.getElementById('inpCard3').value) || 0;
    const cash3 = parseInt(document.getElementById('inpCash3').value) || 0;
    const delivery3 = parseInt(document.getElementById('inpDelivery3').value) || 0;
    const transfer3 = parseInt(document.getElementById('inpTransfer3').value) || 0;

    // 지출 입력 (공통)
    const food = parseInt(document.getElementById('inpFood').value) || 0;
    const meat = parseInt(document.getElementById('inpMeat').value) || 0;
    const etc = parseInt(document.getElementById('inpEtc').value) || 0;

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

// ==========================================
// 입력 내역 (History)
// ==========================================
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

    // 2) 월말 고정비 처리
    if (filterKey === 'all' && accountingData.monthly && accountingData.monthly[monthStr]) {
        const m = accountingData.monthly[monthStr];

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

// ==========================================
// 고정비 로드/저장
// ==========================================
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

// ==========================================
// 분석 HTML 생성
// ==========================================
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

// ==========================================
// 예상순익 매장 선택
// ==========================================
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

// ==========================================
// 월간분석 매장 선택
// ==========================================
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

// ==========================================
// 예상 순익 렌더링
// ==========================================
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

// ==========================================
// 월간 분석 렌더링
// ==========================================
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

// ==========================================
// 비용 바 차트 렌더링
// ==========================================
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

// ==========================================
// 예상 인건비 계산
// ==========================================
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
                // 요일별 시간 우선 사용
                let timeStr = (s.dayTimes && s.dayTimes[dayName]) ? s.dayTimes[dayName] : s.time;

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

// ==========================================
// 급여 계산
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
            // 요일별 시간 우선 사용
            let timeStr = (s.dayTimes && s.dayTimes[dayKey]) ? s.dayTimes[dayKey] : s.time;

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
