// staff-attendance.js - 알바 출퇴근 관리 (사장님 전용)
// - 직원별 출퇴근 링크(토큰) 발급/재발급/해제
// - 월별 출퇴근 요약(총시간/근무일수/평균/하루최대) + 수정이력

// 현재 조회 월 (YYYY-MM, KST 기준)
let attMonth = (function () {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

// 하루 최대 근무시간 경고 임계값 (분) - 12시간
const ATT_MAX_WARN_MIN = 12 * 60;

// 분 -> "N시간 M분"
function attFmtDur(min) {
    min = min || 0;
    const h = Math.floor(min / 60), m = min % 60;
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0) return `${h}시간`;
    return `${m}분`;
}

// ==========================================
// 출퇴근 링크 관리 모달
// ==========================================
function openAttLink(id) {
    const s = staffList.find(x => x.id == id);
    if (!s) return;
    const hasToken = !!s.attToken;
    const link = hasToken ? `${location.origin}/alba/${s.attToken}` : '';

    let modal = document.getElementById('attLinkModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'attLinkModal';
        modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div style="background:#fff; border-radius:14px; max-width:440px; width:100%; padding:22px; box-shadow:0 8px 30px rgba(0,0,0,.3);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <h3 style="margin:0;">🔗 ${s.name} 출퇴근 링크</h3>
                <button onclick="closeAttLink()" style="border:none; background:none; font-size:22px; cursor:pointer; color:#888;">×</button>
            </div>
            ${hasToken ? `
                <p style="font-size:13px; color:#555; margin-bottom:8px;">아래 링크를 <strong>${s.name}</strong>님에게 카톡으로 보내주세요. 이 링크로 본인 출퇴근만 입력할 수 있습니다.</p>
                <input id="attLinkInput" type="text" readonly value="${link}"
                    style="width:100%; padding:10px; border:1.5px solid #dee2e6; border-radius:8px; font-size:13px; background:#f8f9fa; margin-bottom:12px;"
                    onclick="this.select()">
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button onclick="copyAttLink()" style="flex:1; min-width:120px; background:#f76707; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:800; cursor:pointer;">📋 링크 복사</button>
                    <button onclick="reissueAttToken(${id})" style="background:#fab005; color:#fff; border:none; padding:12px 14px; border-radius:8px; font-weight:800; cursor:pointer;">🔄 재발급</button>
                    <button onclick="removeAttToken(${id})" style="background:#e03131; color:#fff; border:none; padding:12px 14px; border-radius:8px; font-weight:800; cursor:pointer;">🗑️ 해제</button>
                </div>
                <p style="font-size:11px; color:#999; margin-top:10px;">※ 재발급하면 이전 링크는 즉시 사용할 수 없게 됩니다 (유출 시 사용).</p>
            ` : `
                <p style="font-size:13px; color:#555; margin-bottom:14px;"><strong>${s.name}</strong>님용 출퇴근 입력 링크를 발급합니다. 발급 후 카톡으로 전달하세요.</p>
                <button onclick="reissueAttToken(${id})" style="width:100%; background:#f76707; color:#fff; border:none; padding:14px; border-radius:8px; font-weight:800; cursor:pointer;">🔗 링크 발급하기</button>
            `}
        </div>`;
    modal.style.display = 'flex';
}

function closeAttLink() {
    const m = document.getElementById('attLinkModal');
    if (m) m.style.display = 'none';
}

function copyAttLink() {
    const input = document.getElementById('attLinkInput');
    if (!input) return;
    input.select();
    const done = () => alert('링크가 복사되었습니다. 카톡으로 붙여넣어 보내주세요.');
    if (navigator.clipboard) {
        navigator.clipboard.writeText(input.value).then(done).catch(() => { document.execCommand('copy'); done(); });
    } else {
        document.execCommand('copy');
        done();
    }
}

async function reissueAttToken(id) {
    try {
        const res = await fetch(`/api/staff/${id}/att-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: currentUser?.name || '사장님' })
        });
        if (!res.ok) throw new Error('fail');
        await loadStaffData();       // staffList 갱신 (새 토큰 반영)
        openAttLink(id);             // 모달 새 링크로 다시 렌더
        renderManageList();
    } catch (e) {
        alert('링크 발급에 실패했습니다.');
    }
}

async function resetAttDevice(id) {
    if (!confirm('등록된 휴대폰을 초기화할까요?\n다음에 이 링크를 처음 여는 휴대폰이 새로 등록됩니다.')) return;
    try {
        const res = await fetch(`/api/staff/${id}/att-device-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: currentUser?.name || '사장님' })
        });
        if (!res.ok) throw new Error('fail');
        await loadStaffData();       // attDeviceBound 갱신
        openAttLink(id);             // 모달 상태 갱신
    } catch (e) {
        alert('기기 초기화에 실패했습니다.');
    }
}

async function removeAttToken(id) {
    if (!confirm('이 알바의 출퇴근 링크를 해제할까요?\n(기존 링크는 사용할 수 없게 됩니다)')) return;
    try {
        const res = await fetch(`/api/staff/${id}/att-token`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: currentUser?.name || '사장님' })
        });
        if (!res.ok) throw new Error('fail');
        await loadStaffData();
        closeAttLink();
        renderManageList();
    } catch (e) {
        alert('해제에 실패했습니다.');
    }
}

// ==========================================
// 월별 출퇴근 요약
// ==========================================
function changeAttMonth(delta) {
    const [y, m] = attMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    attMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    loadAttendanceSummary();
}

async function loadAttendanceSummary() {
    const label = document.getElementById('attMonthLabel');
    if (label) {
        const [y, m] = attMonth.split('-');
        label.textContent = `${y}년 ${Number(m)}월`;
    }
    try {
        const [sumRes, logRes] = await Promise.all([
            fetch(`/api/attendance/summary?month=${attMonth}`),
            fetch(`/api/attendance/logs`)
        ]);
        const sumJson = await sumRes.json();
        const logJson = await logRes.json();
        renderAttendanceSummary(sumJson.data || []);
        renderAttendanceLogs(logJson.data || []);
    } catch (e) {
        console.error('출퇴근 요약 로드 실패:', e);
    }
}

function renderAttendanceSummary(data) {
    const body = document.getElementById('attSummaryBody');
    const detailBox = document.getElementById('attDetailBox');
    if (!body) return;
    detailBox.innerHTML = '';
    window._attSummary = data;

    if (!data.length) {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#999; padding:20px;">출퇴근 링크가 발급된 알바가 없습니다. ⚙️ 관리 탭에서 링크를 발급하세요.</td></tr>`;
        return;
    }

    body.innerHTML = data.map(a => {
        const warn = a.maxMin > ATT_MAX_WARN_MIN;
        const maxCell = warn
            ? `<span style="color:#e03131; font-weight:800;">⚠️ ${attFmtDur(a.maxMin)}</span>`
            : (a.maxMin > 0 ? attFmtDur(a.maxMin) : '-');
        return `
            <tr style="cursor:pointer;" onclick="toggleAttDetail(${a.id})">
                <td><strong>${a.name}</strong></td>
                <td style="text-align:center;">${a.days}일</td>
                <td style="text-align:center; font-weight:700; color:#e8590c;">${a.days ? attFmtDur(a.totalMin) : '-'}</td>
                <td style="text-align:center;">${a.days ? attFmtDur(a.avgMin) : '-'}</td>
                <td style="text-align:center;">${maxCell}</td>
                <td style="text-align:center; color:#888;">▼</td>
            </tr>
            <tr id="attDetailRow-${a.id}" style="display:none;">
                <td colspan="6" style="background:#fff8f2; padding:0;">
                    <div id="attDetailContent-${a.id}" style="padding:10px 14px;"></div>
                </td>
            </tr>`;
    }).join('');

    // 상세용 데이터 보관
    window._attData = {};
    data.forEach(a => { window._attData[a.id] = a; });
}

// ==========================================
// 엑셀 다운로드 (한 시트에 전체 알바 요약 + 상세 + 이번달 알바비)
// ==========================================
const ATT_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function attWeekday(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d) ? '' : ATT_WEEKDAYS[d.getDay()];
}

function downloadAttendanceExcel() {
    const data = window._attSummary || [];
    if (!data.length) {
        alert('내려받을 출퇴근 내역이 없습니다.');
        return;
    }
    const isAdmin = currentUser && currentUser.role === 'admin';
    const [yy, mm] = attMonth.split('-');
    const title = `${yy}년 ${Number(mm)}월 알바 출퇴근${isAdmin ? ' / 급여 정산' : ''}`;

    // 각 알바의 시급/급여유형을 staffList에서 조회
    const wageOf = id => {
        const s = staffList.find(x => x.id == id) || {};
        return { salary: s.salary || 0, salaryType: s.salaryType || 'hourly' };
    };
    // 알바비 계산: 시급직은 시간×시급, 월급직은 월급 그대로
    const calcPay = (a, w) => {
        if (!isAdmin) return 0;
        if (w.salaryType === 'monthly') return w.salary;
        return (a.records || []).reduce((sum, r) => sum + Math.round((r.minutes || 0) / 60 * w.salary), 0);
    };

    const MONEY = "mso-number-format:'\\#\\,\\#\\#0'";
    const esc = escapeAttHtml;
    // 상세 표 최대 열 수 = 8 (알바/날짜/요일/출근/퇴근/근무시간/금액/메모)
    const COLS = isAdmin ? 8 : 6;

    let rows = '';
    // 제목
    rows += `<tr><td colspan="${COLS}" style="font-size:15px;font-weight:bold;">${esc(title)}</td></tr>`;
    rows += `<tr><td colspan="${COLS}" style="color:#888;">생성: ${new Date().toLocaleString('ko-KR')}</td></tr>`;
    rows += `<tr><td colspan="${COLS}"></td></tr>`;

    // ===== 요약 =====
    rows += `<tr><td colspan="${COLS}" style="font-weight:bold;background:#f1f3f5;">■ 알바별 요약</td></tr>`;
    const sumHead = isAdmin
        ? ['알바', '시급', '근무일수', '총 근무시간', '이번달 알바비']
        : ['알바', '근무일수', '총 근무시간', '평균 근무', '하루 최대'];
    rows += '<tr>' + sumHead.map(h => `<th style="background:#dee2e6;">${h}</th>`).join('') + `<th colspan="${COLS - sumHead.length}" style="background:#dee2e6;"></th></tr>`;

    let grandDays = 0, grandMin = 0, grandPay = 0;
    data.forEach(a => {
        const w = wageOf(a.id);
        const pay = calcPay(a, w);
        grandDays += a.days || 0; grandMin += a.totalMin || 0; grandPay += pay;
        const hours = ((a.totalMin || 0) / 60).toFixed(1);
        if (isAdmin) {
            const wageCell = w.salaryType === 'monthly'
                ? `<td>월급</td>`
                : `<td style="${MONEY}">${w.salary}</td>`;
            rows += `<tr><td>${esc(a.name)}</td>${wageCell}<td>${a.days || 0}</td><td>${hours}</td><td style="${MONEY}">${pay}</td><td colspan="${COLS - 5}"></td></tr>`;
        } else {
            rows += `<tr><td>${esc(a.name)}</td><td>${a.days || 0}</td><td>${hours}</td><td>${((a.avgMin || 0) / 60).toFixed(1)}</td><td>${((a.maxMin || 0) / 60).toFixed(1)}</td><td></td></tr>`;
        }
    });
    // 합계
    if (isAdmin) {
        rows += `<tr style="font-weight:bold;background:#f8f9fa;"><td>합계</td><td></td><td>${grandDays}</td><td>${(grandMin / 60).toFixed(1)}</td><td style="${MONEY}">${grandPay}</td><td colspan="${COLS - 5}"></td></tr>`;
    } else {
        rows += `<tr style="font-weight:bold;background:#f8f9fa;"><td>합계</td><td>${grandDays}</td><td>${(grandMin / 60).toFixed(1)}</td><td></td><td></td><td></td></tr>`;
    }

    rows += `<tr><td colspan="${COLS}"></td></tr>`;

    // ===== 상세 =====
    rows += `<tr><td colspan="${COLS}" style="font-weight:bold;background:#f1f3f5;">■ 출퇴근 상세 내역</td></tr>`;
    const detHead = isAdmin
        ? ['알바', '날짜', '요일', '출근', '퇴근', '근무시간', '금액', '메모']
        : ['알바', '날짜', '요일', '출근', '퇴근', '근무시간'];
    rows += '<tr>' + detHead.map(h => `<th style="background:#dee2e6;">${h}</th>`).join('') + '</tr>';

    data.forEach(a => {
        const w = wageOf(a.id);
        const recs = [...(a.records || [])].sort((x, y) => (x.date || '').localeCompare(y.date || ''));
        if (!recs.length) return;
        recs.forEach(r => {
            const hours = ((r.minutes || 0) / 60).toFixed(1);
            const overnight = (parseInt(String(r.end).replace(':', ''), 10) <= parseInt(String(r.start).replace(':', ''), 10)) ? ' (익일)' : '';
            let row = `<td>${esc(a.name)}</td><td>${r.date}</td><td>${attWeekday(r.date)}</td><td>${r.start}</td><td>${r.end}${overnight}</td><td>${hours}</td>`;
            if (isAdmin) {
                const pay = w.salaryType === 'monthly' ? '' : Math.round((r.minutes || 0) / 60 * w.salary);
                row += `<td style="${MONEY}">${pay}</td><td>${r.note ? esc(r.note) : ''}</td>`;
            }
            rows += `<tr>${row}</tr>`;
        });
    });

    // ===== 시트2: 일자별 출퇴근 비교 (알바=행, 날짜=열) =====
    // 그 날짜에 다른 알바들과 비교해 퇴근시간이 너무 튀는 셀을 빨갛게 표시(오입력 의심)
    const pivotRows = buildAttPivotSheet(data, esc);

    const html = `﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>출퇴근</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet><x:ExcelWorksheet><x:Name>일자별비교</x:Name><x:WorksheetOptions><x:DisplayGridlines/><x:FreezePanes/><x:FrozenNoSplit/><x:SplitHorizontal>1</x:SplitHorizontal><x:TopRowBottomPane>1</x:TopRowBottomPane><x:SplitVertical>1</x:SplitVertical><x:LeftColumnRightPane>1</x:LeftColumnRightPane><x:ActivePane>0</x:ActivePane></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>td,th{border:0.5pt solid #ccc;padding:3px 6px;text-align:center;mso-data-placement:same-cell;} th{font-weight:bold;}</style></head>
<body><table>${rows}</table><br><table>${pivotRows}</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `출퇴근_${attMonth}${isAdmin ? '_급여' : ''}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "HH:MM" -> 분. 실패 시 null
function attParseHM(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
}

// 퇴근시각을 "출근 이후 경과 기준"의 절대 분으로 (자정 넘김이면 +24h) → 비교용
function attEndMinAbs(r) {
    const s = attParseHM(r.start), e = attParseHM(r.end);
    if (s === null || e === null) return null;
    return e <= s ? e + 1440 : e;
}

function attMedian(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    if (!n) return 0;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// 같은 날 알바들의 퇴근시간(vals: 절대분)에서 튀는 값 인덱스 → boolean 배열
// 현장 특성 반영: 설거지 등으로 1시간 정도 늦는 건 정상 → 중앙값 대비 편차가
//   MIN_DEV(90분) 이내면 무시. HARD_DEV(150분) 이상이면 무조건 이상치.
//   그 사이 구간만 MAD 기반(수정 z-score)으로 판단. 표본 3 미만이면 판단 보류.
function attEndOutlierFlags(vals) {
    const n = vals.length;
    const flags = new Array(n).fill(false);
    if (n < 3) return flags;
    const MIN_DEV = 90;    // 90분 이내 차이는 정상(설거지 등)으로 보고 무시
    const HARD_DEV = 150;  // 2.5시간 이상 벌어지면 무조건 이상(오입력 의심)
    const med = attMedian(vals);
    const devs = vals.map(v => Math.abs(v - med));
    const mad = attMedian(devs);
    for (let i = 0; i < n; i++) {
        const dev = devs[i];
        if (dev < MIN_DEV) continue;            // 정상 범위 → 표시 안 함
        if (dev >= HARD_DEV) { flags[i] = true; continue; }
        if (mad === 0) { flags[i] = true; }     // 다들 거의 같은데 이 값만 90분+ 벗어남
        else if (0.6745 * dev / mad > 3.5) flags[i] = true;
    }
    return flags;
}

// 시트2 HTML(테이블 내용) 생성: 알바=행, 날짜=열, 셀=출근~퇴근, 튀는 퇴근은 빨강
function buildAttPivotSheet(data, esc) {
    // 이번 달 기록이 있는 날짜 모으기
    const dateSet = new Set();
    data.forEach(a => (a.records || []).forEach(r => { if (r.date) dateSet.add(r.date); }));
    const dates = [...dateSet].sort();
    const nCols = dates.length + 1;

    if (!dates.length) {
        return `<tr><td>입력된 출퇴근 내역이 없습니다.</td></tr>`;
    }

    // 날짜별로 알바들의 퇴근시간(절대분)을 모아 튀는 알바 계산
    const flag = {}; // `${date}_${staffId}` -> true
    dates.forEach(d => {
        const entries = []; // {id, endMin}
        data.forEach(a => {
            const rs = (a.records || []).filter(r => r.date === d);
            if (!rs.length) return;
            // 같은 날 여러 건이면 가장 늦은 퇴근을 대표값으로
            let best = null;
            rs.forEach(r => { const em = attEndMinAbs(r); if (em !== null && (best === null || em > best)) best = em; });
            if (best !== null) entries.push({ id: a.id, endMin: best });
        });
        const outFlags = attEndOutlierFlags(entries.map(e => e.endMin));
        entries.forEach((e, i) => { if (outFlags[i]) flag[`${d}_${e.id}`] = true; });
    });

    const [yy, mm] = attMonth.split('-');
    let rows = '';
    rows += `<tr><td colspan="${nCols}" style="font-size:15px;font-weight:bold;">${yy}년 ${Number(mm)}월 일자별 출퇴근 비교표</td></tr>`;
    rows += `<tr><td colspan="${nCols}" style="color:#c92a2a;">※ 셀 안은 "출근~퇴근". <b style="background:#ffc9c9;">빨간 셀</b> = 그날 다른 알바들과 비교해 퇴근시간이 튀는 경우(오입력 의심).</td></tr>`;
    rows += `<tr><td colspan="${nCols}"></td></tr>`;

    // 헤더: 알바 ＼ 날짜 + 각 날짜(M/D 요일)
    rows += '<tr><th style="background:#dee2e6;">알바 ＼ 날짜</th>' + dates.map(d => {
        const [, m, dd] = d.split('-');
        const wd = attWeekday(d);
        const weekend = wd === '토' ? 'color:#1971c2;' : (wd === '일' ? 'color:#e03131;' : '');
        return `<th style="background:#dee2e6;${weekend}">${Number(m)}/${Number(dd)}<br>(${wd})</th>`;
    }).join('') + '</tr>';

    // 각 알바 행
    data.forEach(a => {
        let tds = `<td style="font-weight:bold;background:#f8f9fa;text-align:left;">${esc(a.name)}</td>`;
        dates.forEach(d => {
            const rs = (a.records || []).filter(r => r.date === d)
                .sort((x, y) => (attParseHM(x.start) || 0) - (attParseHM(y.start) || 0));
            if (!rs.length) { tds += '<td></td>'; return; }
            const txt = rs.map(r => {
                const overnight = attEndMinAbs(r) > 1440 ? ' (익일)' : '';
                return `${r.start}~${r.end}${overnight}`;
            }).join('<br>');
            const flagged = flag[`${d}_${a.id}`];
            const style = flagged ? 'background:#ffc9c9;color:#c92a2a;font-weight:bold;' : '';
            tds += `<td style="${style}">${txt}</td>`;
        });
        rows += `<tr>${tds}</tr>`;
    });

    return rows;
}

function toggleAttDetail(id) {
    const row = document.getElementById(`attDetailRow-${id}`);
    if (!row) return;
    const show = row.style.display === 'none';
    row.style.display = show ? 'table-row' : 'none';
    if (!show) return;

    const a = (window._attData || {})[id];
    const content = document.getElementById(`attDetailContent-${id}`);
    if (!a || !content) return;
    const recs = [...(a.records || [])].sort((x, y) => (y.date || '').localeCompare(x.date || ''));
    if (!recs.length) {
        content.innerHTML = `<div style="color:#999; padding:8px;">이 달 입력 내역이 없습니다.</div>`;
        return;
    }
    const canEdit = currentUser && currentUser.role === 'admin';
    content.innerHTML = `
        <table style="width:100%; font-size:13px; border-collapse:collapse;">
            <thead><tr style="color:#888;">
                <th style="text-align:left; padding:4px 6px;">날짜</th>
                <th style="text-align:left; padding:4px 6px;">시간</th>
                <th style="text-align:right; padding:4px 6px;">근무</th>
                <th style="text-align:left; padding:4px 6px;">메모</th>
                ${canEdit ? '<th style="text-align:right; padding:4px 6px;">관리</th>' : ''}
            </tr></thead>
            <tbody>
                ${recs.map(r => {
                    const overnight = (parseInt(r.end.replace(':', ''), 10) <= parseInt(r.start.replace(':', ''), 10)) ? ' <span style="color:#adb5bd;">(익일)</span>' : '';
                    const warn = (r.minutes || 0) > ATT_MAX_WARN_MIN ? ' color:#e03131; font-weight:700;' : '';
                    const manageCell = canEdit ? `<td style="padding:5px 6px; text-align:right; white-space:nowrap;">
                        <button onclick="editAttRecord(${a.id}, ${r.id})" style="background:#1971c2; color:#fff; border:none; padding:4px 8px; border-radius:5px; font-size:12px; font-weight:700; cursor:pointer;">수정</button>
                        <button onclick="deleteAttRecord(${a.id}, ${r.id})" style="background:#e03131; color:#fff; border:none; padding:4px 8px; border-radius:5px; font-size:12px; font-weight:700; cursor:pointer; margin-left:4px;">삭제</button>
                    </td>` : '';
                    return `<tr style="border-top:1px solid #ffe8d6;">
                        <td style="padding:5px 6px;">${r.date}</td>
                        <td style="padding:5px 6px;">${r.start} ~ ${r.end}${overnight}</td>
                        <td style="padding:5px 6px; text-align:right;${warn}">${attFmtDur(r.minutes || 0)}</td>
                        <td style="padding:5px 6px; color:#888;">${r.note ? escapeAttHtml(r.note) : ''}</td>
                        ${manageCell}
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
}

// ==========================================
// [사장님] 출퇴근 기록 수정/삭제
// ==========================================
// 상세 뷰를 열어둔 채 데이터만 다시 불러와 갱신 (열린 상세는 재렌더)
async function refreshAttAfterChange(staffId) {
    const wasOpen = (() => {
        const row = document.getElementById(`attDetailRow-${staffId}`);
        return row && row.style.display !== 'none';
    })();
    await loadAttendanceSummary();
    if (wasOpen) {
        const row = document.getElementById(`attDetailRow-${staffId}`);
        if (row) { row.style.display = 'none'; toggleAttDetail(staffId); }
    }
}

function editAttRecord(staffId, rid) {
    const a = (window._attData || {})[staffId];
    if (!a) return;
    const r = (a.records || []).find(x => x.id == rid);
    if (!r) return;

    let modal = document.getElementById('attEditModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'attEditModal';
        modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div style="background:#fff; border-radius:14px; max-width:400px; width:100%; padding:22px; box-shadow:0 8px 30px rgba(0,0,0,.3);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h3 style="margin:0;">✏️ ${escapeAttHtml(a.name)} 출퇴근 수정</h3>
                <button onclick="closeAttEdit()" style="border:none; background:none; font-size:22px; cursor:pointer; color:#888;">×</button>
            </div>
            <label style="display:block; font-size:13px; color:#555; margin-bottom:4px;">날짜</label>
            <input id="attEditDate" type="date" value="${r.date}" style="width:100%; padding:9px; border:1.5px solid #dee2e6; border-radius:8px; margin-bottom:12px;">
            <div style="display:flex; gap:10px; margin-bottom:12px;">
                <div style="flex:1;">
                    <label style="display:block; font-size:13px; color:#555; margin-bottom:4px;">출근</label>
                    <input id="attEditStart" type="time" value="${r.start}" style="width:100%; padding:9px; border:1.5px solid #dee2e6; border-radius:8px;">
                </div>
                <div style="flex:1;">
                    <label style="display:block; font-size:13px; color:#555; margin-bottom:4px;">퇴근</label>
                    <input id="attEditEnd" type="time" value="${r.end}" style="width:100%; padding:9px; border:1.5px solid #dee2e6; border-radius:8px;">
                </div>
            </div>
            <label style="display:block; font-size:13px; color:#555; margin-bottom:4px;">메모</label>
            <input id="attEditNote" type="text" value="${r.note ? escapeAttHtml(r.note) : ''}" placeholder="(선택)" style="width:100%; padding:9px; border:1.5px solid #dee2e6; border-radius:8px; margin-bottom:16px;">
            <div style="display:flex; gap:8px;">
                <button onclick="closeAttEdit()" style="flex:1; background:#e9ecef; color:#495057; border:none; padding:12px; border-radius:8px; font-weight:800; cursor:pointer;">취소</button>
                <button onclick="saveAttRecordEdit(${staffId}, ${rid})" style="flex:2; background:#1971c2; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:800; cursor:pointer;">저장</button>
            </div>
            <p style="font-size:11px; color:#999; margin-top:10px;">※ 퇴근이 출근보다 빠르면 익일 퇴근으로 계산됩니다.</p>
        </div>`;
    modal.style.display = 'flex';
}

function closeAttEdit() {
    const m = document.getElementById('attEditModal');
    if (m) m.style.display = 'none';
}

async function saveAttRecordEdit(staffId, rid) {
    const date = document.getElementById('attEditDate').value;
    const start = document.getElementById('attEditStart').value;
    const end = document.getElementById('attEditEnd').value;
    const note = document.getElementById('attEditNote').value;
    if (!date || !start || !end) { alert('날짜/출근/퇴근을 모두 입력하세요.'); return; }
    try {
        const res = await fetch(`/api/attendance/record/${staffId}/${rid}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, start, end, note, actor: currentUser?.name || '사장님' })
        });
        if (!res.ok) throw new Error('fail');
        closeAttEdit();
        await refreshAttAfterChange(staffId);
    } catch (e) {
        alert('수정에 실패했습니다.');
    }
}

async function deleteAttRecord(staffId, rid) {
    const a = (window._attData || {})[staffId];
    const r = a && (a.records || []).find(x => x.id == rid);
    const label = r ? `${r.date} ${r.start}~${r.end}` : '이 기록';
    if (!confirm(`${label} 출퇴근 기록을 삭제할까요?`)) return;
    try {
        const res = await fetch(`/api/attendance/record/${staffId}/${rid}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: currentUser?.name || '사장님' })
        });
        if (!res.ok) throw new Error('fail');
        await refreshAttAfterChange(staffId);
    } catch (e) {
        alert('삭제에 실패했습니다.');
    }
}

function renderAttendanceLogs(logs) {
    const body = document.getElementById('attLogBody');
    if (!body) return;
    if (!logs.length) {
        body.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#999; padding:16px;">이력이 없습니다.</td></tr>`;
        return;
    }
    body.innerHTML = logs.slice(0, 200).map(l => {
        const time = new Date(l.timestamp).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const color = l.action === '삭제' ? '#e03131' : (l.action === '수정' ? '#1971c2' : '#2f9e44');
        return `<tr>
            <td>${time}</td>
            <td>${l.staffName || '-'}</td>
            <td><span style="color:${color}; font-weight:700;">${l.action}</span></td>
            <td>${escapeAttHtml(l.detail || '')}</td>
        </tr>`;
    }).join('');
}

function escapeAttHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
