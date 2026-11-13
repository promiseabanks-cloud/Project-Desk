export type Role = 'admin' | 'client'

export type Session = {
  user: { sub: string; name?: string; email?: string } | null
  mode: 'local' | 'freebuff' | 'setup'
  database: boolean
  role: Role | null
  clientId: string | null
  displayName: string | null
  pendingInvite: boolean
}

export type ClientStatus = 'onboarding' | 'active' | 'paused' | 'archived'

export type Client = {
  id: string
  company: string
  contactName: string
  email: string
  phone: string
  website: string
  industry: string
  status: ClientStatus
  notes: string
  createdAt: number
}

export type ProjectType = 'website' | 'web_app' | 'seo' | 'branding' | 'retainer'
export type ProjectStatus = 'active' | 'completed' | 'on_hold'
export type PhaseStatus = 'queued' | 'ongoing' | 'completed'

export type Phase = {
  id: string
  projectId: string
  name: string
  position: number
  status: PhaseStatus
  note: string
  startedAt: number | null
  completedAt: number | null
}

export type Project = {
  id: string
  clientId: string
  name: string
  type: ProjectType
  summary: string
  status: ProjectStatus
  startDate: string
  dueDate: string
  createdAt: number
}

export type ProjectDetail = Project & {
  phases: Phase[]
  assets: Asset[]
  payments: Payment[]
  reviews: Review[]
  thread: Thread | null
}

export type AssetCategory =
  | 'brief'
  | 'brand'
  | 'copy'
  | 'images'
  | 'video'
  | 'references'
  | 'data'

export type AssetKind =
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'link'
  | 'other'

export type AssetStatus = 'pending' | 'accepted' | 'changes_requested'

export type Asset = {
  id: string
  projectId: string
  clientId: string
  category: AssetCategory
  name: string
  kind: AssetKind
  size: number
  mime: string
  status: AssetStatus
  reviewNote: string
  uploadedBy: string
  createdAt: number
  reviewedAt: number | null
  hasFile: boolean
}

export type PaymentStatus = 'due' | 'paid' | 'overdue'

export type Payment = {
  id: string
  projectId: string
  clientId: string
  label: string
  amountCents: number
  currency: string
  dueDate: string
  status: PaymentStatus
  paidAt: number | null
  method: string
  createdAt: number
}

export type DocumentKind = 'contract' | 'retainer' | 'nda' | 'sow' | 'onboarding'
export type DocumentStatus = 'awaiting_signature' | 'signed'

export type SignableDocument = {
  id: string
  clientId: string
  projectId: string | null
  title: string
  kind: DocumentKind
  body: string
  status: DocumentStatus
  signatureName: string | null
  signatureImage: string | null
  signedAt: number | null
  createdAt: number
}

export type Review = {
  id: string
  projectId: string
  clientId: string
  phaseId: string | null
  milestone: string
  rating: number
  body: string
  authorName: string
  createdAt: number
}

export type Message = {
  id: string
  threadId: string
  authorRole: Role
  authorName: string
  body: string
  createdAt: number
}

export type Thread = {
  id: string
  projectId: string
  subject: string
  messages: Message[]
}

export type NotificationAudience = 'admin' | 'client'
export type NotificationChannel = 'in_app' | 'email' | 'whatsapp'
export type NotificationStatus = 'sent' | 'queued' | 'failed'

export type Notification = {
  id: string
  audience: NotificationAudience
  clientId: string | null
  projectId: string | null
  channel: NotificationChannel
  title: string
  body: string
  status: NotificationStatus
  recipient: string
  createdAt: number
  readAt: number | null
}

export type AdminData = {
  clients: Client[]
  projects: ProjectDetail[]
  documents: SignableDocument[]
  notifications: Notification[]
  channels: {
    email: boolean
    whatsapp: boolean
    storage: boolean
  }
}

export type PortalData = {
  client: Client
  projects: ProjectDetail[]
  documents: SignableDocument[]
  notifications: Notification[]
  preview: boolean
}

export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  queued: 'In queue',
  ongoing: 'In progress',
  completed: 'Completed',
}

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  pending: 'Awaiting review',
  accepted: 'Accepted',
  changes_requested: 'Changes requested',
}

export const CATEGORY_META: Record<
  AssetCategory,
  { label: string; hint: string; accepts: string }
> = {
  brief: {
    label: 'Brief & requirements',
    hint: 'Signed briefs, scope notes, requirement documents',
    accepts: '.pdf,.doc,.docx,.txt,.md',
  },
  brand: {
    label: 'Brand & logos',
    hint: 'Logo packs, fonts, colour palettes, brand guides',
    accepts: '.zip,.pdf,.ai,.eps,.svg,.png,.jpg',
  },
  copy: {
    label: 'Copy & content',
    hint: 'Page copy, blog posts, product descriptions',
    accepts: '.doc,.docx,.pdf,.txt,.md',
  },
  images: {
    label: 'Images & photos',
    hint: 'Photography, product shots, illustrations',
    accepts: 'image/*',
  },
  video: {
    label: 'Video & motion',
    hint: 'Brand films, reels, product walkthroughs',
    accepts: 'video/*',
  },
  references: {
    label: 'References',
    hint: 'Sites and designs you like, competitor links',
    accepts: '',
  },
  data: {
    label: 'Data & exports',
    hint: 'Product feeds, CRM exports, existing content',
    accepts: '.csv,.xlsx,.json,.zip',
  },
}

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  contract: 'Contract',
  retainer: 'Retainer',
  nda: 'NDA',
  sow: 'Statement of work',
  onboarding: 'Onboarding',
}

export function money(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

export function formatDate(value: string | number | null): string {
  if (!value) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function projectProgress(project: ProjectDetail): number {
  const total = project.phases.length
  if (!total) return 0
  const done = project.phases.filter((p) => p.status === 'completed').length
  const active = project.phases.some((p) => p.status === 'ongoing') ? 0.5 : 0
  return Math.round(((done + active) / total) * 100)
}
