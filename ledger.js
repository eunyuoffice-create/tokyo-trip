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
  scope:'mine',err:'',saving:0,pending:false,loginIdx:null,loaded:false,openMemos:new Set()};
const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}},del:k=>{try{localStorage.removeItem(k)}catch(e){}}};
let root,view,memoRoot,memoView,userEl,ov,toastT,pollT;
const roots=()=>[root,memoRoot].filter(Boolean);
const inRoots=a=>roots().some(r=>r.contains(a));

/* ---------- utils ---------- */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const linkify=t=>esc(t).replace(/(https?:\/\/[^\s<>"']+?)([.,)!?]*)(?=\s|$)/g,(m,u,tail)=>`<a href="${u}" target="_blank" rel="noopener" class="lglinkx">${u.replace(/^https?:\/\//,'').slice(0,60)}${u.length>68?'…':''}</a>${tail}`);
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
const qa=(sel,el)=>el?[...el.querySelectorAll(sel)]:[...roots(),ov].filter(Boolean).flatMap(r=>[...r.querySelectorAll(sel)]);
const toast=m=>{const t=q('.lgtoast',ov);if(!t)return;t.textContent=m;t.classList.add('lgshow');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('lgshow'),1800)};
const svgCheck='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
const svgX='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const svgLock='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const svgMore='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const svgUser='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const svgIn='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M13 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/></svg>';
const svgOut='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/></svg>';
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
/* 입력칸은 전부 시트(ov) 안에 있어서 목록을 다시 그려도 입력이 끊기지 않는다 */
function isEditing(){ return !!S.dragging; }
function render(){
  if(isEditing()){S.pending=true;return}
  S.pending=false;
  let h='';
  if(S.screen==='loading') h=`<div class="lgcard"><div class="lgempty">불러오는 중…</div></div>`;
  else if(S.screen==='error') h=`<div class="lgbanner">⚠️ <div><b>정산 노트를 열지 못했어요.</b> ${esc(S.err)} <button class="lglink" data-act="retry">다시 시도</button></div></div>`;
  else if(S.screen==='setup'||S.screen==='login') h=viewLocked();
  else h=viewMain();
  view.innerHTML=h; bind(view);
  if(userEl){ userEl.innerHTML=userHtml(); bind(userEl); }
  if(window.Content&&Content.onAuth)Content.onAuth();
  if(memoView){ memoView.innerHTML=S.screen==='main'?viewMemo():viewMemoLocked(); bind(memoView); }
}
function userHtml(){
  if(S.screen==='main') return `<span class="lguser lguser-name">${svgUser}<span>${esc(pname(S.me))}</span></span><button class="lguser lguser-gear" data-act="settings" aria-label="설정">${svgGear}</button><button class="lguser lguser-gear lguser-out" data-act="logout" aria-label="로그아웃" title="로그아웃">${svgOut}</button>`;
  if(S.screen==='login'||S.screen==='setup') return `<button class="lguser lguser-off" data-act="login" aria-label="${S.screen==='setup'?'정산 노트 시작':'로그인'}" title="${S.screen==='setup'?'시작하기':'로그인'}">${svgIn}</button>`;
  return '';
}
function viewLocked(){
  const setup=S.screen==='setup';
  return `<div class="lgcard lgauthcard"><div class="lgauthic">${svgUser}</div><div><b>${setup?'정산 노트를 아직 시작하지 않았어요':'로그인하면 정산 노트가 열려요'}</b><p>${setup?'멤버와 각자 비밀번호를 정하면 바로 쓸 수 있어요.':'내 지출과 메모는 나만 보고, 공용만 같이 봐요. 이 폰에 한 번만 기억돼요.'}</p><button class="lgbtn lgprimary lgsmbtn" data-act="login">${setup?'시작하기':'로그인'}</button></div></div>`;
}
function setupFormHtml(){
  return `<h2>정산 노트 시작<button type="button" data-close>닫기</button></h2><p class="lghint" style="margin:0 0 12px">같이 쓰는 멤버와 각자 숫자 비밀번호를 정해요. 개인 지출·개인 메모는 그 비밀번호로 들어온 사람만 봐요. 처음 한 번만 하면 돼요.</p>
  <form id="setupForm">
    <div class="lgf"><label>멤버 (이름 · 숫자 비밀번호 4~8자리) <span class="lgreq" aria-label="필수">*</span></label><div class="lgmrows" id="setupRows">
      <div class="mr"><input type="text" placeholder="이름 1" maxlength="12" data-n="0" value="은유"><input type="text" inputmode="numeric" class="lgpin" placeholder="비밀번호" maxlength="8" data-p="0"></div>
      <div class="mr"><input type="text" placeholder="이름 2" maxlength="12" data-n="1" value="카뮈"><input type="text" inputmode="numeric" class="lgpin" placeholder="비밀번호" maxlength="8" data-p="1"></div>
    </div><div style="margin-top:8px"><button type="button" class="lglink" data-act="setup-add">+ 멤버 추가</button></div></div>
    <div class="lgf"><label>나는</label><div class="lgchips" id="setupMe"><button type="button" class="lgchip" data-i="0" aria-pressed="true">첫 번째</button><button type="button" class="lgchip" data-i="1" aria-pressed="false">두 번째</button></div></div>
    <div class="lgf"><label>환율 (1엔 = 원) — 비워두면 매일 자동으로 받아와요</label><input type="number" id="setupRate" step="0.01" min="1" placeholder="자동 (지금 ${esc(S.rate)}원)"></div>
    <div class="lgactions"><button type="submit" class="lgbtn lgprimary">시작하기</button></div>
  </form>`;
}
function loginFormHtml(){
  if(!S.people.length) return `<h2>정산 노트<button type="button" data-close>닫기</button></h2><p class="lghint">아직 멤버가 없어요.</p><div class="lgactions"><button class="lgbtn lgprimary" data-act="retry">새로고침</button></div>`;
  const idx=S.loginIdx!==null?S.loginIdx:(+ls.get('tl_me')||0);
  return `<h2>로그인<button type="button" data-close>닫기</button></h2><p class="lghint" style="margin:0 0 12px">누구인지 고르고 비밀번호를 넣어주세요. 이 폰에 기억돼요.</p>
  <form id="loginForm">
    <div class="lgf"><label>나는</label><div class="lgchips" id="loginWho">${S.people.map((p,i)=>`<button type="button" class="lgchip" data-i="${i}" aria-pressed="${i===idx}">${esc(p.name)}</button>`).join('')}</div></div>
    <div class="lgf"><label>비밀번호 <span class="lgreq" aria-label="필수">*</span></label><input type="password" inputmode="numeric" class="lgpin" id="loginPin" maxlength="8" autocomplete="current-password"></div>
    <div class="lgactions"><button type="submit" class="lgbtn lgprimary">들어가기</button></div>
    <div class="lghint">비밀번호를 잊었으면 <button type="button" class="lglink" data-act="forgot">새로 정하기</button> (사이트 입장 비밀번호로 확인해요)</div>
  </form>`;
}
function openLogin(){
  if(S.screen!=='login'&&S.screen!=='setup'){ if(S.screen==='main')openSettings(); return; }
  openSheet(S.screen==='setup'?setupFormHtml():loginFormHtml());
  const sh=q('.lgsheet',ov); bind(sh);
  setTimeout(()=>{const i=q('#loginPin',sh); if(i)i.focus()},250);
}
function viewMain(){
  let h='';
  if(S.err) h+=`<div class="lgbanner">⚠️ <div>${esc(S.err)}</div></div>`;
  h+=viewHome();
  // 고정 버튼 바 (하단 메뉴 위에 따라다님)
  h+=`<div class="lgbar"><div class="lgadd2"><button class="lgaddexp" data-act="add-shared">${svgPlus}공용 지출</button><button class="lgaddexp lgaddmine" data-act="add-mine">${svgPlus}내 지출</button></div></div>`;
  return h;
}
const svgPlus='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
function viewHome(){
  const me=S.me; const sh=shared(); const open=sh.filter(e=>!e.settled);
  // 1) 개인 / 공용 / 전체 — 목록이 먼저
  let h=`<div class="lgfilters lgtopseg"><div class="lgseg2"><button data-scope="mine" aria-pressed="${S.scope==='mine'}">개인</button><button data-scope="shared" aria-pressed="${S.scope==='shared'}">공용</button><button data-scope="all" aria-pressed="${S.scope==='all'}">전체</button></div></div>`;
  let list=S.expenses.slice().sort((a,b)=>(b.day||'').localeCompare(a.day||'')||(b.ts||0)-(a.ts||0));
  if(S.scope==='shared')list=list.filter(isShared); else if(S.scope==='mine')list=list.filter(e=>!isShared(e));
  if(!list.length) h+=`<div class="lgcard"><div class="lgempty"><b>${S.scope==='mine'?'내 지출이 아직 없어요':S.scope==='shared'?'공용 지출이 아직 없어요':'아직 지출이 없어요'}</b>${S.scope==='mine'?'아래 "내 지출"로 넣어요. 나만 보여요.':'아래 "공용 지출"로 넣으면 같이 나눠 계산돼요.'}</div></div>`;
  else{
    const groups=[]; list.forEach(e=>{let g=groups.find(x=>x.day===e.day); if(!g){g={day:e.day,items:[]};groups.push(g)} g.items.push(e)});
    groups.forEach(g=>{
      const sj=g.items.filter(e=>e.cur==='JPY').reduce((a,e)=>a+e.amount,0), sk=g.items.filter(e=>e.cur==='KRW').reduce((a,e)=>a+e.amount,0);
      h+=`<div class="lgsec"><h3>${esc(dayLabel(g.day))}</h3><span class="lgnum">${sj?fmt(sj,'JPY'):''}${sj&&sk?' · ':''}${sk?fmt(sk,'KRW'):''}</span></div><div class="lgcard lgtight">${g.items.map(rowHtml).join('')}</div>`;
    });
    h+=`<div class="lghint" style="text-align:center;margin:10px 0 4px">지출을 누르면 고치거나 지울 수 있어요.${S.scope==='mine'?'':' 공용 지출의 왼쪽 체크는 그 건만 정산 완료 표시예요.'}</div>`;
  }
  // 2) 정산 — 잔액 한 줄 + 보냈어/받았어 (아래쪽)
  const allFlows=[...flows('JPY').map(f=>({...f,cur:'JPY'})),...flows('KRW').map(f=>({...f,cur:'KRW'}))];
  const mine=allFlows.filter(f=>f.from===me||f.to===me), others=allFlows.filter(f=>!(f.from===me||f.to===me));
  h+=`<div class="lg-head lgbelow"><div class="lgttl">정산 노트</div></div>`;
  h+=`<div class="lghero2"><div class="lghero-k">지금 잔액</div>`;
  if(!sh.length) h+=`<div class="lghero-v lgmuted-t">아직 공용 지출이 없어요</div><div class="lghero-s">"공용 지출"로 넣으면 자동으로 나눠요.</div>`;
  else if(!allFlows.length) h+=`<div class="lghero-v lgok-t">정산 끝 · 주고받을 돈 없음</div><div class="lghero-s">공용 지출 ${sh.length}건이 모두 정리됐어요.</div>`;
  else{
    mine.forEach(f=>{const recv=f.to===me; h+=`<div class="lgflow2"><div class="lghero-v ${recv?'lgok-t':'lgacc-t'}">${esc(pname(recv?f.from:f.to))}에게 ${recv?'받을 돈':'줄 돈'}<br><b class="lgnum">${fmt(f.amount,f.cur)}</b></div><button class="lgsettlebtn" data-settle="${f.from}|${f.to}|${f.amount}|${f.cur}">${recv?'받았어':'보냈어'}</button></div>`});
    others.forEach(f=>{h+=`<div class="lgflow2"><div class="lghero-v lgmuted-t lgsmall">${esc(pname(f.from))} → ${esc(pname(f.to))} <b class="lgnum">${fmt(f.amount,f.cur)}</b></div><button class="lgsettlebtn lgghost2" data-settle="${f.from}|${f.to}|${f.amount}|${f.cur}">정산됨</button></div>`});
    if(mine.length>1){const net=mine.reduce((a,f)=>a+(f.to===me?1:-1)*(f.cur==='JPY'?f.amount*S.rate:f.amount),0); if(Math.abs(net)>=1)h+=`<div class="lghero-s"><b>엔·원 합치면</b> 약 ${fmt(Math.abs(net),'KRW')} ${net>0?'받을 돈':'줄 돈'} <span class="lgsub">(${rateLabel().split(' (')[0]})</span></div>`}
    h+=`<div class="lghero-s">아직 정산 안 된 공용 지출 ${open.length}건 기준이에요. 돈을 주고받은 뒤 버튼을 누르면 0이 돼요.</div>`;
  }
  h+=`</div>`;
  h+=detailsHtml();
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
  const msg=S.screen==='loading'?'정산 노트 불러오는 중…':S.screen==='error'?'정산 노트 서버에 연결하지 못해서 메모를 못 불러왔어요.':'로그인하면 내 메모와 공용 체크리스트가 여기에 나와요.';
  return `<div class="lgcard"><div class="lgempty lgtightempty">${msg}${(S.screen==='login'||S.screen==='setup')?` <button class="lglink" data-act="login">${S.screen==='setup'?'시작하기':'로그인'}</button>`:''}</div></div>`;
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
  // 공용 줄은 왼쪽 체크로 이 건만 따로 정산 완료 처리 (잔액에서 빠짐)
  const check=priv?'':`<button class="lgbox lgbox-s" data-settled="${esc(e.id)}" aria-label="이 건 정산 완료" aria-pressed="${!!e.settled}">${svgCheck}</button>`;
  const links=(Array.isArray(e.links)?e.links:[]).filter(x=>x&&x.u);
  const linkHtml=links.length?`<div class="lgelinks">${links.map(x=>`<a class="lgelink" href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.l||x.u.replace(/^https?:\/\//,'').slice(0,24))} ↗</a>`).join('')}</div>`:'';
  return `<div class="lgrow ${!priv&&e.settled?'lgsettled':''}">${check}<div class="lgrowbody" role="button" tabindex="0" data-exp="${esc(e.id)}"><div class="lgmid"><div class="ti">${priv?`<span class="lglock">${svgLock}</span>`:''}<span class="lgtrunc">${esc(e.title||'(내용 없음)')}</span></div><div class="si">${sub}${e.memo?`<span class="lgtrunc">· ${esc(e.memo)}</span>`:''}</div>${linkHtml}</div><div class="lgamt"><div class="aa">${fmt(e.amount,e.cur)}</div>${right}</div><span class="lgchev" aria-hidden="true"></span></div></div>`;
}

/* ---------- 메모: 목록은 한 줄씩, 쓰기·보기는 시트에서 ---------- */
const svgDrag='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>';
const svgList='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><path d="M5 7.5l1.5 1.5L9 6"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 7.5h7M14 17.5h7"/></svg>';
const svgText='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/><path d="M4 4h7"/></svg>';
function viewMemo(){
  let h='';
  const secs=[{title:'내 메모',sub:`${pname(S.me)}만 봄`,list:S.memos.filter(m=>ownerOf(m)===S.me)},{title:'공용 메모',sub:'둘 다 보고 체크',list:S.memos.filter(isShared)}];
  secs.forEach(sec=>{
    if(!sec.list.length)return;
    const list=sec.list.slice().sort((a,b)=>(memoDone(a)?1:0)-(memoDone(b)?1:0)||(b.order||b.ts||0)-(a.order||a.ts||0));
    h+=`<div class="lgsec"><h3>${sec.title} <span class="lgsub">${esc(sec.sub)}</span></h3><span class="lgnum">${list.length}개${list.length>1?' <span class="lgsub">· 길게 눌러 순서 바꾸기</span>':''}</span></div><div class="lgmemolist">${list.map(memoRow).join('')}</div>`;
  });
  if(!S.memos.length) h+=`<div class="lghint" style="text-align:center;margin:6px 0 10px">아래 [내 메모] [공용 메모]로 체크 리스트나 글을 써요.</div>`;
  h+=`<div class="lgbar"><div class="lgadd2"><button class="lgaddexp lgaddmine" data-newmemo="mine">${svgPlus}내 메모</button><button class="lgaddexp lgaddmine" data-newmemo="shared">${svgPlus}공용 메모</button></div></div>`;
  return h;
}
function memoRow(m){
  // 아코디언: 머리글을 누르면 쓴 내용이 펼쳐지고, 체크는 바로, 나머지 수정은 "수정" 팝업에서
  const list=m.type!=='text'; const items=m.items||[]; const done=items.filter(i=>i.done).length; const priv=!isShared(m);
  const body=String(m.body||'');
  const title=m.title||(list?'제목 없는 리스트':(body.replace(/\s+/g,' ').trim().slice(0,30)||'제목 없는 글'));
  const open=S.openMemos.has(m.id); const mdone=memoDone(m);
  let inner;
  if(list){
    const li=it=>`<div class="lgli ${it.done?'lgdone':''}"><button type="button" class="lgbox" data-tgl-m="${esc(m.id)}|${esc(it.id)}" aria-label="완료">${svgCheck}</button><span class="lgtx">${linkify(it.text)}</span></div>`;
    if(!items.length) inner=`<div class="lghint" style="margin:0 0 6px">아직 항목이 없어요.</div>`;
    else if(priv) inner=items.map(li).join('');
    else{
      // 공용 체크리스트: 담당자별로 묶어서 (나 → 다른 멤버 → 담당 없음)
      const groups=[]; const order=[S.me,...S.people.map((p,i)=>i).filter(i=>i!==S.me),null];
      order.forEach(w=>{const sub=items.filter(it=>whoOf(it)===w); if(sub.length)groups.push({w,sub})});
      inner=groups.map(g=>`<div class="lgwgrp"><div class="lgwgrp-h"><span class="lgwho ${g.w===null?'lgwho-none':g.w===S.me?'lgwho-me':''}">${g.w===null?'담당 없음':esc(pname(g.w))}</span><span class="lgsub">${g.sub.filter(i=>i.done).length}/${g.sub.length}</span></div>${g.sub.map(li).join('')}</div>`).join('');
    }
  }else inner=body.trim()?`<div class="lgmemobody">${linkify(body)}</div>`:`<div class="lghint" style="margin:0 0 6px">내용이 없어요.</div>`;
  return `<details class="lgdetails lgmemoacc ${mdone?'lgmdone':''}" data-accm="${esc(m.id)}" ${open?'open':''}><summary><button type="button" class="lgbox lgbox-m" data-mdone="${esc(m.id)}" aria-pressed="${mdone}" aria-label="${list?'전체 체크':'확인 완료'}">${svgCheck}</button><span class="lgmic ${list?'lgmic-list':'lgmic-text'}" title="${list?'체크 리스트':'글'}">${list?svgList:svgText}</span><span class="lgmtitle">${priv?`<span class="lglock">${svgLock}</span>`:''}<span class="lgtrunc">${esc(title)}</span></span>${list&&items.length?`<span class="lgmprog ${done===items.length?'lgokt':''}">${done}/${items.length}</span>`:''}<span class="lgchevbtn" aria-hidden="true"></span></summary><div class="lgdetails-b lgmemoin">${inner}<div class="lgmemofoot"><span class="lgsub">${list?`${done}/${items.length} 완료`:''}</span><button type="button" class="lgaddbtn" data-memoedit="${esc(m.id)}">수정</button></div></div></details>`;
}
const memoDone=m=>{const items=m.items||[]; return (m.type!=='text'&&items.length)?items.every(i=>i.done):!!m.done};
const memoItems=m=>(m&&Array.isArray(m.items)?m.items:[]).map(x=>({...x}));
const whoOf=it=>(it.who===null||it.who===undefined||it.who===''||!S.people[+it.who])?null:+it.who;
const nextWho=cur=>{const n=S.people.length; if(cur===null||cur===undefined)return 0; return cur+1>=n?null:cur+1};
function openMemoEditor(m,opts={}){
  const isNew=!m; const me=S.me;
  const d={id:m?.id,type:m?(m.type==='text'?'text':'list'):(opts.type||'list'),title:m?.title||'',owner:m?ownerOf(m):(opts.owner===undefined?null:opts.owner),body:m?.body||'',items:memoItems(m),addWho:null};
  const shared=()=>d.owner===null;
  const whoBtn=(who,attr)=>`<button type="button" class="lgwho ${who===null?'lgwho-none':who===me?'lgwho-me':''}" ${attr}>${who===null?'담당':esc(pname(who))}</button>`;
  const itemsHtml=()=>d.items.length?d.items.map(it=>{const who=whoOf(it); return `<div class="lgli ${it.done?'lgdone':''}"><button type="button" class="lgbox" data-tgl="${esc(it.id)}" aria-label="완료">${svgCheck}</button><input type="text" class="lgtxin" data-txt="${esc(it.id)}" value="${esc(it.text)}" maxlength="200">${shared()?whoBtn(who,`data-who="${esc(it.id)}"`):''}<button type="button" class="lgx" data-del="${esc(it.id)}" aria-label="삭제">${svgX}</button></div>`}).join(''):`<div class="lghint" style="margin:2px 0 8px">아직 항목이 없어요. 아래에 쓰고 "입력"을 눌러요.</div>`;
  openSheet(`<h2><span id="mHead">${isNew?(shared()?'공용 메모 쓰기':'내 메모 쓰기'):(shared()?'공용 메모':'내 메모')}</span><button type="button" data-close>닫기</button></h2><form id="memoForm" autocomplete="off">
    ${isNew?`<div class="lgf"><div class="lgchips" id="mType"><button type="button" class="lgchip" data-t="list" aria-pressed="${d.type==='list'}">${svgList} 체크 리스트</button><button type="button" class="lgchip" data-t="text" aria-pressed="${d.type==='text'}">${svgText} 글</button></div></div>`:''}
    <div class="lgf"><input type="text" id="mTitle" placeholder="제목" value="${esc(d.title)}" maxlength="40"></div>
    <div class="lgf" id="mBodyBox" ${d.type==='text'?'':'hidden'}><textarea id="mBody" rows="7" placeholder="여기에 그냥 써요. 줄바꿈 그대로 남아요.">${esc(d.body)}</textarea></div>
    <div class="lgf" id="mListBox" ${d.type==='list'?'':'hidden'}><div id="mItems">${itemsHtml()}</div>
      <div class="lgaddli"><span class="lgplus">${svgPlus}</span><input type="text" id="mAdd" placeholder="항목 추가" maxlength="200"><span id="mAddWho">${shared()?whoBtn(null,'id="mAddWhoBtn"'):''}</span><button type="button" class="lgaddbtn" id="mAddBtn">입력</button></div>
      <div class="lghint" id="mItemsHint">${isNew?'':'체크·추가·삭제는 바로 저장돼요. 글자를 고치면 칸을 벗어날 때 저장돼요.'}</div></div>
    <div class="lgf"><label>누가 보나</label><div class="lgchips" id="mOwner"><button type="button" class="lgchip" data-o="mine" aria-pressed="${!shared()}">개인 · 나만</button><button type="button" class="lgchip" data-o="shared" aria-pressed="${shared()}">공용 · 모두</button></div></div>
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgdanger" id="mDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary">${isNew?'저장':'저장하고 닫기'}</button></div></form>`);
  const sh=q('.lgsheet',ov); const g=sel=>q(sel,sh);
  const persistItems=()=>{ if(isNew)return; write([{op:'update',col:'memos',id:d.id,data:{items:d.items}}]); };
  const paintItems=()=>{ g('#mItems').innerHTML=itemsHtml(); g('#mAddWho').innerHTML=shared()?whoBtn(d.addWho,'id="mAddWhoBtn"'):''; wireItems(); };
  const wireItems=()=>{
    qa('[data-tgl]',sh).forEach(b=>b.onclick=()=>{d.items=d.items.map(it=>it.id===b.dataset.tgl?{...it,done:!it.done,doneBy:!it.done?me:null}:it);paintItems();persistItems()});
    qa('[data-del]',sh).forEach(b=>b.onclick=()=>{d.items=d.items.filter(it=>it.id!==b.dataset.del);paintItems();persistItems()});
    qa('[data-who]',sh).forEach(b=>b.onclick=()=>{d.items=d.items.map(it=>it.id===b.dataset.who?{...it,who:nextWho(whoOf(it))}:it);paintItems();persistItems()});
    qa('[data-txt]',sh).forEach(inp=>{inp.onchange=()=>{const t=inp.value.trim(); d.items=t?d.items.map(it=>it.id===inp.dataset.txt?{...it,text:t}:it):d.items.filter(it=>it.id!==inp.dataset.txt); if(!t)paintItems(); persistItems()}; inp.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();inp.blur()}}});
    const wb=g('#mAddWhoBtn'); if(wb)wb.onclick=()=>{d.addWho=nextWho(d.addWho); g('#mAddWho').innerHTML=whoBtn(d.addWho,'id="mAddWhoBtn"'); wireItems();};
  };
  const addItem=()=>{const inp=g('#mAdd'); const t=inp.value.trim(); if(!t)return; d.items=[...d.items,{id:uid(),text:t,done:false,who:shared()?d.addWho:null,ts:Date.now()}]; inp.value=''; paintItems(); persistItems(); inp.focus();};
  g('#mAddBtn').onclick=addItem; g('#mAdd').onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();addItem()}};
  qa('#mType .lgchip',sh).forEach(b=>b.onclick=()=>{d.type=b.dataset.t;qa('#mType .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));g('#mBodyBox').hidden=d.type!=='text';g('#mListBox').hidden=d.type!=='list';});
  qa('#mOwner .lgchip',sh).forEach(b=>b.onclick=()=>{d.owner=b.dataset.o==='shared'?null:me;qa('#mOwner .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));if(isNew)g('#mHead').textContent=shared()?'공용 메모 쓰기':'내 메모 쓰기';paintItems();});
  wireItems();
  g('#memoForm').onsubmit=async ev=>{ev.preventDefault();
    const pending=g('#mAdd').value.trim(); if(pending&&d.type==='list')addItem();
    const data={type:d.type,owner:d.owner,title:g('#mTitle').value.trim(),body:d.type==='text'?g('#mBody').value:'',items:d.type==='list'?d.items:[]};
    if(isNew&&!data.title&&!data.body.trim()&&!data.items.length){toast('내용을 써주세요');return}
    closeSheet();
    if(isNew){const now=Date.now(); await write([{op:'set',col:'memos',id:uid(),data:{...data,ts:now,order:now}}],'저장했어요')}
    else await write([{op:'update',col:'memos',id:d.id,data}],'저장했어요');
  };
  arm(g('#mDel'),async()=>{closeSheet();await write([{op:'delete',col:'memos',id:d.id}],'삭제했어요')});
  setTimeout(()=>{const f=isNew?g('#mTitle'):null; if(f)f.focus()},250);
}

/* 메모 아코디언 끌어서 순서 바꾸기 (포인터 이벤트, 터치·마우스 공통)
   시작할 때 카드 위치를 한 번만 재고, 끄는 동안은 transform 으로만 움직인다. 놓을 때 순서를 계산해 저장. */
function startDrag(ev,handle){
  if(ev.button&&ev.button!==0)return;
  const card=handle.closest('details[data-accm]'); const listEl=card&&card.parentElement; if(!card||!listEl||!listEl.classList.contains('lgmemolist'))return;
  ev.preventDefault(); ev.stopPropagation();
  const cards=[...listEl.children]; if(cards.length<2)return;
  const from=cards.indexOf(card);
  const sy=()=>window.scrollY||document.documentElement.scrollTop||0;
  const rects=cards.map(c=>{const r=c.getBoundingClientRect();return {top:r.top+sy(),h:r.height,mid:r.top+sy()+r.height/2}});
  const gap=cards.length>1?Math.max(0,rects[1].top-(rects[0].top+rects[0].h)):8; const step=rects[from].h+gap;
  const startY=ev.clientY, startPage=startY+sy(); let to=from, moved=false, lastY=startY, raf=0, alive=true;
  S.dragging=true; card.classList.add('lgdragging'); listEl.classList.add('lgdraglist'); document.body.classList.add('lgnoselect');
  try{handle.setPointerCapture(ev.pointerId)}catch(e){}
  const paint=()=>{const dy=(lastY+sy())-startPage; card.style.transform=`translateY(${dy}px)`;
    const center=rects[from].mid+dy; let n=0; cards.forEach((c,j)=>{if(j!==from&&rects[j].mid<center)n++}); to=n;
    cards.forEach((c,j)=>{ if(j===from)return; let sh=0; if(j<from&&j>=to)sh=step; else if(j>from&&j<=to)sh=-step; c.style.transform=sh?`translateY(${sh}px)`:''; });};
  const EDGE_T=150, EDGE_B=170;
  const tick=()=>{ if(!alive)return; let v=0; const h=window.innerHeight; if(lastY<EDGE_T)v=-Math.min(22,(EDGE_T-lastY)/4+4); else if(lastY>h-EDGE_B)v=Math.min(22,(lastY-(h-EDGE_B))/4+4);
    if(v&&moved){ const before=sy(); window.scrollBy(0,v); if(sy()!==before)paint(); } raf=requestAnimationFrame(tick); };
  raf=requestAnimationFrame(tick);
  const move=e=>{ if(e.pointerId!==ev.pointerId)return; lastY=e.clientY; if(Math.abs(lastY-startY)>4)moved=true; paint(); };
  const stopTouch=e=>{e.preventDefault()};
  const end=async e=>{
    if(e&&e.pointerId!==undefined&&e.pointerId!==ev.pointerId)return;
    alive=false; cancelAnimationFrame(raf);
    window.removeEventListener('pointermove',move,true); window.removeEventListener('pointerup',end,true); window.removeEventListener('pointercancel',end,true); document.removeEventListener('touchmove',stopTouch);
    cards.forEach(c=>{c.style.transform=''}); card.classList.remove('lgdragging'); listEl.classList.remove('lgdraglist'); document.body.classList.remove('lgnoselect'); S.dragging=false;
    if(!moved||to===from){render();return}
    const ids=cards.map(c=>c.dataset.accm); const [id]=ids.splice(from,1); ids.splice(to,0,id);
    const base=Date.now(); const ops=[];
    ids.forEach((mid,i)=>{const m=S.memos.find(x=>x.id===mid); const order=base-i*1000; if(m)ops.push({op:'update',col:'memos',id:mid,data:{order}})});
    await write(ops,'순서를 바꿨어요');
  };
  window.addEventListener('pointermove',move,true); window.addEventListener('pointerup',end,true); window.addEventListener('pointercancel',end,true);
  document.addEventListener('touchmove',stopTouch,{passive:false});
}
/* 머리글을 350ms 길게 누르면 드래그 시작. 그 전에 움직이면 스크롤, 그 전에 떼면 펼치기(기본 동작) */
function pressToDrag(ev,sm){
  if(ev.target.closest('[data-mdone]'))return; if(ev.button&&ev.button!==0)return;
  const x0=ev.clientX,y0=ev.clientY; let fired=false;
  const cancel=()=>{clearTimeout(t); sm.removeEventListener('pointermove',mv); sm.removeEventListener('pointerup',cancel); sm.removeEventListener('pointercancel',cancel); };
  const mv=e=>{if(Math.abs(e.clientX-x0)>8||Math.abs(e.clientY-y0)>8)cancel()};
  const t=setTimeout(()=>{fired=true; cancel(); try{navigator.vibrate&&navigator.vibrate(12)}catch(e){}
    const card=sm.parentElement; sm.dataset.suppress='1'; setTimeout(()=>{delete sm.dataset.suppress},600);
    startDrag({pointerId:ev.pointerId,clientY:y0,button:0,preventDefault(){},stopPropagation(){}},sm);},350);
  sm.addEventListener('pointermove',mv); sm.addEventListener('pointerup',cancel); sm.addEventListener('pointercancel',cancel);
}
/* ---------- 바인딩 ---------- */
function bind(c){
  qa('[data-act]',c).forEach(b=>b.onclick=()=>{const a=b.dataset.act; if(a==='retry'){S.screen='loading';render();boot()} else if(a==='settings')openSettings(); else if(a==='setup-add')setupAddRow(); else if(a==='login')openLogin(); else if(a==='logout'){logout();toast('로그아웃했어요')} else if(a==='add-shared')openExpense(null,{priv:false}); else if(a==='add-mine')openExpense(null,{priv:true}); else if(a==='forgot')openForgot(); });
  qa('[data-scope]',c).forEach(b=>b.onclick=()=>{S.scope=b.dataset.scope;render()});
  qa('[data-exp]',c).forEach(b=>b.onclick=ev=>{if(ev.target.closest('a'))return; openExpense(S.expenses.find(e=>e.id===b.dataset.exp))});
  qa('[data-settled]',c).forEach(b=>b.onclick=()=>{const e=S.expenses.find(x=>x.id===b.dataset.settled);if(!e)return;write([{op:'update',col:'expenses',id:e.id,data:{settled:!e.settled,settledBy:!e.settled?S.me:null,settleId:null}}],e.settled?'다시 잔액에 넣었어요':'이 건만 정산 완료했어요')});
  qa('[data-tr]',c).forEach(b=>b.onclick=()=>openRecord(S.transfers.find(t=>t.id===b.dataset.tr)));
  qa('[data-settle]',c).forEach(b=>b.onclick=()=>{const [f,t,a,cur]=b.dataset.settle.split('|');openSettle({from:+f,to:+t,amount:+a,cur})});
  qa('[data-newmemo]',c).forEach(b=>b.onclick=()=>openMemoEditor(null,{owner:b.dataset.newmemo==='mine'?S.me:null}));
  qa('[data-memoedit]',c).forEach(b=>b.onclick=()=>openMemoEditor(S.memos.find(m=>m.id===b.dataset.memoedit)));
  qa('[data-mdone]',c).forEach(b=>{b.onclick=ev=>{ev.preventDefault();ev.stopPropagation();const m=S.memos.find(x=>x.id===b.dataset.mdone);if(!m)return;const items=memoItems(m);const nowDone=memoDone(m);
    if(m.type!=='text'&&items.length){const next=items.map(it=>({...it,done:!nowDone,doneBy:!nowDone?S.me:null}));write([{op:'update',col:'memos',id:m.id,data:{items:next,done:!nowDone}}],!nowDone?'전부 체크했어요':'전부 해제했어요')}
    else write([{op:'update',col:'memos',id:m.id,data:{done:!nowDone}}],!nowDone?'확인 완료':'다시 올렸어요')}});
  qa('details[data-accm] > summary',c).forEach(sm=>{sm.onpointerdown=ev=>pressToDrag(ev,sm); sm.oncontextmenu=ev=>ev.preventDefault(); sm.onclick=ev=>{if(sm.dataset.suppress){ev.preventDefault();ev.stopPropagation()}}});
  qa('[data-accm]',c).forEach(d=>d.ontoggle=()=>{if(d.open)S.openMemos.add(d.dataset.accm);else S.openMemos.delete(d.dataset.accm)});
  qa('[data-tgl-m]',c).forEach(b=>b.onclick=()=>{const [mid,iid]=b.dataset.tglM.split('|');const m=S.memos.find(x=>x.id===mid);if(!m)return;const items=memoItems(m).map(it=>it.id===iid?{...it,done:!it.done,doneBy:!it.done?S.me:null}:it);write([{op:'update',col:'memos',id:mid,data:{items}}])});
  // setup / login (정산 탭 쪽에만 있다)
  const sf=q('#setupForm',c); if(sf){
    qa('#setupMe .lgchip',c).forEach(b=>b.onclick=()=>qa('#setupMe .lgchip',c).forEach(x=>x.setAttribute('aria-pressed',x===b)));
    sf.onsubmit=async ev=>{ev.preventDefault();
      const rows=qa('#setupRows .mr',c).map(r=>({name:r.querySelector('[data-n]').value.trim(),pin:r.querySelector('[data-p]').value.trim()})).filter(r=>r.name||r.pin);
      if(rows.length<2||rows.some(r=>!r.name||!/^\d{4,8}$/.test(r.pin))){toast('이름과 4~8자리 숫자 비밀번호를 모두 넣어주세요');return}
      const me=+(qa('#setupMe .lgchip[aria-pressed="true"]',c)[0]||{dataset:{i:0}}).dataset.i;
      const btn=sf.querySelector('button[type=submit]'); btn.disabled=true;
      try{const j=await api({action:'setup',people:rows,rate:parseFloat(q('#setupRate',c).value)||0,me}); closeSheet(); S.token=j.token; ls.set('tl_token',j.token); ls.set('tl_me',String(j.me)); S.screen='loading'; render(); await load();}
      catch(e){btn.disabled=false; if(e.code==='already_setup'){toast('이미 시작된 노트예요');S.screen='loading';render();boot()} else toast(e.message||'실패했어요')}
    };
  }
  const lf=q('#loginForm',c); if(lf){
    qa('#loginWho .lgchip',c).forEach(b=>b.onclick=()=>{S.loginIdx=+b.dataset.i;qa('#loginWho .lgchip',c).forEach(x=>x.setAttribute('aria-pressed',x===b));q('#loginPin',c).focus()});
    lf.onsubmit=async ev=>{ev.preventDefault();
      const me=+(qa('#loginWho .lgchip[aria-pressed="true"]',c)[0]||{dataset:{i:0}}).dataset.i; const pin=q('#loginPin',c).value.trim();
      if(!pin){toast('비밀번호를 넣어주세요');return}
      const btn=lf.querySelector('button[type=submit]'); btn.disabled=true;
      try{const j=await api({action:'login',me,pin}); closeSheet(); S.token=j.token; ls.set('tl_token',j.token); ls.set('tl_me',String(j.me)); S.screen='loading'; render(); await load();}
      catch(e){btn.disabled=false; toast(e.code==='pin'?`${pname(me)} 비밀번호가 맞지 않아요`:(e.message||'실패했어요')); q('#loginPin',c).value=''; q('#loginPin',c).focus();}
    };
  }
}
function setupAddRow(){ const rows=q('#setupRows'); if(!rows)return; const n=rows.children.length; if(n>=6)return; const d=document.createElement('div'); d.className='mr'; d.innerHTML=`<input type="text" placeholder="이름 ${n+1}" maxlength="12" data-n="${n}"><input type="text" inputmode="numeric" class="lgpin" placeholder="비밀번호" maxlength="8" data-p="${n}">`; rows.appendChild(d); const me=q('#setupMe'); const b=document.createElement('button'); b.type='button'; b.className='lgchip'; b.dataset.i=n; b.setAttribute('aria-pressed','false'); b.textContent=['첫','두','세','네','다섯','여섯'][n]+' 번째'; b.onclick=()=>qa('#setupMe .lgchip').forEach(x=>x.setAttribute('aria-pressed',x===b)); me.appendChild(b); }
function arm(btn,fn){ if(!btn)return; btn.onclick=()=>{ if(btn.dataset.arm!=='1'){btn.dataset.arm='1';const o=btn.textContent;btn.textContent='정말 삭제?';setTimeout(()=>{btn.dataset.arm='';btn.textContent=o},2500);return} fn(); }; }

/* ---------- 시트 ---------- */
function openSheet(html){ q('.lgsheet .lgin',ov).innerHTML=`<div class="lggrab"></div>`+html; q('.lgsheet',ov).classList.add('lgopen'); q('.lgscrim',ov).classList.add('lgopen'); document.body.style.overflow='hidden'; qa('[data-close]',ov).forEach(b=>b.onclick=closeSheet); q('.lgsheet',ov).scrollTop=0; }
function closeSheet(){ q('.lgsheet').classList.remove('lgopen'); q('.lgscrim').classList.remove('lgopen'); document.body.style.overflow=''; }

const expLinkRow=(l,u)=>`<div class="lgclink"><input type="text" placeholder="이름" value="${esc(l||'')}" maxlength="40"><input type="text" inputmode="url" autocapitalize="off" placeholder="https://…" value="${esc(u||'')}"><button type="button" class="lgx" data-dellink aria-label="삭제">×</button></div>`;
const readExpLinks=sh=>[...sh.querySelectorAll('#fLinks .lgclink')].map(r=>{const [a,b]=r.querySelectorAll('input'); let u=(b.value||'').trim(); if(!u)return null; if(!/^https?:\/\//i.test(u))u='https://'+u; return {l:(a.value||'').trim(),u}}).filter(Boolean);
function wireExpLinks(sh){ sh.querySelectorAll('#fLinks [data-dellink]').forEach(b=>b.onclick=()=>b.closest('.lgclink').remove()); const add=sh.querySelector('#fAddLink'); if(add)add.onclick=()=>{sh.querySelector('#fLinks').insertAdjacentHTML('beforeend',expLinkRow('','')); wireExpLinks(sh); const f=sh.querySelector('#fLinks .lgclink:last-child input'); if(f)f.focus(); sh.querySelector('#fMore').open=true;}; }
function openExpense(e,opts={}){
  const isNew=!e; const n=S.people.length; const today=todayKey();
  const d={id:e?.id,title:e?.title||'',amount:e?.amount||'',cur:e?.cur||'JPY',day:e?.day||today,cat:e?.cat||'식비',
    priv:e?!isShared(e):!!opts.priv,payer:e?e.payer:S.me,parts:e?(e.parts&&e.parts.length?e.parts.slice():[...Array(n).keys()]):[...Array(n).keys()],custom:e?.custom?{...e.custom}:null,memo:e?.memo||'',settled:!!(e&&e.settled)};
  const moreOpen=!isNew&&(!!d.custom||(!d.priv&&d.parts.length!==n)||!!d.memo||d.settled||(Array.isArray(e?.links)&&e.links.length>0));
  const dayShort=k=>{const x=dayOf(k);return k===today?'오늘':(x.d==='pre'?'출발 전':`D${x.n}`)};
  openSheet(`<h2><span id="fHead">${isNew?(d.priv?'내 지출':'공용 지출'):'지출 수정'}</span><button type="button" data-close>닫기</button></h2><form id="expForm">
    <div class="lgf"><label>금액 <span class="lgreq" aria-label="필수">*</span></label><div class="lgamount"><input type="text" inputmode="decimal" id="fAmt" placeholder="0" value="${d.amount?esc(d.amount):''}" aria-label="금액"><div class="lgseg" id="fCur"><button type="button" data-c="JPY" aria-pressed="${d.cur==='JPY'}">¥</button><button type="button" data-c="KRW" aria-pressed="${d.cur==='KRW'}">₩</button></div></div></div>
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
    <div class="lgf"><label>링크 <span class="lgsub">예약 페이지, 영수증 사진 주소 등</span></label><div class="lgclinks" id="fLinks">${(Array.isArray(e?.links)?e.links:[]).map(x=>expLinkRow(x.l,x.u)).join('')}</div><button type="button" class="lglink" id="fAddLink">+ 링크 추가</button></div>
    </details>
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgdanger" id="fDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary" id="fSave">${isNew?'저장':'수정 저장'}</button></div></form>`);
  const sh=q('.lgsheet',ov); const g=s=>q(s,sh);
  const amt=()=>parseNum(g('#fAmt').value);
  const sum=()=>{const bits=[dayShort(d.day),d.cat]; if(!d.priv){ if(d.parts.length!==n)bits.push(d.parts.map(pname).join('·')+' 몫'); if(g('#fCustom').checked)bits.push('직접 나눔'); } if(d.memo)bits.push('메모'); const nl=g('#fLinks')?g('#fLinks').querySelectorAll('.lgclink').length:0; if(nl)bits.push(`링크 ${nl}`); g('#fMoreSum').textContent=bits.join(' · ')};
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
  partsHint(); sum(); if(d.custom)customBox(); wireExpLinks(sh); sh.querySelector('#fLinks').addEventListener('input',sum); const al=g('#fAddLink'); const al0=al.onclick; al.onclick=()=>{al0();sum()};
  g('#expForm').onsubmit=async ev=>{ev.preventDefault();
    const a=amt(); if(!(a>0)){toast('금액을 넣어주세요');g('#fAmt').focus();return}
    let body;
    const links=readExpLinks(sh);
    if(d.priv) body={owner:S.me,title:g('#fTitle').value.trim(),amount:a,cur:d.cur,day:d.day,cat:d.cat,payer:S.me,parts:[S.me],custom:null,memo:g('#fMemo').value.trim(),links,ts:e?.ts||Date.now()};
    else{ if(!d.parts.length){toast('나눌 사람을 골라주세요');g('#fMore').open=true;return}
      const useCustom=g('#fCustom').checked; const custom=useCustom?Object.fromEntries(d.parts.map(i=>[i,+(d.custom&&d.custom[i])||0])):null;
      const settled=isNew?false:!!g('#fSettled').checked;
      body={owner:null,title:g('#fTitle').value.trim(),amount:a,cur:d.cur,day:d.day,cat:d.cat,payer:d.payer,parts:d.parts,custom,memo:g('#fMemo').value.trim(),links,ts:e?.ts||Date.now(),settled,settledBy:settled?(e&&e.settledBy!==undefined&&e.settledBy!==null?e.settledBy:S.me):null,settleId:settled?(e&&e.settleId)||null:null}; }
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
    <div class="lgf"><label>실제 주고받은 금액 <span class="lgreq" aria-label="필수">*</span></label><div class="lgamount"><input type="text" inputmode="decimal" id="stAmt" value="${full}"><div class="lgseg"><button type="button" aria-pressed="true" tabindex="-1">${sym}</button></div></div><div class="lghint" id="stHint"></div></div>
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
    <div class="lgf"><label>사이트 입장 비밀번호 <span class="lgreq" aria-label="필수">*</span></label><input type="password" id="fgSite" autocomplete="off"></div>
    <div class="lgf"><label>새 멤버 비밀번호 (숫자 4~8자리) <span class="lgreq" aria-label="필수">*</span></label><input type="text" inputmode="numeric" class="lgpin" id="fgPin" maxlength="8" autocomplete="off"></div>
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
  userEl=document.getElementById('ledger-user')||null; if(userEl)userEl.classList.add('lgslot');
  if(memoRoot){ memoRoot.classList.add('lg'); memoRoot.innerHTML=`<div class="lg-view"></div>`; memoView=q('.lg-view',memoRoot); }
  roots().forEach(r=>{const p=r.closest('.panel'); if(p)p.classList.add('lg-haspad')});
  render(); boot();
  const visible=()=>roots().some(r=>!r.closest('[hidden]'));
  clearInterval(pollT); pollT=setInterval(()=>{if(document.visibilityState==='visible'&&S.screen==='main'&&!S.saving&&visible())load()},POLL_MS);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.screen==='main')load()});
}
window.Ledger={mount,state:S,reload:load,openExpense,openSettle,openLogin,API,api,openSheet,closeSheet,toast,arm};
const auto=document.getElementById('ledger-root');
if(auto){ if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mount(auto)); else mount(auto); }
})();
