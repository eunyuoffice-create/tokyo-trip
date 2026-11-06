// 여행 한 개의 일정·맛집·갈 곳: 저장된 것 먼저 그리고 → 서버에서 새로 받고 → 아직 못 보낸 내 수정(대기열)을 위에 얹음.
// 수정은 화면에 바로 반영(낙관적)하고 send() 로 보냄.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, cache, contentKey, fetchContent, type ColName, type Content } from './api'
import { onOutbox, pendingOps, send, type Op } from './outbox'

const byOrder = (a: { order?: number }, b: { order?: number }) => (a.order || 0) - (b.order || 0)

export function applyOps(c: Content, ops: Op[]): Content {
  const next: Content = { ...c, plan: c.plan.slice(), food: c.food.slice(), places: c.places.slice() }
  for (const op of ops) {
    if (op.col !== 'plan' && op.col !== 'food' && op.col !== 'places') continue
    const list = next[op.col] as { id: string; order?: number }[]
    const i = list.findIndex(x => x.id === op.id)
    if (op.op === 'delete') { if (i >= 0) list.splice(i, 1) }
    else if (op.op === 'update') { if (i >= 0) list[i] = { ...list[i], ...op.data } }
    else { const d = { id: op.id, ...op.data }; if (i >= 0) list[i] = d; else list.push(d) }
    list.sort(byOrder)
  }
  return next
}

export function useTrip(tripId: string) {
  const [c, setC] = useState<Content | null>(() => {
    const x = cache.get<Content>(contentKey(tripId)); return x ? applyOps(x, pendingOps(tripId)) : null
  })
  const [err, setErr] = useState<ApiError | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    try { const x = await fetchContent(tripId); if (alive.current) { setC(applyOps(x, pendingOps(tripId))); setErr(null) } }
    catch (e) { if (alive.current) setErr(e as ApiError) }
  }, [tripId])

  useEffect(() => {
    alive.current = true; load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('online', load); document.addEventListener('visibilitychange', onVis)
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)   // 다른 사람 수정 반영 (바뀐 게 없으면 내용 없이 답이 와서 가벼움)
    const off = onOutbox(() => { if (!pendingOps(tripId).length) load() })   // 대기열이 다 나가면 서버 내용으로 맞춤
    return () => { alive.current = false; window.removeEventListener('online', load); document.removeEventListener('visibilitychange', onVis); clearInterval(t); off() }
  }, [tripId, load])

  /** 화면에 바로 반영하고 서버로. 결과: 'sent' | 'queued'. 실패하면 서버 내용으로 되돌리고 throw */
  const write = useCallback(async (ops: Op[]) => {
    setC(prev => {
      if (!prev) return prev
      const next = applyOps(prev, ops)
      cache.set(contentKey(tripId), { ...next, v: '' })   // 버전을 비워서 다음엔 꼭 새로 받게
      return next
    })
    try { return await send(tripId, ops) }
    catch (e) { await load(); throw e }
  }, [tripId, load])

  return { c, err, load, write }
}

/** 보이는 항목들의 order 값들을 새 순서대로 다시 나눠 줌 (다른 날짜·그룹과의 상대 위치는 유지) */
export function reorderOps(col: ColName, items: { id: string; order?: number }[]): Op[] {
  const slots = items.map(x => x.order || 0).sort((a, b) => a - b)
  // 같은 order 가 겹치면 재배분이 안 되므로 그럴 땐 새로 1000 간격
  const uniq = new Set(slots).size === slots.length
  const base = slots[0] || 1000
  return items.flatMap((it, i) => {
    const o = uniq ? slots[i] : base + i * 1000
    return it.order === o ? [] : [{ op: 'update' as const, col, id: it.id, data: { order: o } }]
  })
}
export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
