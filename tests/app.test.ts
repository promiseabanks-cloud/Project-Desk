import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Miniflare } from 'miniflare'
import { createApp } from '../src/worker/app'
import { currentUser, type Env } from '../src/worker/auth'

const runtime = new Miniflare({
  workers: [
    {
      config: {
        name: 'test-db',
        compatibilityDate: '2026-11-11',
        manifest: {
          mainModule: 'index.js',
          modules: {
            'index.js': {
              type: 'esm',
              contents:
                'export default { fetch() { return new Response("test") } }',
            },
          },
        },
        env: { DB: { type: 'd1', name: 'project-desk-test' } },
      },
    },
  ],
  port: 0,
})

/** Minimal in-memory R2 stand-in for the upload route. */
function memoryFiles() {
  const store = new Map<string, { body: string; type: string }>()
  return {
    store,
    bucket: {
      async put(key: string, value: ReadableStream | string, options?: { httpMetadata?: { contentType?: string } }) {
        const body =
          typeof value === 'string'
            ? value
            : await new Response(value).text()
        store.set(key, { body, type: options?.httpMetadata?.contentType ?? '' })
      },
      async get(key: string) {
        const entry = store.get(key)
        if (!entry) return null
        return {
          body: new Blob([entry.body]).stream(),
          async text() {
            return entry.body
          },
        }
      },
    },
  }
}

let env: Env
const files = memoryFiles()

beforeAll(async () => {
  const db = await runtime.getD1Database('DB')
  env = {
    DB: db as unknown as D1Database,
    FILES: files.bucket as unknown as R2Bucket,
    APP_ORIGIN: 'https://app.example.test',
    ASSETS: {
      fetch: async () => new Response('public page'),
    } as unknown as Fetcher,
  }
}, 20_000)
afterAll(() => runtime.dispose())

// This identity seam exists only in the app factory. The Worker entrypoint
// never reads these test headers and always calls the real auth SDK.
const app = createApp(async (request) => {
  const sub = request.headers.get('test-user')
  if (!sub) return null
  return {
    sub,
    name: request.headers.get('test-name') ?? undefined,
    email: request.headers.get('test-email') ?? undefined,
  }
})

type Identity = { sub: string; email?: string; name?: string }

const call = (
  path: string,
  identity?: Identity,
  method = 'GET',
  body?: unknown,
  origin = env.APP_ORIGIN!,
) =>
  app.request(
    `https://app.example.test${path}`,
    {
      method,
      headers: {
        ...(identity
          ? {
              'test-user': identity.sub,
              ...(identity.email ? { 'test-email': identity.email } : {}),
              ...(identity.name ? { 'test-name': identity.name } : {}),
            }
          : {}),
        Origin: origin,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  )

const admin: Identity = {
  sub: 'admin-1',
  email: 'studio@agency.test',
  name: 'Studio',
}
const amara: Identity = {
  sub: 'client-1',
  email: 'amara@northwindcoffee.com',
  name: 'Amara Okafor',
}
const tunde: Identity = {
  sub: 'client-2',
  email: 'tunde@lumenclinic.ng',
  name: 'Dr. Tunde Bello',
}

test('unauthenticated data routes refuse access and public assets stay public', async () => {
  for (const [path, method] of [
    ['/api/admin/data', 'GET'],
    ['/api/portal', 'GET'],
    ['/api/portal/documents/absent/sign', 'POST'],
    ['/api/admin/assets/absent', 'PATCH'],
  ]) {
    const response = await call(path!, undefined, method)
    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  }
  expect(await (await call('/')).text()).toBe('public page')
  expect((await call('/api/health')).status).toBe(200)
})

test('the first account becomes the agency admin and the desk is seeded', async () => {
  const session = (await (await call('/api/session', admin)).json()) as {
    role: string
    clientId: string | null
  }
  expect(session.role).toBe('admin')
  expect(session.clientId).toBeNull()

  const data = (await (await call('/api/admin/data', admin)).json()) as {
    clients: Array<{ id: string; company: string }>
    projects: Array<{ id: string; clientId: string; phases: Array<{ status: string }>; assets: unknown[] }>
    documents: Array<{ status: string }>
    channels: { email: boolean; whatsapp: boolean; storage: boolean }
  }
  expect(data.clients.length).toBe(3)
  expect(data.projects.length).toBe(4)
  expect(data.projects[0]!.phases.length).toBeGreaterThan(0)
  expect(data.channels.storage).toBe(true)
  expect(data.channels.email).toBe(false)
})

test('a client account is linked by email and only sees its own portal', async () => {
  const session = (await (await call('/api/session', amara)).json()) as {
    role: string
    clientId: string
  }
  expect(session.role).toBe('client')
  expect(session.clientId).toBe('cl-northwind')

  const portal = (await (await call('/api/portal', amara)).json()) as {
    client: { company: string }
    projects: Array<{ id: string; clientId: string }>
    documents: Array<{ clientId: string }>
    notifications: Array<{ clientId: string | null }>
    preview: boolean
  }
  expect(portal.client.company).toBe('Northwind Coffee Co.')
  expect(portal.preview).toBe(false)
  expect(portal.projects.length).toBe(2)
  for (const project of portal.projects) expect(project.clientId).toBe('cl-northwind')
  for (const document of portal.documents) expect(document.clientId).toBe('cl-northwind')
  for (const item of portal.notifications) expect(item.clientId).toBe('cl-northwind')

  expect((await call('/api/admin/data', amara)).status).toBe(403)

  const stranger = await call('/api/portal', { sub: 'stranger', email: 'nobody@example.test' })
  expect(stranger.status).toBe(403)

  // An admin previewing a portal is read-only.
  expect((await call('/api/portal', admin)).status).toBe(400)
  const preview = (await (await call('/api/portal?clientId=cl-northwind', admin)).json()) as {
    preview: boolean
  }
  expect(preview.preview).toBe(true)
})

test('client uploads reach the review queue and notify the agency', async () => {
  const form = new FormData()
  form.append('file', new File(['hero image bytes'], 'hero.avif', { type: 'image/avif' }))
  form.append('category', 'images')
  const upload = await app.request(
    'https://app.example.test/api/portal/projects/pr-northwind-site/assets',
    {
      method: 'POST',
      headers: { 'test-user': amara.sub, Origin: env.APP_ORIGIN! },
      body: form,
    },
    env,
  )
  expect(upload.status).toBe(201)
  expect(files.store.size).toBe(1)

  const data = (await (await call('/api/admin/data', admin)).json()) as {
    projects: Array<{ id: string; assets: Array<{ id: string; name: string; category: string; status: string; hasFile: boolean }> }>
    notifications: Array<{ channel: string; title: string; status: string }>
  }
  const project = data.projects.find((item) => item.id === 'pr-northwind-site')!
  const asset = project.assets.find((item) => item.name === 'hero.avif')!
  expect(asset.status).toBe('pending')
  expect(asset.category).toBe('images')
  expect(asset.hasFile).toBe(true)
  expect(
    data.notifications.some(
      (item) => item.title.includes('New assets uploaded') && item.channel === 'whatsapp',
    ),
  ).toBe(true)

  // A previewing admin cannot upload as the client.
  const previewForm = new FormData()
  previewForm.append('file', new File(['x'], 'x.png', { type: 'image/png' }))
  const refused = await app.request(
    'https://app.example.test/api/portal/projects/pr-northwind-site/assets',
    {
      method: 'POST',
      headers: { 'test-user': admin.sub, Origin: env.APP_ORIGIN! },
      body: previewForm,
    },
    env,
  )
  expect(refused.status).toBe(403)
})

test('asset reviews require a reason when asking for changes and notify the client', async () => {
  const data = (await (await call('/api/admin/data', admin)).json()) as {
    projects: Array<{ id: string; assets: Array<{ id: string; name: string; status: string }> }>
  }
  const project = data.projects.find((item) => item.id === 'pr-northwind-site')!
  const asset = project.assets.find((item) => item.name === 'hero.avif')!

  expect(
    (
      await call(`/api/admin/assets/${asset.id}`, admin, 'PATCH', {
        status: 'changes_requested',
      })
    ).status,
  ).toBe(400)

  expect(
    (
      await call(`/api/admin/assets/${asset.id}`, admin, 'PATCH', {
        status: 'changes_requested',
        note: 'The hero needs a 4000px original.',
      })
    ).status,
  ).toBe(200)

  const portal = (await (await call('/api/portal', amara)).json()) as {
    projects: Array<{ assets: Array<{ id: string; status: string; reviewNote: string }> }>
    notifications: Array<{ title: string; body: string; channel: string; readAt: number | null }>
  }
  const updated = portal.projects
    .flatMap((item) => item.assets)
    .find((item) => item.id === asset.id)!
  expect(updated.status).toBe('changes_requested')
  expect(updated.reviewNote).toContain('4000px')
  expect(
    portal.notifications.some((item) => item.title.includes('Changes needed')),
  ).toBe(true)

  await call(`/api/admin/assets/${asset.id}`, admin, 'PATCH', { status: 'accepted' })
  const after = (await (await call('/api/portal', amara)).json()) as {
    projects: Array<{ assets: Array<{ id: string; status: string }> }>
    notifications: Array<{ title: string }>
  }
  expect(
    after.projects.flatMap((item) => item.assets).find((item) => item.id === asset.id)!
      .status,
  ).toBe('accepted')
  expect(after.notifications.some((item) => item.title.includes('accepted'))).toBe(
    true,
  )
})

test('phase changes move the project forward and notify the client', async () => {
  const before = (await (await call('/api/admin/data', admin)).json()) as {
    projects: Array<{ id: string; phases: Array<{ id: string; name: string; status: string }> }>
  }
  const project = before.projects.find((item) => item.id === 'pr-northwind-site')!
  const queued = project.phases.find((phase) => phase.status === 'queued')!

  const response = await call(
    `/api/admin/phases/${queued.id}`,
    admin,
    'PATCH',
    { status: 'ongoing' },
  )
  expect(response.status).toBe(200)

  const portal = (await (await call('/api/portal', amara)).json()) as {
    projects: Array<{ id: string; phases: Array<{ id: string; status: string }> }>
    notifications: Array<{ title: string; body: string }>
  }
  const phases = portal.projects.find((item) => item.id === 'pr-northwind-site')!.phases
  expect(phases.filter((phase) => phase.status === 'ongoing')).toHaveLength(1)
  expect(phases.find((phase) => phase.id === queued.id)!.status).toBe('ongoing')
  expect(
    portal.notifications.some((item) => item.title.includes('in progress')),
  ).toBe(true)
})

test('clients sign their onboarding documents digitally and the agency is alerted', async () => {
  const portal = (await (await call('/api/portal', tunde)).json()) as {
    client: { company: string }
    documents: Array<{ id: string; title: string; status: string }>
  }
  expect(portal.client.company).toBe('Lumen Health Clinic')
  const document = portal.documents.find((item) => item.status === 'awaiting_signature')!
  expect(document).toBeTruthy()

  // Another client cannot sign it.
  expect(
    (
      await call(`/api/portal/documents/${document.id}/sign`, amara, 'POST', {
        name: 'Amara Okafor',
        signature: 'data:image/png;base64,AAAA',
      })
    ).status,
  ).toBe(404)

  expect(
    (
      await call(`/api/portal/documents/${document.id}/sign`, tunde, 'POST', {
        name: 'T Bello',
        signature: '',
      })
    ).status,
  ).toBe(400)

  const signed = await call(`/api/portal/documents/${document.id}/sign`, tunde, 'POST', {
    name: 'Tunde Bello',
    signature: 'data:image/png;base64,AAAA',
  })
  expect(signed.status).toBe(200)

  expect(
    (
      await call(`/api/portal/documents/${document.id}/sign`, tunde, 'POST', {
        name: 'Tunde Bello',
        signature: 'data:image/png;base64,AAAA',
      })
    ).status,
  ).toBe(409)

  const data = (await (await call('/api/admin/data', admin)).json()) as {
    documents: Array<{ id: string; status: string; signatureName: string | null }>
    notifications: Array<{ title: string; channel: string }>
  }
  const stored = data.documents.find((item) => item.id === document.id)!
  expect(stored.status).toBe('signed')
  expect(stored.signatureName).toBe('Tunde Bello')
  expect(
    data.notifications.some(
      (item) => item.title.startsWith('Signed:') && item.channel === 'whatsapp',
    ),
  ).toBe(true)
})

test('reviews are recorded and reach the agency, and payments can be settled', async () => {
  const host = await call('/api/portal', amara)
  const portal = (await host.json()) as {
    projects: Array<{ id: string; payments: Array<{ id: string; status: string }> }>
  }
  const project = portal.projects.find((item) => item.id === 'pr-northwind-site')!

  expect(
    (
      await call('/api/portal/projects/pr-northwind-site/reviews', amara, 'POST', {
        rating: 9,
        body: 'Great work on the new home page, really.',
        milestone: 'Visual design',
      })
    ).status,
  ).toBe(400)

  expect(
    (
      await call('/api/portal/projects/pr-northwind-site/reviews', amara, 'POST', {
        rating: 5,
        body: 'Great work on the new home page, really.',
        milestone: 'Visual design',
      })
    ).status,
  ).toBe(201)

  const data = (await (await call('/api/admin/data', admin)).json()) as {
    projects: Array<{ id: string; reviews: Array<{ milestone: string; rating: number }> }>
    notifications: Array<{ title: string; channel: string }>
  }
  expect(
    data.projects
      .find((item) => item.id === 'pr-northwind-site')!
      .reviews.some((item) => item.rating === 5 && item.milestone === 'Visual design'),
  ).toBe(true)
  expect(
    data.notifications.some(
      (item) => item.title.startsWith('New review') && item.channel === 'whatsapp',
    ),
  ).toBe(true)

  const unpaid = project.payments.find((item) => item.status !== 'paid')!
  expect(
    (await call(`/api/admin/payments/${unpaid.id}`, admin, 'PATCH', { status: 'paid' }))
      .status,
  ).toBe(200)
})

test('onboarding a client creates the project, pipeline and agreement', async () => {
  const created = await call('/api/admin/clients', admin, 'POST', {
    company: 'Harbour Dental',
    contactName: 'Nadia Cole',
    email: 'nadia@harbourdental.test',
    industry: 'healthcare',
    projectName: 'Website & booking',
    type: 'web_app',
    dueDate: '2027-03-01',
  })
  expect(created.status).toBe(201)
  const { clientId, projectId } = (await created.json()) as {
    clientId: string
    projectId: string
  }

  const data = (await (await call('/api/admin/data', admin)).json()) as {
    clients: Array<{ id: string; status: string }>
    projects: Array<{ id: string; phases: Array<{ status: string }> }>
    documents: Array<{ clientId: string; status: string; kind: string }>
    notifications: Array<{ title: string }>
  }
  expect(data.clients.find((item) => item.id === clientId)!.status).toBe('onboarding')
  const project = data.projects.find((item) => item.id === projectId)!
  expect(project.phases).toHaveLength(9)
  expect(project.phases.every((phase) => phase.status === 'queued')).toBe(true)
  expect(
    data.documents.some(
      (item) =>
        item.clientId === clientId &&
        item.status === 'awaiting_signature' &&
        item.kind === 'onboarding',
    ),
  ).toBe(true)
  // The invite email matches the contact, so the client can sign in and the
  // welcome notification is waiting in their own portal.
  const nadia = { sub: 'client-3', email: 'nadia@harbourdental.test' }
  const portal = (await (await call('/api/portal', nadia)).json()) as {
    client: { id: string }
    notifications: Array<{ title: string; channel: string }>
  }
  expect(portal.client.id).toBe(clientId)
  expect(
    portal.notifications.some(
      (item) => item.title.includes('Harbour Dental') && item.channel === 'in_app',
    ),
  ).toBe(true)
})

test('cross-origin mutations and bad payloads are refused', async () => {
  expect(
    (
      await call(
        '/api/admin/assets/absent',
        admin,
        'PATCH',
        { status: 'accepted' },
        'https://foreign.example',
      )
    ).status,
  ).toBe(403)

  expect(
    (
      await app.request(
        'https://app.example.test/api/admin/assets/absent',
        { method: 'PATCH', headers: { 'test-user': admin.sub } },
        env,
      )
    ).status,
  ).toBe(403)

  expect((await call('/api/admin/clients', admin, 'POST', { company: '' })).status).toBe(
    400,
  )
  expect(
    (await call('/api/admin/clients', admin, 'POST', { company: 'x'.repeat(400) })).status,
  ).toBe(400)
  expect(
    (
      await call('/api/admin/clients', admin, 'POST', {
        company: 'Duplicate Co',
        contactName: 'Dup',
        email: 'amara@northwindcoffee.com',
      })
    ).status,
  ).toBe(409)
})

test('missing database reports setup and the local preview identity stays loopback-only', async () => {
  const noDb = await app.request(
    'https://app.example.test/api/admin/data',
    { headers: { 'test-user': admin.sub } },
    { ...env, DB: undefined },
  )
  expect(noDb.status).toBe(503)

  expect(
    await currentUser(new Request('https://app.example.test/'), {} as Env),
  ).toBeNull()
  expect(
    await currentUser(new Request('http://localhost:5000/'), {
      APP_ORIGIN: 'https://app.example.test',
    } as Env),
  ).toBeNull()
  expect(
    await currentUser(new Request('http://localhost:5000/'), {} as Env),
  ).toMatchObject({ sub: 'local-preview' })
})
