// Web Push: turning on phone notifications for the PWA.
// Works in Android browsers and installed PWAs; on iOS only once the app is added to the Home Screen (16.4+).

import { api, boot } from './api'

export type PushState = 'unsupported' | 'ios-needs-install' | 'default' | 'granted' | 'denied'

/** The browser can receive Web Push at all. */
export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** Running as an installed app (Home Screen / standalone), not a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag on navigator.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)
}

/** Where the "turn on notifications" prompt stands for this device. */
export function pushState(): PushState {
  if (!pushSupported()) {
    // On iOS the APIs only appear once installed, so an un-installed iPhone looks "unsupported".
    if (isIOS() && !isStandalone()) return 'ios-needs-install'
    return 'unsupported'
  }
  return Notification.permission as PushState
}

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return buffer
}

async function ready(): Promise<ServiceWorkerRegistration> {
  // app.php registers the worker; wait for it to take control.
  return navigator.serviceWorker.ready
}

/**
 * Asks for permission and subscribes this device. Returns the resulting state.
 * Throws only on an unexpected failure the caller should surface.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return pushState()
  const key = boot.pushKey
  if (!key) return 'unsupported'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission as PushState

  const reg = await ready()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })
  }
  const json = sub.toJSON()
  await api('/push/subscribe', {
    body: { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } },
  })
  return 'granted'
}

/** Removes this device's subscription (both on the phone and on the server). */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const reg = await ready()
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => {})
    await api('/push/unsubscribe', { body: { endpoint } }).catch(() => {})
  }
}

/** True when this device already has a live subscription. */
export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  try {
    const reg = await ready()
    return !!(await reg.pushManager.getSubscription())
  } catch {
    return false
  }
}
