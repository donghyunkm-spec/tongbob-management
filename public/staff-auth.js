// staff-auth.js - 로그인 및 권한 관리

// ==========================================
// 로그인 모달
// ==========================================
function openLoginModal() {
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginPassword').focus();
}

function closeLoginModal() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
}

// ==========================================
// 로그인 처리
// ==========================================
async function tryLogin() {
    const pwd = document.getElementById('loginPassword').value;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();

        if (data.success) {
            const sessionData = {
                ...data,
                loginTime: new Date().getTime()
            };
            localStorage.setItem('staffUser', JSON.stringify(sessionData));
            onLoginSuccess(data);
            closeLoginModal();
        } else {
            const err = document.getElementById('loginError');
            if(err) {
                err.style.display = 'block';
                err.textContent = '비밀번호가 일치하지 않습니다.';
            }
        }
    } catch (e) {
        console.error('로그인 에러:', e);
        alert('로그인 처리 중 오류가 발생했습니다.');
    }
}

// ==========================================
// 로그인 성공 후 UI 업데이트
// ==========================================
async function onLoginSuccess(user) {
    currentUser = user;

    const loginBtn = document.getElementById('loginBtn');
    if(loginBtn) loginBtn.style.display = 'none';

    const userInfoDiv = document.getElementById('userInfo');
    if(userInfoDiv) {
        userInfoDiv.style.display = 'flex';
    }

    const roleNameMap = { admin: '사장', manager: '점장', viewer: '직원', inventory: '재고담당' };
    const userNameSpan = document.getElementById('userName');
    if(userNameSpan) {
        userNameSpan.textContent = `${user.name} (${roleNameMap[user.role] || user.role})`;
    }

    // 로그인 성공 시 재고관리 탭 표시
    const inventoryTab = document.getElementById('tab-inventory');
    if(inventoryTab) {
        inventoryTab.style.display = 'block';
    }

    // 재고담당 전용: 재고관리 탭만 표시, 나머지 숨김
    if (user.role === 'inventory') {
        // 매장관리(출퇴근) 메인탭과 매입/매출 탭 숨김
        document.querySelectorAll('.main-tabs > button').forEach(btn => {
            const onclick = btn.getAttribute('onclick') || '';
            if (!onclick.includes("'inventory'") && !onclick.includes("'manual'")) {
                btn.style.display = 'none';
            }
        });
        // 재고관리 탭으로 자동 전환
        if(typeof switchTab === 'function') switchTab('inventory');
        return;
    }

    // 관리자(사장님) 전용 권한
    if (user.role === 'admin') {
        const bulkSection = document.getElementById('bulkSection');
        if(bulkSection) bulkSection.style.display = 'block';

        const salarySection = document.getElementById('salarySection');
        if(salarySection) salarySection.style.display = 'block';

        const backupSection = document.getElementById('backupSection');
        if(backupSection) backupSection.style.display = 'block';

        const backupBtn = document.getElementById('adminBackupBtn');
        if(backupBtn) backupBtn.style.display = 'block';

        try { await loadLogs(); } catch(e) {}
    }

    // 매니저는 예상순익, 월간분석, 변경이력, 입력내역, 고정비 탭 숨김
    if (user.role === 'manager') {
        const predTab = document.getElementById('tab-prediction');
        const dashTab = document.getElementById('tab-dashboard');
        const logsTab = document.getElementById('tab-logs');
        const historyTab = document.getElementById('tab-history');
        const monthlyTab = document.getElementById('tab-monthly');
        if(predTab) predTab.style.display = 'none';
        if(dashTab) dashTab.style.display = 'none';
        if(logsTab) logsTab.style.display = 'none';
        if(historyTab) historyTab.style.display = 'none';
        if(monthlyTab) monthlyTab.style.display = 'none';
    }

    const activeTab = document.querySelector('.tab-content.active');
    if(activeTab && activeTab.id === 'accounting-content') {
        try { await loadAccountingData(); } catch(e) {}
    }
    try { await loadStaffData(); } catch(e) {}
}

// ==========================================
// 로그아웃
// ==========================================
function logout() {
    if (!confirm('로그아웃 하시겠습니까?')) return;

    // localStorage 클리어
    localStorage.removeItem('staffUser');

    // 현재 사용자 초기화
    currentUser = null;

    // 페이지 새로고침
    location.reload();
}
