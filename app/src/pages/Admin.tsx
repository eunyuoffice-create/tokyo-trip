import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type Trip, type User } from '../api'

type Draft = { id?: string; title: string; country: string; city: string; start: string; end: string; currency: string; members: string[] }
const empty: Draft = { title: '', country: '', city: '', start: '', end: '', currency: 'KRW', members: [] }
const CURRENCIES = ['KRW', 'JPY', 'CNY', 'USD', 'EUR', 'TWD', 'THB', 'VND', 'HKD']

export default function Admin() {
  const [users, setUsers] = useState<User[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [msg, setMsg] = useState('')
  const [nu, setNu] = useState({ name: '', pin: '' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [lockedMembers, setLocked] = useState<string[]>([])

  const load = useCallback(() => api<{ trips: Trip[]; users: User[] }>('me').then(j => { setTrips(j.trips); setUsers(j.users || []) }).catch((e: ApiError) => setMsg(e.message)), [])
  useEffect(() => { load() }, [load])
  const run = async (p: Promise<unknown>, ok: string) => { setMsg(''); try { await p; setMsg(ok); await load(); return true } catch (e) { setMsg((e as Error).message); return false } }

  async function addUser(e: React.FormEvent) {
    e.preventDefault()
    if (await run(api('admin.createUser', nu), `${nu.name} 님 계정을 만들었어요`)) setNu({ name: '', pin: '' })
  }
  async function resetPin(u: User) {
    const pin = prompt(`${u.name} 님의 새 비밀번호 (숫자 4~8자리)`)   // 관리자 화면 전용, 드물게 씀
    if (pin) await run(api('admin.setPin', { userId: u.id, pin }), '비밀번호를 바꿨어요')
  }
  async function saveTrip(e: React.FormEvent) {
    e.preventDefault(); if (!draft) return
    if (await run(api('admin.saveTrip', { trip: draft }), '여행을 저장했어요')) setDraft(null)
  }
  const edit = (t: Trip) => { const m = t.members.map(x => x.id); setLocked(m); setDraft({ id: t.id, title: t.title, country: t.country, city: t.city, start: t.start, end: t.end, currency: t.currency, members: m }) }
  const toggle = (id: string) => draft && setDraft({ ...draft, members: draft.members.includes(id) ? draft.members.filter(x => x !== id) : [...draft.members, id] })

  return (
    <div className="page">
      <header className="top"><div><Link to="/" className="back">← 내 여행</Link><h1>관리</h1></div></header>
      {msg && <div className="sync">{msg}</div>}

      <h2 className="sec-h">여행</h2>
      {!draft && <button className="btn primary" onClick={() => { setLocked([]); setDraft({ ...empty }) }}>+ 새 여행</button>}
      {draft && (
        <form className="card form" onSubmit={saveTrip}>
          <label>여행 이름<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="예: 상하이 먹방" required maxLength={40} /></label>
          <div className="row2">
            <label>나라<input value={draft.country} onChange={e => setDraft({ ...draft, country: e.target.value })} placeholder="중국" /></label>
            <label>도시<input value={draft.city} onChange={e => setDraft({ ...draft, city: e.target.value })} placeholder="상하이" /></label>
          </div>
          <div className="row2">
            <label>시작<input type="date" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
            <label>끝<input type="date" value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
          </div>
          <label>현지 통화<select value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label>
          <div>
            <div className="label">여행자 (누른 순서대로 추가)</div>
            <div className="chips wrap">
              {users.map(u => <button type="button" key={u.id} className="chip" aria-pressed={draft.members.includes(u.id)}
                disabled={lockedMembers.includes(u.id)} onClick={() => toggle(u.id)}>{u.name}</button>)}
            </div>
            {lockedMembers.length > 0 && <p className="muted small">이미 있는 멤버는 지출 기록이 얽혀 있어서 뺄 수 없어요.</p>}
          </div>
          <div className="row2">
            <button type="button" className="btn" onClick={() => setDraft(null)}>취소</button>
            <button className="btn primary">저장</button>
          </div>
        </form>
      )}
      <div className="list">
        {trips.map(t => (
          <div key={t.id} className="card row">
            <div><b>{t.title}</b><div className="muted small">{t.start || '날짜 미정'} · {t.members.map(m => m.name).join(', ') || '멤버 없음'}</div></div>
            <button className="btn sm" onClick={() => edit(t)}>수정</button>
          </div>
        ))}
      </div>

      <h2 className="sec-h">사람</h2>
      <form className="card form" onSubmit={addUser}>
        <div className="row2">
          <label>이름<input value={nu.name} onChange={e => setNu({ ...nu, name: e.target.value })} maxLength={12} required /></label>
          <label>비밀번호 (숫자 4~8)<input inputMode="numeric" pattern="\d{4,8}" value={nu.pin} onChange={e => setNu({ ...nu, pin: e.target.value })} required /></label>
        </div>
        <button className="btn primary">+ 계정 만들기</button>
      </form>
      <div className="list">
        {users.map(u => (
          <div key={u.id} className="card row">
            <div><b>{u.name}</b>{u.admin && <span className="tag">관리자</span>}</div>
            <button className="btn sm" onClick={() => resetPin(u)}>비밀번호 바꾸기</button>
          </div>
        ))}
      </div>
    </div>
  )
}
