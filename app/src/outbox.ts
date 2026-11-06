// 쓰기: 바로 보내고, 인터넷이 없거나 서버가 잠깐 안 되면(5xx) 휴대폰에 쌓아 두었다가 다시 연결되면 순서대로 보냄.
// 4xx(권한·잘못된 요청)는 다시 보내도 안 되므로 버림. (기존 사이트 tl_outbox 와 같은 방식)
import { api, ApiError, cache, session } from './api'

export type Op = { op: 'set' | 'update' | 'delete'; col: string; id: string; data?: Record<string, unknown> }
type Job = { tripId: string; ops: Op[]; at: number }

const key = () => 'v2_outbox_' + (session.user?.id || 'x')
const read = () => cache.get<Job[]>(key()) || []
const write = (jobs: Job[]) => cache.set(key(), jobs)
/** 대기열에 추가. 휴대폰 저장 공간이 모자라면 throw (그냥 두면 '연결되면 저장'이라 해 놓고 잃어버림) */
function enqueue(job: Job) { if (!write([...read(), job])) throw new ApiError('storage', '휴대폰 저장 공간이 모자라 저장하지 못했어요'); emit() }
// 잠깐 막힌 것(연결·서버·사이트 비밀번호·로그인 만료)은 남겨 두고, 그 밖의 4xx(권한·잘못된 요청)만 버림
const retryable = (e: ApiError) => e.offline || e.code === 'gate' || e.code === 'auth'
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(f => f())
export const onOutbox = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }
export const pendingOps = (tripId: string) => read().filter(j => j.tripId === tripId).flatMap(j => j.ops)
export const pendingCount = () => read().reduce((n, j) => n + j.ops.length, 0)

/** 'sent' = 서버 저장됨, 'queued' = 연결되면 보냄. 그 밖의 오류는 throw */
export async function send(tripId: string, ops: Op[]): Promise<'sent' | 'queued'> {
  if (read().length) { enqueue({ tripId, ops, at: Date.now() }); flush(); return 'queued' }   // 앞에 밀린 게 있으면 순서 지키기
  try { for (let i = 0; i < ops.length; i += 40) await api('write', { tripId, ops: ops.slice(i, i + 40) }); return 'sent' }
  catch (e) {
    if ((e as ApiError).offline) { enqueue({ tripId, ops, at: Date.now() }); return 'queued' }
    throw e
  }
}

let flushing = false
export async function flush() {
  if (flushing) return; flushing = true
  try {
    for (;;) {
      const jobs = read(); if (!jobs.length) break
      const j = jobs[0]
      try { await api('write', { tripId: j.tripId, ops: j.ops }) }
      catch (e) { if (retryable(e as ApiError)) break /* 나중에 다시 */ }
      write(read().slice(1)); emit()
    }
  } finally { flushing = false }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flush() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush() })
  setInterval(() => { if (read().length) flush() }, 30000)
}
