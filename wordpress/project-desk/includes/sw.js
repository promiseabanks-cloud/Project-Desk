/* Project Desk service worker. Keeps the app shell and built files on the phone so the app opens
   instantly and still opens offline. API calls and private files are never cached. */
const VERSION = '__PD_VERSION__'
const CACHE = 'pd-' + VERSION
const OFFLINE =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>' +
  '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0B3B40;color:#F4F5F1;font:16px system-ui;text-align:center">' +
  '<div style="padding:24px"><h1 style="font-size:1.6rem;margin:0 0 8px">You are offline</h1><p style="opacity:.8;margin:0 0 20px">Your portal will open again as soon as you are back online.</p>' +
  '<button onclick="location.reload()" style="font:inherit;font-weight:600;padding:12px 22px;border:0;border-radius:4px;background:#F5B72E;color:#0E1A1B">Try again</button></div></body>'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pd-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isPrivate(url) {
  return url.pathname.includes('/wp-json/') || url.searchParams.has('rest_route') || url.pathname.includes('/wp-admin/') || url.pathname.includes('wp-login.php')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || isPrivate(url)) return

  // Pages carry the sign-in state, so they always come from the network and are never stored.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
    return
  }

  // Built app files have hashed names, so a cached copy is always right.
  if (url.pathname.includes('/project-desk/app/') || url.pathname.includes('/assets/fonts')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})
