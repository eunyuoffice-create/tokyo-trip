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
  ['p-plan','p-food','p-place'].forEach(pid=>{const p=document.getElementById(pid); if(!p)return; p.querySelectorAll('.lgcbar, .cedit').forEach(x=>x.remove()); p.classList.remove('lg-haspad');});
  if(!['plan','food','place'].includes(tab))return;
  const col=colOf(tab); const editable=loggedIn()&&C.loaded&&!!listOf(col);
  if(!editable){ if(loggedIn()&&C.loaded)seedIfNeeded(); return; }
  const panel=document.getElementById('p-'+tab); panel.classList.add('lg-haspad');
  const label=tab==='plan'?'일정 추가':tab==='food'?'맛집 추가':'장소 추가';
  const bar=document.createElement('div'); bar.className='lg lgcbar'; bar.innerHTML=`<div class="lgbar"><div class="lgadd2 lgadd1"><button class="lgaddexp" data-cadd="${tab}">${svgPlus}${label}</button></div></div>`; panel.appendChild(bar);
  bar.querySelector('[data-cadd]').onclick=()=>openEditor(tab,null);
  const mkBtn=id=>{const b=document.createElement('button'); b.className='cedit'; b.type='button'; b.innerHTML=svgPen; b.setAttribute('aria-label','수정'); b.onclick=e=>{e.stopPropagation();openEditor(tab,id)}; return b;};
  if(tab==='plan'){ panel.querySelectorAll('.ev[data-eid]').forEach(el=>{ if(!el.querySelector('.cedit'))el.appendChild(mkBtn(el.dataset.eid)); }); makeSortable(panel.querySelector('.tl'),'.ev[data-eid]','plan'); }
  else { panel.querySelectorAll('.card[data-eid]').forEach(el=>{ if(!el.querySelector('.cedit')){const acts=el.querySelector('.acts')||el; acts.appendChild(mkBtn(el.dataset.eid));} }); panel.querySelectorAll('.cards').forEach(l=>makeSortable(l,'.card[data-eid]',col)); }
};
C.onAuth=function(){ const a=loggedIn(); if(a===C._auth)return; C._auth=a; if(a&&C.loaded&&!C.meta.plan)seedIfNeeded(); else if(T())T().render(); };

/* ---------- 직렬화: 내용(d) · 이동(r) ↔ 텍스트 ---------- */
const dToText=d=>(d||[]).map(x=>typeof x==='string'?x.replace(/\n/g,'\n  '):x.k?`## ${x.k}`:x.l?`[${x.l}](${x.u||''})`:'').join('\n');
function textToD(t){
  const out=[]; String(t||'').split('\n').forEach(line=>{
    if(/^  /.test(line)&&out.length&&typeof out[out.length-1]==='string'){ out[out.length-1]+='\n'+line.slice(2); return; }
    const s=line.trim(); if(!s)return;
    let m; if((m=s.match(/^##\s*(.+)$/)))out.push({k:m[1].trim()});
    else if((m=s.match(/^\[(.+?)\]\((\S+?)\)$/)))out.push({l:m[1],u:m[2]});
    else out.push(s);
  }); return out;
}
const rToText=r=>(r?(Array.isArray(r)?r:[r]):[]).map(x=>[`${x.f||''} > ${x.t||''}`,String(x.how||'').replace(/\n/g,' · '),x.fq||'',x.tq||'',x.mode||'transit'].join(' | ')).join('\n');
function textToR(t){
  const out=[]; String(t||'').split('\n').forEach(line=>{ const s=line.trim(); if(!s)return; const parts=s.split('|').map(x=>x.trim()); const ft=parts[0].split('>').map(x=>x.trim());
    out.push({f:ft[0]||'',t:ft[1]||'',how:parts[1]||'',fq:parts[2]||ft[0]||'',tq:parts[3]||ft[1]||'',mode:/walk/.test(parts[4]||'')?'walking':/driv|taxi|택시/.test(parts[4]||'')?'driving':'transit'}); });
  return out.length?(out.length===1?out[0]:out):null;
}

/* ---------- 편집 시트 ---------- */
const F={
  text:(id,label,val,ph='',extra='')=>`<div class="lgf"><label>${label}</label><input type="text" id="${id}" value="${esc(val||'')}" placeholder="${esc(ph)}" ${extra}></div>`,
  area:(id,label,val,ph='',rows=4)=>`<div class="lgf"><label>${label}</label><textarea id="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(val||'')}</textarea></div>`,
  chips:(id,label,opts,val,free)=>`<div class="lgf"><label>${label}</label><div class="lgchips" data-chips="${id}">${opts.map(o=>`<button type="button" class="lgchip lgsm" data-v="${esc(o)}" aria-pressed="${o===val}">${esc(o)}</button>`).join('')}</div>${free?`<input type="text" id="${id}" value="${esc(val||'')}" placeholder="${esc(free)}" style="margin-top:8px">`:`<input type="hidden" id="${id}" value="${esc(val||'')}">`}</div>`,
  toggle:(id,label,on)=>`<div class="lgf"><div class="lgtoggle"><span>${label}</span><input type="checkbox" id="${id}" ${on?'checked':''}></div></div>`,
};
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
      ${F.area('eD','자세히 내용',dToText(it?.d),'한 줄에 하나씩.\n## 소제목\n[링크 이름](https://…)\n  (두 칸 들여쓰면 윗줄에 이어 붙어요)',6)}
      <details class="lgmore"><summary><span>이동 경로 (고급)</span></summary>${F.area('eR','한 줄에 경로 하나: 출발 > 도착 | 설명 | 출발 검색어 | 도착 검색어 | transit/walking/driving',rToText(it?.r),'이케부쿠로역 > 스튜디오 투어 도쿄 | 세이부선 약 20분 | 池袋駅 | ワーナー ブラザース スタジオツアー東京 | transit',4)}</details>`;
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
      ${F.text('eLink','링크',it?.link,'https://…','inputmode="url"')}`;
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
      ${F.text('eLink','링크',it?.link,'https://…','inputmode="url"')}
      ${F.toggle('eU','영업 확인 필요 표시',!!it?.u)}`;
  }
  Lg.openSheet(`<h2>${title}<button type="button" data-close>닫기</button></h2><form id="cForm" autocomplete="off">${body}
    <div class="lgactions">${isNew?'':'<button type="button" class="lgbtn lgdanger" id="cDel">삭제</button>'}<button type="submit" class="lgbtn lgprimary">${isNew?'저장':'수정 저장'}</button></div></form>`);
  const sh=document.querySelector('.lgov .lgsheet'); const g=s=>sh.querySelector(s); const v=s=>(g(s)?.value||'').trim();
  wireChips(sh);
  g('#cForm').onsubmit=async ev=>{ ev.preventDefault();
    let data; const nextOrder=()=>{ const l=listOf(col)||[]; const pool=tab==='plan'?l.filter(x=>x.day===v('#eDay')):l; return (pool.length?Math.max(...pool.map(x=>x.order||0)):0)+1000; };
    if(tab==='plan'){ if(!v('#eTitle')){toast('제목을 넣어주세요');return} const day=v('#eDay');
      data={day,t:v('#eT'),ts:v('#eTs'),p:v('#eP'),title:v('#eTitle'),pills:v('#ePills')?v('#ePills').split(',').map(x=>x.trim()).filter(Boolean):[],big:g('#eBig').checked,d:textToD(v('#eD')),r:textToR(v('#eR')),order:(it&&it.day===day)?it.order:nextOrder()}; }
    else if(tab==='food'){ if(!v('#eN')){toast('가게 이름을 넣어주세요');return}
      data={a:v('#eA')||S.FOOD_AREAS[0],n:v('#eN'),k:v('#eK'),h:v('#eH'),pr:v('#ePr'),note:v('#eNote'),q:v('#eQ'),link:v('#eLink'),order:it?it.order:nextOrder()}; if(v('#eTy'))data.t=v('#eTy'); if(v('#eS'))data.s=+v('#eS'); }
    else { if(!v('#eN')){toast('이름을 넣어주세요');return}
      data={g:v('#eG')||S.PLACE_GROUPS[0],area:v('#eArea')||v('#eG'),n:v('#eN'),k:v('#eK'),h:v('#eH'),res:v('#eRes'),loc:v('#eLoc'),q:v('#eQ'),link:v('#eLink'),order:it?it.order:nextOrder()}; if(g('#eU').checked)data.u=true; }
    Object.keys(data).forEach(k=>{ if(data[k]===''||data[k]===null||data[k]===undefined||data[k]===false)delete data[k]; });
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
