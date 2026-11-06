import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { DItem, Link, Route } from '../api'
import { Img, pickImages } from '../images'

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return <div className="fld"><label className="label">{label}</label>{children}{hint && <div className="hint">{hint}</div>}</div>
}
export function Text({ value, onChange, placeholder, autoFocus, inputMode }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; inputMode?: 'url' | 'text' }) {
  return <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} inputMode={inputMode} autoCapitalize={inputMode === 'url' ? 'off' : undefined} />
}
/* 내용에 맞춰 늘어나는 입력칸 */
export function Area({ value, onChange, placeholder, min = 44 }: { value: string; onChange: (v: string) => void; placeholder?: string; min?: number }) {
  const r = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => { const t = r.current; if (t) { t.style.height = 'auto'; t.style.height = Math.max(min, t.scrollHeight + 2) + 'px' } }, [value, min])
  return <textarea ref={r} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2} />
}
/* 고르기 칩 (다시 누르면 해제). free 가 있으면 직접 입력칸도 */
export function Chips({ options, value, onChange, free, labels }: { options: string[]; value: string; onChange: (v: string) => void; free?: string; labels?: Record<string, string> }) {
  return <>
    <div className="chips wrap tight">
      {options.map(o => <button type="button" key={o} className="chip sm" aria-pressed={o === value} onClick={() => onChange(o === value ? '' : o)}>{labels?.[o] || o}</button>)}
    </div>
    {free !== undefined && <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={free} />}
  </>
}
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="toggle"><span>{label}</span><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} /></label>
}

const fixUrl = (u: string) => { u = u.trim(); return u && !/^https?:\/\//i.test(u) ? 'https://' + u : u }
export const cleanLinks = (ls: Link[]) => ls.map(x => ({ l: x.l.trim(), u: fixUrl(x.u) })).filter(x => x.u)

export function LinksEditor({ value, onChange, small }: { value: Link[]; onChange: (v: Link[]) => void; small?: boolean }) {
  const set = (i: number, k: 'l' | 'u', v: string) => onChange(value.map((x, j) => j === i ? { ...x, [k]: v } : x))
  return <div className="links-ed">
    {value.map((x, i) => (
      <div className="link-row" key={i}>
        <input type="text" placeholder="이름 (예: 예약 페이지)" value={x.l} maxLength={40} onChange={e => set(i, 'l', e.target.value)} />
        <input type="text" inputMode="url" autoCapitalize="off" placeholder="https://…" value={x.u} onChange={e => set(i, 'u', e.target.value)} />
        <button type="button" className="x" aria-label="링크 삭제" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
      </div>
    ))}
    <button type="button" className={'addlink' + (small ? ' sm' : '')} onClick={() => onChange([...value, { l: '', u: '' }])}>+ 링크 추가</button>
  </div>
}

/* 자세히 내용: 기존 d 배열(문단 문자열 / {k} 소제목 / {l,u} 링크)을 블록(소제목 + 내용 + 링크들)으로 묶어 편집 */
export type Block = { k: string; text: string; links: Link[] }
export function toBlocks(d: DItem[] = []): Block[] {
  const out: Block[] = []; let cur: Block | null = null
  const open = () => { cur = { k: '', text: '', links: [] }; out.push(cur); return cur }
  for (const x of d) {
    if (typeof x === 'string') { const b = cur || open(); b.text = b.text ? b.text + '\n\n' + x : x }
    else if (x && x.k) { open().k = x.k }
    else if (x && x.u) { (cur || open()).links.push({ l: x.l || '', u: x.u }) }
  }
  return out
}
export function fromBlocks(bs: Block[]): DItem[] {
  const out: DItem[] = []
  for (const b of bs) {
    const k = b.k.trim(); const paras = b.text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean); const links = cleanLinks(b.links)
    if (!k && !paras.length && !links.length) continue
    if (k) out.push({ k }); out.push(...paras); out.push(...links.map(l => ({ l: l.l || l.u.replace(/^https?:\/\//, ''), u: l.u })))
  }
  return out
}
export function BlocksEditor({ value, onChange }: { value: Block[]; onChange: (v: Block[]) => void }) {
  const set = (i: number, b: Partial<Block>) => onChange(value.map((x, j) => j === i ? { ...x, ...b } : x))
  return <div className="rows">
    {value.map((b, i) => (
      <div className="row-card" key={i}>
        <div className="row-h"><span>내용</span><button type="button" className="x" aria-label="내용 삭제" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></div>
        <input type="text" placeholder="소제목 (선택)" value={b.k} maxLength={60} onChange={e => set(i, { k: e.target.value })} />
        <Area value={b.text} onChange={v => set(i, { text: v })} placeholder="내용 (문단은 빈 줄로 구분)" />
        <LinksEditor small value={b.links} onChange={v => set(i, { links: v })} />
      </div>
    ))}
    <button type="button" className="addlink" onClick={() => onChange([...value, { k: '', text: '', links: [] }])}>+ 내용 추가</button>
  </div>
}

const MODES: [string, string][] = [['transit', '🚃 전철·버스'], ['walking', '🚶 도보'], ['driving', '🚕 택시']]
export const cleanRoutes = (rs: Route[]) => rs.map(r => {
  const f = r.f.trim(), t = r.t.trim(), how = (r.how || '').trim()
  if (!f && !t && !how) return null
  const o: Route = { f, t, how, fq: (r.fq || '').trim() || f, tq: (r.tq || '').trim() || t, mode: r.mode || 'transit' }
  if ((r.price || '').trim()) o.price = r.price!.trim()
  if ((r.url || '').trim()) o.url = fixUrl(r.url!)
  return o
}).filter((x): x is Route => !!x)
export function RoutesEditor({ value, onChange }: { value: Route[]; onChange: (v: Route[]) => void }) {
  const set = (i: number, r: Partial<Route>) => onChange(value.map((x, j) => j === i ? { ...x, ...r } : x))
  return <div className="rows">
    {value.map((r, i) => (
      <div className="row-card" key={i}>
        <div className="row-h"><span>이동 경로</span><button type="button" className="x" aria-label="경로 삭제" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></div>
        <div className="row2"><input placeholder="출발 (예: 이케부쿠로역)" value={r.f} onChange={e => set(i, { f: e.target.value })} /><input placeholder="도착" value={r.t} onChange={e => set(i, { t: e.target.value })} /></div>
        <Area value={r.how || ''} onChange={v => set(i, { how: v })} placeholder="설명 (예: 세이부선 약 20분 + 도보 2분)" />
        <div className="row2"><input placeholder="가격 (예: 1,400엔)" value={r.price || ''} onChange={e => set(i, { price: e.target.value })} /><input inputMode="url" autoCapitalize="off" placeholder="구글맵 링크 (선택)" value={r.url || ''} onChange={e => set(i, { url: e.target.value })} /></div>
        <div className="row2"><input placeholder="출발 검색어 (비우면 출발)" value={r.fq === r.f ? '' : r.fq || ''} onChange={e => set(i, { fq: e.target.value })} /><input placeholder="도착 검색어 (비우면 도착)" value={r.tq === r.t ? '' : r.tq || ''} onChange={e => set(i, { tq: e.target.value })} /></div>
        <div className="chips wrap tight">{MODES.map(([m, l]) => <button type="button" key={m} className="chip sm" aria-pressed={(r.mode || 'transit') === m} onClick={() => set(i, { mode: m })}>{l}</button>)}</div>
      </div>
    ))}
    <button type="button" className="addlink" onClick={() => onChange([...value, { f: '', t: '', how: '', mode: 'transit' }])}>+ 이동 경로 추가</button>
  </div>
}

export function ImagesEditor({ tripId, value, onChange, max }: { tripId: string; value: string[]; onChange: (v: string[]) => void; max: number }) {
  return <div>
    <div className="thumbs">{value.map(id => (
      <button type="button" key={id} className="thumb" aria-label="사진 빼기" onClick={() => onChange(value.filter(x => x !== id))}><Img id={id} /><b>×</b></button>
    ))}</div>
    {value.length < max && <button type="button" className="addlink" onClick={async () => { const ids = await pickImages(tripId, max - value.length); if (ids.length) onChange([...value, ...ids]) }}>+ 사진 추가</button>}
  </div>
}
