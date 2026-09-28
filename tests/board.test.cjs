const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = {window:{}, Intl, Date};
vm.runInNewContext(fs.readFileSync('public/board.js','utf8'),context);
const board = context.window.AttendanceBoard;
const report = (month, units, term='21기') => ({memberId:'a',month,units,activities:2,term,finalized:true});
test('월 50% 이상이면 전체율 미달을 월별 경고에 중복 계산하지 않는다', () => {
  const stats = board.stats({monthlyReports:[report('2026-08',0),report('2026-09',1)]},'a','2026-09');
  assert.equal(stats.rate,.5);
  assert.equal(stats.allRate,.25);
  assert.equal(stats.warnings,0);
});
test('경고 2회 상한과 활동기간 초기화', () => {
  const state = {monthlyReports:[report('2026-06',0),report('2026-07',0),report('2026-08',0),report('2026-09',1,'22기')]};
  assert.equal(board.stats(state,'a','2026-08').warnings,2);
  assert.equal(board.stats(state,'a','2026-09').warnings,0);
});
test('자료 없음과 실제 0%를 구분', () => {
  assert.equal(board.stats({monthlyReports:[]},'a','2026-09').rate,null);
  assert.equal(board.stats({monthlyReports:[report('2026-09',0)]},'a','2026-09').rate,0);
});
test('기록된 번개 참여는 월 출석 인정횟수에 0.5회 반영한다', () => {
  const state = {
    members:[{id:'a',name:'가나다'}],
    events:[{id:'photo-1',date:'2026-09-11',name:'야간 번개',type:'photo'}],
    records:[{eventId:'photo-1',memberId:'a',status:'present'}],
    monthlyReports:[{...report('2026-09',1),memberId:'a',lightningCount:0}],
  };
  const stats = board.stats(state,'a','2026-09');
  assert.equal(stats.units,1.5);
  assert.equal(stats.rate,.75);
  assert.equal(stats.lightningUnits,.5);
  const html = board.searchMemberHtml({...state,rosterReady:true},'2026-09','가나다');
  assert.match(html,/야간 번개/);
  assert.doesNotMatch(html,/미참여/);
});
test('이미 집계된 번개 횟수는 공개 데이터에서 중복 가산하지 않는다', () => {
  const state = {
    members:[{id:'a',name:'가나다'}],
    events:[{id:'photo-1',date:'2026-09-11',name:'야간 번개',type:'photo'}],
    records:[{eventId:'photo-1',memberId:'a',status:'present'}],
    monthlyReports:[{...report('2026-09',3.5),memberId:'a',lightningCount:1}],
  };
  assert.equal(board.stats(state,'a','2026-09').units,3.5);
});
test('동률은 같은 순위에 함께 표시하고 회원 명단 대기 중 이름은 노출하지 않는다', () => {
  const state = {rosterReady:true,members:[{id:'a',name:'가나다'},{id:'b',name:'라마바'}],events:[],monthlyReports:[report('2026-09',2),{...report('2026-09',2),memberId:'b'}]};
  const html = board.render(state,'2026-09');
  assert.match(html,/podium-first/);
  assert.match(html,/<div class="podium-names"><strong>가나다<\/strong><strong>라마바<\/strong><\/div>/);
  state.rosterReady=false;
  const waitingHtml = board.render(state,'2026-09');
  assert.doesNotMatch(waitingHtml,/<strong>가나다<\/strong>|<strong>라마바<\/strong>/);
});
test('회원명과 일정명 HTML 이스케이프', () => {
  const html = board.render({members:[],events:[],monthlySchedule:[{date:'2026-09-05',type:'photo',name:'<script>alert(1)</script>'}]},'2026-09');
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;/);
});
test('출석왕은 출석률 상위 3개 순위로 묶고 동률은 가나다순', () => {
  const row = (name,units,rate) => ({member:{name},units,rate});
  const groups = board.topAttendanceGroups([
    row('장우리',3,1), row('김태건',3.5,1.1666666667), row('안소은',3,1), row('주지성',2.5,1), row('나혜영',2.5,1.5), row('정승현',0,0), row('김민서',2,.5),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map(group => ({rank:group.rank,units:group.units,names:group.members.map(row=>row.member.name)})))), [
    {rank:1,units:2.5,names:['나혜영']},
    {rank:2,units:3.5,names:['김태건']},
    {rank:3,units:3,names:['안소은','장우리','주지성']},
  ]);
});
test('평균 출석률 문구는 렌더링하지 않는다', () => {
  const state = {rosterReady:true,members:[{id:'a',name:'가나다',active:true}],events:[],monthlyReports:[report('2026-09',1)]};
  const html = board.render(state,'2026-09');
  assert.doesNotMatch(html,/평균/);
  assert.match(html,/이달의 출석왕 TOP 3/);
});
test('출석률 카드는 검색 전용으로 표시하고 인원수 목록을 노출하지 않는다', () => {
  const state = {rosterReady:true,members:[
    {id:'a',name:'가나다',active:true},{id:'b',name:'라마바',active:true},{id:'c',name:'다라마',active:true},
    {id:'d',name:'마바사',active:true},{id:'e',name:'바사아',active:true},{id:'f',name:'사아자',active:true},
  ],events:[],monthlyReports:[report('2026-09',2),{...report('2026-09',1),memberId:'b'},{...report('2026-09',2),memberId:'c'},{...report('2026-09',1),memberId:'d'},{...report('2026-09',2),memberId:'e'},{...report('2026-09',1),memberId:'f'}]};
  const html = board.render(state,'2026-09');
  assert.doesNotMatch(html,/>6명</);
  assert.match(html,/id="board-member-search"/);
  assert.match(html,/이름을 검색하면/);
  assert.doesNotMatch(html,/나머지 회원 펼쳐보기/);
  assert.doesNotMatch(html,/출석규정 전문 보기/);
});
test('검색 결과에 회원 출석률과 행사별 참여 여부를 표시한다', () => {
  const state = {
    rosterReady:true,
    members:[{id:'a',name:'가나다',active:true}],
    events:[],
    monthlyReports:[{...report('2026-09',1),memberId:'a',attendance:[
      {date:'2026-09-05',name:'OT',status:'미참여',units:0},
      {date:'2026-09-12',name:'서촌',status:'참여',units:1},
    ]}],
  };
  const html = board.searchMemberHtml(state,'2026-09','가나다');
  assert.match(html,/행사별 출결/);
  assert.match(html,/OT/);
  assert.match(html,/미참여/);
  assert.match(html,/서촌/);
  assert.match(html,/참여/);
  assert.match(board.searchMemberHtml(state,'2026-09',''),/이름을 검색하면/);
});
test('출석왕 시상대는 2위, 1위, 3위 순서로 배치한다', () => {
  const state = {rosterReady:true,members:[{id:'a',name:'가나다'},{id:'b',name:'라마바'},{id:'c',name:'다라마'}],events:[],monthlyReports:[
    {...report('2026-09',2),memberId:'a'}, {...report('2026-09',3),memberId:'b'}, {...report('2026-09',1),memberId:'c'},
  ]};
  const html = board.render(state,'2026-09');
  const podium = html.match(/<div class="board-podium">([\s\S]*?)\n\s*<p class="board-note">/)[1];
  assert.deepEqual([...podium.matchAll(/class="podium-place podium-(?:second|first|third)"[\s\S]*?<div class="podium-label">(\d위)/g)].map(match => match[1]), ['2위','1위','3위']);
});
