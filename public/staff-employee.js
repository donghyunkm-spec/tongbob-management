// staff-employee.js - 직원 관리 (CRUD)

// ==========================================
// 직원 데이터 로드
// ==========================================
async function loadStaffData() {
    try {
        const res = await fetch(`/api/staff?role=${currentUser?.role || 'viewer'}`);
        const json = await res.json();
        staffList = json.data;

        // 역할 필드 초기화 추가
        staffList.forEach(s => {
            if (!s.roles) {
                s.roles = ['일반'];
            }
        });

        renderDailyView();
        renderWeeklyView();
        renderMonthlyView();
        renderManageList();

    } catch(e) { console.error("데이터 로드 실패"); }
}

// ==========================================
// 관리 탭 전환 (현재 직원 / 삭제된 직원)
// ==========================================
function switchManageTab(tab) {
    if (!currentUser) {
        openLoginModal();
        return;
    }

    // 삭제된 직원 탭은 관리자만
    if (tab === 'deleted' && currentUser.role !== 'admin') {
        alert('관리자만 접근 가능합니다.');
        return;
    }

    // 탭 버튼 스타일 변경
    document.getElementById('activeStaffTab').classList.remove('active');
    document.getElementById('deletedStaffTab').classList.remove('active');

    if (tab === 'active') {
        document.getElementById('activeStaffTab').classList.add('active');
        document.getElementById('activeStaffSection').style.display = 'block';
        document.getElementById('deletedStaffSection').style.display = 'none';
        renderManageList();
    } else {
        document.getElementById('deletedStaffTab').classList.add('active');
        document.getElementById('activeStaffSection').style.display = 'none';
        document.getElementById('deletedStaffSection').style.display = 'block';
        loadDeletedStaff();
    }
}

// ==========================================
// 직원 목록 렌더링
// ==========================================
function renderManageList() {
    const list = document.getElementById('manageStaffList');
    if(!list) return;
    list.innerHTML = '';

    const isAdmin = currentUser && currentUser.role === 'admin';

    // 정렬: 1. 월급 직원 먼저(금액 많은 순), 2. 전문분야 있는 직원
    const sortedStaff = [...staffList].sort((a, b) => {
        // 1순위: 월급 직원 먼저
        const aIsMonthly = a.salaryType === 'monthly' ? 1 : 0;
        const bIsMonthly = b.salaryType === 'monthly' ? 1 : 0;
        if (aIsMonthly !== bIsMonthly) return bIsMonthly - aIsMonthly;

        // 2순위: 월급 직원끼리는 금액 많은 순
        if (aIsMonthly && bIsMonthly) {
            return (b.salary || 0) - (a.salary || 0);
        }

        // 3순위: 전문분야 있는 직원 우선
        const aHasSpecial = (a.roles && a.roles.some(r => r !== '일반')) ? 1 : 0;
        const bHasSpecial = (b.roles && b.roles.some(r => r !== '일반')) ? 1 : 0;
        return bHasSpecial - aHasSpecial;
    });

    sortedStaff.forEach(s => {
        const daysStr = s.workDays.map(d => DAY_MAP[d]).join(',');
        const salaryInfo = isAdmin ?
            `<div style="font-size:12px; color:#28a745; margin-top:3px;">
                💰 ${s.salaryType === 'monthly' ? '월급' : '시급'}: ${s.salary ? s.salary.toLocaleString() : '0'}원
             </div>` : '';

        // 역할 배지 추가
        const roles = s.roles || ['일반'];
        const rolesBadge = roles.map(r => {
            const roleColors = {
                '포스': '#e91e63',
                '삼겹살': '#ff5722',
                '국수': '#ff9800',
                '일반': '#9e9e9e'
            };
            return `<span style="background:${roleColors[r] || '#999'}; color:white; padding:2px 6px; border-radius:3px; font-size:11px; margin-right:3px;">${r}</span>`;
        }).join('');

        list.innerHTML += `
            <div class="reservation-item">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="font-size:16px;">${s.name}</strong>
                        <span style="font-size:12px; color:#666;">(${s.time})</span>
                        <div style="font-size:13px; margin-top:5px;">${rolesBadge}</div>
                        <div style="font-size:13px; margin-top:5px;">📅 ${daysStr}</div>
                        ${salaryInfo}
                    </div>
                    <div>
                        <button class="edit-btn" onclick="openEditModal(${s.id})">수정</button>
                        <button class="delete-btn" onclick="deleteStaff(${s.id})">삭제</button>
                    </div>
                </div>
            </div>`;
    });
}

// ==========================================
// 삭제된 직원 목록 로드
// ==========================================
async function loadDeletedStaff() {
    if (!currentUser || currentUser.role !== 'admin') {
        alert('관리자만 접근 가능합니다.');
        return;
    }

    try {
        const res = await fetch(`/api/staff?includeDeleted=true&role=${currentUser?.role || 'viewer'}`);
        const json = await res.json();
        const deletedStaff = json.data.filter(s => s.deleted);
        renderDeletedStaffList(deletedStaff);
    } catch(e) {
        console.error('삭제된 직원 로드 실패:', e);
    }
}

// ==========================================
// 삭제된 직원 목록 렌더링
// ==========================================
function renderDeletedStaffList(deletedStaff) {
    const list = document.getElementById('deletedStaffList');
    if(!list) return;

    list.innerHTML = '';

    if (deletedStaff.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#999; padding:20px;">삭제된 직원이 없습니다.</p>';
        return;
    }

    deletedStaff.forEach(s => {
        const deletedDate = new Date(s.deletedAt);
        const now = new Date();
        const daysPassed = Math.floor((now - deletedDate) / (1000 * 60 * 60 * 24));
        const canPermanentDelete = daysPassed >= 30;

        const deletedInfo = `
            <div style="font-size:12px; color:#999; margin-top:5px;">
                🗑️ 삭제일: ${deletedDate.toLocaleDateString('ko-KR')} (${daysPassed}일 경과)
                <br/>👤 삭제자: ${s.deletedBy || '알 수 없음'}
            </div>
        `;

        const roles = s.roles || ['일반'];
        const rolesBadge = roles.map(r => {
            const roleColors = {
                '포스': '#e91e63',
                '삼겹살': '#ff5722',
                '국수': '#ff9800',
                '일반': '#9e9e9e'
            };
            return `<span style="background:${roleColors[r] || '#999'}; color:white; padding:2px 6px; border-radius:3px; font-size:11px; margin-right:3px;">${r}</span>`;
        }).join('');

        list.innerHTML += `
            <div class="reservation-item" style="background:#f5f5f5; border-left:4px solid #999;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="font-size:16px; color:#666;">${s.name}</strong>
                        <span style="font-size:12px; color:#999;">(${s.time})</span>
                        <div style="font-size:13px; margin-top:5px;">${rolesBadge}</div>
                        ${deletedInfo}
                    </div>
                    <div style="display:flex; gap:5px; flex-direction:column;">
                        <button class="edit-btn" onclick="restoreStaff(${s.id})" style="background:#4CAF50;">복구</button>
                    </div>
                </div>
            </div>`;
    });
}

// ==========================================
// 직원 복구
// ==========================================
async function restoreStaff(id) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert('관리자만 가능합니다.');
        return;
    }

    if (!confirm('이 직원을 복구하시겠습니까?')) return;

    try {
        const res = await fetch(`/api/staff/${id}/restore`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ actor: currentUser.name })
        });

        const json = await res.json();
        if (json.success) {
            alert('직원이 복구되었습니다.');
            await loadStaffData();
            await loadDeletedStaff();
        } else {
            alert('복구 실패: ' + (json.message || '알 수 없는 오류'));
        }
    } catch(e) {
        console.error('복구 실패:', e);
        alert('복구 중 오류가 발생했습니다.');
    }
}

// ==========================================
// 직원 등록 모달
// ==========================================
function openAddModal() {
    if (!currentUser || currentUser.role === 'viewer') {
        alert('권한이 없습니다.');
        return;
    }

    document.getElementById('staffModalTitle').textContent = '직원 등록';
    document.getElementById('staffId').value = '';
    document.getElementById('staffName').value = '';
    document.getElementById('staffPosition').value = '';
    document.getElementById('staffSalaryType').value = 'hourly';
    document.getElementById('staffSalary').value = '';
    document.getElementById('staffTime').value = '';
    document.getElementById('staffStartDate').value = '';
    document.getElementById('staffEndDate').value = '';

    DAY_KEYS.forEach(day => {
        const checkbox = document.getElementById(`day-${day}`);
        if (checkbox) checkbox.checked = false;
    });

    // 역할 체크박스 초기화
    document.getElementById('role-일반').checked = true;
    document.getElementById('role-포스').checked = false;
    document.getElementById('role-삼겹살').checked = false;
    document.getElementById('role-국수').checked = false;

    document.getElementById('staffModal').style.display = 'flex';
}

function closeStaffModal() {
    document.getElementById('staffModal').style.display = 'none';
}

// ==========================================
// 직원 등록/수정 저장
// ==========================================
async function saveStaff() {
    const id = document.getElementById('staffId').value;
    const name = document.getElementById('staffName').value.trim();
    const position = document.getElementById('staffPosition').value.trim();
    const salaryType = document.getElementById('staffSalaryType').value;
    const salary = parseInt(document.getElementById('staffSalary').value) || 0;
    const time = document.getElementById('staffTime').value.trim();
    const startDate = document.getElementById('staffStartDate').value;
    const endDate = document.getElementById('staffEndDate').value;

    if (!name) {
        alert('이름을 입력하세요.');
        return;
    }

    const workDays = [];
    DAY_KEYS.forEach(day => {
        const checkbox = document.getElementById(`day-${day}`);
        if (checkbox && checkbox.checked) {
            workDays.push(day);
        }
    });

    // 역할 수집
    const roles = [];
    if (document.getElementById('role-일반').checked) roles.push('일반');
    if (document.getElementById('role-포스').checked) roles.push('포스');
    if (document.getElementById('role-삼겹살').checked) roles.push('삼겹살');
    if (document.getElementById('role-국수').checked) roles.push('국수');

    if (roles.length === 0) {
        alert('최소 하나의 역할을 선택해주세요.');
        return;
    }

    const staffData = {
        name, position, salaryType, salary, workDays, time, startDate, endDate, roles
    };

    try {
        if (id) {
            // 수정
            const res = await fetch(`/api/staff/${id}`, {
                method: 'PUT',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ updates: staffData, actor: currentUser.name })
            });
            const json = await res.json();
            if (json.success) {
                alert('직원 정보가 수정되었습니다.');
                closeStaffModal();
                loadStaffData();
            } else {
                alert('수정 실패');
            }
        } else {
            // 등록
            staffData.id = Date.now();
            const res = await fetch('/api/staff', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ staffList: [staffData], actor: currentUser.name })
            });
            const json = await res.json();
            if (json.success) {
                alert('직원이 등록되었습니다.');
                closeStaffModal();
                loadStaffData();
            } else {
                alert('등록 실패');
            }
        }
    } catch (e) {
        console.error(e);
        alert('서버 통신 오류');
    }
}

// ==========================================
// 직원 수정 모달
// ==========================================
function openEditModal(id) {
    if (!currentUser) { openLoginModal(); return; }
    const target = staffList.find(s => s.id === id);
    if (!target) return;

    document.getElementById('editId').value = target.id;
    document.getElementById('editName').value = target.name;
    document.getElementById('editTime').value = target.time;

    document.getElementById('editStartDate').value = target.startDate || '';
    document.getElementById('editEndDate').value = target.endDate || '';

    const isAdmin = currentUser.role === 'admin';
    const salarySection = document.getElementById('modalSalarySection');
    if (isAdmin) {
        salarySection.style.display = 'block';
        document.getElementById('editSalaryType').value = target.salaryType || 'hourly';
        document.getElementById('editSalary').value = target.salary || 0;
    } else {
        salarySection.style.display = 'none';
    }

    // 역할 체크박스 설정 추가
    const roles = target.roles || ['일반'];
    document.getElementById('edit-role-일반').checked = roles.includes('일반');
    document.getElementById('edit-role-포스').checked = roles.includes('포스');
    document.getElementById('edit-role-삼겹살').checked = roles.includes('삼겹살');
    document.getElementById('edit-role-국수').checked = roles.includes('국수');

    document.getElementById('editModalOverlay').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editModalOverlay').style.display = 'none';
}

async function saveStaffEdit() {
    const id = parseInt(document.getElementById('editId').value);
    const time = document.getElementById('editTime').value;

    const startDate = document.getElementById('editStartDate').value || null;
    const endDate = document.getElementById('editEndDate').value || null;

    const salaryType = document.getElementById('editSalaryType').value;
    const salary = parseInt(document.getElementById('editSalary').value) || 0;

    // 역할 수집
    const roles = [];
    if (document.getElementById('edit-role-일반').checked) roles.push('일반');
    if (document.getElementById('edit-role-포스').checked) roles.push('포스');
    if (document.getElementById('edit-role-삼겹살').checked) roles.push('삼겹살');
    if (document.getElementById('edit-role-국수').checked) roles.push('국수');

    if (roles.length === 0) {
        alert('최소 하나의 역할을 선택해주세요.');
        return;
    }

    const updates = { time, startDate, endDate, roles };

    if (currentUser && currentUser.role === 'admin') {
        updates.salaryType = salaryType;
        updates.salary = salary;
    }

    try {
        await fetch(`/api/staff/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ updates: updates, actor: currentUser.name })
        });
        closeEditModal();
        loadStaffData();
        if(currentUser.role === 'admin') loadLogs();
    } catch(e) { alert('수정 실패'); }
}

// ==========================================
// 직원 삭제
// ==========================================
async function deleteStaff(id) {
    if (!currentUser) { openLoginModal(); return; }
    if (!confirm('삭제하시겠습니까?')) return;
    await fetch(`/api/staff/${id}?actor=${encodeURIComponent(currentUser.name)}`, { method: 'DELETE' });
    loadStaffData();
    if(currentUser.role === 'admin') loadLogs();
}

// ==========================================
// 일괄 등록
// ==========================================
async function processBulkText() {
    const text = document.getElementById('bulkText').value;
    if (!text.trim()) return;

    const lines = text.split('\n');
    const payload = [];

    lines.forEach((line) => {
       let parts = line.split(',').map(p => p.trim());
       if (parts.length < 3) parts = line.split(/\s+/);
       if(parts.length >= 3) {
           const name = parts[0];
           const dayStr = parts[1];
           let timeStr = parts[2];
           const workDays = [];
            for (let [eng, kor] of Object.entries(DAY_MAP)) {
                if (dayStr.includes(kor)) workDays.push(eng);
            }
           timeStr = timeStr.replace('시', '').replace(' ', '');
            if (timeStr.includes('~')) {
                const [start, end] = timeStr.split('~');
                const cleanStart = start.includes(':') ? start : start + ':00';
                const cleanEnd = end.includes(':') ? end : end + ':00';
                timeStr = `${cleanStart}~${cleanEnd}`;
            }
           if (name && workDays.length > 0) payload.push({ name, time: timeStr, workDays, position: '직원', salaryType:'hourly', salary:0 });
       }
    });

    if (payload.length > 0) {
        if(confirm(`${payload.length}명 등록하시겠습니까?`)) {
            try {
                const res = await fetch('/api/staff', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ staffList: payload, actor: currentUser.name })
                });
                const json = await res.json();
                if (json.success) {
                    alert('등록 완료!');
                    loadStaffData();
                    document.getElementById('bulkText').value = '';
                } else alert('실패');
            } catch (e) { alert('오류'); }
        }
    }
}
