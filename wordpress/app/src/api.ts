// Types and API client for the Project Desk WordPress plugin.

export type Role = 'owner' | 'manager' | 'client'

export type Brand = {
  businessName: string
  brandColor: string
  logoUrl: string
  currency: string
  googleClientId: string
  maxUploadMb: number
  categories: string[]
  depositPercent?: number
  services: Record<string, { label: string; recurring: boolean }>
}

export type Boot = {
  api: string
  base?: string
  brand: Brand
  nonce: string
  user: { id: number; name: string; email: string } | null
  role: Role | null
  can?: { money: boolean; settings: boolean; staff: boolean; override: boolean }
  setupNeeded?: boolean
}

export type Phase = {
  id: number
  name: string
  position: number
  stage: 'opening' | 'work'
  signoff: boolean
  billPercent: number
  status: 'queued' | 'ongoing' | 'completed'
  note: string
  approvedAt: string | null
  approvalNote: string
  startedAt: string | null
  completedAt: string | null
}

export type Asset = {
  id: number
  projectId: number
  category: string
  name: string
  kind: string
  size: number
  mime: string
  hasFile: boolean
  body: string | null
  status: 'pending' | 'accepted' | 'changes_requested'
  reviewNote: string
  versionOf: number | null
  uploadedBy: string
  fromStaff: boolean
  createdAt: string
  reviewedAt: string | null
}

export type Payment = {
  id: number
  label: string
  kind: string
  amount: number
  amountPaid: number
  currency: string
  dueDate: string | null
  status: 'due' | 'paid' | 'overdue' | 'cancelled'
  paidAt: string | null
  method: string
  externalUrl: string
  proofAt: string | null
  proofAssetId: number | null
  proofNote: string
  phaseId: number | null
}

export type Message = { id: number; authorRole: 'staff' | 'client'; authorName: string; body: string; createdAt: string }
export type Review = { id: number; milestone: string; rating: number; body: string; authorName: string; createdAt: string }

export type Project = {
  id: number
  clientId: number
  name: string
  service: string
  serviceLabel: string
  summary: string
  status: 'active' | 'on_hold' | 'completed' | 'cancelled'
  recurring: boolean
  startDate: string | null
  dueDate: string | null
  progress: number
  workUnlocked: boolean
  price: number
  depositPercent: number
  phases: Phase[]
  assets: Asset[]
  payments: Payment[]
  messages: Message[]
  reviews: Review[]
}

export type Doc = {
  id: number
  clientId: number
  projectId: number | null
  title: string
  kind: string
  body: string
  bodyHash: string
  status: 'awaiting_signature' | 'signed'
  signatureName: string | null
  signedAt: string | null
  createdAt: string
  signatureImage?: string
  signerIp?: string
}

export type Client = {
  id: number
  company: string
  contactName: string
  email: string
  phone: string
  website: string
  industry: string
  status: 'onboarding' | 'active' | 'paused' | 'archived'
  notes: string
  hasAccount: boolean
  createdAt: string
}

export type Notice = { id: number; projectId: number | null; title: string; body: string; createdAt: string; read: boolean }

export type ServiceDef = { label: string; recurring: boolean; phases: { name: string; signoff: boolean }[] }

export type PortalData = { preview: boolean; client: Client; projects: Project[]; documents: Doc[]; notifications: Notice[] }
export type ConsoleData = {
  clients: Client[]
  projects: Project[]
  documents: Doc[]
  notifications: Notice[]
  services: Record<string, ServiceDef>
}

declare global {
  interface Window {
    PD_BOOT?: Boot
  }
}

const fallbackBoot: Boot = {
  api: '/wp-json/project-desk/v1',
  brand: {
    businessName: 'Banks Solution',
    brandColor: '#0B3B40',
    logoUrl: '',
    currency: 'NGN',
    googleClientId: '',
    maxUploadMb: 2048,
    categories: ['brief', 'brand', 'copy', 'images', 'video', 'references', 'data', 'notes'],
    services: {},
  },
  nonce: '',
  user: null,
  role: null,
}

export const boot: Boot = window.PD_BOOT ?? fallbackBoot
let nonce = boot.nonce

export class ApiError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function setNonce(value: string) {
  nonce = value
}

/** Builds a URL that works with pretty permalinks (/wp-json/...) and without (?rest_route=...). */
export function apiUrl(path: string, query?: Record<string, string | number>): string {
  const base = boot.api
  const q = query ? new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : ''
  if (base.includes('rest_route=')) return base + path + (q ? '&' + q : '')
  return base + path + (q ? '?' + q : '')
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; raw?: BodyInit; query?: Record<string, string | number> } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  // Sign-in calls are made signed out; a nonce left from an ended session would only get them refused.
  const signIn = /^\/auth\/(login|magic-link|magic|google|accept-invite)$/.test(path)
  if (nonce && !signIn) headers['X-WP-Nonce'] = nonce
  let body: BodyInit | undefined
  if (options.raw !== undefined) {
    headers['Content-Type'] = 'application/octet-stream'
    body = options.raw
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  let response: Response
  try {
    response = await fetch(apiUrl(path, options.query), {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError('You seem to be offline. Check your connection and try again.', 0, 'offline')
  }
  const data = (await response.json().catch(() => null)) as (T & { message?: string; code?: string; nonce?: string }) | null
  if (!response.ok) {
    throw new ApiError(data?.message || 'That did not work. Please try again.', response.status, data?.code || 'error')
  }
  if (data && typeof data === 'object' && 'nonce' in data && typeof data.nonce === 'string' && data.nonce) setNonce(data.nonce)
  return data as T
}

export const fileUrl = (assetId: number) => apiUrl(`/files/${assetId}`, nonce ? { _wpnonce: nonce } : undefined)

/** Resumable upload in pieces. Calls onProgress with 0..1. Retries a failed piece up to 4 times. */
export async function uploadFile(
  projectId: number,
  file: File,
  category: string,
  onProgress: (fraction: number) => void,
  replaces?: number,
): Promise<number> {
  const start = await api<{ uploadId: string; chunkBytes: number }>(`/projects/${projectId}/uploads`, {
    body: { name: file.name, size: file.size, category, replaces },
  })
  let offset = 0
  while (offset < file.size) {
    const piece = file.slice(offset, offset + start.chunkBytes)
    let attempt = 0
    for (;;) {
      try {
        const res = await api<{ received: number }>(`/uploads/${start.uploadId}`, {
          method: 'PUT',
          raw: piece,
          query: { offset },
        })
        offset = res.received
        break
      } catch (error) {
        if (error instanceof ApiError && error.code === 'pd_offset') {
          const status = await api<{ received: number }>(`/uploads/${start.uploadId}`)
          offset = status.received
          break
        }
        if (++attempt > 4) throw error
        await new Promise((r) => setTimeout(r, 600 * attempt))
      }
    }
    onProgress(offset / file.size)
  }
  const done = await api<{ assetId: number }>(`/uploads/${start.uploadId}/finish`, { method: 'POST' })
  return done.assetId
}

/* ------------------------------------------------------------- formatting */

export function money(minor: number, currency = boot.brand.currency): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100)
  } catch {
    return `${currency} ${(minor / 100).toLocaleString()}`
  }
}

export function date(value: string | null | undefined, withTime = false): string {
  if (!value) return ''
  const d = new Date(value.length === 10 ? value + 'T00:00:00' : value)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export function ago(value: string | null | undefined): string {
  if (!value) return ''
  const s = (Date.now() - new Date(value).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return date(value)
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export const currentPhase = (p: Project) => p.phases.find((x) => x.status === 'ongoing') ?? null

export const CATEGORY_LABEL: Record<string, string> = {
  brief: 'Brief',
  brand: 'Brand',
  copy: 'Copy',
  images: 'Images',
  video: 'Video',
  references: 'References',
  data: 'Data',
  notes: 'Notes',
  payments: 'Payment proof',
}
