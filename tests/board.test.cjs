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
test('피드는 가장 최근에 등록된 활동왕 사진을 표시한다', () => {
  const state = {rosterReady:true,members:[{id:'a',name:'가나다'},{id:'b',name:'라마바'}],events:[],monthlyReports:[report('2026-09',2),{...report('2026-09',2),memberId:'b'}]};
  const html = board.render(state,'2026-08');
  assert.match(html,/09월 활동왕/);
  assert.match(html,/kim-taegeon\.png/);
  assert.match(html,/na-hyeyoung\.png/);
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
  assert.match(html,/09월 활동왕/);
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
test('홈은 출석률과 일정에만 자세히 보기 버튼을 제공한다', () => {
  const state = {rosterReady:true,members:[{id:'a',name:'가나다',active:true}],events:[],monthlyReports:[report('2026-09',1)]};
  const html = board.render(state,'2026-09');
  assert.doesNotMatch(html,/MONTHLY OVERVIEW|함께한 순간들/);
  assert.equal((html.match(/class="board-expand"/g) || []).length,2);
  assert.equal((html.match(/aria-label="크게 보기"/g) || []).length,2);
  assert.equal((html.match(/<svg viewBox="0 0 24 24"/g) || []).length,2);
  assert.match(html,/class="club-rules-strip"/);
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
test('활동왕 사진은 두 칸 갤러리 형태로 표시한다', () => {
  const state = {rosterReady:true,members:[],events:[],monthlyReports:[],activityWinners:[
    {month:'2026-09',rank:2,name:'라마바',photo:'assets/two.jpg'},
    {month:'2026-09',rank:1,name:'가나다',photo:'assets/one.jpg'},
  ]};
  const html = board.render(state,'2026-09');
  assert.match(html,/class="winner-photo-grid"/);
  assert.equal((html.match(/<figure>/g) || []).length,2);
  assert.ok(html.indexOf('가나다') < html.indexOf('라마바'));
});
test('9월 활동왕 인증서 두 장을 기본 사진으로 표시한다', () => {
  const html = board.render({members:[],events:[],monthlyReports:[]},'2026-09');
  assert.match(html,/kim-taegeon\.png/);
  assert.match(html,/na-hyeyoung\.png/);
  assert.match(html,/김태건/);
  assert.match(html,/나혜영/);
  assert.ok(fs.existsSync('public/assets/activity-winners/2026-09/kim-taegeon.png'));
  assert.ok(fs.existsSync('public/assets/activity-winners/2026-09/na-hyeyoung.png'));
});
test('이번달 일정과 월별 일정 상세를 함께 제공한다', () => {
  const html = board.render({members:[],events:[],monthlySchedule:[{date:'2026-09-05',type:'official',name:'OT'}]},'2026-09');
  assert.match(html,/class="portal-schedule-list"/);
  assert.match(html,/class="schedule-month-group"/);
  assert.match(html,/월별 일정/);
});

test('월별 출결표와 같은 달의 추가 행사를 함께 표시한다', () => {
  const html = board.render({
    members:[],
    monthlyReports:[],
    monthlySchedule:[{date:'2026-09-05',type:'official',name:'OT'}],
    events:[{date:'2026-09-11',type:'photo',name:'야간 사진 번개'}],
  },'2026-09');
  assert.match(html,/OT/);
  assert.match(html,/야간 사진 번개/);
});

test('상단에는 CAM-I 로고와 홈·피드 탭만 표시한다', () => {
  const html = board.render({members:[],events:[],monthlyReports:[]},'2026-09');
  assert.match(html,/assets\/cami-logo\.jpg/);
  assert.match(html,/data-portal-tab="home"/);
  assert.match(html,/data-portal-tab="feed"/);
  assert.doesNotMatch(html,/관심/);
});

test('출석률 상세는 선택 월과 전체 및 월별 기록을 표시한다', () => {
  const state = {
    rosterReady:true,
    members:[{id:'a',name:'가나다',active:true}],
    events:[],
    monthlyReports:[
      {...report('2026-08',1),memberId:'a'},
      {...report('2026-09',2),memberId:'a'},
    ],
  };
  const html = board.searchMemberHtml(state,'2026-09','가나다');
  assert.match(html,/선택 월 <b>100%<\/b>/);
  assert.match(html,/전체 <b>75%<\/b>/);
  assert.match(html,/월별 출석률/);
  assert.match(html,/2026년 08월/);
  assert.match(html,/2026년 09월/);
});

test('피드는 큰 활동왕 영역 뒤를 빈 공간으로 남긴다', () => {
  const html = board.render({members:[],events:[],monthlyReports:[]},'2026-09');
  assert.match(html,/class="feed-awards"/);
  assert.match(html,/class="feed-open-space"/);
});
test('출석규정 한자 배지를 숨기고 사진 번개로 표시한다', () => {
  const html = board.render({members:[],events:[],monthlyReports:[]},'2026-09');
  assert.doesNotMatch(html,/회칙 中 出缺|인정 번개/);
  assert.match(html,/공식행사 \/ 사진 번개/);
});
