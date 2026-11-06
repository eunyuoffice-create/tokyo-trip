// 사진: 기존 사이트와 같은 images 컬렉션(data URL). 올릴 때 1280px·WebP(안 되면 JPEG)·~400KB 로 줄임.
// 보여 줄 때는 action:'image' 로 받고, 브라우저 Cache Storage 에 넣어 두어 오프라인에서도 보이게.
import { useEffect, useState } from 'react'
import { api } from './api'
import { send } from './outbox'
import { newId } from './useTrip'

const mem = new Map<string, string>()
const CACHE = 'v2-images'
const ckey = (id: string) => '/__img/' + encodeURIComponent(id)

export async function imageSrc(id: string): Promise<string> {
  if (mem.has(id)) return mem.get(id)!
  try { const c = await caches.open(CACHE); const r = await c.match(ckey(id)); if (r) { const s = await r.text(); mem.set(id, s); return s } } catch { /* Cache Storage 없음 */ }
  const j = await api<{ data: string }>('image', { id })
  mem.set(id, j.data)
  try { const c = await caches.open(CACHE); await c.put(ckey(id), new Response(j.data)) } catch { /* */ }
  return j.data
}

export function Img({ id, className, onClick }: { id: string; className?: string; onClick?: (src: string) => void }) {
  const [src, setSrc] = useState(mem.get(id) || '')
  useEffect(() => { let ok = true; if (!src) imageSrc(id).then(s => ok && setSrc(s)).catch(() => {}); return () => { ok = false } }, [id, src])
  return src ? <img className={className} src={src} alt="" loading="lazy" onClick={onClick ? () => onClick(src) : undefined} /> : <span className={(className || '') + ' img-ph'} />
}

function resize(file: File, max = 1280): Promise<{ data: string; w: number; h: number }> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image()
    im.onload = () => {
      const r = Math.min(1, max / Math.max(im.width, im.height)); const w = Math.round(im.width * r), h = Math.round(im.height * r)
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d')!.drawImage(im, 0, 0, w, h)
      const enc = (type: string, q: number) => { const d = c.toDataURL(type, q); return d.startsWith('data:' + type) ? d : null }
      let q = 0.8; let d = enc('image/webp', q) || enc('image/jpeg', q)!; const type = d.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
      while (d.length > 420000 && q > 0.4) { q -= 0.12; d = enc(type, q)! }
      URL.revokeObjectURL(url); res({ data: d, w, h })
    }
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 열 수 없어요')) }
    im.src = url
  })
}

/** 사진 고르기 → 줄여서 저장(오프라인이면 대기열) → id 목록 */
export function pickImages(tripId: string, max: number): Promise<string[]> {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = max > 1; inp.style.display = 'none'
    document.body.appendChild(inp)
    inp.onchange = async () => {
      const files = [...(inp.files || [])].slice(0, max); inp.remove(); const ids: string[] = []
      for (const f of files) {
        try { const { data, w, h } = await resize(f); const id = 'im-' + newId(); mem.set(id, data); await send(tripId, [{ op: 'set', col: 'images', id, data: { data, w, h } }]); ids.push(id) }
        catch { /* 한 장 실패는 건너뜀 */ }
      }
      resolve(ids)
    }
    inp.click()
  })
}
