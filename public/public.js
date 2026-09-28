let state = null;
let selectedMonth = "";
let selectedMember = "all";
let memberSearch = "";

selectedMonth = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Seoul"}).format(new Date()).slice(0,7);
const requestedMonth = new URLSearchParams(location.search).get("month");
if (/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth || "")) selectedMonth = requestedMonth;
function render() {
  document.querySelector("#public-board").innerHTML = AttendanceBoard.render(state, selectedMonth, memberSearch);
}
document.addEventListener("change", event => {
  if (event.target.id === "dashboard-month") { selectedMonth = event.target.value; render(); }
});
document.addEventListener("input", event => {
  if (event.target.id !== "board-member-search") return;
  memberSearch = event.target.value;
  const result = document.querySelector("#board-search-result");
  if (result) result.innerHTML = AttendanceBoard.searchMemberHtml(state, selectedMonth, memberSearch);
});
fetch("./data/public-state.json", {cache:"no-store"})
  .then(response => {if (!response.ok) throw new Error("출결 정보를 불러오지 못했습니다."); return response.json();})
  .then(data => {
    state = data;
    document.querySelector("#updated-at").textContent = data.generatedAt ? `업데이트 ${data.generatedAt.replace("T"," ")}` : "업데이트 대기";
    render();
  }).catch(error => {
    document.querySelector("#updated-at").textContent = error.message;
    document.querySelector("#public-board").innerHTML = `<p role="alert">${AttendanceBoard.esc(error.message)} 새로고침 후 다시 확인해 주세요.</p>${AttendanceBoard.render({members:[],events:[],records:[]},selectedMonth)}`;
  });
