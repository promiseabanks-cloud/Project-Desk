import { StrictMode, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, boot, setNonce, type Boot } from './api'
import { AcceptInvite, MagicLink, SignIn } from './auth'
import { ClientApp } from './client'
import { go, useRoute } from './router'
import { StaffApp } from './staff'
import { Toasts, toast, useTheme } from './ui'
import './style.css'

function App() {
  const route = useRoute()
  useTheme()
  const [session, setSession] = useState<Boot>(boot)
  const signedIn = useCallback((next: Boot) => {
    // Other modules read the shared boot object (brand, permissions), so update it in place.
    Object.assign(boot, next)
    if (next.nonce) setNonce(next.nonce)
    setSession({ ...boot })
  }, [])
  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { body: {} })
    } catch {
      /* the reload below shows the sign-in screen either way */
    }
    go('', true)
    window.location.reload()
  }, [])

  const [first] = route.path
  if (first === 'invite') return <AcceptInvite route={route} onDone={signedIn} />
  if (first === 'magic') return <MagicLink route={route} onDone={signedIn} />
  if (!session.user) return <SignIn onDone={signedIn} />
  if (session.role === 'owner' || session.role === 'manager') return <StaffApp key={session.user.id} route={route} onSignOut={signOut} />
  return <ClientApp key={session.user.id} route={route} onSignOut={signOut} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toasts />
  </StrictMode>,
)

if ('serviceWorker' in navigator && boot.base && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(boot.base + 'sw.js', { scope: boot.base }).catch(() => {})
  })
}

window.addEventListener('offline', () => toast('You are offline', 'Changes will wait until you are back online.', 'bad'))
