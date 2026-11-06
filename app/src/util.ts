const W = ['일', '월', '화', '수', '목', '금', '토']
export const weekday = (d: string) => W[new Date(d + 'T00:00:00').getDay()]
export const md = (d: string) => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : ''
export function dateRange(a: string, b: string) {
  if (!a) return '날짜 미정'
  const y = a.slice(0, 4)
  return `${y}. ${md(a)} (${weekday(a)})` + (b && b !== a ? ` ~ ${md(b)} (${weekday(b)})` : '')
}
export function dday(start: string, end: string, today: string) {
  if (!start) return ''
  const days = Math.round((Date.parse(start) - Date.parse(today)) / 864e5)
  if (days > 0) return `D-${days}`
  if (end && today <= end) return '여행 중'
  return ''
}
export const mapUrl = (q: string) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q)
export const dirUrl = (f: string, t: string, mode = 'transit') =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(f)}&destination=${encodeURIComponent(t)}&travelmode=${mode}`

/* 기기 시간 기준 오늘 (toISOString 은 UTC 라 한국·일본 오전 9시 전엔 어제가 됨) */
export function todayLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
