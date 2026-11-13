import { isSameOriginRequest } from '@freebuff/auth'
import type { FreebuffUser } from '@freebuff/auth'
import { Hono, type Context, type Handler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type {
  AdminData,
  Asset,
  AssetCategory,
  AssetKind,
  AssetStatus,
  Client,
  ClientStatus,
  DocumentKind,
  NotificationChannel,
  PaymentStatus,
  PhaseStatus,
  PortalData,
  ProjectStatus,
  ProjectType,
  Role,
  Session,
} from '../shared/types'
import { appOrigin, currentUser, isLocalPreview, type Env } from './auth'
import {
  ensureSchema,
  loadDocuments,
  loadNotifications,
  loadProjects,
  mapAsset,
  mapClient,
  mapMember,
  seedDemo,
  type Member,
} from './db'
import { notify } from './notify'

type AppContext = {
  Bindings: Env
  Variables: { user: FreebuffUser; db: D1Database; member: Member }
}
type Authenticate = (request: Request, env: Env) => Promise<FreebuffUser | null>

const CATEGORIES: AssetCategory[] = [
  'brief',
  'brand',
  'copy',
  'images',
  'video',
  'references',
  'data',
]
const PROJECT_TYPES: ProjectType[] = [
  'website',
  'web_app',
  'seo',
  'branding',
  'retainer',
]
const DOCUMENT_KINDS: DocumentKind[] = [
  'contract',
  'retainer',
  'nda',
  'sow',
  'onboarding',
]
const CLIENT_STATUSES: ClientStatus[] = [
  'onboarding',
  'active',
  'paused',
  'archived',
]
const PHASE_STATUSES: PhaseStatus[] = ['queued', 'ongoing', 'completed']

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function money(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/[^0-9.]/g, ''))
        : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000_000)
    return null
  return Math.round(parsed * 100)
}

function date(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  return raw
}

function kindFor(mime: string, name: string): AssetKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/zip' || /\.(zip|rar|7z)$/i.test(name))
    return 'archive'
  if (/\.(txt|md)$/i.test(name) && mime.startsWith('text/')) return 'link'
  if (
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('sheet') ||
    mime.includes('csv') ||
    /\.(doc|docx|pdf|xls|xlsx|csv)$/i.test(name)
  )
    return 'document'
  return 'other'
}

/**
 * Resolves the signed-in account to an agency member. The first account to
 * arrive becomes the agency admin; a client contact is linked by email; anyone
 * else stays unlinked and is told to ask for an invitation.
 */
async function resolveMember(
  db: D1Database,
  user: FreebuffUser,
): Promise<Member | null> {
  const existing = await db
    .prepare('SELECT * FROM members WHERE sub = ?')
    .bind(user.sub)
    .first<Parameters<typeof mapMember>[0]>()
  if (existing) return mapMember(existing)

  const email = (user.email ?? '').toLowerCase()
  if (email) {
    const client = await db
      .prepare(
        'SELECT id, contact_name FROM clients WHERE lower(email) = ? LIMIT 1',
      )
      .bind(email)
      .first<{ id: string; contact_name: string }>()
    if (client) {
      const member: Member = {
        sub: user.sub,
        name: user.name || client.contact_name || 'Client contact',
        email,
        role: 'client',
        clientId: client.id,
      }
      await db
        .prepare(
          'INSERT INTO members (sub, name, email, role, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          member.sub,
          member.name,
          member.email,
          member.role,
          member.clientId,
          Date.now(),
        )
        .run()
      return member
    }
  }

  const admins = await db
    .prepare("SELECT COUNT(*) AS total FROM members WHERE role = 'admin'")
    .first<{ total: number }>()
  if (!admins?.total) {
    const member: Member = {
      sub: user.sub,
      name: user.name || 'Agency admin',
      email,
      role: 'admin',
      clientId: null,
    }
    await db
      .prepare(
        'INSERT INTO members (sub, name, email, role, client_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
      )
      .bind(member.sub, member.name, member.email, member.role, Date.now())
      .run()
    await seedDemo(db)
    return member
  }
  return null
}

async function clientById(
  db: D1Database,
  id: string,
): Promise<Client | null> {
  const row = await db
    .prepare('SELECT * FROM clients WHERE id = ?')
    .bind(id)
    .first<Parameters<typeof mapClient>[0]>()
  return row ? mapClient(row) : null
}

function onboardingBody(company: string): string {
  return `1. Engagement\nProject Desk will design, build and support the digital project described in the statement of work for ${company}. The scope, timeline and fees are agreed before kick-off and tracked in this portal.\n\n2. Project phases\nDiscovery and research, wireframes, visual design, build, content and SEO, testing, launch and handover. Each phase is marked in queue, in progress or complete in your dashboard, and milestones close with your review.\n\n3. Fees\nA deposit is due before discovery, with the balance billed at the design and launch milestones. Invoices and due dates appear in the Payments tab.\n\n4. Your responsibilities\nProvide brand assets, copy, system access and one decision-maker for approvals. Asset requests are issued in the project drive and are reviewed by the agency within two business days.\n\n5. Approvals\nTwo rounds of revisions are included at each design milestone. Consolidated feedback is expected within five business days of a milestone being shared.\n\n6. Ownership and confidentiality\nOn final payment, deliverables and licences transfer to ${company}. Both parties keep project materials and commercial terms confidential.`
}

const AGREEMENT_TITLES: Record<DocumentKind, string> = {
  contract: 'Master services agreement',
  retainer: 'Retainer agreement',
  nda: 'Mutual NDA',
  sow: 'Statement of work',
  onboarding: 'Client onboarding agreement',
}

export function createApp(authenticate: Authenticate = currentUser) {
  const app = new Hono<AppContext>()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  // Everything except the asset upload is JSON and stays small.
  app.use('/api/*', async (c, next) => {
    const isUpload =
      c.req.method === 'POST' &&
      /^\/api\/portal\/projects\/[^/]+\/assets$/.test(c.req.path)
    if (isUpload) return next()
    return bodyLimit({
      maxSize: 256 * 1024,
      onError: (ctx) => ctx.json({ error: 'Request is too large.' }, 413),
    })(c, next)
  })

  app.get('/api/session', async (c) => {
    const user = await authenticate(c.req.raw, c.env)
    const mode = isLocalPreview(c.req.raw, c.env)
      ? 'local'
      : c.env.FREEBUFF_CLIENT_ID && c.env.APP_ORIGIN
        ? 'freebuff'
        : 'setup'
    let member: Member | null = null
    if (user && c.env.DB) {
      try {
        await ensureSchema(c.env.DB)
        member = await resolveMember(c.env.DB, user)
      } catch {
        member = null
      }
    }
    const session: Session = {
      user,
      mode,
      database: Boolean(c.env.DB),
      role: member?.role ?? null,
      clientId: member?.clientId ?? null,
      displayName: member?.name ?? user?.name ?? null,
      pendingInvite: Boolean(user && c.env.DB && !member),
    }
    return c.json(session)
  })

  app.use('/api/*', async (c, next) => {
    const user = await authenticate(c.req.raw, c.env)
    if (!user) return c.json({ error: 'Sign in required.' }, 401)
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = appOrigin(c.req.raw, c.env)
      if (!origin || !isSameOriginRequest(c.req.raw, origin))
        return c.json({ error: 'Cross-origin request refused.' }, 403)
    }
    if (!c.env.DB)
      return c.json(
        { error: 'This workspace is still being set up. Please try again later.' },
        503,
      )
    await ensureSchema(c.env.DB)
    const member = await resolveMember(c.env.DB, user)
    if (!member)
      return c.json(
        {
          error:
            'This account is not linked to the agency workspace yet. Ask your project manager to invite this email address.',
        },
        403,
      )
    c.set('user', user)
    c.set('db', c.env.DB)
    c.set('member', member)
    await next()
  })

  const requireRole =
    (role: Role): Handler<AppContext> =>
    async (c, next) => {
      if (c.get('member').role !== role)
        return c.json({ error: 'You do not have access to this area.' }, 403)
      await next()
    }
  app.use('/api/admin/*', requireRole('admin'))

  // ------------------------------------------------------------ admin: read

  app.get('/api/admin/data', async (c) => {
    const db = c.get('db')
    const [clients, projects, documents, notifications] = await Promise.all([
      db
        .prepare('SELECT * FROM clients ORDER BY created_at DESC')
        .all<Parameters<typeof mapClient>[0]>(),
      loadProjects(db),
      loadDocuments(db),
      loadNotifications(db, 'admin'),
    ])
    const data: AdminData = {
      clients: clients.results.map(mapClient),
      projects,
      documents,
      notifications,
      channels: {
        email: Boolean(c.env.RESEND_API_KEY && c.env.AGENCY_EMAIL),
        whatsapp: Boolean(
          c.env.TWILIO_ACCOUNT_SID &&
            c.env.TWILIO_AUTH_TOKEN &&
            c.env.TWILIO_WHATSAPP_FROM &&
            c.env.AGENCY_WHATSAPP,
        ),
        storage: Boolean(c.env.FILES),
      },
    }
    return c.json(data)
  })

  // --------------------------------------------------------- admin: clients

  app.post('/api/admin/clients', async (c) => {
    const db = c.get('db')
    const body: unknown = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return c.json({ error: 'Send the client details as JSON.' }, 400)
    const input = body as Record<string, unknown>
    const company = text(input.company, 120)
    const contactName = text(input.contactName, 120)
    const email = text(input.email, 200).toLowerCase()
    if (!company) return c.json({ error: 'A company name is required.' }, 400)
    if (!contactName)
      return c.json({ error: 'A primary contact name is required.' }, 400)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return c.json({ error: 'Enter a valid contact email address.' }, 400)
    const duplicate = await db
      .prepare('SELECT id FROM clients WHERE lower(email) = ?')
      .bind(email)
      .first()
    if (duplicate)
      return c.json(
        { error: 'A client with that contact email already exists.' },
        409,
      )

    const now = Date.now()
    const clientId = crypto.randomUUID()
    const type = oneOf(input.type, PROJECT_TYPES, 'website')
    const projectName = text(input.projectName, 120) || `${company} — ${type === 'web_app' ? 'web app' : 'website'}`
    const summary = text(input.summary, 600)
    const due = date(input.dueDate) ?? ''
    const projectId = crypto.randomUUID()
    const threadId = crypto.randomUUID()
    const documentId = crypto.randomUUID()
    const kind = oneOf(input.documentKind, DOCUMENT_KINDS, 'onboarding')
    const pipelines: Record<ProjectType, string[]> = {
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

    const statements = [
      db
        .prepare(
          `INSERT INTO clients (id, company, contact_name, email, phone, website, industry, status, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'onboarding', ?, ?)`,
        )
        .bind(
          clientId,
          company,
          contactName,
          email,
          text(input.phone, 40),
          text(input.website, 160),
          text(input.industry, 80),
          text(input.notes, 2000),
          now,
        ),
      db
        .prepare(
          `INSERT INTO projects (id, client_id, name, type, summary, status, start_date, due_date, created_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .bind(
          projectId,
          clientId,
          projectName,
          type,
          summary,
          new Date(now).toISOString().slice(0, 10),
          due,
          now,
        ),
      db
        .prepare(
          'INSERT INTO threads (id, project_id, subject, created_at) VALUES (?, ?, ?, ?)',
        )
        .bind(threadId, projectId, `${projectName} — project thread`, now),
      db
        .prepare(
          `INSERT INTO documents (id, client_id, project_id, title, kind, body, status, signature_name, signature_image, signed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'awaiting_signature', NULL, NULL, NULL, ?)`,
        )
        .bind(
          documentId,
          clientId,
          projectId,
          AGREEMENT_TITLES[kind],
          kind,
          onboardingBody(company),
          now,
        ),
    ]
    pipelines[type].forEach((name, index) =>
      statements.push(
        db
          .prepare(
            `INSERT INTO phases (id, project_id, name, position, status, note, started_at, completed_at)
             VALUES (?, ?, ?, ?, 'queued', '', NULL, NULL)`,
          )
          .bind(crypto.randomUUID(), projectId, name, index),
      ),
    )
    await db.batch(statements)

    await notify(db, c.env, [
      {
        audience: 'client',
        clientId,
        projectId,
        title: `Welcome to your project desk, ${company}`,
        body: `Your onboarding agreement, “${AGREEMENT_TITLES[kind]}”, is ready to sign in the Documents tab. Once signed your first project phase is scheduled.`,
        channels: ['email'],
        email,
      },
    ])

    return c.json({ clientId, projectId }, 201)
  })

  app.patch('/api/admin/clients/:id', async (c) => {
    const db = c.get('db')
    const body: unknown = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return c.json({ error: 'Send the changes as JSON.' }, 400)
    const input = body as Record<string, unknown>
    const status = oneOf(input.status, CLIENT_STATUSES, 'active')
    const result = await db
      .prepare('UPDATE clients SET status = ? WHERE id = ? RETURNING id')
      .bind(status, c.req.param('id'))
      .first()
    return result
      ? c.json({ ok: true, status })
      : c.json({ error: 'Client not found.' }, 404)
  })

  // -------------------------------------------------------- admin: projects

  app.post('/api/admin/projects', async (c) => {
    const db = c.get('db')
    const body: unknown = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return c.json({ error: 'Send the project details as JSON.' }, 400)
    const input = body as Record<string, unknown>
    const clientId = text(input.clientId, 64)
    const name = text(input.name, 120)
    const type = oneOf(input.type, PROJECT_TYPES, 'website')
    if (!clientId || !name)
      return c.json({ error: 'Choose a client and name the project.' }, 400)
    const client = await clientById(db, clientId)
    if (!client) return c.json({ error: 'Client not found.' }, 404)
    const projectId = crypto.randomUUID()
    const now = Date.now()
    await db.batch([
      db
        .prepare(
          `INSERT INTO projects (id, client_id, name, type, summary, status, start_date, due_date, created_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .bind(
          projectId,
          clientId,
          name,
          type,
          text(input.summary, 600),
          date(input.startDate) ??
            new Date(now).toISOString().slice(0, 10),
          date(input.dueDate) ?? '',
          now,
        ),
      db
        .prepare(
          'INSERT INTO threads (id, project_id, subject, created_at) VALUES (?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), projectId, `${name} — project thread`, now),
      ...(await pipelineStatements(db, c.env, projectId, type)),
    ])
    await notify(db, c.env, [
      {
        audience: 'client',
        clientId,
        projectId,
        title: `New project added: ${name}`,
        body: `A new project has been added to your desk. Phase one, ${pipelineFor(type)[0]}, is queued.`,
        channels: ['email'],
        email: client.email,
      },
    ])
    return c.json({ projectId }, 201)
  })

  app.post('/api/admin/projects/:id/phases', async (c) => {
    const db = c.get('db')
    const projectId = c.req.param('id')
    const project = await db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .bind(projectId)
      .first<{ id: string; name: string; client_id: string }>()
    if (!project) return c.json({ error: 'Project not found.' }, 404)
    const body: unknown = await c.req.json().catch(() => null)
    const name = text((body as Record<string, unknown> | null)?.name, 120)
    if (!name) return c.json({ error: 'Give the phase a name.' }, 400)
    const last = await db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) AS position FROM phases WHERE project_id = ?',
      )
      .bind(projectId)
      .first<{ position: number }>()
    await db
      .prepare(
        `INSERT INTO phases (id, project_id, name, position, status, note, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'queued', '', NULL, NULL)`,
      )
      .bind(crypto.randomUUID(), projectId, name, (last?.position ?? -1) + 1)
      .run()
    return c.json({ ok: true }, 201)
  })

  app.patch('/api/admin/phases/:id', async (c) => {
    const db = c.get('db')
    const phaseId = c.req.param('id')
    const phase = await db
      .prepare('SELECT * FROM phases WHERE id = ?')
      .bind(phaseId)
      .first<{
        id: string
        project_id: string
        name: string
        position: number
      }>()
    if (!phase) return c.json({ error: 'Phase not found.' }, 404)
    const body: unknown = await c.req.json().catch(() => null)
    const status = oneOf(
      (body as Record<string, unknown> | null)?.status,
      PHASE_STATUSES,
      'queued',
    )
    const project = await db
      .prepare('SELECT id, client_id, name FROM projects WHERE id = ?')
      .bind(phase.project_id)
      .first<{ id: string; client_id: string; name: string }>()
    if (!project) return c.json({ error: 'Project not found.' }, 404)
    const client = await clientById(db, project.client_id)
    const now = Date.now()

    const statements: D1PreparedStatement[] = []
    if (status === 'ongoing') {
      // One phase at a time: earlier phases close when a later one starts.
      statements.push(
        db
          .prepare(
            `UPDATE phases SET status = 'completed', completed_at = COALESCE(completed_at, ?)
             WHERE project_id = ? AND position < ? AND status != 'completed'`,
          )
          .bind(now, phase.project_id, phase.position),
        db
          .prepare(
            `UPDATE phases SET status = 'ongoing', started_at = COALESCE(started_at, ?) WHERE id = ?`,
          )
          .bind(now, phaseId),
      )
    } else if (status === 'completed') {
      statements.push(
        db
          .prepare(
            `UPDATE phases SET status = 'completed', started_at = COALESCE(started_at, ?), completed_at = ?
             WHERE id = ?`,
          )
          .bind(now, now, phaseId),
      )
    } else {
      statements.push(
        db
          .prepare(
            `UPDATE phases SET status = 'queued', started_at = NULL, completed_at = NULL WHERE id = ?`,
          )
          .bind(phaseId),
      )
    }
    await db.batch(statements)

    const phases = await db
      .prepare(
        'SELECT id, name, position, status FROM phases WHERE project_id = ? ORDER BY position',
      )
      .bind(phase.project_id)
      .all<{ id: string; name: string; position: number; status: PhaseStatus }>()
    const list = phases.results
    const allDone = list.length > 0 && list.every((p) => p.status === 'completed')
    const projectStatus: ProjectStatus = allDone ? 'completed' : 'active'
    await db
      .prepare('UPDATE projects SET status = ? WHERE id = ?')
      .bind(projectStatus, phase.project_id)
      .run()

    if (client) {
      const next = list.find((p) => p.status !== 'completed')
      const headline =
        status === 'completed'
          ? `${phase.name} is complete`
          : status === 'ongoing'
            ? `${phase.name} is now in progress`
            : `${phase.name} is back in the queue`
      const detail =
        status === 'completed' && allDone
          ? `Every phase on ${project.name} is complete. The project is closed out — thank you!`
          : next && status !== 'queued'
            ? `Up next on ${project.name}: ${next.name}.`
            : `The phase list on ${project.name} was updated.`
      await notify(db, c.env, [
        {
          audience: 'client',
          clientId: client.id,
          projectId: phase.project_id,
          title: `Project update — ${headline}`,
          body: detail,
          channels: ['email'],
          email: client.email,
        },
      ])
    }
    return c.json({ ok: true, projectStatus })
  })

  // ------------------------------------------------------- admin: reviews

  app.patch('/api/admin/assets/:id', async (c) => {
    const db = c.get('db')
    const assetId = c.req.param('id')
    const asset = await db
      .prepare('SELECT * FROM assets WHERE id = ?')
      .bind(assetId)
      .first<Parameters<typeof mapAsset>[0]>()
    if (!asset) return c.json({ error: 'Asset not found.' }, 404)
    const body: unknown = await c.req.json().catch(() => null)
    const input = (body ?? {}) as Record<string, unknown>
    const status = oneOf<AssetStatus>(
      input.status,
      ['pending', 'accepted', 'changes_requested'],
      'pending',
    )
    const note = text(input.note, 600)
    if (status === 'changes_requested' && !note)
      return c.json(
        { error: 'Tell the client exactly what needs to change.' },
        400,
      )
    await db
      .prepare(
        'UPDATE assets SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?',
      )
      .bind(status, note, Date.now(), assetId)
      .run()
    const project = await db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .bind(asset.project_id)
      .first<{ name: string }>()
    const client = await clientById(db, asset.client_id)
    if (client && status !== 'pending') {
      await notify(db, c.env, [
        {
          audience: 'client',
          clientId: client.id,
          projectId: asset.project_id,
          title:
            status === 'accepted'
              ? `Assets received and accepted — ${asset.name}`
              : `Changes needed on “${asset.name}”`,
          body:
            status === 'accepted'
              ? `“${asset.name}” was reviewed and accepted on ${project?.name ?? 'your project'}. Nothing else is needed.`
              : `“${asset.name}” needs another pass: ${note}`,
          channels: ['email'],
          email: client.email,
        },
      ])
    }
    return c.json({ ok: true, status })
  })

  // ------------------------------------------------------- admin: payments

  app.post('/api/admin/projects/:id/payments', async (c) => {
    const db = c.get('db')
    const projectId = c.req.param('id')
    const project = await db
      .prepare('SELECT id, name, client_id FROM projects WHERE id = ?')
      .bind(projectId)
      .first<{ id: string; name: string; client_id: string }>()
    if (!project) return c.json({ error: 'Project not found.' }, 404)
    const body: unknown = await c.req.json().catch(() => null)
    const input = (body ?? {}) as Record<string, unknown>
    const label = text(input.label, 120)
    const amount = money(input.amount)
    const due = date(input.dueDate)
    if (!label) return c.json({ error: 'Name the payment.' }, 400)
    if (!amount) return c.json({ error: 'Enter a valid amount.' }, 400)
    if (!due) return c.json({ error: 'Choose a due date.' }, 400)
    await db
      .prepare(
        `INSERT INTO payments (id, project_id, client_id, label, amount_cents, currency, due_date, status, paid_at, method, created_at)
         VALUES (?, ?, ?, ?, ?, 'USD', ?, 'due', NULL, '', ?)`,
      )
      .bind(
        crypto.randomUUID(),
        projectId,
        project.client_id,
        label,
        amount,
        due,
        Date.now(),
      )
      .run()
    const client = await clientById(db, project.client_id)
    if (client) {
      await notify(db, c.env, [
        {
          audience: 'client',
          clientId: client.id,
          projectId,
          title: `New invoice — ${label}`,
          body: `${label} for ${project.name} has been added to your payment tracker. Due ${due}.`,
          channels: ['email'],
          email: client.email,
        },
      ])
    }
    return c.json({ ok: true }, 201)
  })

  app.patch('/api/admin/payments/:id', async (c) => {
    const db = c.get('db')
    const paymentId = c.req.param('id')
    const payment = await db
      .prepare('SELECT * FROM payments WHERE id = ?')
      .bind(paymentId)
      .first<{
        id: string
        project_id: string
        client_id: string
        label: string
        amount_cents: number
      }>()
    if (!payment) return c.json({ error: 'Payment not found.' }, 404)
    const body: unknown = await c.req.json().catch(() => null)
    const input = (body ?? {}) as Record<string, unknown>
    const status = oneOf<PaymentStatus>(
      input.status,
      ['due', 'paid', 'overdue'],
      'due',
    )
    const method = text(input.method, 120)
    await db
      .prepare(
        'UPDATE payments SET status = ?, paid_at = ?, method = ? WHERE id = ?',
      )
      .bind(
        status,
        status === 'paid' ? Date.now() : null,
        status === 'paid' ? method || 'Recorded by agency' : '',
        paymentId,
      )
      .run()
    const client = await clientById(db, payment.client_id)
    if (client && status === 'paid') {
      await notify(db, c.env, [
        {
          audience: 'client',
          clientId: client.id,
          projectId: payment.project_id,
          title: `Payment received — ${payment.label}`,
          body: `We have recorded your payment for ${payment.label}. Thank you — the receipt is in your payment tracker.`,
          channels: ['email'],
          email: client.email,
        },
      ])
    }
    return c.json({ ok: true, status })
  })

  // ------------------------------------------------------ admin: documents

  app.post('/api/admin/documents', async (c) => {
    const db = c.get('db')
    const body: unknown = await c.req.json().catch(() => null)
    const input = (body ?? {}) as Record<string, unknown>
    const clientId = text(input.clientId, 64)
    const client = clientId ? await clientById(db, clientId) : null
    if (!client) return c.json({ error: 'Client not found.' }, 404)
    const kind = oneOf(input.kind, DOCUMENT_KINDS, 'contract')
    const title = text(input.title, 160) || AGREEMENT_TITLES[kind]
    const content = text(input.body, 20_000) || onboardingBody(client.company)
    const projectId = text(input.projectId, 64) || null
    await db
      .prepare(
        `INSERT INTO documents (id, client_id, project_id, title, kind, body, status, signature_name, signature_image, signed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'awaiting_signature', NULL, NULL, NULL, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        clientId,
        projectId,
        title,
        kind,
        content,
        Date.now(),
      )
      .run()
    await notify(db, c.env, [
      {
        audience: 'client',
        clientId,
        projectId,
        title: `Document ready to sign — ${title}`,
        body: `${title} is waiting for your signature in the Documents tab.`,
        channels: ['email'],
        email: client.email,
      },
    ])
    return c.json({ ok: true }, 201)
  })

  // ------------------------------------------------------- admin: messages

  app.post('/api/admin/projects/:id/messages', async (c) => {
    const db = c.get('db')
    const member = c.get('member')
    const projectId = c.req.param('id')
    const project = await db
      .prepare('SELECT id, name, client_id FROM projects WHERE id = ?')
      .bind(projectId)
      .first<{ id: string; name: string; client_id: string }>()
    if (!project) return c.json({ error: 'Project not found.' }, 404)
    const body: unknown = await c.req.json().catch(() => null)
    const message = text((body as Record<string, unknown> | null)?.body, 4000)
    if (!message) return c.json({ error: 'Write a message first.' }, 400)
    const threadId = await ensureThread(db, projectId, project.name)
    await db
      .prepare(
        'INSERT INTO messages (id, thread_id, author_role, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        threadId,
        'admin',
        member.name || 'Studio',
        message,
        Date.now(),
      )
      .run()
    const client = await clientById(db, project.client_id)
    if (client) {
      await notify(db, c.env, [
        {
          audience: 'client',
          clientId: client.id,
          projectId,
          title: `New message on ${project.name}`,
          body: message.slice(0, 280),
          channels: ['email'],
          email: client.email,
        },
      ])
    }
    return c.json({ ok: true }, 201)
  })

  // ---------------------------------------------------- admin: notifications

  app.post('/api/admin/notifications/read', async (c) => {
    const db = c.get('db')
    const body: unknown = await c.req.json().catch(() => null)
    const ids = Array.isArray((body as { ids?: unknown })?.ids)
      ? ((body as { ids: unknown[] }).ids.filter(
          (id): id is string => typeof id === 'string',
        ) as string[])
      : []
    if (!ids.length)
      await db
        .prepare(
          "UPDATE notifications SET read_at = ? WHERE audience = 'admin' AND channel = 'in_app' AND read_at IS NULL",
        )
        .bind(Date.now())
        .run()
    else {
      const slots = ids.map(() => '?').join(',')
      await db
        .prepare(
          `UPDATE notifications SET read_at = ? WHERE audience = 'admin' AND id IN (${slots})`,
        )
        .bind(Date.now(), ...ids)
        .run()
    }
    return c.json({ ok: true })
  })

  // -------------------------------------------------------------- client API

  app.get('/api/portal', async (c) => {
    const db = c.get('db')
    const member = c.get('member')
    const requested = c.req.query('clientId')
    let clientId = member.clientId
    let preview = false
    if (member.role === 'admin') {
      if (!requested)
        return c.json({ error: 'Choose a client to preview.' }, 400)
      clientId = requested
      preview = true
    } else if (requested && requested !== member.clientId) {
      return c.json({ error: 'You do not have access to this client.' }, 403)
    }
    if (!clientId) return c.json({ error: 'No client is linked.' }, 403)
    const client = await clientById(db, clientId)
    if (!client) return c.json({ error: 'Client not found.' }, 404)
    const [projects, documents, notifications] = await Promise.all([
      loadProjects(db, clientId),
      loadDocuments(db, clientId),
      loadNotifications(db, 'client', clientId),
    ])
    const data: PortalData = {
      client,
      projects,
      documents,
      notifications,
      preview,
    }
    return c.json(data)
  })

  app.post(
    '/api/portal/projects/:id/assets',
    bodyLimit({
      maxSize: 25 * 1024 * 1024,
      onError: (ctx) =>
        ctx.json({ error: 'Files are limited to 25 MB each.' }, 413),
    }),
    async (c) => {
      const db = c.get('db')
      const member = c.get('member')
      if (member.role !== 'client' || !member.clientId)
        return c.json(
          { error: 'Only the signed-in client can upload assets.' },
          403,
        )
      const projectId = c.req.param('id')
      const project = await db
        .prepare('SELECT id, name, client_id FROM projects WHERE id = ?')
        .bind(projectId)
        .first<{ id: string; name: string; client_id: string }>()
      if (!project || project.client_id !== member.clientId)
        return c.json({ error: 'Project not found.' }, 404)
      if (!c.env.FILES)
        return c.json(
          {
            error:
              'File storage is not configured yet. Ask the agency to enable the asset drive.',
          },
          503,
        )
      const form = await c.req.parseBody()
      const file = form['file']
      if (!(file instanceof File))
        return c.json({ error: 'Choose a file to upload.' }, 400)
      if (file.size === 0)
        return c.json({ error: 'That file is empty.' }, 400)
      if (file.size > 25 * 1024 * 1024)
        return c.json({ error: 'Files are limited to 25 MB each.' }, 413)
      const category = oneOf(
        typeof form['category'] === 'string' ? form['category'] : '',
        CATEGORIES,
        'brief',
      )
      const safeName = file.name.replace(/[^\w.\-() ]+/g, '_').slice(0, 160)
      const key = `${member.clientId}/${projectId}/${crypto.randomUUID()}-${safeName}`
      await c.env.FILES.put(key, file.stream(), {
        httpMetadata: {
          contentType: file.type || 'application/octet-stream',
        },
      })
      const now = Date.now()
      await db
        .prepare(
          `INSERT INTO assets (id, project_id, client_id, category, name, kind, size, mime, storage_key, status, review_note, uploaded_by, created_at, reviewed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, NULL)`,
        )
        .bind(
          crypto.randomUUID(),
          projectId,
          member.clientId,
          category,
          safeName,
          kindFor(file.type || '', safeName),
          file.size,
          file.type || 'application/octet-stream',
          key,
          member.name || 'Client',
          now,
        )
        .run()
      await notify(db, c.env, [
        {
          audience: 'admin',
          clientId: member.clientId,
          projectId,
          title: `New assets uploaded — ${project.name}`,
          body: `${member.name || 'The client'} uploaded “${safeName}” to the ${category} folder for review.`,
          channels: ['email', 'whatsapp'],
        },
      ])
      return c.json({ ok: true }, 201)
    },
  )

  app.get('/api/portal/assets/:id/file', async (c) => {
    const db = c.get('db')
    const member = c.get('member')
    const asset = await db
      .prepare('SELECT * FROM assets WHERE id = ?')
      .bind(c.req.param('id'))
      .first<Parameters<typeof mapAsset>[0] & { storage_key: string | null }>()
    if (!asset) return c.json({ error: 'Asset not found.' }, 404)
    if (member.role !== 'admin' && asset.client_id !== member.clientId)
      return c.json({ error: 'Asset not found.' }, 404)
    if (!c.env.FILES || !asset.storage_key)
      return c.json({ error: 'This file is no longer available.' }, 404)
    const object = await c.env.FILES.get(asset.storage_key)
    if (!object) return c.json({ error: 'This file is no longer available.' }, 404)
    return new Response(object.body, {
      headers: {
        'Content-Type': asset.mime || 'application/octet-stream',
        'Content-Length': String(asset.size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        'Cache-Control': 'private, no-store',
      },
    })
  })

  app.post('/api/portal/documents/:id/sign', async (c) => {
    const db = c.get('db')
    const member = c.get('member')
    if (member.role !== 'client' || !member.clientId)
      return c.json({ error: 'Only the client can sign this document.' }, 403)
    const documentId = c.req.param('id')
    const document = await db
      .prepare('SELECT * FROM documents WHERE id = ?')
      .bind(documentId)
      .first<{
        id: string
        client_id: string
        title: string
        status: string
        project_id: string | null
      }>()
    if (!document || document.client_id !== member.clientId)
      return c.json({ error: 'Document not found.' }, 404)
    if (document.status === 'signed')
      return c.json({ error: 'This document is already signed.' }, 409)
    const body: unknown = await c.req.json().catch(() => null)
    const input = (body ?? {}) as Record<string, unknown>
    const name = text(input.name, 120)
    const image = typeof input.signature === 'string' ? input.signature : ''
    if (name.length < 2)
      return c.json({ error: 'Type your full legal name.' }, 400)
    if (!image.startsWith('data:image/png;base64,') || image.length > 400_000)
      return c.json({ error: 'Draw your signature in the signature pad.' }, 400)
    const now = Date.now()
    await db
      .prepare(
        `UPDATE documents SET status = 'signed', signature_name = ?, signature_image = ?, signed_at = ?
         WHERE id = ?`,
      )
      .bind(name, image, now, documentId)
      .run()
    const client = await clientById(db, member.clientId)
    await notify(db, c.env, [
      {
        audience: 'admin',
        clientId: member.clientId,
        projectId: document.project_id,
        title: `Signed: ${document.title}`,
        body: `${name} signed “${document.title}”${client ? ` for ${client.company}` : ''}.`,
        channels: ['email', 'whatsapp'],
      },
    ])
    return c.json({ ok: true, signedAt: now })
  })

  app.post('/api/portal/projects/:id/reviews', async (c) => {
    const db = c.get('db')
    const member = c.get('member')
    if (member.role !== 'client' || !member.clientId)
      return c.json({ error: 'Only the client can leave a review.' }, 403)
    const projectId = c.req.param('id')
    const project = await db
      .prepare('SELECT id, name, client_id FROM projects WHERE id = ?')
      .bind(projectId)
      .first<{ id: string; name: string; client_id: string }>()
    if (!project || project.client_id !== member.clientId)
      return c.json({ error: 'Project not found.' }, 404)
    const body: unknown = await c.req.json().catch(() => null)
    const input = (body ?? {}) as Record<string, unknown>
    const rating = Math.round(Number(input.rating))
    const bodyText = text(input.body, 2000)
    const milestone = text(input.milestone, 120) || 'General feedback'
    if (!Number.isFinite(rating) || rating < 1 || rating > 5)
      return c.json({ error: 'Choose a rating between 1 and 5.' }, 400)
    if (bodyText.length < 10)
      return c.json({ error: 'Tell us a little more — at least 10 characters.' }, 400)
    const now = Date.now()
    await db
      .prepare(
        `INSERT INTO reviews (id, project_id, client_id, phase_id, milestone, rating, body, author_name, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        projectId,
        member.clientId,
        milestone,
        rating,
        bodyText,
        member.name || 'Client',
        now,
      )
      .run()
    const client = await clientById(db, member.clientId)
    await notify(db, c.env, [
      {
        audience: 'admin',
        clientId: member.clientId,
        projectId,
        title: `New review — ${project.name} (${rating}/5)`,
        body: `${member.name || 'Client'} reviewed ${milestone}: “${bodyText.slice(0, 220)}”`,
        channels: ['email', 'whatsapp'],
      },
    ])
    return c.json({ ok: true }, 201)
  })

  app.post('/api/portal/projects/:id/messages', async (c) => {
    const db = c.get('db')
    const member = c.get('member')
    if (member.role !== 'client' || !member.clientId)
      return c.json({ error: 'Only the client can post here.' }, 403)
    const projectId = c.req.param('id')
    const project = await db
      .prepare('SELECT id, name, client_id FROM projects WHERE id = ?')
      .bind(projectId)
      .first<{ id: string; name: string; client_id: string }>()
    if (!project || project.client_id !== member.clientId)
      return c.json({ error: 'Project not found.' }, 404)
    const body: unknown = await c.req.json().catch(() => null)
    const message = text((body as Record<string, unknown> | null)?.body, 4000)
    if (!message) return c.json({ error: 'Write a message first.' }, 400)
    const threadId = await ensureThread(db, projectId, project.name)
    await db
      .prepare(
        'INSERT INTO messages (id, thread_id, author_role, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        threadId,
        'client',
        member.name || 'Client',
        message,
        Date.now(),
      )
      .run()
    await notify(db, c.env, [
      {
        audience: 'admin',
        clientId: member.clientId,
        projectId,
        title: `New message — ${project.name}`,
        body: `${member.name || 'Client'}: ${message.slice(0, 280)}`,
        channels: ['email'],
      },
    ])
    return c.json({ ok: true }, 201)
  })

  app.post('/api/portal/notifications/read', async (c) => {
    const db = c.get('db')
    const member = c.get('member')
    if (!member.clientId) return c.json({ ok: true })
    await db
      .prepare(
        "UPDATE notifications SET read_at = ? WHERE audience = 'client' AND channel = 'in_app' AND client_id = ? AND read_at IS NULL",
      )
      .bind(Date.now(), member.clientId)
      .run()
    return c.json({ ok: true })
  })

  app.notFound((c) =>
    c.req.path === '/api' || c.req.path.startsWith('/api/')
      ? c.json({ error: 'Endpoint not found.' }, 404)
      : c.env.ASSETS.fetch(c.req.raw),
  )
  app.onError((_error, c) =>
    c.json({ error: 'Something went wrong. Please try again.' }, 500),
  )
  return app
}

function pipelineFor(type: ProjectType): string[] {
  switch (type) {
    case 'web_app':
      return [
        'Discovery & research',
        'User flows',
        'Wireframes',
        'UI design',
        'Frontend build',
        'Backend & integrations',
        'QA & testing',
        'Launch',
        'Support & handover',
      ]
    case 'seo':
      return [
        'Technical audit',
        'Keyword research',
        'On-page optimisation',
        'Content plan',
        'Monthly reporting',
      ]
    case 'branding':
      return ['Discovery', 'Moodboards', 'Logo concepts', 'Brand system', 'Guidelines']
    case 'retainer':
      return ['Monthly planning', 'Design & build', 'Review & report']
    default:
      return [
        'Discovery & research',
        'Sitemap & architecture',
        'Wireframes',
        'Visual design',
        'Build & development',
        'Content & SEO',
        'QA & testing',
        'Launch',
        'Support & handover',
      ]
  }
}

function pipelineStatements(
  db: D1Database,
  _env: Env,
  projectId: string,
  type: ProjectType,
): D1PreparedStatement[] {
  return pipelineFor(type).map((name, index) =>
    db
      .prepare(
        `INSERT INTO phases (id, project_id, name, position, status, note, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'queued', '', NULL, NULL)`,
      )
      .bind(crypto.randomUUID(), projectId, name, index),
  )
}

async function ensureThread(
  db: D1Database,
  projectId: string,
  projectName: string,
): Promise<string> {
  const existing = await db
    .prepare('SELECT id FROM threads WHERE project_id = ?')
    .bind(projectId)
    .first<{ id: string }>()
  if (existing) return existing.id
  const id = crypto.randomUUID()
  await db
    .prepare(
      'INSERT INTO threads (id, project_id, subject, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(id, projectId, `${projectName} — project thread`, Date.now())
    .run()
  return id
}
