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

// 셀 팩토리: s = 스타일 인덱스(ATT_XS), merge = 병합할 열 수
function aStr(v, s) { return { t: 's', v: v == null ? '' : String(v), s: s || 0 }; }
function aNum(v, s) { return { t: 'n', v: Number(v) || 0, s: s || 0 }; }
function aTitle(v, s, span) { return { t: 's', v: String(v == null ? '' : v), s: s || 0, merge: span }; }

function downloadAttendanceExcel() {
    const data = window._attSummary || [];
    if (!data.length) {
        alert('내려받을 출퇴근 내역이 없습니다.');
        return;
    }
    const isAdmin = currentUser && currentUser.role === 'admin';
    const [yy, mm] = attMonth.split('-');
    const title = `${yy}년 ${Number(mm)}월 알바 출퇴근${isAdmin ? ' / 급여 정산' : ''}`;
    const X = ATT_XS;

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
    const hoursOf = min => Number(((min || 0) / 60).toFixed(1));

    // 상세 표 최대 열 수 = 8 (알바/날짜/요일/출근/퇴근/근무시간/금액/메모)
    const COLS = isAdmin ? 8 : 6;

    // ===== 시트1: 요약 + 상세 =====
    const s1 = [];
    s1.push([aTitle(title, X.title, COLS)]);
    s1.push([aTitle('생성: ' + new Date().toLocaleString('ko-KR'), X.muted, COLS)]);
    s1.push([]);

    // 요약
    s1.push([aTitle('■ 알바별 요약', X.section, COLS)]);
    const sumHead = isAdmin
        ? ['알바', '시급', '근무일수', '총 근무시간', '이번달 알바비']
        : ['알바', '근무일수', '총 근무시간', '평균 근무', '하루 최대'];
    s1.push(sumHead.map(h => aStr(h, X.colhead)));

    let grandDays = 0, grandMin = 0, grandPay = 0;
    data.forEach(a => {
        const w = wageOf(a.id);
        const pay = calcPay(a, w);
        grandDays += a.days || 0; grandMin += a.totalMin || 0; grandPay += pay;
        if (isAdmin) {
            const wageCell = w.salaryType === 'monthly' ? aStr('월급', X.def) : aNum(w.salary, X.money);
            s1.push([aStr(a.name, X.textL), wageCell, aNum(a.days || 0, X.def), aNum(hoursOf(a.totalMin), X.def), aNum(pay, X.money)]);
        } else {
            s1.push([aStr(a.name, X.textL), aNum(a.days || 0, X.def), aNum(hoursOf(a.totalMin), X.def), aNum(hoursOf(a.avgMin), X.def), aNum(hoursOf(a.maxMin), X.def)]);
        }
    });
    // 합계
    if (isAdmin) {
        s1.push([aStr('합계', X.totText), aStr('', X.totText), aNum(grandDays, X.totText), aNum(hoursOf(grandMin), X.totText), aNum(grandPay, X.moneyTot)]);
    } else {
        s1.push([aStr('합계', X.totText), aNum(grandDays, X.totText), aNum(hoursOf(grandMin), X.totText), aStr('', X.totText), aStr('', X.totText)]);
    }
    s1.push([]);

    // 상세
    s1.push([aTitle('■ 출퇴근 상세 내역', X.section, COLS)]);
    const detHead = isAdmin
        ? ['알바', '날짜', '요일', '출근', '퇴근', '근무시간', '금액', '메모']
        : ['알바', '날짜', '요일', '출근', '퇴근', '근무시간'];
    s1.push(detHead.map(h => aStr(h, X.colhead)));

    data.forEach(a => {
        const w = wageOf(a.id);
        const recs = [...(a.records || [])].sort((x, y) => (x.date || '').localeCompare(y.date || ''));
        recs.forEach(r => {
            const overnight = (parseInt(String(r.end).replace(':', ''), 10) <= parseInt(String(r.start).replace(':', ''), 10)) ? ' (익일)' : '';
            const row = [aStr(a.name, X.textL), aStr(r.date, X.def), aStr(attWeekday(r.date), X.def),
                aStr(r.start, X.def), aStr(r.end + overnight, X.def), aNum(hoursOf(r.minutes), X.def)];
            if (isAdmin) {
                if (w.salaryType === 'monthly') row.push(aStr('', X.money));
                else row.push(aNum(Math.round((r.minutes || 0) / 60 * w.salary), X.money));
                row.push(aStr(r.note || '', X.textL));
            }
            s1.push(row);
        });
    });

    // ===== 시트2: 일자별 출퇴근 비교 (알바=행, 날짜=열) =====
    const s2 = buildAttPivotRows(data);

    // 실제 .xlsx(OOXML) 생성 → 두 시트가 확실히 분리됨
    const sheet1Cols = [{ min: 1, max: 1, width: 12 }, { min: 2, max: Math.max(2, COLS), width: 12 }];
    const sheet2Cols = [{ min: 1, max: 1, width: 12 }, { min: 2, max: Math.max(2, s2.nCols), width: 13 }];
    const xlsx = attWriteXlsx([
        { name: '출퇴근', xml: attSheetXml(s1, { cols: sheet1Cols }) },
        { name: '일자별비교', xml: attSheetXml(s2.rows, { cols: sheet2Cols, freeze: { xSplit: 1, ySplit: 4, topLeft: 'B5' } }) }
    ]);

    const blob = new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `출퇴근_${attMonth}${isAdmin ? '_급여' : ''}.xlsx`;
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

// 시트2 셀 데이터 생성: 알바=행, 날짜=열, 셀=출근~퇴근, 튀는 퇴근은 빨강
// return: { rows: [[cell,...],...], nCols }
function buildAttPivotRows(data) {
    const X = ATT_XS;
    // 이번 달 기록이 있는 날짜 모으기
    const dateSet = new Set();
    data.forEach(a => (a.records || []).forEach(r => { if (r.date) dateSet.add(r.date); }));
    const dates = [...dateSet].sort();
    const nCols = Math.max(1, dates.length + 1);

    if (!dates.length) {
        return { rows: [[aStr('입력된 출퇴근 내역이 없습니다.', X.muted)]], nCols };
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
    const rows = [];
    rows.push([aTitle(`${yy}년 ${Number(mm)}월 일자별 출퇴근 비교표`, X.title, nCols)]);
    rows.push([aTitle('※ 셀 안은 "출근~퇴근". 빨간 셀 = 그날 다른 알바들과 비교해 퇴근시간이 튀는 경우(오입력 의심).', X.noteRed, nCols)]);
    rows.push([]);

    // 헤더: 알바 ＼ 날짜 + 각 날짜(M/D 요일)
    const head = [aStr('알바 ＼ 날짜', X.colhead)];
    dates.forEach(d => {
        const [, m, dd] = d.split('-');
        const wd = attWeekday(d);
        const s = wd === '토' ? X.colheadSat : (wd === '일' ? X.colheadSun : X.colhead);
        head.push(aStr(`${Number(m)}/${Number(dd)}(${wd})`, s));
    });
    rows.push(head);

    // 각 알바 행
    data.forEach(a => {
        const row = [aStr(a.name, X.name)];
        dates.forEach(d => {
            const rs = (a.records || []).filter(r => r.date === d)
                .sort((x, y) => (attParseHM(x.start) || 0) - (attParseHM(y.start) || 0));
            if (!rs.length) { row.push(aStr('', X.def)); return; }
            const txt = rs.map(r => {
                const overnight = attEndMinAbs(r) > 1440 ? ' (익일)' : '';
                return `${r.start}~${r.end}${overnight}`;
            }).join(' / ');
            row.push(aStr(txt, flag[`${d}_${a.id}`] ? X.red : X.def));
        });
        rows.push(row);
    });

    return { rows, nCols };
}

// ==========================================
// 최소 .xlsx(OOXML) 생성기 — 외부 라이브러리 없이 두 시트를 확실히 분리
// ==========================================
// 스타일 인덱스 (styles.xml의 cellXfs 순서와 일치)
const ATT_XS = {
    def: 0, bold: 1, title: 2, muted: 3, section: 4, colhead: 5,
    colheadSat: 6, colheadSun: 7, textL: 8, name: 9, money: 10,
    moneyTot: 11, totText: 12, red: 13, noteRed: 14
};

const ATT_STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>' +
    '<fonts count="6">' +
    '<font><sz val="11"/><name val="맑은 고딕"/></font>' +
    '<font><b/><sz val="11"/><name val="맑은 고딕"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFC92A2A"/><name val="맑은 고딕"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF1971C2"/><name val="맑은 고딕"/></font>' +
    '<font><sz val="11"/><color rgb="FF868E96"/><name val="맑은 고딕"/></font>' +
    '<font><b/><sz val="14"/><name val="맑은 고딕"/></font>' +
    '</fonts>' +
    '<fills count="6">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDEE2E6"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F5"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC9C9"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF8F9FA"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="15">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="1" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

function attXmlEsc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// 0-based 열 인덱스 -> 엑셀 열문자 (0->A, 26->AA)
function attColLetter(n) {
    let s = ''; n += 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
}

// rows(셀 2차원 배열) -> worksheet xml
function attSheetXml(rows, opt) {
    opt = opt || {};
    const merges = [];
    let sd = '';
    rows.forEach((cells, ri) => {
        const r = ri + 1;
        let col = 0, cx = '';
        (cells || []).forEach(c => {
            const span = c.merge && c.merge > 1 ? c.merge : 1;
            const ref = attColLetter(col) + r;
            if (c.t === 'n') {
                cx += `<c r="${ref}" s="${c.s || 0}"><v>${c.v}</v></c>`;
            } else {
                const v = c.v == null ? '' : String(c.v);
                cx += v === ''
                    ? `<c r="${ref}" s="${c.s || 0}"/>`
                    : `<c r="${ref}" s="${c.s || 0}" t="inlineStr"><is><t xml:space="preserve">${attXmlEsc(v)}</t></is></c>`;
            }
            if (span > 1) merges.push(`${ref}:${attColLetter(col + span - 1)}${r}`);
            col += span;
        });
        sd += `<row r="${r}">${cx}</row>`;
    });
    let views = '';
    if (opt.freeze) {
        const f = opt.freeze;
        views = `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${f.xSplit || 0}" ySplit="${f.ySplit || 0}" topLeftCell="${f.topLeft}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`;
    }
    let cols = '';
    if (opt.cols && opt.cols.length) {
        cols = '<cols>' + opt.cols.map(c => `<col min="${c.min}" max="${c.max}" width="${c.width}" customWidth="1"/>`).join('') + '</cols>';
    }
    const mc = merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        views + cols + `<sheetData>${sd}</sheetData>` + mc + '</worksheet>';
}

// sheets: [{name, xml}] -> .xlsx 바이트(Uint8Array)
function attWriteXlsx(sheets) {
    const enc = new TextEncoder();
    const files = [];
    const add = (name, str) => files.push({ name, data: enc.encode(str) });

    add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>');
    add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>');
    add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + sheets.map((s, i) => `<sheet name="${attXmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
    add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>');
    add('xl/styles.xml', ATT_STYLES_XML);
    sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, s.xml));

    return attZip(files);
}

// CRC32
const ATT_CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
})();
function attCrc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = ATT_CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// 무압축(stored) ZIP 생성: files=[{name, data:Uint8Array}] -> Uint8Array
function attZip(files) {
    const enc = new TextEncoder();
    const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
    const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach(f => {
        const nameBytes = enc.encode(f.name);
        const crc = attCrc32(f.data);
        const size = f.data.length;
        const local = new Uint8Array([].concat(
            u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
            u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0)
        ));
        parts.push(local, nameBytes, f.data);
        const cen = new Uint8Array([].concat(
            u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
            u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
        ));
        central.push(cen, nameBytes);
        offset += local.length + nameBytes.length + size;
    });
    let cdSize = 0;
    central.forEach(c => cdSize += c.length);
    const cdOffset = offset;
    const eocd = new Uint8Array([].concat(
        u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(cdOffset), u16(0)
    ));
    const all = [...parts, ...central, eocd];
    let total = 0; all.forEach(a => total += a.length);
    const out = new Uint8Array(total);
    let p = 0; all.forEach(a => { out.set(a, p); p += a.length; });
    return out;
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
