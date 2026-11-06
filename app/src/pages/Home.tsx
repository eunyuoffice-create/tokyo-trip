import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, cache, type Trip, type User } from '../api'
import { SyncLine } from '../ui'
import { dateRange, dday } from '../util'

type Me = { trips: Trip[]; at: number }

export default function Home({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(() => cache.get<Me>('v2_me') || fromContentCache())
  const [err, setErr] = useState<ApiError | null>(null)

  useEffect(() => {
    api<{ trips: Trip[] }>('me')
      .then(j => { const next = { trips: j.trips, at: Date.now() }; setMe(next); cache.set('v2_me', next); setErr(null) })
      .catch((e: ApiError) => { if (e.code === 'auth') onLogout(); else setErr(e) })
  }, [onLogout])

  const today = new Date().toISOString().slice(0, 10)
  const trips = me?.trips || []
  const upcoming = trips.filter(t => !t.end || t.end >= today).sort((a, b) => a.start.localeCompare(b.start))
  const past = trips.filter(t => t.end && t.end < today)

  return (
    <div className="page">
      <header className="top">
        <h1>내 여행</h1>
        <div className="top-r">
          {user.admin && <Link className="btn ghost sm" to="/admin">관리</Link>}
          <button className="btn ghost sm" onClick={onLogout}>{user.name} · 로그아웃</button>
        </div>
      </header>
      <SyncLine err={err} at={me?.at} />
      {!me && !err && <p className="muted">불러오는 중…</p>}
      {me && trips.length === 0 && <div className="card empty">아직 여행이 없어요.{user.admin ? ' 관리에서 새 여행을 만들어 주세요.' : ' 관리자에게 추가를 부탁하세요.'}</div>}
      {upcoming.length > 0 && <Section title="다가오는 여행" trips={upcoming} today={today} />}
      {past.length > 0 && <Section title="지난 여행" trips={past} today={today} />}
    </div>
  )
}

/* 목록을 한 번도 못 받았는데 오프라인이면: 열어 봤던 여행(저장된 내용)으로 목록을 만든다 */
function fromContentCache(): Me | null {
  const trips: Trip[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || ''
      if (k.startsWith('v2_content_')) { const c = cache.get<{ trip: Trip }>(k); if (c?.trip) trips.push(c.trip) }
    }
  } catch { /* 저장소 못 씀 */ }
  return trips.length ? { trips, at: 0 } : null
}

function Section({ title, trips, today }: { title: string; trips: Trip[]; today: string }) {
  return (
    <section>
      <h2 className="sec-h">{title}</h2>
      <div className="grid">
        {trips.map(t => (
          <Link key={t.id} to={`/t/${t.id}`} className="card trip-card">
            <div className="trip-city">{[t.country, t.city].filter(Boolean).join(' · ')}</div>
            <div className="trip-title">{t.title}</div>
            <div className="trip-meta">
              <span>{dateRange(t.start, t.end)}</span>
              {dday(t.start, t.end, today) && <span className="dday">{dday(t.start, t.end, today)}</span>}
            </div>
            <div className="trip-members">{t.members.map(m => m.name).join(', ')}{t.joined === false && <span className="tag">멤버 아님</span>}</div>
          </Link>
        ))}
      </div>
    </section>
  )
}
