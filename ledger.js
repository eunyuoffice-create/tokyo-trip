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
  scope:'mine',err:'',saving:0,pending:false,loginIdx:null,loaded:false,openMemos:new Set(),meta:{},secOpen:(()=>{try{return JSON.parse(localStorage.getItem('tl_sec')||'{"mine":true,"shared":true}')}catch(e){return {mine:true,shared:true}}})()};
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
const toast=m=>{const t=q('.lgtoast',ov);if(!t)return;t.classList.remove('lgtoast-undo');t.textContent=m;t.classList.add('lgshow');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('lgshow'),1800)};
const svgCheck='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
const svgX='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const svgLock='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const svgMore='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const svgUser='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const svgIn='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M13 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/></svg>';
const svgOut='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/></svg>';
const svgGear='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

/* ---------- api ---------- */
async function api(body,{timeout=20000}={}){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),timeout);
  try{
    const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,token:S.token||undefined}),signal:ctrl.signal});
    let j; try{j=await res.json()}catch(e){throw {code:'network',message:'응답을 읽지 못했어요'}}
    if(!j.ok) throw {code:j.error||'server',message:j.error||'server',status:res.status,data:j};
    return j;
  }catch(e){ if(e&&e.code)throw e; throw {code:'network',message:String(e&&e.message||e)} }
  finally{clearTimeout(t)}
}
/* ---------- 끊김 대비: 일시적 실패 판별 · 저장 대기열(outbox) · 마지막 목록 캐시 ----------
   네트워크가 끊기거나 서버/DB가 5xx(무료 한도 초과 포함)면 화면은 마지막으로 받은 내용으로 계속 보여 주고,
   쓰기는 휴대폰(localStorage)에 쌓아 두었다가 연결되면 순서대로 다시 보낸다. 대기열·캐시는 멤버별 키. */
const transient=e=>!!e&&(e.code==='network'||!e.status||e.status>=500);
const obKey=()=>'tl_outbox_'+(S.me??ls.get('tl_me')??'x');
const cacheKey=()=>'tl_cache_'+(S.me??ls.get('tl_me')??'x');
function outbox(){ try{ const a=JSON.parse(ls.get(obKey())||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function setOutbox(a){ try{ if(a.length)localStorage.setItem(obKey(),JSON.stringify(a)); else localStorage.removeItem(obKey()); return true; }catch(e){ return false; } }
function queueOps(ops){ const a=outbox(); a.push({ops,ts:Date.now()}); if(setOutbox(a))return true;
  // 저장 공간 부족(사진이 큼): 사진 원본만 빼고 다시 시도
  const slim=ops.filter(o=>!(o.col==='images'&&!String(o.id).endsWith('.t'))); a[a.length-1]={ops:slim,ts:Date.now()}; if(slim.length&&setOutbox(a)){ toast('휴대폰 저장 공간이 부족해 사진 원본은 못 남겼어요'); return true; } return false; }
const pendingOps=()=>outbox().flatMap(x=>x.ops);
let flushing=null;
function flushOutbox(){ if(flushing)return flushing; if(!S.token||!outbox().length)return Promise.resolve(true);
  flushing=(async()=>{ let a=outbox(), sent=0;
    try{ while(a.length){ try{ await api({action:'write',ops:a[0].ops}); sent++; }
        catch(e){ if(transient(e))return false; if(e.code==='auth')return false; toast('대기 중이던 저장 하나는 서버가 거절해서 뺐어요'); }
        a=outbox(); a.shift(); setOutbox(a); }
      if(sent){ toast(`대기 중이던 저장 ${sent}건을 보냈어요`); S.v=''; } return true; }
    finally{ flushing=null; paintSync(); } })();
  return flushing; }
/* 서버·캐시 어디서 온 목록이든, 아직 못 보낸 내 수정은 위에 다시 얹는다 */
function reapplyPending(){ pendingOps().forEach(op=>{ if(['expenses','transfers','memos'].includes(op.col))localApply(op); }); }
function saveCache(j){ try{ const {v,...rest}=j; localStorage.setItem(cacheKey(),JSON.stringify({...rest,at:Date.now()})); }catch(e){} }
function loadCache(){ try{ return JSON.parse(ls.get(cacheKey())||'null'); }catch(e){ return null; } }
const hhmm=t=>new Date(t).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
function syncHtml(){ const n=outbox().length; if(!S.offline&&!n)return ''; return `<div class="lgsync">${S.offline?`📴 연결 안 됨 · 마지막 동기화 ${S.syncAt?hhmm(S.syncAt):'-'}`:'저장 보내는 중'}${n?` · 저장 대기 ${n}건`:''}</div>`; }
function paintSync(){ document.querySelectorAll('.lgsync-slot').forEach(el=>el.innerHTML=syncHtml()); }
function applyList(j){
  S.me=j.me; S.people=j.people||[]; S.rate=+j.rate||S.rate; S.rateInfo=j.rateInfo||S.rateInfo;
  S.expenses=Object.entries(j.expenses||{}).map(([id,e])=>({id,...e,amount:+e.amount||0,payer:+e.payer||0,parts:Array.isArray(e.parts)?e.parts.map(Number):[]}));
  S.transfers=Object.entries(j.transfers||{}).map(([id,t])=>({id,...t,amount:+t.amount||0,from:+t.from||0,to:+t.to||0}));
  S.memos=Object.entries(j.memos||{}).map(([id,m])=>({id,...m,items:Array.isArray(m.items)?m.items:[],images:Array.isArray(m.images)?m.images:[]}));
  S.meta=j.meta||{}; S.metaKnown=j.meta!==undefined;   // 옛 서버(meta 없음)에서는 시드·보정을 돌리지 않는다
  S.loaded=true;
}
let loading=false;
async function load(){
  if(!S.token||loading)return; loading=true;
  try{
    await flushOutbox();
    const j=await api({action:'list',v:S.loaded&&!outbox().length?S.v:''});
    const was=S.offline; S.offline=false; S.syncAt=Date.now();
    if(j.unchanged&&S.loaded&&S.screen==='main'){ if(was||S.err){S.err='';render();} else paintSync(); return; }
    applyList(j); S.v=j.v||''; saveCache(j); reapplyPending(); S.screen='main'; S.err=''; render(); seedNotes();
  }
  catch(e){
    if(e.code==='auth'){logout(false);await boot();}
    else if(e.code==='not_setup'){logout(false);await boot();}
    else if(transient(e)&&S.loaded){ if(!S.offline){S.offline=true;render();} else paintSync(); }
    else{S.err=e.code==='network'?'서버에 연결하지 못했어요. 잠시 후 다시 시도돼요.':String(e.message||'');render()}
  }finally{loading=false}
}
async function boot(){
  S.token=ls.get('tl_token')||''; 
  // 마지막으로 받은 목록이 있으면 먼저 그걸로 그려서 바로 보이게 (서버가 안 돼도 볼 수 있음)
  if(S.token&&!S.loaded){ const c=loadCache(); if(c&&c.me!==undefined&&String(c.me)===String(ls.get('tl_me'))){ applyList(c); reapplyPending(); S.syncAt=c.at; S.screen='main'; render(); } }
  if(S.token){await load(); if(S.screen==='main')return;}
  try{ const st=await api({action:'status'}); S.people=st.people||[]; S.rate=+st.rate||S.rate; S.rateInfo=st.rateInfo||S.rateInfo; S.screen=st.setup?'login':'setup'; S.err=''; }
  catch(e){ S.screen='error'; S.err=e.code==='network'?'서버에 연결하지 못했어요. 로컬 미리보기라면 `node dev/server.js`로 띄워야 해요.':String(e.message||'') }
  render();
}
function logout(rerender=true){ try{localStorage.removeItem(cacheKey())}catch(e){} S.token=''; S.me=null; S.v=''; S.loaded=false; S.offline=false; ls.del('tl_token'); S.screen='login'; if(rerender)render(); }

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
  try{ if(outbox().length)throw {code:'network'};   // 앞에 대기 중인 저장이 있으면 순서 지키려고 뒤에 붙임
    await api({action:'write',ops}); S.v=''; if(okMsg)toast(okMsg); return true; }
  catch(e){
    if(transient(e)){ if(queueOps(ops)){ if(e.code==='network'||e.status)S.offline=true; toast('연결되면 자동으로 저장해요'); paintSync(); flushOutbox(); return true; } toast('저장 실패 — 휴대폰 저장 공간이 부족해요'); return false; }
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

/* ---------- 글 본문: ## 소제목, - 목록, 빈 줄 문단, [이름](url) 링크, 주소 자동 링크 ---------- */
/* 강조 문법: <글자> → 굵게, #글자# → 빨간색. 링크 안쪽은 건드리지 않는다 */
/* 강조 문법은 일반 특수문자(<, >, #, → 등)와 안 겹치게 **굵게**, !!빨강!! 만 쓴다 */
const emph=h=>h.split(/(<a [^>]*>.*?<\/a>)/).map((seg,i)=>i%2?seg:seg.replace(/\*\*([^*\n]{1,80}?)\*\*/g,'<b class="lgem">$1</b>').replace(/!!([^!\n]{1,60}?)!!/g,'<span class="lgred">$1</span>')).join('');
const mdLinks=t=>{let out='',last=0; const re=/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g; let m; while((m=re.exec(t))){ out+=emph(linkify(t.slice(last,m.index)))+`<a href="${esc(m[2])}" target="_blank" rel="noopener" class="lglinkx">${esc(m[1])} ↗</a>`; last=m.index+m[0].length; } return out+emph(linkify(t.slice(last))); };
function bodyHtml(t){ let h='',ul=false; const close=()=>{if(ul){h+='</ul>';ul=false}};
  String(t||'').split('\n').forEach(l=>{ const s=l.trim(); let m;
    if(!s){close(); h+='<div class="lgbr"></div>'; return}
    if((m=s.match(/^##\s*(.+)/))){close(); h+=`<div class="lgh2">${mdLinks(m[1])}</div>`; return}
    if((m=s.match(/^[-•]\s+(.+)/))){ if(!ul){h+='<ul class="lgul">';ul=true} h+=`<li>${mdLinks(m[1])}</li>`; return}
    close(); h+=`<div class="lgp">${mdLinks(s)}</div>`; });
  close(); return h; }
/* ---------- 사진: images 컬렉션에 data URL 로 저장, 화면에서는 id 로 참조해 필요할 때 받아온다 ---------- */
const imgCache={};
async function imgSrc(id){ if(imgCache[id])return imgCache[id]; try{ const j=await api({action:'image',id}); imgCache[id]=j.data; return j.data; }catch(e){ return ''; } }
const imgTag=(ref,cls='lgimg')=>/^(img\/|https?:|data:)/.test(ref)?`<img class="${cls}" src="${esc(ref)}" alt="" loading="lazy">`:`<img class="${cls}" data-imgid="${esc(ref)}" alt="">`;
function fillImages(root){ (root||document).querySelectorAll('img[data-imgid]:not([src])').forEach(async im=>{ let src=await imgSrc(im.dataset.imgid); if(!src&&im.dataset.full)src=await imgSrc(im.dataset.full); if(src)im.src=src; else im.classList.add('lgimg-missing'); }); }
/* 영수증·지출 사진: 목록·폼에는 작은 썸네일(<id>.t, 약 10KB)만 받고, 누르면 원본을 받아서 크게 */
const thumbTag=id=>`<img class="lgimg" data-imgid="${esc(id)}.t" data-full="${esc(id)}" alt="">`;
async function openThumb(t){ const im=t.querySelector('img'); if(!im)return; if(im.dataset.full){ toast('사진 여는 중…'); const src=await imgSrc(im.dataset.full); if(src){openImg(src);return} } if(im.src)openImg(im.src); }
function makeThumb(dataUrl,max=240){ return new Promise(res=>{ const im=new Image(); im.onload=()=>{ const r=Math.min(1,max/Math.max(im.width,im.height)); const c=document.createElement('canvas'); c.width=Math.round(im.width*r); c.height=Math.round(im.height*r); c.getContext('2d').drawImage(im,0,0,c.width,c.height); let d=c.toDataURL('image/webp',0.7); if(!d.startsWith('data:image/webp'))d=c.toDataURL('image/jpeg',0.7); res(d); }; im.onerror=()=>res(''); im.src=dataUrl; }); }
function openImg(src){ if(window.openLightbox)openLightbox(src,''); else window.open(src,'_blank'); }
function resizeImage(file,max=1280){ return new Promise((res,rej)=>{ const url=URL.createObjectURL(file); const im=new Image(); im.onload=()=>{ let {width:w,height:h}=im; const r=Math.min(1,max/Math.max(w,h)); w=Math.round(w*r); h=Math.round(h*r); const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(im,0,0,w,h);
    // WebP 가 되는 브라우저(크롬·최신 사파리)는 WebP, 아니면 JPEG. 400KB 넘으면 품질을 낮춰 다시
    const enc=(type,q)=>{const d=c.toDataURL(type,q); return d.startsWith('data:'+type)?d:null};
    let q=0.8, d=enc('image/webp',q)||enc('image/jpeg',q); const type=d.startsWith('data:image/webp')?'image/webp':'image/jpeg';
    while(d.length>420000&&q>0.4){ q-=0.12; d=enc(type,q); }
    URL.revokeObjectURL(url); res({data:d,w,h}); }; im.onerror=()=>rej(new Error('이미지를 열 수 없어요')); im.src=url; }); }
function pickImages(max=10){ return new Promise(res=>{ const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.multiple=max>1; inp.style.display='none'; document.body.appendChild(inp);
  inp.onchange=async()=>{ const files=[...inp.files].slice(0,max); inp.remove(); if(!files.length){res([]);return} toast(`사진 ${files.length}장 올리는 중…`); const ids=[];
    for(const f of files){ try{ const {data,w,h}=await resizeImage(f); const id='im-'+uid(); await api({action:'write',ops:[{op:'set',col:'images',id,data:{data,w,h}}]}); imgCache[id]=data; ids.push(id); }catch(e){ toast('사진 하나를 못 올렸어요: '+(e.message||e)); } }
    res(ids); };
  inp.click(); }); }
/* ---------- 예전 하드코딩 메모 카드 → 공용 메모로 한 번 옮기기 ---------- */
let seedingNotes=false;
async function seedNotes(){
  if(seedingNotes||!window.NOTE_SEED||S.screen!=='main'||!S.metaKnown)return;
  if(S.meta.notes&&S.meta.notes.seeded){ const fx=S.memos.find(m=>m.id==='note-flight'&&m.type!=='flight'); if(fx&&!seedingNotes){ seedingNotes=true; try{ const sd=NOTE_SEED.find(x=>x.id==='note-flight'); await api({action:'write',ops:[{op:'update',col:'memos',id:'note-flight',data:{type:'flight',legs:sd.legs,body:sd.body}}]}); await load(); }catch(e){} finally{seedingNotes=false} return; }
    const split=S.memos.filter(m=>m.cat==='info'&&m.type==='doc'&&m.body&&m.body.trim()); if(split.length&&!seedingNotes){ seedingNotes=true; try{ const ops=split.map(m=>{const pre=bodyToBlocks(m.body); if(pre.length&&(m.cover||(m.links||[]).length)){pre[0].img=pre[0].img||m.cover||''; pre[0].links=[...pre[0].links,...(m.links||[])];} return {op:'update',col:'memos',id:m.id,data:{body:'',cover:'',links:[],blocks:[...pre,...(m.blocks||[])]}}}); for(let i=0;i<ops.length;i+=10) await api({action:'write',ops:ops.slice(i,i+10)}); await load(); }catch(e){} finally{seedingNotes=false} return; }
    // 한 단락 안에 '## 소제목'이 여러 개 들어가 있으면 단락으로 쪼갠다
    const resplit=S.memos.filter(m=>m.cat==='info'&&m.type==='doc'&&(m.blocks||[]).some(b=>b.k==='sec'&&/^##\s/m.test(b.body||''))); if(resplit.length&&!seedingNotes){ seedingNotes=true; try{ const ops=resplit.map(m=>{const blocks=[]; (m.blocks||[]).forEach(b=>{ if(b.k==='sec'&&/^##\s/m.test(b.body||'')){ const pre=bodyToBlocks(b.body); if(pre.length){ if(b.title&&!pre[0].title)pre[0].title=b.title; else if(b.title)pre.unshift({k:'sec',id:uid(),title:b.title,body:'',img:'',links:[]}); pre[0].img=pre[0].img||b.img||''; pre[0].links=[...(b.links||[]),...pre[0].links]; blocks.push(...pre); } else blocks.push(b); } else blocks.push(b); }); return {op:'update',col:'memos',id:m.id,data:{blocks}}}); for(let i=0;i<ops.length;i+=10) await api({action:'write',ops:ops.slice(i,i+10)}); await load(); }catch(e){} finally{seedingNotes=false} return; }
    const conv=S.memos.filter(m=>m.cat==='info'&&['text','list'].includes(m.type)); if(conv.length&&!seedingNotes){ seedingNotes=true; try{ const ops=conv.map(m=>{ if(m.id==='note-hotel'){ const sd=NOTE_SEED.find(x=>x.id==='note-hotel'); return {op:'update',col:'memos',id:m.id,data:{type:'hotel',hotel:sd.hotel,body:sd.body,links:[],cover:'',blocks:[],items:[]}}; } const d=infoDocOf(m); return {op:'update',col:'memos',id:m.id,data:{type:'doc',cover:d.cover||'',links:d.links||[],blocks:d.blocks||[],body:d.body||'',items:[]}}; }); for(let i=0;i<ops.length;i+=10) await api({action:'write',ops:ops.slice(i,i+10)}); await load(); }catch(e){} finally{seedingNotes=false} return; }
    const fix=S.memos.filter(m=>m.id&&m.id.startsWith('note-')&&m.cat!=='info'); if(fix.length&&!seedingNotes){ seedingNotes=true; try{ await api({action:'write',ops:fix.map(m=>({op:'update',col:'memos',id:m.id,data:{cat:'info',tag:(NOTE_SEED.find(x=>x.id===m.id)||{}).tag||''}}))}); await load(); }catch(e){} finally{seedingNotes=false} return; }
    // 선물·쇼핑 정보 2판(notes-v2.js): 문서의 sv 가 ver 보다 낮으면 blocks 를 새 내용으로 바꾼다 (사진이 같은 항목은 체크 상태 유지)
    const v2=window.NOTE_V2; const verOf=d=>+(d&&d.v)||(v2&&v2.ver)||0; const up=v2&&v2.docs?S.memos.filter(m=>m.cat==='info'&&v2.docs[m.id]&&(+m.sv||1)<verOf(v2.docs[m.id])):[]; const made=(S.meta.notes&&S.meta.notes.made)||[]; const mk=v2&&v2.docs?Object.keys(v2.docs).filter(id=>v2.docs[id].create&&!S.memos.some(m=>m.id===id)&&!made.includes(id)):[]; if((up.length||mk.length)&&!seedingNotes){ seedingNotes=true; try{ const ops=up.map(m=>{ const d=v2.docs[m.id]; const old=(m.blocks||[]).filter(b=>b.k==='item'); const blocks=d.blocks.map(b=>b.k==='item'?{k:'item',id:uid(),title:b.title||'',desc:b.desc||'',img:b.img||'',link:b.link||null,done:!!(b.img&&old.find(o=>o.done&&o.img===b.img))}:{k:'sec',id:uid(),title:b.title||'',body:b.body||'',img:b.img||'',links:b.links||[]}); const data={type:'doc',sv:verOf(d),blocks,body:'',cover:'',links:[]}; if(d.title)data.title=d.title; if(d.tag!==undefined)data.tag=d.tag; return {op:'update',col:'memos',id:m.id,data}; }); mk.forEach(id=>{ const d=v2.docs[id]; const blocks=d.blocks.map(b=>b.k==='item'?{k:'item',id:uid(),title:b.title||'',desc:b.desc||'',img:b.img||'',link:b.link||null,done:false}:{k:'sec',id:uid(),title:b.title||'',body:b.body||'',img:b.img||'',links:b.links||[]}); ops.push({op:'set',col:'memos',id,data:{type:'doc',owner:null,cat:'info',tag:d.tag||'',title:d.title||id,sv:verOf(d),items:[],legs:[],blocks,body:'',cover:'',links:[],images:[],ts:Date.now(),order:+d.order||0}}); }); if(mk.length)ops.push({op:'update',col:'meta',id:'notes',data:{made:[...made,...mk]}}); for(let i=0;i<ops.length;i+=10) await api({action:'write',ops:ops.slice(i,i+10)}); await load(); }catch(e){} finally{seedingNotes=false} return; }
    return; }
  seedingNotes=true;
  try{ const n=NOTE_SEED.length; const ops=NOTE_SEED.map((x,i)=>({op:'set',col:'memos',id:x.id,data:{type:x.type,owner:null,cat:'info',tag:x.tag||'',title:x.title,items:[],legs:x.legs||[],hotel:x.hotel||undefined,blocks:x.blocks||(x.type==='doc'?bodyToBlocks(x.body):(x.items||[]).map(it=>({k:'item',id:it.id,title:it.text,desc:'',img:it.img||'',link:null,done:false}))),body:x.type==='doc'?'':(x.body||''),cover:'',links:[],images:[],ts:Date.now(),order:(n-i)*1000}}));
    for(let i=0;i<ops.length;i+=10) await api({action:'write',ops:ops.slice(i,i+10)});
    await api({action:'write',ops:[{op:'set',col:'meta',id:'notes',data:{seeded:true}}]});
    await load(); toast('메모 탭의 안내 카드들을 공용 메모로 옮겼어요');
  }catch(e){ toast('메모 옮기기 실패: '+(e.message||e)); }
  finally{ seedingNotes=false; }
}
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
  view.innerHTML=h; bind(view); fillImages(view);
  if(userEl){ userEl.innerHTML=userHtml(); bind(userEl); }
  if(window.Content&&Content.onAuth)Content.onAuth();
  if(memoView){ memoView.innerHTML=S.screen==='main'?viewMemo():viewMemoLocked(); bind(memoView); fillImages(memoView); if(window.TripSite&&TripSite.renderChips&&TripSite.state.tab==='memo')TripSite.renderChips(); }
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
  let h=`<div class="lgsync-slot">${syncHtml()}</div>`;
  if(S.err) h+=`<div class="lgbanner">⚠️ <div>${esc(S.err)}</div></div>`;
  h+=viewHome();
  // 고정 버튼 바 (하단 메뉴 위에 따라다님)
  h+=`<div class="lgbar"><div class="lgadd2 lgadd3x"><button class="lgaddexp" data-act="add-shared">${svgPlus}공용 지출</button><button class="lgaddexp lgaddmine" data-act="add-mine">${svgPlus}내 지출</button><button class="lgaddexp lgaddcam" data-act="receipt" aria-label="영수증 찍어서 등록">${svgCam}<span>영수증</span></button></div></div>`;
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
  let h=`<details class="lgdetails lgsummary"><summary><span class="lgsumt"><span class="lgnum">공용 ${pair(tj,tk)}</span><span class="lgsub">1인 약 ${fmt(total/n,'KRW')}</span></span></summary><div class="lgdetails-b">`;
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
  const rc=e.receipt?`<span class="lgthumb lgthumb-rc" aria-label="영수증 크게 보기">${thumbTag(e.receipt)}</span>`:'';
  const itemsN=Array.isArray(e.items)&&e.items.length?`<span>· 품목 ${e.items.filter(x=>x.sel!==false).length}</span>`:'';
  return `<div class="lgrow ${!priv&&e.settled?'lgsettled':''}">${check}<div class="lgrowbody" role="button" tabindex="0" data-exp="${esc(e.id)}">${rc}<div class="lgmid"><div class="ti">${priv?`<span class="lglock">${svgLock}</span>`:''}<span class="lgtrunc">${esc(e.title||'(내용 없음)')}</span></div><div class="si">${sub}${itemsN}</div>${e.memo?`<div class="mi">${esc(e.memo)}</div>`:''}${linkHtml}</div><div class="lgamt"><div class="aa">${fmt(e.amount,e.cur)}</div>${right}</div><span class="lgchev" aria-hidden="true"></span></div></div>`;
}

/* ---------- 메모: 목록은 한 줄씩, 쓰기·보기는 시트에서 ---------- */
const svgDrag='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>';
const svgList='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><path d="M5 7.5l1.5 1.5L9 6"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 7.5h7M14 17.5h7"/></svg>';
const svgText='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/><path d="M4 4h7"/></svg>';
function viewMemo(){
  let h=`<div class="lgsync-slot">${syncHtml()}</div>`;
  const isInfo=m=>m.cat==='info';
  const secs=[{k:'mine',title:'내 메모',sub:`${pname(S.me)}만 봄`,list:S.memos.filter(m=>ownerOf(m)===S.me&&!isInfo(m))},{k:'shared',title:'공용 메모',sub:'둘 다 보고 체크',list:S.memos.filter(m=>isShared(m)&&!isInfo(m))},{k:'info',title:'여행 정보',sub:'항공·숙소·쇼핑 같은 안내 글',list:S.memos.filter(isInfo)}];
  secs.forEach(sec=>{
    if(!sec.list.length)return;
    const list=sec.list.slice().sort((a,b)=>(memoDone(a)?1:0)-(memoDone(b)?1:0)||(b.order||b.ts||0)-(a.order||a.ts||0));
    h+=`<details class="lgsecacc" data-sec="${sec.k}" ${S.secOpen[sec.k]!==false?'open':''}><summary><h3>${sec.title} <span class="lgsub">${esc(sec.sub)}</span></h3><span class="lgnum">${list.length}개</span></summary><div class="lgmemolist">${list.map(memoRow).join('')}</div></details>`;
  });
  h=`<div class="lghint lgtophint">메모를 길게 눌러 끌면 순서를 바꿀 수 있어요 · 체크는 바로 저장돼요</div>`+h;
  if(!S.memos.length) h+=`<div class="lghint" style="text-align:center;margin:6px 0 10px">아래 [내 메모] [공용 메모] [정보]로 써요.</div>`;
  h+=`<div class="lgbar"><div class="lgadd2 lgadd3"><button class="lgaddexp lgaddmine" data-newmemo="mine">${svgPlus}내 메모</button><button class="lgaddexp lgaddmine" data-newmemo="shared">${svgPlus}공용 메모</button><button class="lgaddexp lgaddinfo" data-newmemo="info">${svgPlus}정보</button></div></div>`;
  return h;
}
function memoRow(m){
  // 아코디언: 머리글을 누르면 쓴 내용이 펼쳐지고, 체크는 바로, 나머지 수정은 "수정" 팝업에서
  const list=m.type!=='text'&&m.type!=='flight'; const items=m.items||[]; const done=items.filter(i=>i.done).length; const priv=!isShared(m);
  const body=String(m.body||'');
  const title=m.title||(list?'제목 없는 리스트':(body.replace(/\s+/g,' ').trim().slice(0,30)||'제목 없는 글'));
  const open=S.openMemos.has(m.id); const mdone=memoDone(m); const info=m.cat==='info';
  let inner;
  if(list){
    const li=it=>`<div class="lgli ${it.done?'lgdone':''}"><button type="button" class="lgbox" data-tgl-m="${esc(m.id)}|${esc(it.id)}" aria-label="완료">${svgCheck}</button>${it.img?`<span class="lgthumb" data-img="${esc(it.img)}">${imgTag(it.img,'lgimg lgimg-sm')}</span>`:''}<span class="lgtx">${mdLinks(it.text)}</span></div>`;
    if(!items.length) inner=`<div class="lghint" style="margin:0 0 6px">아직 항목이 없어요.</div>`;
    else if(priv) inner=items.map(li).join('');
    else{
      // 공용 체크리스트: 담당자별로 묶어서 (나 → 다른 멤버 → 담당 없음)
      const groups=[]; const order=[S.me,...S.people.map((p,i)=>i).filter(i=>i!==S.me),null];
      order.forEach(w=>{const sub=items.filter(it=>whoOf(it)===w); if(sub.length)groups.push({w,sub})});
      if(groups.length===1&&groups[0].w===null) inner=groups[0].sub.map(li).join('');
      else inner=groups.map(g=>`<div class="lgwgrp"><div class="lgwgrp-h"><span class="lgwho ${g.w===null?'lgwho-none':g.w===S.me?'lgwho-me':''}">${g.w===null?'담당 없음':esc(pname(g.w))}</span><span class="lgsub">${g.sub.filter(i=>i.done).length}/${g.sub.length}</span></div>${g.sub.map(li).join('')}</div>`).join('');
    }
  }else inner=body.trim()?`<div class="lgmemobody">${bodyHtml(body)}</div>`:`<div class="lghint" style="margin:0 0 6px">내용이 없어요.</div>`;
  if(m.images&&m.images.length){ if(list) inner=`<div class="lgcover"><span class="lgthumb lgthumb-cover" data-img="${esc(m.images[0])}">${imgTag(m.images[0])}</span></div>`+inner; else inner+=`<div class="lgimgs">${m.images.map(id=>`<span class="lgthumb" data-img="${esc(id)}">${imgTag(id)}</span>`).join('')}</div>`; }
  if(info) return infoCardHtml(m,open);

  return `<details class="lgdetails lgmemoacc ${mdone?'lgmdone':''}" data-accm="${esc(m.id)}" ${open?'open':''}><summary><button type="button" class="lgbox lgbox-m" data-mdone="${esc(m.id)}" aria-pressed="${mdone}" aria-label="${list?'전체 체크':'확인 완료'}">${svgCheck}</button><span class="lgmic ${list?'lgmic-list':'lgmic-text'}" title="${list?'체크 리스트':'글'}">${list?svgList:svgText}</span><span class="lgmtitle">${priv?`<span class="lglock">${svgLock}</span>`:''}<span class="lgtrunc">${esc(title)}</span></span>${list&&items.length?`<span class="lgmprog ${done===items.length?'lgokt':''}">${done}/${items.length}</span>`:''}<span class="lgchevbtn" aria-hidden="true"></span></summary><div class="lgdetails-b lgmemoin">${inner}<div class="lgmemofoot"><span class="lgsub">${list?`${done}/${items.length} 완료`:''}</span><button type="button" class="lgaddbtn" data-memoedit="${esc(m.id)}">수정</button></div></div></details>`;
}
/* ---------- 여행 정보 문서 ---------- */
const infoDocOf=m=>{ if(['doc','flight','hotel'].includes(m.type))return m;
  if(m.type==='list') return {...m,type:'doc',cover:(m.images||[])[0]||'',links:m.links||[],blocks:(m.items||[]).map(it=>({k:'item',id:it.id,title:it.text,desc:'',img:it.img||'',link:null,done:!!it.done}))};
  return {...m,type:'doc',cover:(m.images||[])[0]||'',links:m.links||[],blocks:[],body:m.body||''}; };
/* 긴 본문을 단락 블록으로: '## 소제목' 마다 새 단락, '[이름](주소)' 줄은 그 단락의 링크로 */
function bodyToBlocks(body){ const out=[]; let cur=null; const open=t=>{cur={k:'sec',id:uid(),title:t,body:'',img:'',links:[]}; out.push(cur)};
  String(body||'').split('\n').forEach(l=>{ const t=l.trim(); let m;
    if((m=t.match(/^##\s*(.+)/))){ open(m[1].trim()); return; }
    if((m=t.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*$/))){ if(!cur)open(''); cur.links.push({l:m[1],u:m[2]}); return; }
    if(!cur){ if(!t)return; open(''); } cur.body+=(cur.body?'\n':'')+l; });
  out.forEach(b=>{b.body=b.body.replace(/\n{3,}/g,'\n\n').trim()}); return out.filter(b=>b.title||b.body||b.links.length); }
const infoSub=t=>String(t||'').split('\n').map(l=>{const s=l.trim(); let x; if(!s)return ''; if((x=s.match(/^##\s*(.+)/)))return `<div class="sub-h">${mdLinks(x[1])}</div>`; if((x=s.match(/^[-•]\s+(.+)/)))return `<p class="lgbul">· ${mdLinks(x[1])}</p>`; return `<p>${mdLinks(s)}</p>`;}).join('');
const linksBtns=ls=>(Array.isArray(ls)&&ls.length)?`<div class="lginfo-links">${ls.filter(x=>x&&x.u).map(x=>`<a class="btn link" href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.l||x.u.replace(/^https?:\/\//,'').slice(0,28))} ↗</a>`).join('')}</div>`:'';
const coverHtml=id=>id?`<span class="lgthumb lgthumb-cover" data-img="${esc(id)}">${imgTag(id)}</span>`:'';
function infoCardHtml(m0,open){
  const m=infoDocOf(m0); const title=m.title||'제목 없음'; let body='';
  if(m.type==='flight'){ const legs=Array.isArray(m.legs)?m.legs:[];
    body=coverHtml(m.cover)+legs.map(x=>`<div class="flight"><div><div class="ap">${esc(x.f)}</div><div class="tm">${esc(x.ft)}</div><div class="sm">${esc([x.d,x.fs].filter(Boolean).join(' · '))}</div></div><div class="arrow">${esc(x.no||'')}<br>→</div><div class="r"><div class="ap">${esc(x.t)}</div><div class="tm">${esc(x.tt)}</div><div class="sm">${esc(x.ts||'')}</div></div></div>`).join('')+(String(m.body||'').trim()?`<div style="margin-top:10px">${infoSub(m.body)}</div>`:'')+linksBtns(m.links); }
  else if(m.type==='hotel'){ const h=m.hotel||{}; const mapq=h.q||h.addr||m.title;
    body=coverHtml(m.cover)+`<dl class="kv">${h.addr?`<dt>주소</dt><dd>${esc(h.addr)}</dd>`:''}${(h.cin||h.cout)?`<dt>체크인·아웃</dt><dd>${esc([h.cin&&'체크인 '+h.cin,h.cout&&'체크아웃 '+h.cout].filter(Boolean).join(' · '))}</dd>`:''}${h.tel?`<dt>전화</dt><dd><a href="tel:${esc(h.tel)}">${esc(h.tel)}</a></dd>`:''}</dl>`+(String(m.body||'').trim()?`<div style="margin-top:10px">${infoSub(m.body)}</div>`:'')+`<div class="lginfo-links">${mapq?`<a class="btn map" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapq)}" target="_blank" rel="noopener">지도 열기 ↗</a>`:''}${(m.links||[]).filter(x=>x&&x.u).map(x=>`<a class="btn link" href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.l||x.u)} ↗</a>`).join('')}</div>`; }
  else { const blocks=Array.isArray(m.blocks)?m.blocks:[]; let items=[]; const flush=()=>{ if(!items.length)return ''; const h=`<div class="cl">${items.map(it=>`<label><input type="checkbox" data-blk="${esc(m.id)}|${esc(it.id)}" ${it.done?'checked':''}>${it.img?`<span class="lgthumb lgthumb-xs" data-img="${esc(it.img)}">${imgTag(it.img,'thumb')}</span>`:''}<span><b>${esc(it.title||'')}</b>${it.desc?mdLinks(it.desc):''}${it.link&&it.link.u?`<a class="lginfo-il" href="${esc(it.link.u)}" target="_blank" rel="noopener">${esc(it.link.l||'링크')} ↗</a>`:''}</span></label>`).join('')}</div>`; items=[]; return h; };
    body=coverHtml(m.cover)+(String(m.body||'').trim()?infoSub(m.body):'')+linksBtns(m.links);
    blocks.forEach(b=>{ if(b.k==='item'){items.push(b);return} body+=flush(); body+=`<div class="sub-h">${esc(b.title||'')}</div>`+(b.img?`<span class="lgthumb lgthumb-cover lgthumb-sec" data-img="${esc(b.img)}">${imgTag(b.img)}</span>`:'')+(b.body?infoSub(b.body):'')+linksBtns(b.links); });
    body+=flush(); const its=blocks.filter(b=>b.k==='item'); if(its.length)body+=`<div class="lgsub" style="text-align:right">${its.filter(i=>i.done).length}/${its.length} 완료</div>`; }
  return `<details class="memo lginfo" data-accm="${esc(m.id)}" ${open?'open':''}><summary><h3>${esc(title)}${m.tag?` <span class="pill acc">${esc(m.tag)}</span>`:''}</h3></summary><div class="lginfo-b">${body}<div class="lgmemofoot"><span></span><button type="button" class="lgaddbtn" data-memoedit="${esc(m.id)}">수정</button></div></div></details>`;
}
const memoDone=m=>{const items=m.items||[]; return (m.type!=='text'&&items.length)?items.every(i=>i.done):!!m.done};
const memoItems=m=>(m&&Array.isArray(m.items)?m.items:[]).map(x=>({...x}));
const whoOf=it=>(it.who===null||it.who===undefined||it.who===''||!S.people[+it.who])?null:+it.who;
const nextWho=cur=>{const n=S.people.length; if(cur===null||cur===undefined)return 0; return cur+1>=n?null:cur+1};
/* 항목 사진이 이미 있으면 한 번 더 누르면 지우고, 두 번째 누르면 바꾸기 */
function confirmReplace(b){ if(b.dataset.arm==='1'){ b.dataset.arm=''; return true; } b.dataset.arm='1'; b.classList.add('lgarm'); toast('한 번 더 누르면 사진을 바꿔요 (×는 항목 삭제)'); setTimeout(()=>{b.dataset.arm='';b.classList.remove('lgarm')},2500); return false; }
const FORMAT_HELP=`<details class="lghelp"><summary>글씨 꾸미기 · 서식 도움말</summary><div class="lghelp-b">
<div class="lghelp-row"><code>**굵게**</code><span>→ <b>굵게</b></span></div>
<div class="lghelp-row"><code>!!빨강!!</code><span>→ <span style="color:var(--accent);font-weight:600">빨강</span></span></div>
<div class="lghelp-row"><code>## 소제목</code><span>→ 줄 맨 앞에 쓰면 작은 제목</span></div>
<div class="lghelp-row"><code>- 항목</code><span>→ 줄 맨 앞에 쓰면 점 목록</span></div>
<div class="lghelp-row"><code>[이름](https://…)</code><span>→ 이름 ↗ 링크 버튼. 주소만 써도 자동 링크</span></div>
<div class="lghelp-row"><code>빈 줄</code><span>→ 문단 나누기. 그 외 특수문자(→ # &lt; &gt; 등)는 그대로 보여요</span></div></div></details>`;
function chooseInfo(){
  openSheet(`<h2>여행 정보 쓰기<button type="button" data-close>닫기</button></h2><div class="lgopts">
    <button type="button" data-mk="doc"><span class="lgic">${svgText}</span><div><b>글쓰기</b><span>제목·라벨·대표 사진·메모·링크. 아래에 단락(소제목+메모+링크)과 체크 항목을 계속 추가.</span></div></button>
    <button type="button" data-mk="flight"><span class="lgic">✈</span><div><b>항공편</b><span>출발·도착 공항과 시간, 편명을 넣으면 항공편 카드로.</span></div></button>
    <button type="button" data-mk="hotel"><span class="lgic">🏨</span><div><b>숙소</b><span>호텔 이름·주소·체크인/아웃·지도.</span></div></button></div>`);
  qa('[data-mk]',q('.lgsheet',ov)).forEach(b=>b.onclick=()=>{closeSheet(); setTimeout(()=>openInfoEditor(null,b.dataset.mk),200)});
}
const legRow=(x={})=>`<div class="crow lgleg"><div class="ckind"><span class="lgsub">구간</span><button type="button" class="lgx" data-delleg aria-label="삭제">×</button></div>
  <div class="lgrow2"><input type="text" class="lg-d" placeholder="날짜 (예: 10.24 토)" value="${esc(x.d||'')}"><input type="text" class="lg-no" placeholder="편명 (예: KE2101)" value="${esc(x.no||'')}"></div>
  <div class="lgrow3"><input type="text" class="lg-f" placeholder="출발 (GMP)" value="${esc(x.f||'')}" maxlength="6"><input type="text" class="lg-ft" placeholder="09:00" value="${esc(x.ft||'')}" maxlength="5"><input type="text" class="lg-fs" placeholder="김포 1터미널" value="${esc(x.fs||'')}"></div>
  <div class="lgrow3"><input type="text" class="lg-t" placeholder="도착 (HND)" value="${esc(x.t||'')}" maxlength="6"><input type="text" class="lg-tt" placeholder="11:20" value="${esc(x.tt||'')}" maxlength="5"><input type="text" class="lg-ts" placeholder="하네다 3터미널" value="${esc(x.ts||'')}"></div></div>`;
const readLegs=sh=>[...sh.querySelectorAll('#mLegs .lgleg')].map(r=>{const g=c=>(r.querySelector(c)?.value||'').trim(); const o={d:g('.lg-d'),no:g('.lg-no').toUpperCase(),f:g('.lg-f').toUpperCase(),ft:g('.lg-ft'),fs:g('.lg-fs'),t:g('.lg-t').toUpperCase(),tt:g('.lg-tt'),ts:g('.lg-ts')}; return (o.f||o.t||o.no)?o:null}).filter(Boolean);
/* ---------- 여행 정보 편집기: 글쓰기(doc) / 항공편(flight) / 숙소(hotel). 필수는 제목뿐 ---------- */
const linkRows=(id,arr,max)=>`<div class="lgf" data-links="${id}"><label>링크${max===1?' (1개)':''}</label><div class="lgclinks">${(arr||[]).filter(Boolean).map(x=>expLinkRow(x.l,x.u)).join('')}</div>${(max===1&&(arr||[]).length>=1)?'':`<button type="button" class="lglink" data-addlink="${id}" data-max="${max||0}">+ 링크 추가</button>`}</div>`;
function wireLinkRows(sh){ sh.querySelectorAll('[data-addlink]').forEach(b=>b.onclick=()=>{const box=b.parentElement.querySelector('.lgclinks'); const max=+b.dataset.max; if(max&&box.children.length>=max)return; box.insertAdjacentHTML('beforeend',expLinkRow('','')); wireLinkRows(sh); if(max&&box.children.length>=max)b.hidden=true; const f=box.lastElementChild.querySelector('input'); if(f)f.focus();}); sh.querySelectorAll('.lgclinks [data-dellink]').forEach(b=>b.onclick=()=>{const wrap=b.closest('[data-links]'); b.closest('.lgclink').remove(); const add=wrap&&wrap.querySelector('[data-addlink]'); if(add)add.hidden=false;}); }
const readLinkRows=(root,id)=>[...root.querySelectorAll(`[data-links="${id}"] .lgclink`)].map(r=>{const [a,b]=r.querySelectorAll('input'); let u=(b.value||'').trim(); if(!u)return null; if(!/^https?:\/\//i.test(u))u='https://'+u; return {l:(a.value||'').trim(),u}}).filter(Boolean);
const oneImg=(id,label,cur)=>`<div class="lgf" data-oneimg="${id}"><label>${label}</label><div class="lgimgs lgimgs-edit">${cur?`<span class="lgthumb" data-cur="${esc(cur)}">${imgTag(cur)}<b data-rmimg>×</b></span>`:''}</div><button type="button" class="lglink" data-pickimg>${cur?'사진 바꾸기':'+ 사진 추가 (1장)'}</button></div>`;
function wireOneImgs(sh){ sh.querySelectorAll('[data-oneimg]').forEach(box=>{ const btn=box.querySelector('[data-pickimg]'); if(btn)btn.onclick=async()=>{ const ids=await pickImages(1); if(!ids.length)return; box.dataset.val=ids[0]; box.querySelector('.lgimgs').innerHTML=`<span class="lgthumb" data-cur="${esc(ids[0])}">${imgTag(ids[0])}<b data-rmimg>×</b></span>`; fillImages(box); btn.textContent='사진 바꾸기'; wireOneImgs(sh); }; const rm=box.querySelector('[data-rmimg]'); if(rm)rm.onclick=()=>{ box.dataset.val=''; box.querySelector('.lgimgs').innerHTML=''; btn.textContent='+ 사진 추가 (1장)'; }; if(box.dataset.val===undefined){ const cur=box.querySelector('[data-cur]'); box.dataset.val=cur?cur.dataset.cur:''; } }); }
const readOneImg=(root,id)=>{const b=root.querySelector(`[data-oneimg="${id}"]`); return b?(b.dataset.val||''):''};
function openInfoEditor(m,type){
  const isNew=!m; const d=isNew?{type,title:'',tag:'',cover:'',body:'',links:[],blocks:[],legs:[],hotel:{}}:infoDocOf(m); type=d.type;
  let blocks=(d.blocks||[]).map(b=>({...b,id:b.id||uid()}));
  if(type==='doc'){ if((d.body&&d.body.trim())||d.cover||(d.links&&d.links.length)){ const pre=bodyToBlocks(d.body); if(!pre.length)pre.push({k:'sec',id:uid(),title:'',body:'',img:'',links:[]}); pre[0].img=pre[0].img||d.cover||''; pre[0].links=[...(pre[0].links||[]),...(d.links||[])]; blocks=[...pre,...blocks]; } if(!blocks.length) blocks=[{k:'sec',id:uid(),title:'',body:'',img:'',links:[]}]; }
  const blockHtml=(b,i)=>b.k==='item'
    ?`<div class="crow lgblk" data-bi="${i}" data-k="item"><div class="ckind"><span class="lgsub">☑ 체크 항목</span><span class="lgblkgrip" data-blkgrip aria-label="끌어서 순서 바꾸기">⋮⋮</span><button type="button" class="lgx" data-delblk aria-label="삭제">×</button></div>${oneImg('b'+i,'이미지 (1장)',b.img)}<input type="text" class="bk-title" placeholder="타이틀" value="${esc(b.title||'')}" maxlength="80"><textarea class="bk-desc" rows="2" placeholder="디스크립션">${esc(b.desc||'')}</textarea>${linkRows('b'+i,b.link?[b.link]:[],1)}</div>`
    :`<div class="crow lgblk" data-bi="${i}" data-k="sec"><div class="ckind"><span class="lgsub">▎ 단락</span><span class="lgblkgrip" data-blkgrip aria-label="끌어서 순서 바꾸기">⋮⋮</span><button type="button" class="lgx" data-delblk aria-label="삭제">×</button></div><input type="text" class="bk-title" placeholder="소제목" value="${esc(b.title||'')}" maxlength="80">${oneImg('b'+i,'이미지 (1장)',b.img)}<textarea class="bk-desc" rows="3" placeholder="메모">${esc(b.body||'')}</textarea>${linkRows('b'+i,b.links||[],0)}</div>`;
  const common=`<div class="lgf"><label>타이틀 <span class="lgreq" aria-label="필수">*</span></label><input type="text" id="iTitle" placeholder="타이틀" value="${esc(d.title)}" maxlength="60"></div>
    <div class="lgf"><label>라벨 <span class="lgsub">제목 옆 작은 표시</span></label><input type="text" id="iTag" value="${esc(d.tag||'')}" maxlength="20" placeholder="예: 대한항공, 10/26"></div>
    ${oneImg('cover','타이틀 이미지 (1장)',d.cover)}`;
  let form='';
  const head2=`<div class="lgf"><label>타이틀 <span class="lgreq" aria-label="필수">*</span></label><input type="text" id="iTitle" placeholder="타이틀" value="${esc(d.title)}" maxlength="60"></div>
    <div class="lgf"><label>라벨 <span class="lgsub">제목 옆 작은 표시</span></label><input type="text" id="iTag" value="${esc(d.tag||'')}" maxlength="20" placeholder="예: 대한항공, 10/26"></div>`;
  if(type==='doc') form=head2+`<div style="margin:-4px 0 10px">${FORMAT_HELP}</div>
    <div class="lgf"><label>단락 · 체크 항목 <span class="lgsub">순서대로 쌓여요</span></label><div class="crows" id="iBlocks">${blocks.map(blockHtml).join('')}</div><div class="lgchips" style="margin-top:6px"><button type="button" class="lgchip" id="iAddSec">+ 단락</button><button type="button" class="lgchip" id="iAddItem">+ 체크 항목</button></div></div>`;
  else if(type==='flight') form=common+`<div class="lgf"><label>구간</label><div class="crows" id="mLegs">${((d.legs&&d.legs.length)?d.legs:[{}]).map(legRow).join('')}</div><button type="button" class="lglink" id="mAddLeg">+ 구간 추가</button></div><div class="lgf"><label>메모</label><textarea id="iBody" rows="4" placeholder="예약번호 안내, 전자신고 링크 등">${esc(d.body||'')}</textarea>${FORMAT_HELP}</div>${linkRows('top',d.links||[],0)}`;
  else { const h=d.hotel||{}; form=common+`<div class="lgf"><label>주소</label><input type="text" id="hAddr" value="${esc(h.addr||'')}" placeholder="東京都豊島区…"></div><div class="lgrow2"><div class="lgf"><label>체크인</label><input type="text" id="hCin" value="${esc(h.cin||'')}" placeholder="15:00"></div><div class="lgf"><label>체크아웃</label><input type="text" id="hCout" value="${esc(h.cout||'')}" placeholder="11:00"></div></div><div class="lgrow2"><div class="lgf"><label>구글맵 검색어</label><input type="text" id="hQ" value="${esc(h.q||'')}" placeholder="ホテルリソル池袋"></div><div class="lgf"><label>전화</label><input type="text" id="hTel" inputmode="tel" value="${esc(h.tel||'')}"></div></div><div class="lgf"><label>메모</label><textarea id="iBody" rows="4">${esc(d.body||'')}</textarea>${FORMAT_HELP}</div>${linkRows('top',d.links||[],0)}`; }
  const head={doc:'글쓰기',flight:'항공편',hotel:'숙소'}[type];
  openSheet(`<h2>${isNew?head+' 추가':head+' 수정'}<button type="button" data-close>닫기</button></h2><form id="infoForm" autocomplete="off">${form}
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgdanger" id="iDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary">저장</button></div></form>`);
  const sh=q('.lgsheet',ov); const g=s=>q(s,sh);
  const syncBlocks=()=>{ qa('#iBlocks .lgblk',sh).forEach(el=>{ const i=+el.dataset.bi; const b=blocks[i]; if(!b)return; b.title=(el.querySelector('.bk-title')?.value||'').trim(); const desc=(el.querySelector('.bk-desc')?.value||''); if(b.k==='item'){b.desc=desc.trim(); const ls=readLinkRows(el,'b'+i); b.link=ls[0]||null;} else {b.body=desc; b.links=readLinkRows(el,'b'+i);} b.img=readOneImg(el,'b'+i); }); };
  const paintBlocks=()=>{ const box=g('#iBlocks'); if(!box)return; box.innerHTML=blocks.map(blockHtml).join(''); wireLinkRows(sh); wireOneImgs(sh); fillImages(box); qa('#iBlocks [data-delblk]',sh).forEach(b=>b.onclick=()=>{ syncBlocks(); blocks.splice(+b.closest('.lgblk').dataset.bi,1); paintBlocks(); });
    qa('#iBlocks [data-blkgrip]',sh).forEach(h=>{ h.onpointerdown=ev=>{ if(ev.button&&ev.button!==0)return; ev.preventDefault(); ev.stopPropagation(); try{h.setPointerCapture(ev.pointerId)}catch(e){}
      const card=h.closest('.lgblk'), list=g('#iBlocks'); const cards=[...list.children]; const from=cards.indexOf(card); if(cards.length<2)return;
      const sy=()=>sh.scrollTop; const rects=cards.map(c=>{const r=c.getBoundingClientRect();return {top:r.top+sy(),h:r.height,mid:r.top+sy()+r.height/2}}); const gap=Math.max(0,rects[1].top-(rects[0].top+rects[0].h)); const step=rects[from].h+gap;
      const startPage=ev.clientY+sy(); let to=from, moved=false, lastY=ev.clientY, alive=true; card.classList.add('lgdragging'); document.body.classList.add('lgnoselect'); window.__dragActive=true;
      const paint=()=>{ const dy=(lastY+sy())-startPage; card.style.transform=`translateY(${dy}px)`; const center=rects[from].mid+dy; let n=0; cards.forEach((c,j)=>{if(j!==from&&rects[j].mid<center)n++}); to=n; cards.forEach((c,j)=>{ if(j===from)return; let d2=0; if(j<from&&j>=to)d2=step; else if(j>from&&j<=to)d2=-step; c.style.transform=d2?`translateY(${d2}px)`:''; }); };
      const sr=sh.getBoundingClientRect(); const tick=()=>{ if(!alive)return; let v=0; if(lastY<sr.top+70)v=-Math.min(18,(sr.top+70-lastY)/4+3); else if(lastY>sr.bottom-90)v=Math.min(18,(lastY-(sr.bottom-90))/4+3); if(v&&moved){ const b=sh.scrollTop; sh.scrollTop+=v; if(sh.scrollTop!==b)paint(); } requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      const move=e=>{ if(e.pointerId!==ev.pointerId)return; lastY=e.clientY; if(Math.abs(lastY-ev.clientY)>3||true)moved=moved||Math.abs(lastY-(startPage-sy()))>4; paint(); };
      const stopTouch=e=>e.preventDefault();
      const end=e=>{ if(e&&e.pointerId!==undefined&&e.pointerId!==ev.pointerId)return; alive=false; window.removeEventListener('pointermove',move,true); window.removeEventListener('pointerup',end,true); window.removeEventListener('pointercancel',end,true); document.removeEventListener('touchmove',stopTouch); cards.forEach(c=>c.style.transform=''); card.classList.remove('lgdragging'); document.body.classList.remove('lgnoselect'); window.__dragActive=false; if(!moved||to===from)return; syncBlocks(); const [b]=blocks.splice(from,1); blocks.splice(to,0,b); paintBlocks(); };
      window.addEventListener('pointermove',move,true); window.addEventListener('pointerup',end,true); window.addEventListener('pointercancel',end,true); document.addEventListener('touchmove',stopTouch,{passive:false}); }; }); qa('#iBlocks textarea',sh).forEach(ta=>{const grow=()=>{ta.style.height='auto';ta.style.height=Math.max(44,ta.scrollHeight+2)+'px'}; ta.oninput=grow; grow();}); };
  wireLinkRows(sh); wireOneImgs(sh); fillImages(sh); paintBlocks();
  const addBlk=k=>{ syncBlocks(); blocks.push(k==='item'?{k:'item',id:uid(),title:'',desc:'',img:'',link:null,done:false}:{k:'sec',id:uid(),title:'',body:'',img:'',links:[]}); paintBlocks(); const last=g('#iBlocks .lgblk:last-child .bk-title'); if(last)last.focus(); };
  if(g('#iAddSec'))g('#iAddSec').onclick=()=>addBlk('sec'); if(g('#iAddItem'))g('#iAddItem').onclick=()=>addBlk('item');
  if(type==='flight'){ const wireLegs=()=>{ qa('#mLegs [data-delleg]',sh).forEach(b=>b.onclick=()=>b.closest('.lgleg').remove()); }; wireLegs(); g('#mAddLeg').onclick=()=>{ g('#mLegs').insertAdjacentHTML('beforeend',legRow()); wireLegs(); }; }
  g('#infoForm').onsubmit=async ev=>{ ev.preventDefault(); const title=g('#iTitle').value.trim(); if(!title){toast('타이틀은 꼭 넣어주세요'); g('#iTitle').focus(); return}
    const data={cat:'info',owner:null,type,title,tag:g('#iTag').value.trim(),cover:type==='doc'?'':readOneImg(sh,'cover'),body:type==='doc'?'':(g('#iBody')?.value||''),links:type==='doc'?[]:readLinkRows(sh,'top'),items:[],images:[]};
    if(type==='doc'){ syncBlocks(); data.blocks=blocks; }
    if(type==='flight') data.legs=readLegs(sh);
    if(type==='hotel') data.hotel={addr:g('#hAddr').value.trim(),cin:g('#hCin').value.trim(),cout:g('#hCout').value.trim(),q:g('#hQ').value.trim(),tel:g('#hTel').value.trim()};
    closeSheet();
    if(isNew){ const now=Date.now(); await write([{op:'set',col:'memos',id:uid(),data:{...data,ts:now,order:now}}],'저장했어요'); }
    else await write([{op:'update',col:'memos',id:d.id,data}],'저장했어요');
  };
  arm(g('#iDel'),async()=>{closeSheet();await write([{op:'delete',col:'memos',id:d.id}],'삭제했어요')});
  setTimeout(()=>{ if(isNew)g('#iTitle').focus() },250);
}
function openMemoEditor(m,opts={}){
  const isNew=!m; const me=S.me;
  const d={id:m?.id,type:m?(['text','flight'].includes(m.type)?m.type:'list'):(opts.type||'list'),legs:(m&&Array.isArray(m.legs))?m.legs.map(x=>({...x})):[],title:m?.title||'',owner:m?ownerOf(m):(opts.owner===undefined?null:opts.owner),body:m?.body||'',items:memoItems(m),images:(m&&Array.isArray(m.images))?m.images.slice():[],addWho:null,cat:m?(m.cat||''):(opts.cat||''),tag:m?.tag||''};
  const info=d.cat==='info';
  const shared=()=>d.owner===null;
  const whoBtn=(who,attr)=>`<button type="button" class="lgwho ${who===null?'lgwho-none':who===me?'lgwho-me':''}" ${attr}>${who===null?'담당':esc(pname(who))}</button>`;
  const itemsHtml=()=>d.items.length?d.items.map(it=>{const who=whoOf(it); return `<div class="lgli ${it.done?'lgdone':''}"><button type="button" class="lgbox" data-tgl="${esc(it.id)}" aria-label="완료">${svgCheck}</button>${it.img?`<span class="lgthumb lgthumb-xs" data-iimg="${esc(it.id)}" title="사진 바꾸기">${imgTag(it.img,'lgimg')}</span>`:`<button type="button" class="lgcam" data-iimg="${esc(it.id)}" aria-label="사진 추가">📷</button>`}<input type="text" class="lgtxin" data-txt="${esc(it.id)}" value="${esc(it.text)}" maxlength="200">${shared()?whoBtn(who,`data-who="${esc(it.id)}"`):''}<button type="button" class="lgx" data-del="${esc(it.id)}" aria-label="삭제">${svgX}</button></div>`}).join(''):`<div class="lghint" style="margin:2px 0 8px">아직 항목이 없어요. 아래에 쓰고 "입력"을 눌러요.</div>`;
  openSheet(`<h2><span id="mHead">${info?(isNew?'여행 정보 쓰기':'여행 정보'):isNew?(shared()?'공용 메모 쓰기':'내 메모 쓰기'):(shared()?'공용 메모':'내 메모')}</span><button type="button" data-close>닫기</button></h2><form id="memoForm" autocomplete="off">
    ${isNew&&!info?`<div class="lgf"><div class="lgchips" id="mType"><button type="button" class="lgchip" data-t="list" aria-pressed="${d.type==='list'}">${svgList} 체크 리스트</button><button type="button" class="lgchip" data-t="text" aria-pressed="${d.type==='text'}">${svgText} 글</button></div></div>`:''}
    <div class="lgf"><input type="text" id="mTitle" placeholder="제목" value="${esc(d.title)}" maxlength="60"></div>
    ${info?`<div class="lgf"><label>라벨 <span class="lgsub">제목 옆 작은 표시 (예: 대한항공, 10/26)</span></label><input type="text" id="mTag" value="${esc(d.tag)}" maxlength="20"></div>`:''}
    ${d.type==='flight'?`<div class="lgf" id="mLegsBox"><label>구간</label><div class="crows" id="mLegs">${(d.legs.length?d.legs:[{}]).map(legRow).join('')}</div><button type="button" class="lglink" id="mAddLeg">+ 구간 추가</button></div>`:''}
    <div class="lgf" id="mBodyBox" ${(d.type==='text'||d.type==='flight')?'':'hidden'}>${d.type==='flight'?'<label>메모</label>':''}<textarea id="mBody" rows="${d.type==='flight'?4:7}" placeholder="${d.type==='flight'?'예약번호 안내, 전자신고 링크 등':'여기에 그냥 써요. 줄바꿈 그대로 남아요.'}">${esc(d.body)}</textarea>${FORMAT_HELP}</div>
    <div class="lgf" id="mListBox" ${d.type==='list'?'':'hidden'}><div id="mItems">${itemsHtml()}</div>
      <div class="lgaddli"><span class="lgplus">${svgPlus}</span><input type="text" id="mAdd" placeholder="항목 추가" maxlength="200"><span id="mAddWho">${shared()?whoBtn(null,'id="mAddWhoBtn"'):''}</span><button type="button" class="lgaddbtn" id="mAddBtn">입력</button></div>
      <div class="lghint" id="mItemsHint">${isNew?'':'체크·추가·삭제는 바로 저장돼요. 글자를 고치면 칸을 벗어날 때 저장돼요.'}</div></div>
    <div class="lgf"><label id="mImgLabel">${d.type==='list'?'대표 사진 (1장)':'사진 (여러 장)'}</label><div class="lgimgs lgimgs-edit" id="mImgs"></div><button type="button" class="lglink" id="mAddImg">+ 사진 추가</button></div>
    <div class="lgf" ${info?'hidden':''}><label>누가 보나</label><div class="lgchips" id="mOwner"><button type="button" class="lgchip" data-o="mine" aria-pressed="${!shared()}">개인 · 나만</button><button type="button" class="lgchip" data-o="shared" aria-pressed="${shared()}">공용 · 모두</button></div></div>
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgdanger" id="mDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary">${isNew?'저장':'저장하고 닫기'}</button></div></form>`);
  const sh=q('.lgsheet',ov); const g=sel=>q(sel,sh);
  const persistItems=()=>{ if(isNew)return; write([{op:'update',col:'memos',id:d.id,data:{items:d.items}}]); };
  const paintItems=()=>{ g('#mItems').innerHTML=itemsHtml(); g('#mAddWho').innerHTML=shared()?whoBtn(d.addWho,'id="mAddWhoBtn"'):''; wireItems(); };
  const wireItems=()=>{
    qa('[data-tgl]',sh).forEach(b=>b.onclick=()=>{d.items=d.items.map(it=>it.id===b.dataset.tgl?{...it,done:!it.done,doneBy:!it.done?me:null}:it);paintItems();persistItems()});
    qa('[data-del]',sh).forEach(b=>b.onclick=()=>{d.items=d.items.filter(it=>it.id!==b.dataset.del);paintItems();persistItems()});
    qa('[data-who]',sh).forEach(b=>b.onclick=()=>{d.items=d.items.map(it=>it.id===b.dataset.who?{...it,who:nextWho(whoOf(it))}:it);paintItems();persistItems()});
    qa('[data-iimg]',sh).forEach(b=>b.onclick=async()=>{ const iid=b.dataset.iimg; const cur=d.items.find(x=>x.id===iid); if(cur&&cur.img&&!confirmReplace(b))return; const ids=await pickImages(1); if(!ids.length)return; d.items=d.items.map(it=>it.id===iid?{...it,img:ids[0]}:it); paintItems(); fillImages(sh); persistItems(); });
    qa('[data-txt]',sh).forEach(inp=>{inp.onchange=()=>{const t=inp.value.trim(); d.items=t?d.items.map(it=>it.id===inp.dataset.txt?{...it,text:t}:it):d.items.filter(it=>it.id!==inp.dataset.txt); if(!t)paintItems(); persistItems()}; inp.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();inp.blur()}}});
    const wb=g('#mAddWhoBtn'); if(wb)wb.onclick=()=>{d.addWho=nextWho(d.addWho); g('#mAddWho').innerHTML=whoBtn(d.addWho,'id="mAddWhoBtn"'); wireItems();};
  };
  const addItem=()=>{const inp=g('#mAdd'); const t=inp.value.trim(); if(!t)return; d.items=[...d.items,{id:uid(),text:t,done:false,who:shared()?d.addWho:null,ts:Date.now()}]; inp.value=''; paintItems(); persistItems(); inp.focus();};
  g('#mAddBtn').onclick=addItem; g('#mAdd').onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();addItem()}};
  qa('#mType .lgchip',sh).forEach(b=>b.onclick=()=>{d.type=b.dataset.t;qa('#mType .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));g('#mBodyBox').hidden=d.type!=='text';g('#mListBox').hidden=d.type!=='list'; g('#mImgLabel').textContent=d.type==='list'?'대표 사진 (1장)':'사진 (여러 장)'; if(d.type==='list'&&d.images.length>1){d.images=[d.images[0]];paintImgs();}});
  qa('#mOwner .lgchip',sh).forEach(b=>b.onclick=()=>{d.owner=b.dataset.o==='shared'?null:me;qa('#mOwner .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));if(isNew)g('#mHead').textContent=shared()?'공용 메모 쓰기':'내 메모 쓰기';paintItems();});
  const paintImgs=()=>{ g('#mImgs').innerHTML=d.images.map(id=>`<span class="lgthumb" data-rm="${esc(id)}">${imgTag(id)}<b>×</b></span>`).join(''); fillImages(g('#mImgs')); qa('#mImgs [data-rm]',sh).forEach(t=>t.onclick=()=>{d.images=d.images.filter(x=>x!==t.dataset.rm); paintImgs();}); };
  if(d.type==='flight'){ const wireLegs=()=>{ qa('#mLegs [data-delleg]',sh).forEach(b=>b.onclick=()=>b.closest('.lgleg').remove()); }; wireLegs(); g('#mAddLeg').onclick=()=>{ g('#mLegs').insertAdjacentHTML('beforeend',legRow()); wireLegs(); }; }
  paintImgs(); g('#mAddImg').onclick=async()=>{ const one=d.type==='list'; const ids=await pickImages(one?1:10); if(ids.length){ d.images=one?[ids[0]]:[...d.images,...ids]; paintImgs(); toast(one?'대표 사진을 넣었어요':`사진 ${ids.length}장 추가`);} };
  wireItems();
  g('#memoForm').onsubmit=async ev=>{ev.preventDefault();
    const pending=g('#mAdd').value.trim(); if(pending&&d.type==='list')addItem();
    const data={type:d.type,owner:info?null:d.owner,title:g('#mTitle').value.trim(),body:(d.type==='text'||d.type==='flight')?g('#mBody').value:'',items:d.type==='list'?d.items:[],images:d.images}; if(d.type==='flight')data.legs=readLegs(sh); if(info){data.cat='info'; data.tag=(g('#mTag')?.value||'').trim();}
    if(isNew&&!data.title&&!data.body.trim()&&!data.items.length&&!(data.legs&&data.legs.length)){toast('내용을 써주세요');return}
    closeSheet();
    if(isNew){const now=Date.now(); await write([{op:'set',col:'memos',id:uid(),data:{...data,ts:now,order:now}}],'저장했어요')}
    else await write([{op:'update',col:'memos',id:d.id,data}],'저장했어요');
  };
  arm(g('#mDel'),async()=>{closeSheet();await write([{op:'delete',col:'memos',id:d.id}],'삭제했어요')});
  setTimeout(()=>{const f=isNew?g('#mTitle'):null; if(f)f.focus()},250);
}

window.__dragBlock=window.__dragBlock||(()=>{const f=e=>{if(window.__dragActive)e.preventDefault()}; document.addEventListener('touchmove',f,{passive:false}); return f})();
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
  S.dragging=true; window.__dragActive=true; card.classList.add('lgdragging'); listEl.classList.add('lgdraglist'); document.body.classList.add('lgnoselect');
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
    cards.forEach(c=>{c.style.transform=''}); card.classList.remove('lgdragging'); listEl.classList.remove('lgdraglist'); document.body.classList.remove('lgnoselect'); S.dragging=false; window.__dragActive=false;
    if(!moved||to===from){render();return}
    const ids=cards.map(c=>c.dataset.accm); const [id]=ids.splice(from,1); ids.splice(to,0,id);
    const base=Date.now(); const ops=[];
    ids.forEach((mid,i)=>{const m=S.memos.find(x=>x.id===mid); const order=base-i*1000; if(m)ops.push({op:'update',col:'memos',id:mid,data:{order}})});
    await write(ops,'순서를 바꿨어요');
  };
  window.addEventListener('pointermove',move,true); window.addEventListener('pointerup',end,true); window.addEventListener('pointercancel',end,true);
  document.addEventListener('touchmove',stopTouch,{passive:false}); window.addEventListener('touchend',end,{once:true});
}
/* 머리글을 350ms 길게 누르면 드래그 시작. 그 전에 움직이면 스크롤, 그 전에 떼면 펼치기(기본 동작) */
function pressToDrag(ev,sm){
  if(ev.target.closest('[data-mdone]'))return; if(ev.button&&ev.button!==0)return;
  const x0=ev.clientX,y0=ev.clientY; let fired=false;
  const cancel=()=>{clearTimeout(t); sm.removeEventListener('pointermove',mv); sm.removeEventListener('pointerup',cancel); sm.removeEventListener('pointercancel',cancel); };
  const mv=e=>{if(Math.abs(e.clientX-x0)>12||Math.abs(e.clientY-y0)>12)cancel()};
  const t=setTimeout(()=>{fired=true; cancel(); try{navigator.vibrate&&navigator.vibrate(12)}catch(e){}
    const card=sm.parentElement; sm.dataset.suppress='1'; setTimeout(()=>{delete sm.dataset.suppress},600);
    startDrag({pointerId:ev.pointerId,clientY:y0,button:0,preventDefault(){},stopPropagation(){}},sm);},350);
  sm.addEventListener('pointermove',mv); sm.addEventListener('pointerup',cancel); sm.addEventListener('pointercancel',cancel);
}
/* ---------- 바인딩 ---------- */
function bind(c){
  qa('[data-act]',c).forEach(b=>b.onclick=()=>{const a=b.dataset.act; if(a==='retry'){S.screen='loading';render();boot()} else if(a==='settings')openSettings(); else if(a==='setup-add')setupAddRow(); else if(a==='login')openLogin(); else if(a==='logout'){logout();toast('로그아웃했어요')} else if(a==='add-shared')openExpense(null,{priv:false}); else if(a==='add-mine')openExpense(null,{priv:true}); else if(a==='receipt')scanReceipt(); else if(a==='forgot')openForgot(); });
  qa('[data-scope]',c).forEach(b=>b.onclick=()=>{S.scope=b.dataset.scope;render()});
  qa('[data-exp]',c).forEach(b=>b.onclick=ev=>{if(ev.target.closest('a'))return; openExpense(S.expenses.find(e=>e.id===b.dataset.exp))});
  qa('[data-settled]',c).forEach(b=>b.onclick=()=>{const e=S.expenses.find(x=>x.id===b.dataset.settled);if(!e)return;write([{op:'update',col:'expenses',id:e.id,data:{settled:!e.settled,settledBy:!e.settled?S.me:null,settleId:null}}],e.settled?'다시 잔액에 넣었어요':'이 건만 정산 완료했어요')});
  qa('[data-tr]',c).forEach(b=>b.onclick=()=>openRecord(S.transfers.find(t=>t.id===b.dataset.tr)));
  qa('[data-settle]',c).forEach(b=>b.onclick=()=>{const [f,t,a,cur]=b.dataset.settle.split('|');openSettle({from:+f,to:+t,amount:+a,cur})});
  qa('[data-newmemo]',c).forEach(b=>b.onclick=()=>{ if(b.dataset.newmemo==='info')chooseInfo(); else openMemoEditor(null,{owner:b.dataset.newmemo==='mine'?S.me:null}); });
  qa('[data-memoedit]',c).forEach(b=>b.onclick=()=>{const m=S.memos.find(x=>x.id===b.dataset.memoedit); if(!m)return; if(m.cat==='info')openInfoEditor(m); else openMemoEditor(m);});
  qa('[data-mdone]',c).forEach(b=>{b.onclick=ev=>{ev.preventDefault();ev.stopPropagation();const m=S.memos.find(x=>x.id===b.dataset.mdone);if(!m)return;const items=memoItems(m);const nowDone=memoDone(m);
    if(m.type!=='text'&&items.length){const next=items.map(it=>({...it,done:!nowDone,doneBy:!nowDone?S.me:null}));write([{op:'update',col:'memos',id:m.id,data:{items:next,done:!nowDone}}],!nowDone?'전부 체크했어요':'전부 해제했어요')}
    else write([{op:'update',col:'memos',id:m.id,data:{done:!nowDone}}],!nowDone?'확인 완료':'다시 올렸어요')}});
  qa('details.lgsecacc',c).forEach(d=>d.ontoggle=()=>{S.secOpen[d.dataset.sec]=d.open; ls.set('tl_sec',JSON.stringify(S.secOpen))});
  qa('.lgthumb',c).forEach(t=>t.onclick=ev=>{ev.stopPropagation(); ev.preventDefault(); openThumb(t)});
  qa('.lginfo-il',c).forEach(a=>a.onclick=ev=>ev.stopPropagation());
  qa('details[data-accm] > summary',c).forEach(sm=>{sm.onpointerdown=ev=>pressToDrag(ev,sm); sm.oncontextmenu=ev=>ev.preventDefault(); sm.onclick=ev=>{if(sm.dataset.suppress){ev.preventDefault();ev.stopPropagation()}}});
  qa('[data-accm]',c).forEach(d=>d.ontoggle=()=>{if(d.open)S.openMemos.add(d.dataset.accm);else S.openMemos.delete(d.dataset.accm)});
  qa('[data-blk]',c).forEach(cb=>cb.onchange=()=>{const [mid,bid]=cb.dataset.blk.split('|'); const m=S.memos.find(x=>x.id===mid); if(!m)return; const d=infoDocOf(m); const blocks=d.blocks.map(b=>b.id===bid?{...b,done:!b.done}:b); write([{op:'update',col:'memos',id:mid,data:{type:'doc',blocks,cover:d.cover||'',links:d.links||[],items:[]}}]);});
  qa('[data-tgl-m]',c).forEach(b=>b[b.tagName==='INPUT'?'onchange':'onclick']=()=>{const [mid,iid]=b.dataset.tglM.split('|');const m=S.memos.find(x=>x.id===mid);if(!m)return;const items=memoItems(m).map(it=>it.id===iid?{...it,done:!it.done,doneBy:!it.done?S.me:null}:it);write([{op:'update',col:'memos',id:mid,data:{items}}])});
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
let sheetCloseHook=null; const runSheetHook=()=>{const f=sheetCloseHook; sheetCloseHook=null; if(f)try{f()}catch(_){}};
function openSheet(html){ runSheetHook(); q('.lgsheet .lgin',ov).innerHTML=`<div class="lggrab"></div>`+html; q('.lgsheet',ov).classList.add('lgopen'); q('.lgscrim',ov).classList.add('lgopen'); document.body.style.overflow='hidden'; qa('[data-close]',ov).forEach(b=>b.onclick=closeSheet); q('.lgsheet',ov).scrollTop=0; }
function closeSheet(){ runSheetHook(); q('.lgsheet').classList.remove('lgopen'); q('.lgscrim').classList.remove('lgopen'); document.body.style.overflow=''; }

const expLinkRow=(l,u)=>`<div class="lgclink"><input type="text" placeholder="이름" value="${esc(l||'')}" maxlength="40"><input type="text" inputmode="url" autocapitalize="off" placeholder="https://…" value="${esc(u||'')}"><button type="button" class="lgx" data-dellink aria-label="삭제">×</button></div>`;
const readExpLinks=sh=>[...sh.querySelectorAll('#fLinks .lgclink')].map(r=>{const [a,b]=r.querySelectorAll('input'); let u=(b.value||'').trim(); if(!u)return null; if(!/^https?:\/\//i.test(u))u='https://'+u; return {l:(a.value||'').trim(),u}}).filter(Boolean);
function wireExpLinks(sh){ sh.querySelectorAll('#fLinks [data-dellink]').forEach(b=>b.onclick=()=>b.closest('.lgclink').remove()); const add=sh.querySelector('#fAddLink'); if(add)add.onclick=()=>{sh.querySelector('#fLinks').insertAdjacentHTML('beforeend',expLinkRow('','')); wireExpLinks(sh); const f=sh.querySelector('#fLinks .lgclink:last-child input'); if(f)f.focus(); sh.querySelector('#fMore').open=true;}; }
/* ---------- 영수증 찍어서 자동 등록 (카드 스캔처럼): 사진 → 서버(Gemini) → 지출 한 건 저장 → 되돌리기 토스트 ---------- */
const svgCam='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';
let undoT;
function toastUndo(msg,fn,sub=''){ const t=q('.lgtoast',ov); if(!t)return; t.classList.add('lgtoast-undo'); t.innerHTML=`<span class="lgut"><b>${esc(msg)}</b>${sub?`<small>${esc(sub)}</small>`:''}</span><button type="button" class="lgundo">되돌리기</button>`; t.classList.add('lgshow'); clearTimeout(toastT); clearTimeout(undoT);
  t.querySelector('.lgundo').onclick=()=>{ t.classList.remove('lgshow'); t.textContent=''; fn(); };
  undoT=setTimeout(()=>{ t.classList.remove('lgshow'); setTimeout(()=>{ if(!t.classList.contains('lgshow'))t.textContent=''; },300); },7000); }
let scanning=false;
/* 사진 올리기·영수증 읽기 중: 화면을 어둡게 덮고 로딩 표시. 오래 걸리면 "기다리지 않고 입력하기"로 덮개만 걷음(작업은 계속) */
let loadT=null;
function showLoading(msg,{skippable=false}={}){ let el=q('.lgload',ov); if(!el){ el=document.createElement('div'); el.className='lgload'; el.setAttribute('role','status'); el.setAttribute('aria-live','polite'); el.innerHTML='<div class="lgloadbox"><div class="lgspin" aria-hidden="true"></div><div class="lgloadmsg"></div><button type="button" class="lglink lgloadskip" hidden>기다리지 않고 입력하기</button></div>'; ov.appendChild(el); el.querySelector('.lgloadskip').onclick=hideLoading; }
  el.querySelector('.lgloadmsg').textContent=msg; const sk=el.querySelector('.lgloadskip'); clearTimeout(loadT); sk.hidden=true; if(skippable)loadT=setTimeout(()=>{sk.hidden=false},6000);
  el.classList.add('lgshow'); }
function hideLoading(){ clearTimeout(loadT); const el=q('.lgload',ov); if(el)el.classList.remove('lgshow'); }
/* 사진 고르기 (camera=true 면 카메라 바로) */
function pickPhoto(camera){ return new Promise(res=>{ const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; if(camera)inp.setAttribute('capture','environment'); inp.style.display='none'; document.body.appendChild(inp);
  inp.onchange=()=>{ const f=inp.files&&inp.files[0]; inp.remove(); res(f||null); }; inp.click(); }); }
/* 영수증 사진 → 이미지 저장 + 서버(Gemini) 읽기. 결과: {imgId, rc, fields, items}. 실패하면 err.imgId 에 저장된 사진 id */
/* 사진 올리기: 원본(1600px)과 썸네일을 한 번에 저장. 결과 {imgId, data} */
async function uploadPhoto(f){
  const r=await resizeImage(f,1600); const t=await makeThumb(r.data); const imgId='im-'+uid();
  const ops=[{op:'set',col:'images',id:imgId,data:{data:r.data,w:r.w,h:r.h,kind:'receipt'}}]; if(t)ops.push({op:'set',col:'images',id:imgId+'.t',data:{data:t,kind:'thumb'}});
  imgCache[imgId]=r.data; if(t)imgCache[imgId+'.t']=t;
  const how=await writeOrQueue(ops);   // 끊겼으면 대기열 (화면엔 바로 보임)
  return {imgId,data:r.data,queued:how==='queued'};
}

/* 영수증 읽기 (서버 → Gemini). 결과 {rc, fields, items, ok} */
/* 영수증 자동 읽기 사용량 (두 사람 합계, 서버 기준). 한도 다 쓰면 초기화 시각까지 읽기를 건너뜀 */
const rcUse=()=>{ const u=S.rcUsage; return u&&Date.now()<u.resetAt?u:null; };
const rcQuota=()=>{ const u=rcUse(); return !!(u&&u.quotaHit); };
const rcReset=()=>{ const u=rcUse(); return u?new Date(u.resetAt).toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit'}):'오후 4:00'; };
function setUsage(u){ if(u&&u.resetAt){ S.rcUsage={...u,at:Date.now()}; ls.set('tl_rcuse',JSON.stringify(S.rcUsage)); } }
try{ const u=JSON.parse(ls.get('tl_rcuse')||'null'); if(u&&Date.now()<u.resetAt)S.rcUsage=u; }catch(e){}
async function refreshUsage(){ const u=rcUse(); if(u&&Date.now()-(u.at||0)<120000)return; try{ const j=await api({action:'usage'}); setUsage(j.usage); }catch(e){} }
async function readReceiptData(data){
  if(rcQuota())throw {code:'quota'};
  let j; try{ j=await api({action:'receipt',image:data},{timeout:40000}); }catch(e){ if(e.data&&e.data.usage)setUsage(e.data.usage); throw e; }
  setUsage(j.usage);
  const rc=j.receipt||{};
  const items=(rc.items||[]).map(it=>({name:it.name,nameKo:it.nameKo||'',qty:+it.qty||1,price:+it.price||0,sel:true}));
  const fields={title:(rc.storeKo||rc.store||'').trim(),amount:+rc.total||0,cur:rc.currency==='KRW'?'KRW':'JPY',day:(rc.date&&DAYS.some(x=>x.d===rc.date))?rc.date:'',cat:rc.cat||'',memo:rc.note?rc.note.slice(0,120):''};
  return {rc,fields,items,ok:rc.isReceipt!==false&&fields.amount>0};
}
async function readReceiptFile(f){
  const P=await uploadPhoto(f);
  if(P.queued)throw {code:'network',queued:true,imgId:P.imgId};   // 끊김: 사진은 대기열, 영수증 읽기는 못 함
  try{ return {imgId:P.imgId,...await readReceiptData(P.data)}; }catch(e){ e.imgId=P.imgId; throw e; }
}
const receiptErr=e=>e.code==='quota'?`오늘 영수증 자동 읽기 한도를 다 썼어요 · ${rcReset()}에 다시 돼요`:e.code==='no_key'?'서버에 GEMINI_API_KEY 가 없어요':e.code==='auth'?'다시 로그인해 주세요':e.code==='receipt'?'영수증을 못 읽었어요 — 직접 넣어주세요':e.code==='network'?'연결이 느려서 못 읽었어요 — 다시 해 주세요':(e.message||'실패했어요');
const dropImage=id=>{ if(id)writeOrQueue([{op:'delete',col:'images',id},{op:'delete',col:'images',id:id+'.t'}]).catch(()=>{}); };
/* 하단 바 "영수증": 찍으면 바로 지출 등록 + 되돌리기 */
async function scanReceipt(){
  if(scanning)return;
  const f=await pickPhoto(true); if(!f)return;
  scanning=true; const bar=q('[data-act="receipt"]'); if(bar){bar.disabled=true;bar.classList.add('lgbusy')}
  const priv=S.scope==='mine';   // 개인 탭이면 내 지출, 공용·전체면 공용
  try{
    showLoading('영수증 읽는 중…');
    const R=await readReceiptFile(f); const F=R.fields;
    const base={title:F.title||'영수증',amount:F.amount,cur:F.cur,day:F.day||todayKey(),cat:F.cat||'기타',memo:'',rcNote:F.memo||null,links:[],ts:Date.now(),receipt:R.imgId||null,items:R.items.length?R.items:null,rcTotal:F.amount||null,autoSum:true};
    if(!R.ok){
      toast(R.rc.isReceipt===false?'영수증 사진이 아닌 것 같아요. 직접 넣어주세요':'합계를 못 읽었어요. 금액만 넣어주세요');
      openExpense(null,{priv,newImg:R.imgId,prefill:{title:base.title,amount:base.amount||'',cur:base.cur,day:base.day,cat:base.cat,memo:'',receipt:R.imgId,items:R.items,rcTotal:base.rcTotal}});
      return;
    }
    const n=S.people.length;
    const body=priv?{owner:S.me,...base,payer:S.me,parts:[S.me],custom:null}:{owner:null,...base,payer:S.me,parts:[...Array(n).keys()],custom:null,settled:false,settledBy:null,settleId:null};
    const id=uid();
    const ok=await write([{op:'set',col:'expenses',id,data:body}],null);
    if(ok) toastUndo(`${fmt(base.amount,base.cur)} 등록했어요 · ${priv?'내 지출':'공용'}${R.items.length?` · 품목 ${R.items.length}`:''}`,()=>{ write([{op:'delete',col:'expenses',id}],'되돌렸어요'); dropImage(R.imgId); },base.title);
  }catch(e){
    toast(receiptErr(e));
    if(e.imgId){ if(e.queued)toast('연결 안 됨 — 사진만 붙였어요. 금액을 넣어 저장하세요'); else if(e.code==='quota')toast('자동 읽기 한도 초과 — 사진만 붙였어요. 금액을 넣어 저장하세요'); openExpense(null,{priv,newImg:e.imgId,prefill:{receipt:e.imgId}}); }
  }finally{ hideLoading(); scanning=false; const b=q('[data-act="receipt"]'); if(b){b.disabled=false;b.classList.remove('lgbusy')} }
}
/* 품목 자동 합산: 고른 품목 합계. 영수증 합계(세금 포함·쿠폰 반영)를 알면 그 비율로 맞춤
   (품목이 세전가거나 전체 쿠폰이 있어도 전부 고르면 영수증 합계와 같고, 일부만 고르면 비율대로 나눔) */
function autoCalc(items,rcTotal){ const sel=items.filter(x=>x.sel!==false).reduce((a,x)=>a+(+x.price||0),0); const all=items.reduce((a,x)=>a+(+x.price||0),0);
  if(+rcTotal>0&&all>0){ const r=rcTotal/all; if(r>0.5&&r<1.5)return sel*r; } return sel; }
function openExpense(e,opts={}){
  const isNew=!e; const n=S.people.length; const today=todayKey();
  const d={id:e?.id,title:e?.title||'',amount:e?.amount||'',cur:e?.cur||'JPY',day:e?.day||today,cat:e?.cat||'식비',
    priv:e?!isShared(e):!!opts.priv,payer:e?e.payer:S.me,parts:e?(e.parts&&e.parts.length?e.parts.slice():[...Array(n).keys()]):[...Array(n).keys()],custom:e?.custom?{...e.custom}:null,memo:e?.memo||'',settled:!!(e&&e.settled),
    receipt:e?.receipt||'',items:Array.isArray(e?.items)?e.items.map(it=>({...it})):[],rcTotal:e?.rcTotal||0,autoSum:e?e.autoSum:true};
  if(opts.prefill)Object.assign(d,opts.prefill);
  d.items=(d.items||[]).map(it=>({name:it.name||'',nameKo:it.nameKo||'',qty:+it.qty||1,price:+it.price||0,sel:it.sel!==false}));
  if(d.autoSum===undefined||d.autoSum===null) d.autoSum=!d.items.length||Math.round(autoCalc(d.items,d.rcTotal))===Math.round(+d.amount||0);   // 예전 지출: 금액이 품목 합계와 같으면 자동 합산으로 간주
  const newImgs=new Set(opts.newImg?[opts.newImg]:[]); let saved=false;   // 이 폼에서 새로 올린 영수증 사진: 저장 안 하고 닫으면 지움
  let itEdit=false;   // 영수증 품목: 보기(기본) ↔ 수정
  let viewing=!isNew&&!opts.edit;   // 기존 지출은 보기로 열고, "수정"을 누르면 같은 화면에서 입력 가능
  const moreOpen=!isNew&&(!!d.custom||(!d.priv&&d.parts.length!==n)||d.settled||(Array.isArray(e?.links)&&e.links.length>0));
  const dayShort=k=>{const x=dayOf(k);return k===today?'오늘':(x.d==='pre'?'출발 전':`D${x.n}`)};
  openSheet(`<h2><span id="fHead">${isNew?(d.priv?'내 지출':'공용 지출'):'지출'}</span><span class="lgh2btns">${isNew?'':'<button type="button" class="lgh2edit" id="fEditBtn">수정</button>'}<button type="button" data-close>닫기</button></span></h2><form id="expForm" class="${viewing?'lgviewmode':''}">
    <div class="lgf"><label>금액 <span class="lgreq" aria-label="필수">*</span></label><div class="lgamtview" id="fAmtView"></div><div class="lgamount"><input type="text" inputmode="decimal" id="fAmt" placeholder="0" value="${d.amount?esc(d.amount):''}" aria-label="금액"><div class="lgseg" id="fCur"><button type="button" data-c="JPY" aria-pressed="${d.cur==='JPY'}">¥</button><button type="button" data-c="KRW" aria-pressed="${d.cur==='KRW'}">₩</button></div></div></div>
    <div class="lgf lgtitlef"><input type="text" id="fTitle" placeholder="무엇에 썼어요? 예: 모츠나베, 리무진 버스" value="${esc(d.title)}" maxlength="80" aria-label="내용"><textarea id="fMemo" class="lgdesc" rows="1" placeholder="설명 (선택) · 누구 거 샀는지, 메모 등" maxlength="300" aria-label="설명">${esc(d.memo)}</textarea></div>
    <div class="lgvsum" id="fVSum"></div>
    <div id="fRc"></div>
    <div class="lgf" id="fPayerBox" ${d.priv?'hidden':''}><label>누가 냈어요?</label><div class="lgbig2" id="fPayer">${S.people.map((p,i)=>`<button type="button" data-i="${i}" aria-pressed="${d.payer===i}">${esc(pname(i))}${i===S.me?' <small>나</small>':''}</button>`).join('')}</div><div class="lghint" id="fPartsHint"></div></div>
    <details class="lgmore" id="fMore" ${moreOpen||viewing?'open':''}><summary><span>자세히</span><span class="lgsub" id="fMoreSum"></span></summary>
      <div class="lgf"><label>구분</label><div class="lgchips" id="fScope"><button type="button" class="lgchip" data-s="mine" aria-pressed="${d.priv}">개인 · 나만 봄</button><button type="button" class="lgchip" data-s="shared" aria-pressed="${!d.priv}">공용 · 같이 나눔</button></div></div>
      <div class="lgf"><label>날짜</label><div class="lgchips" id="fDay">${ALLDAYS.map(x=>`<button type="button" class="lgchip lgsm" data-d="${x.d}" aria-pressed="${d.day===x.d}">${x.d==='pre'?'출발 전':`D${x.n} ${x.s} ${x.w}`}</button>`).join('')}</div></div>
      <div class="lgf"><label>카테고리</label><div class="lgchips" id="fCat">${CATS.map(c=>`<button type="button" class="lgchip lgsm" data-c="${c}" aria-pressed="${d.cat===c}">${c}</button>`).join('')}</div></div>
      <div id="fSharedBox" ${d.priv?'hidden':''}>
        <div class="lgf"><label>누구 몫으로 나눌까</label><div class="lgchips" id="fParts">${S.people.map((p,i)=>`<button type="button" class="lgchip" data-i="${i}" aria-pressed="${d.parts.includes(i)}">${esc(pname(i))}</button>`).join('')}</div></div>
        <div class="lgf"><div class="lgtoggle"><span>금액 직접 나누기</span><input type="checkbox" id="fCustom" ${d.custom?'checked':''}></div><div id="fCustomBox" ${d.custom?'':'hidden'}><div class="lgpamts" id="fCustomAmts"></div><div class="lghint" id="fCustomHint"></div></div></div>
        ${isNew?'':`<div class="lgf"><div class="lgtoggle"><span>이 건은 정산 완료 <span class="lgsub">잔액에서 뺌</span></span><input type="checkbox" id="fSettled" ${d.settled?'checked':''}></div></div>`}
      </div>
    <div class="lgf"><label>링크 <span class="lgsub">예약 페이지, 영수증 사진 주소 등</span></label><div class="lgclinks" id="fLinks">${(Array.isArray(e?.links)?e.links:[]).map(x=>expLinkRow(x.l,x.u)).join('')}</div><button type="button" class="lglink" id="fAddLink">+ 링크 추가</button></div>
    </details>
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgprimary lgviewonly" id="fEditBig">수정하기</button><button type="button" class="lgbtn lgdanger lgeditonly" id="fDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary lgeditonly" id="fSave">${isNew?'저장':'수정 저장'}</button></div></form>`);
  const sh=q('.lgsheet',ov); const g=s=>q(s,sh);
  const amt=()=>parseNum(g('#fAmt').value);
  const sum=()=>{const bits=[dayShort(d.day),d.cat]; if(!d.priv){ if(d.parts.length!==n)bits.push(d.parts.map(pname).join('·')+' 몫'); if(g('#fCustom').checked)bits.push('직접 나눔'); } {const sel=d.items.filter(x=>x.sel).length; if(d.items.length)bits.push(sel===d.items.length?`품목 ${sel}`:`품목 ${sel}/${d.items.length}`);}  const nl=g('#fLinks')?g('#fLinks').querySelectorAll('.lgclink').length:0; if(nl)bits.push(`링크 ${nl}`); g('#fMoreSum').textContent=bits.join(' · ')};
  const partsHint=()=>{const a=amt(),k=d.parts.length; const el=g('#fPartsHint'); if(d.priv){el.textContent='';return} el.textContent=k===0?'나눌 사람을 "자세히"에서 골라주세요':k===1?(d.parts[0]===d.payer?`${pname(d.payer)} 혼자 몫 — 나눔 없음`:`${pname(d.parts[0])} 몫 전액 → ${pname(d.payer)}에게 ${fmt(a,d.cur)}`):(a>0?`${k}명이 1인 ${fmt(a/k,d.cur)}씩`:`${k}명이 똑같이 나눠요`)};
  const customHint=()=>{if(!g('#fCustom').checked)return;const s=d.parts.reduce((t,i)=>t+(d.custom&&+d.custom[i]||0),0);const rest=amt()-s;const el=g('#fCustomHint');el.className='lghint'+(Math.abs(rest)>0.5?' bad':'');el.textContent=Math.abs(rest)>0.5?`합계 ${fmt(s,d.cur)} · 남는 ${fmt(rest,d.cur)}은 ${pname(d.parts[0]??d.payer)}에게 붙어요`:'합계가 딱 맞아요'};
  const customBox=()=>{const box=g('#fCustomAmts'); box.innerHTML=d.parts.map(i=>`<label>${esc(pname(i))}<input type="text" inputmode="decimal" data-ci="${i}" value="${d.custom&&d.custom[i]?esc(d.custom[i]):''}" placeholder="0"></label>`).join(''); box.querySelectorAll('input').forEach(inp=>inp.oninput=()=>{d.custom=d.custom||{};d.custom[inp.dataset.ci]=parseNum(inp.value);customHint()}); customHint()};
  const setScope=priv=>{d.priv=priv; qa('#fScope .lgchip',sh).forEach(x=>x.setAttribute('aria-pressed',(x.dataset.s==='mine')===priv)); g('#fSharedBox').hidden=priv; g('#fPayerBox').hidden=priv; if(isNew)g('#fHead').textContent=priv?'내 지출':'공용 지출'; partsHint(); sum()};
  qa('#fScope .lgchip',sh).forEach(b=>b.onclick=()=>setScope(b.dataset.s==='mine'));
  g('#fAmt').oninput=()=>{partsHint();customHint()};
  /* 설명은 줄바꿈되는 칸: 내용 길이만큼 자동으로 늘어남 */
  const fitMemo=()=>{ const t=g('#fMemo'); if(!t)return; t.style.height='auto'; t.style.height=t.scrollHeight+'px'; };
  g('#fMemo').oninput=()=>{d.memo=g('#fMemo').value;fitMemo();sum()};
  requestAnimationFrame(fitMemo); setTimeout(fitMemo,300);
  qa('#fCur button',sh).forEach(b=>b.onclick=()=>{d.cur=b.dataset.c;qa('#fCur button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));partsHint();customHint()});
  qa('#fDay button',sh).forEach(b=>b.onclick=()=>{d.day=b.dataset.d;qa('#fDay button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));sum()});
  qa('#fCat button',sh).forEach(b=>b.onclick=()=>{d.cat=b.dataset.c;qa('#fCat button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));sum()});
  qa('#fPayer button',sh).forEach(b=>b.onclick=()=>{d.payer=+b.dataset.i;qa('#fPayer button',sh).forEach(x=>x.setAttribute('aria-pressed',x===b));partsHint()});
  qa('#fParts button',sh).forEach(b=>b.onclick=()=>{const i=+b.dataset.i;d.parts=d.parts.includes(i)?d.parts.filter(x=>x!==i):[...d.parts,i].sort();b.setAttribute('aria-pressed',d.parts.includes(i));partsHint();sum();if(g('#fCustom').checked)customBox()});
  g('#fCustom').onchange=()=>{g('#fCustomBox').hidden=!g('#fCustom').checked;if(g('#fCustom').checked)customBox();sum()};
  /* 영수증 사진 줄 + 품목 편집 */
  const touched=new Set(); g('#fAmt').addEventListener('input',()=>{ touched.add('amount'); if(d.autoSum&&d.items.length){ d.autoSum=false; const au=g('#fAuto'); if(au)au.checked=false; toast('금액을 직접 넣어서 자동 합산을 껐어요'); } }); g('#fTitle').addEventListener('input',()=>touched.add('title'));
  ['#fCur','#fDay','#fCat'].forEach(id=>g(id).addEventListener('click',()=>touched.add(id)));
  const itTotal=()=>d.items.filter(x=>x.sel).reduce((a,x)=>a+(+x.price||0),0);
  const itSumText=()=>{ const sel=d.items.filter(x=>x.sel).length; if(!d.items.length)return ''; const v=autoCalc(d.items,d.rcTotal); return `${sel===d.items.length?`품목 ${sel}개`:`품목 ${sel}/${d.items.length}개`} · 합계 ${fmt(v,d.cur)}${d.rcTotal&&sel<d.items.length?` <span class="lgsub">(영수증 ${fmt(d.rcTotal,d.cur)})</span>`:''}`; };
  // 품목: 한 목록. 평소엔 잠긴 입력칸(글자처럼 보임), "수정"이면 그 자리에서 입력
  // 할인 줄: 가격이 마이너스. 상품 바로 아래 붙은 할인은 그 상품 몫(같이 넣고 뺌), 쿠폰·포인트 같은 전체 할인은 따로
  const WIDE=/クーポン|coupon|쿠폰|ポイント|포인트|会計|合計|総額|全品|전체|まとめ/i;
  const isDisc=it=>(+it.price||0)<0;
  const attached=i=>{ const out=[]; if(isDisc(d.items[i]))return out; for(let k=i+1;k<d.items.length&&isDisc(d.items[k])&&!WIDE.test((d.items[k].name||'')+' '+(d.items[k].nameKo||''));k++)out.push(k); return out; };
  const itemRows=()=>d.items.map((it,i)=>`<div class="lgit ${isDisc(it)?'lgitdisc':''} ${it.sel?'':'lgitoff'} ${(+it.qty||1)>1?'':'lgq1'}" data-i="${i}"><button type="button" class="lgitck" aria-pressed="${it.sel}" aria-label="이 품목 포함">${it.sel?'✓':''}</button><input type="text" class="lgitname" value="${esc(it.nameKo||it.name)}" placeholder="품목 이름" maxlength="60" ${itEdit?'':'readonly tabindex="-1"'}${it.nameKo&&it.name&&it.nameKo!==it.name?` title="${esc(it.name)}"`:''}><span class="lgitx">×</span><input type="text" inputmode="numeric" class="lgitqty" value="${esc(+it.qty||1)}" aria-label="수량" ${itEdit?'':'readonly tabindex="-1"'}><input type="text" inputmode="decimal" class="lgitprice" value="${itEdit?esc(it.price||''):esc(fmt(it.price,d.cur))}" placeholder="0" aria-label="가격" ${itEdit?'':'readonly tabindex="-1"'}><button type="button" class="lgitdel" aria-label="품목 삭제">×</button></div>`).join('');
  const rcHtml=()=>{
    const has=d.receipt||d.items.length;
    const thumb=d.receipt?`<span class="lgthumb lgthumb-rc2" aria-label="사진 크게 보기">${thumbTag(d.receipt)}</span>`:'';
    const list=d.items.length?`<div class="lgitlist ${itEdit?'lgediting':''}" id="fItems">${itemRows()}</div>`:'';
    const head=has?`<div class="lgithead"><label>${d.items.length?'영수증':'사진'}${d.items.length?` <span class="lgsub" id="fItSum">${itSumText()}</span>`:''}</label>${d.items.length?`<button type="button" class="lglink" id="fItEdit">${itEdit?'완료':'수정'}</button>`:''}</div>`:'';
    const body=has?`<div class="lgrc">${thumb}${list}</div>`:'';
    const auto=d.items.length?`<label class="lgauto"><input type="checkbox" id="fAuto" ${d.autoSum?'checked':''}><span>품목 합계로 금액 자동 입력${d.autoSum&&ratioNote()?` <span class="lgsub">${ratioNote()}</span>`:''}</span></label>`:'';
    const links=`<div class="lgrcbtns"><button type="button" class="lglink" id="fRcCam">${svgCam}${d.receipt?'다시 찍기':'사진 찍기'}</button><button type="button" class="lglink" id="fRcPick">앨범</button><button type="button" class="lglink" id="fAddItem">+ 품목</button>${d.receipt&&!itEdit?'<button type="button" class="lglink lgdim" id="fRcDel">사진 빼기</button>':''}</div>`;
    const u=rcUse();
    const note=rcQuota()?`<div class="lgrcalert" role="alert"><b>오늘 영수증 자동 읽기 한도를 다 썼어요.</b> 사진 첨부와 직접 입력은 그대로 돼요. <b>${rcReset()}</b>에 다시 돼요.</div>`
      :`<div class="lgrcdesc">영수증 자동 읽기${u?` · 오늘 ${u.n}회`:''} · 매일 ${rcReset()} 초기화 (구글 무료 한도)</div>`;
    return `<div class="lgf lgrcbox">${head}${body}${auto}${links}${note}</div>`; };
  const ratioNote=()=>{ const all=d.items.reduce((a,x)=>a+(+x.price||0),0); if(!(d.rcTotal>0&&all>0))return ''; const r=d.rcTotal/all; return Math.abs(r-1)>0.005&&r>0.5&&r<1.5?'(세금·쿠폰 포함해 영수증 합계에 맞춤)':''; };
  const applyAuto=()=>{ if(!d.autoSum||!d.items.length)return; const v=Math.round(autoCalc(d.items,d.rcTotal)); g('#fAmt').value=v?String(v):''; partsHint(); customHint(); };
  const refreshSum=()=>{ applyAuto(); const el=g('#fItSum'); if(el)el.innerHTML=itSumText(); sum(); };
  const clickChip=(box,attr,val)=>{ const b=qa(`${box} button`,sh).find(x=>x.dataset[attr]===val); if(b)b.click(); };
  const applyReceipt=R=>{ const F=R.rc&&R.rc.isReceipt===false?{}:(R.fields||{});
    if(d.receipt&&newImgs.has(d.receipt)&&d.receipt!==R.imgId){ dropImage(d.receipt); newImgs.delete(d.receipt); }
    if(R.imgId){ d.receipt=R.imgId; newImgs.add(R.imgId); }
    if(R.items.length){ d.items=R.items; }
    d.rcTotal=F.amount||d.rcTotal;
    // 금액·제목은 비어 있을 때만 채움 (이미 쓴 값·기존 지출은 그대로. 영수증 합계는 품목 줄에 보임)
    if(F.amount>0&&!amt()&&!(d.autoSum&&d.items.length)){ g('#fAmt').value=String(F.amount); }
    if(F.title&&!g('#fTitle').value.trim()) g('#fTitle').value=F.title;
    const fresh=isNew&&!touched.has('amount');
    if(F.cur&&fresh&&!touched.has('#fCur')) clickChip('#fCur','c',F.cur);
    if(F.day&&isNew&&!touched.has('#fDay')) clickChip('#fDay','d',F.day);
    if(F.cat&&isNew&&!touched.has('#fCat')) clickChip('#fCat','c',F.cat);
    paintRc(); partsHint(); customHint(); };
  let busy=null;   // 사진 올리기·영수증 읽기 진행 중이면 저장이 기다림
  const setBusy=on=>{ const b=g('#fRcCam'); if(b){b.disabled=on;b.classList.toggle('lgbusy',on)} const sv=g('#fSave'); if(sv){ sv.classList.toggle('lgbusy',on); sv.textContent=on?'사진 처리 중…':(isNew?'저장':'수정 저장'); } };
  const attach=async camera=>{ const f=await pickPhoto(camera); if(!f)return;
    let done; busy=new Promise(r=>done=r); setBusy(true); showLoading('사진 올리는 중…');
    try{
      let P; try{ P=await uploadPhoto(f); }catch(e){ toast(e.code==='auth'?receiptErr(e):'사진을 못 올렸어요: '+(e.message||e)); return; }
      applyReceipt({imgId:P.imgId,rc:{isReceipt:false},fields:{},items:[]});   // 사진은 바로 붙임
      if(closed)return;
      if(P.queued){ toast('연결 안 됨 — 사진은 연결되면 올라가요 (영수증 읽기는 못 함)'); return; }
      showLoading('사진을 붙였어요 · 영수증인지 읽는 중…',{skippable:true});
      try{ const R=await readReceiptData(P.data); if(closed)return;
        if(R.rc.isReceipt===false){ toast('사진을 붙였어요'); return; }
        applyReceipt({imgId:P.imgId,...R}); toast(R.ok?(R.items.length?`영수증 품목 ${R.items.length}개를 읽었어요`:'영수증을 읽었어요'):'합계를 못 읽었어요. 금액은 직접 넣어주세요'); }
      catch(e){ if(!closed){ if(e.code==='quota'){ toast('사진은 붙였어요 · '+receiptErr(e)); paintRc(); } else toast(e.code==='no_key'||e.code==='auth'?receiptErr(e):'사진은 붙였어요 (영수증 내용은 못 읽음)'); } }
    }finally{ hideLoading(); busy=null; done(); if(!closed)setBusy(false); } };
  const paintRc=()=>{ const box=g('#fRc'); box.innerHTML=rcHtml(); fillImages(box);
    box.querySelectorAll('.lgthumb').forEach(t=>t.onclick=ev=>{ev.preventDefault();openThumb(t)});
    g('#fRcCam').onclick=()=>attach(true); g('#fRcPick').onclick=()=>attach(false);
    const del=g('#fRcDel'); if(del)del.onclick=()=>{ if(newImgs.has(d.receipt)){dropImage(d.receipt);newImgs.delete(d.receipt)} d.receipt=''; paintRc(); };
    const clean=()=>{ d.items=d.items.filter(x=>(x.nameKo||x.name||'').trim()||+x.price); };
    const ed=g('#fItEdit'); if(ed)ed.onclick=()=>{ if(itEdit)clean(); itEdit=!itEdit; paintRc(); };
    g('#fAddItem').onclick=()=>{ d.items.push({name:'',nameKo:'',qty:1,price:0,sel:true}); itEdit=true; paintRc(); const ins=box.querySelectorAll('.lgitname'); if(ins.length)ins[ins.length-1].focus(); };
    box.querySelectorAll('.lgit').forEach(row=>{ const it=d.items[+row.dataset.i];
      row.querySelector('.lgitck').onclick=()=>{ const i=+row.dataset.i; it.sel=!it.sel; const linked=attached(i); linked.forEach(k=>{d.items[k].sel=it.sel}); [i,...linked].forEach(k=>{ const r=box.querySelector(`.lgit[data-i="${k}"]`); if(!r)return; r.classList.toggle('lgitoff',!d.items[k].sel); const b=r.querySelector('.lgitck'); b.setAttribute('aria-pressed',d.items[k].sel); b.textContent=d.items[k].sel?'✓':''; }); refreshSum(); if(linked.length&&!it.sel)toast(`붙어 있던 할인 ${linked.length}줄도 같이 뺐어요`); };
      row.querySelector('.lgitname').oninput=ev=>{it.nameKo=ev.target.value; if(!it.name)it.name=ev.target.value};
      row.querySelector('.lgitqty').oninput=ev=>{it.qty=parseNum(ev.target.value)||1};
      row.querySelector('.lgitprice').oninput=ev=>{it.price=parseNum(ev.target.value); refreshSum()};
      row.querySelector('.lgitdel').onclick=()=>{ d.items.splice(+row.dataset.i,1); paintRc(); }; });
    applyAuto();
    const au=g('#fAuto'); if(au)au.onchange=()=>{ d.autoSum=au.checked; if(d.autoSum)applyAuto(); paintRc(); };
  };
  paintRc(); refreshUsage().then(()=>{ if(!closed&&g('#fRc'))paintRc(); });
  let closed=false; sheetCloseHook=()=>{ closed=true; if(!saved) newImgs.forEach(dropImage); };
  partsHint(); sum(); if(d.custom)customBox(); wireExpLinks(sh); sh.querySelector('#fLinks').addEventListener('input',sum); const al=g('#fAddLink'); const al0=al.onclick; al.onclick=()=>{al0();sum()};
  g('#expForm').onsubmit=async ev=>{ev.preventDefault();
    if(busy){ toast('사진 처리 끝나면 저장할게요'); await busy; if(closed)return; }
    const a=amt(); if(!(a>0)){toast('금액을 넣어주세요');g('#fAmt').focus();return}
    let body;
    const links=readExpLinks(sh);
    const its=d.items.filter(x=>(x.nameKo||x.name||'').trim()||+x.price).map(x=>({name:(x.name||x.nameKo).trim(),nameKo:(x.nameKo||'').trim(),qty:+x.qty||1,price:+x.price||0,sel:!!x.sel}));
    const extra={receipt:d.receipt||null,items:its.length?its:null,rcTotal:d.rcTotal||null,autoSum:its.length?!!d.autoSum:null};
    if(d.priv) body={owner:S.me,title:g('#fTitle').value.trim(),amount:a,cur:d.cur,day:d.day,cat:d.cat,payer:S.me,parts:[S.me],custom:null,memo:g('#fMemo').value.trim(),links,ts:e?.ts||Date.now(),...extra};
    else{ if(!d.parts.length){toast('나눌 사람을 골라주세요');g('#fMore').open=true;return}
      const useCustom=g('#fCustom').checked; const custom=useCustom?Object.fromEntries(d.parts.map(i=>[i,+(d.custom&&d.custom[i])||0])):null;
      const settled=isNew?false:!!g('#fSettled').checked;
      body={owner:null,title:g('#fTitle').value.trim(),amount:a,cur:d.cur,day:d.day,cat:d.cat,payer:d.payer,parts:d.parts,custom,memo:g('#fMemo').value.trim(),links,ts:e?.ts||Date.now(),settled,settledBy:settled?(e&&e.settledBy!==undefined&&e.settledBy!==null?e.settledBy:S.me):null,settleId:settled?(e&&e.settleId)||null:null,...extra}; }
    saved=true; closeSheet();
    // 영수증 사진을 바꿨으면 예전 사진은 지움
    if(e&&e.receipt&&e.receipt!==d.receipt) dropImage(e.receipt);
    await write([{op:'set',col:'expenses',id:d.id||uid(),data:body}],isNew?'저장했어요':'수정했어요');
  };
  arm(g('#fDel'),async()=>{saved=true;closeSheet(); newImgs.forEach(dropImage); if(e&&e.receipt)dropImage(e.receipt); await write([{op:'delete',col:'expenses',id:d.id}],'삭제했어요')});
  /* 보기 ↔ 수정: 같은 화면, 보기일 땐 입력칸 잠금·고르지 않은 선택지 숨김·사진/추가 버튼 숨김 */
  const setView=v=>{ viewing=v; const f=g('#expForm'); f.classList.toggle('lgviewmode',v);
    f.querySelectorAll('input[type=text],input[type=number],textarea').forEach(i=>{ if(i.closest('#fItems'))return; i.readOnly=v; i.tabIndex=v?-1:0; });
    f.querySelectorAll('input[type=checkbox]').forEach(i=>{ if(i.closest('#fItems'))return; i.disabled=v; });
    // 보기에서는 비어 있는 칸(메모·링크·꺼진 토글)은 숨김
    const memoI=g('#fMemo'); if(memoI)memoI.classList.toggle('lgvhide',v&&!memoI.value.trim());
    const linkF=g('#fLinks')&&g('#fLinks').closest('.lgf'); if(linkF)linkF.classList.toggle('lgvhide',v&&!g('#fLinks').querySelector('.lgclink'));
    f.querySelectorAll('.lgtoggle').forEach(t=>{ const i=t.querySelector('input[type=checkbox]'); const box=t.closest('.lgf'); if(box)box.classList.toggle('lgvhide',v&&i&&!i.checked); });
    if(v){ const av=g('#fAmtView'); if(av)av.textContent=fmt(amt(),d.cur);
      // 보기 요약: 한 줄에 하나씩 (낸 사람 · 나눔 · 날짜 · 카테고리 · 정산 · 링크)
      const a=amt(), rows=[];
      if(d.priv) rows.push(['구분','개인 지출 · 나만 봄']);
      else{ rows.push(['낸 사람',pname(d.payer)+(d.payer===S.me?' (나)':'')]);
        const cu=g('#fCustom')&&g('#fCustom').checked&&d.custom;
        rows.push(['나눔',cu?d.parts.map(i=>`${pname(i)} ${fmt(+d.custom[i]||0,d.cur)}`).join(' · '):(d.parts.length===n?`${n}명 똑같이 · 1인 ${fmt(a/(d.parts.length||1),d.cur)}`:`${d.parts.map(pname).join('·')} 몫 · 1인 ${fmt(a/(d.parts.length||1),d.cur)}`)]);
        if(d.settled) rows.push(['정산','이 건은 정산 완료']); }
      rows.push(['날짜',dayLabel(d.day)]); rows.push(['카테고리',d.cat]);
      const ln=readExpLinks(sh).filter(x=>x.u);
      g('#fVSum').innerHTML=`<dl class="lgkv2">${rows.map(([k,v2])=>`<dt>${esc(k)}</dt><dd>${esc(v2)}</dd>`).join('')}${ln.length?`<dt>링크</dt><dd>${ln.map(x=>`<a href="${esc(x.u)}" target="_blank" rel="noopener" class="lglinkx">${esc(x.l||x.u.replace(/^https?:\/\//,'').slice(0,30))} ↗</a>`).join(' ')}</dd>`:''}</dl>`; }
    requestAnimationFrame(()=>{ const t=g('#fMemo'); if(t){ t.style.height='auto'; t.style.height=t.scrollHeight+'px'; } });
    if(!isNew){ g('#fHead').textContent=v?'지출':'지출 수정'; const eb=g('#fEditBtn'); if(eb)eb.hidden=!v; }
    if(!v){ const m=g('#fMore'); if(m&&!moreOpen)m.open=false; } };
  if(!isNew){ const go=()=>{ setView(false); setTimeout(()=>g('#fAmt').focus(),50); }; g('#fEditBtn').onclick=go; g('#fEditBig').onclick=go; setView(viewing); }
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
  window.addEventListener('online',()=>{ if(S.screen==='main')load(); });
}
function scrollToMemo(id){ const d=q(`details[data-accm="${id}"]`); if(!d)return; const sec=d.closest('details.lgsecacc'); if(sec&&!sec.open){sec.open=true;} d.open=true; S.openMemos.add(id); setTimeout(()=>d.scrollIntoView({behavior:'smooth',block:'start'}),50); }
/* 다른 모듈용 쓰기: 성공 'ok', 끊김이면 대기열에 넣고 'queued', 영구 실패면 throw */
async function writeOrQueue(ops){ try{ if(outbox().length)throw {code:'network'}; await api({action:'write',ops}); S.v=''; return 'ok'; }
  catch(e){ if(transient(e)&&S.token){ if(queueOps(ops)){ S.offline=true; paintSync(); flushOutbox(); return 'queued'; } } throw e; } }
window.Ledger={writeOrQueue,pendingOps,flushOutbox,mount,state:S,reload:load,openExpense,openSettle,openLogin,API,api,openSheet,closeSheet,toast,arm,pickImages,imgSrc,fillImages,imgTag,scrollToMemo,bodyHtml};
const auto=document.getElementById('ledger-root');
if(auto){ if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mount(auto)); else mount(auto); }
})();
