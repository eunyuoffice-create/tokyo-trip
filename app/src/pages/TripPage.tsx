import { useCallback, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import type { ColName, Food, Place, PlanItem, Route as R, User } from '../api'
import { FoodEditor, PlaceEditor, PlanEditor, type EditTarget } from '../components/Editors'
import { Sheet, useToast } from '../components/Sheet'
import { SortableItem, SortableList } from '../components/Sortable'
import { Img } from '../images'
import type { Op } from '../outbox'
import { SyncLine } from '../ui'
import { reorderOps, useTrip } from '../useTrip'
import { dateRange, dday, dirUrl, mapUrl, md, todayLocal, weekday } from '../util'

const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))]
function rangeDays(a: string, b: string) {
  if (!a) return []
  const out: string[] = []; const end = b && b >= a ? b : a
  for (let t = Date.parse(a + 'T00:00:00Z'); out.length < 60; t += 864e5) { const d = new Date(t).toISOString().slice(0, 10); out.push(d); if (d >= end) break }
  return out
}
const PenIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></svg>

export default function TripPage({ user }: { user: User }) {
  const { tripId = '' } = useParams()
  const { c, err, write } = useTrip(tripId)
  const toast = useToast()
  const loc = useLocation()
  const [edit, setEdit] = useState<EditTarget>(null)
  const [day, setDay] = useState('')
  const [area, setArea] = useState('전체')

  const save = useCallback(async (ops: Op[], msg: string) => {
    setEdit(null)
    try { const how = await write(ops); toast(how === 'queued' ? '연결되면 자동으로 저장해요' : msg) }
    catch (e) { toast((e as { code?: string }).code === 'forbidden' ? '수정 권한이 없어요' : '저장 실패 — 다시 시도해 주세요') }
  }, [write, toast])
  const reorder = useCallback((col: ColName, items: { id: string; order?: number }[]) => {
    const ops = reorderOps(col, items); if (ops.length) save(ops, '순서를 바꿨어요')
  }, [save])

  const today = todayLocal()
  const days = useMemo(() => c ? uniq([...rangeDays(c.trip.start, c.trip.end), ...c.plan.map(p => p.day)]).sort() : [], [c])
  const curDay = days.includes(day) ? day : (days.includes(today) ? today : days[0] || '')

  if (!c) return (
    <div className="page">
      <Link to="/" className="back">← 내 여행</Link>
      {err ? <p className="error">{err.code === 'forbidden' ? '이 여행의 멤버가 아니에요' : err.code === 'no_trip' ? '없는 여행이에요' : err.message}</p> : <p className="muted">불러오는 중…</p>}
    </div>
  )
  const t = c.trip
  const sub = loc.pathname.split('/')[3] || ''
  const foodAreas = uniq(c.food.map(f => f.a || '기타'))
  const groups = uniq(c.places.map(p => p.g || '그 외'))
  const tab = (to: string, label: string) => <NavLink to={to} end className={({ isActive }) => 'tab' + (isActive ? ' on' : '')}>{label}</NavLink>
  const addBar = sub === '' ? ['plan', '일정 추가'] : sub === 'food' ? ['food', '맛집 추가'] : sub === 'places' ? ['places', '장소 추가'] : null
  const editItem = <T extends { id: string },>(list: T[]) => edit?.id ? list.find(x => x.id === edit.id) || null : null

  return (
    <div className="page has-tabs has-bar">
      <header className="top">
        <div>
          <Link to="/" className="back">← 내 여행</Link>
          <h1>{t.title}</h1>
          <div className="muted small">{dateRange(t.start, t.end)} {dday(t.start, t.end, today) && <span className="dday">{dday(t.start, t.end, today)}</span>}</div>
        </div>
        <div className="muted small right">{t.members.map((m, i) => <span key={m.id} className={i === c.me ? 'me' : ''}>{i ? ', ' : ''}{m.name}</span>)}{c.me === null && user.admin && <div className="tag">관리자</div>}</div>
      </header>
      <SyncLine err={err} at={c.at} />
      <Routes>
        <Route index element={<PlanView plan={c.plan} days={days} day={curDay} setDay={setDay} start={t.start} onEdit={id => setEdit({ col: 'plan', id })} onReorder={items => reorder('plan', items)} />} />
        <Route path="food" element={<FoodView food={c.food} areas={foodAreas} area={area} setArea={setArea} onEdit={id => setEdit({ col: 'food', id })} onReorder={items => reorder('food', items)} />} />
        <Route path="places" element={<PlacesView places={c.places} onEdit={id => setEdit({ col: 'places', id })} onReorder={items => reorder('places', items)} />} />
        <Route path="memo" element={<Soon what="메모" />} />
        <Route path="ledger" element={<Soon what="정산" />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
      {addBar && <div className="addbar"><button className="btn primary" onClick={() => setEdit({ col: addBar[0] as ColName, id: null })}>+ {addBar[1]}</button></div>}
      <nav className="tabs">
        {tab('.', '일정')}{tab('food', '맛집')}{tab('places', '갈 곳')}{tab('memo', '메모')}{tab('ledger', '정산')}
      </nav>

      {edit?.col === 'plan' && <PlanEditor tripId={tripId} item={editItem(c.plan)} days={days} defaultDay={curDay || today} plan={c.plan} onSave={save} onClose={() => setEdit(null)} />}
      {edit?.col === 'food' && <FoodEditor item={editItem(c.food)} areas={foodAreas.length ? foodAreas : uniq([t.city, '기타'])} food={c.food}
        defaultArea={area !== '전체' ? area : foodAreas[0] || t.city || '기타'} onSave={save} onClose={() => setEdit(null)} />}
      {edit?.col === 'places' && <PlaceEditor item={editItem(c.places)} groups={groups.length ? groups : ['그 외']} areas={uniq(c.places.map(p => p.area))} places={c.places}
        defaultGroup={groups[0] || '그 외'} onSave={save} onClose={() => setEdit(null)} />}
    </div>
  )
}

function Soon({ what }: { what: string }) {
  return <div className="card empty">{what}은 다음 단계에서 옮겨요. 지금은 기존 사이트에서 써 주세요.</div>
}
function EditBtn({ onClick }: { onClick: () => void }) {
  return <button type="button" className="edit-btn" aria-label="수정" onClick={e => { e.stopPropagation(); onClick() }}><PenIcon /></button>
}

/* ---------- 일정 ---------- */
function PlanView({ plan, days, day, setDay, start, onEdit, onReorder }: {
  plan: PlanItem[]; days: string[]; day: string; setDay: (d: string) => void; start: string
  onEdit: (id: string) => void; onReorder: (items: PlanItem[]) => void
}) {
  const items = plan.filter(p => p.day === day)
  const n = (d: string) => start ? Math.round((Date.parse(d) - Date.parse(start)) / 864e5) + 1 : 0
  if (!days.length) return <div className="card empty">아직 일정이 없어요. 아래 [일정 추가]로 시작해요.</div>
  return <>
    <div className="chips scroll">
      {days.map(d => (
        <button key={d} className="chip" aria-pressed={day === d} onClick={() => setDay(d)}>
          {n(d) > 0 && <b>{n(d)}일차 </b>}{md(d)} <span className="sub">{weekday(d)}</span>
        </button>
      ))}
    </div>
    {!items.length && <div className="card empty">이날은 아직 일정이 없어요.</div>}
    <SortableList ids={items.map(x => x.id)} onReorder={ids => onReorder(ids.map(id => items.find(x => x.id === id)!))}>
      <div className="tl">{items.map(it => <SortableItem key={it.id} id={it.id}><PlanCard it={it} onEdit={() => onEdit(it.id)} /></SortableItem>)}</div>
    </SortableList>
  </>
}

function PlanCard({ it, onEdit }: { it: PlanItem; onEdit: () => void }) {
  const [open, setOpen] = useState(false)
  const [big, setBig] = useState('')
  const routes = it.r ? (Array.isArray(it.r) ? it.r : [it.r]) : []
  const d = it.d || []
  return (
    <article className={'ev card' + (it.big ? ' big' : '')}>
      <EditBtn onClick={onEdit} />
      <div className="ev-t">{it.t}{it.ts && <small>{it.ts}</small>}</div>
      <div className="ev-b">
        {it.p && <div className="ev-p">{it.p}</div>}
        {it.title && <h3 className="ev-title">{it.title}</h3>}
        {it.pills && it.pills.length > 0 && <div className="pills">{it.pills.map(p => <span key={p} className="pill">{p}</span>)}</div>}
        {it.images && it.images.length > 0 && <div className="thumbs view">{it.images.map(id => <Img key={id} id={id} className="photo" onClick={setBig} />)}</div>}
        {routes.map((r, i) => <RouteRow key={i} r={r} />)}
        {it.links && it.links.length > 0 && <div className="links">{it.links.map((l, i) => <a key={i} className="btn sm" href={l.u} target="_blank" rel="noreferrer">{l.l || l.u.replace(/^https?:\/\//, '')}</a>)}</div>}
        {d.length > 0 && <>
          <div className={'ev-d' + (open ? ' open' : '')}>
            {d.map((x, i) => typeof x === 'string' ? <p key={i}>{x}</p>
              : x.k ? <h4 key={i}>{x.k}</h4>
              : x.u ? <a key={i} className="lnk" href={x.u} target="_blank" rel="noreferrer">{x.l || x.u}</a> : null)}
          </div>
          <button className="more" onClick={() => setOpen(!open)}>{open ? '접기' : '자세히'}</button>
        </>}
      </div>
      {big && <Sheet title={it.title || '사진'} onClose={() => setBig('')}><img className="lightbox" src={big} alt="" /></Sheet>}
    </article>
  )
}

function RouteRow({ r }: { r: R }) {
  const icon = r.mode === 'walking' ? '🚶' : r.mode === 'driving' ? '🚕' : '🚃'
  return (
    <a className="route" href={r.url || dirUrl(r.fq || r.f, r.tq || r.t, r.mode)} target="_blank" rel="noreferrer">
      <span className="route-ft">{icon} {r.f} → {r.t}{r.price && <span className="rprice">{r.price}</span>}</span>
      {r.how && <span className="route-how">{r.how}</span>}
      <span className="route-go">{r.url ? '구글맵으로 이동 ↗' : '구글맵 경로 보기 ↗'}</span>
    </a>
  )
}

/* ---------- 맛집 ---------- */
function FoodView({ food, areas, area, setArea, onEdit, onReorder }: {
  food: Food[]; areas: string[]; area: string; setArea: (a: string) => void; onEdit: (id: string) => void; onReorder: (items: Food[]) => void
}) {
  const cur = area === '전체' || areas.includes(area) ? area : '전체'
  const list = cur === '전체' ? food : food.filter(f => (f.a || '기타') === cur)
  if (!food.length) return <div className="card empty">아직 맛집이 없어요. 아래 [맛집 추가]로 시작해요.</div>
  return <>
    <div className="chips scroll">
      {['전체', ...areas].map(a => <button key={a} className="chip" aria-pressed={cur === a} onClick={() => setArea(a)}>{a}</button>)}
    </div>
    <SortableList ids={list.map(x => x.id)} onReorder={ids => onReorder(ids.map(id => list.find(x => x.id === id)!))}>
      <div className="grid">{list.map(f => (
        <SortableItem key={f.id} id={f.id}>
          <article className="card spot">
            <EditBtn onClick={() => onEdit(f.id)} />
            <div className="spot-h"><h3>{f.n}{f.tag && <span className="tag">{f.tag}</span>}</h3>{f.s ? <span className="stars">{'★'.repeat(f.s)}</span> : null}</div>
            <div className="muted small">{[f.a, f.k, f.pr].filter(Boolean).join(' · ')}</div>
            {(f.h || f.closed) && <div className="small">{[f.h, f.closed].filter(Boolean).join(' · ')}</div>}
            {f.note && <Note text={f.note} />}
            <SpotLinks q={f.q} links={f.links} link={f.link} />
          </article>
        </SortableItem>
      ))}</div>
    </SortableList>
  </>
}

/* ---------- 갈 곳 ---------- */
function PlacesView({ places, onEdit, onReorder }: { places: Place[]; onEdit: (id: string) => void; onReorder: (items: Place[]) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Place[]>()
    for (const p of places) { const k = p.g || '그 외'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(p) }
    return [...m.entries()]
  }, [places])
  if (!places.length) return <div className="card empty">아직 갈 곳이 없어요. 아래 [장소 추가]로 시작해요.</div>
  return <>{groups.map(([g, ps]) => (
    <section key={g}>
      <h2 className="sec-h">{g}</h2>
      <SortableList ids={ps.map(x => x.id)} onReorder={ids => onReorder(ids.map(id => ps.find(x => x.id === id)!))}>
        <div className="grid">{ps.map(p => (
          <SortableItem key={p.id} id={p.id}>
            <article className="card spot">
              <EditBtn onClick={() => onEdit(p.id)} />
              <div className="spot-h"><h3>{p.n}{p.tag && <span className="tag">{p.tag}</span>}</h3>{p.res && <span className="pill">{p.res}</span>}</div>
              <div className="muted small">{[p.area !== g ? p.area : '', p.k].filter(Boolean).join(' · ')}{p.u && <span className="tag warn">영업 확인 필요</span>}</div>
              {p.h && <div className="small">{p.h}</div>}
              {p.loc && <Note text={p.loc} />}
              <SpotLinks q={p.q} links={p.links} link={p.link} />
            </article>
          </SortableItem>
        ))}</div>
      </SortableList>
    </section>
  ))}</>
}

function SpotLinks({ q, links, link }: { q?: string; links?: { l: string; u: string }[]; link?: string }) {
  const ls = links?.length ? links : link ? [{ l: '링크', u: link }] : []
  if (!q && !ls.length) return null
  return <div className="links">
    {q && <a className="btn sm" href={mapUrl(q)} target="_blank" rel="noreferrer">지도</a>}
    {ls.map((l, i) => <a key={i} className="btn sm" href={l.u} target="_blank" rel="noreferrer">{l.l || l.u.replace(/^https?:\/\//, '')}</a>)}
  </div>
}

function Note({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return <p className={'note' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>{text}</p>
}
