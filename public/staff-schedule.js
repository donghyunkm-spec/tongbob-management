// staff-schedule.js - 근무표 렌더링 및 예외처리

// ==========================================
// 유틸리티 함수
// ==========================================

// 해당 요일의 근무 시간 반환 (dayTimes 우선, 없으면 time 사용)
function getTimeForDaySchedule(staff, dayKey) {
    if (staff.dayTimes && staff.dayTimes[dayKey]) {
        return staff.dayTimes[dayKey];
    }
    return staff.time || '';
}

function getStartTimeValue(timeStr) {
    if (!timeStr) return 99999;
    let start = timeStr.split('~')[0].trim().replace('시', '').replace(' ', '');
    if (!start.includes(':')) start += ':00';
    const [h, m] = start.split(':').map(Number);
    return (h * 60) + (m || 0);
}

function calculateDuration(timeStr) {
    if (!timeStr || !timeStr.includes('~')) return 0;
    const parts = timeStr.split('~');
    const [sh, sm] = parts[0].trim().split(':').map(Number);
    const [eh, em] = parts[1].trim().split(':').map(Number);

    const startMin = sh * 60 + (sm || 0);
    let endMin = eh * 60 + (em || 0);
    if (endMin < startMin) endMin += 24 * 60;
    return (endMin - startMin) / 60;
}

// ==========================================
// 스마트 역할 배치 함수
// ==========================================
function calculateSmartRoleCount(workers) {
    // 0단계: 임시휴무 직원 제외
    const activeWorkers = workers.filter(w => !w.isTempOff);

    // 1단계: 직원 분류
    let specialistStaff = [];
    let multiRoleStaff = [];
    let generalStaff = [];

    activeWorkers.forEach(w => {
        const roles = w.roles || ['일반'];
        const specialRoles = roles.filter(r => r !== '일반');

        if (roles.includes('일반') && specialRoles.length === 0) {
            generalStaff.push(w);
        } else if (specialRoles.length === 1) {
            specialistStaff.push(w);
        } else if (specialRoles.length >= 2) {
            multiRoleStaff.push(w);
        }
    });

    // 2단계: 전문가 우선 배치
    let posCount = 0, samCount = 0, noodleCount = 0;

    specialistStaff.forEach(w => {
        const roles = w.roles || ['일반'];
        const role = roles.find(r => r !== '일반');

        if (role === '포스') posCount++;
        else if (role === '삼겹살') samCount++;
        else if (role === '국수') noodleCount++;
    });

    // 3단계: 멀티 역할 직원을 부족한 파트에 우선 배치
    multiRoleStaff.forEach(w => {
        const roles = w.roles || ['일반'];
        const specialRoles = roles.filter(r => r !== '일반');

        let needs = [];
        if (posCount < 2 && specialRoles.includes('포스')) {
            needs.push({ role: '포스', count: posCount, priority: 2 - posCount });
        }
        if (samCount < 2 && specialRoles.includes('삼겹살')) {
            needs.push({ role: '삼겹살', count: samCount, priority: 2 - samCount });
        }
        if (noodleCount < 2 && specialRoles.includes('국수')) {
            needs.push({ role: '국수', count: noodleCount, priority: 2 - noodleCount });
        }

        if (needs.length > 0) {
            needs.sort((a, b) => b.priority - a.priority);
            const assignedRole = needs[0].role;

            if (assignedRole === '포스') posCount++;
            else if (assignedRole === '삼겹살') samCount++;
            else if (assignedRole === '국수') noodleCount++;
        } else {
            if (specialRoles[0] === '포스') posCount++;
            else if (specialRoles[0] === '삼겹살') samCount++;
            else if (specialRoles[0] === '국수') noodleCount++;
        }
    });

    return { posCount, samCount, noodleCount };
}

// ==========================================
// 일별 뷰 렌더링
// ==========================================
function renderDailyView() {
    const container = document.getElementById('dailyStaffList');
    if (!container) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const day = currentDate.getDate();
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayMap = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayMap[currentDate.getDay()];

    const dayDisplay = document.getElementById('currentDateDisplay');
    if(dayDisplay) dayDisplay.textContent = `${month}월 ${day}일 (${dayName})`;

    // 근무자 목록 수집
    let workers = [];
    const GETDAY_TO_DAYKEY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayKey = GETDAY_TO_DAYKEY[currentDate.getDay()];

    staffList.forEach(s => {
        const currentDateObj = new Date(dateStr);
        currentDateObj.setHours(0, 0, 0, 0);

        if (s.startDate) {
            const startDateObj = new Date(s.startDate);
            startDateObj.setHours(0, 0, 0, 0);
            if (currentDateObj < startDateObj) return;
        }
        if (s.endDate) {
            const endDateObj = new Date(s.endDate);
            endDateObj.setHours(0, 0, 0, 0);
            if (currentDateObj > endDateObj) return;
        }

        let isWorking = false;
        // 요일별 시간 우선 사용
        let timeStr = getTimeForDaySchedule(s, dayKey);
        let isTempOff = false;

        if (s.exceptions && s.exceptions[dateStr]) {
            const ex = s.exceptions[dateStr];
            if (ex.type === 'work') {
                isWorking = true;
                timeStr = ex.time;
            } else if (ex.type === 'off') {
                isWorking = true;
                isTempOff = true;
            }
        } else {
            if (s.workDays && s.workDays.includes(dayKey)) {
                isWorking = true;
            }
        }

        if (isWorking) {
            const roles = s.roles || ['일반'];
            workers.push({
                name: s.name,
                time: timeStr,
                position: s.position,
                roles: roles,
                id: s.id,
                assignedRole: null,
                salaryType: s.salaryType,
                salary: s.salary,
                isTempOff: isTempOff
            });
        }
    });

    // 정렬: 1. 월급 직원 먼저, 2. 출근시간 순, 3. 전문분야 우선
    workers.sort((a, b) => {
        const aIsMonthly = a.salaryType === 'monthly' ? 1 : 0;
        const bIsMonthly = b.salaryType === 'monthly' ? 1 : 0;
        if (aIsMonthly !== bIsMonthly) return bIsMonthly - aIsMonthly;

        const aStartTime = getStartTimeValue(a.time);
        const bStartTime = getStartTimeValue(b.time);
        if (aStartTime !== bStartTime) return aStartTime - bStartTime;

        const aHasSpecial = a.roles.some(r => r !== '일반') ? 1 : 0;
        const bHasSpecial = b.roles.some(r => r !== '일반') ? 1 : 0;
        return bHasSpecial - aHasSpecial;
    });

    // 임시휴무 직원 제외한 실제 근무자
    const activeWorkers = workers.filter(w => !w.isTempOff);
    const totalCount = activeWorkers.length;

    // 스마트 배치 로직으로 역할별 카운트 계산
    const roleCounts = calculateSmartRoleCount(activeWorkers);
    let posCount = roleCounts.posCount;
    let samCount = roleCounts.samCount;
    let noodleCount = roleCounts.noodleCount;

    // 배치된 역할 정보를 activeWorkers에 반영
    let specialistStaff = [];
    let multiRoleStaff = [];
    let generalStaff = [];

    activeWorkers.forEach(w => {
        const specialRoles = w.roles.filter(r => r !== '일반');
        if (w.roles.includes('일반') && specialRoles.length === 0) {
            generalStaff.push(w);
        } else if (specialRoles.length === 1) {
            specialistStaff.push(w);
        } else if (specialRoles.length >= 2) {
            multiRoleStaff.push(w);
        }
    });

    // 전문가 배치
    specialistStaff.forEach(w => {
        w.assignedRole = w.roles.find(r => r !== '일반');
    });

    // 멀티 역할 배치
    let tempPos = specialistStaff.filter(w => w.roles.includes('포스')).length;
    let tempSam = specialistStaff.filter(w => w.roles.includes('삼겹살')).length;
    let tempNoodle = specialistStaff.filter(w => w.roles.includes('국수')).length;

    multiRoleStaff.forEach(w => {
        const specialRoles = w.roles.filter(r => r !== '일반');
        let needs = [];
        if (tempPos < 2 && specialRoles.includes('포스')) {
            needs.push({ role: '포스', priority: 2 - tempPos });
        }
        if (tempSam < 2 && specialRoles.includes('삼겹살')) {
            needs.push({ role: '삼겹살', priority: 2 - tempSam });
        }
        if (tempNoodle < 2 && specialRoles.includes('국수')) {
            needs.push({ role: '국수', priority: 2 - tempNoodle });
        }

        if (needs.length > 0) {
            needs.sort((a, b) => b.priority - a.priority);
            w.assignedRole = needs[0].role;
            if (needs[0].role === '포스') tempPos++;
            else if (needs[0].role === '삼겹살') tempSam++;
            else if (needs[0].role === '국수') tempNoodle++;
        } else {
            w.assignedRole = specialRoles[0];
        }
    });

    generalStaff.forEach(w => {
        w.assignedRole = '일반';
    });

    // 알림 메시지 생성
    let alertMessages = [];
    let alertLevel = 'normal';

    if (totalCount <= 9) {
        alertMessages.push(`⚠️ 총 근무인원이 부족합니다 (${totalCount}명, 최소 10명 필요)`);
        alertLevel = 'danger';
    } else if (totalCount >= 13) {
        alertMessages.push(`⚠️ 총 근무인원이 너무 많습니다 (${totalCount}명, 최대 12명 권장)`);
        alertLevel = 'danger';
    }

    if (posCount < 2) {
        const lack = 2 - posCount;
        alertMessages.push(`🔴 포스 인원이 ${lack}명 부족합니다 (현재 ${posCount}명)`);
        alertLevel = 'danger';
    }
    if (samCount < 2) {
        const lack = 2 - samCount;
        alertMessages.push(`🔴 삼겹살 인원이 ${lack}명 부족합니다 (현재 ${samCount}명)`);
        alertLevel = 'danger';
    }
    if (noodleCount < 2) {
        const lack = 2 - noodleCount;
        alertMessages.push(`🔴 국수 인원이 ${lack}명 부족합니다 (현재 ${noodleCount}명)`);
        alertLevel = 'danger';
    }

    // 인원수 요약 HTML
    let summaryHtml = `
        <div style="background:#f5f5f5; padding:10px; margin-bottom:15px; border-radius:5px; display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:10px; text-align:center;">
            <div><strong>총 인원</strong><br/><span style="font-size:20px; color:${totalCount >= 10 && totalCount <= 12 ? '#4CAF50' : '#f44336'}">${totalCount}명</span></div>
            <div><strong>🎯 포스</strong><br/><span style="font-size:20px; color:${posCount >= 2 ? '#4CAF50' : '#f44336'}">${posCount}명</span></div>
            <div><strong>🥩 삼겹살</strong><br/><span style="font-size:20px; color:${samCount >= 2 ? '#4CAF50' : '#f44336'}">${samCount}명</span></div>
            <div><strong>🍜 국수</strong><br/><span style="font-size:20px; color:${noodleCount >= 2 ? '#4CAF50' : '#f44336'}">${noodleCount}명</span></div>
        </div>
    `;

    // 알림 영역
    if (alertMessages.length > 0) {
        const bgColor = alertLevel === 'danger' ? '#ffebee' : '#fff3e0';
        const borderColor = alertLevel === 'danger' ? '#f44336' : '#ff9800';
        summaryHtml = `
            <div style="background:${bgColor}; border-left:5px solid ${borderColor}; padding:15px; margin-bottom:15px; border-radius:5px;">
                ${alertMessages.map(msg => `<div style="margin-bottom:5px; font-weight:bold;">${msg}</div>`).join('')}
            </div>
        ` + summaryHtml;
    }

    const badge = document.getElementById('dailyCountBadge');
    if(badge) {
        badge.textContent = `총 ${totalCount}명`;
        badge.style.background = (totalCount >= 10 && totalCount <= 12 && posCount === 2 && samCount === 2 && noodleCount === 2) ? '#4CAF50' : '#f44336';
    }

    // 근무자 카드
    let cardsHtml = '';
    if (workers.length === 0) {
        cardsHtml = '<p style="text-align:center; color:#999; padding:20px;">오늘은 휴무일입니다.</p>';
    } else {
        workers.forEach(w => {
            const roleColors = {
                '포스': '#e91e63',
                '삼겹살': '#ff5722',
                '국수': '#ff9800',
                '일반': '#9e9e9e'
            };

            let rolesBadge = '';
            if (w.assignedRole) {
                const displayRole = w.assignedRole === '일반' ? '일반' : w.assignedRole;
                const bgColor = roleColors[displayRole] || '#999';
                rolesBadge = `<span style="background:${bgColor}; color:white; padding:3px 8px; border-radius:3px; font-size:12px; margin-right:3px; font-weight:bold; border: 2px solid #fff; box-shadow: 0 0 0 2px ${bgColor};">✓ ${w.assignedRole}</span>`;

                w.roles.forEach(r => {
                    if (r !== displayRole && r !== '일반') {
                        rolesBadge += `<span style="background:#ccc; color:#666; padding:2px 6px; border-radius:3px; font-size:11px; margin-right:3px; opacity:0.6;">${r}</span>`;
                    }
                });
            } else {
                rolesBadge = w.roles.map(r => {
                    return `<span style="background:${roleColors[r] || '#999'}; color:white; padding:2px 6px; border-radius:3px; font-size:11px; margin-right:3px;">${r}</span>`;
                }).join('');
            }

            const cardClass = w.isTempOff ? 'reservation-item temp-off-row' : 'reservation-item';
            const nameStyle = w.isTempOff ? 'style="opacity:0.6;"' : '';
            const timeDisplay = w.isTempOff ? '⛔ 임시휴무' : (w.time || '시간 미정');

            const actionButtons = currentUser && currentUser.role !== 'viewer' ?
                (w.isTempOff ?
                    `<div style="display:flex; gap:5px;">
                        <button onclick="cancelException(${w.id}, '${dateStr}')" style="padding:5px 10px; background:#4CAF50; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">✓ 복구</button>
                    </div>` :
                    `<div style="display:flex; gap:5px;">
                        <button onclick="openTimeChangeModal(${w.id}, '${dateStr}')" style="padding:5px 10px; background:#17a2b8; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">시간변경</button>
                        <button onclick="markTempOff(${w.id}, '${dateStr}')" style="padding:5px 10px; background:#f44336; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">임시휴무</button>
                    </div>`
                ) : '';

            cardsHtml += `
                <div class="${cardClass}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div style="flex:1;" ${nameStyle}>
                            <div style="margin-bottom:5px;">
                                <strong style="font-size:16px;">${w.name}</strong>
                                <span style="color:#666; font-size:13px; margin-left:8px;">${w.position || '직원'}</span>
                            </div>
                            <div style="margin-bottom:5px;">${rolesBadge}</div>
                            <div class="reservation-time">${timeDisplay}</div>
                        </div>
                        ${actionButtons}
                    </div>
                </div>
            `;
        });
    }

    container.innerHTML = summaryHtml + cardsHtml;
}

// ==========================================
// 일별 네비게이션
// ==========================================
function changeDate(d) { currentDate.setDate(currentDate.getDate() + d); renderDailyView(); }
function resetToToday() { currentDate = new Date(); renderDailyView(); }

// ==========================================
// 주간 뷰 렌더링
// ==========================================
function renderWeeklyView() {
    const startWeek = new Date(currentWeekStartDate);
    const endWeek = new Date(currentWeekStartDate);
    endWeek.setDate(endWeek.getDate() + 6);

    const rangeDisplay = document.getElementById('weeklyRangeDisplay');
    if(rangeDisplay) rangeDisplay.textContent = `${startWeek.getMonth()+1}월 ${startWeek.getDate()}일 ~ ${endWeek.getMonth()+1}월 ${endWeek.getDate()}일`;

    const realToday = new Date();

    DAY_KEYS.forEach((k, index) => {
        const headerDate = new Date(currentWeekStartDate);
        headerDate.setDate(headerDate.getDate() + index);
        const headerEl = document.getElementById(`header-${k}`);
        if (headerEl) {
            const month = headerDate.getMonth() + 1;
            const day = headerDate.getDate();
            headerEl.innerHTML = `${month}/${day}<br>${DAY_MAP[k]}`;
        }
    });

    DAY_KEYS.forEach(k => {
        const col = document.getElementById(`col-${k}`);
        if(col) { col.innerHTML = ''; col.classList.remove('today-highlight'); }
    });

    for (let i = 0; i < 7; i++) {
        const loopDate = new Date(currentWeekStartDate);
        loopDate.setDate(loopDate.getDate() + i);

        const year = loopDate.getFullYear();
        const month = String(loopDate.getMonth() + 1).padStart(2, '0');
        const day = String(loopDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const dayKey = DAY_KEYS[i];

        if (loopDate.getDate() === realToday.getDate() &&
            loopDate.getMonth() === realToday.getMonth() &&
            loopDate.getFullYear() === realToday.getFullYear()) {
            const col = document.getElementById(`col-${dayKey}`);
            if(col) col.classList.add('today-highlight');
        }

        let dayWorkers = [];
        staffList.forEach(s => {
            const loopDateObj = new Date(dateStr);
            loopDateObj.setHours(0, 0, 0, 0);

            if (s.startDate) {
                const startDateObj = new Date(s.startDate);
                startDateObj.setHours(0, 0, 0, 0);
                if (loopDateObj < startDateObj) return;
            }

            if (s.endDate) {
                const endDateObj = new Date(s.endDate);
                endDateObj.setHours(0, 0, 0, 0);
                if (loopDateObj > endDateObj) return;
            }

            let isWorking = false;
            // 요일별 시간 우선 사용
            let workTime = getTimeForDaySchedule(s, dayKey);
            let isException = false;
            let isOff = false;

            if (s.exceptions && s.exceptions[dateStr]) {
                const ex = s.exceptions[dateStr];
                if (ex.type === 'work') { isWorking = true; workTime = ex.time; isException = true; }
                else if (ex.type === 'off') { isWorking = true; isOff = true; }
            } else {
                if (s.workDays.includes(dayKey)) isWorking = true;
            }
            if (isWorking) dayWorkers.push({ staff: s, time: workTime, isException, isOff });
        });

        dayWorkers.sort((a,b) => {
             if(a.isOff && !b.isOff) return 1;
             if(!a.isOff && b.isOff) return -1;
             return getStartTimeValue(a.time) - getStartTimeValue(b.time)
        });

        const col = document.getElementById(`col-${dayKey}`);
        if(col) {
            dayWorkers.forEach(w => {
                let cardClass = 'staff-card-weekly';
                let timeText = w.time;

                if (w.isOff) {
                    cardClass += ' off-exception';
                    timeText = '휴무';
                } else if (w.isException) {
                    cardClass += ' exception';
                }

                col.innerHTML += `
                    <div class="${cardClass}">
                        <strong>${w.staff.name}</strong>
                        <span>${timeText}</span>
                    </div>`;
            });
        }
    }
}

// ==========================================
// 주간 네비게이션
// ==========================================
function changeWeek(weeks) { currentWeekStartDate.setDate(currentWeekStartDate.getDate() + (weeks * 7)); renderWeeklyView(); }
function resetToThisWeek() {
    const today = new Date();
    const day = today.getDay();
    currentWeekStartDate = new Date(today);
    currentWeekStartDate.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
    renderWeeklyView();
}

// ==========================================
// 월별 뷰 렌더링
// ==========================================
function renderMonthlyView() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const monthDisplay = document.getElementById('monthDisplay');
    if(monthDisplay) monthDisplay.textContent = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const container = document.getElementById('calendarBody');
    if(!container) return;
    container.innerHTML = '';
    const realToday = new Date();

    for (let i = 0; i < startDayOfWeek; i++) {
        container.innerHTML += `<div class="calendar-day empty"></div>`;
    }

    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let day = 1; day <= totalDays; day++) {
        const currentIterDate = new Date(year, month, day);
        const dayKey = dayMap[currentIterDate.getDay()];
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

        let count = 0;
        let tempWorkers = [];

        staffList.forEach(staff => {
            const currentIterDateObj = new Date(dateStr);
            currentIterDateObj.setHours(0, 0, 0, 0);

            if (staff.startDate) {
                const startDateObj = new Date(staff.startDate);
                startDateObj.setHours(0, 0, 0, 0);
                if (currentIterDateObj < startDateObj) return;
            }

            if (staff.endDate) {
                const endDateObj = new Date(staff.endDate);
                endDateObj.setHours(0, 0, 0, 0);
                if (currentIterDateObj > endDateObj) return;
            }

            let isWorking = false;
            let isTempOff = false;

            if (staff.exceptions && staff.exceptions[dateStr]) {
                const exType = staff.exceptions[dateStr].type;
                if (exType === 'work') {
                    isWorking = true;
                } else if (exType === 'off') {
                    isTempOff = true;
                    isWorking = false;
                }
            } else {
                if (staff.workDays && staff.workDays.includes(dayKey)) isWorking = true;
            }

            if (isWorking && !isTempOff) {
                count++;
                tempWorkers.push({ roles: staff.roles || ['일반'], isTempOff: false });
            }
        });

        const roleCounts = calculateSmartRoleCount(tempWorkers);
        let posCount = roleCounts.posCount;
        let samCount = roleCounts.samCount;
        let noodleCount = roleCounts.noodleCount;

        let dayClass = '';
        if (currentIterDate.getDay() === 0) dayClass = 'sunday';
        if (currentIterDate.getDay() === 6) dayClass = 'saturday';
        if (currentIterDate.getDate() === realToday.getDate() &&
            currentIterDate.getMonth() === realToday.getMonth() &&
            currentIterDate.getFullYear() === realToday.getFullYear()) {
            dayClass += ' today-highlight';
        }

        let hasAlert = false;
        if (count <= 9 || count >= 13 || posCount !== 2 || samCount !== 2 || noodleCount !== 2) {
            hasAlert = true;
        }

        const badgeColor = hasAlert ? '#f44336' : '#4CAF50';
        let countStyle = `background: ${badgeColor}; color: white;`;

        container.innerHTML += `
            <div class="calendar-day ${dayClass}" onclick="goToDailyDetail(${year}, ${month}, ${day})">
                <span class="calendar-date-num">${day}</span>
                ${count > 0 ? `<span class="calendar-staff-count" style="${countStyle} padding: 4px; border-radius: 4px; text-align: center; font-size: 12px; font-weight: bold; margin-top: 5px; display: block;">근무 ${count}명</span>` : ''}
            </div>`;
    }
}

// ==========================================
// 월별 네비게이션
// ==========================================
function changeMonth(d) { calendarDate.setMonth(calendarDate.getMonth() + d); renderMonthlyView(); }
function resetToThisMonth() { calendarDate = new Date(); renderMonthlyView(); }

function goToDailyDetail(year, month, day) {
    currentDate = new Date(year, month, day);
    switchTab('attendance');
    const dailyBtn = document.querySelector('button[onclick*="att-daily"]');
    if(dailyBtn) switchAttSubTab('att-daily', dailyBtn);
}

// ==========================================
// 시간 변경 모달
// ==========================================
function openTimeChangeModal(id, dateStr, currentStr) {
    if (!currentUser) { openLoginModal(); return; }

    initTimeChangeOptions();

    document.getElementById('timeChangeId').value = id;
    document.getElementById('timeChangeDate').value = dateStr;
    document.getElementById('timeChangeModal').style.display = 'flex';
}

function closeTimeChangeModal() {
    document.getElementById('timeChangeModal').style.display = 'none';
}

function initTimeChangeOptions() {
    const hours = [];
    for(let i=0; i<=30; i++) {
        const val = i < 24 ? i : i - 24;
        const txt = i < 24 ? `${i}` : `(익일)${i-24}`;
        const valStr = String(val).padStart(2, '0');
        hours.push(`<option value="${valStr}">${txt}</option>`);
    }
    const html = hours.join('');

    const els = ['tcStartHour', 'tcEndHour'];
    els.forEach(id => {
        const el = document.getElementById(id);
        if(el && el.children.length === 0) {
            el.innerHTML = html;
            if(id === 'tcStartHour') el.value = "18";
            if(id === 'tcEndHour') el.value = "23";
        }
    });
}

async function submitTimeChange() {
    const id = parseInt(document.getElementById('timeChangeId').value);
    const dateStr = document.getElementById('timeChangeDate').value;

    const sh = document.getElementById('tcStartHour').value;
    const sm = document.getElementById('tcStartMin').value;
    const eh = document.getElementById('tcEndHour').value;
    const em = document.getElementById('tcEndMin').value;

    const newTime = `${sh}:${sm}~${eh}:${em}`;

    await callExceptionApi({ id, date: dateStr, type: 'work', time: newTime });
    alert('시간이 변경되었습니다.');
    closeTimeChangeModal();
}

// ==========================================
// 예외 처리 (임시휴무/복구)
// ==========================================
async function cancelException(id, dateStr) {
    if(!confirm('휴무 설정을 취소하고 원래 근무로 되돌리시겠습니까?')) return;

    try {
        await fetch('/api/staff/exception', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                id: id,
                date: dateStr,
                type: 'delete',
                actor: currentUser.name
            })
        });
        alert('휴무가 취소되고 원래 근무로 복구되었습니다.');
        loadStaffData();
    } catch(e) {
        console.error('휴무 복구 실패:', e);
        alert('복구 실패');
    }
}

async function setDailyException(id, dateStr, action) {
    if (!currentUser) { openLoginModal(); return; }
    if (action === 'off') {
        if (!confirm('이 직원을 오늘 명단에서 제외(휴무)하시겠습니까?')) return;
        await callExceptionApi({ id, date: dateStr, type: 'off' });
    } else if (action === 'time') {
        const newTime = prompt('오늘만 적용할 근무 시간을 입력하세요 (예: 18:00~22:00)');
        if (!newTime) return;
        await callExceptionApi({ id, date: dateStr, type: 'work', time: newTime });
    }
}

async function markTempOff(id, dateStr) {
    if (!currentUser) { openLoginModal(); return; }
    if (!confirm('이 직원을 임시 휴무 처리하시겠습니까?')) return;
    await callExceptionApi({ id, date: dateStr, type: 'off' });
}

async function callExceptionApi(payload) {
    try {
        await fetch('/api/staff/exception', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ ...payload, actor: currentUser.name })
        });
        loadStaffData();
    } catch(e) { alert('오류 발생'); }
}

// ==========================================
// 근무 예외 처리 모달
// ==========================================
function openExceptionModal(staffId, dateStr) {
    if (!currentUser || currentUser.role === 'viewer') {
        alert('권한이 없습니다.');
        return;
    }

    const staff = staffList.find(s => s.id === staffId);
    if (!staff) return;

    document.getElementById('exceptionStaffName').textContent = staff.name;
    document.getElementById('exceptionDate').textContent = dateStr;
    document.getElementById('exceptionStaffId').value = staffId;
    document.getElementById('exceptionDateVal').value = dateStr;

    let currentException = null;
    if (staff.exceptions && staff.exceptions[dateStr]) {
        currentException = staff.exceptions[dateStr];
    }

    if (currentException) {
        document.getElementById('exceptionType').value = currentException.type;
        if (currentException.time) {
            const [start, end] = currentException.time.split('~');
            const [sh, sm] = start.trim().split(':');
            const [eh, em] = end.trim().split(':');
            document.getElementById('exStartHour').value = sh;
            document.getElementById('exStartMin').value = sm;
            document.getElementById('exEndHour').value = eh;
            document.getElementById('exEndMin').value = em;
        }
    } else {
        document.getElementById('exceptionType').value = 'work';
        if (staff.time) {
            const [start, end] = staff.time.split('~');
            const [sh, sm] = start.trim().split(':');
            const [eh, em] = end.trim().split(':');
            document.getElementById('exStartHour').value = sh;
            document.getElementById('exStartMin').value = sm;
            document.getElementById('exEndHour').value = eh;
            document.getElementById('exEndMin').value = em;
        }
    }

    document.getElementById('exceptionModal').style.display = 'flex';
}

function closeExceptionModal() {
    document.getElementById('exceptionModal').style.display = 'none';
}

async function saveException() {
    const staffId = parseInt(document.getElementById('exceptionStaffId').value);
    const dateStr = document.getElementById('exceptionDateVal').value;
    const type = document.getElementById('exceptionType').value;

    const sh = document.getElementById('exStartHour').value;
    const sm = document.getElementById('exStartMin').value;
    const eh = document.getElementById('exEndHour').value;
    const em = document.getElementById('exEndMin').value;
    const timeStr = `${sh}:${sm}~${eh}:${em}`;

    try {
        await fetch('/api/staff/exception', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                id: staffId,
                date: dateStr,
                type: type,
                time: timeStr,
                actor: currentUser.name
            })
        });
        closeExceptionModal();
        loadStaffData();
    } catch(e) {
        alert('오류 발생');
    }
}

async function deleteException() {
    const staffId = parseInt(document.getElementById('exceptionStaffId').value);
    const dateStr = document.getElementById('exceptionDateVal').value;

    try {
        await fetch('/api/staff/exception', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                id: staffId,
                date: dateStr,
                type: 'delete',
                actor: currentUser.name
            })
        });
        closeExceptionModal();
        loadStaffData();
    } catch(e) {
        alert('오류 발생');
    }
}

// ==========================================
// 대타/추가 근무 등록
// ==========================================
function initTimeOptions() {
    const hours = [];
    for(let i=0; i<=30; i++) {
        const val = i < 24 ? i : i - 24;
        const txt = i < 24 ? `${i}` : `(익일)${i-24}`;
        const valStr = String(val).padStart(2, '0');
        hours.push(`<option value="${valStr}">${txt}</option>`);
    }
    const html = hours.join('');

    const startEl = document.getElementById('tempStartHour');
    const endEl = document.getElementById('tempEndHour');

    if(startEl) {
        startEl.innerHTML = html;
        startEl.value = "18";
    }
    if(endEl) {
        endEl.innerHTML = html;
        endEl.value = "23";
    }
}

function addTempWorker() {
    if (!currentUser) { openLoginModal(); return; }

    document.getElementById('tempName').value = '';
    document.getElementById('tempSalary').value = '10000';

    const dataList = document.getElementById('staffNameList');
    if (dataList && typeof staffList !== 'undefined') {
        const options = staffList
            .filter(s => s.salaryType !== 'monthly')
            .map(s => `<option value="${s.name}">`)
            .join('');

        dataList.innerHTML = options;
    }

    document.getElementById('tempWorkerModal').style.display = 'flex';
}

function closeTempModal() {
    document.getElementById('tempWorkerModal').style.display = 'none';
}

function autoFillSalary(inputName) {
    if (!inputName) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const matches = staffList.filter(s => s.name === inputName && !s.deleted);
    const activeMatches = matches.filter(s => !s.endDate || s.endDate >= todayStr);
    const candidates = activeMatches.length > 0 ? activeMatches : matches;

    if (candidates.length === 0) return;

    if (candidates.length === 1) {
        if (candidates[0].salary) document.getElementById('tempSalary').value = candidates[0].salary;
        return;
    }

    // 동명이인: 첫 번째 활성 직원 기준으로 시급 자동입력 (입력창에서 선택은 saveTempWorker에서 처리)
    const chosen = candidates[0];
    if (chosen.salary) document.getElementById('tempSalary').value = chosen.salary;
}

async function saveTempWorker() {
    const name = document.getElementById('tempName').value.trim();
    const salary = document.getElementById('tempSalary').value;

    const sh = document.getElementById('tempStartHour').value;
    const sm = document.getElementById('tempStartMin').value;
    const eh = document.getElementById('tempEndHour').value;
    const em = document.getElementById('tempEndMin').value;

    if (!name) { alert('이름을 입력해주세요.'); return; }
    if (!salary) { alert('시급을 입력해주세요.'); return; }

    const timeStr = `${sh}:${sm}~${eh}:${em}`;
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const todayStr2 = new Date().toISOString().split('T')[0];
    const allMatches = staffList.filter(s => s.name === name && !s.deleted);
    const activeMatches2 = allMatches.filter(s => !s.endDate || s.endDate >= todayStr2);
    const existingCandidates = activeMatches2.length > 0 ? activeMatches2 : allMatches;
    const existingStaff = existingCandidates.length > 0 ? existingCandidates[0] : null;

    if (existingStaff) {
        let targetStaff = existingStaff;

        if (existingCandidates.length > 1) {
            // 동명이인 disambiguation
            const choiceList = existingCandidates.map((s, i) =>
                `${i + 1}. ${s.name} (${s.position || '직책없음'} / 근무요일: ${(s.workDays || []).join(',') || '미설정'})`
            ).join('\n');
            const choice = prompt(`"${name}"님이 여러 명입니다. 누구에게 추가할까요?\n\n${choiceList}\n\n번호를 입력하세요 (취소하려면 0):`);
            const idx = parseInt(choice);
            if (!idx || idx < 1 || idx > existingCandidates.length) return;
            targetStaff = existingCandidates[idx - 1];
        } else {
            if (!confirm(`${name}님은 이미 등록된 직원입니다.\n기존 정보에 오늘 근무를 추가하시겠습니까?`)) return;
        }

        await callExceptionApi({
            id: targetStaff.id,
            date: dateStr,
            type: 'work',
            time: timeStr
        });
        alert('기존 직원 근무 일정에 추가되었습니다.');
        closeTempModal();

    } else {
        try {
            const res = await fetch('/api/staff/temp', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    name: name,
                    date: dateStr,
                    time: timeStr,
                    salary: salary,
                    actor: currentUser.name
                })
            });
            const json = await res.json();
            if (json.success) {
                alert('임시 근무자가 등록되었습니다.');
                closeTempModal();
                loadStaffData();
            } else {
                alert('등록 실패');
            }
        } catch(e) { console.error(e); alert('서버 통신 오류'); }
    }
}

// ==========================================
// 로그 로드
// ==========================================
async function loadLogs() {
    try {
        const res = await fetch(`/api/logs`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const tbody = document.getElementById('logTableBody');

        if(tbody) {
            tbody.innerHTML = '';
            if (!json.data || json.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">기록이 없습니다.</td></tr>';
                return;
            }

            const staffActions = ['직원등록', '직원수정', '직원삭제', '근무변경', '대타등록'];
            const filteredLogs = json.data.filter(log => staffActions.includes(log.action));

            if (filteredLogs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">직원/근무 관련 기록이 없습니다.</td></tr>';
                return;
            }

            filteredLogs.forEach(log => {
                const date = new Date(log.timestamp).toLocaleString('ko-KR', {
                    month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
                });
                tbody.innerHTML += `
                    <tr>
                        <td>${date}</td>
                        <td>${log.actor}</td>
                        <td class="log-action-${log.action}">${log.action}</td>
                        <td>${log.target}</td>
                        <td>${log.details}</td>
                    </tr>`;
            });
        }
    } catch(e) { console.error("로그 로드 실패", e); }
}

async function loadAccountingLogs() {
    try {
        const res = await fetch(`/api/logs`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const tbody = document.getElementById('accLogTableBody');

        if(tbody) {
            tbody.innerHTML = '';
            if (!json.data || json.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">기록이 없습니다.</td></tr>';
                return;
            }

            const accountingActions = ['매출입력', '매출수정', '매출삭제', '월간지출', '선결제충전', '선결제사용', '선결제취소'];
            const filteredLogs = json.data.filter(log => accountingActions.includes(log.action));

            if (filteredLogs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">매입/매출 관련 기록이 없습니다.</td></tr>';
                return;
            }

            filteredLogs.forEach(log => {
                const date = new Date(log.timestamp).toLocaleString('ko-KR', {
                    month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
                });
                tbody.innerHTML += `
                    <tr>
                        <td>${date}</td>
                        <td>${log.actor}</td>
                        <td class="log-action-${log.action}">${log.action}</td>
                        <td>${log.target}</td>
                        <td>${log.details}</td>
                    </tr>`;
            });
        }
    } catch(e) { console.error("회계 로그 로드 실패", e); }
}

// ==========================================
// 백업 기능
// ==========================================
async function downloadBackup() {
    if (!currentUser) {
        alert('로그인이 필요합니다.');
        openLoginModal();
        return;
    }

    if (currentUser.role !== 'admin') {
        alert('관리자만 백업을 다운로드할 수 있습니다.');
        return;
    }

    if (!confirm('전체 데이터를 백업하시겠습니까?\n백업 파일들이 로컬 PC에 다운로드됩니다.')) {
        return;
    }

    try {
        const response = await fetch('/api/backup/all');

        if (!response.ok) {
            throw new Error('백업 생성 실패');
        }

        const backupData = await response.json();

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
        const prefix = `backup_${dateStr}_${timeStr}`;

        const files = [
            { name: `${prefix}_staff.json`, data: backupData.staff },
            { name: `${prefix}_logs.json`, data: backupData.logs },
            { name: `${prefix}_accounting.json`, data: backupData.accounting },
            { name: `${prefix}_items.json`, data: backupData.inventory_items },
            { name: `${prefix}_inventory.json`, data: backupData.inventory_current },
            { name: `${prefix}_daily_usage.json`, data: backupData.inventory_usage },
            { name: `${prefix}_orders.json`, data: backupData.inventory_orders },
            { name: `${prefix}_holidays.json`, data: backupData.inventory_holidays },
            { name: `${prefix}_last_orders.json`, data: backupData.inventory_last_orders },
            { name: `${prefix}_inventory_history.json`, data: backupData.inventory_history }
        ];

        for (const file of files) {
            const blob = new Blob([JSON.stringify(file.data, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;

            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        alert(`백업이 완료되었습니다!\n총 ${files.length}개 파일이 다운로드되었습니다.\n다운로드 폴더를 확인하세요.`);

        await fetch('/api/logs', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                actor: currentUser.name,
                action: '데이터백업',
                target: '전체 시스템',
                details: `${files.length}개 파일 백업 완료`
            })
        });

    } catch(e) {
        console.error('백업 실패:', e);
        alert('백업 중 오류가 발생했습니다: ' + e.message);
    }
}

async function downloadAllData() {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("사장님만 가능한 기능입니다.");
        return;
    }

    if (!confirm('전체 데이터를 백업하시겠습니까?\n백업 파일들이 로컬 PC에 다운로드됩니다.')) {
        return;
    }

    try {
        const response = await fetch('/api/backup/all');

        if (!response.ok) {
            throw new Error('백업 생성 실패');
        }

        const backupData = await response.json();

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
        const prefix = `backup_${dateStr}_${timeStr}`;

        const files = [
            { name: `${prefix}_staff.json`, data: backupData.staff },
            { name: `${prefix}_logs.json`, data: backupData.logs },
            { name: `${prefix}_accounting.json`, data: backupData.accounting },
            { name: `${prefix}_items.json`, data: backupData.inventory_items },
            { name: `${prefix}_inventory.json`, data: backupData.inventory_current },
            { name: `${prefix}_daily_usage.json`, data: backupData.inventory_usage },
            { name: `${prefix}_orders.json`, data: backupData.inventory_orders },
            { name: `${prefix}_holidays.json`, data: backupData.inventory_holidays },
            { name: `${prefix}_last_orders.json`, data: backupData.inventory_last_orders },
            { name: `${prefix}_inventory_history.json`, data: backupData.inventory_history }
        ];

        for (const file of files) {
            const blob = new Blob([JSON.stringify(file.data, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;

            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        alert(`백업이 완료되었습니다!\n총 ${files.length}개 파일이 다운로드되었습니다.\n다운로드 폴더를 확인하세요.`);

        await fetch('/api/logs', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                actor: currentUser.name,
                action: '데이터백업',
                target: '전체 시스템',
                details: `${files.length}개 파일 백업 완료`
            })
        });

    } catch (e) {
        console.error(e);
        alert('백업 중 오류가 발생했습니다: ' + e.message);
    }
}
