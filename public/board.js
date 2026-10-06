/* Shared by the local manager and the static public page. */
window.AttendanceBoard = (() => {
  let activeTab = "home";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const pct = value => value == null ? "—" : `${Math.round(value * 1000) / 10}%`;
  const today = () => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Seoul"}).format(new Date());
  const assetBase = typeof document !== "undefined" ? new URL(".", document.currentScript.src).href : "/public/";
  const bundledActivityWinners = {
    "2026-09": [
      {name:"김태건", photo:`${assetBase}assets/activity-winners/2026-09/kim-taegeon.png`},
      {name:"나혜영", photo:`${assetBase}assets/activity-winners/2026-09/na-hyeyoung.png`},
    ],
  };
  const posterDays = {3:44.63, 10:49.93, 17:55.48, 24:61.04, 31:66.67};
  function posterCalendar(events, month) {
    const marked = events.filter(e => e.type !== "break" && posterDays[Number(e.date.slice(8))] != null);
    const dates = [...new Set(marked.map(e => e.date))];
    return `<div class="calendar-poster" aria-label="2026년 10월 행사 달력">
      <img src="${assetBase}assets/calendar-2026-10.png" width="1080" height="1350" alt="CAM-I 2026년 10월 달력. 3일, 10일, 24일, 31일 정기출사. 17일 중간고사 휴회.">
      ${dates.map(date => {
        const day = Number(date.slice(8));
        const entries = marked.filter(e => e.date === date);
        const paused = entries.every(e => e.type === "break");
        return `<button type="button" class="calendar-hotspot ${paused?"calendar-break":""}" style="--day-y:${posterDays[day]}%" aria-label="10월 ${day}일 ${esc(entries.map(e=>e.name).join(', '))}" aria-expanded="false" aria-controls="calendar-popup-${day}" data-calendar-day="${day}"><span>${day}</span></button>
          <div id="calendar-popup-${day}" class="calendar-popup" style="--day-y:${posterDays[day]}%" role="dialog" aria-label="10월 ${day}일 행사 안내" hidden>
            <button type="button" class="calendar-popup-close" aria-label="행사 안내 닫기">×</button>
            <span class="calendar-popup-month">2026 OCTOBER</span><div class="calendar-popup-date"><strong>${day}</strong><span>10월 ${day}일 토요일</span></div>
            ${entries.map(e=>`<h3>${esc(e.name)}</h3>`).join("")}
            <p>${paused?"중간고사 기간으로 정기출사를 쉬어갑니다.":"장소와 시간은 행사 공지를 확인해 주세요."}</p>
          </div>`;
      }).join("")}
    </div><p class="calendar-help">날짜 원에 마우스를 올리거나 눌러서 일정을 확인하세요.</p>
    <p class="calendar-break-note">10월 17일 · 중간고사 휴회</p>`;
  }
  // Shared delegated interactions survive month changes and dashboard re-renders.
  if (typeof document !== "undefined") {
    let closeTimer;
    let expandedCard = null;
    let expandedTrigger = null;
    function closePopups() {
      clearTimeout(closeTimer);
      document.querySelectorAll('.calendar-hotspot[aria-expanded="true"]').forEach(button => button.setAttribute("aria-expanded","false"));
      document.querySelectorAll(".calendar-popup").forEach(popup => { popup.hidden = true; });
    }
    function openPopup(button) {
      closePopups();
      button.setAttribute("aria-expanded","true");
      document.getElementById(button.getAttribute("aria-controls")).hidden = false;
    }
    function closeExpandedCard() {
      if (!expandedCard) return;
      expandedCard.classList.remove("is-expanded");
      expandedCard.removeAttribute("role");
      expandedCard.removeAttribute("aria-modal");
      const button = expandedCard.querySelector(".board-expand");
      if (button) {
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", "크게 보기");
        button.setAttribute("title", "크게 보기");
      }
      document.querySelector(".board-expand-backdrop")?.remove();
      document.body.classList.remove("board-modal-open");
      expandedTrigger?.focus();
      expandedCard = null;
      expandedTrigger = null;
    }
    function openExpandedCard(button) {
      closeExpandedCard();
      expandedCard = button.closest(".board-card");
      expandedTrigger = button;
      expandedCard.classList.add("is-expanded");
      expandedCard.setAttribute("role", "dialog");
      expandedCard.setAttribute("aria-modal", "true");
      button.setAttribute("aria-expanded", "true");
      button.setAttribute("aria-label", "닫기");
      button.setAttribute("title", "닫기");
      const backdrop = document.createElement("button");
      backdrop.type = "button";
      backdrop.className = "board-expand-backdrop";
      backdrop.setAttribute("aria-label", "확대 보기 닫기");
      backdrop.addEventListener("click", closeExpandedCard);
      document.body.appendChild(backdrop);
      document.body.classList.add("board-modal-open");
      button.focus();
    }
    document.addEventListener("pointerover", event => {
      if (event.pointerType === "touch") return;
      const button = event.target.closest(".calendar-hotspot");
      if (button) openPopup(button);
      if (event.target.closest(".calendar-popup")) clearTimeout(closeTimer);
    });
    document.addEventListener("pointerout", event => {
      if (!event.target.closest(".calendar-hotspot, .calendar-popup")) return;
      if (event.relatedTarget?.closest?.(".calendar-hotspot, .calendar-popup")) return;
      closeTimer = setTimeout(closePopups, 180);
    });
    document.addEventListener("focusin", event => {
      if (event.target.matches(".calendar-hotspot")) openPopup(event.target);
      else if (!event.target.closest(".calendar-popup")) closePopups();
    });
    document.addEventListener("click", event => {
      const portalTab = event.target.closest("[data-portal-tab]");
      if (portalTab) {
        activeTab = portalTab.dataset.portalTab;
        document.querySelectorAll("[data-portal-tab]").forEach(button => {
          const selected = button.dataset.portalTab === activeTab;
          button.classList.toggle("is-active", selected);
          button.setAttribute("aria-selected", String(selected));
        });
        document.querySelectorAll("[data-portal-page]").forEach(page => { page.hidden = page.dataset.portalPage !== activeTab; });
        return;
      }
      const expandButton = event.target.closest(".board-expand");
      if (expandButton) {
        if (expandButton.getAttribute("aria-expanded") === "true") closeExpandedCard();
        else openExpandedCard(expandButton);
        return;
      }
      if (event.target.closest(".board-expand-backdrop")) {
        closeExpandedCard();
        return;
      }
      const button = event.target.closest(".calendar-hotspot");
      if (button) openPopup(button);
      else if (event.target.closest(".calendar-popup-close") || !event.target.closest(".calendar-popup")) closePopups();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closePopups();
        closeExpandedCard();
      }
    });
    document.addEventListener("wheel", event => {
      if (!expandedCard || event.ctrlKey || !event.target.closest(".board-card.is-expanded")) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? expandedCard.clientHeight : 1;
      expandedCard.scrollTop += event.deltaY * unit;
      event.preventDefault();
    }, {passive:false});
  }
  const rules = [
    ["출결 용어", [
      "① 출결관련 용어에 대하여 다음 각 호의 정의를 따른다.",
      "1. “지각”이란 정시 이후 행사에 참석하는 것을 의미한다.",
      "2. “무단결석”이란 운영진에 어떠한 사전연락도 없이 행사에 불참하는 것을 의미한다.",
      "3. “수료실패”란 경고 2회가 부과되는 것을 의미한다.",
      "4. “수료성공”이란 수료실패하지 아니하고 활동기간 종료 시점에 회원의 자격을 유지하는 것을 의미한다."
    ]],
    ["제6조의2(출결의 관리)", [
      "① 회원은 전체 및 매월 활동 횟수 대비 참여횟수의 비율이 50% 이상이어야 한다.",
      "② 제1항의 매월 기준에 미달한 경우, 그 개월 수에 따라 다음 각 호와 같이 출석경고를 부과한다. 단 출석으로 인한 경고는 매 활동기간 시작 시 초기화된다.",
      "1. 2개월 미달: 출석경고 누계 1회", "2. 3개월 미달: 출석경고 누계 2회",
      "③ 소모임(별칭 “번개”)의 0.5회 출석 인정을 위해서는 다음 각 호의 조건을 모두 만족해야 한다.",
      "1. 사진과의 연관성", "2. 번개 모집글의 사전 게시", "3. 번개가 진행된 당월의 정기출사에 1회 이상 참여", "4. 번개 후기를 일주일 내에 업로드",
      "④ 운영진은 특별한 사유 없이 지속적으로 불참하는 등 출결 기준에 미흡한 회원에 대해 운영진 회의를 통해 경고 및 제명할 수 있다.",
      "⑤ MT, 사진전 등 공식행사에 참여하는 자는 출석 1회로 인정한다. 단, 공식적으로 행사에 참여하지 않더라도, 이에 조력하는 자는 운영진 판단 하에 출석 1회를 인정한다.",
      "⑥ 정기출사의 출석 인정은 후기 업로드 여부와 무관하다.",
      "⑦ 벌금부여는 다음 각 호의 기준을 따른다. 단, 활동유지를 선택한 수료실패자의 경우 본 조항에 명시된 벌금의 2배를 적용한다. 적용범위는 정기출사(소모임, 시험기간, MT 등 기타 행사 제외)로 제한하되, 필요에 따라 운영진이 사전 공지하는 경우 본 조항을 적용할 수 있다.",
      "1. 운영진이 공지한 기한 내 공지방 투표 미투표: 1천원", "2. 지각: 2천원", "3. 무단결석: 5천원", "4. 운영진이 공지한 기한 내 후기 미업로드: 3천원", "5. 운영진이 공지한 기한 내 벌금미납: 1천원"
    ]],
    ["제6조의3(출결의 예외)", [
      "① 천재지변, 사고 등 상당한 수준의 불가피한 사유가 있는 경우, 운영진은 회의를 통해서 출결에 대한 유예 혹은 예외를 인정할 수 있다.",
      "② 본 동아리를 대표하여 활동하는 회원에 한하여 대외활동의 활동일이 본 동아리의 활동일과 중복될 시 운영진에 일시와 명단을 전달하여야 하며, 이는 0.5회 출석으로 인정한다.",
      "③ 운영진은 회원들의 정기모임 참여 태도가 현저히 불량하다고 판단되는 경우, 아래 각 호를 모두 만족하는 범위에서 예외를 추가 할 수 있다.",
      "1. 운영진 판단 하에 출사 시간에 지나치게 늦게 참여하거나(이하 ‘늦참’), 지나치게 이르게 이탈하는 회원(이하 ‘조퇴’)이 빈번히 발생한다고 생각되는 경우, 활동회원 전체에게 사전 공지 후 해당 인원들의 출석인정 횟수를 0.5회 혹은 0회로 변경하여 적용 할 수 있다.",
      "2. 제1호에 따라 출석 인정 횟수를 변경할 경우, 늦참과 조퇴의 기준은 운영진 회의에서 의결하여 변경 시기와 함께 사전 공지하여야 한다.",
      "3. 제1호와 제2호를 통해 변경된 출석 기준은 매 기수 활동 시작마다 효력을 잃는다."
    ]]
  ];
  function rulesHtml() {
    return `<div class="board-rule-full">${rules.map(([title, lines]) => `<h3>${title}</h3>${lines.map(line => `<p>${esc(line)}</p>`).join("")}`).join("")}</div>`;
  }
  function months(state) {
    return [...new Set([today().slice(0,7), ...(state.events || []).map(e => e.date.slice(0,7)), ...(state.monthlySchedule || []).map(e => e.date.slice(0,7)), ...(state.monthlyReports || []).map(r => r.month)])].sort().reverse();
  }
  function recordedLightningCount(state, memberId, month) {
    const photoEvents = new Set((state.events || []).filter(event => event.type === "photo" && event.date?.slice(0,7) === month).map(event => event.id));
    return new Set((state.records || [])
      .filter(record => record.memberId === memberId && photoEvents.has(record.eventId) && ["present", "late", "excused"].includes(record.status))
      .map(record => record.eventId)).size;
  }
  function reportUnits(state, report) {
    const reportedLightning = Number(report.lightningCount || 0);
    const observedLightning = recordedLightningCount(state, report.memberId, report.month);
    const extraLightning = Math.max(0, observedLightning - reportedLightning);
    return {units:Number(report.units || 0) + extraLightning * .5, lightningUnits:Math.max(reportedLightning, observedLightning) * .5};
  }
  function stats(state, memberId, month) {
    const reports = (state.monthlyReports || []).filter(r => r.memberId === memberId);
    const report = reports.find(r => r.month === month);
    if (!report || !report.activities) return {rate:null, allRate:null, units:null, lightningUnits:0, warnings:0};
    const term = reports.filter(r => r.term === report.term && r.month <= month);
    const activities = term.reduce((n,r) => n + r.activities, 0);
    const credited = term.map(item => ({report:item, ...reportUnits(state, item)}));
    const units = credited.reduce((n,r) => n + r.units, 0);
    const current = credited.find(item => item.report === report);
    const under = credited.filter(r => r.report.finalized && r.report.activities > 0 && r.units/r.report.activities < .5).length;
    return {rate:current.units/report.activities, allRate:activities ? units/activities : null, units:current.units, lightningUnits:current.lightningUnits, warnings:Math.min(2, Math.max(0,under-1))};
  }
  function memberEvents(state, member, month) {
    const report = (state.monthlyReports || []).find(r => r.memberId === member.id && r.month === month);
    const regular = report && Array.isArray(report.attendance) ? report.attendance : [];
    const events = [...(state.monthlySchedule || []), ...(state.events || [])]
      .filter(event => event.date && event.date.slice(0,7) === month)
      .filter((event, index, all) => all.findIndex(other => other.date === event.date && other.name === event.name) === index)
      .sort((a,b) => a.date.localeCompare(b.date));
    const records = state.records || [];
    const fallback = events.map(event => {
      const sourceEventIds = new Set((state.events || []).filter(source => source.date === event.date && source.name === event.name).map(source => source.id));
      const record = records.find(item => item.memberId === member.id && (item.eventId === event.id || item.date === event.date || sourceEventIds.has(item.eventId)));
      const participated = record && ["present", "late", "excused"].includes(record.status);
      return {date:event.date, name:event.name, type:event.type, status:event.date > today() ? "예정" : participated ? "참여" : "미참여", units:participated ? (event.type === "photo" ? .5 : 1) : 0};
    });
    return [...regular, ...fallback.filter(event => event.type === "photo" ? event.status === "참여" : !regular.length)].sort((a,b) => a.date.localeCompare(b.date));
  }
  function eventStatusLabel(status) {
    if (["참여", "present", "late", "excused"].includes(status)) return "참여";
    if (["미참여", "absent"].includes(status)) return "미참여";
    return status || "미확인";
  }
  function searchMemberHtml(state, month, query = "") {
    if (state.rosterReady !== true) return `<p class="board-note">기본 회원 정보 입력 대기</p>`;
    const term = query.trim();
    if (!term) return `<p class="board-search-hint">이름을 검색하면 월별 출석률과 행사별 참여 여부를 확인할 수 있습니다.</p>`;
    const members = (state.members || []).filter(member => member.rosterIncluded !== false && member.name.includes(term));
    if (!members.length) return `<p class="board-note">검색 결과가 없습니다.</p>`;
    return members.sort((a,b) => a.name.localeCompare(b.name,"ko")).map(member => {
      const row = {member, ...stats(state, member.id, month)};
      const eventRows = memberEvents(state, member, month);
      const history = (state.monthlyReports || []).filter(report => report.memberId === member.id).sort((a,b) => b.month.localeCompare(a.month));
      return `<article class="member-search-card"><header class="member-result-head"><div><strong>${esc(member.name)}</strong><span>${esc(member.cohort ? `${member.cohort}기` : "회원")}</span></div><div><span>선택 월 <b>${pct(row.rate)}</b></span><span>전체 <b>${pct(row.allRate)}</b></span></div></header><div class="member-month-history"><h3>월별 출석률</h3>${history.map(report => { const units = reportUnits(state, report).units; return `<div><time datetime="${esc(report.month)}">${esc(report.month.replace("-","년 "))}월</time><span>${units} / ${Number(report.activities || 0)}회</span><strong>${report.activities ? pct(units / report.activities) : "—"}</strong></div>`; }).join("") || `<p class="board-note">월별 출석 자료가 없습니다.</p>`}</div><div class="member-event-list"><h3>${month.slice(5)}월 행사별 출결</h3>${eventRows.length ? eventRows.map(event => `<div class="member-event-row"><time datetime="${esc(event.date)}">${esc(event.date.slice(5).replace("-","."))}</time><span>${esc(event.name)}</span><strong class="member-event-status ${eventStatusLabel(event.status) === "참여" ? "is-present" : eventStatusLabel(event.status) === "예정" ? "is-upcoming" : "is-absent"}">${eventStatusLabel(event.status)}</strong></div>`).join("") : `<p class="board-note">해당 월 행사별 출결 자료가 없습니다.</p>`}</div></article>`;
    }).join("");
  }
  function topAttendanceGroups(rows, limit = 3) {
    const ranked = rows
      .filter(row => (row.rate ?? row.units) > 0)
      .sort((a,b) => (b.rate ?? b.units)-(a.rate ?? a.units) || a.member.name.localeCompare(b.member.name,"ko"));
    const rates = [...new Set(ranked.map(row => row.rate ?? row.units))].slice(0,limit);
    return rates.map((rate,index) => ({
      rank:index+1,
      rate,
      units:ranked.find(row => (row.rate ?? row.units) === rate)?.units ?? null,
      members:ranked.filter(row => (row.rate ?? row.units) === rate).sort((a,b) => a.member.name.localeCompare(b.member.name,"ko")),
    }));
  }
  function activityWinnerHtml(state, month) {
    const configured = (state.activityWinners || []).filter(winner => winner.month === month && winner.photo);
    const winners = (configured.length ? configured : bundledActivityWinners[month] || [])
      .sort((a,b) => (Number(a.rank) || 99) - (Number(b.rank) || 99) || String(a.name || "").localeCompare(String(b.name || ""), "ko"));
    if (!winners.length) return `<div class="winner-photo-stage"><div class="winner-photo-grid winner-photo-grid-pending" aria-hidden="true"><span></span><span></span></div><div class="winner-counting"><strong>집계중</strong><span>사진 등록 후 공개됩니다.</span></div></div>`;
    return `<div class="winner-photo-grid">${winners.map((winner,index) => `<figure><img src="${esc(winner.photo)}" alt="${esc(winner.name || `${index + 1}번째 활동왕`)}"><figcaption>${winner.rank ? `<span>${Number(winner.rank)}위</span>` : ""}<strong>${esc(winner.name || "")}</strong></figcaption></figure>`).join("")}</div>`;
  }
  function eventsForMonth(state, month) {
    const scheduled = state.monthlySchedule || [];
    return [...scheduled, ...(state.events || []).filter(event => !scheduled.some(item => item.date === event.date && item.name === event.name))]
      .filter(event => event.date?.slice(0,7) === month)
      .sort((a,b) => a.date.localeCompare(b.date));
  }
  function scheduleListHtml(events, compact = false) {
    const label = {official:"정기출사 / 공식행사",photo:"사진 번개",external:"외부행사",regular:"정기출사",break:"휴회"};
    const visible = compact ? events.slice(0,4) : events;
    return `<ol class="portal-schedule-list">${visible.map(event => `<li><time datetime="${esc(event.date)}"><strong>${Number(event.date.slice(8))}</strong><span>${["일","월","화","수","목","금","토"][new Date(event.date+"T12:00:00+09:00").getUTCDay()]}</span></time><div><strong>${esc(event.name)}</strong><span>${esc(label[event.type] || "행사")}${event.startTime ? ` · ${esc(event.startTime)}` : ""}</span></div><em>${event.date > today() ? "예정" : event.date === today() ? "오늘" : "완료"}</em></li>`).join("") || `<li class="portal-empty">등록된 일정이 없습니다.</li>`}</ol>`;
  }
  function scheduleHistoryHtml(state) {
    return months(state).map(month => {
      const events = eventsForMonth(state, month);
      if (!events.length) return "";
      return `<section class="schedule-month-group"><h3>${month.replace("-","년 ")}월 <span>${events.length}건</span></h3>${scheduleListHtml(events)}</section>`;
    }).join("") || `<p class="portal-empty">등록된 월별 일정이 없습니다.</p>`;
  }
  function winnerMonth(state, month) {
    const available = [...new Set([...Object.keys(bundledActivityWinners), ...(state.activityWinners || []).filter(item => item.photo).map(item => item.month)])].sort().reverse();
    return available.find(item => item <= month) || available[0] || month;
  }
  function render(state, month, query = "", admin = false, scheduleMonth = month) {
    const events = eventsForMonth(state, scheduleMonth);
    const awardMonth = winnerMonth(state, month);
    const activityCount = Math.max(...(state.monthlyReports || []).filter(report => report.month === month).map(report => Number(report.activities || 0)), 0);
    const attendanceMonthOptions = months(state).map(item => `<option value="${item}" ${item===month?"selected":""}>${item.replace("-","년 ")}월</option>`).join("");
    const scheduleMonthOptions = months(state).map(item => `<option value="${item}" ${item===scheduleMonth?"selected":""}>${item.replace("-","년 ")}월</option>`).join("");
    const attendanceMonthSelect = `<label class="panel-month"><span>기준월</span><select class="dashboard-month" data-month-scope="attendance" aria-label="출석률 기준월">${attendanceMonthOptions}</select></label>`;
    const scheduleMonthSelect = `<label class="panel-month"><span>기준월</span><select class="dashboard-month" data-month-scope="schedule" aria-label="일정 기준월">${scheduleMonthOptions}</select></label>`;
    const expandButton = `<button type="button" class="board-expand" aria-label="크게 보기" title="크게 보기" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="board-expand-mark" d="M14 3h7v7M21 3l-8 8M10 21H3v-7M3 21l8-8"/><path class="board-close-mark" d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    return `<div class="cam-portal">
      <header class="portal-header"><div class="portal-brand"><img src="${assetBase}assets/cami-logo.jpg" alt="CAM-I 로고"><strong>CAM-I</strong></div><nav class="portal-tabs" aria-label="주요 메뉴" role="tablist"><button type="button" role="tab" data-portal-tab="home" class="${activeTab === "home" ? "is-active" : ""}" aria-selected="${activeTab === "home"}">홈</button><button type="button" role="tab" data-portal-tab="feed" class="${activeTab === "feed" ? "is-active" : ""}" aria-selected="${activeTab === "feed"}">피드</button></nav></header>
      <main class="portal-page" data-portal-page="home" ${activeTab === "home" ? "" : "hidden"}>
        <section class="club-rules-strip" aria-labelledby="club-rules-title"><header><div><h1 id="club-rules-title">동아리 회칙</h1></div></header><dl><div><dt>월별·전체 출석률</dt><dd>각 50% 이상</dd></div><div><dt>공식행사 / 사진 번개</dt><dd>1회 / 0.5회</dd></div><div><dt>출석경고</dt><dd>2개월 1회 · 3개월 2회</dd></div></dl><p>출석경고는 활동기간 시작 시 초기화되며, 경고 2회 부과 시 수료실패에 해당합니다.</p></section>
        <div class="portal-dashboard">
          <section class="board-card portal-panel attendance-panel" aria-labelledby="attendance-panel-title"><header><div><span class="panel-eyebrow">ATTENDANCE</span><h2 id="attendance-panel-title">이번달 출석률</h2></div><div class="board-card-actions">${attendanceMonthSelect}${expandButton}</div></header><div class="summary-only attendance-overview"><strong>${month.slice(5)}월</strong><div><span>회원별 출석률</span><b>검색으로 확인</b></div><div><span>반영 활동</span><b>${activityCount || "대기"}${activityCount ? "회" : ""}</b></div><p>자세히 보기에서 월별 출석률과 전체 출석률을 함께 확인할 수 있습니다.</p></div><div class="detail-only attendance-detail"><div class="detail-heading"><h3>월별·전체 출석률</h3><p>회원을 검색하면 선택한 달의 행사 참여 내역과 활동기간 전체 기록을 확인할 수 있습니다.</p></div><label class="board-search">회원 검색<input id="board-member-search" type="search" placeholder="이름 입력" value="${esc(query)}" autocomplete="off"></label><div id="board-search-result" class="board-search-result">${searchMemberHtml(state, month, query)}</div></div></section>
          <section class="board-card portal-panel schedule-panel" aria-labelledby="schedule-panel-title"><header><div><span class="panel-eyebrow">SCHEDULE</span><h2 id="schedule-panel-title">이번달 일정</h2></div><div class="board-card-actions">${scheduleMonthSelect}${expandButton}</div></header><div class="summary-only">${scheduleListHtml(events,true)}</div><div class="detail-only schedule-detail"><div class="detail-heading"><h3>월별 일정</h3><p>등록된 일정을 월별로 모아봅니다.</p></div>${scheduleMonth === "2026-10" ? `<div class="featured-calendar">${posterCalendar(events,scheduleMonth)}</div>` : ""}${scheduleHistoryHtml(state)}</div></section>
        </div>
      </main>
      <main class="portal-page feed-page" data-portal-page="feed" ${activeTab === "feed" ? "" : "hidden"}><section class="feed-awards"><header><span class="panel-eyebrow">CAM-I HONORS</span><h1>${awardMonth.slice(5)}월 활동왕</h1><p>함께한 순간을 빛낸 이번 달의 활동왕입니다.</p></header><div class="feed-winner-gallery">${activityWinnerHtml(state,awardMonth)}</div></section><div class="feed-open-space" aria-hidden="true"></div></main>
      ${admin ? importHtml(state) : ""}
    </div>`;
  }
  function memberRows(rows,query,pending) {
    const visible = rows.filter(r => r.member.name.includes(query.trim()));
    return visible.map(rateRow).join("") || `<p class="board-note">${rows.length?"검색 결과가 없습니다.":pending}</p>`;
  }
  function rateRow(r) {
    const meta = [r.member.cohort ? `${r.member.cohort}기` : "", r.member.note === "운영진" ? `운영진 · ${r.member.department}` : "일반 회원"].filter(Boolean).join(" · ");
    const status = r.member.active===false ? `${esc(r.member.membershipStatus||"비활동")} · 집계 제외` : `월 ${pct(r.rate)} · 전체 ${pct(r.allRate)}${r.lightningUnits ? ` · 번개 ${r.lightningUnits}회` : ""}${r.warnings?` · 출석경고 ${r.warnings}회`:""}`;
    const bar = r.member.active===false || r.rate == null ? 0 : Math.max(0,Math.min(100,r.rate*100));
    return `<div class="board-rate-row"><div class="board-rate-row-main"><div><strong>${esc(r.member.name)}</strong><small class="board-member-meta">${esc(meta)}</small></div><span>${status}</span></div>${r.member.active!==false && r.rate != null ? `<div class="board-inline-meter"><i style="width:${bar}%"></i></div>` : ""}</div>`;
  }
  function importHtml(state) {
    return `<details class="board-import"><summary>월별 출결표 가져오기 <span>.xlsx</span></summary><p>출결표를 선택하면 행사 일정과 회원별 인정횟수를 미리 확인할 수 있습니다. 기본 회원 정보가 준비된 뒤 이름을 연결해 반영합니다.</p><form id="monthly-import-form"><label>출결표 파일<input name="workbook" type="file" accept=".xlsx" required></label><label>활동기간<input name="term" placeholder="예: 21기" required maxlength="40"></label><label>대상 월<input name="month" type="month" required></label><button class="button button-primary" type="submit">미리보기</button></form><div id="import-result" role="status">${state.rosterReady?"":"기본 회원 정보 입력 대기 · 회원별 데이터 반영은 보류 중입니다."}</div></details>`;
  }
  return {render, rulesHtml, months, stats, topAttendanceGroups, memberRows, searchMemberHtml, memberEvents, esc, pct};
})();
