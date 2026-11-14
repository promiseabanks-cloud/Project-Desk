import { useEffect, useState } from 'react'
import { transition } from './ui'

/** Hash routes like #/projects/12?tab=files. Hash routing keeps tokens out of server logs and works on any host. */
export type Route = { path: string[]; query: URLSearchParams }

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [p, q] = raw.split('?')
  return { path: (p || '').split('/').filter(Boolean), query: new URLSearchParams(q || '') }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => transition(() => setRoute(parse()))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function go(path: string, replace = false) {
  const hash = '#/' + path.replace(/^\/+/, '')
  if (replace) {
    history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = hash
  }
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
}
