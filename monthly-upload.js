window.MonthlyUpload = (() => {
  const esc = AttendanceBoard.esc;
  async function request(path, body) {
    const response = await fetch(path, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "출결표를 읽지 못했습니다.");
    return data;
  }
  async function preview(form) {
    const file = form.elements.workbook.files[0];
    if (!file || !file.name.toLowerCase().endsWith(".xlsx")) throw new Error(".xlsx 출결표를 선택하세요.");
    if (file.size > 5_000_000) throw new Error("5MB 이하의 파일을 선택하세요.");
    const button = form.querySelector("button");
    const result = document.querySelector("#import-result");
    button.disabled = true;
    result.textContent = "출결표를 확인하고 있습니다…";
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset=0;offset<bytes.length;offset+=8192) binary += String.fromCharCode(...bytes.subarray(offset,offset+8192));
      const body = {filename:file.name, content:btoa(binary), month:form.elements.month.value, term:form.elements.term.value};
      const data = await request("/api/import/preview",body);
      const p = data.preview;
      result.innerHTML = `<strong>${esc(p.source)}</strong><p>${esc(p.month)} · ${esc(p.term)} · 일정 ${p.events.length}건 · 집계 ${p.people.length}명</p><p>엑셀의 저장된 집계값을 사용합니다. 번개 인정 조건과 OT 예외는 운영진이 출결표에서 확인한 집계 기준입니다. 지각·무단결석·벌금은 출석 숫자로 추정하지 않습니다.</p>${data.blockers.length ? `<ul class="import-issues">${data.blockers.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}${p.issues.length ? `<ul class="import-issues">${p.issues.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}<div class="import-scroll"><table><thead><tr><th>이름</th><th>활동 횟수</th><th>인정 출석</th><th>출석률</th></tr></thead><tbody>${p.people.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.activities}</td><td>${r.units}</td><td>${AttendanceBoard.pct(r.activities?r.units/r.activities:null)}</td></tr>`).join("")}</tbody></table></div>${!data.blockers.length?`<label><input id="accept-summary" type="checkbox"> 집계값과 번개 인정 조건을 확인했으며, 이 달의 출결을 확정합니다. 같은 달을 다시 반영하면 기존 월별 집계를 교체합니다.</label><button type="button" id="apply-month" class="button button-primary">이 달 반영</button>`:""}`;
      document.querySelector("#apply-month")?.addEventListener("click", async event => {
        if (!document.querySelector("#accept-summary").checked) { showNotice("집계 기준과 월별 확정을 확인하세요.", true); return; }
        event.target.disabled = true;
        try {
          await request("/api/import/apply", {...body, acceptSummary:true});
          await loadState();
          showNotice("월별 출결표를 반영했습니다.");
        } catch(error) { showNotice(error.message,true); event.target.disabled=false; }
      });
    } catch(error) { result.textContent = error.message; throw error; }
    finally { button.disabled = false; }
  }
  return {preview};
})();
