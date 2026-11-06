// 서버 호출 + 로그인 토큰 + 오프라인 캐시(localStorage)
export type User = { id: string; name: string; admin: boolean }
export type Member = { id: string; name: string }
export type Trip = {
  id: string; title: string; city: string; country: string; start: string; end: string
  currency: string; rate: number | null; cover: string; members: Member[]; joined?: boolean
}
export type Link = { l: string; u: string }
export type DItem = string | { k?: string; l?: string; u?: string }
export type Route = { f: string; t: string; how?: string; fq?: string; tq?: string; mode?: string; price?: string; url?: string }
export type PlanItem = {
  id: string; day: string; t?: string; ts?: string; p?: string; title?: string; pills?: string[]; big?: boolean
  d?: DItem[]; r?: Route | Route[]; links?: Link[]; images?: string[]; order?: number
}
export type Food = { id: string; a?: string; n: string; k?: string; t?: string; h?: string; closed?: string; pr?: string; s?: number; note?: string; tag?: string; q?: string; link?: string; links?: Link[]; order?: number }
export type Place = { id: string; g?: string; area?: string; n: string; k?: string; h?: string; res?: string; loc?: string; tag?: string; q?: string; link?: string; links?: Link[]; u?: boolean; order?: number }
export type ColName = 'plan' | 'food' | 'places'
export type Content = { v: string; me: number | null; trip: Trip; plan: PlanItem[]; food: Food[]; places: Place[]; at: number }

export class ApiError extends Error { code: string; offline: boolean
  constructor(code: string, msg?: string, offline = false) { super(msg || code); this.code = code; this.offline = offline } }

const store = {
  get<T>(k: string): T | null { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) as T : null } catch { return null } },
  set(k: string, v: unknown): boolean { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch { return false /* 저장 공간 없음·사생활 모드 */ } },
  del(k: string) { try { localStorage.removeItem(k) } catch { /* */ } },
}
export const cache = store

export const session = {
  get token() { return store.get<string>('v2_token') },
  get user() { return store.get<User>('v2_user') },
  save(token: string, user: User) { store.set('v2_token', token); store.set('v2_user', user) },
  // 로그아웃·토큰 만료: 다른 사람이 같은 기기로 들어와도 이전 사람의 목록·여행 내용이 안 보이게 v2_ 저장분을 모두 지움
  // (로그인 화면의 이름 목록 v2_users 와, 아직 못 보낸 수정 v2_outbox_<사람> 은 남김 — 그 사람이 다시 로그인하면 보냄)
  clear() {
    try { const ks: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i) || ''; if (k.startsWith('v2_') && k !== 'v2_users' && !k.startsWith('v2_outbox_')) ks.push(k) } ks.forEach(k => localStorage.removeItem(k)) } catch { /* */ }
  },
}

export async function api<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  let r: Response
  try {
    const c = new AbortController(); const timer = setTimeout(() => c.abort(), 12000)
    r = await fetch('/api/v2', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: c.signal,
      body: JSON.stringify({ action, token: session.token, ...body }) }).finally(() => clearTimeout(timer))
  } catch { throw new ApiError('offline', '연결 안 됨', true) }
  if (r.status === 401) throw new ApiError('gate', '사이트 입장 비밀번호가 필요해요')   // middleware.js 쿠키 없음/만료
  if (r.status >= 500) throw new ApiError('server', '서버 오류 (' + r.status + ')', true)
  const j = await r.json().catch(() => ({ ok: false, error: 'bad_json' }))
  if (!j.ok) {
    if (j.error === 'auth') session.clear()
    throw new ApiError(j.error || 'error', j.error)
  }
  return j as T
}

const toList = <T,>(o: Record<string, Omit<T, 'id'>> | undefined) =>
  Object.entries(o || {}).map(([id, d]) => ({ id, ...d }) as T).sort((a, b) => ((a as { order?: number }).order || 0) - ((b as { order?: number }).order || 0))

/* 여행 내용: 저장해 둔 것 먼저, 서버에 버전을 보내 바뀐 게 없으면 그대로 */
export const contentKey = (tripId: string) => 'v2_content_' + tripId
export async function fetchContent(tripId: string): Promise<Content> {
  const prev = store.get<Content>(contentKey(tripId))
  type Raw = { unchanged?: boolean; v: string; me: number | null; trip: Trip; plan: Record<string, Omit<PlanItem, 'id'>>; food: Record<string, Omit<Food, 'id'>>; places: Record<string, Omit<Place, 'id'>> }
  const j = await api<Raw>('content', { tripId, v: prev?.v })
  if (j.unchanged && prev) { const next = { ...prev, at: Date.now() }; store.set(contentKey(tripId), next); return next }
  const next: Content = { v: j.v, me: j.me, trip: j.trip, plan: toList<PlanItem>(j.plan), food: toList<Food>(j.food), places: toList<Place>(j.places), at: Date.now() }
  store.set(contentKey(tripId), next)
  return next
}
