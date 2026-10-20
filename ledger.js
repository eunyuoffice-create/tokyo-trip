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
const TABS=[{id:'settle',label:'정산'},{id:'exp',label:'지출'},{id:'memo',label:'메모'}];

const S={screen:'loading',token:'',me:null,people:[],rate:8.4,rateInfo:{mode:'auto',auto:null},expenses:[],transfers:[],memos:[],
  tab:'settle',dayFilter:'all',scope:'all',err:'',saving:0,pending:false,focusAdd:null,loginIdx:null,loaded:false};
const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}},del:k=>{try{localStorage.removeItem(k)}catch(e){}}};
let root,view,toastT,pollT;

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
const q=(sel,el=root)=>el.querySelector(sel);
const qa=(sel,el=root)=>[...el.querySelectorAll(sel)];
const toast=m=>{const t=q('.lgtoast');t.textContent=m;t.classList.add('lgshow');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('lgshow'),1800)};
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
  shared().filter(e=>e.cur===cur).forEach(e=>{ if(e.payer<n)b[e.payer]+=e.amount; sharesOf(e).forEach((s,i)=>{if(i<n)b[i]-=s}); });
  S.transfers.filter(t=>t.cur===cur).forEach(t=>{ if(t.from<n)b[t.from]+=t.amount; if(t.to<n)b[t.to]-=t.amount; });
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
function isEditing(){ const a=document.activeElement; if(!a||!root.contains(a)||q('.lgsheet').contains(a))return false; if(a.matches('textarea.lgbody'))return true; if(a.matches('[data-addli]')&&a.value)return true; return false; }
function render(){
  if(isEditing()){S.pending=true;return}
  S.pending=false;
  const a=document.activeElement; if(a&&root.contains(a)&&a.matches&&a.matches('[data-addli]'))S.focusAdd=a.dataset.addli;
  let h='';
  if(S.screen==='loading') h=`<div class="lgcard"><div class="lgempty">불러오는 중…</div></div>`;
  else if(S.screen==='error') h=`<div class="lgbanner">⚠️ <div><b>정산 노트를 열지 못했어요.</b> ${esc(S.err)} <button class="lglink" data-act="retry">다시 시도</button></div></div>`;
  else if(S.screen==='setup') h=viewSetup();
  else if(S.screen==='login') h=viewLogin();
  else h=viewMain();
  view.innerHTML=h; bind();
  q('.lgfab').hidden=!(S.screen==='main'&&S.tab==='exp');
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
    <div class="lghint">비밀번호를 잊었으면 다른 멤버가 설정에서 다시 정해줄 수 있어요.</div>
  </form></div>`;
}
function viewMain(){
  let h=`<div class="lg-head"><div class="lgttl">정산 노트 <small>10.24–28</small><span class="lgme"><i></i>${esc(pname(S.me))}</span></div><button class="lgicon" data-act="settings" aria-label="설정">${svgGear}</button></div>`;
  h+=`<div class="lg-tabs" role="tablist">${TABS.map(t=>`<button role="tab" data-tab="${t.id}" aria-selected="${S.tab===t.id}">${t.label}${t.id==='memo'&&S.memos.length?`<span class="bn">${S.memos.length}</span>`:''}</button>`).join('')}</div>`;
  if(S.err) h+=`<div class="lgbanner">⚠️ <div>${esc(S.err)}</div></div>`;
  if(S.tab==='settle')h+=viewSettle(); else if(S.tab==='exp')h+=viewExp(); else h+=viewMemo();
  return h;
}
function viewSettle(){
  let h=''; const me=S.me; const sh=shared();
  const tj=sh.filter(e=>e.cur==='JPY').reduce((a,e)=>a+e.amount,0), tk=sh.filter(e=>e.cur==='KRW').reduce((a,e)=>a+e.amount,0);
  h+=`<div class="lgcard"><h4>공용 지출 합계</h4><div class="lgstat"><div><div class="sk">엔</div><div class="sv">${fmt(tj,'JPY')}</div></div><div><div class="sk">원</div><div class="sv">${fmt(tk,'KRW')}</div></div></div><div class="lghint">합쳐서 약 <b class="lgnum">${fmt(tj*S.rate+tk,'KRW')}</b> · ${rateLabel()} · 공용 ${sh.length}건${S.people.length?` · 1인 약 <b class="lgnum">${fmt((tj*S.rate+tk)/S.people.length,'KRW')}</b>`:''}</div></div>`;
  ['JPY','KRW'].forEach(cur=>{
    const has=sh.some(e=>e.cur===cur)||S.transfers.some(t=>t.cur===cur); if(!has&&cur==='KRW')return;
    const fl=flows(cur), b=balances(cur);
    h+=`<div class="lgcard"><h4>${cur==='JPY'?'엔 (¥)':'원 (₩)'} 정산</h4>`;
    if(!sh.some(e=>e.cur===cur)) h+=`<div class="lgempty">아직 ${cur==='JPY'?'엔':'원'} 공용 지출이 없어요</div>`;
    else if(!fl.length) h+=`<div class="lgbanner lgok" style="margin:0">✅ <div><b>정산할 게 없어요.</b> 다들 낸 만큼 썼어요.</div></div>`;
    else fl.slice().sort((a,b)=>((b.from===me||b.to===me)?1:0)-((a.from===me||a.to===me)?1:0)).forEach(f=>{
      h+=`<div class="lgflow"><span class="fp">${esc(pname(f.from))}</span><span class="lgarr">→</span><span class="fp">${esc(pname(f.to))}</span><span class="lgamt ${f.from===me?'lgout':f.to===me?'lgin':''}">${fmt(f.amount,cur)}</span><button class="lgmini" data-settle="${f.from}|${f.to}|${f.amount}|${cur}">보냈어</button></div>`;
    });
    h+=`<div class="lgsub" style="margin-top:12px">멤버별 잔액 (+ 받을 돈 / − 줄 돈)</div><div class="lgbal">`;
    b.forEach((v,i)=>{h+=`<span class="bn">${esc(pname(i))}${i===me?' <span class="lgsub">(나)</span>':''}</span><span class="sv ${v>0.5?'lgpos':v<-0.5?'lgneg':''}">${v>0.5?'+':''}${fmt(v,cur)}</span>`});
    h+=`</div></div>`;
  });
  h+=`<div class="lgcard"><h4>멤버별 낸 돈 · 몫 (공용, 엔)</h4><div class="lgbal">`;
  S.people.forEach((p,i)=>{let paid=0,share=0; sh.filter(e=>e.cur==='JPY').forEach(e=>{if(e.payer===i)paid+=e.amount;share+=sharesOf(e)[i]||0}); h+=`<span class="bn">${esc(pname(i))}</span><span class="sv">낸 ${fmt(paid,'JPY')} · 몫 ${fmt(share,'JPY')}</span>`});
  h+=`</div><div class="lghint">공용 지출만 계산해요. 개인 지출은 각자 시트에만 보여요.</div></div>`;
  // 공용 지출 목록 (최근)
  const list=sh.slice().sort((a,b)=>(b.day||'').localeCompare(a.day||'')||(b.ts||0)-(a.ts||0));
  h+=`<div class="lgsec"><h3>공용 지출</h3><span class="lgnum">${list.length}건</span></div>`;
  h+=list.length?`<div class="lgcard" style="padding-block:4px">${list.map(rowHtml).join('')}</div>`:`<div class="lgcard"><div class="lgempty"><b>아직 공용 지출이 없어요</b>지출 탭에서 "공용"으로 추가하면 여기서 나눠 계산돼요.</div></div>`;
  if(S.transfers.length){
    h+=`<div class="lgsec"><h3>정산 기록</h3><span class="lgnum">${S.transfers.length}건</span></div><div class="lgcard" style="padding-block:4px">`;
    S.transfers.slice().sort((a,b)=>(b.ts||0)-(a.ts||0)).forEach(t=>{h+=`<button class="lgrow" data-tr="${esc(t.id)}"><div class="lgcat">송금</div><div class="lgmid"><div class="ti">${esc(pname(t.from))} → ${esc(pname(t.to))}</div><div class="si">${esc(new Date(t.ts||0).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}${t.memo?' · '+esc(t.memo):''}</div></div><div class="lgamt"><div class="aa">${fmt(t.amount,t.cur)}</div></div></button>`});
    h+=`</div>`;
  }
  return h;
}
function rowHtml(e){
  const me=S.me; const priv=!isShared(e); const sh=sharesOf(e); const parts=sh.map((v,i)=>v>0?i:-1).filter(i=>i>=0);
  let sub, right='';
  if(priv){ sub=`개인 지출 · ${esc(dayLabel(e.day))}`; }
  else{
    const who=parts.length===S.people.length?'모두':parts.map(pname).join('·');
    sub=`<span class="${e.payer===me?'lgmine':''}">${esc(pname(e.payer))}</span> 결제 · ${esc(who)}${parts.length>1?' 나눔':''}`;
    const mine=sh[me]||0;
    if(e.payer===me&&parts.length>1) right=`<div class="ab">받을 돈 ${fmt(e.amount-mine,e.cur)}</div>`;
    else if(e.payer!==me&&mine>0) right=`<div class="ab lgowe">내 몫 ${fmt(mine,e.cur)}</div>`;
    else if(parts.length>1) right=`<div class="ab">1인 ${fmt(e.amount/parts.length,e.cur)}</div>`;
  }
  return `<button class="lgrow" data-exp="${esc(e.id)}"><div class="lgcat">${esc(e.cat||'기타')}</div><div class="lgmid"><div class="ti">${priv?`<span class="lglock">${svgLock}</span>`:''}<span style="overflow:hidden;text-overflow:ellipsis">${esc(e.title||'(제목 없음)')}</span></div><div class="si">${sub}${e.memo?` · ${esc(e.memo)}`:''}</div></div><div class="lgamt"><div class="aa">${fmt(e.amount,e.cur)}</div>${right}</div></button>`;
}
function viewExp(){
  let h=''; const me=S.me; const tj=myTotals('JPY'), tk=myTotals('KRW');
  const bj=balances('JPY')[me]||0, bk=balances('KRW')[me]||0;
  h+=`<div class="lgcard"><h4>${esc(pname(me))}의 시트</h4><div class="lgstat">
    <div><div class="sk">공용 중 내 몫</div><div class="sv">${fmt(tj.share,'JPY')}</div></div>
    <div><div class="sk">개인 지출</div><div class="sv">${fmt(tj.priv,'JPY')}</div></div>
    <div><div class="sk">내가 낸 공용</div><div class="sv">${fmt(tj.paid,'JPY')}</div></div>
    <div><div class="sk">내 총 지출</div><div class="sv">${fmt(tj.share+tj.priv,'JPY')}</div></div>
    ${(tk.share||tk.priv)?`<div><div class="sk">원화 · 내 몫</div><div class="sv">${fmt(tk.share,'KRW')}</div></div><div><div class="sk">원화 · 개인</div><div class="sv">${fmt(tk.priv,'KRW')}</div></div>`:''}
  </div><div class="lghint">${balLine(bj,'JPY')}${(tk.share||tk.priv||tk.paid)?' · '+balLine(bk,'KRW'):''} · 총 약 <b class="lgnum">${fmt((tj.share+tj.priv)*S.rate+tk.share+tk.priv,'KRW')}</b></div></div>`;
  h+=`<div class="lgchips" style="margin-top:12px"><button class="lgchip lgsm" data-scope="all" aria-pressed="${S.scope==='all'}">전체</button><button class="lgchip lgsm" data-scope="shared" aria-pressed="${S.scope==='shared'}">공용</button><button class="lgchip lgsm" data-scope="mine" aria-pressed="${S.scope==='mine'}">개인</button></div>`;
  h+=`<div class="lgchips lgscroll" style="margin-top:8px"><button class="lgchip lgsm" data-day="all" aria-pressed="${S.dayFilter==='all'}">전체</button>`;
  ALLDAYS.forEach(d=>{const c=S.expenses.filter(e=>e.day===d.d).length; if(d.d==='pre'&&!c)return; h+=`<button class="lgchip lgsm" data-day="${d.d}" aria-pressed="${S.dayFilter===d.d}">${d.d==='pre'?'출발 전':`D${d.n} ${d.w}`}${c?` <span class="lgnum lgmuted">${c}</span>`:''}</button>`});
  h+=`</div>`;
  let list=S.expenses.slice().sort((a,b)=>(b.day||'').localeCompare(a.day||'')||(b.ts||0)-(a.ts||0));
  if(S.scope==='shared')list=list.filter(isShared); else if(S.scope==='mine')list=list.filter(e=>!isShared(e));
  if(S.dayFilter!=='all')list=list.filter(e=>e.day===S.dayFilter);
  if(!list.length)return h+`<div class="lgcard"><div class="lgempty"><b>${S.expenses.length?'이 조건에 맞는 지출이 없어요':'아직 지출이 없어요'}</b>오른쪽 아래 버튼으로 추가해요. 공용은 같이 나누고, 개인은 나만 봐요.</div></div>`;
  const groups=[]; list.forEach(e=>{let g=groups.find(x=>x.day===e.day); if(!g){g={day:e.day,items:[]};groups.push(g)} g.items.push(e)});
  groups.forEach(g=>{
    const sj=g.items.filter(e=>e.cur==='JPY').reduce((a,e)=>a+e.amount,0), sk=g.items.filter(e=>e.cur==='KRW').reduce((a,e)=>a+e.amount,0);
    h+=`<div class="lgsec"><h3>${esc(dayLabel(g.day))}</h3><span class="lgnum">${sj?fmt(sj,'JPY'):''}${sj&&sk?' · ':''}${sk?fmt(sk,'KRW'):''}</span></div><div class="lgcard" style="padding-block:4px">${g.items.map(rowHtml).join('')}</div>`;
  });
  return h;
}
function viewMemo(){
  let h='';
  const secs=[{k:'shared',title:'공용 메모',list:S.memos.filter(isShared),owner:null},{k:'mine',title:'내 메모',list:S.memos.filter(m=>ownerOf(m)===S.me),owner:S.me}];
  secs.forEach(sec=>{
    h+=`<div class="lgsec"><h3>${sec.title}${sec.k==='mine'?` <span class="lgsub">${esc(pname(S.me))}만 봄</span>`:''}</h3><div class="lgact"><button class="lgchip lgsm" data-newmemo="list|${sec.k}">+ 체크 리스트</button><button class="lgchip lgsm" data-newmemo="text|${sec.k}">+ 글</button></div></div>`;
    const list=sec.list.slice().sort((a,b)=>(a.order||a.ts||0)-(b.order||b.ts||0));
    if(!list.length){h+=`<div class="lgcard"><div class="lgempty">${sec.k==='shared'?'같이 보는 메모가 없어요. 살 것 목록, 가고 싶은 곳 같은 걸 올려두면 둘 다 체크할 수 있어요.':'나만 보는 메모가 없어요. 개인 쇼핑 리스트나 일기처럼 써요.'}</div></div>`;return}
    list.forEach(m=>{h+=memoHtml(m)});
  });
  return h;
}
function memoHtml(m){
  const priv=!isShared(m);
  let h=`<div class="lgmemo" data-memo="${esc(m.id)}"><div class="lgmh"><button class="lgtt" data-memoedit="${esc(m.id)}">${m.title?esc(m.title):`<span class="lgph">${m.type==='text'?'글':'체크 리스트'}</span>`}</button><span class="lgtag ${priv?'lgpriv':''}">${priv?'개인':'공용'}</span><button class="lgmore" data-memoedit="${esc(m.id)}" aria-label="메모 설정">${svgMore}</button></div>`;
  if(m.type==='text'){
    h+=`<textarea class="lgbody" data-body="${esc(m.id)}" placeholder="여기에 그냥 써요. 줄바꿈 그대로 보여요." rows="3">${esc(m.body||'')}</textarea><div class="lgsaverow"><span class="lgsave" data-mark="${esc(m.id)}"></span><button type="button" class="lgaddbtn" data-savebody="${esc(m.id)}">저장</button></div>`;
  }else{
    const items=(m.items||[]).slice().sort((a,b)=>(a.done?1:0)-(b.done?1:0));
    items.forEach(it=>{h+=`<div class="lgli ${it.done?'lgdone':''}"><button class="lgbox" data-li="${esc(m.id)}|${esc(it.id)}" aria-label="완료">${svgCheck}</button><button class="lgtx" data-liedit="${esc(m.id)}|${esc(it.id)}">${esc(it.text)}</button><button class="lgx" data-lidel="${esc(m.id)}|${esc(it.id)}" aria-label="삭제">${svgX}</button></div>`});
    h+=`<form class="lgaddli" data-addform="${esc(m.id)}"><span class="lgplus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><input type="text" data-addli="${esc(m.id)}" placeholder="항목 추가" autocomplete="off" maxlength="200"><button type="submit" class="lgaddbtn">입력</button></form>`;
  }
  return h+`</div>`;
}

/* ---------- 바인딩 ---------- */
function bind(){
  qa('[data-act]',view).forEach(b=>b.onclick=()=>{const a=b.dataset.act; if(a==='retry'){S.screen='loading';render();boot()} else if(a==='settings')openSettings(); else if(a==='setup-add')setupAddRow();});
  qa('[data-tab]',view).forEach(b=>b.onclick=()=>{S.tab=b.dataset.tab;ls.set('tl_tab',S.tab);render()});
  qa('[data-scope]',view).forEach(b=>b.onclick=()=>{S.scope=b.dataset.scope;render()});
  qa('[data-day]',view).forEach(b=>b.onclick=()=>{S.dayFilter=b.dataset.day;render()});
  qa('[data-exp]',view).forEach(b=>b.onclick=()=>openExpense(S.expenses.find(e=>e.id===b.dataset.exp)));
  qa('[data-tr]',view).forEach(b=>b.onclick=()=>openTransfer(S.transfers.find(t=>t.id===b.dataset.tr)));
  qa('[data-settle]',view).forEach(b=>b.onclick=()=>{const [f,t,a,c]=b.dataset.settle.split('|');openTransfer({from:+f,to:+t,amount:+a,cur:c})});
  qa('[data-newmemo]',view).forEach(b=>b.onclick=()=>{const [type,scope]=b.dataset.newmemo.split('|');newMemo(type,scope==='mine'?S.me:null)});
  qa('[data-memoedit]',view).forEach(b=>b.onclick=()=>openMemo(S.memos.find(m=>m.id===b.dataset.memoedit)));
  qa('[data-li]',view).forEach(b=>b.onclick=()=>{const [mid,iid]=b.dataset.li.split('|');toggleItem(mid,iid)});
  qa('[data-lidel]',view).forEach(b=>b.onclick=()=>{const [mid,iid]=b.dataset.lidel.split('|');delItem(mid,iid)});
  qa('[data-liedit]',view).forEach(b=>b.onclick=()=>{const [mid,iid]=b.dataset.liedit.split('|');openItem(mid,iid)});
  qa('[data-addform]',view).forEach(f=>f.onsubmit=ev=>{ev.preventDefault();const inp=f.querySelector('input');const t=inp.value.trim();if(!t)return;inp.value='';addItem(f.dataset.addform,t)});
  qa('[data-savebody]',view).forEach(b=>b.onclick=async()=>{const id=b.dataset.savebody;const ta=q(`[data-body="${id}"]`);if(ta)queueBody(id,ta.value);await flushBody(id);toast('저장했어요')});
  qa('textarea.lgbody',view).forEach(ta=>{autosize(ta); ta.oninput=()=>{autosize(ta);queueBody(ta.dataset.body,ta.value)}; ta.onblur=()=>{flushBody(ta.dataset.body); if(S.pending)setTimeout(()=>{if(!isEditing())render()},50)}; });
  qa('input',view).forEach(i=>{i.addEventListener('blur',()=>{if(S.pending)setTimeout(()=>{if(!isEditing())render()},50)})});
  // setup / login
  const sf=q('#setupForm',view); if(sf){
    qa('#setupMe .lgchip',view).forEach(b=>b.onclick=()=>qa('#setupMe .lgchip',view).forEach(x=>x.setAttribute('aria-pressed',x===b)));
    sf.onsubmit=async ev=>{ev.preventDefault();
      const rows=qa('#setupRows .mr',view).map(r=>({name:r.querySelector('[data-n]').value.trim(),pin:r.querySelector('[data-p]').value.trim()})).filter(r=>r.name||r.pin);
      if(rows.length<2||rows.some(r=>!r.name||!/^\d{4,8}$/.test(r.pin))){toast('이름과 4~8자리 숫자 비밀번호를 모두 넣어주세요');return}
      const me=+(qa('#setupMe .lgchip[aria-pressed="true"]',view)[0]||{dataset:{i:0}}).dataset.i;
      const btn=sf.querySelector('button[type=submit]'); btn.disabled=true;
      try{const j=await api({action:'setup',people:rows,rate:parseFloat(q('#setupRate',view).value)||0,me}); S.token=j.token; ls.set('tl_token',j.token); ls.set('tl_me',String(j.me)); S.screen='loading'; render(); await load();}
      catch(e){btn.disabled=false; if(e.code==='already_setup'){toast('이미 시작된 노트예요');S.screen='loading';render();boot()} else toast(e.message||'실패했어요')}
    };
  }
  const lf=q('#loginForm',view); if(lf){
    qa('#loginWho .lgchip',view).forEach(b=>b.onclick=()=>{S.loginIdx=+b.dataset.i;qa('#loginWho .lgchip',view).forEach(x=>x.setAttribute('aria-pressed',x===b));q('#loginPin',view).focus()});
    lf.onsubmit=async ev=>{ev.preventDefault();
      const me=+(qa('#loginWho .lgchip[aria-pressed="true"]',view)[0]||{dataset:{i:0}}).dataset.i; const pin=q('#loginPin',view).value.trim();
      if(!pin){toast('비밀번호를 넣어주세요');return}
      const btn=lf.querySelector('button[type=submit]'); btn.disabled=true;
      try{const j=await api({action:'login',me,pin}); S.token=j.token; ls.set('tl_token',j.token); ls.set('tl_me',String(j.me)); S.screen='loading'; render(); await load();}
      catch(e){btn.disabled=false; toast(e.code==='pin'?'비밀번호가 맞지 않아요':(e.message||'실패했어요')); q('#loginPin',view).value=''; q('#loginPin',view).focus();}
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
function memoItems(m){return (m.items||[]).map(x=>({...x}))}
async function addItem(mid,text){ const m=S.memos.find(x=>x.id===mid); if(!m)return; const items=[...memoItems(m),{id:uid(),text,done:false,ts:Date.now()}]; S.focusAdd=mid; await write([{op:'update',col:'memos',id:mid,data:{items}}]); }
async function toggleItem(mid,iid){ const m=S.memos.find(x=>x.id===mid); if(!m)return; const items=memoItems(m).map(it=>it.id===iid?{...it,done:!it.done,doneBy:!it.done?S.me:null}:it); await write([{op:'update',col:'memos',id:mid,data:{items}}]); }
async function delItem(mid,iid){ const m=S.memos.find(x=>x.id===mid); if(!m)return; const items=memoItems(m).filter(it=>it.id!==iid); await write([{op:'update',col:'memos',id:mid,data:{items}}]); }
function openItem(mid,iid){
  const m=S.memos.find(x=>x.id===mid); const it=m&&(m.items||[]).find(x=>x.id===iid); if(!it)return;
  openSheet(`<h2>항목 수정<button type="button" data-close>닫기</button></h2><form id="itemForm"><div class="lgf"><label>내용</label><textarea id="itText" maxlength="500">${esc(it.text)}</textarea></div><div class="lgactions"><button type="button" class="lgbtn lgdanger" id="itDel">삭제</button><button type="submit" class="lgbtn lgprimary">저장</button></div></form>`);
  const sh=q('.lgsheet');
  q('#itemForm',sh).onsubmit=async ev=>{ev.preventDefault();const t=q('#itText',sh).value.trim();if(!t)return;const items=memoItems(m).map(x=>x.id===iid?{...x,text:t}:x);closeSheet();await write([{op:'update',col:'memos',id:mid,data:{items}}])};
  arm(q('#itDel',sh),async()=>{closeSheet();await delItem(mid,iid)});
  setTimeout(()=>q('#itText',sh).focus(),250);
}
function openMemo(m){
  if(!m)return;
  const d={title:m.title||'',owner:ownerOf(m)};
  openSheet(`<h2>메모 설정<button type="button" data-close>닫기</button></h2><form id="memoForm">
    <div class="lgf"><label>제목</label><input type="text" id="mTitle" value="${esc(d.title)}" maxlength="40" placeholder="${m.type==='text'?'예: 하라주쿠에서 느낀 것':'예: 돈키호테 살 것'}"></div>
    <div class="lgf"><label>누가 보나</label><div class="lgchips" id="mOwner"><button type="button" class="lgchip" data-o="shared" aria-pressed="${d.owner===null}">공용 · 모두</button><button type="button" class="lgchip" data-o="mine" aria-pressed="${d.owner!==null}">개인 · 나만</button></div><div class="lghint">개인으로 바꾸면 다른 멤버 화면에서 바로 사라져요.</div></div>
    <div class="lgactions"><button type="button" class="lgbtn lgdanger" id="mDel">삭제</button><button type="submit" class="lgbtn lgprimary">저장</button></div></form>`);
  const sh=q('.lgsheet');
  qa('#mOwner .lgchip',sh).forEach(b=>b.onclick=()=>{d.owner=b.dataset.o==='shared'?null:S.me;qa('#mOwner .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',x===b))});
  q('#memoForm',sh).onsubmit=async ev=>{ev.preventDefault();closeSheet();await write([{op:'update',col:'memos',id:m.id,data:{title:q('#mTitle',sh).value.trim(),owner:d.owner}}],'저장했어요')};
  arm(q('#mDel',sh),async()=>{closeSheet();await write([{op:'delete',col:'memos',id:m.id}],'삭제했어요')});
}
function arm(btn,fn){ if(!btn)return; btn.onclick=()=>{ if(btn.dataset.arm!=='1'){btn.dataset.arm='1';const o=btn.textContent;btn.textContent='정말 삭제?';setTimeout(()=>{btn.dataset.arm='';btn.textContent=o},2500);return} fn(); }; }

/* ---------- 시트 ---------- */
function openSheet(html){ q('.lgsheet .lgin').innerHTML=`<div class="lggrab"></div>`+html; q('.lgsheet').classList.add('lgopen'); q('.lgscrim').classList.add('lgopen'); document.body.style.overflow='hidden'; qa('[data-close]',q('.lgsheet')).forEach(b=>b.onclick=closeSheet); }
function closeSheet(){ q('.lgsheet').classList.remove('lgopen'); q('.lgscrim').classList.remove('lgopen'); document.body.style.overflow=''; }

function openExpense(e){
  const isNew=!e; const n=S.people.length;
  const d={id:e?.id,title:e?.title||'',amount:e?.amount||'',cur:e?.cur||'JPY',day:e?.day||todayKey(),cat:e?.cat||'식비',
    priv:e?!isShared(e):false,payer:e?e.payer:S.me,parts:e?(e.parts&&e.parts.length?e.parts.slice():[...Array(n).keys()]):[...Array(n).keys()],custom:e?.custom?{...e.custom}:null,memo:e?.memo||''};
  openSheet(`<h2>${isNew?'지출 추가':'지출 수정'}<button type="button" data-close>닫기</button></h2><form id="expForm">
    <div class="lgf"><div class="lgchips" id="fScope"><button type="button" class="lgchip" data-s="shared" aria-pressed="${!d.priv}">공용 · 같이 나눔</button><button type="button" class="lgchip" data-s="mine" aria-pressed="${d.priv}">개인 · 나만 봄</button></div></div>
    <div class="lgf"><label>금액</label><div class="lgamount"><input type="text" inputmode="decimal" id="fAmt" placeholder="0" value="${d.amount?esc(d.amount):''}"><div class="lgseg" id="fCur"><button type="button" data-c="JPY" aria-pressed="${d.cur==='JPY'}">¥</button><button type="button" data-c="KRW" aria-pressed="${d.cur==='KRW'}">₩</button></div></div></div>
    <div class="lgf"><label>내용</label><input type="text" id="fTitle" placeholder="예: 모츠나베 야마야, 리무진 버스" value="${esc(d.title)}" maxlength="80"></div>
    <div class="lgf"><label>날짜</label><div class="lgchips" id="fDay">${ALLDAYS.map(x=>`<button type="button" class="lgchip lgsm" data-d="${x.d}" aria-pressed="${d.day===x.d}">${x.d==='pre'?'출발 전':`D${x.n} ${x.s} ${x.w}`}</button>`).join('')}</div></div>
    <div class="lgf"><label>카테고리</label><div class="lgchips" id="fCat">${CATS.map(c=>`<button type="button" class="lgchip lgsm" data-c="${c}" aria-pressed="${d.cat===c}">${c}</button>`).join('')}</div></div>
    <div id="fSharedBox" ${d.priv?'hidden':''}>
      <div class="lgf"><label>누가 결제했나</label><div class="lgchips" id="fPayer">${S.people.map((p,i)=>`<button type="button" class="lgchip" data-i="${i}" aria-pressed="${d.payer===i}">${esc(pname(i))}</button>`).join('')}</div></div>
      <div class="lgf"><label>누구 몫으로 나눌까</label><div class="lgchips" id="fParts">${S.people.map((p,i)=>`<button type="button" class="lgchip" data-i="${i}" aria-pressed="${d.parts.includes(i)}">${esc(pname(i))}</button>`).join('')}</div><div class="lghint" id="fPartsHint"></div></div>
      <div class="lgf"><div class="lgtoggle"><span>금액 직접 나누기</span><input type="checkbox" id="fCustom" ${d.custom?'checked':''}></div><div id="fCustomBox" ${d.custom?'':'hidden'}><div class="lgpamts" id="fCustomAmts"></div><div class="lghint" id="fCustomHint"></div></div></div>
    </div>
    <div class="lgf"><label>메모</label><input type="text" id="fMemo" placeholder="영수증 메모, 누구 거 샀는지 등" value="${esc(d.memo)}" maxlength="120"></div>
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgdanger" id="fDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary" id="fSave">${isNew?'저장':'수정 저장'}</button></div></form>`);
  const sh=q('.lgsheet'); const g=s=>q(s,sh);
  const amt=()=>parseNum(g('#fAmt').value);
  const partsHint=()=>{const a=amt(),k=d.parts.length; g('#fPartsHint').textContent=k===0?'한 명 이상 골라주세요':k===1?(d.parts[0]===d.payer?'혼자 몫 — 나눔 없음':`${pname(d.parts[0])} 몫 전액 → ${pname(d.payer)}에게 ${fmt(a,d.cur)}`):`1인 ${fmt(a/k,d.cur)} 씩`};
  const customHint=()=>{if(!g('#fCustom').checked)return;const sum=d.parts.reduce((s,i)=>s+(d.custom&&+d.custom[i]||0),0);const rest=amt()-sum;const el=g('#fCustomHint');el.className='lghint'+(Math.abs(rest)>0.5?' bad':'');el.textContent=Math.abs(rest)>0.5?`합계 ${fmt(sum,d.cur)} · 남는 ${fmt(rest,d.cur)}은 ${pname(d.parts[0]??d.payer)}에게 붙어요`:'합계가 딱 맞아요'};
  const customBox=()=>{const box=g('#fCustomAmts'); box.innerHTML=d.parts.map(i=>`<label>${esc(pname(i))}<input type="text" inputmode="decimal" data-ci="${i}" value="${d.custom&&d.custom[i]?esc(d.custom[i]):''}" placeholder="0"></label>`).join(''); box.querySelectorAll('input').forEach(inp=>inp.oninput=()=>{d.custom=d.custom||{};d.custom[inp.dataset.ci]=parseNum(inp.value);customHint()}); customHint()};
  qa('#fScope .lgchip',sh).forEach(b=>b.onclick=()=>{d.priv=b.dataset.s==='mine';qa('#fScope .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));g('#fSharedBox').hidden=d.priv});
  g('#fAmt').oninput=()=>{partsHint();customHint()};
  qa('#fCur button',sh).forEach(b=>b.onclick=()=>{d.cur=b.dataset.c;qa('#fCur button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));partsHint();customHint()});
  qa('#fDay button',sh).forEach(b=>b.onclick=()=>{d.day=b.dataset.d;qa('#fDay button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b))});
  qa('#fCat button',sh).forEach(b=>b.onclick=()=>{d.cat=b.dataset.c;qa('#fCat button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b))});
  qa('#fPayer button',sh).forEach(b=>b.onclick=()=>{d.payer=+b.dataset.i;qa('#fPayer button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));partsHint()});
  qa('#fParts button',sh).forEach(b=>b.onclick=()=>{const i=+b.dataset.i;d.parts=d.parts.includes(i)?d.parts.filter(x=>x!==i):[...d.parts,i].sort();b.setAttribute('aria-pressed',d.parts.includes(i));partsHint();if(g('#fCustom').checked)customBox()});
  g('#fCustom').onchange=()=>{g('#fCustomBox').hidden=!g('#fCustom').checked;if(g('#fCustom').checked)customBox()};
  partsHint(); if(d.custom)customBox();
  g('#expForm').onsubmit=async ev=>{ev.preventDefault();
    const a=amt(); if(!(a>0)){toast('금액을 넣어주세요');g('#fAmt').focus();return}
    let body;
    if(d.priv) body={owner:S.me,title:g('#fTitle').value.trim(),amount:a,cur:d.cur,day:d.day,cat:d.cat,payer:S.me,parts:[S.me],custom:null,memo:g('#fMemo').value.trim(),ts:e?.ts||Date.now()};
    else{ if(!d.parts.length){toast('나눌 사람을 골라주세요');return}
      const useCustom=g('#fCustom').checked; const custom=useCustom?Object.fromEntries(d.parts.map(i=>[i,+(d.custom&&d.custom[i])||0])):null;
      body={owner:null,title:g('#fTitle').value.trim(),amount:a,cur:d.cur,day:d.day,cat:d.cat,payer:d.payer,parts:d.parts,custom,memo:g('#fMemo').value.trim(),ts:e?.ts||Date.now()}; }
    closeSheet();
    await write([{op:'set',col:'expenses',id:d.id||uid(),data:body}],isNew?'저장했어요':'수정했어요');
  };
  arm(g('#fDel'),async()=>{closeSheet();await write([{op:'delete',col:'expenses',id:d.id}],'삭제했어요')});
  setTimeout(()=>{if(isNew)g('#fAmt').focus()},250);
}
function openTransfer(t){
  const isNew=!t.id; const d={from:t.from,to:t.to,amount:t.amount||'',cur:t.cur||'JPY',memo:t.memo||''};
  openSheet(`<h2>${isNew?'정산 기록':'정산 기록 수정'}<button type="button" data-close>닫기</button></h2><form id="trForm">
    <div class="lgf"><label>금액</label><div class="lgamount"><input type="text" inputmode="decimal" id="tAmt" value="${d.amount?esc(Math.round(d.amount)):''}"><div class="lgseg" id="tCur"><button type="button" data-c="JPY" aria-pressed="${d.cur==='JPY'}">¥</button><button type="button" data-c="KRW" aria-pressed="${d.cur==='KRW'}">₩</button></div></div></div>
    <div class="lgf"><label>보낸 사람</label><div class="lgchips" id="tFrom">${S.people.map((p,i)=>`<button type="button" class="lgchip" data-i="${i}" aria-pressed="${d.from===i}">${esc(pname(i))}</button>`).join('')}</div></div>
    <div class="lgf"><label>받은 사람</label><div class="lgchips" id="tTo">${S.people.map((p,i)=>`<button type="button" class="lgchip" data-i="${i}" aria-pressed="${d.to===i}">${esc(pname(i))}</button>`).join('')}</div></div>
    <div class="lgf"><label>메모</label><input type="text" id="tMemo" placeholder="현금으로, 토스로 등" value="${esc(d.memo)}" maxlength="80"></div>
    <div class="lghint">기록하면 두 사람 잔액에서 이 금액만큼 빠져요. 지출 자체는 그대로 남아요.</div>
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgdanger" id="tDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary">${isNew?'정산 완료로 기록':'수정 저장'}</button></div></form>`);
  const sh=q('.lgsheet'); const g=s=>q(s,sh);
  qa('#tCur button',sh).forEach(b=>b.onclick=()=>{d.cur=b.dataset.c;qa('#tCur button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b))});
  qa('#tFrom button',sh).forEach(b=>b.onclick=()=>{d.from=+b.dataset.i;qa('#tFrom button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b))});
  qa('#tTo button',sh).forEach(b=>b.onclick=()=>{d.to=+b.dataset.i;qa('#tTo button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b))});
  g('#trForm').onsubmit=async ev=>{ev.preventDefault();const a=parseNum(g('#tAmt').value);if(!(a>0)){toast('금액을 넣어주세요');return}if(d.from===d.to){toast('보낸 사람과 받은 사람이 같아요');return}
    closeSheet(); await write([{op:'set',col:'transfers',id:t.id||uid(),data:{from:d.from,to:d.to,amount:a,cur:d.cur,memo:g('#tMemo').value.trim(),ts:t.ts||Date.now()}}],'정산을 기록했어요');};
  arm(g('#tDel'),async()=>{closeSheet();await write([{op:'delete',col:'transfers',id:t.id}],'삭제했어요')});
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
function mount(el){
  root=el; root.classList.add('lg');
  root.innerHTML=`<div class="lg-view"></div><button class="lgfab" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>지출 추가</button><div class="lgscrim"></div><div class="lgsheet" role="dialog" aria-modal="true"><div class="lgin"></div></div><div class="lgtoast"></div>`;
  view=q('.lg-view'); q('.lgfab').onclick=()=>openExpense(null); q('.lgscrim').onclick=closeSheet;
  const t=ls.get('tl_tab'); if(t&&TABS.some(x=>x.id===t))S.tab=t;
  render(); boot();
  clearInterval(pollT); pollT=setInterval(()=>{if(document.visibilityState==='visible'&&S.screen==='main'&&!S.saving&&!root.closest('[hidden]'))load()},POLL_MS);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.screen==='main')load()});
}
window.Ledger={mount,state:S,reload:load};
const auto=document.getElementById('ledger-root');
if(auto){ if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mount(auto)); else mount(auto); }
})();
