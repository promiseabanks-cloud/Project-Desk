import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, boot, type Boot } from './api'
import { go, type Route } from './router'
import { BrandMark, Button, Field, Icon, toast } from './ui'

type Done = (session: Boot) => void

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
        }
      }
    }
  }
}

function AuthFrame({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-art">
        <BrandMark />
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      <div className="auth-card">{children}</div>
    </div>
  )
}

function GoogleButton({ onDone }: { onDone: Done }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = boot.brand.googleClientId
  useEffect(() => {
    if (!id || !ref.current) return
    const render = () => {
      window.google?.accounts.id.initialize({
        client_id: id,
        callback: async ({ credential }) => {
          try {
            onDone(await api<Boot>('/auth/google', { body: { credential } }))
          } catch (e) {
            toast('Google sign-in failed', (e as Error).message, 'bad')
          }
        },
      })
      if (ref.current) window.google?.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: ref.current.offsetWidth, text: 'continue_with', shape: 'rectangular' })
    }
    if (window.google) return render()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = render
    document.head.appendChild(s)
  }, [id, onDone])
  if (!id) return null
  return (
    <>
      <div className="divider">or</div>
      <div ref={ref} style={{ minHeight: 44 }} />
    </>
  )
}

export function SignIn({ onDone }: { onDone: Done }) {
  const [mode, setMode] = useState<'password' | 'link' | 'sent'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'password') onDone(await api<Boot>('/auth/login', { body: { email, password } }))
      else {
        await api('/auth/magic-link', { body: { email } })
        setMode('sent')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthFrame title="Your projects, in one place." lead={`Follow progress, share files, sign agreements and talk to the ${boot.brand.businessName} team.`}>
      {mode === 'sent' ? (
        <div className="screen" style={{ display: 'grid', gap: 14 }}>
          <span className="icon-tile ok" style={{ width: 54, height: 54 }}>
            <Icon name="mail" />
          </span>
          <h2>Check your email</h2>
          <p className="muted">If {email} has portal access, a sign-in link is on its way. It works once and expires in 15 minutes.</p>
          <button className="link-btn" onClick={() => setMode('password')}>
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="screen">
          <h2 style={{ marginBottom: 22 }}>Sign in</h2>
          {error && <div className="form-error">{error}</div>}
          <Field label="Email">
            <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {mode === 'password' && (
            <Field label="Password">
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <Button type="submit" variant="block" busy={busy}>
            {mode === 'password' ? 'Sign in' : 'Email me a sign-in link'}
          </Button>
          <p style={{ marginTop: 16, fontSize: '.9rem' }} className="muted">
            {mode === 'password' ? (
              <>
                No password, or forgot it?{' '}
                <button type="button" className="link-btn" onClick={() => setMode('link')}>
                  Email me a link
                </button>
              </>
            ) : (
              <button type="button" className="link-btn" onClick={() => setMode('password')}>
                Use my password instead
              </button>
            )}
          </p>
          <GoogleButton onDone={onDone} />
        </form>
      )}
    </AuthFrame>
  )
}

export function AcceptInvite({ route, onDone }: { route: Route; onDone: Done }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const strength = Math.min(4, [password.length >= 10, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password), /[^\w]/.test(password) || password.length >= 16].filter(Boolean).length)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const session = await api<Boot>('/auth/accept-invite', { body: { u: route.query.get('u'), k: route.query.get('k'), password } })
      toast('Welcome aboard', 'Your password is set.')
      go('', true)
      onDone(session)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthFrame title="Welcome. Let's set you up." lead="Choose a password for your portal. Next time you can also sign in with an email link.">
      <form onSubmit={submit} className="screen">
        <h2 style={{ marginBottom: 22 }}>Set your password</h2>
        {error && <div className="form-error">{error}</div>}
        <Field label="New password" hint="At least 10 characters.">
          <input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="bar" style={{ marginTop: -10, marginBottom: 22 }} aria-hidden="true">
          <i key={strength} style={{ width: `${strength * 25}%`, background: strength < 2 ? 'var(--bad)' : strength < 3 ? 'var(--signal)' : 'var(--accent)', transition: 'width .4s' }} />
        </div>
        <Button type="submit" variant="block" busy={busy}>
          Open my portal
        </Button>
      </form>
    </AuthFrame>
  )
}

export function MagicLink({ route, onDone }: { route: Route; onDone: Done }) {
  const [error, setError] = useState('')
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    api<Boot>('/auth/magic', { body: { u: route.query.get('u'), t: route.query.get('t') } })
      .then((session) => {
        go('', true)
        onDone(session)
      })
      .catch((e: Error) => setError(e.message))
  }, [route, onDone])
  return (
    <AuthFrame title="Signing you in." lead="One moment while we open your portal.">
      {error ? (
        <div className="screen" style={{ display: 'grid', gap: 14 }}>
          <div className="form-error">{error}</div>
          <Button onClick={() => go('', true)}>Back to sign in</Button>
        </div>
      ) : (
        <div className="empty">
          <span className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      )}
    </AuthFrame>
  )
}
