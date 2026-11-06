import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { ApiError, cache, contentKey, fetchContent, type Content, type Food, type Place, type PlanItem, type Route as R, type User } from '../api'
import { SyncLine } from '../ui'
import { dateRange, dday, dirUrl, mapUrl, md, weekday, todayLocal } from '../util'

export default function TripPage({ user }: { user: User }) {
  const { tripId = '' } = useParams()
  const [c, setC] = useState<Content | null>(() => cache.get<Content>(contentKey(tripId)))
  const [err, setErr] = useState<ApiError | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => fetchContent(tripId).then(x => { if (alive) { setC(x); setErr(null) } }).catch((e: ApiError) => alive && setErr(e))
    load()
    // 화면으로 돌아오거나 인터넷이 다시 연결되면 새로 받기
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('online', load); document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; window.removeEventListener('online', load); document.removeEventListener('visibilitychange', onVis) }
  }, [tripId])

  if (!c) return (
    <div className="page">
      <Link to="/" className="back">← 내 여행</Link>
      {err ? <p className="error">{err.code === 'forbidden' ? '이 여행의 멤버가 아니에요' : err.code === 'no_trip' ? '없는 여행이에요' : err.message}</p> : <p className="muted">불러오는 중…</p>}
    </div>
  )
  const t = c.trip
  const today = todayLocal()
  const tab = (to: string, label: string) => <NavLink to={to} end className={({ isActive }) => 'tab' + (isActive ? ' on' : '')}>{label}</NavLink>

  return (
    <div className="page has-tabs">
      <header className="top">
        <div>
          <Link to="/" className="back">← 내 여행</Link>
          <h1>{t.title}</h1>
          <div className="muted small">{dateRange(t.start, t.end)} {dday(t.start, t.end, today) && <span className="dday">{dday(t.start, t.end, today)}</span>}</div>
        </div>
        <div className="muted small right">{t.members.map((m, i) => <span key={m.id} className={i === c.me ? 'me' : ''}>{m.name}</span>).reduce<React.ReactNode[]>((a, x, i) => i ? [...a, ', ', x] : [x], [])}{c.me === null && user.admin && <div className="tag">관리자 보기</div>}</div>
      </header>
      <SyncLine err={err} at={c.at} />
      <Routes>
        <Route index element={<PlanView plan={c.plan} start={t.start} today={today} />} />
        <Route path="food" element={<FoodView food={c.food} />} />
        <Route path="places" element={<PlacesView places={c.places} />} />
        <Route path="memo" element={<Soon what="메모" />} />
        <Route path="ledger" element={<Soon what="정산" />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
      <nav className="tabs">
        {tab('.', '일정')}{tab('food', '맛집')}{tab('places', '갈 곳')}{tab('memo', '메모')}{tab('ledger', '정산')}
      </nav>
    </div>
  )
}

function Soon({ what }: { what: string }) {
  return <div className="card empty">{what}은 다음 단계에서 옮겨요. 지금은 기존 사이트에서 써 주세요.</div>
}

/* ---------- 일정 ---------- */
function PlanView({ plan, start, today }: { plan: PlanItem[]; start: string; today: string }) {
  const days = useMemo(() => {
    const m = new Map<string, PlanItem[]>()
    for (const it of plan) { const k = it.day || '미정'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(it) }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [plan])
  const first = days.find(([d]) => d === today)?.[0] || days[0]?.[0] || ''
  const [sel, setSel] = useState(first)
  if (!days.length) return <div className="card empty">아직 일정이 없어요.</div>
  const items = days.find(([d]) => d === sel)?.[1] || []
  const n = (d: string) => start ? Math.round((Date.parse(d) - Date.parse(start)) / 864e5) + 1 : 0
  return <>
    <div className="chips scroll">
      {days.map(([d]) => (
        <button key={d} className="chip" aria-pressed={sel === d} onClick={() => setSel(d)}>
          {d === '미정' ? '미정' : <>{n(d) > 0 && <b>{n(d)}일차 </b>}{md(d)} <span className="sub">{weekday(d)}</span></>}
        </button>
      ))}
    </div>
    <div className="tl">{items.map(it => <PlanCard key={it.id} it={it} />)}</div>
  </>
}

function PlanCard({ it }: { it: PlanItem }) {
  const [open, setOpen] = useState(false)
  const routes = it.r ? (Array.isArray(it.r) ? it.r : [it.r]) : []
  const d = it.d || []
  return (
    <article className={'ev card' + (it.big ? ' big' : '')}>
      <div className="ev-t">{it.t}{it.ts && <small>{it.ts}</small>}</div>
      <div className="ev-b">
        {it.p && <div className="ev-p">{it.p}</div>}
        {it.title && <h3 className="ev-title">{it.title}</h3>}
        {it.pills && it.pills.length > 0 && <div className="pills">{it.pills.map(p => <span key={p} className="pill">{p}</span>)}</div>}
        {routes.map((r, i) => <RouteRow key={i} r={r} />)}
        {it.links && it.links.length > 0 && <div className="links">{it.links.map(l => <a key={l.u} className="btn sm" href={l.u} target="_blank" rel="noreferrer">{l.l}</a>)}</div>}
        {d.length > 0 && <>
          <div className={'ev-d' + (open ? ' open' : '')}>
            {d.map((x, i) => typeof x === 'string' ? <p key={i}>{x}</p>
              : x.k ? <h4 key={i}>{x.k}</h4>
              : x.u ? <a key={i} className="lnk" href={x.u} target="_blank" rel="noreferrer">{x.l || x.u}</a> : null)}
          </div>
          <button className="more" onClick={() => setOpen(!open)}>{open ? '접기' : '자세히'}</button>
        </>}
      </div>
    </article>
  )
}

function RouteRow({ r }: { r: R }) {
  return (
    <a className="route" href={dirUrl(r.fq || r.f, r.tq || r.t, r.mode)} target="_blank" rel="noreferrer">
      <span className="route-ft">{r.f} → {r.t}</span>
      {r.how && <span className="route-how">{r.how}</span>}
    </a>
  )
}

/* ---------- 맛집 ---------- */
function FoodView({ food }: { food: Food[] }) {
  const areas = useMemo(() => [...new Set(food.map(f => f.a || '기타'))], [food])
  const [area, setArea] = useState('전체')
  const list = area === '전체' ? food : food.filter(f => (f.a || '기타') === area)
  if (!food.length) return <div className="card empty">아직 맛집이 없어요.</div>
  return <>
    <div className="chips scroll">
      {['전체', ...areas].map(a => <button key={a} className="chip" aria-pressed={area === a} onClick={() => setArea(a)}>{a}</button>)}
    </div>
    <div className="grid">{list.map(f => (
      <article key={f.id} className="card spot">
        <div className="spot-h"><h3>{f.n}</h3>{f.s ? <span className="stars">{'★'.repeat(f.s)}</span> : null}</div>
        <div className="muted small">{[f.a, f.k, f.pr].filter(Boolean).join(' · ')}</div>
        {f.h && <div className="small">{f.h}</div>}
        {f.note && <Note text={f.note} />}
        <div className="links">
          {f.q && <a className="btn sm" href={mapUrl(f.q)} target="_blank" rel="noreferrer">지도</a>}
          {(f.links || []).map(l => <a key={l.u} className="btn sm" href={l.u} target="_blank" rel="noreferrer">{l.l}</a>)}
        </div>
      </article>
    ))}</div>
  </>
}

/* ---------- 갈 곳 ---------- */
function PlacesView({ places }: { places: Place[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, Place[]>()
    for (const p of places) { const k = p.g || '기타'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(p) }
    return [...m.entries()]
  }, [places])
  if (!places.length) return <div className="card empty">아직 갈 곳이 없어요.</div>
  return <>{groups.map(([g, ps]) => (
    <section key={g}>
      <h2 className="sec-h">{g}</h2>
      <div className="grid">{ps.map(p => (
        <article key={p.id} className="card spot">
          <div className="spot-h"><h3>{p.n}</h3>{p.res && <span className="pill">{p.res}</span>}</div>
          <div className="muted small">{[p.area, p.k].filter(Boolean).join(' · ')}</div>
          {p.h && <div className="small">{p.h}</div>}
          {p.loc && <Note text={p.loc} />}
          <div className="links">
            {p.q && <a className="btn sm" href={mapUrl(p.q)} target="_blank" rel="noreferrer">지도</a>}
            {(p.links || []).map(l => <a key={l.u} className="btn sm" href={l.u} target="_blank" rel="noreferrer">{l.l}</a>)}
          </div>
        </article>
      ))}</div>
    </section>
  ))}</>
}

function Note({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return <p className={'note' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>{text}</p>
}
