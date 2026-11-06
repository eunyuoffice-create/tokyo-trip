import { useEffect, useState } from 'react'
import { api, ApiError, cache, session, type User } from '../api'

type U = { id: string; name: string }

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [users, setUsers] = useState<U[] | null>(cache.get<U[]>('v2_users'))
  const [legacy, setLegacy] = useState<string[] | null>(null)
  const [imp, setImp] = useState({ admin: '', sitePw: '' })
  const [done2, setDone2] = useState('')
  const [err, setErr] = useState('')
  const [pick, setPick] = useState<string>('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [boot, setBoot] = useState({ name: '', pin: '', sitePw: '' })

  useEffect(() => {
    loadUsers()
  }, [])
  function loadUsers() {
    return api<{ users: U[]; legacy?: string[] }>('users').then(j => { setUsers(j.users); setLegacy(j.legacy || null); cache.set('v2_users', j.users) })
      .catch((e: ApiError) => setErr(e.offline ? '인터넷 연결이 필요해요 (처음 로그인할 때만)' : e.message))
  }
  async function importLegacy(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try { const j = await api<{ writes: number }>('migrateLegacy', imp); setDone2(`가져왔어요 (${j.writes}건). 이제 원래 비밀번호로 들어가세요.`); await loadUsers() }
    catch (e) { setErr((e as ApiError).code === 'site_pw' ? '사이트 비밀번호가 달라요' : (e as Error).message) }
    finally { setBusy(false) }
  }

  const done = (j: { token: string; user: User }) => { session.save(j.token, j.user); onLogin(j.user) }
  async function login(e: React.FormEvent) {
    e.preventDefault(); if (!pick) return; setBusy(true); setErr('')
    try { done(await api('login', { userId: pick, pin })) }
    catch (e) { setErr((e as ApiError).code === 'pin' ? '비밀번호가 달라요' : (e as Error).message); setPin('') }
    finally { setBusy(false) }
  }
  async function bootstrap(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try { done(await api('bootstrap', boot)) }
    catch (e) { setErr((e as ApiError).code === 'site_pw' ? '사이트 비밀번호가 달라요' : (e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="page narrow">
      <h1 className="login-title">여행 노트</h1>
      {done2 && <div className="sync">{done2}</div>}
      {users && users.length === 0 && legacy ? (
        <form className="card form" onSubmit={importLegacy}>
          <p className="muted">기존 도쿄 여행 데이터가 있어요. 새 구조로 가져올게요. 멤버 비밀번호는 그대로예요.</p>
          <div className="label">관리자</div>
          <div className="chips wrap">{legacy.map(n => <button type="button" key={n} className="chip" aria-pressed={imp.admin === n} onClick={() => setImp({ ...imp, admin: n })}>{n}</button>)}</div>
          <label>사이트 입장 비밀번호<input type="password" value={imp.sitePw} onChange={e => setImp({ ...imp, sitePw: e.target.value })} required /></label>
          <button className="btn primary" disabled={busy || !imp.admin}>{busy ? '가져오는 중…' : '도쿄 데이터 가져오기'}</button>
        </form>
      ) : users && users.length === 0 ? (
        <form className="card form" onSubmit={bootstrap}>
          <p className="muted">처음이에요. 관리자 계정을 만들어 주세요.</p>
          <label>이름<input value={boot.name} onChange={e => setBoot({ ...boot, name: e.target.value })} maxLength={12} required /></label>
          <label>비밀번호 (숫자 4~8자리)<input inputMode="numeric" pattern="\d{4,8}" type="password" value={boot.pin} onChange={e => setBoot({ ...boot, pin: e.target.value })} required /></label>
          <label>사이트 입장 비밀번호<input type="password" value={boot.sitePw} onChange={e => setBoot({ ...boot, sitePw: e.target.value })} /></label>
          <button className="btn primary" disabled={busy}>관리자로 시작</button>
        </form>
      ) : (
        <form className="card form" onSubmit={login}>
          <p className="muted">누구세요?</p>
          <div className="chips wrap">
            {(users || []).map(u => (
              <button type="button" key={u.id} className="chip" aria-pressed={pick === u.id} onClick={() => setPick(u.id)}>{u.name}</button>
            ))}
            {!users && !err && <span className="muted">불러오는 중…</span>}
          </div>
          {pick && <>
            <label>비밀번호<input autoFocus inputMode="numeric" type="password" value={pin} onChange={e => setPin(e.target.value)} /></label>
            <button className="btn primary" disabled={busy || pin.length < 4}>들어가기</button>
          </>}
          <p className="muted small">계정은 관리자가 만들어 드려요.</p>
        </form>
      )}
      {err && <p className="error">{err}</p>}
      {err === '사이트 입장 비밀번호가 필요해요' && <a className="btn" href="/__gate?next=/">사이트 비밀번호 입력</a>}
    </div>
  )
}
