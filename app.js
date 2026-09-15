const STATUS_LABELS = {
  present: "출석",
  late: "지각·늦참",
  contact_absent: "사전 연락 불참",
  unexcused_absent: "무단 결석",
};
const STATUS_OPTIONS = [
  ["pending", "미입력"],
  ["present", "출석"],
  ["late", "지각·늦참"],
  ["contact_absent", "사전 연락 불참"],
  ["unexcused_absent", "무단 결석"],
];
const EVENT_TYPES = {
  official: { label: "공식 출사 / 행사", units: 1 },
  photo: { label: "사진 번개", units: 0.5 },
};
const MEMBER_DEPARTMENTS = ["총괄", "정보", "홍보", "총무", "출결"];
const FINES = { present: 0, late: 2000, contact_absent: 3000, unexcused_absent: 5000 };

let state = null;
let sync = null;
let currentView = "dashboard";
let selectedMonth = new Date().toISOString().slice(0, 7);
let selectedEventId = "";
let noticeTimer = null;
let readOnlyMode = false;
let memberSearch = "";

const PUBLIC_STATE_URL = "./public/data/public-state.json";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const money = (value) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
const percent = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const initials = (name) => String(name || "회원").slice(0, 1);
const formatDate = (value) => value ? value.replaceAll("-", ".") : "-";
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
function randomMemberId(role = "일반 회원") {
  const token = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()
    : Math.random().toString(36).slice(2, 10).toUpperCase();
  const prefix = role === "운영진" ? "O" : "M";
  const id = `${prefix}-${token}`;
  return state.members.some((member) => member.id === id) ? randomMemberId(role) : id;
}

function memberLabel(member) {
  const role = member?.note || "일반 회원";
  return [role, member?.department, member?.cohort ? `${member.cohort}기` : ""].filter(Boolean).join(" · ");
}

function normalizeCohort(value) {
  return String(value || "").trim().replace(/\s*기$/, "");
}

function updateMemberDepartmentField() {
  const role = $("#member-note");
  const wrap = $("#member-department-wrap");
  const field = $("#member-department");
  if (!role || !wrap || !field) return;
  const isOperator = role.value === "운영진";
  wrap.hidden = !isOperator;
  field.required = isOperator;
  if (!isOperator) field.value = "";
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

async function loadState() {
  const usePublicSnapshot = !LOCAL_HOSTS.has(window.location.hostname);
  if (usePublicSnapshot) {
    const response = await fetch(PUBLIC_STATE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("공개 데이터를 불러오지 못했습니다.");
    state = await response.json();
    sync = { status: "공개 확인 전용", updatedAt: state.generatedAt };
    readOnlyMode = true;
  } else {
    try {
      const data = await api("/api/state");
      state = data.state;
      sync = data.sync;
      readOnlyMode = false;
    } catch (error) {
      const response = await fetch(PUBLIC_STATE_URL, { cache: "no-store" });
      if (!response.ok) throw error;
      state = await response.json();
      sync = { status: "공개 확인 전용", updatedAt: state.generatedAt };
      readOnlyMode = true;
    }
  }
  if (!selectedEventId || !state.events.some((event) => event.id === selectedEventId)) {
    selectedEventId = [...state.events].sort(sortEvents)[0]?.id || "";
  }
  updateSync();
  render();
}

async function saveState(message = "저장했습니다.") {
  if (readOnlyMode) throw new Error("공개 페이지에서는 수정할 수 없습니다.");
  const data = await api("/api/state", { method: "POST", body: JSON.stringify(state) });
  state = data.state;
  sync = data.sync;
  updateSync();
  render();
  showNotice(message);
}

function showNotice(message, error = false) {
  const el = $("#notice");
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle("error", error);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function updateSync() {
  const el = $("#sync-time");
  if (!el || !sync) return;
  const card = $(".sync-card");
  if (readOnlyMode) {
    $(".sync-card-head strong", card).textContent = "공개 확인 전용";
    $(".sync-card p", card).textContent = "관리자에서 갱신한 공개 데이터를 표시합니다.";
    $(".sync-card code", card).textContent = "public/data/public-state.json";
    el.textContent = sync.updatedAt ? `공개 데이터 ${sync.updatedAt.replace("T", " ")}` : "공개 데이터 준비 전";
    return;
  }
  $(".sync-card-head strong", card).textContent = "엑셀 자동 연동";
  $(".sync-card p", card).textContent = "저장할 때마다 엑셀·CSV 파일을 갱신합니다.";
  $(".sync-card code", card).textContent = "data/attendance.xlsx";
  el.textContent = sync.updatedAt ? `최근 저장 ${sync.updatedAt.replace("T", " ")}` : "아직 저장 전";
}

function sortEvents(a, b) {
  return `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`);
}

function getEvent(id) { return state.events.find((event) => event.id === id); }
function getMember(id) { return state.members.find((member) => member.id === id); }
function getRecord(eventId, memberId) { return state.records.find((record) => record.eventId === eventId && record.memberId === memberId); }
function eventUnits(event, status) { return ["present", "late"].includes(status) ? Number(EVENT_TYPES[event?.type || "official"].units) : 0; }
function isRegularEvent(event) { return event?.type === "official"; }
function fine(status) { return Number(FINES[status] || 0); }

function cumulativeAttendance(memberId, throughDate, month, overrideEventId = "", overrideStatus = undefined) {
  let monthUnits = 0;
  let allUnits = 0;
  state.events.forEach((event) => {
    if (event.date > throughDate) return;
    const record = getRecord(event.id, memberId);
    let status = record?.status || "pending";
    if (event.id === overrideEventId) status = overrideStatus || "pending";
    const units = eventUnits(event, status);
    allUnits += units;
    if (event.date.slice(0, 7) === month) monthUnits += units;
  });
  return { month: monthUnits, all: allUnits };
}

function allMonths() {
  const months = new Set(state.events.map((event) => event.date.slice(0, 7)));
  months.add(new Date().toISOString().slice(0, 7));
  return [...months].sort().reverse();
}

function memberStats(memberId, month = selectedMonth) {
  const events = state.events.filter((event) => event.date.slice(0, 7) === month);
  const regularEvents = events.filter(isRegularEvent);
  const records = new Map(state.records.filter((record) => record.memberId === memberId).map((record) => [record.eventId, record]));
  let units = 0;
  let regularUnits = 0;
  let fineWon = 0;
  let missing = 0;
  events.forEach((event) => {
    const record = records.get(event.id);
    if (!record) missing += 1;
    if (record) {
      units += eventUnits(event, record.status);
      if (isRegularEvent(event)) regularUnits += eventUnits(event, record.status);
      fineWon += fine(record.status);
    }
  });
  const allEvents = state.events.filter((event) => event.date <= `${month}-31`);
  let allUnits = 0;
  let allFine = 0;
  allEvents.forEach((event) => {
    const record = records.get(event.id);
    if (record) {
      allUnits += eventUnits(event, record.status);
      allFine += fine(record.status);
    }
  });
  const monthlyRate = regularEvents.length ? regularUnits / regularEvents.length : 0;
  const allRate = allEvents.length ? allUnits / allEvents.length : 0;
  const monthlyPass = regularEvents.length > 0 && monthlyRate >= 0.5 && allRate >= 0.5;
  const activeMonths = allMonths().filter((item) => item <= month && state.events.some((event) => event.date.slice(0, 7) === item)).sort();
  const underMonths = activeMonths.filter((item) => {
    const stats = memberStatsWithoutMonth(memberId, item);
    return !stats.monthlyPass;
  }).length;
  return { events: events.length, regularEvents: regularEvents.length, units, regularUnits, monthlyRate, allEvents: allEvents.length, allUnits, allRate, monthlyPass, missing, fineWon, allFine, underMonths, warningCount: Math.max(0, underMonths - 1) };
}

function memberStatsWithoutMonth(memberId, month) {
  const previousMonth = selectedMonth;
  selectedMonth = month;
  const result = memberStatsBase(memberId, month);
  selectedMonth = previousMonth;
  return result;
}

function memberStatsBase(memberId, month) {
  const events = state.events.filter((event) => event.date.slice(0, 7) === month);
  const regularEvents = events.filter(isRegularEvent);
  const records = new Map(state.records.filter((record) => record.memberId === memberId).map((record) => [record.eventId, record]));
  let regularUnits = 0;
  regularEvents.forEach((event) => { const record = records.get(event.id); if (record) regularUnits += eventUnits(event, record.status); });
  const allEvents = state.events.filter((event) => event.date <= `${month}-31`);
  let allUnits = 0;
  allEvents.forEach((event) => { const record = records.get(event.id); if (record) allUnits += eventUnits(event, record.status); });
  const monthlyRate = regularEvents.length ? regularUnits / regularEvents.length : 0;
  const allRate = allEvents.length ? allUnits / allEvents.length : 0;
  return { monthlyPass: regularEvents.length > 0 && monthlyRate >= 0.5 && allRate >= 0.5 };
}

function statusBadge(stats) {
  if (stats.missing > 0) return `<span class="badge neutral">미입력 ${stats.missing}</span>`;
  return stats.monthlyPass ? `<span class="badge good">기준 충족</span>` : `<span class="badge warn">기준 미달</span>`;
}

function render() {
  if (!state) return;
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === currentView));
  const titles = {
    dashboard: ["대시보드", "출결 현황과 규정 충족 여부를 한눈에 확인하세요."],
    rules: ["출결 규정", "첨부된 회칙 기준을 프로그램 계산에 그대로 반영합니다."],
  };
  $("#page-title").textContent = titles[currentView][0];
  $("#page-subtitle").textContent = titles[currentView][1];
  const views = { dashboard: renderDashboard, rules: renderRules };
  $("#app-view").innerHTML = views[currentView]();
  if (currentView === "members") updateMemberDepartmentField();
  if (currentView === "records") {
    const filePanel = $$("#app-view .panel").slice(-1)[0];
    const fileLinks = filePanel && $(".header-control", filePanel);
    if (fileLinks) fileLinks.insertAdjacentHTML("afterbegin", '<a class="button button-primary button-small" href="/api/export/xlsx">엑셀 다운로드</a>');
    const fileNote = filePanel && $(".formula-box", filePanel);
    if (fileNote) fileNote.innerHTML = '<strong>자동 연동 경로</strong><br>엑셀 통합 파일: <code>data/attendance.xlsx</code><br>상세 기록: <code>data/attendance.csv</code><br>월별 요약: <code>data/attendance_summary.csv</code>';
    const fileDescription = filePanel && $(".panel-desc", filePanel);
    if (fileDescription) fileDescription.textContent = "저장할 때마다 아래 엑셀·CSV 파일이 갱신됩니다.";
  }
}

function renderDashboard() {
  const monthEvents = state.events.filter((event) => event.date.slice(0, 7) === selectedMonth);
  const detailEvents = [...monthEvents].sort((a, b) => (a.type === "photo" ? 1 : 0) - (b.type === "photo" ? 1 : 0) || `${a.date}${a.id}`.localeCompare(`${b.date}${b.id}`));
  let regularIndex = 0;
  const detailRows = detailEvents.map((event) => {
    const month = Number(event.date?.slice(5, 7) || 0);
    const location = event.location || "장소 미등록";
    if (isRegularEvent(event)) {
      regularIndex += 1;
      return `<div><span>${escapeHtml(event.date || "0000-00-00")} ${month}월 ${regularIndex}차 ${escapeHtml(location)} 정기출사</span></div>`;
    }
    return `<div><span>${escapeHtml(event.date || "0000-00-00")} ${month}월 ${escapeHtml(location)} 번개</span></div>`;
  }).join("");
  const stats = state.members.map((member) => ({ member, stats: memberStats(member.id) }));
  const averageRate = stats.length ? stats.reduce((sum, item) => sum + item.stats.monthlyRate, 0) / stats.length : 0;
  const query = memberSearch.trim().toLocaleLowerCase("ko-KR");
  const visibleStats = query ? stats.filter(({ member }) => member.name.toLocaleLowerCase("ko-KR").includes(query)) : stats;
  const recent = [...state.records].sort((a, b) => {
    const eventA = getEvent(a.eventId);
    const eventB = getEvent(b.eventId);
    return `${eventB?.date || ""}${b.recordedAt || ""}`.localeCompare(`${eventA?.date || ""}${a.recordedAt || ""}`);
  }).slice(0, 6);
  const activityKings = [...stats].sort((a, b) => b.stats.monthlyRate - a.stats.monthlyRate || b.stats.regularUnits - a.stats.regularUnits || a.member.name.localeCompare(b.member.name, "ko")).slice(0, 10);
  return `<div class="view-stack">
    <div class="kpi-grid kpi-grid-single">
      <details class="kpi-card kpi-details"><summary><span class="kpi-summary-content"><span class="kpi-label">21기 행사</span><strong class="kpi-value">${monthEvents.length}<small>회</small></strong><span class="kpi-foot">${escapeHtml(selectedMonth)} 등록 행사</span></span><span class="kpi-toggle">세부기록</span></summary><div class="kpi-detail-list">${detailRows || `<div><span>등록된 행사가 없습니다.</span></div>`}</div></details>
    </div>
    <div class="dashboard-grid dashboard-grid-top">
      <section class="panel">
        <div class="panel-header"><div><h2 class="panel-title">회원별 기준 현황</h2><p class="panel-desc">누적 출석과 참여율을 함께 확인합니다. 월 참여율은 정기출사 기준이며, 월별·전체 참여율이 모두 50% 이상이어야 기준을 충족합니다.</p></div><div class="header-control dashboard-filters"><label class="filter-field"><span class="subtle">기준월</span><select id="dashboard-month" class="select compact">${monthOptions()}</select></label><label class="filter-field"><span class="subtle">회원 검색</span><input id="member-search" class="input compact" type="search" placeholder="이름 입력" value="${escapeHtml(memberSearch)}"></label></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>회원</th><th>이달의 누적 출석</th><th>전체 누적 출석</th><th>월 참여율</th><th>전체 참여율</th><th>판정</th><th>경고</th><th>월 벌금</th></tr></thead><tbody>${visibleStats.length ? visibleStats.map(({ member, stats: item }) => `<tr><td class="primary-cell"><span class="avatar">${escapeHtml(initials(member.name))}</span>${escapeHtml(member.name)}<br><small class="subtle">${escapeHtml(memberLabel(member))}</small></td><td class="number-cell">${item.units}회</td><td class="number-cell">${item.allUnits}회</td><td class="number-cell">${percent(item.monthlyRate)}</td><td class="number-cell">${percent(item.allRate)}</td><td>${statusBadge(item)}</td><td>${item.warningCount ? `<span class="badge bad">누적 ${item.warningCount}회</span>` : `<span class="subtle">없음</span>`}</td><td class="number-cell">${money(item.fineWon)}</td></tr>`).join("") : `<tr><td colspan="8" class="empty">검색 결과가 없습니다.</td></tr>`}</tbody></table></div>
      </section>
    </div>
    <section class="panel"><div class="panel-header"><div><h2 class="panel-title">최근 출결 기록</h2><p class="panel-desc">가장 최근 행사부터 표시합니다.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>행사일</th><th>행사</th><th>회원</th><th>상태</th><th>벌금</th></tr></thead><tbody>${recent.length ? recent.map((record) => { const event = getEvent(record.eventId); const member = getMember(record.memberId); return `<tr><td>${formatDate(event?.date)}</td><td class="primary-cell">${escapeHtml(event?.name)}</td><td>${escapeHtml(member?.name)}</td><td>${recordBadge(record.status)}</td><td class="number-cell">${money(fine(record.status))}</td></tr>`; }).join("") : `<tr><td colspan="5" class="empty">아직 출결 기록이 없습니다.</td></tr>`}</tbody></table></div></section>
    <section class="panel"><div class="panel-header"><div><h2 class="panel-title">이달의 활동왕</h2><p class="panel-desc">정기출사 참여율이 높은 회원 TOP10</p></div></div><div class="table-wrap"><table class="data-table activity-table"><thead><tr><th>순위</th><th>회원</th><th>정기출사 참여율</th><th>출석</th></tr></thead><tbody>${activityKings.length ? activityKings.map(({ member, stats: item }, index) => `<tr><td class="number-cell">${index + 1}</td><td class="primary-cell"><span class="avatar">${escapeHtml(initials(member.name))}</span>${escapeHtml(member.name)}<br><small class="subtle">${escapeHtml(memberLabel(member))}</small></td><td class="number-cell">${percent(item.monthlyRate)}</td><td class="number-cell">${item.regularUnits}회</td></tr>`).join("") : `<tr><td colspan="4" class="empty">표시할 회원이 없습니다.</td></tr>`}</tbody></table></div></section>
    <section class="panel"><div class="panel-header"><div><h2 class="panel-title">이번달 참여율</h2><p class="panel-desc">정기출사 기준 회원별 참여율 평균</p></div><span class="badge ${averageRate >= .5 ? "good" : "warn"}">${percent(averageRate)}</span></div><div class="progress-area"><div class="progress-row"><div class="progress-meta"><span>정기출사 참여율 평균</span><strong>${percent(averageRate)}</strong></div><div class="progress-track"><div class="progress-fill ${averageRate >= .5 ? "green" : "orange"}" style="width:${Math.min(100, averageRate * 100)}%"></div></div></div><div class="progress-row"><div class="progress-meta"><span>기준선</span><strong>50%</strong></div><div class="progress-track"><div class="progress-fill" style="width:50%"></div></div></div></div></section>
  </div>`;
}

function monthOptions() { return allMonths().map((month) => `<option value="${month}" ${month === selectedMonth ? "selected" : ""}>${month}</option>`).join(""); }
function recordBadge(status) { const tone = status === "present" ? "good" : status === "late" ? "warn" : "bad"; return `<span class="badge ${tone}">${escapeHtml(STATUS_LABELS[status] || "미입력")}</span>`; }

function renderRecords() {
  const event = getEvent(selectedEventId);
  const records = new Map(state.records.filter((record) => record.eventId === selectedEventId).map((record) => [record.memberId, record]));
  const month = event?.date.slice(0, 7) || selectedMonth;
  const memberRows = event ? state.members.filter((member) => member.active !== false).sort((a, b) => a.name.localeCompare(b.name, "ko")).map((member) => {
    const record = records.get(member.id);
    const status = record?.status || "pending";
    const totals = cumulativeAttendance(member.id, event.date, month, event.id, status);
    const attendanceTime = record?.attendanceTime || record?.checkInTime || "";
    return `<tr class="attendance-row" data-member-id="${member.id}"><td class="primary-cell"><span class="avatar">${escapeHtml(initials(member.name))}</span>${escapeHtml(member.name)}<br><small class="subtle">${escapeHtml(memberLabel(member))}</small></td><td><select class="select compact status-select" data-field="status">${STATUS_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === status ? "selected" : ""}>${label}</option>`).join("")}</select></td><td><input class="input compact attendance-time-input" data-field="attendanceTime" type="time" value="${escapeHtml(attendanceTime)}"></td><td class="number-cell month-attendance-cell">${totals.month}회</td><td class="number-cell all-attendance-cell">${totals.all}회</td><td class="fine-cell">${status === "pending" ? "-" : `<span class="${fine(status) ? "fine-text" : "fine-zero"}">${money(fine(status))}</span>`}</td><td><input class="input note-input" data-field="note" placeholder="선택 입력" value="${escapeHtml(record?.note || "")}"></td></tr>`;
  }).join("") : "";
  return `<div class="view-stack"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">행사별 출결 입력</h2><p class="panel-desc">한 번에 한 행사의 회원별 상태를 입력합니다. 출석 시간은 오후 2시 기준으로 지각 여부를 자동 판정합니다.</p></div><button class="button button-primary" data-action="save-attendance" ${event ? "" : "disabled"}>출결 저장</button></div><div class="toolbar"><div class="toolbar-left"><div class="field"><label class="label" for="event-select">행사 선택</label><select id="event-select" class="select">${[...state.events].sort(sortEvents).map((item) => `<option value="${item.id}" ${item.id === selectedEventId ? "selected" : ""}>${formatDate(item.date)} · ${escapeHtml(item.name)}</option>`).join("")}</select></div></div><div class="record-toolbar-note">${event ? `${escapeHtml(event.name)} · ${EVENT_TYPES[event.type].label} · 행사 기준 단위 ${EVENT_TYPES[event.type].units}회` : "행사를 먼저 등록하세요."}</div></div>${event ? `<div class="table-wrap"><table class="data-table attendance-table"><thead><tr><th>회원</th><th>상태</th><th>출석 시간</th><th>이달의 누적 출석</th><th>전체 누적 출석</th><th>벌금</th><th>메모</th></tr></thead><tbody>${memberRows}</tbody></table></div>` : `<div class="empty">행사 관리에서 첫 행사를 등록하세요.</div>`}</section><section class="panel"><div class="panel-header"><div><h2 class="panel-title">출결 기록 파일</h2><p class="panel-desc">저장할 때마다 아래 엑셀·CSV 파일이 갱신됩니다.</p></div><div class="header-control"><a class="button button-ghost button-small" href="/api/export/attendance">기록 CSV 다운로드</a><a class="button button-ghost button-small" href="/api/export/summary">요약 CSV 다운로드</a></div></div><div class="formula-box"><strong>자동 연동 경로</strong><br>상세 기록: <code>data/attendance.csv</code><br>월별 요약: <code>data/attendance_summary.csv</code></div></section></div>`;
}

function renderMembers() {
  return `<div class="split-layout"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">회원 등록</h2><p class="panel-desc">회원 ID는 저장할 때 자동 생성됩니다. 모든 회원의 기수를 입력하고, 운영진은 부서를 추가로 선택합니다. 정보 부서는 최대 2명입니다.</p></div></div><form id="member-form"><div class="field-grid"><div class="field full"><label class="label" for="member-name">이름</label><input class="input" id="member-name" name="name" placeholder="예: 홍길동" required></div><div class="field full"><label class="label" for="member-cohort">기수</label><input class="input" id="member-cohort" name="cohort" placeholder="예: 3" inputmode="numeric"></div><div class="field full"><label class="label" for="member-note">비고</label><select class="select" id="member-note" name="note"><option value="일반 회원" selected>일반 회원</option><option value="운영진">운영진</option></select></div><div class="field full" id="member-department-wrap" hidden><label class="label" for="member-department">운영진 부서</label><select class="select" id="member-department" name="department"><option value="">부서 선택</option>${MEMBER_DEPARTMENTS.map((department) => `<option value="${department}">${department}</option>`).join("")}</select></div></div><div class="form-actions"><button class="button button-primary">회원 추가</button></div></form></section><section class="panel"><div class="panel-header"><div><h2 class="panel-title">회원 목록 <span class="subtle">${state.members.length}명</span></h2><p class="panel-desc">회원 ID는 중복되지 않는 난수로 표시됩니다.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>회원</th><th>회원 ID</th><th>기수</th><th>비고</th><th>부서</th><th>누적 벌금</th><th></th></tr></thead><tbody>${state.members.length ? state.members.map((member) => { const totalFine = state.records.filter((record) => record.memberId === member.id).reduce((sum, record) => sum + fine(record.status), 0); return `<tr><td class="primary-cell"><span class="avatar">${escapeHtml(initials(member.name))}</span>${escapeHtml(member.name)}</td><td><code>${escapeHtml(member.id)}</code></td><td>${escapeHtml(member.cohort ? `${member.cohort}기` : "-")}</td><td><span class="badge ${member.note === "운영진" ? "blue" : "neutral"}">${escapeHtml(member.note || "일반 회원")}</span></td><td>${escapeHtml(member.department || "-")}</td><td class="number-cell">${money(totalFine)}</td><td><button class="button button-danger button-small" data-action="delete-member" data-id="${member.id}">삭제</button></td></tr>`; }).join("") : `<tr><td colspan="7" class="empty">등록된 회원이 없습니다.</td></tr>`}</tbody></table></div></section></div>`;
}

function renderEvents() {
  const events = [...state.events].sort(sortEvents);
  return `<div class="split-layout"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">행사 등록</h2><p class="panel-desc">공식 행사와 사진 번개의 출석 가중치를 자동으로 적용합니다.</p></div></div><form id="event-form"><div class="field-grid"><div class="field"><label class="label" for="event-date">행사일</label><input class="input" id="event-date" name="date" type="date" required></div><div class="field"><label class="label" for="event-time">기준 시각</label><input class="input" id="event-time" name="startTime" type="time" value="14:00" required></div><div class="field full"><label class="label" for="event-name">행사명</label><input class="input" id="event-name" name="name" placeholder="예: 가을 정기 출사" required></div><div class="field"><label class="label" for="event-type">행사 유형</label><select class="select" id="event-type" name="type"><option value="official">공식 출사 / 행사 · 1회</option><option value="photo">사진 번개 · 0.5회</option></select></div><div class="field"><label class="label" for="event-location">장소</label><input class="input" id="event-location" name="location" placeholder="예: 서울숲"></div><div class="field full"><label class="label" for="event-note">메모</label><textarea class="textarea" id="event-note" name="note" placeholder="행사 관련 메모"></textarea></div></div><div class="form-actions"><button class="button button-primary">행사 추가</button></div></form></section><section class="panel"><div class="panel-header"><div><h2 class="panel-title">행사 목록 <span class="subtle">${events.length}개</span></h2><p class="panel-desc">행사별 입력 현황을 확인할 수 있습니다.</p></div></div><div class="event-list">${events.length ? events.map((event) => { const recordCount = state.records.filter((record) => record.eventId === event.id).length; return `<div class="event-option"><div class="event-option-meta"><strong>${formatDate(event.date)} · ${escapeHtml(event.name)}</strong><span class="subtle">${recordCount}/${state.members.length}</span></div><span>${escapeHtml(event.location || "장소 미등록")} · ${EVENT_TYPES[event.type].label}</span><br><span class="badge blue">출석 단위 ${EVENT_TYPES[event.type].units}회</span><button class="button button-danger button-small" style="float:right;margin-top:8px" data-action="delete-event" data-id="${event.id}">삭제</button></div>`; }).join("") : `<div class="empty">등록된 행사가 없습니다.</div>`}</div></section></div>`;
}

function renderRules() {
  return `<div class="rules-grid"><section class="rule-card"><h3>출석 단위</h3><p>행사 유형별 참석 횟수를 자동으로 환산합니다.</p><div class="rule-metric"><span>공식 출사 / 행사</span><strong>1회</strong></div><div class="rule-metric"><span>사진 번개</span><strong>0.5회</strong></div></section><section class="rule-card"><h3>출석률 기준</h3><p>아래 두 조건을 동시에 충족해야 해당 월 기준을 충족합니다.</p><div class="rule-metric"><span>정기출사 대비 참여율</span><strong>50% 이상</strong></div><div class="rule-metric"><span>전체 행사 대비 참여율</span><strong>50% 이상</strong></div><div class="formula-box"><strong>판정</strong><br>정기출사 참여 단위 ÷ 정기출사 수 ≥ 50%<br>그리고 전체 참여 단위 ÷ 전체 행사 수 ≥ 50%</div></section><section class="rule-card"><h3>지각·늦참 및 불참</h3><p>오후 2시를 기준으로 상태와 벌금을 적용합니다.</p><div class="fine-grid"><div class="fine-item"><span>오후 2시까지 참석</span><strong>출석 1회 · 0원</strong></div><div class="fine-item"><span>오후 2시 이후 참석</span><strong>출석 1회 · 2,000원</strong></div><div class="fine-item"><span>사전 연락 후 불참</span><strong>출석 0회 · 3,000원</strong></div><div class="fine-item"><span>사전 연락 없이 불참</span><strong>출석 0회 · 5,000원</strong></div></div></section><section class="rule-card"><h3>출석 경고</h3><p>출석률 기준을 충족하지 못한 월을 누적해 표시합니다.</p><div class="rule-metric"><span>2개월 미달</span><strong>누계 1회</strong></div><div class="rule-metric"><span>3개월 미달</span><strong>누계 2회</strong></div><div class="formula-box"><strong>현재 계산</strong><br>누적 경고 = max(0, 기준 미달 월수 - 1)<br>행사 기록이 없는 월은 미달 월수에서 제외합니다.</div></section></div>`;
}

function saveAttendance() {
  const event = getEvent(selectedEventId);
  if (!event) return;
  $$(".attendance-row").forEach((row) => {
    const memberId = row.dataset.memberId;
    const status = $("[data-field='status']", row).value;
    const attendanceTime = $("[data-field='attendanceTime']", row).value;
    const note = $("[data-field='note']", row).value.trim();
    const existingIndex = state.records.findIndex((record) => record.eventId === event.id && record.memberId === memberId);
    if (status === "pending") {
      if (existingIndex >= 0) state.records.splice(existingIndex, 1);
      return;
    }
    const normalizedStatus = status === "present" && attendanceTime && attendanceTime > "14:00" ? "late" : status;
    const record = { id: existingIndex >= 0 ? state.records[existingIndex].id : uid("R"), eventId: event.id, memberId, status: normalizedStatus, attendanceTime, note, recordedAt: new Date().toISOString() };
    if (existingIndex >= 0) state.records[existingIndex] = record;
    else state.records.push(record);
  });
  saveState("출결 기록을 저장했고 엑셀·CSV 파일을 갱신했습니다.").catch((error) => showNotice(error.message, true));
}

function handleMemberSubmit(form) {
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  const note = String(data.get("note") || "일반 회원").trim();
  const department = String(data.get("department") || "").trim();
  const cohort = normalizeCohort(data.get("cohort"));
  if (note === "운영진" && !MEMBER_DEPARTMENTS.includes(department)) {
    showNotice("운영진 부서를 선택하세요.", true);
    return;
  }
  if (note === "운영진" && department === "정보" && state.members.filter((member) => member.note === "운영진" && member.department === "정보").length >= 2) {
    showNotice("정보 부서는 최대 2명까지 등록할 수 있습니다.", true);
    return;
  }
  const id = randomMemberId(note);
  state.members.push({ id, name, note: note === "운영진" ? "운영진" : "일반 회원", department: note === "운영진" ? department : "", cohort, active: true });
  saveState(`${name} 회원을 추가했습니다. 자동 ID: ${id}`).catch((error) => showNotice(error.message, true));
}

function handleEventSubmit(form) {
  const data = new FormData(form);
  const event = { id: uid("E"), date: String(data.get("date") || ""), name: String(data.get("name") || "").trim(), type: String(data.get("type") || "official"), startTime: String(data.get("startTime") || "14:00"), location: String(data.get("location") || "").trim(), note: String(data.get("note") || "").trim() };
  state.events.push(event);
  selectedEventId = event.id;
  selectedMonth = event.date.slice(0, 7);
  saveState("행사를 추가했습니다.").catch((error) => showNotice(error.message, true));
}

async function deleteMember(id) {
  const member = getMember(id);
  if (!member || !window.confirm(`${member.name} 회원을 삭제할까요? 기존 출결 기록도 함께 삭제됩니다.`)) return;
  state.members = state.members.filter((item) => item.id !== id);
  state.records = state.records.filter((record) => record.memberId !== id);
  try { await saveState("회원을 삭제했습니다."); } catch (error) { showNotice(error.message, true); }
}

async function deleteEvent(id) {
  const event = getEvent(id);
  if (!event || !window.confirm(`${event.name} 행사를 삭제할까요? 행사 출결 기록도 함께 삭제됩니다.`)) return;
  state.events = state.events.filter((item) => item.id !== id);
  state.records = state.records.filter((record) => record.eventId !== id);
  selectedEventId = [...state.events].sort(sortEvents)[0]?.id || "";
  try { await saveState("행사를 삭제했습니다."); } catch (error) { showNotice(error.message, true); }
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) { currentView = nav.dataset.view; render(); return; }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "refresh") loadState().catch((error) => showNotice(error.message, true));
  if (action.dataset.action === "save-attendance") saveAttendance();
  if (action.dataset.action === "delete-member") deleteMember(action.dataset.id);
  if (action.dataset.action === "delete-event") deleteEvent(action.dataset.id);
});

function updateAttendanceRow(row) {
  const event = getEvent(selectedEventId);
  if (!event) return;
  const memberId = row.dataset.memberId;
  const statusSelect = $("[data-field='status']", row);
  const status = statusSelect.value;
  const attendanceTime = $("[data-field='attendanceTime']", row).value;
  if (status === "present" && attendanceTime && attendanceTime > "14:00") {
    statusSelect.value = "late";
  }
  const appliedStatus = statusSelect.value;
  const totals = cumulativeAttendance(memberId, event.date, event.date.slice(0, 7), event.id, appliedStatus);
  $(".month-attendance-cell", row).textContent = `${totals.month}회`;
  $(".all-attendance-cell", row).textContent = `${totals.all}회`;
  $(".fine-cell", row).innerHTML = appliedStatus === "pending" ? "-" : `<span class="${fine(appliedStatus) ? "fine-text" : "fine-zero"}">${money(fine(appliedStatus))}</span>`;
}

document.addEventListener("change", (event) => {
  if (event.target.id === "dashboard-month") { selectedMonth = event.target.value; render(); }
  if (event.target.id === "event-select") { selectedEventId = event.target.value; render(); }
  if (event.target.id === "member-note") updateMemberDepartmentField();
  if (event.target.matches(".status-select, .attendance-time-input")) updateAttendanceRow(event.target.closest(".attendance-row"));
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "member-search") return;
  memberSearch = event.target.value;
  const cursor = event.target.selectionStart;
  render();
  const nextSearch = $("#member-search");
  if (nextSearch) { nextSearch.focus(); nextSearch.setSelectionRange(cursor, cursor); }
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "member-form") handleMemberSubmit(event.target);
  if (event.target.id === "event-form") handleEventSubmit(event.target);
});

loadState().catch((error) => showNotice(error.message, true));
