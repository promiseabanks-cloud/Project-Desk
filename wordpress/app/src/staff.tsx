import { useEffect, useState } from 'react'
import { ago, api, ApiError, boot, currentPhase, date, fileUrl, money, type Asset, type Client, type ConsoleData, type Doc, type Phase, type Project, type ServiceDef } from './api'
import { ClientApp, ProjectRow, Shell } from './client'
import { go, type Route } from './router'
import { AssetRow, AssetSheet, DocumentSheet, PaymentRow, Thread, Timeline, UploadSheet, useLoad } from './shared'
import { Button, CountUp, Empty, Field, Icon, Pill, Ring, Segmented, Sheet, Skeleton, toast } from './ui'

type Sheets =
  | { kind: 'onboard' }
  | { kind: 'asset'; asset: Asset }
  | { kind: 'doc'; doc: Doc }
  | { kind: 'newdoc'; client: Client; projectId?: number }
  | { kind: 'invoice'; project: Project }
  | { kind: 'upload'; project: Project }
  | { kind: 'override'; phase: Phase; status: Phase['status']; reason: string }
  | { kind: 'project'; client: Client }
  | { kind: 'notices' }
  | null

// Read through to boot so permissions are right after signing in without a reload.
const can = new Proxy({} as NonNullable<typeof boot.can>, { get: (_, key: string) => Boolean(boot.can?.[key as keyof NonNullable<typeof boot.can>]) })

export function StaffApp({ route, onSignOut }: { route: Route; onSignOut: () => void }) {
  const { data, reload, error } = useLoad<ConsoleData>('/console')
  const [sheet, setSheet] = useState<Sheets>(null)
  const [section, id] = route.path

  // Portal preview: #/clients/:id/portal/...
  if (section === 'clients' && id && route.path[2] === 'portal') {
    return <ClientApp route={{ ...route, path: ['clients', id, ...route.path.slice(3)] }} clientId={Number(id)} />
  }
  if (error && !data) return <Empty icon="alert">{error}</Empty>
  if (!data) return <Skeleton />

  const pendingAssets = data.projects.flatMap((p) => p.assets.filter((a) => a.status === 'pending').map((a) => ({ a, p })))
  const unsigned = data.documents.filter((d) => d.status === 'awaiting_signature')
  const outstanding = data.projects.flatMap((p) => p.payments).filter((p) => p.status === 'due' || p.status === 'overdue')
  const overdue = outstanding.filter((p) => p.status === 'overdue')
  const approvals = data.projects.flatMap((p) => p.phases.filter((ph) => ph.signoff && ph.approvedAt && ph.status === 'ongoing').map((ph) => ({ ph, p })))
  const clientName = (cid: number) => data.clients.find((c) => c.id === cid)?.company ?? ''
  const unread = data.notifications.filter((n) => !n.read).length

  let body: React.ReactNode
  if (section === 'projects' && id) {
    const project = data.projects.find((p) => p.id === Number(id))
    body = project ? <StaffProject project={project} client={data.clients.find((c) => c.id === project.clientId)!} data={data} reload={reload} open={setSheet} tab={route.query.get('tab') ?? 'plan'} /> : <Empty>Project not found.</Empty>
  } else if (section === 'clients' && id) {
    const client = data.clients.find((c) => c.id === Number(id))
    body = client ? <ClientDetail client={client} data={data} reload={reload} open={setSheet} /> : <Empty>Client not found.</Empty>
  } else if (section === 'clients') {
    body = <ClientList data={data} open={setSheet} />
  } else if (section === 'projects') {
    body = (
      <div className="screen">
        <header className="page-head">
          <span className="eyebrow">Projects</span>
          <h1>Everything in flight</h1>
        </header>
        <div className="list stagger">
          {data.projects.length === 0 && <Empty icon="folder">No projects yet. Onboard a client to start one.</Empty>}
          {data.projects.map((p) => (
            <ProjectRow key={p.id} project={p} extra={clientName(p.clientId)} onOpen={() => go(`projects/${p.id}`)} />
          ))}
        </div>
      </div>
    )
  } else if (section === 'review') {
    body = (
      <div className="screen">
        <header className="page-head">
          <span className="eyebrow">Review</span>
          <h1>{pendingAssets.length ? `${pendingAssets.length} to review` : 'Inbox zero'}</h1>
          <p className="muted">Files and notes clients have sent. Accept them or ask for changes with a reason.</p>
        </header>
        <div className="list stagger">
          {pendingAssets.length === 0 && <Empty icon="check">Nothing waiting. Nice.</Empty>}
          {pendingAssets.map(({ a, p }) => (
            <div key={a.id}>
              <AssetRow asset={a} onOpen={() => setSheet({ kind: 'asset', asset: a })} />
              <div className="muted" style={{ fontSize: '.78rem', margin: '-8px 0 6px 60px' }}>
                {clientName(p.clientId)} · {p.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  } else if (section === 'settings' && can.settings) {
    body = <SettingsView />
  } else {
    body = (
      <div className="screen">
        <header className="page-head">
          <span className="eyebrow">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1>Studio overview</h1>
        </header>
        <div className="kpis stagger">
          <button className="kpi" onClick={() => go('projects')}>
            <span className="eyebrow">Active projects</span>
            <strong>
              <CountUp value={data.projects.filter((p) => p.status === 'active').length} />
            </strong>
          </button>
          <button className="kpi" onClick={() => go('review')}>
            <span className="eyebrow">To review</span>
            <strong>
              <CountUp value={pendingAssets.length} />
            </strong>
          </button>
          <button className="kpi" onClick={() => go('clients')}>
            <span className="eyebrow">Awaiting signature</span>
            <strong>
              <CountUp value={unsigned.length} />
            </strong>
          </button>
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">Outstanding</span>
            <strong style={{ fontSize: '1.5rem', paddingTop: 6 }}>{money(outstanding.reduce((s, p) => s + p.amount, 0))}</strong>
          </div>
        </div>
        <section className="section">
          <div className="section-head">
            <h3>Needs attention</h3>
          </div>
          <div className="list stagger">
            {approvals.map(({ ph, p }) => (
              <button key={`a${ph.id}`} className="row" onClick={() => go(`projects/${p.id}`)}>
                <span className="icon-tile ok">
                  <Icon name="check" />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    Approved: {ph.name}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    {clientName(p.clientId)} · ready to complete
                  </span>
                </span>
                <Icon name="chevron" className="chev" />
              </button>
            ))}
            {overdue.length > 0 && (
              <div className="row">
                <span className="icon-tile bad">
                  <Icon name="alert" />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {overdue.length} overdue invoice{overdue.length > 1 ? 's' : ''}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    {money(overdue.reduce((s, p) => s + p.amount, 0))} in total
                  </span>
                </span>
              </div>
            )}
            {pendingAssets.slice(0, 4).map(({ a, p }) => (
              <button key={a.id} className="row" onClick={() => setSheet({ kind: 'asset', asset: a })}>
                <span className="icon-tile warn">
                  <Icon name="upload" />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {a.name}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    {clientName(p.clientId)} · {ago(a.createdAt)}
                  </span>
                </span>
                <Pill tone="warn">Review</Pill>
              </button>
            ))}
            {!approvals.length && !overdue.length && !pendingAssets.length && <Empty icon="sparkle">All clear.</Empty>}
          </div>
        </section>
        <section className="section">
          <div className="section-head">
            <h3>Pipeline</h3>
          </div>
          <div className="list stagger">
            {data.projects
              .filter((p) => p.status === 'active')
              .map((p) => (
                <ProjectRow key={p.id} project={p} extra={clientName(p.clientId)} onOpen={() => go(`projects/${p.id}`)} />
              ))}
          </div>
        </section>
      </div>
    )
  }

  const tabs: [string, string, string, boolean][] = [
    ['overview', 'Overview', 'grid', false],
    ['clients', 'Clients', 'users', false],
    ['projects', 'Projects', 'folder', false],
    ['review', 'Review', 'check', pendingAssets.length > 0],
    ...(can.settings ? ([['settings', 'Settings', 'settings', false]] as [string, string, string, boolean][]) : []),
  ]

  return (
    <>
      <Shell
        tabs={tabs}
        active={section ?? 'overview'}
        unread={unread}
        onBell={() => {
          setSheet({ kind: 'notices' })
          if (unread) api('/notifications/read', { method: 'POST' }).then(reload)
        }}
        onSignOut={onSignOut}
      >
        {body}
      </Shell>
      {(!section || section === 'clients') && !id && (
        <button className="fab" onClick={() => setSheet({ kind: 'onboard' })}>
          <Icon name="plus" /> Onboard client
        </button>
      )}
      {sheet?.kind === 'onboard' && <OnboardSheet services={data.services} onClose={() => setSheet(null)} onDone={(cid) => (reload(), go(`clients/${cid}`))} />}
      {sheet?.kind === 'asset' && <AssetSheet asset={sheet.asset} staff onClose={() => setSheet(null)} onChanged={reload} />}
      {sheet?.kind === 'doc' && <DocumentSheet doc={sheet.doc} canSign={false} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'newdoc' && <NewDocSheet client={sheet.client} projects={data.projects.filter((p) => p.clientId === sheet.client.id)} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'invoice' && <InvoiceSheet project={sheet.project} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'upload' && <UploadSheet projects={[sheet.project]} initialProject={sheet.project.id} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'project' && <NewProjectSheet client={sheet.client} services={data.services} onClose={() => setSheet(null)} onDone={(pid) => (reload(), go(`projects/${pid}`))} />}
      {sheet?.kind === 'override' && <OverrideSheet {...sheet} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'notices' && (
        <Sheet title="Activity" onClose={() => setSheet(null)}>
          <div className="list">
            {data.notifications.length === 0 && <Empty icon="bell">Nothing yet.</Empty>}
            {data.notifications.map((n) => (
              <div key={n.id} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="icon-tile">
                  <Icon name="bell" />
                </span>
                <span className="grow">
                  <strong style={{ display: 'block' }}>{n.title}</strong>
                  <span className="muted" style={{ fontSize: '.9rem', whiteSpace: 'pre-wrap' }}>
                    {n.body}
                  </span>
                  <span className="muted" style={{ display: 'block', fontSize: '.78rem', marginTop: 4 }}>
                    {ago(n.createdAt)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </>
  )
}

function ClientList({ data, open }: { data: ConsoleData; open: (s: Sheets) => void }) {
  const [filter, setFilter] = useState<'all' | 'onboarding' | 'active' | 'paused'>('all')
  const [q, setQ] = useState('')
  const list = data.clients.filter((c) => (filter === 'all' || c.status === filter) && (c.company + c.contactName + c.email).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="screen">
      <header className="page-head">
        <span className="eyebrow">Clients</span>
        <h1>{data.clients.length} client{data.clients.length === 1 ? '' : 's'}</h1>
      </header>
      <div className="between wrap" style={{ marginBottom: 14 }}>
        <Segmented value={filter} onChange={setFilter} options={[['all', 'All'], ['onboarding', 'Onboarding'], ['active', 'Active'], ['paused', 'Paused']]} />
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
      </div>
      <div className="list stagger">
        {list.length === 0 && (
          <Empty icon="users">
            {data.clients.length ? 'No clients match.' : 'No clients yet.'}{' '}
            {!data.clients.length && (
              <button className="link-btn" onClick={() => open({ kind: 'onboard' })}>
                Onboard your first client
              </button>
            )}
          </Empty>
        )}
        {list.map((c) => {
          const projects = data.projects.filter((p) => p.clientId === c.id)
          return (
            <button key={c.id} className="row" onClick={() => go(`clients/${c.id}`)}>
              <span className="icon-tile" style={{ fontFamily: 'var(--head)', fontWeight: 700 }}>
                {c.company.slice(0, 1).toUpperCase()}
              </span>
              <span className="grow">
                <span className="title" style={{ display: 'block' }}>
                  {c.company}
                </span>
                <span className="sub" style={{ display: 'block' }}>
                  {c.contactName} · {projects.length} project{projects.length === 1 ? '' : 's'}
                </span>
              </span>
              <Pill tone={c.status === 'active' ? 'ok' : c.status === 'onboarding' ? 'warn' : ''}>{c.status[0].toUpperCase() + c.status.slice(1)}</Pill>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ClientDetail({ client, data, reload, open }: { client: Client; data: ConsoleData; reload: () => void; open: (s: Sheets) => void }) {
  const projects = data.projects.filter((p) => p.clientId === client.id)
  const docs = data.documents.filter((d) => d.clientId === client.id)
  const setStatus = async (status: string) => {
    await api(`/clients/${client.id}`, { method: 'PATCH', body: { status } })
    toast('Client updated')
    reload()
  }
  return (
    <div className="screen">
      <button className="link-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', marginBottom: 14 }} onClick={() => go('clients')}>
        <Icon name="back" className="chev" /> Clients
      </button>
      <header className="page-head">
        <span className="eyebrow">{client.industry || 'Client'}</span>
        <h1>{client.company}</h1>
        <p className="muted">
          {client.contactName} · <a href={`mailto:${client.email}`}>{client.email}</a>
          {client.phone ? ` · ${client.phone}` : ''}
        </p>
      </header>
      <div className="gap wrap">
        <Button variant="quiet small" icon="eye" onClick={() => go(`clients/${client.id}/portal`)}>
          See their portal
        </Button>
        <Button
          variant="quiet small"
          icon="mail"
          onClick={async () => {
            await api(`/clients/${client.id}/invite`, { method: 'POST' })
            toast('Invite sent', `A fresh link went to ${client.email}.`)
          }}
        >
          Resend invite
        </Button>
        <select className="input" style={{ width: 'auto', minHeight: 36 }} value={client.status} onChange={(e) => setStatus(e.target.value)} aria-label="Client status">
          {['onboarding', 'active', 'paused', 'archived'].map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <section className="section">
        <div className="section-head">
          <h3>Projects</h3>
          <Button variant="ghost small" icon="plus" onClick={() => open({ kind: 'project', client })}>
            New project
          </Button>
        </div>
        <div className="list stagger">
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} onOpen={() => go(`projects/${p.id}`)} />
          ))}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h3>Documents</h3>
          <Button variant="ghost small" icon="plus" onClick={() => open({ kind: 'newdoc', client })}>
            New document
          </Button>
        </div>
        <div className="list stagger">
          {docs.map((d) => (
            <button key={d.id} className="row" onClick={() => open({ kind: 'doc', doc: d })}>
              <span className={`icon-tile ${d.status === 'signed' ? 'ok' : 'warn'}`}>
                <Icon name={d.status === 'signed' ? 'check' : 'sign'} />
              </span>
              <span className="grow">
                <span className="title" style={{ display: 'block' }}>
                  {d.title}
                </span>
                <span className="sub" style={{ display: 'block' }}>
                  {d.status === 'signed' ? `Signed ${date(d.signedAt)} by ${d.signatureName}` : `Sent ${date(d.createdAt)}`}
                </span>
              </span>
              <Pill tone={d.status === 'signed' ? 'ok' : 'warn'}>{d.status === 'signed' ? 'Signed' : 'Waiting'}</Pill>
            </button>
          ))}
        </div>
      </section>
      {client.notes && (
        <section className="section">
          <h3 style={{ marginBottom: 8 }}>Notes</h3>
          <p className="note-text">{client.notes}</p>
        </section>
      )}
    </div>
  )
}

function StaffProject({ project, client, reload, open, tab }: { project: Project; client: Client; data: ConsoleData; reload: () => void; open: (s: Sheets) => void; tab: string }) {
  const [newPhase, setNewPhase] = useState('')
  const setTab = (t: string) => go(`projects/${project.id}?tab=${t}`, true)
  const setPhase = async (phase: Phase, status: Phase['status']) => {
    try {
      await api(`/phases/${phase.id}`, { method: 'PATCH', body: { status } })
      toast(status === 'completed' ? `${phase.name} complete` : status === 'ongoing' ? `${phase.name} started` : `${phase.name} reset`, 'The client has been told.')
      reload()
    } catch (e) {
      if (e instanceof ApiError && e.code.startsWith('pd_gate') && can.override) open({ kind: 'override', phase, status, reason: e.message })
      else toast('Not yet', (e as Error).message, 'bad')
    }
  }
  const latest = project.assets.filter((a) => !project.assets.some((n) => n.versionOf === a.id))
  const phase = currentPhase(project)
  return (
    <div className="screen">
      <button className="link-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', marginBottom: 14 }} onClick={() => go(`clients/${client.id}`)}>
        <Icon name="back" className="chev" /> {client.company}
      </button>
      <div className="hero">
        <div className="hero-row">
          <div style={{ minWidth: 0 }}>
            <span className="eyebrow">{project.serviceLabel}</span>
            <h2>{project.name}</h2>
            <div className="hero-meta">{project.dueDate ? `Target ${date(project.dueDate)}` : `Started ${date(project.startDate)}`}</div>
          </div>
          <Ring value={project.progress} />
        </div>
        <span className="current">
          <span className="signal-dot" /> {project.workUnlocked ? (phase ? `Now: ${phase.name}` : 'All phases done') : 'Waiting for signature and deposit'}
        </span>
      </div>
      <div style={{ margin: '22px 0 18px' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ['plan', 'Plan'],
            ['files', `Files · ${latest.length}`],
            ['money', 'Money'],
            ['messages', `Messages · ${project.messages.length}`],
          ]}
        />
      </div>
      {tab === 'files' ? (
        <div key="files">
          <div className="between" style={{ marginBottom: 10 }}>
            <span className="muted">{latest.filter((a) => a.status === 'pending').length} waiting for review</span>
            <Button variant="ghost small" icon="upload" onClick={() => open({ kind: 'upload', project })}>
              Share a file
            </Button>
          </div>
          <div className="list stagger">
            {latest.length === 0 && <Empty icon="upload">No files yet.</Empty>}
            {latest.map((a) => (
              <AssetRow key={a.id} asset={a} onOpen={() => open({ kind: 'asset', asset: a })} />
            ))}
          </div>
        </div>
      ) : tab === 'money' ? (
        <div key="money">
          {project.price > 0 && (
            <div className="card price-card">
              <div>
                <span className="eyebrow">Price</span>
                <strong className="amount">{money(project.price)}</strong>
              </div>
              <div>
                <span className="eyebrow">Deposit {project.depositPercent}%</span>
                <strong className="amount">{money(Math.round((project.price * project.depositPercent) / 100))}</strong>
              </div>
              <div>
                <span className="eyebrow">Paid</span>
                <strong className="amount">{money(project.payments.filter((p) => p.status === 'paid').reduce((t, p) => t + p.amount, 0))}</strong>
              </div>
            </div>
          )}
          <div className="between" style={{ marginBottom: 10 }}>
            <span className="muted">
              {project.workUnlocked ? 'Deposit received' : project.price > 0 ? 'The deposit invoice goes out automatically when the agreement is signed' : 'Work starts when a deposit is confirmed'}
            </span>
            {can.money && (
              <Button variant="ghost small" icon="plus" onClick={() => open({ kind: 'invoice', project })}>
                Add invoice
              </Button>
            )}
          </div>
          <div className="list stagger">
            {project.payments.length === 0 && <Empty icon="wallet">No invoices yet.</Empty>}
            {project.payments.map((p) => {
              const unpaid = p.status !== 'paid' && p.status !== 'cancelled'
              return (
                <div key={p.id} className="pay-card">
                  <PaymentRow
                    p={p}
                    action={
                      can.money && unpaid ? (
                        <Button
                          variant={p.proofAt ? 'accent small' : 'ghost small'}
                          onClick={async () => {
                            await api(`/payments/${p.id}`, { method: 'PATCH', body: { status: 'paid', method: 'Bank transfer' } })
                            toast('Payment confirmed', 'The client gets their receipt by email.')
                            reload()
                          }}
                        >
                          {p.proofAt ? 'Confirm payment' : 'Mark paid'}
                        </Button>
                      ) : undefined
                    }
                  />
                  {(p.proofAt || p.externalUrl) && (
                    <div className="pay-actions">
                      {p.proofAssetId && (
                        <a className="btn quiet small" href={fileUrl(p.proofAssetId)} target="_blank" rel="noopener">
                          <Icon name="file" />
                          View proof
                        </a>
                      )}
                      {p.proofNote && <span className="muted pay-note">“{p.proofNote}”</span>}
                      {p.externalUrl && (
                        <a className="btn ghost small" href={p.externalUrl} target="_blank" rel="noopener">
                          InvoiceNaija invoice
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : tab === 'messages' ? (
        <Thread key="messages" project={project} me="staff" onSent={reload} />
      ) : (
        <div key="plan">
          <Timeline project={project} mode="staff" onSet={setPhase} />
          <div className="gap" style={{ marginTop: 6 }}>
            <input className="input" placeholder="Add a phase" value={newPhase} onChange={(e) => setNewPhase(e.target.value)} />
            <Button
              variant="ghost"
              icon="plus"
              disabled={!newPhase.trim()}
              onClick={async () => {
                await api(`/projects/${project.id}/phases`, { body: { name: newPhase } })
                setNewPhase('')
                reload()
              }}
            >
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function OnboardSheet({ services, onClose, onDone }: { services: Record<string, ServiceDef>; onClose: () => void; onDone: (clientId: number) => void }) {
  const keys = Object.keys(services)
  const [f, setF] = useState({ company: '', contactName: '', email: '', phone: '', industry: '', service: keys[0] ?? 'website', projectName: '', dueDate: '', notes: '', price: '', depositPercent: String(boot.brand.depositPercent ?? 50) })
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const svc = services[f.service]
  const submit = async () => {
    setError('')
    try {
      const r = await api<{ clientId: number }>('/clients', { body: f })
      toast(`${f.company} is onboarded`, `Invite and agreement sent to ${f.email}.`)
      onClose()
      onDone(r.clientId)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Sheet title="Onboard a client" onClose={onClose}>
      <p className="muted" style={{ marginBottom: 20 }}>
        Creates their portal, emails an invite, sets up the project with its phases and sends the service agreement to sign.
      </p>
      {error && <div className="form-error">{error}</div>}
      <Field label="Company">
        <input value={f.company} onChange={set('company')} />
      </Field>
      <div className="grid-2">
        <Field label="Contact name">
          <input value={f.contactName} onChange={set('contactName')} autoComplete="off" />
        </Field>
        <Field label="Contact email">
          <input type="email" value={f.email} onChange={set('email')} autoComplete="off" />
        </Field>
        <Field label="Phone (WhatsApp)">
          <input type="tel" value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Industry">
          <input value={f.industry} onChange={set('industry')} />
        </Field>
      </div>
      <Field label="Service">
        <select value={f.service} onChange={set('service')}>
          {keys.map((k) => (
            <option key={k} value={k}>
              {services[k].label}
            </option>
          ))}
        </select>
      </Field>
      {svc && (
        <div className="card" style={{ marginTop: -6, marginBottom: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {svc.phases.length} phases{svc.recurring ? ' · monthly' : ''}
          </div>
          <div className="chips">
            {svc.phases.map((p) => (
              <span key={p.name} className="pill">
                {p.name}
                {p.signoff ? ' ✓' : ''}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="grid-2">
        <Field label="Project name (optional)">
          <input value={f.projectName} onChange={set('projectName')} placeholder={f.company ? `${f.company} — ${svc?.label ?? ''}` : ''} />
        </Field>
        <Field label="Target date (optional)">
          <input type="date" value={f.dueDate} onChange={set('dueDate')} />
        </Field>
      </div>
      {can.money && <PriceFields price={f.price} pct={f.depositPercent} onChange={(price, depositPercent) => setF({ ...f, price, depositPercent })} />}
      <Field label="Notes (only your team sees these)">
        <textarea value={f.notes} onChange={set('notes')} />
      </Field>
      <Button variant="accent block" icon="sparkle" disabled={!f.company || !f.contactName || !f.email} onClick={submit}>
        Onboard {f.company || 'client'}
      </Button>
    </Sheet>
  )
}

/** Naira amount typed by a person, to a number (or 0). */
const naira = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || 0

function PriceFields({ price, pct, onChange }: { price: string; pct: string; onChange: (price: string, pct: string) => void }) {
  const amount = naira(price)
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  return (
    <div className="money-fields">
      <div className="grid-2">
        <Field label={`Project price (${boot.brand.currency})`}>
          <input inputMode="decimal" value={price} onChange={(e) => onChange(e.target.value, pct)} placeholder="1,500,000" />
        </Field>
        <Field label="Deposit %">
          <input inputMode="numeric" value={pct} onChange={(e) => onChange(price, e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
        </Field>
      </div>
      <p className="hint">
        {amount > 0 ? (
          <>
            The agreement states the price. When it is signed, a <strong>{money(Math.round(amount * p))}</strong> deposit invoice goes to the client automatically.
          </>
        ) : (
          'Optional. With a price, the deposit invoice goes out automatically once the agreement is signed.'
        )}
      </p>
    </div>
  )
}

function NewProjectSheet({ client, services, onClose, onDone }: { client: Client; services: Record<string, ServiceDef>; onClose: () => void; onDone: (id: number) => void }) {
  const keys = Object.keys(services)
  const [name, setName] = useState('')
  const [service, setService] = useState(keys[0] ?? '')
  const [dueDate, setDue] = useState('')
  const [price, setPrice] = useState('')
  const [pct, setPct] = useState(String(boot.brand.depositPercent ?? 50))
  return (
    <Sheet title={`New project for ${client.company}`} onClose={onClose}>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Service">
        <select value={service} onChange={(e) => setService(e.target.value)}>
          {keys.map((k) => (
            <option key={k} value={k}>
              {services[k].label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Target date (optional)">
        <input type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} />
      </Field>
      {can.money && <PriceFields price={price} pct={pct} onChange={(a, b) => (setPrice(a), setPct(b))} />}
      <Button
        variant="accent block"
        disabled={!name.trim()}
        onClick={async () => {
          const r = await api<{ projectId: number }>('/projects', { body: { clientId: client.id, name, service, dueDate, ...(can.money ? { price, depositPercent: pct } : {}) } })
          toast('Project created')
          onClose()
          onDone(r.projectId)
        }}
      >
        Create project
      </Button>
    </Sheet>
  )
}

function NewDocSheet({ client, projects, onClose, onDone }: { client: Client; projects: Project[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('sow')
  const [projectId, setProjectId] = useState(projects[0]?.id ?? 0)
  const [body, setBody] = useState('')
  return (
    <Sheet title="New document to sign" onClose={onClose}>
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Statement of work" />
      </Field>
      <div className="grid-2">
        <Field label="Type">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="sow">Statement of work</option>
            <option value="agreement">Agreement</option>
            <option value="nda">NDA</option>
            <option value="retainer">Retainer</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Project">
          <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
            <option value={0}>None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Text">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 260 }} />
      </Field>
      <Button
        variant="accent block"
        disabled={!title.trim() || !body.trim()}
        onClick={async () => {
          await api('/documents', { body: { clientId: client.id, projectId, title, kind, body } })
          toast('Sent for signature', `${client.contactName} has been emailed.`)
          onDone()
          onClose()
        }}
      >
        Send for signature
      </Button>
    </Sheet>
  )
}

function InvoiceSheet({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: () => void }) {
  const hasDeposit = project.payments.some((p) => p.kind === 'deposit')
  const [f, setF] = useState({ label: hasDeposit ? '' : 'Deposit', amount: '', kind: hasDeposit ? 'milestone' : 'deposit', dueDate: '' })
  return (
    <Sheet title="Add invoice" onClose={onClose}>
      <div className="grid-2">
        <Field label="Label">
          <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </Field>
        <Field label={`Amount (${boot.brand.currency})`}>
          <input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="250,000" />
        </Field>
        <Field label="Type">
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="deposit">Deposit (starts the work when paid)</option>
            <option value="milestone">Milestone</option>
            <option value="balance">Balance</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        <Field label="Due date">
          <input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </Field>
      </div>
      <Button
        variant="accent block"
        disabled={!f.label.trim() || !f.amount}
        onClick={async () => {
          await api(`/projects/${project.id}/payments`, { body: f })
          toast('Invoice added', 'The client has been emailed.')
          onDone()
          onClose()
        }}
      >
        Add invoice
      </Button>
    </Sheet>
  )
}

function OverrideSheet({ phase, status, reason, onClose, onDone }: { phase: Phase; status: Phase['status']; reason: string; onClose: () => void; onDone: () => void }) {
  return (
    <Sheet title="Go ahead anyway?" onClose={onClose}>
      <div className="form-error" style={{ animation: 'none' }}>
        {reason}
      </div>
      <p className="muted" style={{ marginBottom: 20 }}>
        As an owner you can override this, for example when the client paid outside the portal or approved by phone. The client is still notified.
      </p>
      <Button
        variant="danger"
        onClick={async () => {
          await api(`/phases/${phase.id}`, { method: 'PATCH', body: { status, override: true } })
          toast('Done', `${phase.name} updated.`)
          onDone()
          onClose()
        }}
      >
        Override and continue
      </Button>
    </Sheet>
  )
}

type SettingsData = {
  businessName: string
  brandColor: string
  logoUrl: string
  currency: string
  portalUrl: string
  staffAlertEmail: string
  googleClientId: string
  maxUploadMb: number
  services: Record<string, ServiceDef>
  agreement: string
  legalName: string
  rcNumber: string
  businessEmail: string
  businessPhone: string
  businessAddress: string
  businessWebsite: string
  tagline: string
  emailLogoUrl: string
  emailLogoDefault: string
  depositPercent: number
  invoiceDueDays: number
  bankDetails: string
  invoiceNaija: boolean
}

function SettingsView() {
  const [s, setS] = useState<SettingsData | null>(null)
  const [team, setTeam] = useState<{ id: number; name: string; email: string; role: string }[]>([])
  const [invite, setInvite] = useState({ name: '', email: '', role: 'manager' })
  const [tab, setTab] = useState<'brand' | 'business' | 'services' | 'agreement' | 'team'>('brand')
  useEffect(() => {
    api<SettingsData>('/settings').then(setS)
    if (can.staff) api<typeof team>('/staff').then(setTeam)
  }, [])
  if (!s) return <Skeleton />
  const save = async (patch: Partial<SettingsData>) => {
    await api('/settings', { method: 'PUT', body: patch })
    toast('Settings saved', 'Reload the app to see brand changes everywhere.')
  }
  const phasesText = (svc: ServiceDef) => svc.phases.map((p) => (p.signoff ? `${p.name} *` : p.name)).join('\n')
  return (
    <div className="screen">
      <header className="page-head">
        <span className="eyebrow">Settings</span>
        <h1>Your business</h1>
      </header>
      <div style={{ marginBottom: 22 }}>
        <Segmented value={tab} onChange={setTab} options={[['brand', 'Brand'], ['business', 'Business & billing'], ['services', 'Services'], ['agreement', 'Agreement'], ...(can.staff ? ([['team', 'Team']] as ['team', string][]) : [])]} />
      </div>
      {tab === 'brand' && (
        <div key="brand" className="screen">
          <div className="grid-2">
            <Field label="Business name">
              <input value={s.businessName} onChange={(e) => setS({ ...s, businessName: e.target.value })} />
            </Field>
            <Field label="Brand colour">
              <input value={s.brandColor} onChange={(e) => setS({ ...s, brandColor: e.target.value })} />
            </Field>
            <Field label="Logo URL" hint="Leave empty to use the built-in mark.">
              <input value={s.logoUrl} onChange={(e) => setS({ ...s, logoUrl: e.target.value })} />
            </Field>
            <Field label="Currency">
              <input value={s.currency} maxLength={3} onChange={(e) => setS({ ...s, currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Portal address" hint="For example https://clients.bankssolution.ng/">
              <input value={s.portalUrl} onChange={(e) => setS({ ...s, portalUrl: e.target.value })} />
            </Field>
            <Field label="Team alert email">
              <input type="email" value={s.staffAlertEmail} onChange={(e) => setS({ ...s, staffAlertEmail: e.target.value })} />
            </Field>
            <Field label="Google sign-in client ID" hint="From Google Cloud. Leave empty to hide Google sign-in.">
              <input value={s.googleClientId} onChange={(e) => setS({ ...s, googleClientId: e.target.value })} />
            </Field>
            <Field label="Largest upload (MB)">
              <input type="number" value={s.maxUploadMb} onChange={(e) => setS({ ...s, maxUploadMb: Number(e.target.value) })} />
            </Field>
          </div>
          <Button variant="accent" onClick={() => save({ businessName: s.businessName, brandColor: s.brandColor, logoUrl: s.logoUrl, currency: s.currency, portalUrl: s.portalUrl, staffAlertEmail: s.staffAlertEmail, googleClientId: s.googleClientId, maxUploadMb: s.maxUploadMb })}>
            Save
          </Button>
        </div>
      )}
      {tab === 'business' && (
        <div key="business" className="screen">
          <p className="muted" style={{ marginBottom: 18 }}>
            These details sign off every email the portal sends: logo and name at the top, legal name, RC number, address and contacts in the footer.
          </p>
          <div className="grid-2">
            <Field label="Legal name">
              <input value={s.legalName} onChange={(e) => setS({ ...s, legalName: e.target.value })} />
            </Field>
            <Field label="RC number">
              <input value={s.rcNumber} onChange={(e) => setS({ ...s, rcNumber: e.target.value })} />
            </Field>
            <Field label="Address">
              <input value={s.businessAddress} onChange={(e) => setS({ ...s, businessAddress: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input type="tel" value={s.businessPhone} onChange={(e) => setS({ ...s, businessPhone: e.target.value })} />
            </Field>
            <Field label="Email">
              <input type="email" value={s.businessEmail} onChange={(e) => setS({ ...s, businessEmail: e.target.value })} />
            </Field>
            <Field label="Website">
              <input value={s.businessWebsite} onChange={(e) => setS({ ...s, businessWebsite: e.target.value })} />
            </Field>
          </div>
          <Field label="Tagline">
            <input value={s.tagline} onChange={(e) => setS({ ...s, tagline: e.target.value })} />
          </Field>
          <Field label="Email logo (PNG or JPG URL)" hint="Leave empty to use your site icon. SVG logos do not show in most mail apps.">
            <div className="logo-field">
              <img src={s.emailLogoUrl || s.emailLogoDefault} alt="" />
              <input value={s.emailLogoUrl} placeholder={s.emailLogoDefault} onChange={(e) => setS({ ...s, emailLogoUrl: e.target.value })} />
            </div>
          </Field>
          <div className="eyebrow" style={{ margin: '10px 0 12px' }}>
            Billing
          </div>
          <div className="grid-2">
            <Field label="Deposit %" hint="Pre-filled when you onboard a client.">
              <input type="number" min={0} max={100} value={s.depositPercent} onChange={(e) => setS({ ...s, depositPercent: Number(e.target.value) })} />
            </Field>
            <Field label="Invoices due after (days)">
              <input type="number" min={0} max={90} value={s.invoiceDueDays} onChange={(e) => setS({ ...s, invoiceDueDays: Number(e.target.value) })} />
            </Field>
          </div>
          {s.invoiceNaija ? (
            <div className="card" style={{ marginBottom: 18 }}>
              <strong>InvoiceNaija is connected.</strong>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                Invoices are raised and emailed by InvoiceNaija, with its bank accounts, VAT and pay page. Payments confirmed here are recorded there, and its receipt goes to the client.
              </p>
            </div>
          ) : (
            <Field label="Bank details for invoices" hint="Shown in invoice emails. Account name, bank and number.">
              <textarea value={s.bankDetails} onChange={(e) => setS({ ...s, bankDetails: e.target.value })} />
            </Field>
          )}
          <Button
            variant="accent"
            onClick={() =>
              save({
                legalName: s.legalName,
                rcNumber: s.rcNumber,
                businessAddress: s.businessAddress,
                businessPhone: s.businessPhone,
                businessEmail: s.businessEmail,
                businessWebsite: s.businessWebsite,
                tagline: s.tagline,
                emailLogoUrl: s.emailLogoUrl,
                depositPercent: s.depositPercent,
                invoiceDueDays: s.invoiceDueDays,
                bankDetails: s.bankDetails,
              })
            }
          >
            Save
          </Button>
        </div>
      )}
      {tab === 'services' && (
        <div key="services" className="screen">
          <p className="muted" style={{ marginBottom: 18 }}>
            One phase per line. End a line with * when the client must approve that phase. Changes apply to new projects.
          </p>
          {Object.entries(s.services).map(([key, svc]) => (
            <div key={key} className="card" style={{ marginBottom: 14 }}>
              <div className="grid-2">
                <Field label="Service name">
                  <input value={svc.label} onChange={(e) => setS({ ...s, services: { ...s.services, [key]: { ...svc, label: e.target.value } } })} />
                </Field>
                <label className="check" style={{ alignSelf: 'center' }}>
                  <input type="checkbox" checked={svc.recurring} onChange={(e) => setS({ ...s, services: { ...s.services, [key]: { ...svc, recurring: e.target.checked } } })} />
                  <span>Monthly service (never closes on its own)</span>
                </label>
              </div>
              <Field label="Phases">
                <textarea
                  defaultValue={phasesText(svc)}
                  style={{ minHeight: 160 }}
                  onBlur={(e) =>
                    setS({
                      ...s,
                      services: {
                        ...s.services,
                        [key]: {
                          ...svc,
                          phases: e.target.value
                            .split('\n')
                            .map((l) => l.trim())
                            .filter(Boolean)
                            .map((l) => ({ name: l.replace(/\s*\*$/, ''), signoff: /\*$/.test(l) })),
                        },
                      },
                    })
                  }
                />
              </Field>
            </div>
          ))}
          <Button variant="accent" onClick={() => save({ services: s.services })}>
            Save services
          </Button>
        </div>
      )}
      {tab === 'agreement' && (
        <div key="agreement" className="screen">
          <Field label="Service agreement" hint="Placeholders: {business}, {company}, {service}, {price}, {deposit_percent}, {deposit}, {date}. Sent to every new client.">
            <textarea value={s.agreement} onChange={(e) => setS({ ...s, agreement: e.target.value })} style={{ minHeight: 420, fontSize: '.92rem' }} />
          </Field>
          <Button variant="accent" onClick={() => save({ agreement: s.agreement })}>
            Save agreement
          </Button>
        </div>
      )}
      {tab === 'team' && (
        <div key="team" className="screen">
          <div className="list" style={{ marginBottom: 26 }}>
            {team.map((m) => (
              <div key={m.id} className="row">
                <span className="icon-tile" style={{ fontFamily: 'var(--head)', fontWeight: 700 }}>
                  {m.name.slice(0, 1)}
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {m.name}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    {m.email}
                  </span>
                </span>
                <Pill tone={m.role === 'owner' ? 'live' : ''}>{m.role === 'owner' ? 'Owner' : 'Project manager'}</Pill>
              </div>
            ))}
          </div>
          <h3 style={{ marginBottom: 14 }}>Invite a team member</h3>
          <div className="grid-2">
            <Field label="Name">
              <input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            </Field>
          </div>
          <Field label="Role" hint="Project managers run projects but can't see settings, change invoices or add staff.">
            <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              <option value="manager">Project manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Button
            variant="accent"
            icon="mail"
            disabled={!invite.email}
            onClick={async () => {
              await api('/staff', { body: invite })
              toast('Invite sent', `${invite.email} can now join.`)
              setInvite({ name: '', email: '', role: 'manager' })
              setTeam(await api('/staff'))
            }}
          >
            Send invite
          </Button>
        </div>
      )}
    </div>
  )
}
