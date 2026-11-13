import { createFreebuffAuth } from '@freebuff/auth'
import type { FreebuffAuth, FreebuffUser } from '@freebuff/auth'

export type Env = {
  ASSETS: Fetcher
  DB?: D1Database
  /** Client asset drive. Object keys are namespaced per client and project. */
  FILES?: R2Bucket
  FREEBUFF_CLIENT_ID?: string
  FREEBUFF_ISSUER?: string
  APP_ORIGIN?: string
  /** Transactional email (Resend). */
  RESEND_API_KEY?: string
  AGENCY_EMAIL?: string
  /** WhatsApp delivery (Twilio). Numbers in E.164 form, e.g. +14155550100. */
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  TWILIO_WHATSAPP_FROM?: string
  AGENCY_WHATSAPP?: string
  /** Development only: allows the Cloud dev-preview hostname to use the
   *  local preview identity. Never set on a published deployment. */
  LOCAL_PREVIEW?: string
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
const DEV_PREVIEW_HOST = /^pv-[a-z0-9-]+\.style\.dev$/i

export function isLocalPreview(request: Request, env: Env): boolean {
  if (env.FREEBUFF_CLIENT_ID || env.APP_ORIGIN) return false
  const host = new URL(request.url).hostname
  if (LOOPBACK.has(host)) return true
  // The Cloud dev preview reaches this machine through a *.style.dev proxy.
  // This only applies to the local flag; a deployment with sign-in configured
  // never reaches this branch.
  return env.LOCAL_PREVIEW === 'true' && DEV_PREVIEW_HOST.test(host)
}

let cached: { key: string; auth: FreebuffAuth } | undefined

export function getAuth(env: Env): FreebuffAuth | null {
  if (!env.FREEBUFF_CLIENT_ID || !env.APP_ORIGIN) return null
  // The canonical origin comes from Sites, never from a request Host header.
  const origin = new URL(env.APP_ORIGIN)
  const key = JSON.stringify([
    env.FREEBUFF_CLIENT_ID,
    env.FREEBUFF_ISSUER,
    env.APP_ORIGIN,
  ])
  if (cached?.key !== key) {
    cached = {
      key,
      auth: createFreebuffAuth({
        clientId: env.FREEBUFF_CLIENT_ID,
        issuer: env.FREEBUFF_ISSUER || undefined,
        baseUrl: env.APP_ORIGIN,
        allowInsecureLocalhost:
          origin.protocol === 'http:' && LOOPBACK.has(origin.hostname),
      }),
    }
  }
  return cached.auth
}

export async function currentUser(
  request: Request,
  env: Env,
): Promise<FreebuffUser | null> {
  const auth = getAuth(env)
  if (auth) return auth.getUser(request)
  // A single preview identity keeps first run usable without provisioning.
  // This fallback never applies on a hosted origin or to incomplete auth config.
  return isLocalPreview(request, env)
    ? { sub: 'local-preview', name: 'Local preview' }
    : null
}

export function appOrigin(request: Request, env: Env): string | null {
  return (
    env.APP_ORIGIN ||
    (isLocalPreview(request, env) ? new URL(request.url).origin : null)
  )
}
