import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/* 아래에서 올라오는 시트 (PC 는 가운데 모달). 바깥을 누르거나 Esc 로 닫힘 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  return createPortal(
    // 포털이어도 React 이벤트는 부모 컴포넌트로 올라가므로(카드 안에서 연 시트), 끌기 감지가 시트 안 누름을 받지 않게 막음
    <div className="sheet-ov" onMouseDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}
      onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-h"><h2>{title}</h2><button type="button" className="btn ghost sm" onClick={onClose}>닫기</button></div>
        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </div>, document.body)
}

/* 두 번 눌러야 실행 (삭제 등). 브라우저 확인창 대신 */
export function ArmButton({ label, armedLabel, onConfirm, className = 'btn danger' }: { label: string; armedLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false)
  const t = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  return <button type="button" className={className + (armed ? ' armed' : '')} onClick={() => {
    if (armed) { clearTimeout(t.current); onConfirm(); return }
    setArmed(true); t.current = window.setTimeout(() => setArmed(false), 3000)
  }}>{armed ? armedLabel : label}</button>
}

/* 토스트 */
const ToastCtx = createContext<(msg: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('')
  const t = useRef<number | undefined>(undefined)
  const show = useCallback((m: string) => { setMsg(m); clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(''), 2600) }, [])
  return <ToastCtx.Provider value={show}>{children}{msg && createPortal(<div className="toast" role="status">{msg}</div>, document.body)}</ToastCtx.Provider>
}
