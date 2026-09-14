const EVENT_TYPES = {
  official: { label: "공식 출사 / 행사", units: 1 },
  photo: { label: "사진 번개", units: 0.5 },
};
const STATUS_LABELS = {
  present: "출석",
  late: "지각·늦참",
  contact_absent: "사전 연락 불참",
  unexcused_absent: "무단 결석",
};
const $ = (selector, parent = document) => parent.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const formatDate = (value) => value ? value.replaceAll("-", ".") : "-";
const percent = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const initials = (name) => String(name || "회원").slice(0, 1);

let state = null;
let selectedMonth = "";
let selectedMember = "all";

function memberLabel(member) {
  const role = member.note || "일반 회원";
  return member.department ? `${role} · ${member.department}` : role;
}

function eventUnits(event, status) {
  return ["present", "late"].includes(status) ? Number(EVENT_TYPES[event?.type || "official"].units) : 0;
}

function recordMap() {
  return new Map(state.records.map((record) => [`${record.eventId}:${record.memberId}`, record]));
}

function memberStats(memberId, month) {
  const records = recordMap();
  const monthEvents = state.events.filter((event) => event.date.slice(0, 7) === month);
  const allEvents = state.events.filter((event) => event.date <= `${month}-31`);
  const unitsFor = (event) => eventUnits(event, records.get(`${event.id}:${memberId}`)?.status || "");
  const monthUnits = monthEvents.reduce((sum, event) => sum + unitsFor(event), 0);
  const allUnits = allEvents.reduce((sum, event) => sum + unitsFor(event), 0);
  const monthlyRate = monthEvents.length ? monthUnits / monthEvents.length : 0;
  const allRate = allEvents.length ? allUnits / allEvents.length : 0;
  return {
    monthUnits,
    allUnits,
    monthlyRate,
    allRate,
    monthlyPass: monthEvents.length > 0 && monthlyRate >= 0.5 && allRate >= 0.5,
  };
}

function availableMonths() {
  const months = new Set(state.events.map((event) => event.date.slice(0, 7)));
  months.add(new Date().toISOString().slice(0, 7));
  return [...months].sort().reverse();
}

function setupFilters() {
  const monthSelect = $("#month-select");
  const memberSelect = $("#member-select");
  const months = availableMonths();
  if (!months.includes(selectedMonth)) selectedMonth = months[0] || new Date().toISOString().slice(0, 7);
  monthSelect.innerHTML = months.map((month) => `<option value="${month}" ${month === selectedMonth ? "selected" : ""}>${month}</option>`).join("");
  memberSelect.innerHTML = `<option value="all">전체 회원</option>${[...state.members].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)}</option>`).join("")}`;
  memberSelect.value = selectedMember;
  monthSelect.onchange = (event) => { selectedMonth = event.target.value; render(); };
  memberSelect.onchange = (event) => { selectedMember = event.target.value; render(); };
}

function renderSummary() {
  const monthEvents = state.events.filter((event) => event.date.slice(0, 7) === selectedMonth);
  const visibleMembers = selectedMember === "all" ? state.members : state.members.filter((member) => member.id === selectedMember);
  const passed = visibleMembers.filter((member) => memberStats(member.id, selectedMonth).monthlyPass).length;
  const attendanceCount = state.records.filter((record) => {
    const event = state.events.find((item) => item.id === record.eventId);
    return event?.date.slice(0, 7) === selectedMonth && ["present", "late"].includes(record.status) && (selectedMember === "all" || record.memberId === selectedMember);
  }).length;
  $("#summary-cards").innerHTML = [
    ["기준월 행사", `${monthEvents.length}회`, "등록된 행사"],
    ["공개 회원", `${visibleMembers.length}명`, selectedMember === "all" ? "전체 회원" : "선택 회원"],
    ["출석 기록", `${attendanceCount}건`, `${selectedMonth} 기준`],
    ["기준 충족", `${passed}명`, "월·전체 참여율 50% 이상"],
  ].map(([label, value, foot]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>${foot}</small></article>`).join("");
}

function renderMembers() {
  const visibleMembers = selectedMember === "all" ? state.members : state.members.filter((member) => member.id === selectedMember);
  const rows = [...visibleMembers].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((member) => {
    const stats = memberStats(member.id, selectedMonth);
    return `<tr><td class="name-cell"><span class="avatar">${escapeHtml(initials(member.name))}</span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(memberLabel(member))}</small></td><td>${stats.monthUnits}회</td><td>${stats.allUnits}회</td><td>${percent(stats.monthlyRate)}</td><td>${percent(stats.allRate)}</td><td><span class="status ${stats.monthlyPass ? "good" : "warn"}">${stats.monthlyPass ? "기준 충족" : "기준 미달"}</span></td></tr>`;
  }).join("");
  $("#member-section").innerHTML = `<div class="panel-header"><div><p class="eyebrow">MEMBERS</p><h2>회원별 출결 현황</h2><p>이달의 누적 출석과 전체 누적 출석을 함께 표시합니다.</p></div></div><div class="table-wrap"><table><thead><tr><th>회원</th><th>${escapeHtml(selectedMonth)} 누적</th><th>전체 누적</th><th>월 참여율</th><th>전체 참여율</th><th>판정</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="empty">표시할 회원 데이터가 없습니다.</td></tr>`}</tbody></table></div>`;
}

function renderEvents() {
  const records = recordMap();
  const monthEvents = [...state.events].filter((event) => event.date.slice(0, 7) === selectedMonth).sort((a, b) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`));
  const visibleEvents = monthEvents;
  const rows = visibleEvents.map((event) => {
    const scopedRecords = state.records.filter((record) => record.eventId === event.id && (selectedMember === "all" || record.memberId === selectedMember));
    const attended = scopedRecords.filter((record) => ["present", "late"].includes(record.status)).length;
    const late = scopedRecords.filter((record) => record.status === "late").length;
    const absent = scopedRecords.filter((record) => ["contact_absent", "unexcused_absent"].includes(record.status)).length;
    return `<tr><td>${formatDate(event.date)}</td><td class="event-cell"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(event.location || "장소 미등록")} · ${EVENT_TYPES[event.type].label}</small></td><td>${attended}명</td><td>${late}명</td><td>${absent}명</td></tr>`;
  }).join("");
  $("#event-section").innerHTML = `<div class="panel-header"><div><p class="eyebrow">EVENTS</p><h2>행사별 출결</h2><p>${escapeHtml(selectedMonth)}에 등록된 행사 현황입니다.</p></div></div><div class="table-wrap"><table><thead><tr><th>행사일</th><th>행사</th><th>출석</th><th>지각·늦참</th><th>불참</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">표시할 행사 데이터가 없습니다.</td></tr>`}</tbody></table></div>`;
}

function render() {
  setupFilters();
  renderSummary();
  renderMembers();
  renderEvents();
}

fetch("./data/public-state.json", { cache: "no-store" })
  .then((response) => { if (!response.ok) throw new Error("공개 데이터를 불러오지 못했습니다."); return response.json(); })
  .then((data) => {
    state = data;
    $("#updated-at").textContent = data.generatedAt ? `마지막 공개 업데이트 ${data.generatedAt.replace("T", " ")}` : "공개 데이터 업데이트 전";
    render();
  })
  .catch((error) => {
    $("#updated-at").textContent = error.message;
    $("#member-section").innerHTML = `<div class="empty-block">공개 데이터를 아직 준비하지 않았습니다.</div>`;
    $("#event-section").innerHTML = "";
  });
