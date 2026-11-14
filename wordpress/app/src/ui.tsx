import { useCallback, useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react'
import { boot } from './api'

/* ------------------------------------------------------------------ icons */

const paths: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
  upload: <><path d="M12 15V4m0 0-4.5 4.5M12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></>,
  chat: <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z" />,
  wallet: <><path d="M3.5 7.5h15A2.5 2.5 0 0 1 21 10v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" /><circle cx="16.5" cy="14" r="1.2" /></>,
  doc: <><path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" /></>,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></>,
  check: <path d="M5 12.5 10 17.5 19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  back: <path d="m15 5-7 7 7 7" />,
  send: <path d="M4 12 20 4l-6 16-3-7z" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>,
  video: <><rect x="3" y="5.5" width="13" height="13" rx="2" /><path d="m16 10.5 5-3v9l-5-3z" /></>,
  file: <><path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /></>,
  note: <><path d="M5 4h14v16H5z" /><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" /></>,
  sign: <><path d="M3 19c3-1 4-6 6-6s1 5 3 5 3-4 4-4 1 2 2 2 2-1 3-1" /><path d="M14 3l4 4-8 8H6v-4z" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  logout: <><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" /><path d="M10 16l4-4-4-4M14 12H4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 1 1 8 0v3.5" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  download: <><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  sparkle: <path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z" />,
}

export function Icon({ name, className }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? paths.file}
    </svg>
  )
}

export function BrandMark() {
  const b = boot.brand
  return (
    <span className="brandmark">
      {b.logoUrl ? (
        <img src={b.logoUrl} alt="" />
      ) : (
        <svg viewBox="12 14 77.5 72" aria-hidden="true">
          <path d="M12 14H51a17 17 0 0 1 0 34H12Z" fill="currentColor" />
          <path d="M12 54H55a16 16 0 0 1 0 32H12Z" fill="currentColor" />
          <circle cx="83" cy="51" r="6.5" fill="#F5B72E" />
        </svg>
      )}
      <span>{b.businessName}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ haptics & transitions */

export function haptic(pattern: number | number[] = 8) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* not supported */
  }
}

/** Runs a state change inside a View Transition where the browser supports it. */
export function transition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  // A transition can be skipped (tab hidden, window resized); the update still runs, so ignore that.
  const t = doc.startViewTransition(update) as { ready?: Promise<void>; finished?: Promise<void> }
  t.ready?.catch(() => {})
  t.finished?.catch(() => {})
}

/* ------------------------------------------------------------------ toasts */

type ToastItem = { id: number; title: string; body?: string; tone: 'ok' | 'bad'; leaving?: boolean }
let toastItems: ToastItem[] = []
const listeners = new Set<() => void>()
let seq = 0

export function toast(title: string, body?: string, tone: 'ok' | 'bad' = 'ok') {
  const id = ++seq
  toastItems = [...toastItems, { id, title, body, tone }].slice(-3)
  listeners.forEach((l) => l())
  haptic(tone === 'ok' ? 10 : [20, 40, 20])
  setTimeout(() => {
    toastItems = toastItems.map((t) => (t.id === id ? { ...t, leaving: true } : t))
    listeners.forEach((l) => l())
    setTimeout(() => {
      toastItems = toastItems.filter((t) => t.id !== id)
      listeners.forEach((l) => l())
    }, 300)
  }, 3200)
}

export function Toasts() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toastItems.map((t) => (
        <div key={t.id} className={`toast ${t.tone} ${t.leaving ? 'leaving' : ''}`}>
          <Icon name={t.tone === 'ok' ? 'check' : 'alert'} className="t-icon" />
          <div>
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ buttons */

export function Button({
  children,
  onClick,
  variant = '',
  busy = false,
  disabled,
  type = 'button',
  className = '',
  icon,
}: {
  children?: ReactNode
  onClick?: () => void | Promise<void>
  variant?: string
  busy?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  icon?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [running, setRunning] = useState(false)
  const handle = async (e: MouseEvent<HTMLButtonElement>) => {
    const el = ref.current
    if (el) {
      const rect = el.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height)
      const span = document.createElement('span')
      span.className = 'ripple'
      span.style.width = span.style.height = `${size}px`
      span.style.left = `${e.clientX - rect.left - size / 2}px`
      span.style.top = `${e.clientY - rect.top - size / 2}px`
      el.appendChild(span)
      setTimeout(() => span.remove(), 650)
    }
    haptic(6)
    if (!onClick) return
    const result = onClick()
    if (result instanceof Promise) {
      setRunning(true)
      try {
        await result
      } finally {
        setRunning(false)
      }
    }
  }
  const loading = busy || running
  return (
    <button ref={ref} type={type} className={`btn ${variant} ${className}`} onClick={handle} disabled={disabled || loading} aria-busy={loading}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ sheet */

export function Sheet({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const [closing, setClosing] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)
  const close = useCallback(() => {
    setClosing(true)
    setTimeout(onClose, 260)
  }, [onClose])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sheetRef.current?.querySelector<HTMLElement>('input, textarea, select, button.btn')?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [close])
  // Drag the grip down to dismiss.
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, dy: 0 }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !sheetRef.current) return
    drag.current.dy = Math.max(0, e.clientY - drag.current.y)
    sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`
    sheetRef.current.style.transition = 'none'
  }
  const onPointerUp = () => {
    if (!drag.current || !sheetRef.current) return
    const far = drag.current.dy > 120
    sheetRef.current.style.transition = 'transform .35s cubic-bezier(.34,1.4,.64,1)'
    sheetRef.current.style.transform = ''
    drag.current = null
    if (far) close()
  }
  return (
    <>
      <div className={`scrim ${closing ? 'closing' : ''}`} onClick={close} />
      <div ref={sheetRef} className={`sheet ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-grip" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
        <div className="sheet-head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          <h3>{title}</h3>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">
          {children}
          {footer && <div style={{ marginTop: 22 }}>{footer}</div>}
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ small pieces */

export function Ring({ value, size = 92, light = false }: { value: number; size?: number; light?: boolean }) {
  const r = 40
  const c = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(value))
    return () => cancelAnimationFrame(t)
  }, [value])
  return (
    <div className={`ring ${light ? 'on-light' : ''}`} style={{ ['--size' as string]: `${size}px` }} role="img" aria-label={`${value}% complete`}>
      <svg viewBox="0 0 100 100">
        <circle className="track" cx="50" cy="50" r={r} />
        <circle className="value" cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c - (c * shown) / 100} />
      </svg>
      <span className="label">
        <CountUp value={value} />%
      </span>
    </div>
  )
}

export function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(value)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1100)
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <>{n}</>
}

export function MiniRing({ value }: { value: number }) {
  const r = 14
  const c = 2 * Math.PI * r
  return (
    <svg className="mini-ring" viewBox="0 0 34 34">
      <circle className="track" cx="17" cy="17" r={r} />
      <circle className="value" cx="17" cy="17" r={r} strokeDasharray={c} strokeDashoffset={c - c * value} />
    </svg>
  )
}

export function Pill({ tone = '', children }: { tone?: string; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

export function Empty({ icon = 'sparkle', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  )
}

export function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="skeleton" style={{ height: 150, borderRadius: 14 }} />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 54, opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>
        {label}
        {children}
      </label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([v, label]) => (
        <button
          key={v}
          role="tab"
          aria-selected={v === value}
          className={v === value ? 'on' : ''}
          onClick={() => {
            haptic(4)
            transition(() => onChange(v))
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Signature pad with smoothed, pressure-weighted strokes. Calls onChange with a PNG data URL or ''. */
export function SignaturePad({ onChange }: { onChange: (png: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ratio = window.devicePixelRatio || 1
    el.width = el.offsetWidth * ratio
    el.height = el.offsetHeight * ratio
    const ctx = el.getContext('2d')
    if (ctx) {
      ctx.scale(ratio, ratio)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#0e1a1b'
    }
  }, [])
  const point = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const down = (e: React.PointerEvent) => {
    drawing.current = true
    last.current = point(e)
    canvas.current?.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const p = point(e)
    const mid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 }
    ctx.lineWidth = 1.6 + (e.pressure && e.pressure !== 0.5 ? e.pressure * 2.2 : 1.2)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (empty) setEmpty(false)
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    if (!empty && canvas.current) onChange(canvas.current.toDataURL('image/png'))
  }
  const clear = () => {
    const el = canvas.current
    el?.getContext('2d')?.clearRect(0, 0, el.width, el.height)
    setEmpty(true)
    onChange('')
  }
  return (
    <div>
      <div className="sigpad">
        <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Signature pad" />
        <div className="baseline" />
        {empty && <span className="placeholder">Sign here with your finger or mouse</span>}
      </div>
      {!empty && (
        <button className="link-btn" style={{ marginTop: 8, fontSize: '.85rem' }} onClick={clear}>
          Clear and sign again
        </button>
      )}
    </div>
  )
}

/** Toggles light and dark, remembering the choice. */
export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('pd-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    } catch {
      return 'light'
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#091f22' : '#f4f5f1')
  }, [theme])
  const toggle = () =>
    transition(() =>
      setTheme((t) => {
        const next = t === 'dark' ? 'light' : 'dark'
        try {
          localStorage.setItem('pd-theme', next)
        } catch {
          /* private mode */
        }
        return next
      }),
    )
  return [theme, toggle]
}

/** Adds the "scrolled" class to the top bar after a little scroll. */
export function useScrolled(): boolean {
  const [s, setS] = useState(false)
  useEffect(() => {
    const on = () => setS(window.scrollY > 6)
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return s
}
