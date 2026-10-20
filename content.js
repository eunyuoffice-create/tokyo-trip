/* content.js — 일정·맛집·갈 곳을 서버(DB)에서 읽고(누구나), 로그인한 멤버는 수정·추가·삭제·순서 변경.
   index.html 의 정적 데이터(DAYS/FOOD/PLACES)는 첫 로그인 때 한 번 DB로 복사(시드)되고, 그 뒤로는 DB가 원본.
   의존: window.TripSite (index.html), window.Ledger (ledger.js: API, api, openSheet, closeSheet, toast, arm) */
(function(){
'use strict';
const T=()=>window.TripSite, L=()=>window.Ledger;
const C={plan:null,food:null,places:null,meta:{},loaded:false,seeding:false,_auth:null};
window.Content=C;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const byOrder=(a,b)=>(a.order||0)-(b.order||0);
const loggedIn=()=>!!(L()&&L().state&&L().state.screen==='main'&&L().state.token);
const svgPlus='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const svgPen='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/></svg>';
const COLS={plan:'plan',food:'food',place:'places'};
const colOf=tab=>COLS[tab]||tab;
const listOf=col=>col==='plan'?C.plan:col==='food'?C.food:C.places;
const setList=(col,arr)=>{ if(col==='plan')C.plan=arr; else if(col==='food')C.food=arr; else C.places=arr; };
const push=()=>{ T().setContent({plan:C.plan,food:C.food,places:C.places}); };
const toast=m=>{ if(L()&&L().toast)L().toast(m); };

/* ---------- 읽기 ---------- */
async function fetchContent(){
  if(!L())return false;
  try{
    const res=await fetch(L().API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'content'})});
    const j=await res.json(); if(!j.ok)return false;
    const arr=o=>Object.entries(o||{}).map(([id,d])=>({id,...d})).sort(byOrder);
    C.meta=(j.meta&&j.meta.seeded)||{};
    C.plan=C.meta.plan?arr(j.plan):null; C.food=C.meta.food?arr(j.food):null; C.places=C.meta.places?arr(j.places):null;
    C.loaded=true; push(); return true;
  }catch(e){ return false; }
}
C.reload=fetchContent;

/* ---------- 시드: 정적 데이터 → DB (처음 로그인한 멤버가 한 번) ---------- */
async function seedIfNeeded(){
  if(!C.loaded||C.seeding||!loggedIn())return; const S=T();
  const jobs=[];
  if(!C.meta.plan){ const docs=[]; S.DAYS.forEach(d=>d.items.forEach((it,i)=>docs.push({id:`pl-${d.date.slice(5).replace('-','')}-${String(i+1).padStart(2,'0')}`,data:{...it,day:d.date,order:(i+1)*1000}}))); jobs.push(['plan',docs]); }
  if(!C.meta.food) jobs.push(['food',S.FOOD.map((f,i)=>({id:`fd-${String(i+1).padStart(3,'0')}`,data:{...f,order:(i+1)*1000}}))]);
  if(!C.meta.places) jobs.push(['places',S.PLACES.map((p,i)=>({id:`pc-${String(i+1).padStart(3,'0')}`,data:{...p,order:(i+1)*1000}}))]);
  if(!jobs.length)return; C.seeding=true;
  try{
    for(const [col,docs] of jobs){
      for(let i=0;i<docs.length;i+=25){ await L().api({action:'write',ops:docs.slice(i,i+25).map(x=>({op:'set',col,id:x.id,data:x.data}))}); }
      C.meta={...C.meta,[col]:true};
      await L().api({action:'write',ops:[{op:'set',col:'meta',id:'seeded',data:{...C.meta}}]});
    }
    await fetchContent(); toast('일정·맛집·갈 곳을 서버로 옮겼어요. 이제 수정할 수 있어요');
  }catch(e){ toast('서버로 옮기지 못했어요: '+(e.message||e)); }
  finally{ C.seeding=false; }
}

/* ---------- 쓰기 ---------- */
async function save(col,id,data,msg){
  const list=(listOf(col)||[]).slice(); const i=list.findIndex(x=>x.id===id);
  const doc={id,...data}; if(i>=0)list[i]=doc; else list.push(doc); list.sort(byOrder); setList(col,list); push();
  try{ await L().api({action:'write',ops:[{op:'set',col,id,data}]}); if(msg)toast(msg); }
  catch(e){ toast(e.code==='auth'?'다시 로그인해 주세요':'저장 실패 — 다시 시도해 주세요'); fetchContent(); }
}
async function remove(col,id){
  setList(col,(listOf(col)||[]).filter(x=>x.id!==id)); push();
  try{ await L().api({action:'write',ops:[{op:'delete',col,id}]}); toast('삭제했어요'); }
  catch(e){ toast('삭제 실패 — 다시 시도해 주세요'); fetchContent(); }
}
async function reorder(col,ids){
  // 화면에 보이는 부분 목록만 재배열: 그 항목들이 갖고 있던 order 값들을 새 순서대로 다시 나눠 준다 (다른 그룹과의 상대 위치 유지)
  const list=(listOf(col)||[]); const items=ids.map(id=>list.find(x=>x.id===id)).filter(Boolean); if(items.length<2)return;
  const slots=items.map(x=>x.order||0).sort((a,b)=>a-b);
  const ops=[]; items.forEach((it,i)=>{ if(it.order!==slots[i]){ it.order=slots[i]; ops.push({op:'update',col,id:it.id,data:{order:slots[i]}}); } });
  list.sort(byOrder); push();
  if(!ops.length)return;
  try{ await L().api({action:'write',ops}); toast('순서를 바꿨어요'); }catch(e){ toast('순서 저장 실패'); fetchContent(); }
}

/* ---------- 길게 눌러 끌어서 정렬 (메모와 같은 방식) ---------- */
function makeSortable(listEl,sel,col){
  if(!listEl)return;
  listEl.querySelectorAll(sel).forEach(el=>{ if(el.dataset.sortable)return; el.dataset.sortable='1'; el.addEventListener('pointerdown',ev=>pressToDrag(ev,el,listEl,sel,col)); });
}
function pressToDrag(ev,el,listEl,sel,col){
  if(!loggedIn())return; if(ev.button&&ev.button!==0)return; if(ev.target.closest('button,a,input,textarea,.cedit'))return;
  const x0=ev.clientX,y0=ev.clientY; let fired=false;
  const cancel=()=>{clearTimeout(t); el.removeEventListener('pointermove',mv); el.removeEventListener('pointerup',cancel); el.removeEventListener('pointercancel',cancel); el.classList.remove('lgpressing')};
  const mv=e=>{if(Math.abs(e.clientX-x0)>8||Math.abs(e.clientY-y0)>8)cancel()};
  const t=setTimeout(()=>{fired=true; cancel(); try{navigator.vibrate&&navigator.vibrate(12)}catch(e){} startDrag(ev.pointerId,y0,el,listEl,sel,col);},350);
  setTimeout(()=>{if(!fired)el.classList.add('lgpressing')},120);
  el.addEventListener('pointermove',mv); el.addEventListener('pointerup',cancel); el.addEventListener('pointercancel',cancel);
}
function startDrag(pointerId,startY,el,listEl,sel,col){
  const cards=[...listEl.querySelectorAll(':scope > '+sel)]; if(cards.length<2)return;
  const from=cards.indexOf(el); if(from<0)return;
  const rects=cards.map(c=>{const r=c.getBoundingClientRect();return {top:r.top,h:r.height,mid:r.top+r.height/2}});
  const gap=Math.max(0,rects[1].top-(rects[0].top+rects[0].h)); const step=rects[from].h+gap;
  let to=from, moved=false, lastY=startY;
  el.classList.add('lgdragging'); document.body.classList.add('lgnoselect'); C.dragging=true;
  const paint=()=>{ const dy=lastY-startY; el.style.transform=`translateY(${dy}px)`; const center=rects[from].mid+dy; let n=0; cards.forEach((c,j)=>{if(j!==from&&rects[j].mid<center)n++}); to=n;
    cards.forEach((c,j)=>{ if(j===from)return; let sh=0; if(j<from&&j>=to)sh=step; else if(j>from&&j<=to)sh=-step; c.style.transform=sh?`translateY(${sh}px)`:''; }); };
  const move=e=>{ if(e.pointerId!==pointerId)return; lastY=e.clientY; if(Math.abs(lastY-startY)>4)moved=true; paint(); };
  const stopTouch=e=>{e.preventDefault()};
  const end=async e=>{
    if(e&&e.pointerId!==undefined&&e.pointerId!==pointerId)return;
    window.removeEventListener('pointermove',move,true); window.removeEventListener('pointerup',end,true); window.removeEventListener('pointercancel',end,true); document.removeEventListener('touchmove',stopTouch);
    cards.forEach(c=>{c.style.transform=''}); el.classList.remove('lgdragging'); document.body.classList.remove('lgnoselect'); C.dragging=false;
    if(!moved||to===from)return;
    const ids=cards.map(c=>c.dataset.eid); const [id]=ids.splice(from,1); ids.splice(to,0,id);
    await reorder(col,ids);
  };
  window.addEventListener('pointermove',move,true); window.addEventListener('pointerup',end,true); window.addEventListener('pointercancel',end,true);
  document.addEventListener('touchmove',stopTouch,{passive:false});
}

/* ---------- 화면 꾸미기: 렌더 뒤마다 (편집 버튼 · 추가 바 · 정렬) ---------- */
C.decorate=function(){
  const S=T(); if(!S)return; const tab=S.state.tab;
  ['p-plan','p-food','p-place'].forEach(pid=>{const p=document.getElementById(pid); if(!p)return; p.querySelectorAll('.lgcbar, .cedit, .chint').forEach(x=>x.remove()); p.classList.remove('lg-haspad');});
  if(!['plan','food','place'].includes(tab))return;
  const col=colOf(tab); const editable=loggedIn()&&C.loaded&&!!listOf(col);
  document.body.classList.toggle('body-edit',editable);
  if(!editable){ if(loggedIn()&&C.loaded)seedIfNeeded(); return; }
  const panel=document.getElementById('p-'+tab); panel.classList.add('lg-haspad');
  const label=tab==='plan'?'일정 추가':tab==='food'?'맛집 추가':'장소 추가';
  const bar=document.createElement('div'); bar.className='lg lgcbar'; bar.innerHTML=`<div class="lgbar"><div class="lgadd2 lgadd1"><button class="lgaddexp" data-cadd="${tab}">${svgPlus}${label}</button></div></div>`; panel.appendChild(bar);
  bar.querySelector('[data-cadd]').onclick=()=>openEditor(tab,null);
  const mkBtn=id=>{const b=document.createElement('button'); b.className='cedit'; b.type='button'; b.innerHTML=svgPen; b.setAttribute('aria-label','수정'); b.onclick=e=>{e.stopPropagation();openEditor(tab,id)}; return b;};
  const hint=document.createElement('div'); hint.className='chint'; hint.textContent='✎ 로 수정 · 카드를 길게 눌러 끌면 순서가 바뀌어요';
  if(tab==='plan'){ panel.querySelectorAll('.ev[data-eid]').forEach(el=>{ if(!el.querySelector('.cedit'))el.appendChild(mkBtn(el.dataset.eid)); }); const tl=panel.querySelector('.tl'); if(tl&&tl.children.length>1)tl.before(hint); makeSortable(tl,'.ev[data-eid]','plan'); }
  else { const first=panel.querySelector('.cards'); if(first)first.before(hint); panel.querySelectorAll('.card[data-eid]').forEach(el=>{ if(!el.querySelector('.cedit')){const acts=el.querySelector('.acts')||el; acts.appendChild(mkBtn(el.dataset.eid));} }); panel.querySelectorAll('.cards').forEach(l=>makeSortable(l,'.card[data-eid]',col)); }
};
C.onAuth=function(){ const a=loggedIn(); if(a===C._auth)return; C._auth=a; if(a&&C.loaded&&!C.meta.plan)seedIfNeeded(); else if(T())T().render(); };

/* ---------- 행 편집기: 자세히 내용(d) · 이동 경로(r) — 한 항목에 입력칸 하나씩, 추가/삭제 버튼 ---------- */
const kindOf=x=>typeof x==='string'?'s':x.k?'k':x.l?'l':'s';
const dRow=(x)=>{const kind=kindOf(x); const text=kind==='s'?x:kind==='k'?x.k:x.l; const url=kind==='l'?(x.u||''):'';
  return `<div class="crow" data-kind="${kind}"><div class="ckind">${[['s','문장'],['k','소제목'],['l','링크']].map(([k,l])=>`<button type="button" data-k="${k}" aria-pressed="${k===kind}">${l}</button>`).join('')}<button type="button" class="lgx" data-delrow aria-label="삭제">×</button></div><textarea class="ctext" rows="2" placeholder="${kind==='k'?'소제목':kind==='l'?'링크 이름':'내용'}">${esc(text||'')}</textarea><input type="text" class="curl" inputmode="url" autocapitalize="off" placeholder="https://…" value="${esc(url)}" ${kind==='l'?'':'hidden'}></div>`};
const rRow=(x={})=>`<div class="crow croute"><div class="ckind"><span class="lgsub">이동 경로</span><button type="button" class="lgx" data-delrow aria-label="삭제">×</button></div>
  <div class="lgrow2"><input type="text" class="rf" placeholder="출발 (예: 이케부쿠로역)" value="${esc(x.f||'')}"><input type="text" class="rt" placeholder="도착 (예: 스튜디오 투어 도쿄)" value="${esc(x.t||'')}"></div>
  <textarea class="rhow" rows="2" placeholder="설명 (예: 세이부선 약 20분 + 도보 2분)">${esc(x.how||'')}</textarea>
  <div class="lgrow2"><input type="text" class="rfq" placeholder="출발 구글맵 검색어 (비우면 출발과 같음)" value="${esc(x.fq||'')}"><input type="text" class="rtq" placeholder="도착 구글맵 검색어" value="${esc(x.tq||'')}"></div>
  <div class="lgchips rmode">${[['transit','🚃 전철·버스'],['walking','🚶 도보'],['driving','🚕 택시']].map(([m,l])=>`<button type="button" class="lgchip lgsm" data-m="${m}" aria-pressed="${(x.mode||'transit')===m}">${l}</button>`).join('')}</div></div>`;
function wireRows(sh){
  sh.querySelectorAll('[data-addrow]').forEach(b=>b.onclick=()=>{const box=sh.querySelector(`[data-rows="${b.dataset.addrow}"] .crows`); box.insertAdjacentHTML('beforeend',b.dataset.addrow==='eD'?dRow(''):rRow()); wireRows(sh); const f=box.lastElementChild.querySelector('textarea,input'); if(f)f.focus();});
  sh.querySelectorAll('[data-delrow]').forEach(b=>b.onclick=()=>b.closest('.crow').remove());
  sh.querySelectorAll('.crow [data-k]').forEach(b=>b.onclick=()=>{const row=b.closest('.crow'); row.dataset.kind=b.dataset.k; row.querySelectorAll('[data-k]').forEach(x=>x.setAttribute('aria-pressed',String(x===b))); row.querySelector('.curl').hidden=b.dataset.k!=='l'; row.querySelector('.ctext').placeholder=b.dataset.k==='k'?'소제목':b.dataset.k==='l'?'링크 이름':'내용';});
  sh.querySelectorAll('.rmode .lgchip').forEach(b=>b.onclick=()=>{b.parentElement.querySelectorAll('.lgchip').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))});
  sh.querySelectorAll('.crow textarea').forEach(ta=>{const grow=()=>{ta.style.height='auto';ta.style.height=Math.max(44,ta.scrollHeight+2)+'px'}; ta.oninput=grow; grow();});
}
const readD=sh=>[...sh.querySelectorAll('[data-rows="eD"] .crow')].map(r=>{const kind=r.dataset.kind; const t=(r.querySelector('.ctext').value||'').trim(); if(!t)return null; if(kind==='k')return {k:t}; if(kind==='l'){let u=(r.querySelector('.curl').value||'').trim(); if(!u)return t; if(!/^https?:\/\//i.test(u))u='https://'+u; return {l:t,u}} return t;}).filter(Boolean);
const readR=sh=>{const out=[...sh.querySelectorAll('[data-rows="eR"] .crow')].map(r=>{const g=c=>(r.querySelector(c)?.value||'').trim(); const f=g('.rf'),t=g('.rt'); if(!f&&!t&&!g('.rhow'))return null; const mode=r.querySelector('.rmode [aria-pressed="true"]')?.dataset.m||'transit'; return {f,t,how:g('.rhow'),fq:g('.rfq')||f,tq:g('.rtq')||t,mode}}).filter(Boolean); return out.length?(out.length===1?out[0]:out):null};
/* ---------- 편집 시트 ---------- */
const F={
  text:(id,label,val,ph='',extra='')=>`<div class="lgf"><label>${label}</label><input type="text" id="${id}" value="${esc(val||'')}" placeholder="${esc(ph)}" ${extra}></div>`,
  area:(id,label,val,ph='',rows=4)=>`<div class="lgf"><label>${label}</label><textarea id="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(val||'')}</textarea></div>`,
  chips:(id,label,opts,val,free)=>`<div class="lgf"><label>${label}</label><div class="lgchips" data-chips="${id}">${opts.map(o=>`<button type="button" class="lgchip lgsm" data-v="${esc(o)}" aria-pressed="${o===val}">${esc(o)}</button>`).join('')}</div>${free?`<input type="text" id="${id}" value="${esc(val||'')}" placeholder="${esc(free)}" style="margin-top:8px">`:`<input type="hidden" id="${id}" value="${esc(val||'')}">`}</div>`,
  links:(id,label,arr)=>`<div class="lgf" data-links="${id}"><label>${label}</label><div class="clinks">${(arr||[]).map(x=>linkRow(x.l,x.u)).join('')}</div><button type="button" class="lglink" data-addlink="${id}">+ 링크 추가</button><div class="lghint">이름을 비우면 주소가 그대로 보여요. "구글맵 경로 보기"처럼 버튼으로 나와요.</div></div>`,
  rows:(id,label,html,addLabel)=>`<div class="lgf" data-rows="${id}"><label>${label}</label><div class="crows">${html}</div><button type="button" class="lglink" data-addrow="${id}">+ ${addLabel}</button></div>`,
  toggle:(id,label,on)=>`<div class="lgf"><div class="lgtoggle"><span>${label}</span><input type="checkbox" id="${id}" ${on?'checked':''}></div></div>`,
};
const linkRow=(l,u)=>`<div class="clink"><input type="text" placeholder="이름 (예: 예약 페이지)" value="${esc(l||'')}" maxlength="40"><input type="text" inputmode="url" autocapitalize="off" placeholder="https://…" value="${esc(u||'')}"><button type="button" class="lgx" data-dellink aria-label="삭제">×</button></div>`;
function wireLinks(sh){
  sh.querySelectorAll('[data-addlink]').forEach(b=>b.onclick=()=>{const box=b.parentElement.querySelector('.clinks'); box.insertAdjacentHTML('beforeend',linkRow('','')); wireLinks(sh); const last=box.lastElementChild.querySelector('input'); if(last)last.focus();});
  sh.querySelectorAll('[data-dellink]').forEach(b=>b.onclick=()=>b.closest('.clink').remove());
}
const readLinks=(sh,id)=>[...sh.querySelectorAll(`[data-links="${id}"] .clink`)].map(r=>{const [a,b]=r.querySelectorAll('input'); let u=(b.value||'').trim(); if(u&&!/^https?:\/\//i.test(u))u='https://'+u; return {l:(a.value||'').trim(),u}}).filter(x=>x.u);
function wireChips(sh){
  sh.querySelectorAll('[data-chips]').forEach(box=>{ const inp=sh.querySelector('#'+box.dataset.chips);
    box.querySelectorAll('.lgchip').forEach(b=>b.onclick=()=>{ const on=b.getAttribute('aria-pressed')==='true'; box.querySelectorAll('.lgchip').forEach(x=>x.setAttribute('aria-pressed','false')); if(!on){b.setAttribute('aria-pressed','true'); inp.value=b.dataset.v;} else inp.value=''; });
    if(inp.type==='text')inp.oninput=()=>{box.querySelectorAll('.lgchip').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.v===inp.value)))};
  });
}
function openEditor(tab,id){
  const S=T(), Lg=L(); const col=colOf(tab); const list=listOf(col)||[]; const it=id?list.find(x=>x.id===id):null; const isNew=!it;
  let body='', title='';
  if(tab==='plan'){
    const day=it?it.day:(S.state.day||S.DAYS[0].date);
    title=isNew?'일정 추가':'일정 수정';
    body=`<div class="lgf"><label>날짜</label><div class="lgchips" data-chips="eDay">${S.DAYS.map(d=>`<button type="button" class="lgchip lgsm" data-v="${d.date}" aria-pressed="${d.date===day}">D${d.n} ${d.date.slice(5).replace('-','/')} ${d.w}</button>`).join('')}</div><input type="hidden" id="eDay" value="${day}"></div>
      <div class="lgrow2">${F.text('eT','시간',it?.t,'예: 10:30 / 점심 / 밤')}${F.text('eTs','보조 시간',it?.ts,'예: ~11:50')}</div>
      ${F.text('eTitle','제목',it?.title,'예: 해리포터 카페')}
      ${F.text('eP','장소',it?.p,'예: 아카사카')}
      ${F.text('ePills','태그 (쉼표로 구분)',(it?.pills||[]).join(', '),'예: 예약 완료, 필수')}
      ${F.toggle('eBig','강조 (큰 제목)',!!it?.big)}
      ${F.links('eLinks','링크 버튼',it?.links)}
      ${F.rows('eD','자세히 내용 (펼쳐서 보는 부분)',(it?.d||[]).map(dRow).join(''),'내용 추가')}
      ${F.rows('eR','이동 경로 (구글맵 경로 보기 버튼이 붙어요)',(it?.r?(Array.isArray(it.r)?it.r:[it.r]):[]).map(rRow).join(''),'이동 경로 추가')}`;
  }else if(tab==='food'){
    title=isNew?'맛집 추가':'맛집 수정';
    body=`${F.text('eN','가게 이름',it?.n,'예: 규카츠 이로하')}
      ${F.chips('eA','지역',S.FOOD_AREAS,it?.a||S.FOOD_AREAS[0],'')}
      ${F.chips('eTy','분류 (비우면 종류로 자동 판단)',['음식','카페'],it?.t||'','')}
      <div class="lgrow2">${F.text('eK','종류',it?.k,'예: 라멘, 타르트')}${F.text('ePr','가격대',it?.pr,'예: 1,000~2,000엔')}</div>
      ${F.text('eH','영업시간',it?.h,'예: 11:00~22:00 · 무휴')}
      ${F.chips('eS','별점',['1','2','3','4','5'],it?.s?String(it.s):'','')}
      ${F.area('eNote','메모 (위치·팁)',it?.note,'예: 東口 도보 3분. 현금만',3)}
      ${F.text('eQ','구글맵 검색어',it?.q,'예: 牛かつ いろは 池袋')}
      ${F.links('eLinks','링크 버튼',(it?.links||[]).concat(it?.link&&!(it?.links||[]).length?[{l:'링크',u:it.link}]:[]))}`;
  }else{
    title=isNew?'장소 추가':'장소 수정';
    body=`${F.text('eN','이름',it?.n,'예: 치이카와 파크')}
      ${F.chips('eG','그룹',S.PLACE_GROUPS,it?.g||S.PLACE_GROUPS[0],'')}
      ${F.chips('eArea','지역',S.PLACE_CHIPS.filter(x=>!S.PLACE_GROUPS.includes(x)||x==='이케부쿠로'||x==='하라주쿠'),it?.area||'','직접 입력')}
      ${F.text('eK','종류·한 줄 설명',it?.k,'예: 전시 + 쇼핑')}
      ${F.text('eH','영업시간',it?.h,'예: 10:00~19:00 · 무휴')}
      ${F.text('eRes','예약',it?.res,'예: 예약 완료 / 선착 예매 필수')}
      ${F.area('eLoc','설명 (위치·팁)',it?.loc,'',4)}
      ${F.text('eQ','구글맵 검색어',it?.q,'예: ちいかわパーク サンシャインシティ')}
      ${F.links('eLinks','링크 버튼',(it?.links||[]).concat(it?.link&&!(it?.links||[]).length?[{l:'링크',u:it.link}]:[]))}
      ${F.toggle('eU','영업 확인 필요 표시',!!it?.u)}`;
  }
  Lg.openSheet(`<h2>${title}<button type="button" data-close>닫기</button></h2><form id="cForm" autocomplete="off">${body}
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgdanger" id="cDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary">${isNew?'저장':'수정 저장'}</button></div></form>`);
  const sh=document.querySelector('.lgov .lgsheet'); const g=s=>sh.querySelector(s); const v=s=>(g(s)?.value||'').trim();
  wireChips(sh); wireLinks(sh); wireRows(sh);
  g('#cForm').onsubmit=async ev=>{ ev.preventDefault();
    let data; const nextOrder=()=>{ const l=listOf(col)||[]; const pool=tab==='plan'?l.filter(x=>x.day===v('#eDay')):l; return (pool.length?Math.max(...pool.map(x=>x.order||0)):0)+1000; };
    if(tab==='plan'){ if(!v('#eTitle')){toast('제목을 넣어주세요');return} const day=v('#eDay');
      data={day,t:v('#eT'),ts:v('#eTs'),p:v('#eP'),title:v('#eTitle'),pills:v('#ePills')?v('#ePills').split(',').map(x=>x.trim()).filter(Boolean):[],big:g('#eBig').checked,links:readLinks(sh,'eLinks'),d:readD(sh),r:readR(sh),order:(it&&it.day===day)?it.order:nextOrder()}; }
    else if(tab==='food'){ if(!v('#eN')){toast('가게 이름을 넣어주세요');return}
      data={a:v('#eA')||S.FOOD_AREAS[0],n:v('#eN'),k:v('#eK'),h:v('#eH'),pr:v('#ePr'),note:v('#eNote'),q:v('#eQ'),links:readLinks(sh,'eLinks'),order:it?it.order:nextOrder()}; if(v('#eTy'))data.t=v('#eTy'); if(v('#eS'))data.s=+v('#eS'); }
    else { if(!v('#eN')){toast('이름을 넣어주세요');return}
      data={g:v('#eG')||S.PLACE_GROUPS[0],area:v('#eArea')||v('#eG'),n:v('#eN'),k:v('#eK'),h:v('#eH'),res:v('#eRes'),loc:v('#eLoc'),q:v('#eQ'),links:readLinks(sh,'eLinks'),order:it?it.order:nextOrder()}; if(g('#eU').checked)data.u=true; }
    Object.keys(data).forEach(k=>{ if(data[k]===''||data[k]===null||data[k]===undefined||data[k]===false||(Array.isArray(data[k])&&!data[k].length))delete data[k]; });
    Lg.closeSheet(); await save(col,id||uid(),data,isNew?'추가했어요':'수정했어요');
  };
  Lg.arm(g('#cDel'),async()=>{ Lg.closeSheet(); await remove(col,id); });
  setTimeout(()=>{ const f=g(isNew?(tab==='plan'?'#eTitle':'#eN'):'#eTitle, #eN'); if(f)f.focus(); },250);
}
C.openEditor=openEditor;

/* ---------- 시작 ---------- */
function boot(){
  if(!window.TripSite||!window.Ledger){ setTimeout(boot,60); return; }
  fetchContent().then(()=>{ C.onAuth(); });
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&!C.dragging)fetchContent(); });
  setInterval(()=>{ if(document.visibilityState==='visible'&&!C.dragging&&!document.querySelector('.lgov .lgsheet.lgopen'))fetchContent(); },60000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot); else boot();
})();
