import type {
  Asset,
  AssetCategory,
  AssetKind,
  AssetStatus,
  Client,
  ClientStatus,
  DocumentKind,
  DocumentStatus,
  Message,
  Notification,
  NotificationAudience,
  NotificationChannel,
  NotificationStatus,
  Payment,
  PaymentStatus,
  Phase,
  PhaseStatus,
  Project,
  ProjectDetail,
  ProjectStatus,
  ProjectType,
  Review,
  Role,
  SignableDocument,
  Thread,
} from '../shared/types'

const schema = [
  `CREATE TABLE IF NOT EXISTS members (
    sub TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    client_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'onboarding',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    start_date TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS phases (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    note TEXT NOT NULL DEFAULT '',
    started_at INTEGER,
    completed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    mime TEXT NOT NULL DEFAULT '',
    storage_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    review_note TEXT NOT NULL DEFAULT '',
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    due_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'due',
    paid_at INTEGER,
    method TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    project_id TEXT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'awaiting_signature',
    signature_name TEXT,
    signature_image TEXT,
    signed_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    phase_id TEXT,
    milestone TEXT NOT NULL DEFAULT '',
    rating INTEGER NOT NULL DEFAULT 5,
    body TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    author_role TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    audience TEXT NOT NULL,
    client_id TEXT,
    project_id TEXT,
    channel TEXT NOT NULL DEFAULT 'in_app',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'sent',
    recipient TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    read_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS projects_client ON projects(client_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS phases_project ON phases(project_id, position)`,
  `CREATE INDEX IF NOT EXISTS assets_project ON assets(project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS assets_client ON assets(client_id, status)`,
  `CREATE INDEX IF NOT EXISTS payments_client ON payments(client_id, due_date)`,
  `CREATE INDEX IF NOT EXISTS documents_client ON documents(client_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS reviews_project ON reviews(project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS threads_project ON threads(project_id)`,
  `CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS notifications_audience ON notifications(audience, created_at DESC)`,
]

const ready = new WeakMap<D1Database, Promise<void>>()
export function ensureSchema(db: D1Database): Promise<void> {
  let pending = ready.get(db)
  if (!pending) {
    pending = db
      .batch(schema.map((sql) => db.prepare(sql)))
      .then(() => undefined)
      .catch((error) => {
        ready.delete(db)
        throw error
      })
    ready.set(db, pending)
  }
  return pending
}

export const PIPELINES: Record<ProjectType, string[]> = {
  website: [
    'Discovery & research',
    'Sitemap & architecture',
    'Wireframes',
    'Visual design',
    'Build & development',
    'Content & SEO',
    'QA & testing',
    'Launch',
    'Support & handover',
  ],
  web_app: [
    'Discovery & research',
    'User flows',
    'Wireframes',
    'UI design',
    'Frontend build',
    'Backend & integrations',
    'QA & testing',
    'Launch',
    'Support & handover',
  ],
  seo: [
    'Technical audit',
    'Keyword research',
    'On-page optimisation',
    'Content plan',
    'Monthly reporting',
  ],
  branding: [
    'Discovery',
    'Moodboards',
    'Logo concepts',
    'Brand system',
    'Guidelines',
  ],
  retainer: ['Monthly planning', 'Design & build', 'Review & report'],
}

// ---------------------------------------------------------------- row mapping

type MemberRow = {
  sub: string
  name: string
  email: string
  role: string
  client_id: string | null
  created_at: number
}
export type Member = {
  sub: string
  name: string
  email: string
  role: Role
  clientId: string | null
}
export const mapMember = (row: MemberRow): Member => ({
  sub: row.sub,
  name: row.name,
  email: row.email,
  role: row.role === 'admin' ? 'admin' : 'client',
  clientId: row.client_id,
})

type ClientRow = {
  id: string
  company: string
  contact_name: string
  email: string
  phone: string
  website: string
  industry: string
  status: string
  notes: string
  created_at: number
}
export const mapClient = (row: ClientRow): Client => ({
  id: row.id,
  company: row.company,
  contactName: row.contact_name,
  email: row.email,
  phone: row.phone,
  website: row.website,
  industry: row.industry,
  status: row.status as ClientStatus,
  notes: row.notes,
  createdAt: row.created_at,
})

type ProjectRow = {
  id: string
  client_id: string
  name: string
  type: string
  summary: string
  status: string
  start_date: string
  due_date: string
  created_at: number
}
export const mapProject = (row: ProjectRow): Project => ({
  id: row.id,
  clientId: row.client_id,
  name: row.name,
  type: row.type as ProjectType,
  summary: row.summary,
  status: row.status as ProjectStatus,
  startDate: row.start_date,
  dueDate: row.due_date,
  createdAt: row.created_at,
})

type PhaseRow = {
  id: string
  project_id: string
  name: string
  position: number
  status: string
  note: string
  started_at: number | null
  completed_at: number | null
}
export const mapPhase = (row: PhaseRow): Phase => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  position: row.position,
  status: row.status as PhaseStatus,
  note: row.note,
  startedAt: row.started_at,
  completedAt: row.completed_at,
})

type AssetRow = {
  id: string
  project_id: string
  client_id: string
  category: string
  name: string
  kind: string
  size: number
  mime: string
  storage_key: string | null
  status: string
  review_note: string
  uploaded_by: string
  created_at: number
  reviewed_at: number | null
}
export const mapAsset = (row: AssetRow): Asset => ({
  id: row.id,
  projectId: row.project_id,
  clientId: row.client_id,
  category: row.category as AssetCategory,
  name: row.name,
  kind: row.kind as AssetKind,
  size: row.size,
  mime: row.mime,
  status: row.status as AssetStatus,
  reviewNote: row.review_note,
  uploadedBy: row.uploaded_by,
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at,
  hasFile: Boolean(row.storage_key),
})

type PaymentRow = {
  id: string
  project_id: string
  client_id: string
  label: string
  amount_cents: number
  currency: string
  due_date: string
  status: string
  paid_at: number | null
  method: string
  created_at: number
}
export const mapPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  projectId: row.project_id,
  clientId: row.client_id,
  label: row.label,
  amountCents: row.amount_cents,
  currency: row.currency,
  dueDate: row.due_date,
  status: row.status as PaymentStatus,
  paidAt: row.paid_at,
  method: row.method,
  createdAt: row.created_at,
})

type DocumentRow = {
  id: string
  client_id: string
  project_id: string | null
  title: string
  kind: string
  body: string
  status: string
  signature_name: string | null
  signature_image: string | null
  signed_at: number | null
  created_at: number
}
export const mapDocument = (row: DocumentRow): SignableDocument => ({
  id: row.id,
  clientId: row.client_id,
  projectId: row.project_id,
  title: row.title,
  kind: row.kind as DocumentKind,
  body: row.body,
  status: row.status as DocumentStatus,
  signatureName: row.signature_name,
  signatureImage: row.signature_image,
  signedAt: row.signed_at,
  createdAt: row.created_at,
})

type ReviewRow = {
  id: string
  project_id: string
  client_id: string
  phase_id: string | null
  milestone: string
  rating: number
  body: string
  author_name: string
  created_at: number
}
export const mapReview = (row: ReviewRow): Review => ({
  id: row.id,
  projectId: row.project_id,
  clientId: row.client_id,
  phaseId: row.phase_id,
  milestone: row.milestone,
  rating: row.rating,
  body: row.body,
  authorName: row.author_name,
  createdAt: row.created_at,
})

type ThreadRow = {
  id: string
  project_id: string
  subject: string
  created_at: number
}
type MessageRow = {
  id: string
  thread_id: string
  author_role: string
  author_name: string
  body: string
  created_at: number
}
export const mapMessage = (row: MessageRow): Message => ({
  id: row.id,
  threadId: row.thread_id,
  authorRole: row.author_role === 'admin' ? 'admin' : 'client',
  authorName: row.author_name,
  body: row.body,
  createdAt: row.created_at,
})

type NotificationRow = {
  id: string
  audience: string
  client_id: string | null
  project_id: string | null
  channel: string
  title: string
  body: string
  status: string
  recipient: string
  created_at: number
  read_at: number | null
}
export const mapNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  audience: row.audience as NotificationAudience,
  clientId: row.client_id,
  projectId: row.project_id,
  channel: row.channel as NotificationChannel,
  title: row.title,
  body: row.body,
  status: row.status as NotificationStatus,
  recipient: row.recipient,
  createdAt: row.created_at,
  readAt: row.read_at,
})

// --------------------------------------------------------------- data loading

function marks(ids: string[]): string {
  return ids.map(() => '?').join(',')
}

export async function loadProjects(
  db: D1Database,
  clientId?: string,
): Promise<ProjectDetail[]> {
  const projectQuery = clientId
    ? db
        .prepare(
          'SELECT * FROM projects WHERE client_id = ? ORDER BY created_at DESC',
        )
        .bind(clientId)
    : db.prepare('SELECT * FROM projects ORDER BY created_at DESC')
  const { results: projectRows } = await projectQuery.all<ProjectRow>()
  if (!projectRows.length) return []
  const ids = projectRows.map((row) => row.id)
  const slots = marks(ids)
  const [phaseResult, assetResult, paymentResult, reviewResult, threadResult] =
    await db.batch([
      db
        .prepare(`SELECT * FROM phases WHERE project_id IN (${slots}) ORDER BY position`)
        .bind(...ids),
      db
        .prepare(
          `SELECT * FROM assets WHERE project_id IN (${slots}) ORDER BY created_at DESC`,
        )
        .bind(...ids),
      db
        .prepare(
          `SELECT * FROM payments WHERE project_id IN (${slots}) ORDER BY due_date, created_at`,
        )
        .bind(...ids),
      db
        .prepare(
          `SELECT * FROM reviews WHERE project_id IN (${slots}) ORDER BY created_at DESC`,
        )
        .bind(...ids),
      db
        .prepare(`SELECT * FROM threads WHERE project_id IN (${slots})`)
        .bind(...ids),
    ])

  const phases = (phaseResult!.results as unknown as PhaseRow[]).map(mapPhase)
  const assets = (assetResult!.results as unknown as AssetRow[]).map(mapAsset)
  const payments = (paymentResult!.results as unknown as PaymentRow[]).map(
    mapPayment,
  )
  const reviews = (reviewResult!.results as unknown as ReviewRow[]).map(mapReview)
  const threadRows = threadResult!.results as unknown as ThreadRow[]

  let messages: Message[] = []
  if (threadRows.length) {
    const threadIds = threadRows.map((thread) => thread.id)
    const result = await db
      .prepare(
        `SELECT * FROM messages WHERE thread_id IN (${marks(threadIds)}) ORDER BY created_at`,
      )
      .bind(...threadIds)
      .all<MessageRow>()
    messages = result.results.map(mapMessage)
  }

  const threads: Thread[] = threadRows.map((thread) => ({
    id: thread.id,
    projectId: thread.project_id,
    subject: thread.subject,
    messages: messages.filter((message) => message.threadId === thread.id),
  }))

  return projectRows.map((row) => {
    const project = mapProject(row)
    return {
      ...project,
      phases: phases.filter((phase) => phase.projectId === project.id),
      assets: assets.filter((asset) => asset.projectId === project.id),
      payments: payments.filter((payment) => payment.projectId === project.id),
      reviews: reviews.filter((review) => review.projectId === project.id),
      thread: threads.find((thread) => thread.projectId === project.id) ?? null,
    }
  })
}

export async function loadDocuments(
  db: D1Database,
  clientId?: string,
): Promise<SignableDocument[]> {
  const result = clientId
    ? await db
        .prepare(
          'SELECT * FROM documents WHERE client_id = ? ORDER BY created_at DESC',
        )
        .bind(clientId)
        .all<DocumentRow>()
    : await db
        .prepare('SELECT * FROM documents ORDER BY created_at DESC')
        .all<DocumentRow>()
  return result.results.map(mapDocument)
}

export async function loadNotifications(
  db: D1Database,
  audience: NotificationAudience,
  clientId?: string,
): Promise<Notification[]> {
  const result =
    audience === 'admin'
      ? await db
          .prepare(
            "SELECT * FROM notifications WHERE audience = 'admin' ORDER BY created_at DESC LIMIT 80",
          )
          .all<NotificationRow>()
      : await db
          .prepare(
            "SELECT * FROM notifications WHERE audience = 'client' AND client_id = ? ORDER BY created_at DESC LIMIT 80",
          )
          .bind(clientId ?? '')
          .all<NotificationRow>()
  return result.results.map(mapNotification)
}

// ------------------------------------------------------------------- demo data

const DAY = 86_400_000

function isoDay(offset: number): string {
  return new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)
}

type SeedProject = {
  id: string
  clientId: string
  name: string
  type: ProjectType
  summary: string
  status: ProjectStatus
  start: number
  due: number
  completed: number
  ongoing: boolean
  createdAt: number
}

export async function seedDemo(db: D1Database): Promise<void> {
  const existing = await db
    .prepare('SELECT COUNT(*) AS total FROM clients')
    .first<{ total: number }>()
  if (existing?.total) return

  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  const add = (sql: string, ...values: unknown[]) =>
    statements.push(db.prepare(sql).bind(...values))

  const clients: Array<[string, string, string, string, string, string, ClientStatus, string, number]> = [
    [
      'cl-northwind',
      'Northwind Coffee Co.',
      'Amara Okafor',
      'amara@northwindcoffee.com',
      '+1 415 555 0142',
      'hospitality',
      'active',
      'Five cafés across the Bay Area. Signed a redesign plus an ongoing SEO retainer.',
      now - 104 * DAY,
    ],
    [
      'cl-lumen',
      'Lumen Health Clinic',
      'Dr. Tunde Bello',
      'tunde@lumenclinic.ng',
      '+234 802 555 0119',
      'healthcare',
      'onboarding',
      'New client. Waiting on the signed onboarding agreement and the brand assets before kick-off.',
      now - 3 * DAY,
    ],
    [
      'cl-vertex',
      'Vertex Legal',
      'Sarah Mensah',
      'sarah@vertexlegal.com',
      '+1 212 555 0177',
      'professional services',
      'active',
      'Brand and marketing site delivered last quarter. Good candidate for a care plan.',
      now - 220 * DAY,
    ],
  ]
  for (const [id, company, contact, email, phone, industry, status, notes, createdAt] of clients) {
    add(
      `INSERT INTO clients (id, company, contact_name, email, phone, website, industry, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      company,
      contact,
      email,
      phone,
      '',
      industry,
      status,
      notes,
      createdAt,
    )
  }

  const projects: SeedProject[] = [
    {
      id: 'pr-northwind-site',
      clientId: 'cl-northwind',
      name: 'Website redesign',
      type: 'website',
      summary:
        'Full redesign of northwindcoffee.com: new art direction, a story-led home page and a store locator.',
      status: 'active',
      start: -34,
      due: 24,
      completed: 4,
      ongoing: true,
      createdAt: now - 34 * DAY,
    },
    {
      id: 'pr-northwind-seo',
      clientId: 'cl-northwind',
      name: 'SEO retainer',
      type: 'seo',
      summary: 'Monthly technical and content SEO retainer across the five café locations.',
      status: 'active',
      start: -70,
      due: 120,
      completed: 2,
      ongoing: true,
      createdAt: now - 70 * DAY,
    },
    {
      id: 'pr-lumen-app',
      clientId: 'cl-lumen',
      name: 'Booking web app',
      type: 'web_app',
      summary: 'Patient booking, reminders and a lightweight clinic admin console.',
      status: 'active',
      start: 7,
      due: 96,
      completed: 0,
      ongoing: true,
      createdAt: now - 2 * DAY,
    },
    {
      id: 'pr-vertex-site',
      clientId: 'cl-vertex',
      name: 'Brand & marketing site',
      type: 'website',
      summary: 'Identity refresh and an eight-page marketing site with a resources hub.',
      status: 'completed',
      start: -180,
      due: -40,
      completed: 9,
      ongoing: false,
      createdAt: now - 180 * DAY,
    },
  ]

  for (const project of projects) {
    add(
      `INSERT INTO projects (id, client_id, name, type, summary, status, start_date, due_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      project.id,
      project.clientId,
      project.name,
      project.type,
      project.summary,
      project.status,
      isoDay(project.start),
      isoDay(project.due),
      project.createdAt,
    )
    const pipeline = PIPELINES[project.type]
    pipeline.forEach((name, index) => {
      const status: PhaseStatus =
        index < project.completed
          ? 'completed'
          : project.ongoing && index === project.completed
            ? 'ongoing'
            : 'queued'
      add(
        `INSERT INTO phases (id, project_id, name, position, status, note, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
        `ph-${project.id}-${index}`,
        project.id,
        name,
        index,
        status,
        status === 'queued' ? null : now - (project.completed - index + 1) * 6 * DAY,
        status === 'completed' ? now - (project.completed - index) * 6 * DAY : null,
      )
    })
    add(
      `INSERT INTO threads (id, project_id, subject, created_at) VALUES (?, ?, ?, ?)`,
      `th-${project.id}`,
      project.id,
      `${project.name} — project thread`,
      project.createdAt,
    )
  }

  const assets: Array<
    [string, AssetCategory, string, AssetKind, number, string, AssetStatus, string, number]
  > = [
    ['pr-northwind-site', 'brief', 'Brand guidelines v2.pdf', 'document', 4_820_000, 'application/pdf', 'accepted', '', -30],
    ['pr-northwind-site', 'brand', 'Logo pack (all formats).zip', 'archive', 38_400_000, 'application/zip', 'pending', '', -6],
    ['pr-northwind-site', 'images', 'Cafe interior — Mission St.jpg', 'image', 6_100_000, 'image/jpeg', 'accepted', '', -8],
    ['pr-northwind-site', 'images', 'Storefront at night.jpg', 'image', 1_900_000, 'image/jpeg', 'changes_requested', 'This is too low resolution for the full-width hero — please send the 4000px original.', -4],
    ['pr-northwind-site', 'copy', 'About page copy.docx', 'document', 180_000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'pending', '', -2],
    ['pr-northwind-site', 'video', 'Cafe reel — rough cut.mp4', 'video', 92_000_000, 'video/mp4', 'pending', '', -2],
    ['pr-northwind-site', 'references', 'Sites we like (links).txt', 'link', 2_400, 'text/plain', 'accepted', '', -21],
    ['pr-northwind-seo', 'data', 'Google Search Console export.csv', 'document', 640_000, 'text/csv', 'accepted', '', -12],
    ['pr-lumen-app', 'brief', 'Requirements workshop notes.docx', 'document', 92_000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'pending', '', -1],
    ['pr-lumen-app', 'data', 'Existing booking export.csv', 'document', 1_200_000, 'text/csv', 'pending', '', -1],
    ['pr-vertex-site', 'images', 'Team portraits.zip', 'archive', 210_000_000, 'application/zip', 'accepted', 'Received and accepted. Photos are now on the team page.', -45],
    ['pr-vertex-site', 'copy', 'Practice descriptions.docx', 'document', 240_000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'accepted', '', -50],
  ]
  for (const [projectId, category, name, kind, size, mime, status, note, created] of assets) {
    const project = projects.find((item) => item.id === projectId)!
    add(
      `INSERT INTO assets (id, project_id, client_id, category, name, kind, size, mime, storage_key, status, review_note, uploaded_by, created_at, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      projectId,
      project.clientId,
      category,
      name,
      kind,
      size,
      mime,
      status,
      note,
      project.clientId === 'cl-lumen' ? 'Dr. Tunde Bello' : 'Amara Okafor',
      now + created * DAY,
      status === 'pending' ? null : now + (created + 1) * DAY,
    )
  }

  const payments: Array<
    [string, string, number, number, PaymentStatus, number | null, string]
  > = [
    ['pr-northwind-site', 'Deposit (50%)', 250000, -34, 'paid', -34, 'Bank transfer · INV-1042'],
    ['pr-northwind-site', 'Design milestone', 125000, 7, 'due', null, ''],
    ['pr-northwind-site', 'Final balance on launch', 125000, 24, 'due', null, ''],
    ['pr-northwind-seo', 'Retainer — month 1', 80000, -60, 'paid', -60, 'Card · INV-1048'],
    ['pr-northwind-seo', 'Retainer — month 2', 80000, -30, 'paid', -30, 'Card · INV-1051'],
    ['pr-northwind-seo', 'Retainer — month 3', 80000, 5, 'due', null, ''],
    ['pr-vertex-site', 'Final balance', 320000, -45, 'paid', -45, 'Bank transfer · INV-1009'],
    ['pr-lumen-app', 'Onboarding deposit', 150000, 3, 'due', null, ''],
  ]
  for (const [projectId, label, amount, due, status, paidOffset, method] of payments) {
    const project = projects.find((item) => item.id === projectId)!
    add(
      `INSERT INTO payments (id, project_id, client_id, label, amount_cents, currency, due_date, status, paid_at, method, created_at)
       VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      projectId,
      project.clientId,
      label,
      amount,
      isoDay(due),
      status,
      paidOffset === null ? null : now + paidOffset * DAY,
      method,
      now + (due - 10) * DAY,
    )
  }

  const documents: Array<
    [string, string | null, string, DocumentKind, DocumentStatus, string | null, number, string]
  > = [
    [
      'cl-northwind',
      'pr-northwind-site',
      'Master services agreement',
      'contract',
      'signed',
      'Amara Okafor',
      -33,
      `1. Scope\nAgency will design, build and launch a new marketing website for Northwind Coffee Co., including up to nine pages, a store locator and a CMS the client can edit.\n\n2. Fees\nTotal project fee is USD 5,000, invoiced as a 50% deposit, a 25% design milestone and a 25% balance on launch.\n\n3. Reviews and approvals\nClient feedback is consolidated per milestone within five business days. Two rounds of revisions are included at each design stage.\n\n4. Ownership\nOn final payment, all deliverables and licences transfer to the client.\n\n5. Confidentiality\nBoth parties keep project materials and commercial terms confidential.`,
    ],
    [
      'cl-northwind',
      'pr-northwind-seo',
      'SEO retainer agreement',
      'retainer',
      'signed',
      'Amara Okafor',
      -70,
      `1. Services\nMonthly technical SEO, on-page optimisation and content planning for up to five locations.\n\n2. Term\nRolling monthly term, cancellable with 30 days' notice.\n\n3. Fee\nUSD 800 per month, invoiced on the 1st.\n\n4. Reporting\nA monthly report covering rankings, traffic and completed work is issued within five business days of month end.`,
    ],
    [
      'cl-vertex',
      null,
      'Statement of work — brand & site',
      'sow',
      'signed',
      'Sarah Mensah',
      -178,
      `Deliverables: brand audit, logo suite, typography and colour system, eight-page marketing site, resources hub, analytics setup and a one-hour handover session.\n\nTimeline: 16 weeks from kick-off.\n\nFee: USD 9,600, invoiced 40% / 30% / 30%.`,
    ],
    [
      'cl-lumen',
      'pr-lumen-app',
      'Client onboarding agreement',
      'onboarding',
      'awaiting_signature',
      null,
      -2,
      `1. Engagement\nAgency will design and build a patient booking web app for Lumen Health Clinic, including appointment scheduling, SMS reminders and a clinic admin console.\n\n2. Project phases\nDiscovery and research, user flows, wireframes, UI design, frontend build, backend and integrations, QA and testing, launch, and support and handover. Phases are tracked in the client portal and each milestone closes with your review.\n\n3. Fees\nTotal fee USD 6,000. A 25% onboarding deposit is due before discovery, with the balance billed at the design and launch milestones.\n\n4. Client responsibilities\nYou provide brand assets, clinic copy, access to existing systems and one decision-maker for approvals. Asset requests are issued in the portal's project drive and are reviewed by the agency within two business days.\n\n5. Data protection\nPatient data stays in your systems. Agency accesses only anonymised test data during development.\n\n6. Support\nThirty days of post-launch support for defects is included. New features are quoted separately.`,
    ],
    [
      'cl-lumen',
      'pr-lumen-app',
      'Retainer agreement — support & growth',
      'retainer',
      'awaiting_signature',
      null,
      -2,
      `1. Services\nOngoing maintenance, small enhancements and monthly performance reporting for the booking app.\n\n2. Term\nTwelve months from launch, billed monthly.\n\n3. Fee\nUSD 450 per month.\n\n4. Response times\nCritical issues acknowledged within four working hours; standard requests within two business days.`,
    ],
  ]
  for (const [clientId, projectId, title, kind, status, signer, offset, body] of documents) {
    add(
      `INSERT INTO documents (id, client_id, project_id, title, kind, body, status, signature_name, signature_image, signed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      crypto.randomUUID(),
      clientId,
      projectId,
      title,
      kind,
      body,
      status,
      signer,
      signer ? now + offset * DAY : null,
      now + offset * DAY,
    )
  }

  const reviews: Array<[string, string, string, string, number, string, number]> = [
    [
      'pr-northwind-site',
      'cl-northwind',
      'Wireframes',
      'Wireframes',
      5,
      'The wireframes made the whole structure click for us. The team flagged two pages we had not thought about, and the mobile flow is exactly what our staff need.',
      -18,
    ],
    [
      'pr-northwind-site',
      'cl-northwind',
      'Visual design',
      'Visual design',
      4,
      'Love the art direction. We went back and forth on the hero image twice, and the team handled it patiently.',
      -7,
    ],
    [
      'pr-vertex-site',
      'cl-vertex',
      'Final delivery',
      'Launch',
      5,
      'Delivered ahead of schedule and the handover session meant our team could update the site on day one.',
      -38,
    ],
  ]
  for (const [projectId, clientId, milestone, phaseName, rating, body, offset] of reviews) {
    add(
      `INSERT INTO reviews (id, project_id, client_id, phase_id, milestone, rating, body, author_name, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      projectId,
      clientId,
      milestone,
      rating,
      body,
      phaseName,
      now + offset * DAY,
    )
  }

  const messages: Array<[string, Role, string, string, number]> = [
    ['pr-northwind-site', 'admin', 'Studio', 'Hi Amara — wireframes are up in the portal and the design phase starts Monday. Anything you want us to revisit before we move?', -20],
    ['pr-northwind-site', 'client', 'Amara Okafor', 'Looks great. Only note is the store locator — can it default to the nearest café?', -19],
    ['pr-northwind-site', 'admin', 'Studio', 'Yes. We will use the browser location with a manual fallback. Two new photos are needed for the Mission St page — anything under 4000px wide will pixelate in the hero.', -5],
    ['pr-northwind-site', 'client', 'Amara Okafor', 'Noted, our photographer is sending the full-resolution set this week.', -3],
    ['pr-lumen-app', 'admin', 'Studio', 'Welcome aboard, Tunde. Your onboarding agreement and retainer are in the Documents tab, and the first asset request is in the project drive.', -1],
    ['pr-vertex-site', 'client', 'Sarah Mensah', 'The final site looks excellent. Thank you for the patience on the resources hub.', -40],
  ]
  for (const [projectId, role, name, body, offset] of messages) {
    add(
      `INSERT INTO messages (id, thread_id, author_role, author_name, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      `th-${projectId}`,
      role,
      name,
      body,
      now + offset * DAY,
    )
  }

  const notifications: Array<
    [NotificationAudience, string | null, string | null, NotificationChannel, string, string, NotificationStatus, string, number]
  > = [
    ['client', 'cl-northwind', 'pr-northwind-site', 'in_app', 'Changes requested on “Storefront at night.jpg”', 'The photo is too low resolution for the hero. Please upload the 4000px original.', 'sent', 'amara@northwindcoffee.com', -4],
    ['client', 'cl-northwind', 'pr-northwind-site', 'email', 'Changes requested on “Storefront at night.jpg”', 'The photo is too low resolution for the hero. Please upload the 4000px original.', 'sent', 'amara@northwindcoffee.com', -4],
    ['client', 'cl-lumen', 'pr-lumen-app', 'in_app', 'Two documents are ready to sign', 'Your onboarding agreement and support retainer are waiting in Documents.', 'sent', 'tunde@lumenclinic.ng', -2],
    ['admin', 'cl-northwind', 'pr-northwind-site', 'in_app', 'New assets uploaded', 'Amara uploaded “About page copy.docx” and “Cafe reel — rough cut.mp4”.', 'sent', 'studio@projectdesk.test', -2],
    ['admin', 'cl-northwind', 'pr-northwind-site', 'email', 'New assets uploaded', 'Amara uploaded “About page copy.docx” and “Cafe reel — rough cut.mp4”.', 'sent', 'studio@projectdesk.test', -2],
    ['admin', 'cl-northwind', 'pr-northwind-site', 'whatsapp', 'New assets uploaded', 'Amara uploaded “About page copy.docx” and “Cafe reel — rough cut.mp4”.', 'queued', '', -2],
    ['admin', 'cl-northwind', 'pr-northwind-site', 'in_app', 'New review: Visual design', 'Amara rated the Visual design milestone 4/5.', 'sent', 'studio@projectdesk.test', -7],
    ['admin', 'cl-vertex', 'pr-vertex-site', 'in_app', 'New review: Launch', 'Sarah rated the final delivery 5/5.', 'sent', 'studio@projectdesk.test', -38],
  ]
  for (const [audience, clientId, projectId, channel, title, body, status, recipient, offset] of notifications) {
    add(
      `INSERT INTO notifications (id, audience, client_id, project_id, channel, title, body, status, recipient, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      crypto.randomUUID(),
      audience,
      clientId,
      projectId,
      channel,
      title,
      body,
      status,
      recipient,
      now + offset * DAY,
    )
  }

  await db.batch(statements)
}
