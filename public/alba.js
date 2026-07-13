// alba.js - 알바 출퇴근 입력 페이지 (관리시스템과 분리된 독립 페이지)
// URL: /alba/:token

// ==========================================
// 다국어 (한국어 / English / မြန်မာ)
// ==========================================
const I18N = {
  ko: {
    greet: name => `${name}님, 안녕하세요! 👋`,
    inputTitle: '출퇴근 입력',
    dateLabel: '날짜',
    startLabel: '출근 시간',
    endLabel: '퇴근 시간',
    noteLabel: '메모 (선택)',
    save: '저장하기',
    saveEdit: '수정 저장',
    saving: '저장 중...',
    cancel: '취소',
    summaryTitle: '내 근무 요약',
    stTotal: '총 근무시간',
    stDays: '근무일수',
    stAvg: '평균 근무',
    listTitle: '내 근무내역',
    edit: '수정',
    del: '삭제',
    empty: '아직 입력한 내역이 없어요.',
    invalidLink: '잘못된 링크이거나 만료된 링크입니다.\n사장님께 문의해 주세요.',
    saved: '저장되었습니다 ✅',
    updated: '수정되었습니다 ✅',
    deleted: '삭제되었습니다',
    confirmDel: '이 기록을 삭제할까요?',
    needTime: '출근/퇴근 시간을 선택해 주세요.',
    needDate: '날짜를 선택해 주세요.',
    failed: '저장에 실패했습니다. 다시 시도해 주세요.',
    dupDate: '이미 이 날짜에 입력한 기록이 있어요.\n기존 기록을 수정하거나 삭제한 뒤 다시 입력해 주세요.',
    deviceLocked: '이 링크는 다른 휴대폰에 등록되어 있습니다.\n본인 휴대폰이 맞다면 사장님께 "기기 초기화"를 요청해 주세요.',
    unit_h: '시간', unit_m: '분', days: '일',
    overnight: '(익일)',
    monthLabel: (y, m) => `${y}년 ${m}월`,
    emptyMonth: '이 달은 입력한 내역이 없어요.'
  },
  en: {
    greet: name => `Hello, ${name}! 👋`,
    inputTitle: 'Log Work Hours',
    dateLabel: 'Date',
    startLabel: 'Clock In',
    endLabel: 'Clock Out',
    noteLabel: 'Note (optional)',
    save: 'Save',
    saveEdit: 'Save Changes',
    saving: 'Saving...',
    cancel: 'Cancel',
    summaryTitle: 'My Summary',
    stTotal: 'Total Hours',
    stDays: 'Days Worked',
    stAvg: 'Avg / Day',
    listTitle: 'My Records',
    edit: 'Edit',
    del: 'Delete',
    empty: 'No records yet.',
    invalidLink: 'Invalid or expired link.\nPlease contact the owner.',
    saved: 'Saved ✅',
    updated: 'Updated ✅',
    deleted: 'Deleted',
    confirmDel: 'Delete this record?',
    needTime: 'Please select clock-in / clock-out time.',
    needDate: 'Please select a date.',
    failed: 'Failed to save. Please try again.',
    dupDate: 'You already logged this date.\nPlease edit or delete the existing record instead.',
    deviceLocked: 'This link is registered to another phone.\nIf this is your phone, please ask the owner to reset the device.',
    unit_h: 'h', unit_m: 'm', days: 'days',
    overnight: '(next day)',
    monthLabel: (y, m) => `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]} ${y}`,
    emptyMonth: 'No records for this month.'
  },
  my: {
    greet: name => `${name}၊ မင်္ဂလာပါ! 👋`,
    inputTitle: 'အလုပ်ချိန် မှတ်တမ်းတင်ရန်',
    dateLabel: 'ရက်စွဲ',
    startLabel: 'အလုပ်စချိန်',
    endLabel: 'အလုပ်ဆင်းချိန်',
    noteLabel: 'မှတ်ချက် (ရွေးချယ်နိုင်)',
    save: 'သိမ်းမည်',
    saveEdit: 'ပြင်ဆင်ချက် သိမ်းမည်',
    saving: 'သိမ်းနေသည်...',
    cancel: 'ပယ်ဖျက်',
    summaryTitle: 'ကျွန်ုပ်၏ အနှစ်ချုပ်',
    stTotal: 'စုစုပေါင်း အချိန်',
    stDays: 'အလုပ်ဆင်းရက်',
    stAvg: 'ပျမ်းမျှ (တစ်ရက်)',
    listTitle: 'ကျွန်ုပ်၏ မှတ်တမ်း',
    edit: 'ပြင်ရန်',
    del: 'ဖျက်ရန်',
    empty: 'မှတ်တမ်း မရှိသေးပါ။',
    invalidLink: 'လင့်ခ် မမှန်ကန်ပါ သို့မဟုတ် သက်တမ်းကုန်သွားပါပြီ။\nဆိုင်ရှင်ကို ဆက်သွယ်ပါ။',
    saved: 'သိမ်းဆည်းပြီးပါပြီ ✅',
    updated: 'ပြင်ဆင်ပြီးပါပြီ ✅',
    deleted: 'ဖျက်လိုက်ပါပြီ',
    confirmDel: 'ဤမှတ်တမ်းကို ဖျက်မလား?',
    needTime: 'အလုပ်စ/ဆင်းချိန် ရွေးပါ။',
    needDate: 'ရက်စွဲ ရွေးပါ။',
    failed: 'သိမ်းဆည်း၍ မရပါ။ ထပ်စမ်းကြည့်ပါ။',
    dupDate: 'ဤရက်စွဲအတွက် မှတ်တမ်း ရှိပြီးသားဖြစ်သည်။\nရှိပြီးသား မှတ်တမ်းကို ပြင်ပါ သို့မဟုတ် ဖျက်ပြီးမှ ထပ်ထည့်ပါ။',
    deviceLocked: 'ဤလင့်ခ်ကို အခြားဖုန်းတစ်လုံးတွင် မှတ်ပုံတင်ထားပါသည်။\nသင့်ဖုန်းမှန်လျှင် ဆိုင်ရှင်ကို " device reset" လုပ်ပေးရန် တောင်းဆိုပါ။',
    unit_h: 'နာရီ', unit_m: 'မိနစ်', days: 'ရက်',
    overnight: '(နောက်တစ်ရက်)',
    monthLabel: (y, m) => `${y} / ${String(m).padStart(2, '0')}`,
    emptyMonth: 'ဤလအတွက် မှတ်တမ်း မရှိပါ။'
  }
};

// ==========================================
// 상태
// ==========================================
const TOKEN = decodeURIComponent(location.pathname.split('/alba/')[1] || '').replace(/\/$/, '');
let lang = localStorage.getItem('albaLang') || 'ko';
let staffName = '';
let records = [];
let viewMonth = kstToday().slice(0, 7); // "YYYY-MM" - 요약/내역 조회 기준 월

function t(key) { return I18N[lang][key]; }

// 이 휴대폰 고유 식별자 (기기 잠금용) - 최초 접속 시 생성해 저장
function getDeviceId() {
  let id = localStorage.getItem('albaDeviceId');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem('albaDeviceId', id);
  }
  return id;
}

// 모든 알바 API 호출에 기기 ID 헤더 자동 첨부
function albaFetch(url, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, { 'X-Device-Id': getDeviceId() });
  return fetch(url, opts);
}

// ==========================================
// 초기화
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.lang = lang;
  buildTimeOptions();
  // 언어 버튼
  document.querySelectorAll('.lang-switch button').forEach(b => {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });
  // 오늘 날짜 기본값 (KST) + 요일별 기본 출퇴근 시간
  document.getElementById('fDate').value = kstToday();
  applyDefaultTimes(kstToday());
  // 날짜 변경 시 기본 시간 자동 세팅 (수정 중이 아닐 때만)
  document.getElementById('fDate').addEventListener('change', (e) => {
    if (!document.getElementById('editId').value) applyDefaultTimes(e.target.value);
  });
  loadData();
});

function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().split('T')[0];
}

function setLang(l) {
  lang = l;
  localStorage.setItem('albaLang', l);
  document.documentElement.lang = l;
  applyLang();
}

function applyLang() {
  document.querySelectorAll('.lang-switch button').forEach(b =>
    b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('[data-t]').forEach(el => {
    el.textContent = t(el.dataset.t);
  });
  document.getElementById('greetText').textContent = I18N[lang].greet(staffName);
  const editing = document.getElementById('editId').value;
  document.getElementById('saveBtn').textContent = editing ? t('saveEdit') : t('save');
  document.getElementById('cancelBtn').textContent = t('cancel');
  updateMonthLabel();
  renderList();
  renderStats();
}

// 선택한 월(viewMonth)에 해당하는 기록만
function monthRecords() {
  return records.filter(r => (r.date || '').startsWith(viewMonth));
}

function updateMonthLabel() {
  const [y, m] = viewMonth.split('-').map(Number);
  const el = document.getElementById('monthLabel');
  if (el) el.textContent = I18N[lang].monthLabel(y, m);
}

function changeViewMonth(delta) {
  const [y, m] = viewMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  viewMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  updateMonthLabel();
  renderList();
  renderStats();
}

// ==========================================
// 시간 옵션 (10분 단위)
// ==========================================
function buildTimeOptions() {
  const hSel = ['fStartH', 'fEndH'].map(id => document.getElementById(id));
  const mSel = ['fStartM', 'fEndM'].map(id => document.getElementById(id));
  for (let h = 0; h < 24; h++) {
    const v = String(h).padStart(2, '0');
    hSel.forEach(s => s.add(new Option(v, v)));
  }
  for (let m = 0; m < 60; m += 10) {
    const v = String(m).padStart(2, '0');
    mSel.forEach(s => s.add(new Option(v, v)));
  }
}

// 선택한 날짜의 요일/월에 따라 기본 출퇴근 시간 세팅
// 평일(월~금): 16:00~22:00
// 주말(토·일): 14:00~20:00, 단 7·8월(무더위)은 15:00~21:00
function applyDefaultTimes(dateStr) {
  if (!dateStr) return;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0=일, 6=토
  const weekend = (dow === 0 || dow === 6);
  const summer = (m === 7 || m === 8);        // 7·8월 무더위
  let startH = '16', endH = '22';             // 평일 기본
  if (weekend) {
    startH = summer ? '15' : '14';
    endH = summer ? '21' : '20';
  }
  document.getElementById('fStartH').value = startH;
  document.getElementById('fStartM').value = '00';
  document.getElementById('fEndH').value = endH;
  document.getElementById('fEndM').value = '00';
}

// ==========================================
// 데이터 로드
// ==========================================
async function loadData() {
  try {
    const res = await albaFetch(`/api/alba/${encodeURIComponent(TOKEN)}`);
    if (res.status === 403) return showBlocked('deviceLocked');
    if (!res.ok) throw new Error('invalid');
    const json = await res.json();
    staffName = json.name;
    records = json.records || [];
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    applyLang();
  } catch (e) {
    showBlocked('invalidLink');
  }
}

// 접속 차단 화면 (잘못된 링크 / 다른 기기) - 3개국어 동시 표기
function showBlocked(msgKey) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
  const ep = document.getElementById('errorPage');
  ep.classList.remove('hidden');
  ep.querySelector('.big').textContent = msgKey === 'deviceLocked' ? '📱' : '🔒';
  // 차단 화면에는 언어 토글이 없으므로 한/영/미얀마어를 모두 표시
  const order = ['ko', 'en', 'my'];
  ep.querySelector('#blockMsg').innerHTML = order.map((l, i) => {
    const txt = escapeHtml(I18N[l][msgKey]).replace(/\n/g, '<br>');
    const style = i === 0
      ? 'font-size:15px; color:#495057; font-weight:700;'
      : 'font-size:13px; color:#adb5bd;';
    return `<div style="${style} margin-bottom:16px;">${txt}</div>`;
  }).join('<hr style="border:none; border-top:1px solid #eef0f2; margin:0 0 16px;">');
}

// ==========================================
// 저장 / 수정
// ==========================================
let saving = false; // 저장 진행 중 플래그 (중복 제출 방지)
async function saveRecord() {
  if (saving) return; // 저장이 느려 두 번 눌러도 요청은 한 번만
  const date = document.getElementById('fDate').value;
  if (!date) return toast(t('needDate'));
  const start = document.getElementById('fStartH').value + ':' + document.getElementById('fStartM').value;
  const end = document.getElementById('fEndH').value + ':' + document.getElementById('fEndM').value;
  const note = document.getElementById('fNote').value.trim();
  const editId = document.getElementById('editId').value;

  const btn = document.getElementById('saveBtn');
  saving = true;
  btn.disabled = true;
  btn.textContent = t('saving');
  try {
    const url = editId
      ? `/api/alba/${encodeURIComponent(TOKEN)}/record/${editId}`
      : `/api/alba/${encodeURIComponent(TOKEN)}/record`;
    const res = await albaFetch(url, {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, start, end, note })
    });
    if (res.status === 403) { btn.disabled = false; return showBlocked('deviceLocked'); }
    // 하루 중복 입력 차단 (같은 날짜에 이미 기록 있음)
    if (res.status === 409) { toast(t('dupDate')); return; }
    if (!res.ok) throw new Error('fail');
    toast(editId ? t('updated') : t('saved'));
    viewMonth = date.slice(0, 7); // 방금 입력/수정한 기록의 달로 이동
    cancelEdit();
    await loadData();
  } catch (e) {
    toast(t('failed'));
  } finally {
    saving = false;
    btn.disabled = false;
    btn.textContent = document.getElementById('editId').value ? t('saveEdit') : t('save');
  }
}

function startEdit(id) {
  const r = records.find(x => x.id == id);
  if (!r) return;
  document.getElementById('editId').value = r.id;
  document.getElementById('fDate').value = r.date;
  const [sh, sm] = r.start.split(':');
  const [eh, em] = r.end.split(':');
  document.getElementById('fStartH').value = sh;
  document.getElementById('fStartM').value = sm;
  document.getElementById('fEndH').value = eh;
  document.getElementById('fEndM').value = em;
  document.getElementById('fNote').value = r.note || '';
  document.getElementById('saveBtn').textContent = t('saveEdit');
  document.getElementById('cancelBtn').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  document.getElementById('editId').value = '';
  document.getElementById('fNote').value = '';
  document.getElementById('saveBtn').textContent = t('save');
  document.getElementById('cancelBtn').classList.add('hidden');
}

async function delRecord(id) {
  if (!confirm(t('confirmDel'))) return;
  try {
    const res = await albaFetch(`/api/alba/${encodeURIComponent(TOKEN)}/record/${id}`, { method: 'DELETE' });
    if (res.status === 403) return showBlocked('deviceLocked');
    if (!res.ok) throw new Error('fail');
    toast(t('deleted'));
    if (document.getElementById('editId').value == id) cancelEdit();
    await loadData();
  } catch (e) {
    toast(t('failed'));
  }
}

// ==========================================
// 렌더링
// ==========================================
function fmtDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  let s = '';
  if (h > 0) s += `${h}${t('unit_h')} `;
  if (m > 0 || h === 0) s += `${m}${t('unit_m')}`;
  return s.trim();
}

function renderStats() {
  const recs = monthRecords();
  const days = recs.length;
  const total = recs.reduce((s, r) => s + (r.minutes || 0), 0);
  const avg = days > 0 ? Math.round(total / days) : 0;
  document.getElementById('stTotal').textContent = days > 0 ? fmtDur(total) : '-';
  document.getElementById('stDays').textContent = `${days}${t('days')}`;
  document.getElementById('stAvg').textContent = days > 0 ? fmtDur(avg) : '-';
}

function renderList() {
  const box = document.getElementById('recList');
  const recs = monthRecords();
  if (!recs.length) {
    box.innerHTML = `<div class="empty">${records.length ? t('emptyMonth') : t('empty')}</div>`;
    return;
  }
  const sorted = [...recs].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  box.innerHTML = sorted.map(r => {
    // 자정 넘김 표시
    const overnight = (parseInt(r.end.replace(':', ''), 10) <= parseInt(r.start.replace(':', ''), 10))
      ? ` <span style="color:#adb5bd;font-size:12px;">${t('overnight')}</span>` : '';
    const note = r.note ? `<div class="rec-note">📝 ${escapeHtml(r.note)}</div>` : '';
    return `
      <div class="rec">
        <div class="rec-top">
          <div>
            <div class="rec-date">${r.date}</div>
            <div class="rec-time">${r.start} ~ ${r.end}${overnight}</div>
            <div class="rec-dur">${fmtDur(r.minutes || 0)}</div>
            ${note}
          </div>
          <div class="rec-actions">
            <button class="edit-b" onclick="startEdit(${r.id})">${t('edit')}</button>
            <button class="del-b" onclick="delRecord(${r.id})">${t('del')}</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==========================================
// 토스트
// ==========================================
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}
