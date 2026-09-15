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
let memberSearch = "";

function memberLabel(member) {
  const role = member.note || "일반 회원";
  return [role, member.department, member.cohort ? `${member.cohort}기` : ""].filter(Boolean).join(" · ");
}

function eventUnits(event, status) {
  return ["present", "late"].includes(status) ? Number(EVENT_TYPES[event?.type || "official"].units) : 0;
}

function isRegularEvent(event) {
  return event?.type === "official";
}

function recordMap() {
  return new Map(state.records.map((record) => [`${record.eventId}:${record.memberId}`, record]));
}

function memberStats(memberId, month) {
  const records = recordMap();
  const monthEvents = state.events.filter((event) => event.date.slice(0, 7) === month);
  const regularEvents = monthEvents.filter(isRegularEvent);
  const allEvents = state.events.filter((event) => event.date <= `${month}-31`);
  const unitsFor = (event) => eventUnits(event, records.get(`${event.id}:${memberId}`)?.status || "");
  const monthUnits = monthEvents.reduce((sum, event) => sum + unitsFor(event), 0);
  const regularUnits = regularEvents.reduce((sum, event) => sum + unitsFor(event), 0);
  const allUnits = allEvents.reduce((sum, event) => sum + unitsFor(event), 0);
  const monthlyRate = regularEvents.length ? regularUnits / regularEvents.length : 0;
  const allRate = allEvents.length ? allUnits / allEvents.length : 0;
  return {
    monthUnits,
    regularUnits,
    allUnits,
    monthlyRate,
    allRate,
    monthlyPass: regularEvents.length > 0 && monthlyRate >= 0.5 && allRate >= 0.5,
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
  const searchInput = $("#member-search");
  const months = availableMonths();
  if (!months.includes(selectedMonth)) selectedMonth = months[0] || new Date().toISOString().slice(0, 7);
  monthSelect.innerHTML = months.map((month) => `<option value="${month}" ${month === selectedMonth ? "selected" : ""}>${month}</option>`).join("");
  memberSelect.innerHTML = `<option value="all">전체 회원</option>${[...state.members].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)}</option>`).join("")}`;
  memberSelect.value = selectedMember;
  searchInput.value = memberSearch;
  monthSelect.onchange = (event) => { selectedMonth = event.target.value; render(); };
  memberSelect.onchange = (event) => { selectedMember = event.target.value; render(); };
  searchInput.oninput = (event) => { memberSearch = event.target.value; renderMembers(); };
}

function renderSummary() {
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
  $("#summary-cards").classList.add("summary-grid-single");
  $("#summary-cards").innerHTML = `<details class="summary-card summary-details"><summary><span class="summary-content"><span>21기 행사</span><strong>${monthEvents.length}회</strong><small>${escapeHtml(selectedMonth)} 등록 행사</small></span><span class="summary-toggle">세부기록</span></summary><div class="summary-detail-list">${detailRows || `<div><span>등록된 행사가 없습니다.</span></div>`}</div></details>`;
}

function renderMembers() {
  const query = memberSearch.trim().toLocaleLowerCase("ko-KR");
  const visibleMembers = state.members.filter((member) => (selectedMember === "all" || member.id === selectedMember) && (!query || member.name.toLocaleLowerCase("ko-KR").includes(query)));
  const rows = [...visibleMembers].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((member) => {
    const stats = memberStats(member.id, selectedMonth);
    return `<tr><td class="name-cell"><span class="avatar">${escapeHtml(initials(member.name))}</span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(memberLabel(member))}</small></td><td>${stats.monthUnits}회</td><td>${stats.allUnits}회</td><td>${percent(stats.monthlyRate)}</td><td>${percent(stats.allRate)}</td><td><span class="status ${stats.monthlyPass ? "good" : "warn"}">${stats.monthlyPass ? "기준 충족" : "기준 미달"}</span></td></tr>`;
  }).join("");
  $("#member-section").innerHTML = `<div class="panel-header"><div><p class="eyebrow">MEMBERS</p><h2>회원별 출결 현황</h2><p>이달의 누적 출석과 전체 누적 출석을 함께 표시합니다.</p></div></div><div class="table-wrap"><table><thead><tr><th>회원</th><th>${escapeHtml(selectedMonth)} 누적</th><th>전체 누적</th><th>월 참여율</th><th>전체 참여율</th><th>판정</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="empty">검색 결과가 없습니다.</td></tr>`}</tbody></table></div>`;
}

function recordStatus(status) {
  const tone = status === "present" ? "good" : status === "late" ? "warn" : "bad";
  return `<span class="status ${tone}">${escapeHtml(STATUS_LABELS[status] || "미입력")}</span>`;
}

function renderRecent() {
  const recent = [...state.records].sort((a, b) => {
    const eventA = state.events.find((event) => event.id === a.eventId);
    const eventB = state.events.find((event) => event.id === b.eventId);
    return `${eventB?.date || ""}${b.recordedAt || ""}`.localeCompare(`${eventA?.date || ""}${a.recordedAt || ""}`);
  }).slice(0, 6);
  const rows = recent.map((record) => {
    const event = state.events.find((item) => item.id === record.eventId);
    const member = state.members.find((item) => item.id === record.memberId);
    return `<tr><td>${formatDate(event?.date)}</td><td class="event-cell"><strong>${escapeHtml(event?.name)}</strong></td><td>${escapeHtml(member?.name)}</td><td>${recordStatus(record.status)}</td></tr>`;
  }).join("");
  $("#recent-section").innerHTML = `<div class="panel-header"><div><p class="eyebrow">RECENT RECORDS</p><h2>최근 출결 기록</h2><p>가장 최근 행사부터 표시합니다.</p></div></div><div class="table-wrap"><table><thead><tr><th>행사일</th><th>행사</th><th>회원</th><th>상태</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">아직 출결 기록이 없습니다.</td></tr>`}</tbody></table></div>`;
}

function renderActivity() {
  const ranking = state.members.map((member) => ({ member, stats: memberStats(member.id, selectedMonth) })).sort((a, b) => b.stats.monthlyRate - a.stats.monthlyRate || b.stats.regularUnits - a.stats.regularUnits || a.member.name.localeCompare(b.member.name, "ko")).slice(0, 10);
  const rows = ranking.map(({ member, stats }, index) => `<tr><td>${index + 1}</td><td class="name-cell"><span class="avatar">${escapeHtml(initials(member.name))}</span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(memberLabel(member))}</small></td><td>${percent(stats.monthlyRate)}</td><td>${stats.regularUnits}회</td></tr>`).join("");
  $("#activity-section").innerHTML = `<div class="panel-header"><div><p class="eyebrow">ACTIVITY KING</p><h2>이달의 활동왕</h2><p>정기출사 참여율이 높은 회원 TOP10</p></div></div><div class="table-wrap"><table><thead><tr><th>순위</th><th>회원</th><th>정기출사 참여율</th><th>출석</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">표시할 회원이 없습니다.</td></tr>`}</tbody></table></div>`;
}

function renderRate() {
  const rates = state.members.map((member) => memberStats(member.id, selectedMonth).monthlyRate);
  const averageRate = rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : 0;
  $("#rate-section").innerHTML = `<div class="panel-header"><div><p class="eyebrow">MONTHLY RATE</p><h2>이번달 참여율</h2><p>정기출사 기준 회원별 참여율 평균</p></div><span class="status ${averageRate >= 0.5 ? "good" : "warn"}">${percent(averageRate)}</span></div><div class="progress-area"><div class="progress-meta"><span>정기출사 참여율 평균</span><strong>${percent(averageRate)}</strong></div><div class="progress-track"><div class="progress-fill ${averageRate >= 0.5 ? "green" : "orange"}" style="width:${Math.min(100, averageRate * 100)}%"></div></div><div class="progress-meta"><span>기준선</span><strong>50%</strong></div><div class="progress-track"><div class="progress-fill" style="width:50%"></div></div></div>`;
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
  renderRecent();
  renderActivity();
  renderRate();
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
