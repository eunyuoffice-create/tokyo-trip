import type { ApiError } from './api'

/* 연결 상태 한 줄: 서버에 못 닿으면 저장해 둔 내용을 보여 주고 있다고 알림 */
export function SyncLine({ err, at }: { err: ApiError | null; at?: number }) {
  if (!err) return null
  const when = at ? new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  return <div className={'sync' + (err.offline ? '' : ' bad')}>
    {err.code === 'offline' ? `연결 안 됨 · 저장된 내용${when ? ` (${when})` : ''}` : `${err.message}${err.offline && when ? ` · 저장된 내용 (${when})` : ''}`}
  </div>
}
