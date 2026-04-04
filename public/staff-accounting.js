// staff-accounting.js - 가계부 및 대시보드

// ==========================================
// 금액 입력 포맷팅 (3자리 콤마)
// ==========================================
function formatMoneyInput(el) {
    const cursorPos = el.selectionStart;
    const oldLen = el.value.length;
    const raw = el.value.replace(/[^0-9]/g, '');
    if (raw === '') { el.value = ''; return; }
    el.value = Number(raw).toLocaleString();
    const newLen = el.value.length;
    const newPos = Math.max(0, cursorPos + (newLen - oldLen));
    el.setSelectionRange(newPos, newPos);
}

function parseMoneyValue(el) {
    if (!el) return 0;
    return parseInt(el.value.replace(/,/g, '')) || 0;
}

function setMoneyValue(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if (val) {
        el.value = Number(val).toLocaleString();
    } else {
        el.value = '';
    }
}

function updateSalesSubtotal(loc) {
    const card = parseMoneyValue(document.getElementById('inpCard' + loc));
    const cash = parseMoneyValue(document.getElementById('inpCash' + loc));
    const total = card + cash;
    const el = document.getElementById('salesSubtotal' + loc);
    if (el) el.textContent = '카드+현금 매출: ' + total.toLocaleString() + '원';
}

// 특정 날짜에 해당하는 직원 스케줄 반환 (이력 기반)
function getScheduleForDate(staff, dateStr) {
    if (!staff.scheduleHistory || staff.scheduleHistory.length === 0) {
        return { workDays: staff.workDays || [], time: staff.time || '', dayTimes: staff.dayTimes || {} };
    }
    const sorted = [...staff.scheduleHistory].sort((a, b) => a.from.localeCompare(b.from));
    let result = sorted[0];
    for (const entry of sorted) {
        if (entry.from <= dateStr) result = entry;
    }
    return result;
}

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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

    if (activeSubTab.id === 'acc-daily') loadDailyAccounting();
    else if (activeSubTab.id === 'acc-history') loadHistoryTable();
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
    setMoneyValue('inpCard1', dayData.card1);
    setMoneyValue('inpCash1', dayData.cash1);
    setMoneyValue('inpDelivery1', dayData.delivery1);
    setMoneyValue('inpTransfer1', dayData.transfer1);

    // 3루 매출
    setMoneyValue('inpCard3', dayData.card3);
    setMoneyValue('inpCash3', dayData.cash3);
    setMoneyValue('inpDelivery3', dayData.delivery3);
    setMoneyValue('inpTransfer3', dayData.transfer3);

    // 지출 (공통)
    setMoneyValue('inpFood', dayData.food);
    setMoneyValue('inpMeat', dayData.meat);
    setMoneyValue('inpEtc', dayData.etc);

    // 소계 업데이트
    updateSalesSubtotal('1');
    updateSalesSubtotal('3');

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
    const card1 = parseMoneyValue(document.getElementById('inpCard1'));
    const cash1 = parseMoneyValue(document.getElementById('inpCash1'));
    const delivery1 = parseMoneyValue(document.getElementById('inpDelivery1'));
    const transfer1 = parseMoneyValue(document.getElementById('inpTransfer1'));

    // 3루 매출 입력
    const card3 = parseMoneyValue(document.getElementById('inpCard3'));
    const cash3 = parseMoneyValue(document.getElementById('inpCash3'));
    const delivery3 = parseMoneyValue(document.getElementById('inpDelivery3'));
    const transfer3 = parseMoneyValue(document.getElementById('inpTransfer3'));

    // 지출 입력 (공통)
    const food = parseMoneyValue(document.getElementById('inpFood'));
    const meat = parseMoneyValue(document.getElementById('inpMeat'));
    const etc = parseMoneyValue(document.getElementById('inpEtc'));

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
        if (currentUser && currentUser.role === 'manager') {
            // 매니저는 입력내역 탭이 없으므로 일일입력에 유지
        } else {
            switchAccSubTab('acc-history');
        }
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
    const container = document.getElementById('historyCardContainer');
    const summaryDiv = document.getElementById('filterResultSummary');

    if(!container) return;
    container.innerHTML = '';

    let filteredSum = 0;
    let filteredCount = 0;

    const labelMap = {
        'card': '💳 카드', 'cash': '💵 현금', 'delivery': '🛵 배달',
        'sales': '💰 총매출',
        'food': '🥬 고센', 'meat': '🥩 고기', 'etc': '🍦 잡비'
    };

    function sumField(d, field) {
        if (d[field + '1'] !== undefined || d[field + '3'] !== undefined) {
            return (d[field + '1'] || 0) + (d[field + '3'] || 0);
        }
        return d[field] || 0;
    }

    const rows = [];

    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (!date.startsWith(monthStr)) return;
            const d = accountingData.daily[date];

            let valToCheck = 0;
            if (filterKey === 'sales') valToCheck = d.sales || 0;
            else if (filterKey !== 'all') valToCheck = sumField(d, filterKey);

            if (filterKey !== 'all') {
                if (!valToCheck) return;
                filteredSum += valToCheck;
                filteredCount++;
            }

            rows.push({ date: date, data: d, type: 'daily' });
        });
    }

    if (filterKey === 'all' && accountingData.monthly && accountingData.monthly[monthStr]) {
        const m = accountingData.monthly[monthStr];
        const fixedTotal = (m.internet1||0) + (m.water1||0) + (m.cleaning1||0) +
                           (m.operMgmt1||0) + (m.cctv1||0) + (m.bizCard1||0) + (m.etc_fixed1||0) +
                           (m.internet3||0) + (m.water3||0) + (m.cleaning3||0) +
                           (m.operMgmt3||0) + (m.cctv3||0) + (m.bizCard3||0) + (m.etc_fixed3||0) +
                           (m.commission||0) + (m.deliveryFee||0) + (m.cardFee||0) +
                           (m.internet||0) + (m.water||0) + (m.cleaning||0) +
                           (m.operMgmt||0) + (m.cctv||0) + (m.etc_fixed||0);
        if (fixedTotal > 0) {
            rows.push({ date: `${monthStr}-99`, data: m, type: 'fixed' });
        }
    }

    if (rows.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">내역이 없습니다.</div>';
        if(summaryDiv) summaryDiv.style.display = 'none';
        return;
    }

    if (filterKey !== 'all' && summaryDiv) {
        summaryDiv.style.display = 'block';
        const label = labelMap[filterKey] || filterKey;
        summaryDiv.innerHTML = `✅ ${label} 합계: ${filteredSum.toLocaleString()}원 (${filteredCount}건)`;
    } else if (summaryDiv) summaryDiv.style.display = 'none';

    rows.sort((a,b) => b.date.localeCompare(a.date));

    const fmt = (v) => v ? v.toLocaleString() : '-';
    const fmtBlue = (v) => v ? `<span style="color:#1976D2; font-weight:bold;">${v.toLocaleString()}</span>` : '<span style="color:#ccc;">-</span>';
    const fmtRed = (v) => v ? `<span style="color:#d32f2f; font-weight:bold;">${v.toLocaleString()}</span>` : '<span style="color:#ccc;">-</span>';

    rows.forEach(r => {
        if (r.type === 'fixed') {
            container.innerHTML += `
            <div style="background:#e0f2f1; border-radius:8px; padding:12px; margin-bottom:8px; border:1px solid #b2dfdb;">
                <div style="font-weight:bold; color:#00796b;">월말 고정비/수수료</div>
                <div style="font-size:12px; color:#555; margin-top:4px;">[고정비 탭에서 확인]</div>
            </div>`;
            return;
        }

        const d = r.data;
        const dayNum = r.date.substring(8);
        const dateObj = new Date(r.date);
        const dayNames = ['일','월','화','수','목','금','토'];
        const dayName = dayNames[dateObj.getDay()];
        const dayColor = dateObj.getDay() === 0 ? '#d32f2f' : (dateObj.getDay() === 6 ? '#1565c0' : '#333');

        const card1 = d.card1 || 0, cash1 = d.cash1 || 0, delivery1 = d.delivery1 || 0, transfer1 = d.transfer1 || 0;
        const card3 = d.card3 || 0, cash3 = d.cash3 || 0, delivery3 = d.delivery3 || 0, transfer3 = d.transfer3 || 0;
        const sub1 = d.sales1 || (card1 + cash1 + delivery1);
        const sub3 = d.sales3 || (card3 + cash3 + delivery3);
        const totalSales = d.sales || (sub1 + sub3);
        const food = d.food || 0, meat = d.meat || 0, etc = d.etc || 0;
        const totalCost = food + meat + etc;

        const noteText = [d.note1, d.note3, d.note].filter(Boolean).join(' / ');
        const btn = `<button onclick="editHistoryDate('${r.date}')" style="background:#607d8b; color:white; border:none; border-radius:4px; font-size:11px; padding:3px 10px; cursor:pointer;">수정</button>`;

        // 필터 모드
        if (filterKey !== 'all') {
            const label = labelMap[filterKey] || filterKey;
            const val = filterKey === 'sales' ? totalSales : sumField(d, filterKey);
            container.innerHTML += `
            <div style="background:white; border-radius:8px; padding:10px 12px; margin-bottom:6px; border:1px solid #e0e0e0; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong style="color:${dayColor};">${dayNum}일(${dayName})</strong>
                    <span style="margin-left:8px; background:#fff9c4; padding:2px 6px; border-radius:4px; font-weight:bold;">${label}: ${val.toLocaleString()}원</span>
                </div>
                ${btn}
            </div>`;
            return;
        }

        container.innerHTML += `
        <div style="background:white; border-radius:8px; margin-bottom:10px; border:1px solid #e0e0e0; overflow:hidden;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#f5f5f5; border-bottom:1px solid #e0e0e0;">
                <strong style="font-size:15px; color:${dayColor};">${dayNum}일 (${dayName})</strong>
                ${btn}
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
                <thead>
                    <tr style="background:#fafafa;">
                        <th style="padding:6px 8px; text-align:left; font-size:12px; color:#888; border-bottom:1px solid #eee; width:25%;">구분</th>
                        <th style="padding:6px 8px; text-align:right; font-size:12px; color:#1565c0; border-bottom:1px solid #eee; width:25%;">1루</th>
                        <th style="padding:6px 8px; text-align:right; font-size:12px; color:#00838f; border-bottom:1px solid #eee; width:25%;">3루</th>
                        <th style="padding:6px 8px; text-align:right; font-size:12px; color:#333; border-bottom:1px solid #eee; width:25%;">합계</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding:4px 8px; color:#555;">💳 카드</td>
                        <td style="padding:4px 8px; text-align:right;">${fmt(card1)}</td>
                        <td style="padding:4px 8px; text-align:right;">${fmt(card3)}</td>
                        <td style="padding:4px 8px; text-align:right; font-weight:bold;">${fmt(card1+card3)}</td>
                    </tr>
                    <tr style="background:#fafafa;">
                        <td style="padding:4px 8px; color:#555;">💵 현금</td>
                        <td style="padding:4px 8px; text-align:right;">${fmt(cash1)}</td>
                        <td style="padding:4px 8px; text-align:right;">${fmt(cash3)}</td>
                        <td style="padding:4px 8px; text-align:right; font-weight:bold;">${fmt(cash1+cash3)}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 8px; color:#555;">🛵 배달</td>
                        <td style="padding:4px 8px; text-align:right;">${fmt(delivery1)}</td>
                        <td style="padding:4px 8px; text-align:right;">${fmt(delivery3)}</td>
                        <td style="padding:4px 8px; text-align:right; font-weight:bold;">${fmt(delivery1+delivery3)}</td>
                    </tr>
                    ${(transfer1 || transfer3) ? `<tr style="background:#fafafa;">
                        <td style="padding:4px 8px; color:#999; font-size:12px;">이체</td>
                        <td style="padding:4px 8px; text-align:right; color:#999; font-size:12px;">${fmt(transfer1)}</td>
                        <td style="padding:4px 8px; text-align:right; color:#999; font-size:12px;">${fmt(transfer3)}</td>
                        <td style="padding:4px 8px; text-align:right; color:#999; font-size:12px;">${fmt(transfer1+transfer3)}</td>
                    </tr>` : ''}
                    <tr style="border-top:2px solid #1976D2; background:#e3f2fd;">
                        <td style="padding:6px 8px; font-weight:bold; color:#1976D2;">매출 소계</td>
                        <td style="padding:6px 8px; text-align:right; font-weight:bold; color:#1976D2;">${sub1.toLocaleString()}</td>
                        <td style="padding:6px 8px; text-align:right; font-weight:bold; color:#1976D2;">${sub3.toLocaleString()}</td>
                        <td style="padding:6px 8px; text-align:right; font-weight:bold; color:#1976D2; font-size:14px;">${totalSales.toLocaleString()}</td>
                    </tr>
                    <tr style="border-top:2px solid #d32f2f; background:#ffebee;">
                        <td colspan="2" style="padding:6px 8px; font-weight:bold; color:#d32f2f;">지출</td>
                        <td colspan="2" style="padding:6px 8px; text-align:right; font-weight:bold; color:#d32f2f; font-size:14px;">${totalCost.toLocaleString()}</td>
                    </tr>
                    ${food ? `<tr>
                        <td colspan="2" style="padding:3px 8px; color:#795548; font-size:12px; padding-left:16px;">🥬 고센</td>
                        <td colspan="2" style="padding:3px 8px; text-align:right; color:#795548; font-size:12px;">${food.toLocaleString()}</td>
                    </tr>` : ''}
                    ${meat ? `<tr>
                        <td colspan="2" style="padding:3px 8px; color:#c62828; font-size:12px; padding-left:16px;">🥩 고기</td>
                        <td colspan="2" style="padding:3px 8px; text-align:right; color:#c62828; font-size:12px;">${meat.toLocaleString()}</td>
                    </tr>` : ''}
                    ${etc ? `<tr>
                        <td colspan="2" style="padding:3px 8px; color:#78909c; font-size:12px; padding-left:16px;">🍦 잡비</td>
                        <td colspan="2" style="padding:3px 8px; text-align:right; color:#78909c; font-size:12px;">${etc.toLocaleString()}</td>
                    </tr>` : ''}
                </tbody>
            </table>
            ${noteText ? `<div style="padding:6px 12px; background:#fffde7; font-size:12px; color:#795548; border-top:1px solid #eee;">📝 ${noteText}</div>` : ''}
        </div>`;
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
    setVal('fixInsurance1', mData.insurance1);
    setVal('fixBizIncomeTax1', mData.bizIncomeTax1);
    setVal('fixTaxAccountant1', mData.taxAccountant1);

    // 3루 고정비
    setVal('fixInternet3', mData.internet3);
    setVal('fixWater3', mData.water3);
    setVal('fixCleaning3', mData.cleaning3);
    setVal('fixOperMgmt3', mData.operMgmt3);
    setVal('fixCCTV3', mData.cctv3);
    setVal('fixBizCard3', mData.bizCard3);
    setVal('fixEtc3', mData.etc_fixed3);
    setVal('fixInsurance3', mData.insurance3);
    setVal('fixBizIncomeTax3', mData.bizIncomeTax3);
    setVal('fixTaxAccountant3', mData.taxAccountant3);

    // 자동 계산 수수료 (매출 기반)
    let sales1Total = 0, delivery1Total = 0;
    let sales3Total = 0, delivery3Total = 0;
    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                const d = accountingData.daily[date];
                sales1Total += (d.sales1 || 0);
                delivery1Total += (d.delivery1 || 0);
                sales3Total += (d.sales3 || 0);
                delivery3Total += (d.delivery3 || 0);
            }
        });
    }

    const setAutoFee = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val > 0 ? Math.floor(val).toLocaleString() : '';
    };

    // 1루 수수료
    setAutoFee('fixAmoze1', sales1Total * 0.285);
    setAutoFee('fixTongbob1', sales1Total * 0.025);
    setAutoFee('fixDeliveryFee1', delivery1Total * 0.06);

    // 3루 수수료
    setAutoFee('fixAmoze3', sales3Total * 0.285);
    setAutoFee('fixTongbob3', sales3Total * 0.025);
    setAutoFee('fixDeliveryFee3', delivery3Total * 0.06);
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
        insurance1: getVal('fixInsurance1'),
        bizIncomeTax1: getVal('fixBizIncomeTax1'),
        taxAccountant1: getVal('fixTaxAccountant1'),

        // 3루 고정비
        internet3: getVal('fixInternet3'),
        water3: getVal('fixWater3'),
        cleaning3: getVal('fixCleaning3'),
        operMgmt3: getVal('fixOperMgmt3'),
        cctv3: getVal('fixCCTV3'),
        bizCard3: getVal('fixBizCard3'),
        etc_fixed3: getVal('fixEtc3'),
        insurance3: getVal('fixInsurance3'),
        bizIncomeTax3: getVal('fixBizIncomeTax3'),
        taxAccountant3: getVal('fixTaxAccountant3')
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
    let cashSalesTotal1 = 0, cashSalesTotal3 = 0;
    let foodTotal = 0, meatTotal = 0, etcTotal = 0;

    if (accountingData.daily) {
        Object.keys(accountingData.daily).forEach(date => {
            if (date.startsWith(monthStr)) {
                const d = accountingData.daily[date];

                // 1루 매출
                salesTotal1 += (d.sales1 || 0);
                deliverySalesTotal1 += (d.delivery1 || 0);
                cardSalesTotal1 += (d.card1 || 0);
                cashSalesTotal1 += (d.cash1 || 0);

                // 3루 매출
                salesTotal3 += (d.sales3 || 0);
                deliverySalesTotal3 += (d.delivery3 || 0);
                cardSalesTotal3 += (d.card3 || 0);
                cashSalesTotal3 += (d.cash3 || 0);

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
    let salesTotal, deliverySalesTotal, cardSalesTotal, cashSalesTotal;
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
        cashSalesTotal = cashSalesTotal1;

        // 1루 수수료: 아모제(28.5%) + 통빱(2.5%) + 배달(6%)
        commission = Math.floor(salesTotal1 * 0.285) + Math.floor(salesTotal1 * 0.025);
        deliveryFee = Math.floor(deliverySalesTotal1 * 0.06);
        cardFee = 0;

        // 1루 고정비
        fixedMisc = (mData.internet1||0) + (mData.water1||0) + (mData.cleaning1||0) +
                    (mData.operMgmt1||0) + (mData.cctv1||0) + (mData.bizCard1||0) + (mData.etc_fixed1||0) +
                    (mData.insurance1||0) + (mData.bizIncomeTax1||0) + (mData.taxAccountant1||0);

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
        cashSalesTotal = cashSalesTotal3;

        // 3루 수수료: 아모제(28.5%) + 통빱(2.5%) + 배달(6%)
        commission = Math.floor(salesTotal3 * 0.285) + Math.floor(salesTotal3 * 0.025);
        deliveryFee = Math.floor(deliverySalesTotal3 * 0.06);
        cardFee = 0;

        // 3루 고정비
        fixedMisc = (mData.internet3||0) + (mData.water3||0) + (mData.cleaning3||0) +
                    (mData.operMgmt3||0) + (mData.cctv3||0) + (mData.bizCard3||0) + (mData.etc_fixed3||0) +
                    (mData.insurance3||0) + (mData.bizIncomeTax3||0) + (mData.taxAccountant3||0);

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
        cashSalesTotal = cashSalesTotal1 + cashSalesTotal3;

        // 전체 수수료: 아모제(28.5%) + 통빱(2.5%) + 배달(6%)
        commission = Math.floor(salesTotal1 * 0.285) + Math.floor(salesTotal3 * 0.285)
                   + Math.floor(salesTotal1 * 0.025) + Math.floor(salesTotal3 * 0.025);
        deliveryFee = Math.floor(deliverySalesTotal1 * 0.06) + Math.floor(deliverySalesTotal3 * 0.06);
        cardFee = 0;

        // 전체 고정비 (1루 + 3루)
        fixedMisc = (mData.internet1||0) + (mData.water1||0) + (mData.cleaning1||0) +
                    (mData.operMgmt1||0) + (mData.cctv1||0) + (mData.bizCard1||0) + (mData.etc_fixed1||0) +
                    (mData.insurance1||0) + (mData.bizIncomeTax1||0) + (mData.taxAccountant1||0) +
                    (mData.internet3||0) + (mData.water3||0) + (mData.cleaning3||0) +
                    (mData.operMgmt3||0) + (mData.cctv3||0) + (mData.bizCard3||0) + (mData.etc_fixed3||0) +
                    (mData.insurance3||0) + (mData.bizIncomeTax3||0) + (mData.taxAccountant3||0);

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

    // 6. 매출 상세 바 차트 렌더링
    const predSalesEl = document.getElementById('predSalesBreakdownChart');
    if (predSalesEl) {
        if (salesTotal === 0) {
            predSalesEl.innerHTML = '<div style="text-align:center; color:#999;">데이터 없음</div>';
        } else {
            const renderBar = (l, v, c) => v > 0 ? `<div class="bar-row"><div class="bar-label">${l}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max((v/salesTotal)*100,1)}%; background:${c};"></div></div><div class="bar-value">${v.toLocaleString()}</div></div>` : '';
            predSalesEl.innerHTML = `
                ${renderBar('💳 카드', cardSalesTotal, '#42a5f5')}
                ${renderBar('💵 현금', cashSalesTotal, '#66bb6a')}
                ${renderBar('🛵 배달', deliverySalesTotal, '#ffa726')}`;
        }
    }

    // 7. 지출 상세 바 차트 렌더링
    renderCostList('predCostList', mData, staffCost, ratio, salesTotal, totalCurrentCost, monthStr, {
        commission: commission,
        deliveryFee: deliveryFee,
        cardFee: cardFee,
        fixedMisc: fixedMisc,
        food: food,
        meat: meat,
        etc: etc
    });

    // 8. 입금예상 렌더링
    let depositDeductions = {};
    if (selectedPredStore === '1') {
        depositDeductions = {
            internet: mData.internet1||0, water: mData.water1||0, cleaning: mData.cleaning1||0,
            cctv: mData.cctv1||0, operMgmt: mData.operMgmt1||0
        };
    } else if (selectedPredStore === '3') {
        depositDeductions = {
            internet: mData.internet3||0, water: mData.water3||0, cleaning: mData.cleaning3||0,
            cctv: mData.cctv3||0, operMgmt: mData.operMgmt3||0
        };
    } else {
        depositDeductions = {
            internet: (mData.internet1||0)+(mData.internet3||0),
            water: (mData.water1||0)+(mData.water3||0),
            cleaning: (mData.cleaning1||0)+(mData.cleaning3||0),
            cctv: (mData.cctv1||0)+(mData.cctv3||0),
            operMgmt: (mData.operMgmt1||0)+(mData.operMgmt3||0)
        };
    }
    renderDepositEstimate('predDepositEstimate', salesTotal, commission, deliveryFee, depositDeductions, monthStr);
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

        // 1루 수수료: 아모제(28.5%) + 통빱(2.5%) + 배달(6%)
        commission = Math.floor(sales1.total * 0.285) + Math.floor(sales1.total * 0.025);
        deliveryFee = Math.floor(sales1.delivery * 0.06);
        cardFee = 0;

        // 1루 고정비
        fixedMisc = (mData.internet1||0) + (mData.water1||0) + (mData.cleaning1||0) +
                    (mData.operMgmt1||0) + (mData.cctv1||0) + (mData.bizCard1||0) + (mData.etc_fixed1||0) +
                    (mData.insurance1||0) + (mData.bizIncomeTax1||0) + (mData.taxAccountant1||0);

        // 매출 비율로 배분
        staffCost = Math.floor(totalStaffCost * ratio1);
        food = Math.floor(foodTotal * ratio1);
        meat = Math.floor(meatTotal * ratio1);
        etc = Math.floor(etcTotal * ratio1);

    } else if (selectedDashStore === '3') {
        // === 3루만 ===
        sales = sales3;

        // 3루 수수료: 아모제(28.5%) + 통빱(2.5%) + 배달(6%)
        commission = Math.floor(sales3.total * 0.285) + Math.floor(sales3.total * 0.025);
        deliveryFee = Math.floor(sales3.delivery * 0.06);
        cardFee = 0;

        // 3루 고정비
        fixedMisc = (mData.internet3||0) + (mData.water3||0) + (mData.cleaning3||0) +
                    (mData.operMgmt3||0) + (mData.cctv3||0) + (mData.bizCard3||0) + (mData.etc_fixed3||0) +
                    (mData.insurance3||0) + (mData.bizIncomeTax3||0) + (mData.taxAccountant3||0);

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

        // 전체 수수료: 아모제(28.5%) + 통빱(2.5%) + 배달(6%)
        commission = Math.floor(sales1.total * 0.285) + Math.floor(sales3.total * 0.285)
                   + Math.floor(sales1.total * 0.025) + Math.floor(sales3.total * 0.025);
        deliveryFee = Math.floor(sales1.delivery * 0.06) + Math.floor(sales3.delivery * 0.06);
        cardFee = 0;

        // 전체 고정비 (1루 + 3루)
        fixedMisc = (mData.internet1||0) + (mData.water1||0) + (mData.cleaning1||0) +
                    (mData.operMgmt1||0) + (mData.cctv1||0) + (mData.bizCard1||0) + (mData.etc_fixed1||0) +
                    (mData.insurance1||0) + (mData.bizIncomeTax1||0) + (mData.taxAccountant1||0) +
                    (mData.internet3||0) + (mData.water3||0) + (mData.cleaning3||0) +
                    (mData.operMgmt3||0) + (mData.cctv3||0) + (mData.bizCard3||0) + (mData.etc_fixed3||0) +
                    (mData.insurance3||0) + (mData.bizIncomeTax3||0) + (mData.taxAccountant3||0);

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

    renderDashboardCharts(sales, totalCost, mData, staffCost, variableCost, monthStr, {
        commission: commission,
        deliveryFee: deliveryFee,
        cardFee: cardFee,
        fixedMisc: fixedMisc,
        food: food,
        meat: meat,
        etc: etc
    });

    // 입금예상 렌더링
    let dashDepositDeductions = {};
    if (selectedDashStore === '1') {
        dashDepositDeductions = {
            internet: mData.internet1||0, water: mData.water1||0, cleaning: mData.cleaning1||0,
            cctv: mData.cctv1||0, operMgmt: mData.operMgmt1||0
        };
    } else if (selectedDashStore === '3') {
        dashDepositDeductions = {
            internet: mData.internet3||0, water: mData.water3||0, cleaning: mData.cleaning3||0,
            cctv: mData.cctv3||0, operMgmt: mData.operMgmt3||0
        };
    } else {
        dashDepositDeductions = {
            internet: (mData.internet1||0)+(mData.internet3||0),
            water: (mData.water1||0)+(mData.water3||0),
            cleaning: (mData.cleaning1||0)+(mData.cleaning3||0),
            cctv: (mData.cctv1||0)+(mData.cctv3||0),
            operMgmt: (mData.operMgmt1||0)+(mData.operMgmt3||0)
        };
    }
    renderDepositEstimate('dashDepositEstimate', sales.total, commission, deliveryFee, dashDepositDeductions, monthStr);
}

// ==========================================
// 입금예상 렌더링
// ==========================================
function renderDepositEstimate(containerId, salesTotal, commission, deliveryFee, deductions, monthStr) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (salesTotal === 0) {
        el.innerHTML = '<div style="text-align:center; padding:10px; color:#999;">데이터 없음</div>';
        return;
    }

    // 익월 15일 계산
    const [y, m] = monthStr.split('-');
    const depositDate = `${parseInt(m) === 12 ? parseInt(y)+1 : y}-${String(parseInt(m) === 12 ? 1 : parseInt(m)+1).padStart(2,'0')}-15`;

    // 공제 항목
    const deductionItems = [
        { label: '수수료(31%)', val: commission },
        { label: '배달수수료(6%)', val: deliveryFee },
        { label: '인터넷', val: deductions.internet },
        { label: '상하수도', val: deductions.water },
        { label: '청소용역비', val: deductions.cleaning },
        { label: 'CCTV', val: deductions.cctv },
        { label: '운영관리', val: deductions.operMgmt }
    ];

    const totalDeduction = deductionItems.reduce((sum, d) => sum + d.val, 0);
    const depositAmount = salesTotal - totalDeduction;

    let html = `<div style="font-size:13px;">`;
    html += `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee;">
        <span style="color:#555;">총 매출</span>
        <span style="font-weight:bold;">${salesTotal.toLocaleString()}원</span>
    </div>`;

    deductionItems.forEach(item => {
        if (item.val > 0) {
            html += `<div style="display:flex; justify-content:space-between; padding:5px 0; padding-left:10px; color:#e53935; font-size:12px;">
                <span>- ${item.label}</span>
                <span>-${item.val.toLocaleString()}원</span>
            </div>`;
        }
    });

    html += `<div style="display:flex; justify-content:space-between; padding:5px 0; border-top:1px solid #ccc; color:#e53935; font-weight:bold; font-size:12px;">
        <span>공제 합계</span>
        <span>-${totalDeduction.toLocaleString()}원</span>
    </div>`;

    html += `<div style="display:flex; justify-content:space-between; padding:10px 0; border-top:2px solid #333; margin-top:5px;">
        <span style="font-weight:bold; color:#1565c0;">입금예상 (${depositDate})</span>
        <span style="font-weight:bold; font-size:16px; color:${depositAmount >= 0 ? '#1565c0' : '#e53935'};">${depositAmount.toLocaleString()}원</span>
    </div>`;

    html += `</div>`;
    el.innerHTML = html;
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
        { label: '🏠 수수료(31%)', val: fCommission, color: '#ab47bc' },
        { label: '🛵 배달수수료(6%)', val: fDelivery, color: '#00bcd4' },
        { label: '🥬 고센유통', val: cFood, color: '#8d6e63' },
        { label: '🥩 고기', val: cMeat, color: '#ef5350' },
        { label: '👥 인건비', val: fStaff, color: '#ba68c8' },
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

function renderDashboardCharts(sales, totalCost, mData, staffCost, variableCostTotal, monthStr, calculatedCosts = null) {
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
    renderCostList('costBreakdownList', mData, staffCost, 1.0, sales.total, totalCost, monthStr, calculatedCosts);
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
                // 스케줄 이력 기반으로 해당 날짜의 스케줄 조회
                const schedule = getScheduleForDate(s, dateKey);
                let timeStr = (schedule.dayTimes && schedule.dayTimes[dayName]) ? schedule.dayTimes[dayName] : schedule.time;

                if (s.exceptions && s.exceptions[dateKey]) {
                    const ex = s.exceptions[dateKey];
                    if (ex.type === 'work') { isWorking = true; timeStr = ex.time; }
                    else if (ex.type === 'off') { isWorking = false; }
                } else {
                    if (schedule.workDays.includes(dayName)) isWorking = true;
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
let salaryYear, salaryMonth;

function changeSalaryMonth(delta) {
    salaryMonth += delta;
    if (salaryMonth > 11) { salaryMonth = 0; salaryYear++; }
    if (salaryMonth < 0) { salaryMonth = 11; salaryYear--; }
    renderSalary();
}

function calculateMonthlySalary() {
    const now = new Date();
    salaryYear = now.getFullYear();
    salaryMonth = now.getMonth();
    renderSalary();
}

function renderSalary() {
    const year = salaryYear;
    const month = salaryMonth;

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

            if (employedDays === 0) return;

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
            // 스케줄 이력 기반으로 해당 날짜의 스케줄 조회
            const schedule = getScheduleForDate(s, dateStr);
            let timeStr = (schedule.dayTimes && schedule.dayTimes[dayKey]) ? schedule.dayTimes[dayKey] : schedule.time;

            if (s.exceptions && s.exceptions[dateStr]) {
                const ex = s.exceptions[dateStr];
                if (ex.type === 'work') { isWorking = true; timeStr = ex.time; }
                else if (ex.type === 'off') { isWorking = false; }
            } else {
                if (schedule.workDays.includes(dayKey)) isWorking = true;
            }

            if (isWorking) { workCount++; totalHours += calculateDuration(timeStr); }
        }

        if (workCount === 0) return;

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
    document.getElementById('salaryMonthDisplay').textContent = `${year}년 ${month + 1}월`;
    document.getElementById('salaryModal').style.display = 'flex';
}

function closeSalaryModal() { document.getElementById('salaryModal').style.display = 'none'; }
