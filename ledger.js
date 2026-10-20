/* 정산 노트 — 공용 지출·정산, 멤버별 개인 지출, 공용/개인 메모(체크 리스트·글).
   서버: /api/ledger (api/ledger.js). 개인 항목은 서버가 본인에게만 내려준다.
   사용: <div id="ledger-root"></div> + <script src="ledger.js" defer> 이면 자동 mount. */
(function(){
'use strict';
/* API 주소: Vercel(같은 도메인)·로컬 미리보기는 상대 경로, 깃 페이지 등 다른 호스트에서 열리면 Vercel 서버로 교차 요청 */
const API_HOST='https://tokyo-trip-seven.vercel.app';
const API=(/\.vercel\.app$/.test(location.hostname)||/^(localhost|127\.0\.0\.1)$/.test(location.hostname))?'/api/ledger':API_HOST+'/api/ledger';
const POLL_MS=12000;
const DAYS=[
  {d:'2026-10-24',n:1,w:'토',s:'10/24'},{d:'2026-10-25',n:2,w:'일',s:'10/25'},{d:'2026-10-26',n:3,w:'월',s:'10/26'},
  {d:'2026-10-27',n:4,w:'화',s:'10/27'},{d:'2026-10-28',n:5,w:'수',s:'10/28'}];
const PRE={d:'pre',n:0,w:'',s:'출발 전'}, ALLDAYS=[PRE,...DAYS];
const CATS=['식비','교통','덕질','쇼핑','입장','숙소','기타'];
const CUR={JPY:{sym:'¥'},KRW:{sym:'₩'}};

const S={screen:'loading',token:'',me:null,people:[],rate:8.4,rateInfo:{mode:'auto',auto:null},expenses:[],transfers:[],memos:[],
  scope:'mine',err:'',saving:0,pending:false,focusAdd:null,loginIdx:null,loaded:false};
const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}},del:k=>{try{localStorage.removeItem(k)}catch(e){}}};
let root,view,memoRoot,memoView,ov,toastT,pollT;
const roots=()=>[root,memoRoot].filter(Boolean);
const inRoots=a=>roots().some(r=>r.contains(a));

/* ---------- utils ---------- */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,cur='JPY')=>{const c=CUR[cur]||CUR.JPY;return (n<0?'-':'')+c.sym+Math.round(Math.abs(n)).toLocaleString('ko-KR')};
const parseNum=s=>{const v=parseFloat(String(s).replace(/[^\d.\-]/g,''));return isFinite(v)?v:0};
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const todayKey=()=>{const d=new Date();const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return DAYS.some(x=>x.d===k)?k:(k<DAYS[0].d?'pre':DAYS[DAYS.length-1].d)};
const dayOf=k=>ALLDAYS.find(x=>x.d===k)||PRE;
const dayLabel=k=>{const d=dayOf(k);return d.d==='pre'?'출발 전':`D${d.n} ${d.s} ${d.w}`};
const pname=i=>(S.people[i]&&S.people[i].name)||`멤버${i+1}`;
const ownerOf=d=>(d.owner===null||d.owner===undefined||d.owner==='')?null:+d.owner;
const isShared=d=>ownerOf(d)===null;
const q=(sel,el)=>{ if(el)return el.querySelector(sel); for(const r of roots()){const x=r.querySelector(sel); if(x)return x} return ov?ov.querySelector(sel):null };
const qa=(sel,el)=>el?[...el.querySelectorAll(sel)]:roots().flatMap(r=>[...r.querySelectorAll(sel)]);
const toast=m=>{const t=q('.lgtoast',ov);if(!t)return;t.textContent=m;t.classList.add('lgshow');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('lgshow'),1800)};
const svgCheck='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
const svgX='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const svgLock='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const svgMore='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const svgGear='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

/* ---------- api ---------- */
async function api(body){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),20000);
  try{
    const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,token:S.token||undefined}),signal:ctrl.signal});
    let j; try{j=await res.json()}catch(e){throw {code:'network',message:'응답을 읽지 못했어요'}}
    if(!j.ok) throw {code:j.error||'server',message:j.error||'server'};
    return j;
  }catch(e){ if(e&&e.code)throw e; throw {code:'network',message:String(e&&e.message||e)} }
  finally{clearTimeout(t)}
}
function applyList(j){
  S.me=j.me; S.people=j.people||[]; S.rate=+j.rate||S.rate; S.rateInfo=j.rateInfo||S.rateInfo;
  S.expenses=Object.entries(j.expenses||{}).map(([id,e])=>({id,...e,amount:+e.amount||0,payer:+e.payer||0,parts:Array.isArray(e.parts)?e.parts.map(Number):[]}));
  S.transfers=Object.entries(j.transfers||{}).map(([id,t])=>({id,...t,amount:+t.amount||0,from:+t.from||0,to:+t.to||0}));
  S.memos=Object.entries(j.memos||{}).map(([id,m])=>({id,...m,items:Array.isArray(m.items)?m.items:[]}));
  S.loaded=true;
}
let loading=false;
async function load(){
  if(!S.token||loading)return; loading=true;
  try{ const j=await api({action:'list'}); applyList(j); S.screen='main'; S.err=''; render(); }
  catch(e){
    if(e.code==='auth'){logout(false);await boot();}
    else if(e.code==='not_setup'){logout(false);await boot();}
    else{S.err=e.code==='network'?'서버에 연결하지 못했어요. 잠시 후 다시 시도돼요.':String(e.message||'');render()}
  }finally{loading=false}
}
async function boot(){
  S.token=ls.get('tl_token')||''; 
  if(S.token){await load(); if(S.screen==='main')return;}
  try{ const st=await api({action:'status'}); S.people=st.people||[]; S.rate=+st.rate||S.rate; S.rateInfo=st.rateInfo||S.rateInfo; S.screen=st.setup?'login':'setup'; S.err=''; }
  catch(e){ S.screen='error'; S.err=e.code==='network'?'서버에 연결하지 못했어요. 로컬 미리보기라면 `node dev/server.js`로 띄워야 해요.':String(e.message||'') }
  render();
}
function logout(rerender=true){ S.token=''; S.me=null; ls.del('tl_token'); S.screen='login'; if(rerender)render(); }

/* 낙관적 반영 + 서버 쓰기 */
function localApply(op){
  const key=op.col; const arr=S[key]; if(!arr)return;
  const i=arr.findIndex(x=>x.id===op.id);
  if(op.op==='delete'){if(i>=0)arr.splice(i,1)}
  else if(op.op==='update'){if(i>=0)arr[i]={...arr[i],...op.data}}
  else{const d={id:op.id,...op.data}; if(i>=0)arr[i]=d; else arr.push(d)}
  if(key==='expenses')arr.forEach(e=>{e.amount=+e.amount||0});
}
async function write(ops,okMsg,{silent}={}){
  ops.forEach(localApply); if(!silent)render();
  S.saving++;
  try{ await api({action:'write',ops}); if(okMsg)toast(okMsg); return true; }
  catch(e){
    if(e.code==='auth'){toast('다시 로그인해 주세요');logout();}
    else if(e.code==='forbidden'){toast('내 항목만 고칠 수 있어요');}
    else toast('저장 실패 — 다시 시도해 주세요');
    load(); return false;
  }finally{S.saving--}
}

/* ---------- 계산 ---------- */
const shared=()=>S.expenses.filter(isShared);
function sharesOf(e){
  const n=S.people.length||2; const out=new Array(n).fill(0);
  if(!isShared(e)){ const o=ownerOf(e); if(o<n)out[o]=e.amount; return out; }
  const parts=(e.parts&&e.parts.length?e.parts:[...Array(n).keys()]).filter(i=>i<n);
  if(e.custom&&typeof e.custom==='object'){
    parts.forEach(i=>out[i]=+e.custom[i]||0);
    const rest=e.amount-out.reduce((a,b)=>a+b,0); if(Math.abs(rest)>0.001&&parts.length)out[parts[0]]+=rest; return out;
  }
  if(parts.length)parts.forEach(i=>out[i]=e.amount/parts.length);
  return out;
}
function balances(cur){
  const n=S.people.length; const b=new Array(n).fill(0);
  shared().filter(e=>e.cur===cur&&!e.settled).forEach(e=>{ if(e.payer<n)b[e.payer]+=e.amount; sharesOf(e).forEach((s,i)=>{if(i<n)b[i]-=s}); });
  S.transfers.filter(t=>t.cur===cur&&t.kind!=='settle'&&!t.closed).forEach(t=>{ if(t.from<n)b[t.from]+=t.amount; if(t.to<n)b[t.to]-=t.amount; });
  return b;
}
function flows(cur){
  const b=balances(cur).map((v,i)=>({i,v}));
  const cred=b.filter(x=>x.v>0.5).sort((a,b)=>b.v-a.v).map(x=>({...x})), debt=b.filter(x=>x.v<-0.5).sort((a,b)=>a.v-b.v).map(x=>({...x,v:-x.v}));
  const out=[]; let ci=0,di=0;
  while(ci<cred.length&&di<debt.length){const m=Math.min(cred[ci].v,debt[di].v);out.push({from:debt[di].i,to:cred[ci].i,amount:m});cred[ci].v-=m;debt[di].v-=m;if(cred[ci].v<0.5)ci++;if(debt[di].v<0.5)di++}
  return out;
}
function myTotals(cur){
  let paid=0,share=0,priv=0,all=0;
  S.expenses.filter(e=>e.cur===cur).forEach(e=>{
    if(isShared(e)){all+=e.amount; if(e.payer===S.me)paid+=e.amount; share+=sharesOf(e)[S.me]||0}
    else priv+=e.amount;
  });
  return {paid,share,priv,all};
}
const rateLabel=()=>{const ri=S.rateInfo||{};return `1엔 = ${S.rate}원`+(ri.mode==='manual'?' (직접 입력)':(ri.auto?` (${esc(ri.auto.date||'')} ${esc(ri.auto.src||'')} 자동)`:' (기본값)'))};
const balLine=(b,cur)=>Math.abs(b)<0.5?`<b>정산 끝</b>`:(b>0?`받을 돈 <b class="lgnum" style="color:var(--ok)">${fmt(b,cur)}</b>`:`줄 돈 <b class="lgnum" style="color:var(--accent)">${fmt(-b,cur)}</b>`);

/* ---------- 렌더 ---------- */
/* 글 메모 textarea 나 내용이 남아 있는 항목 입력칸에 커서가 있으면 다시 그리지 않는다 (입력 중 내용 보호) */
function isEditing(){ const a=document.activeElement; if(!a||!inRoots(a)||(ov&&ov.contains(a)))return false; if(a.matches('textarea.lgbody'))return true; if(a.matches('[data-addli]')&&a.value)return true; return false; }
function render(){
  if(isEditing()){S.pending=true;return}
  S.pending=false;
  const a=document.activeElement; if(a&&inRoots(a)&&a.matches&&a.matches('[data-addli]'))S.focusAdd=a.dataset.addli;
  let h='';
  if(S.screen==='loading') h=`<div class="lgcard"><div class="lgempty">불러오는 중…</div></div>`;
  else if(S.screen==='error') h=`<div class="lgbanner">⚠️ <div><b>정산 노트를 열지 못했어요.</b> ${esc(S.err)} <button class="lglink" data-act="retry">다시 시도</button></div></div>`;
  else if(S.screen==='setup') h=viewSetup();
  else if(S.screen==='login') h=viewLogin();
  else h=viewMain();
  view.innerHTML=h; bind(view);
  if(memoView){ memoView.innerHTML=S.screen==='main'?viewMemo():viewMemoLocked(); bind(memoView); }
  if(S.focusAdd){const inp=q(`[data-addli="${S.focusAdd}"]`); if(inp)inp.focus(); S.focusAdd=null}
}
function viewSetup(){
  return `<div class="lgauth"><h3>정산 노트 시작</h3><p>같이 쓰는 멤버와 각자 비밀번호를 정해요. 개인 지출·개인 메모는 그 비밀번호로 들어온 사람만 볼 수 있어요. 처음 한 번만 하면 돼요.</p>
  <form id="setupForm">
    <div class="lgf"><label>멤버 (이름 · 숫자 비밀번호 4~8자리)</label><div class="lgmrows" id="setupRows">
      <div class="mr"><input type="text" placeholder="이름 1" maxlength="12" data-n="0" value="은유"><input type="text" inputmode="numeric" class="lgpin" placeholder="비밀번호" maxlength="8" data-p="0"></div>
      <div class="mr"><input type="text" placeholder="이름 2" maxlength="12" data-n="1" value="카뮈"><input type="text" inputmode="numeric" class="lgpin" placeholder="비밀번호" maxlength="8" data-p="1"></div>
    </div><div style="margin-top:8px"><button type="button" class="lglink" data-act="setup-add">+ 멤버 추가</button></div></div>
    <div class="lgf"><label>나는</label><div class="lgchips" id="setupMe"><button type="button" class="lgchip" data-i="0" aria-pressed="true">첫 번째</button><button type="button" class="lgchip" data-i="1" aria-pressed="false">두 번째</button></div></div>
    <div class="lgf"><label>환율 (1엔 = 원) — 비워두면 매일 자동으로 받아와요</label><input type="number" id="setupRate" step="0.01" min="1" placeholder="자동 (지금 ${esc(S.rate)}원)"></div>
    <div class="lgactions"><button type="submit" class="lgbtn lgprimary">시작하기</button></div>
  </form></div>`;
}
function viewLogin(){
  if(!S.people.length) return `<div class="lgauth"><h3>정산 노트</h3><p>아직 멤버가 없어요.</p><div class="lgactions"><button class="lgbtn lgprimary" data-act="retry">새로고침</button></div></div>`;
  const idx=S.loginIdx!==null?S.loginIdx:(+ls.get('tl_me')||0);
  return `<div class="lgauth"><h3>정산 노트</h3><p>누구인지 고르고 비밀번호를 넣어주세요. 이 폰에 기억돼요.</p>
  <form id="loginForm">
    <div class="lgf"><label>나는</label><div class="lgchips" id="loginWho">${S.people.map((p,i)=>`<button type="button" class="lgchip" data-i="${i}" aria-pressed="${i===idx}">${esc(p.name)}</button>`).join('')}</div></div>
    <div class="lgf"><label>비밀번호</label><input type="password" inputmode="numeric" class="lgpin" id="loginPin" maxlength="8" autocomplete="current-password"></div>
    <div class="lgactions"><button type="submit" class="lgbtn lgprimary">들어가기</button></div>
    <div class="lghint">비밀번호를 잊었으면 <button type="button" class="lglink" data-act="forgot">새로 정하기</button> (사이트 입장 비밀번호로 확인해요)</div>
  </form></div>`;
}
function viewMain(){
  let h=`<div class="lg-head"><div class="lgttl">정산 노트</div><div class="lg-head-r"><span class="lgme">${esc(pname(S.me))}</span><button class="lgicon" data-act="settings" aria-label="설정">${svgGear}</button></div></div>`;
  if(S.err) h+=`<div class="lgbanner">⚠️ <div>${esc(S.err)}</div></div>`;
  return h+viewHome();
}
const svgPlus='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
function viewHome(){
  const me=S.me; const sh=shared(); const open=sh.filter(e=>!e.settled);
  const allFlows=[...flows('JPY').map(f=>({...f,cur:'JPY'})),...flows('KRW').map(f=>({...f,cur:'KRW'}))];
  const mine=allFlows.filter(f=>f.from===me||f.to===me), others=allFlows.filter(f=>!(f.from===me||f.to===me));
  // 1) 지금 잔액 — 숫자 하나
  let h=`<div class="lghero2"><div class="lghero-k">지금 잔액</div>`;
  if(!sh.length) h+=`<div class="lghero-v lgmuted-t">아직 공용 지출이 없어요</div><div class="lghero-s">아래 "공용 지출"로 넣으면 자동으로 나눠요.</div>`;
  else if(!allFlows.length) h+=`<div class="lghero-v lgok-t">정산 끝 · 주고받을 돈 없음</div><div class="lghero-s">공용 지출 ${sh.length}건이 모두 정리됐어요.</div>`;
  else{
    mine.forEach(f=>{const recv=f.to===me; h+=`<div class="lgflow2"><div class="lghero-v ${recv?'lgok-t':'lgacc-t'}">${esc(pname(recv?f.from:f.to))}에게 ${recv?'받을 돈':'줄 돈'}<br><b class="lgnum">${fmt(f.amount,f.cur)}</b></div><button class="lgsettlebtn" data-settle="${f.from}|${f.to}|${f.amount}|${f.cur}">${recv?'받았어':'보냈어'}</button></div>`});
    others.forEach(f=>{h+=`<div class="lgflow2"><div class="lghero-v lgmuted-t lgsmall">${esc(pname(f.from))} → ${esc(pname(f.to))} <b class="lgnum">${fmt(f.amount,f.cur)}</b></div><button class="lgsettlebtn lgghost2" data-settle="${f.from}|${f.to}|${f.amount}|${f.cur}">정산됨</button></div>`});
    if(mine.length>1){const net=mine.reduce((a,f)=>a+(f.to===me?1:-1)*(f.cur==='JPY'?f.amount*S.rate:f.amount),0); if(Math.abs(net)>=1)h+=`<div class="lghero-s"><b>엔·원 합치면</b> 약 ${fmt(Math.abs(net),'KRW')} ${net>0?'받을 돈':'줄 돈'} <span class="lgsub">(${rateLabel().split(' (')[0]})</span></div>`}
    h+=`<div class="lghero-s">아직 정산 안 된 공용 지출 ${open.length}건 기준이에요. 돈을 주고받은 뒤 버튼을 누르면 0이 돼요.</div>`;
  }
  h+=`</div>`;
  h+=detailsHtml();
  // 2) 추가 버튼 두 개 — 폼 안에서 고를 게 줄어든다
  h+=`<div class="lgadd2"><button class="lgaddexp" data-act="add-shared">${svgPlus}공용 지출</button><button class="lgaddexp lgaddmine" data-act="add-mine">${svgPlus}내 지출</button></div>`;
  // 3) 목록
  h+=`<div class="lgfilters"><div class="lgseg2"><button data-scope="mine" aria-pressed="${S.scope==='mine'}">개인</button><button data-scope="shared" aria-pressed="${S.scope==='shared'}">공용</button><button data-scope="all" aria-pressed="${S.scope==='all'}">전체</button></div></div>`;
  let list=S.expenses.slice().sort((a,b)=>(b.day||'').localeCompare(a.day||'')||(b.ts||0)-(a.ts||0));
  if(S.scope==='shared')list=list.filter(isShared); else if(S.scope==='mine')list=list.filter(e=>!isShared(e));
  if(!list.length) h+=`<div class="lgcard"><div class="lgempty"><b>${S.scope==='mine'?'내 지출이 아직 없어요':S.scope==='shared'?'공용 지출이 아직 없어요':'아직 지출이 없어요'}</b>${S.scope==='mine'?'"내 지출"은 나만 보여요.':'"공용 지출"은 같이 나눠 계산돼요.'}</div></div>`;
  else{
    const groups=[]; list.forEach(e=>{let g=groups.find(x=>x.day===e.day); if(!g){g={day:e.day,items:[]};groups.push(g)} g.items.push(e)});
    groups.forEach(g=>{
      const sj=g.items.filter(e=>e.cur==='JPY').reduce((a,e)=>a+e.amount,0), sk=g.items.filter(e=>e.cur==='KRW').reduce((a,e)=>a+e.amount,0);
      h+=`<div class="lgsec"><h3>${esc(dayLabel(g.day))}</h3><span class="lgnum">${sj?fmt(sj,'JPY'):''}${sj&&sk?' · ':''}${sk?fmt(sk,'KRW'):''}</span></div><div class="lgcard lgtight">${g.items.map(rowHtml).join('')}</div>`;
    });
    h+=`<div class="lghint" style="text-align:center;margin:10px 0 4px">지출을 누르면 고치거나 지울 수 있어요.</div>`;
  }
  h+=historyHtml();
  return h;
}
function detailsHtml(){
  const sh=shared(); const me=S.me; const n=S.people.length||1;
  if(!S.expenses.length) return '';
  const sum=(arr,cur)=>arr.filter(e=>e.cur===cur).reduce((a,e)=>a+e.amount,0);
  const tj=sum(sh,'JPY'), tk=sum(sh,'KRW'); const total=tj*S.rate+tk;
  const mj=myTotals('JPY'), mk=myTotals('KRW');
  const settledN=sh.filter(e=>e.settled).length;
  const pair=(j,k)=>`${j?fmt(j,'JPY'):''}${j&&k?' + ':''}${k?fmt(k,'KRW'):''}`||'₩0';
  let h=`<details class="lgdetails lgsummary"><summary><span>공용 ${pair(tj,tk)}</span><span class="lgsub">1인 약 ${fmt(total/n,'KRW')} · 자세히</span></summary><div class="lgdetails-b">`;
  h+=`<div class="lgkv"><span>공용 지출 합계</span><span class="lgnum">${pair(tj,tk)} <span class="lgsub">≈ ${fmt(total,'KRW')}</span></span><span>1인 몫 (${n}명)</span><span class="lgnum">≈ ${fmt(total/n,'KRW')}</span><span>내 개인 지출</span><span class="lgnum">${pair(mj.priv,mk.priv)}</span><span>내가 쓴 전체 (공용 몫 + 개인)</span><span class="lgnum">≈ ${fmt((mj.share+mj.priv)*S.rate+mk.share+mk.priv,'KRW')}</span></div>`;
  ['JPY','KRW'].forEach(cur=>{ if(!sh.some(e=>e.cur===cur))return; const b=balances(cur);
    h+=`<div class="lgsubh">${cur==='JPY'?'엔':'원'} · 멤버별</div><div class="lgbal">`;
    S.people.forEach((p,i)=>{let paid=0,share=0; sh.filter(e=>e.cur===cur).forEach(e=>{if(e.payer===i)paid+=e.amount;share+=sharesOf(e)[i]||0}); const v=b[i]||0;
      h+=`<span class="bn">${esc(pname(i))}${i===me?' <span class="lgsub">나</span>':''}<span class="lgsub2">낸 ${fmt(paid,cur)} · 몫 ${fmt(share,cur)}</span></span><span class="bv ${v>0.5?'lgpos':v<-0.5?'lgneg':''}">${v>0.5?'+':''}${fmt(v,cur)}</span>`});
    h+=`</div>`;});
  h+=`<div class="lghint">${rateLabel()}${settledN?` · 정산 완료된 ${settledN}건은 잔액에서 빠져 있어요.`:''}</div></div></details>`;
  return h;
}
function historyHtml(){
  if(!S.transfers.length) return '';
  let h=`<details class="lgdetails"><summary>정산 기록 ${S.transfers.length}건</summary><div class="lgdetails-b lgtight">`;
  S.transfers.slice().sort((a,b)=>(b.ts||0)-(a.ts||0)).forEach(t=>{const kind=t.kind==='settle'?`공용 ${t.n||0}건 정리`:(t.kind==='partial'?'일부 정산':'송금 기록');h+=`<button class="lgrow" data-tr="${esc(t.id)}"><div class="lgmid"><div class="ti">${esc(pname(t.from))} → ${esc(pname(t.to))} <span class="lgsub">${kind}</span></div><div class="si">${esc(new Date(t.ts||0).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}${t.memo?' · '+esc(t.memo):''}</div></div><div class="lgamt"><div class="aa">${fmt(t.amount,t.cur)}</div></div><span class="lgchev" aria-hidden="true"></span></button>`});
  return h+`</div></details>`;
}
function viewMemoLocked(){
  const msg=S.screen==='loading'?'정산 노트 불러오는 중…':S.screen==='error'?'정산 노트 서버에 연결하지 못해서 메모를 못 불러왔어요.':'정산 탭에서 로그인하면 내 메모와 공용 체크리스트가 여기에 나와요.';
  return `<div class="lgcard"><div class="lgempty lgtightempty">${msg}${(S.screen==='login'||S.screen==='setup')?` <button class="lglink" data-act="go-ledger">정산 탭 열기</button>`:''}</div></div>`;
}
function rowHtml(e){
  const me=S.me; const priv=!isShared(e); const sh=sharesOf(e); const parts=sh.map((v,i)=>v>0?i:-1).filter(i=>i>=0);
  let sub, right='';
  if(priv){ sub=`<span>${esc(e.cat||'기타')}</span>`; }
  else{
    const who=parts.length===S.people.length?'':parts.map(pname).join('·')+' 몫';
    sub=`<span class="lgpayer lgp${e.payer%4}">${esc(pname(e.payer))} 냄</span><span>${esc(e.cat||'기타')}${who?' · '+esc(who):''}</span>`;
    const mine=sh[me]||0;
    if(e.settled) right=`<div class="ab">정산 완료</div>`;
    else if(e.payer===me&&parts.length>1) right=`<div class="ab">받을 ${fmt(e.amount-mine,e.cur)}</div>`;
    else if(e.payer!==me&&mine>0) right=`<div class="ab lgowe">내 몫 ${fmt(mine,e.cur)}</div>`;
  }
  return `<button class="lgrow ${!priv&&e.settled?'lgsettled':''}" data-exp="${esc(e.id)}"><div class="lgmid"><div class="ti">${priv?`<span class="lglock">${svgLock}</span>`:''}<span class="lgtrunc">${esc(e.title||'(내용 없음)')}</span></div><div class="si">${sub}${e.memo?`<span class="lgtrunc">· ${esc(e.memo)}</span>`:''}</div></div><div class="lgamt"><div class="aa">${fmt(e.amount,e.cur)}</div>${right}</div><span class="lgchev" aria-hidden="true"></span></button>`;
}
function viewMemo(){
  let h='';
  const secs=[{k:'mine',title:'내 메모',sub:`${pname(S.me)}만 봄`,list:S.memos.filter(m=>ownerOf(m)===S.me)},{k:'shared',title:'공용 메모',sub:'둘 다 보고 체크',list:S.memos.filter(isShared)}];
  secs.forEach(sec=>{
    h+=`<div class="lgsec"><h3>${sec.title} <span class="lgsub">${esc(sec.sub)}</span></h3><button class="lglink" data-newmemo="${sec.k}">+ 추가</button></div>`;
    const list=sec.list.slice().sort((a,b)=>(a.order||a.ts||0)-(b.order||b.ts||0));
    if(!list.length){h+=`<div class="lgcard"><div class="lgempty">${sec.k==='shared'?'살 것 목록이나 가고 싶은 곳처럼 같이 체크할 걸 올려두세요.':'개인 쇼핑 리스트나 일기처럼 나만 볼 걸 써요.'}</div></div>`;return}
    list.forEach(m=>{h+=memoHtml(m)});
  });
  h+=`<div class="lghint" style="text-align:center;margin:10px 0 14px">"편집"에서 제목·공용/개인·삭제, 항목은 글자를 누르면 수정, ×로 삭제해요.</div>`;
  return h;
}
function memoHtml(m){
  const priv=!isShared(m);
  let h=`<div class="lgmemo" data-memo="${esc(m.id)}"><div class="lgmh"><button class="lgtt" data-memoedit="${esc(m.id)}">${priv?`<span class="lglock">${svgLock}</span>`:''}${m.title?esc(m.title):`<span class="lgph">${m.type==='text'?'제목 없는 글':'제목 없는 리스트'}</span>`}</button><button class="lgaddbtn" data-memoedit="${esc(m.id)}">편집</button></div>`;
  if(m.type==='text'){
    h+=`<textarea class="lgbody" data-body="${esc(m.id)}" placeholder="여기에 그냥 써요. 줄바꿈 그대로 보여요." rows="3">${esc(m.body||'')}</textarea><div class="lgsaverow"><span class="lgsave" data-mark="${esc(m.id)}"></span><button type="button" class="lgaddbtn" data-savebody="${esc(m.id)}">저장</button></div>`;
  }else{
    const items=(m.items||[]).slice().sort((a,b)=>(a.done?1:0)-(b.done?1:0)); const done=items.filter(i=>i.done).length;
    items.forEach(it=>{const who=(!priv&&it.who!==null&&it.who!==undefined&&it.who!==''&&S.people[+it.who])?+it.who:null;
      const whoTag=priv?'':`<button class="lgwho ${who===null?'lgwho-none':who===S.me?'lgwho-me':''}" data-liwho="${esc(m.id)}|${esc(it.id)}" aria-label="담당 바꾸기">${who===null?'담당':esc(pname(who))}</button>`;
      h+=`<div class="lgli ${it.done?'lgdone':''}"><button class="lgbox" data-li="${esc(m.id)}|${esc(it.id)}" aria-label="완료">${svgCheck}</button><button class="lgtx" data-liedit="${esc(m.id)}|${esc(it.id)}"><span>${esc(it.text)}</span></button>${whoTag}<button class="lgx" data-lidel="${esc(m.id)}|${esc(it.id)}" aria-label="삭제">${svgX}</button></div>`});
    const pre=S.addWho&&S.addWho[m.id]; const preIdx=(pre===undefined||pre===null)?null:+pre;
    h+=`<form class="lgaddli" data-addform="${esc(m.id)}"><span class="lgplus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><input type="text" data-addli="${esc(m.id)}" placeholder="항목 추가" autocomplete="off" maxlength="200">${priv?'':`<button type="button" class="lgwho ${preIdx===null?'lgwho-none':preIdx===S.me?'lgwho-me':''}" data-addwho="${esc(m.id)}" aria-label="새 항목 담당">${preIdx===null?'담당':esc(pname(preIdx))}</button>`}<button type="submit" class="lgaddbtn">입력</button></form>`;
    if(items.length)h+=`<div class="lgsave" style="text-align:right">${done}/${items.length} 완료</div>`;
  }
  return h+`</div>`;
}
/* ---------- 바인딩 ---------- */
function bind(c){
  qa('[data-act]',c).forEach(b=>b.onclick=()=>{const a=b.dataset.act; if(a==='retry'){S.screen='loading';render();boot()} else if(a==='settings')openSettings(); else if(a==='setup-add')setupAddRow(); else if(a==='add-shared')openExpense(null,{priv:false}); else if(a==='add-mine')openExpense(null,{priv:true}); else if(a==='forgot')openForgot(); else if(a==='go-ledger'){const t=[...document.querySelectorAll('[role="tab"][data-tab="ledger"]')].find(x=>!x.closest('.lg')); if(t)t.click(); else location.href='ledger.html';}});
  qa('[data-scope]',c).forEach(b=>b.onclick=()=>{S.scope=b.dataset.scope;render()});
  qa('[data-exp]',c).forEach(b=>b.onclick=()=>openExpense(S.expenses.find(e=>e.id===b.dataset.exp)));
  qa('[data-tr]',c).forEach(b=>b.onclick=()=>openRecord(S.transfers.find(t=>t.id===b.dataset.tr)));
  qa('[data-settle]',c).forEach(b=>b.onclick=()=>{const [f,t,a,cur]=b.dataset.settle.split('|');openSettle({from:+f,to:+t,amount:+a,cur})});
  qa('[data-newmemo]',c).forEach(b=>b.onclick=()=>chooseMemo(b.dataset.newmemo==='mine'?S.me:null));
  qa('[data-memoedit]',c).forEach(b=>b.onclick=()=>openMemo(S.memos.find(m=>m.id===b.dataset.memoedit)));
  qa('[data-li]',c).forEach(b=>b.onclick=()=>{const [mid,iid]=b.dataset.li.split('|');toggleItem(mid,iid)});
  qa('[data-lidel]',c).forEach(b=>b.onclick=()=>{const [mid,iid]=b.dataset.lidel.split('|');delItem(mid,iid)});
  qa('[data-liedit]',c).forEach(b=>b.onclick=()=>{const [mid,iid]=b.dataset.liedit.split('|');openItem(mid,iid)});
  qa('[data-liwho]',c).forEach(b=>b.onclick=()=>{const [mid,iid]=b.dataset.liwho.split('|');cycleWho(mid,iid)});
  qa('[data-addwho]',c).forEach(b=>b.onclick=()=>{S.addWho=S.addWho||{};const cur=S.addWho[b.dataset.addwho];const next=nextWho(cur===undefined?null:cur);S.addWho[b.dataset.addwho]=next;const inp=q(`[data-addli="${b.dataset.addwho}"]`);const val=inp?inp.value:'';render();const inp2=q(`[data-addli="${b.dataset.addwho}"]`);if(inp2){inp2.value=val}});
  qa('[data-addform]',c).forEach(f=>f.onsubmit=ev=>{ev.preventDefault();const inp=f.querySelector('input');const t=inp.value.trim();if(!t)return;inp.value='';addItem(f.dataset.addform,t)});
  qa('[data-savebody]',c).forEach(b=>b.onclick=async()=>{const id=b.dataset.savebody;const ta=q(`[data-body="${id}"]`);if(ta)queueBody(id,ta.value);await flushBody(id);toast('저장했어요')});
  qa('textarea.lgbody',c).forEach(ta=>{autosize(ta); ta.oninput=()=>{autosize(ta);queueBody(ta.dataset.body,ta.value)}; ta.onblur=()=>{flushBody(ta.dataset.body); if(S.pending)setTimeout(()=>{if(!isEditing())render()},50)}; });
  qa('input',c).forEach(i=>{i.addEventListener('blur',()=>{if(S.pending)setTimeout(()=>{if(!isEditing())render()},50)})});
  // setup / login (정산 탭 쪽에만 있다)
  const sf=q('#setupForm',c); if(sf){
    qa('#setupMe .lgchip',c).forEach(b=>b.onclick=()=>qa('#setupMe .lgchip',c).forEach(x=>x.setAttribute('aria-pressed',x===b)));
    sf.onsubmit=async ev=>{ev.preventDefault();
      const rows=qa('#setupRows .mr',c).map(r=>({name:r.querySelector('[data-n]').value.trim(),pin:r.querySelector('[data-p]').value.trim()})).filter(r=>r.name||r.pin);
      if(rows.length<2||rows.some(r=>!r.name||!/^\d{4,8}$/.test(r.pin))){toast('이름과 4~8자리 숫자 비밀번호를 모두 넣어주세요');return}
      const me=+(qa('#setupMe .lgchip[aria-pressed="true"]',c)[0]||{dataset:{i:0}}).dataset.i;
      const btn=sf.querySelector('button[type=submit]'); btn.disabled=true;
      try{const j=await api({action:'setup',people:rows,rate:parseFloat(q('#setupRate',c).value)||0,me}); S.token=j.token; ls.set('tl_token',j.token); ls.set('tl_me',String(j.me)); S.screen='loading'; render(); await load();}
      catch(e){btn.disabled=false; if(e.code==='already_setup'){toast('이미 시작된 노트예요');S.screen='loading';render();boot()} else toast(e.message||'실패했어요')}
    };
  }
  const lf=q('#loginForm',c); if(lf){
    qa('#loginWho .lgchip',c).forEach(b=>b.onclick=()=>{S.loginIdx=+b.dataset.i;qa('#loginWho .lgchip',c).forEach(x=>x.setAttribute('aria-pressed',x===b));q('#loginPin',c).focus()});
    lf.onsubmit=async ev=>{ev.preventDefault();
      const me=+(qa('#loginWho .lgchip[aria-pressed="true"]',c)[0]||{dataset:{i:0}}).dataset.i; const pin=q('#loginPin',c).value.trim();
      if(!pin){toast('비밀번호를 넣어주세요');return}
      const btn=lf.querySelector('button[type=submit]'); btn.disabled=true;
      try{const j=await api({action:'login',me,pin}); S.token=j.token; ls.set('tl_token',j.token); ls.set('tl_me',String(j.me)); S.screen='loading'; render(); await load();}
      catch(e){btn.disabled=false; toast(e.code==='pin'?`${pname(me)} 비밀번호가 맞지 않아요`:(e.message||'실패했어요')); q('#loginPin',c).value=''; q('#loginPin',c).focus();}
    };
  }
}
function setupAddRow(){ const rows=q('#setupRows',view); const n=rows.children.length; if(n>=6)return; const d=document.createElement('div'); d.className='mr'; d.innerHTML=`<input type="text" placeholder="이름 ${n+1}" maxlength="12" data-n="${n}"><input type="text" inputmode="numeric" class="lgpin" placeholder="비밀번호" maxlength="8" data-p="${n}">`; rows.appendChild(d); const me=q('#setupMe',view); const b=document.createElement('button'); b.type='button'; b.className='lgchip'; b.dataset.i=n; b.setAttribute('aria-pressed','false'); b.textContent=['첫','두','세','네','다섯','여섯'][n]+' 번째'; b.onclick=()=>qa('#setupMe .lgchip',view).forEach(x=>x.setAttribute('aria-pressed',x===b)); me.appendChild(b); }
function autosize(ta){ ta.style.height='auto'; ta.style.height=Math.max(72,ta.scrollHeight+2)+'px'; }

/* 메모 동작 */
const bodyTimers={};
function queueBody(id,val){ const m=S.memos.find(x=>x.id===id); if(m)m.body=val; const mark=q(`[data-mark="${id}"]`); if(mark)mark.textContent='입력 중…'; clearTimeout(bodyTimers[id]); bodyTimers[id]=setTimeout(()=>flushBody(id),900); }
async function flushBody(id){ clearTimeout(bodyTimers[id]); const m=S.memos.find(x=>x.id===id); if(!m||m._saved===m.body)return; const val=m.body||''; const ok=await write([{op:'update',col:'memos',id,data:{body:val}}],null,{silent:true}); if(ok){m._saved=val; const mark=q(`[data-mark="${id}"]`); if(mark){mark.textContent='저장됨'; setTimeout(()=>{if(mark.textContent==='저장됨')mark.textContent=''},1500)}} }
async function newMemo(type,owner){
  const id=uid(); const order=Date.now();
  const ok=await write([{op:'set',col:'memos',id,data:{type,owner,title:'',items:[],body:'',ts:order,order}}]);
  if(ok){ if(type==='list'){S.focusAdd=id;render()} else {const ta=q(`[data-body="${id}"]`); if(ta)ta.focus()} }
}
function chooseMemo(owner){
  openSheet(`<h2>${owner===null?'공용 메모 추가':'내 메모 추가'}<button type="button" data-close>닫기</button></h2><div class="lgopts">
    <button type="button" data-mk="list"><span class="lgic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg></span><div><b>체크 리스트</b><span>항목을 하나씩 넣고 체크해요. 살 것, 할 일.</span></div></button>
    <button type="button" data-mk="text"><span class="lgic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14M5 10h14M5 15h9"/></svg></span><div><b>글</b><span>그냥 써요. 줄바꿈 그대로 남아요. 메모, 일기.</span></div></button></div>`);
  qa('[data-mk]',q('.lgsheet')).forEach(b=>b.onclick=()=>{closeSheet();newMemo(b.dataset.mk,owner)});
}
function memoItems(m){return (m.items||[]).map(x=>({...x}))}
const nextWho=cur=>{const n=S.people.length; if(cur===null||cur===undefined)return 0; return cur+1>=n?null:cur+1};
async function cycleWho(mid,iid){ const m=S.memos.find(x=>x.id===mid); if(!m)return; const items=memoItems(m).map(it=>{if(it.id!==iid)return it; const cur=(it.who===null||it.who===undefined||it.who==='')?null:+it.who; return {...it,who:nextWho(cur)}}); await write([{op:'update',col:'memos',id:mid,data:{items}}]); }
async function addItem(mid,text){ const m=S.memos.find(x=>x.id===mid); if(!m)return; const pre=S.addWho&&S.addWho[mid]; const who=isShared(m)&&pre!==undefined&&pre!==null?+pre:null; const items=[...memoItems(m),{id:uid(),text,done:false,who,ts:Date.now()}]; S.focusAdd=mid; await write([{op:'update',col:'memos',id:mid,data:{items}}]); }
async function toggleItem(mid,iid){ const m=S.memos.find(x=>x.id===mid); if(!m)return; const items=memoItems(m).map(it=>it.id===iid?{...it,done:!it.done,doneBy:!it.done?S.me:null}:it); await write([{op:'update',col:'memos',id:mid,data:{items}}]); }
async function delItem(mid,iid){ const m=S.memos.find(x=>x.id===mid); if(!m)return; const items=memoItems(m).filter(it=>it.id!==iid); await write([{op:'update',col:'memos',id:mid,data:{items}}]); }
function openItem(mid,iid){
  const m=S.memos.find(x=>x.id===mid); const it=m&&(m.items||[]).find(x=>x.id===iid); if(!it)return;
  const sharedMemo=isShared(m); let who=(it.who===null||it.who===undefined||it.who==='')?null:+it.who;
  openSheet(`<h2>항목 수정<button type="button" data-close>닫기</button></h2><form id="itemForm"><div class="lgf"><label>내용</label><textarea id="itText" maxlength="500">${esc(it.text)}</textarea></div>
    ${sharedMemo?`<div class="lgf"><label>담당</label><div class="lgchips" id="itWho"><button type="button" class="lgchip lgsm" data-w="" aria-pressed="${who===null}">없음</button>${S.people.map((p,i)=>`<button type="button" class="lgchip lgsm" data-w="${i}" aria-pressed="${who===i}">${esc(pname(i))}${i===S.me?' (나)':''}</button>`).join('')}</div><div class="lghint">누가 챙길지 정해두면 항목 옆에 이름이 붙어요.</div></div>`:''}
    <div class="lgactions"><button type="button" class="lgbtn lgdanger" id="itDel">삭제</button><button type="submit" class="lgbtn lgprimary">저장</button></div></form>`);
  const sh=q('.lgsheet');
  qa('#itWho .lgchip',sh).forEach(b=>b.onclick=()=>{who=b.dataset.w===''?null:+b.dataset.w;qa('#itWho .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',x===b))});
  q('#itemForm',sh).onsubmit=async ev=>{ev.preventDefault();const t=q('#itText',sh).value.trim();if(!t)return;const items=memoItems(m).map(x=>x.id===iid?{...x,text:t,who:sharedMemo?who:null}:x);closeSheet();await write([{op:'update',col:'memos',id:mid,data:{items}}])};
  arm(q('#itDel',sh),async()=>{closeSheet();await delItem(mid,iid)});
  setTimeout(()=>q('#itText',sh).focus(),250);
}
function openMemo(m){
  if(!m)return;
  const d={title:m.title||'',owner:ownerOf(m)};
  openSheet(`<h2>메모 설정<button type="button" data-close>닫기</button></h2><form id="memoForm">
    <div class="lgf"><label>제목</label><input type="text" id="mTitle" value="${esc(d.title)}" maxlength="40" placeholder="${m.type==='text'?'예: 하라주쿠에서 느낀 것':'예: 돈키호테 살 것'}"></div>
    <div class="lgf"><label>누가 보나</label><div class="lgchips" id="mOwner"><button type="button" class="lgchip" data-o="mine" aria-pressed="${d.owner!==null}">개인 · 나만</button><button type="button" class="lgchip" data-o="shared" aria-pressed="${d.owner===null}">공용 · 모두</button></div><div class="lghint">개인으로 바꾸면 다른 멤버 화면에서 바로 사라져요.</div></div>
    <div class="lgactions"><button type="button" class="lgbtn lgdanger" id="mDel">삭제</button><button type="submit" class="lgbtn lgprimary">저장</button></div></form>`);
  const sh=q('.lgsheet');
  qa('#mOwner .lgchip',sh).forEach(b=>b.onclick=()=>{d.owner=b.dataset.o==='shared'?null:S.me;qa('#mOwner .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',x===b))});
  q('#memoForm',sh).onsubmit=async ev=>{ev.preventDefault();closeSheet();await write([{op:'update',col:'memos',id:m.id,data:{title:q('#mTitle',sh).value.trim(),owner:d.owner}}],'저장했어요')};
  arm(q('#mDel',sh),async()=>{closeSheet();await write([{op:'delete',col:'memos',id:m.id}],'삭제했어요')});
}
function arm(btn,fn){ if(!btn)return; btn.onclick=()=>{ if(btn.dataset.arm!=='1'){btn.dataset.arm='1';const o=btn.textContent;btn.textContent='정말 삭제?';setTimeout(()=>{btn.dataset.arm='';btn.textContent=o},2500);return} fn(); }; }

/* ---------- 시트 ---------- */
function openSheet(html){ q('.lgsheet .lgin',ov).innerHTML=`<div class="lggrab"></div>`+html; q('.lgsheet',ov).classList.add('lgopen'); q('.lgscrim',ov).classList.add('lgopen'); document.body.style.overflow='hidden'; qa('[data-close]',ov).forEach(b=>b.onclick=closeSheet); q('.lgsheet',ov).scrollTop=0; }
function closeSheet(){ q('.lgsheet').classList.remove('lgopen'); q('.lgscrim').classList.remove('lgopen'); document.body.style.overflow=''; }

function openExpense(e,opts={}){
  const isNew=!e; const n=S.people.length; const today=todayKey();
  const d={id:e?.id,title:e?.title||'',amount:e?.amount||'',cur:e?.cur||'JPY',day:e?.day||today,cat:e?.cat||'식비',
    priv:e?!isShared(e):!!opts.priv,payer:e?e.payer:S.me,parts:e?(e.parts&&e.parts.length?e.parts.slice():[...Array(n).keys()]):[...Array(n).keys()],custom:e?.custom?{...e.custom}:null,memo:e?.memo||'',settled:!!(e&&e.settled)};
  const moreOpen=!isNew&&(!!d.custom||(!d.priv&&d.parts.length!==n)||!!d.memo||d.settled);
  const dayShort=k=>{const x=dayOf(k);return k===today?'오늘':(x.d==='pre'?'출발 전':`D${x.n}`)};
  openSheet(`<h2><span id="fHead">${isNew?(d.priv?'내 지출':'공용 지출'):'지출 수정'}</span><button type="button" data-close>닫기</button></h2><form id="expForm">
    <div class="lgf"><div class="lgamount"><input type="text" inputmode="decimal" id="fAmt" placeholder="0" value="${d.amount?esc(d.amount):''}" aria-label="금액"><div class="lgseg" id="fCur"><button type="button" data-c="JPY" aria-pressed="${d.cur==='JPY'}">¥</button><button type="button" data-c="KRW" aria-pressed="${d.cur==='KRW'}">₩</button></div></div></div>
    <div class="lgf"><input type="text" id="fTitle" placeholder="무엇에 썼어요? 예: 모츠나베, 리무진 버스" value="${esc(d.title)}" maxlength="80" aria-label="내용"></div>
    <div class="lgf" id="fPayerBox" ${d.priv?'hidden':''}><label>누가 냈어요?</label><div class="lgbig2" id="fPayer">${S.people.map((p,i)=>`<button type="button" data-i="${i}" aria-pressed="${d.payer===i}">${esc(pname(i))}${i===S.me?' <small>나</small>':''}</button>`).join('')}</div><div class="lghint" id="fPartsHint"></div></div>
    <details class="lgmore" id="fMore" ${moreOpen?'open':''}><summary><span>자세히</span><span class="lgsub" id="fMoreSum"></span></summary>
      <div class="lgf"><label>구분</label><div class="lgchips" id="fScope"><button type="button" class="lgchip" data-s="mine" aria-pressed="${d.priv}">개인 · 나만 봄</button><button type="button" class="lgchip" data-s="shared" aria-pressed="${!d.priv}">공용 · 같이 나눔</button></div></div>
      <div class="lgf"><label>날짜</label><div class="lgchips" id="fDay">${ALLDAYS.map(x=>`<button type="button" class="lgchip lgsm" data-d="${x.d}" aria-pressed="${d.day===x.d}">${x.d==='pre'?'출발 전':`D${x.n} ${x.s} ${x.w}`}</button>`).join('')}</div></div>
      <div class="lgf"><label>카테고리</label><div class="lgchips" id="fCat">${CATS.map(c=>`<button type="button" class="lgchip lgsm" data-c="${c}" aria-pressed="${d.cat===c}">${c}</button>`).join('')}</div></div>
      <div id="fSharedBox" ${d.priv?'hidden':''}>
        <div class="lgf"><label>누구 몫으로 나눌까</label><div class="lgchips" id="fParts">${S.people.map((p,i)=>`<button type="button" class="lgchip" data-i="${i}" aria-pressed="${d.parts.includes(i)}">${esc(pname(i))}</button>`).join('')}</div></div>
        <div class="lgf"><div class="lgtoggle"><span>금액 직접 나누기</span><input type="checkbox" id="fCustom" ${d.custom?'checked':''}></div><div id="fCustomBox" ${d.custom?'':'hidden'}><div class="lgpamts" id="fCustomAmts"></div><div class="lghint" id="fCustomHint"></div></div></div>
        ${isNew?'':`<div class="lgf"><div class="lgtoggle"><span>이 건은 정산 완료 <span class="lgsub">잔액에서 뺌</span></span><input type="checkbox" id="fSettled" ${d.settled?'checked':''}></div></div>`}
      </div>
      <div class="lgf"><label>메모</label><input type="text" id="fMemo" placeholder="영수증, 누구 거 샀는지 등" value="${esc(d.memo)}" maxlength="120"></div>
    </details>
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgdanger" id="fDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary" id="fSave">${isNew?'저장':'수정 저장'}</button></div></form>`);
  const sh=q('.lgsheet',ov); const g=s=>q(s,sh);
  const amt=()=>parseNum(g('#fAmt').value);
  const sum=()=>{const bits=[dayShort(d.day),d.cat]; if(!d.priv){ if(d.parts.length!==n)bits.push(d.parts.map(pname).join('·')+' 몫'); if(g('#fCustom').checked)bits.push('직접 나눔'); } if(d.memo)bits.push('메모'); g('#fMoreSum').textContent=bits.join(' · ')};
  const partsHint=()=>{const a=amt(),k=d.parts.length; const el=g('#fPartsHint'); if(d.priv){el.textContent='';return} el.textContent=k===0?'나눌 사람을 "자세히"에서 골라주세요':k===1?(d.parts[0]===d.payer?`${pname(d.payer)} 혼자 몫 — 나눔 없음`:`${pname(d.parts[0])} 몫 전액 → ${pname(d.payer)}에게 ${fmt(a,d.cur)}`):(a>0?`${k}명이 1인 ${fmt(a/k,d.cur)}씩`:`${k}명이 똑같이 나눠요`)};
  const customHint=()=>{if(!g('#fCustom').checked)return;const s=d.parts.reduce((t,i)=>t+(d.custom&&+d.custom[i]||0),0);const rest=amt()-s;const el=g('#fCustomHint');el.className='lghint'+(Math.abs(rest)>0.5?' bad':'');el.textContent=Math.abs(rest)>0.5?`합계 ${fmt(s,d.cur)} · 남는 ${fmt(rest,d.cur)}은 ${pname(d.parts[0]??d.payer)}에게 붙어요`:'합계가 딱 맞아요'};
  const customBox=()=>{const box=g('#fCustomAmts'); box.innerHTML=d.parts.map(i=>`<label>${esc(pname(i))}<input type="text" inputmode="decimal" data-ci="${i}" value="${d.custom&&d.custom[i]?esc(d.custom[i]):''}" placeholder="0"></label>`).join(''); box.querySelectorAll('input').forEach(inp=>inp.oninput=()=>{d.custom=d.custom||{};d.custom[inp.dataset.ci]=parseNum(inp.value);customHint()}); customHint()};
  const setScope=priv=>{d.priv=priv; qa('#fScope .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',(x.dataset.s==='mine')===priv)); g('#fSharedBox').hidden=priv; g('#fPayerBox').hidden=priv; if(isNew)g('#fHead').textContent=priv?'내 지출':'공용 지출'; partsHint(); sum()};
  qa('#fScope .lgchip',sh).forEach(b=>b.onclick=()=>setScope(b.dataset.s==='mine'));
  g('#fAmt').oninput=()=>{partsHint();customHint()};
  g('#fMemo').oninput=()=>{d.memo=g('#fMemo').value;sum()};
  qa('#fCur button',sh).forEach(b=>b.onclick=()=>{d.cur=b.dataset.c;qa('#fCur button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));partsHint();customHint()});
  qa('#fDay button',sh).forEach(b=>b.onclick=()=>{d.day=b.dataset.d;qa('#fDay button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));sum()});
  qa('#fCat button',sh).forEach(b=>b.onclick=()=>{d.cat=b.dataset.c;qa('#fCat button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));sum()});
  qa('#fPayer button',sh).forEach(b=>b.onclick=()=>{d.payer=+b.dataset.i;qa('#fPayer button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));partsHint()});
  qa('#fParts button',sh).forEach(b=>b.onclick=()=>{const i=+b.dataset.i;d.parts=d.parts.includes(i)?d.parts.filter(x=>x!==i):[...d.parts,i].sort();b.setAttribute('aria-pressed',d.parts.includes(i));partsHint();sum();if(g('#fCustom').checked)customBox()});
  g('#fCustom').onchange=()=>{g('#fCustomBox').hidden=!g('#fCustom').checked;if(g('#fCustom').checked)customBox();sum()};
  partsHint(); sum(); if(d.custom)customBox();
  g('#expForm').onsubmit=async ev=>{ev.preventDefault();
    const a=amt(); if(!(a>0)){toast('금액을 넣어주세요');g('#fAmt').focus();return}
    let body;
    if(d.priv) body={owner:S.me,title:g('#fTitle').value.trim(),amount:a,cur:d.cur,day:d.day,cat:d.cat,payer:S.me,parts:[S.me],custom:null,memo:g('#fMemo').value.trim(),ts:e?.ts||Date.now()};
    else{ if(!d.parts.length){toast('나눌 사람을 골라주세요');g('#fMore').open=true;return}
      const useCustom=g('#fCustom').checked; const custom=useCustom?Object.fromEntries(d.parts.map(i=>[i,+(d.custom&&d.custom[i])||0])):null;
      const settled=isNew?false:!!g('#fSettled').checked;
      body={owner:null,title:g('#fTitle').value.trim(),amount:a,cur:d.cur,day:d.day,cat:d.cat,payer:d.payer,parts:d.parts,custom,memo:g('#fMemo').value.trim(),ts:e?.ts||Date.now(),settled,settledBy:settled?(e&&e.settledBy!==undefined&&e.settledBy!==null?e.settledBy:S.me):null,settleId:settled?(e&&e.settleId)||null:null}; }
    closeSheet();
    await write([{op:'set',col:'expenses',id:d.id||uid(),data:body}],isNew?'저장했어요':'수정했어요');
  };
  arm(g('#fDel'),async()=>{closeSheet();await write([{op:'delete',col:'expenses',id:d.id}],'삭제했어요')});
  setTimeout(()=>{if(isNew)g('#fAmt').focus()},250);
}
/* 정산 완료: 잔액만큼 주고받았으면 그 통화의 공용 지출을 전부 "정산 완료"로 표시 (잔액 0). 일부만 보냈으면 그 금액만 기록. */
function openSettle(f){
  const me=S.me; const recv=f.to===me; const full=Math.round(f.amount); const sym=(CUR[f.cur]||CUR.JPY).sym;
  const targets=shared().filter(e=>e.cur===f.cur&&!e.settled); const openTr=S.transfers.filter(t=>t.cur===f.cur&&t.kind!=='settle'&&!t.closed);
  const single=flows(f.cur).length===1;
  openSheet(`<h2>${recv?'받았어':f.from===me?'보냈어':'정산 기록'}<button type="button" data-close>닫기</button></h2><form id="stForm">
    <div class="lgsettlehead"><span class="fp">${esc(pname(f.from))}</span><span class="lgarr">→</span><span class="fp">${esc(pname(f.to))}</span><b class="lgnum">${fmt(full,f.cur)}</b></div>
    <div class="lgf"><label>실제 주고받은 금액</label><div class="lgamount"><input type="text" inputmode="decimal" id="stAmt" value="${full}"><div class="lgseg"><button type="button" aria-pressed="true" tabindex="-1">${sym}</button></div></div><div class="lghint" id="stHint"></div></div>
    <div class="lgf"><label>메모</label><input type="text" id="stMemo" placeholder="현금, 토스, 카카오페이 등" maxlength="80"></div>
    <div class="lgactions"><button type="submit" class="lgbtn lgprimary">정산 완료</button></div></form>`);
  const sh=q('.lgsheet',ov); const g=s=>q(s,sh);
  const isFull=()=>single&&parseNum(g('#stAmt').value)>=full-0.5;
  const hint=()=>{const a=parseNum(g('#stAmt').value); g('#stHint').textContent=isFull()?`공용 지출 ${targets.length}건(${f.cur==='JPY'?'엔':'원'})이 모두 정산 완료로 표시되고 잔액이 0이 돼요.`:(a>0?`${fmt(a,f.cur)}만 기록해요. 남은 ${fmt(Math.max(0,full-a),f.cur)}은 잔액에 그대로 남아요.`:'')};
  g('#stAmt').oninput=hint; hint();
  g('#stForm').onsubmit=async ev=>{ev.preventDefault(); const a=parseNum(g('#stAmt').value); if(!(a>0)){toast('금액을 넣어주세요');return}
    const sid=uid(); const ops=[]; const fullNow=isFull();
    if(fullNow){ targets.forEach(e=>ops.push({op:'update',col:'expenses',id:e.id,data:{settled:true,settledBy:me,settleId:sid}})); openTr.forEach(t=>ops.push({op:'update',col:'transfers',id:t.id,data:{closed:sid}})); }
    ops.push({op:'set',col:'transfers',id:sid,data:{from:f.from,to:f.to,amount:a,cur:f.cur,memo:g('#stMemo').value.trim(),ts:Date.now(),kind:fullNow?'settle':'partial',n:fullNow?targets.length:0}});
    closeSheet(); await write(ops,fullNow?'정산 완료! 잔액 0':'일부 정산을 기록했어요'); };
}
function openForgot(){
  const idx=S.loginIdx!==null?S.loginIdx:(+ls.get('tl_me')||0);
  openSheet(`<h2>비밀번호 새로 정하기<button type="button" data-close>닫기</button></h2><form id="fgForm">
    <p class="lghint" style="margin:0 0 12px">사이트에 들어올 때 쓴 입장 비밀번호로 본인 확인을 하고, 멤버 비밀번호를 새로 정해요.</p>
    <div class="lgf"><label>누구 비밀번호를 바꿀까</label><div class="lgchips" id="fgWho">${S.people.map((p,i)=>`<button type="button" class="lgchip" data-i="${i}" aria-pressed="${i===idx}">${esc(p.name)}</button>`).join('')}</div></div>
    <div class="lgf"><label>사이트 입장 비밀번호</label><input type="password" id="fgSite" autocomplete="off"></div>
    <div class="lgf"><label>새 멤버 비밀번호 (숫자 4~8자리)</label><input type="text" inputmode="numeric" class="lgpin" id="fgPin" maxlength="8" autocomplete="off"></div>
    <div class="lgactions"><button type="submit" class="lgbtn lgprimary">바꾸고 들어가기</button></div></form>`);
  const sh=q('.lgsheet',ov); const g=s=>q(s,sh); let who=idx;
  qa('#fgWho .lgchip',sh).forEach(b=>b.onclick=()=>{who=+b.dataset.i;qa('#fgWho .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',x===b))});
  g('#fgForm').onsubmit=async ev=>{ev.preventDefault(); const pin=g('#fgPin').value.trim(); if(!/^\d{4,8}$/.test(pin)){toast('숫자 4~8자리로 정해주세요');return}
    const btn=g('#fgForm button[type=submit]'); btn.disabled=true;
    try{const j=await api({action:'resetPin',sitePw:g('#fgSite').value,me:who,pin}); closeSheet(); S.token=j.token; ls.set('tl_token',j.token); ls.set('tl_me',String(j.me)); S.screen='loading'; render(); await load(); toast('비밀번호를 바꿨어요')}
    catch(e){btn.disabled=false; toast(e.code==='site_pw'?'사이트 입장 비밀번호가 맞지 않아요':e.code==='no_site_pw'?'사이트 입장 비밀번호가 설정돼 있지 않아요':(e.message||'실패했어요'))}
  };
  setTimeout(()=>g('#fgSite').focus(),250);
}
function openRecord(t){
  if(!t)return;
  const isSettle=t.kind==='settle';
  openSheet(`<h2>정산 기록<button type="button" data-close>닫기</button></h2>
    <div class="lgsettlehead"><span class="fp">${esc(pname(t.from))}</span><span class="lgarr">→</span><span class="fp">${esc(pname(t.to))}</span><b class="lgnum">${fmt(t.amount,t.cur)}</b></div>
    <div class="lgkv"><span>언제</span><span>${esc(new Date(t.ts||0).toLocaleString('ko-KR'))}</span><span>종류</span><span>${isSettle?`공용 지출 ${t.n||0}건을 정산 완료로 정리`:(t.kind==='partial'?'일부 정산 (잔액에서 뺌)':'송금 기록 (잔액에서 뺌)')}</span>${t.memo?`<span>메모</span><span>${esc(t.memo)}</span>`:''}</div>
    <div class="lghint">${isSettle?'되돌리면 그때 정리된 지출이 다시 잔액에 들어가요.':'지우면 잔액에 다시 반영돼요.'}</div>
    <div class="lgactions"><button type="button" class="lgbtn lgdanger" id="rDel" style="flex:1">${isSettle?'이 정산 되돌리기':'기록 지우기'}</button></div>`);
  arm(q('#rDel',ov),async()=>{closeSheet(); const ops=[];
    if(isSettle){ S.expenses.forEach(e=>{if(e.settleId===t.id)ops.push({op:'update',col:'expenses',id:e.id,data:{settled:false,settledBy:null,settleId:null}})}); S.transfers.forEach(x=>{if(x.closed===t.id)ops.push({op:'update',col:'transfers',id:x.id,data:{closed:null}})}); }
    ops.push({op:'delete',col:'transfers',id:t.id});
    await write(ops,isSettle?'되돌렸어요':'지웠어요'); });
}
function openSettings(){
  openSheet(`<h2>설정<button type="button" data-close>닫기</button></h2><form id="setForm">
    <div class="lgf"><label>멤버 이름</label><div class="lgmrows" id="sNames">${S.people.map((p,i)=>`<div class="mr" style="grid-template-columns:1fr auto"><input type="text" data-n="${i}" value="${esc(p.name)}" maxlength="12"><span class="lghint" style="margin:0;align-self:center;width:52px;text-align:right">${i===S.me?'나':''}</span></div>`).join('')}</div></div>
    <div class="lgf"><div class="lgtoggle"><span>환율 매일 자동으로 받기</span><input type="checkbox" id="sAuto" ${S.rateInfo&&S.rateInfo.mode==='manual'?'':'checked'}></div>
      <div class="lghint" id="sAutoHint">${S.rateInfo&&S.rateInfo.auto?`지금 자동값: 1엔 = ${esc(S.rateInfo.auto.value)}원 (${esc(S.rateInfo.auto.date||'')} ${esc(S.rateInfo.auto.src||'')} 기준). 하루 한 번 갱신돼요. 카드사 환율과는 조금 달라요.`:'아직 자동 환율을 못 받아왔어요. 네트워크가 되면 하루 한 번 받아와요.'}</div></div>
    <div class="lgf" id="sRateBox" ${S.rateInfo&&S.rateInfo.mode==='manual'?'':'hidden'}><label>직접 입력 (1엔 = 원)</label><input type="number" id="sRate" step="0.01" min="1" value="${esc(S.rate)}"></div>
    <div class="lgactions" style="margin-top:4px"><button type="submit" class="lgbtn lgprimary">저장</button></div></form>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <form id="pinForm"><div class="lgf"><label>비밀번호 바꾸기</label><div class="lgmrows"><div class="mr"><select id="pWho">${S.people.map((p,i)=>`<option value="${i}" ${i===S.me?'selected':''}>${esc(p.name)}${i===S.me?' (나)':''}</option>`).join('')}</select><input type="text" inputmode="numeric" class="lgpin" id="pNew" placeholder="새 비밀번호" maxlength="8"></div></div><div class="lghint">동행이 잊었을 때 대신 정해줄 수 있어요.</div></div><div class="lgactions" style="margin-top:4px"><button type="submit" class="lgbtn lgghost" style="flex:1">비밀번호 저장</button></div></form>
    <form id="addForm" ${S.people.length>=6?'hidden':''}><div class="lgf" style="margin-top:14px"><label>멤버 추가</label><div class="lgmrows"><div class="mr"><input type="text" id="aName" placeholder="이름" maxlength="12"><input type="text" inputmode="numeric" class="lgpin" id="aPin" placeholder="비밀번호" maxlength="8"></div></div></div><div class="lgactions" style="margin-top:4px"><button type="submit" class="lgbtn lgghost" style="flex:1">추가</button></div></form>
    <div class="lgactions" style="margin-top:18px"><button type="button" class="lgbtn lgdanger" id="sLogout" style="flex:1">이 폰에서 로그아웃</button></div>`);
  const sh=q('.lgsheet'); const g=s=>q(s,sh);
  const applySettings=async body=>{try{const j=await api({action:'settings',...body});S.people=j.people;S.rate=+j.rate||S.rate;S.rateInfo=j.rateInfo||S.rateInfo;return true}catch(e){toast(e.message||'실패했어요');return false}};
  g('#sAuto').onchange=()=>{g('#sRateBox').hidden=g('#sAuto').checked};
  g('#setForm').onsubmit=async ev=>{ev.preventDefault();const names=qa('#sNames input',sh).map(i=>i.value.trim());const body={names};if(g('#sAuto').checked)body.rateAuto=true;else body.rate=parseFloat(g('#sRate').value)||S.rate;if(await applySettings(body)){toast('저장했어요');closeSheet();load()}};
  g('#pinForm').onsubmit=async ev=>{ev.preventDefault();const pin=g('#pNew').value.trim();if(!/^\d{4,8}$/.test(pin)){toast('숫자 4~8자리');return}if(await applySettings({setPin:{me:+g('#pWho').value,pin}})){toast('비밀번호를 바꿨어요');g('#pNew').value=''}};
  g('#addForm').onsubmit=async ev=>{ev.preventDefault();const name=g('#aName').value.trim(),pin=g('#aPin').value.trim();if(!name||!/^\d{4,8}$/.test(pin)){toast('이름과 숫자 4~8자리');return}if(await applySettings({addMember:{name,pin}})){toast('추가했어요');closeSheet();render()}};
  g('#sLogout').onclick=()=>{closeSheet();logout()};
}

/* ---------- mount ---------- */
function mount(el,memoEl){
  root=el; root.classList.add('lg'); root.innerHTML=`<div class="lg-view"></div>`; view=q('.lg-view',root);
  if(!ov){ ov=document.createElement('div'); ov.className='lg lgov'; ov.innerHTML=`<div class="lgscrim"></div><div class="lgsheet" role="dialog" aria-modal="true"><div class="lgin"></div></div><div class="lgtoast"></div>`; document.body.appendChild(ov); q('.lgscrim',ov).onclick=closeSheet; }
  memoRoot=memoEl||document.getElementById('ledger-memo-root')||null;
  if(memoRoot){ memoRoot.classList.add('lg'); memoRoot.innerHTML=`<div class="lg-view"></div>`; memoView=q('.lg-view',memoRoot); }
  render(); boot();
  const visible=()=>roots().some(r=>!r.closest('[hidden]'));
  clearInterval(pollT); pollT=setInterval(()=>{if(document.visibilityState==='visible'&&S.screen==='main'&&!S.saving&&visible())load()},POLL_MS);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.screen==='main')load()});
}
window.Ledger={mount,state:S,reload:load,openExpense,openSettle};
const auto=document.getElementById('ledger-root');
if(auto){ if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mount(auto)); else mount(auto); }
})();
