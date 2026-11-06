import { useState } from 'react'
import type { ColName, Food, Link, Place, PlanItem, Route } from '../api'
import type { Op } from '../outbox'
import { md, weekday } from '../util'
import { newId } from '../useTrip'
import { ArmButton, Sheet, useToast } from './Sheet'
import { Area, BlocksEditor, Chips, cleanLinks, cleanRoutes, Field, fromBlocks, ImagesEditor, LinksEditor, RoutesEditor, Text, toBlocks, Toggle, type Block } from './fields'

type Save = (ops: Op[], msg: string) => void
/* 빈 값은 저장하지 않음 (기존 사이트와 같은 문서 모양) */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (!(v === '' || v === null || v === undefined || v === false || (Array.isArray(v) && !v.length))) out[k] = v
  return out as Partial<T>
}
const nextOrder = (list: { order?: number }[]) => (list.length ? Math.max(...list.map(x => x.order || 0)) : 0) + 1000
const req = <span className="req" aria-label="필수">*</span>

function Footer({ isNew, onDelete }: { isNew: boolean; onDelete: () => void }) {
  return <div className="actions">
    {!isNew && <ArmButton label="삭제" armedLabel="한 번 더 누르면 삭제" onConfirm={onDelete} />}
    <button type="submit" form="ed-form" className="btn primary grow">{isNew ? '저장' : '수정 저장'}</button>
  </div>
}

/* ---------- 일정 ---------- */
export function PlanEditor({ tripId, item, days, defaultDay, plan, onSave, onClose }: {
  tripId: string; item: PlanItem | null; days: string[]; defaultDay: string; plan: PlanItem[]; onSave: Save; onClose: () => void
}) {
  const toast = useToast()
  const [f, setF] = useState(() => ({
    day: item?.day || defaultDay, t: item?.t || '', ts: item?.ts || '', title: item?.title || '', p: item?.p || '',
    pills: (item?.pills || []).join(', '), big: !!item?.big, images: item?.images || [], links: (item?.links || []) as Link[],
    blocks: toBlocks(item?.d) as Block[], routes: (item?.r ? (Array.isArray(item.r) ? item.r : [item.r]) : []) as Route[],
  }))
  const up = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  const allDays = [...new Set([...days, f.day].filter(Boolean))].sort()
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.title.trim()) { toast('제목을 넣어주세요'); return }
    const order = item && item.day === f.day ? item.order : nextOrder(plan.filter(x => x.day === f.day))
    const data = compact({ day: f.day, t: f.t.trim(), ts: f.ts.trim(), p: f.p.trim(), title: f.title.trim(),
      pills: f.pills.split(',').map(s => s.trim()).filter(Boolean), big: f.big, images: f.images, links: cleanLinks(f.links),
      d: fromBlocks(f.blocks), r: cleanRoutes(f.routes), order })
    onSave([{ op: 'set', col: 'plan', id: item?.id || newId(), data }], item ? '수정했어요' : '추가했어요')
  }
  return <Sheet title={item ? '일정 수정' : '일정 추가'} onClose={onClose} footer={<Footer isNew={!item} onDelete={() => onSave([{ op: 'delete', col: 'plan', id: item!.id }], '삭제했어요')} />}>
    <form id="ed-form" className="ed" onSubmit={submit} autoComplete="off">
      <Field label="날짜">
        <Chips options={allDays} value={f.day} onChange={v => v && up({ day: v })} labels={Object.fromEntries(allDays.map(d => [d, `${md(d)} ${weekday(d)}`]))} />
        <input type="date" value={f.day} onChange={e => e.target.value && up({ day: e.target.value })} />
      </Field>
      <div className="row2">
        <Field label="시간"><Text value={f.t} onChange={v => up({ t: v })} placeholder="10:30 / 점심 / 밤" /></Field>
        <Field label="보조 시간"><Text value={f.ts} onChange={v => up({ ts: v })} placeholder="~11:50" /></Field>
      </div>
      <Field label={<>제목 {req}</>}><Text value={f.title} onChange={v => up({ title: v })} placeholder="예: 해리포터 카페" autoFocus={!item} /></Field>
      <Field label="장소"><Text value={f.p} onChange={v => up({ p: v })} placeholder="예: 아카사카" /></Field>
      <Field label="태그 (쉼표로 구분)"><Text value={f.pills} onChange={v => up({ pills: v })} placeholder="예: 예약 완료, 필수" /></Field>
      <Toggle label="강조 (큰 카드)" value={f.big} onChange={v => up({ big: v })} />
      <Field label="사진 (최대 3장)"><ImagesEditor tripId={tripId} value={f.images} onChange={v => up({ images: v })} max={3} /></Field>
      <Field label="링크 버튼"><LinksEditor value={f.links} onChange={v => up({ links: v })} /></Field>
      <Field label="자세히 내용 (펼쳐서 보는 부분)"><BlocksEditor value={f.blocks} onChange={v => up({ blocks: v })} /></Field>
      <Field label="이동 경로 (구글맵 경로 버튼이 붙어요)"><RoutesEditor value={f.routes} onChange={v => up({ routes: v })} /></Field>
    </form>
  </Sheet>
}

/* ---------- 맛집 ---------- */
export function FoodEditor({ item, areas, food, defaultArea, onSave, onClose }: {
  item: Food | null; areas: string[]; food: Food[]; defaultArea: string; onSave: Save; onClose: () => void
}) {
  const toast = useToast()
  const [f, setF] = useState(() => ({
    n: item?.n || '', a: item?.a || defaultArea, t: item?.t || '', k: item?.k || '', pr: item?.pr || '', h: item?.h || '', closed: item?.closed || '',
    s: item?.s ? String(item.s) : '', note: item?.note || '', tag: item?.tag || '', q: item?.q || '',
    links: (item?.links?.length ? item.links : item?.link ? [{ l: '링크', u: item.link }] : []) as Link[],
  }))
  const up = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.n.trim()) { toast('가게 이름을 넣어주세요'); return }
    const data = compact({ n: f.n.trim(), a: f.a.trim() || '기타', t: f.t, k: f.k.trim(), pr: f.pr.trim(), h: f.h.trim(), closed: f.closed.trim(),
      s: f.s ? +f.s : undefined, note: f.note.trim(), tag: f.tag.trim(), q: f.q.trim(), links: cleanLinks(f.links), order: item ? item.order : nextOrder(food) })
    onSave([{ op: 'set', col: 'food', id: item?.id || newId(), data }], item ? '수정했어요' : '추가했어요')
  }
  return <Sheet title={item ? '맛집 수정' : '맛집 추가'} onClose={onClose} footer={<Footer isNew={!item} onDelete={() => onSave([{ op: 'delete', col: 'food', id: item!.id }], '삭제했어요')} />}>
    <form id="ed-form" className="ed" onSubmit={submit} autoComplete="off">
      <Field label={<>가게 이름 {req}</>}><Text value={f.n} onChange={v => up({ n: v })} placeholder="예: 규카츠 이로하" autoFocus={!item} /></Field>
      <Field label="지역"><Chips options={areas} value={f.a} onChange={v => up({ a: v })} free="직접 입력 (예: 신주쿠)" /></Field>
      <Field label="분류"><Chips options={['음식', '카페']} labels={{ 카페: '카페 · 간식' }} value={f.t} onChange={v => up({ t: v })} /></Field>
      <div className="row2">
        <Field label="종류"><Text value={f.k} onChange={v => up({ k: v })} placeholder="라멘, 타르트" /></Field>
        <Field label="가격대"><Text value={f.pr} onChange={v => up({ pr: v })} placeholder="1,000~2,000엔" /></Field>
      </div>
      <div className="row2">
        <Field label="영업시간"><Text value={f.h} onChange={v => up({ h: v })} placeholder="11:00~22:00" /></Field>
        <Field label="휴무일"><Text value={f.closed} onChange={v => up({ closed: v })} placeholder="수 휴무 / 무휴" /></Field>
      </div>
      <Field label="별점"><Chips options={['1', '2', '3', '4', '5']} labels={{ 1: '★', 2: '★★', 3: '★★★', 4: '★★★★', 5: '★★★★★' }} value={f.s} onChange={v => up({ s: v })} /></Field>
      <Field label="메모 (위치·팁)"><Area value={f.note} onChange={v => up({ note: v })} placeholder="예: 東口 도보 3분. 현금만" /></Field>
      <Field label="라벨 (이름 옆 작은 표시)"><Text value={f.tag} onChange={v => up({ tag: v })} placeholder="예: 트위터 추천" /></Field>
      <Field label="구글맵 검색어" hint="현지어로 넣으면 정확해요"><Text value={f.q} onChange={v => up({ q: v })} placeholder="예: 牛かつ いろは 池袋" /></Field>
      <Field label="링크 버튼"><LinksEditor value={f.links} onChange={v => up({ links: v })} /></Field>
    </form>
  </Sheet>
}

/* ---------- 갈 곳 ---------- */
export function PlaceEditor({ item, groups, areas, places, defaultGroup, onSave, onClose }: {
  item: Place | null; groups: string[]; areas: string[]; places: Place[]; defaultGroup: string; onSave: Save; onClose: () => void
}) {
  const toast = useToast()
  const [f, setF] = useState(() => ({
    n: item?.n || '', g: item?.g || defaultGroup, area: item?.area || '', k: item?.k || '', h: item?.h || '', res: item?.res || '',
    loc: item?.loc || '', tag: item?.tag || '', q: item?.q || '', u: !!item?.u,
    links: (item?.links?.length ? item.links : item?.link ? [{ l: '링크', u: item.link }] : []) as Link[],
  }))
  const up = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.n.trim()) { toast('이름을 넣어주세요'); return }
    const data = compact({ n: f.n.trim(), g: f.g.trim() || '그 외', area: f.area.trim() || f.g.trim(), k: f.k.trim(), h: f.h.trim(), res: f.res.trim(),
      loc: f.loc.trim(), tag: f.tag.trim(), q: f.q.trim(), u: f.u, links: cleanLinks(f.links), order: item ? item.order : nextOrder(places) })
    onSave([{ op: 'set', col: 'places', id: item?.id || newId(), data }], item ? '수정했어요' : '추가했어요')
  }
  return <Sheet title={item ? '장소 수정' : '장소 추가'} onClose={onClose} footer={<Footer isNew={!item} onDelete={() => onSave([{ op: 'delete', col: 'places', id: item!.id }], '삭제했어요')} />}>
    <form id="ed-form" className="ed" onSubmit={submit} autoComplete="off">
      <Field label={<>이름 {req}</>}><Text value={f.n} onChange={v => up({ n: v })} placeholder="예: 치이카와 파크" autoFocus={!item} /></Field>
      <Field label="그룹"><Chips options={groups} value={f.g} onChange={v => up({ g: v })} free="직접 입력 (새 그룹)" /></Field>
      <Field label="지역"><Chips options={areas} value={f.area} onChange={v => up({ area: v })} free="직접 입력" /></Field>
      <Field label="종류·한 줄 설명"><Text value={f.k} onChange={v => up({ k: v })} placeholder="예: 전시 + 쇼핑" /></Field>
      <Field label="영업시간"><Text value={f.h} onChange={v => up({ h: v })} placeholder="예: 10:00~19:00 · 무휴" /></Field>
      <Field label="예약"><Text value={f.res} onChange={v => up({ res: v })} placeholder="예: 예약 완료 / 선착 예매 필수" /></Field>
      <Field label="설명 (위치·팁)"><Area value={f.loc} onChange={v => up({ loc: v })} min={88} /></Field>
      <Field label="라벨 (이름 옆 작은 표시)"><Text value={f.tag} onChange={v => up({ tag: v })} placeholder="예: 트위터 추천" /></Field>
      <Field label="구글맵 검색어"><Text value={f.q} onChange={v => up({ q: v })} placeholder="예: ちいかわパーク サンシャインシティ" /></Field>
      <Field label="링크 버튼"><LinksEditor value={f.links} onChange={v => up({ links: v })} /></Field>
      <Toggle label="영업 확인 필요 표시" value={f.u} onChange={v => up({ u: v })} />
    </form>
  </Sheet>
}

export type EditTarget = { col: ColName; id: string | null } | null
