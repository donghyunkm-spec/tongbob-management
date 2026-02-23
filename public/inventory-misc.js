// inventory-misc.js - 휴일, 이력, 설명서

// ==========================================
// 휴일 관리
// ==========================================
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
        renderAllHolidays();
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

// ==========================================
// 재고 이력
// ==========================================
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

// ==========================================
// 발주 이력
// ==========================================
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
            const orderItems = order.orders[vendorName];
            if (orderItems && orderItems.length > 0) {
                hasData = true;
                orderItems.forEach(item => {
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

// ==========================================
// 최근 재고 로드
// ==========================================
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

// ==========================================
// 미발주 품목 모달
// ==========================================
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

// ==========================================
// 사용 설명서 렌더링
// ==========================================
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
