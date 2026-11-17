import { useEffect, useState } from 'react'
import { ago, api, ApiError, boot, currentPhase, date, fileUrl, money, type Asset, type Client, type ConsoleData, type Doc, type Lead, type Payment, type Phase, type Project, type ServiceDef, type Task } from './api'
import { ClientApp, ProjectRow, Shell } from './client'
import { go, type Route } from './router'
import { AssetRow, AssetSheet, DocumentSheet, FilesHub, PaymentRow, PushBanner, Thread, Timeline, UploadSheet, useLoad } from './shared'
import { Button, CountUp, Empty, Field, Icon, Pill, Ring, Segmented, Sheet, Skeleton, toast } from './ui'

type Sheets =
  | { kind: 'onboard' }
  | { kind: 'convert'; lead: Lead }
  | { kind: 'task'; task?: Task; projectId?: number }
  | { kind: 'asset'; asset: Asset }
  | { kind: 'doc'; doc: Doc }
  | { kind: 'newdoc'; client: Client; projectId?: number }
  | { kind: 'invoice'; project: Project }
  | { kind: 'record'; payment: Payment; project: Project }
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
  const [setupDone, setSetupDone] = useState(false)
  const [section, id] = route.path

  // Portal preview: #/clients/:id/portal/...
  if (section === 'clients' && id && route.path[2] === 'portal') {
    return <ClientApp route={{ ...route, path: ['clients', id, ...route.path.slice(3)] }} clientId={Number(id)} />
  }
  // First run: walk a new owner through setting up their business.
  if (boot.setupNeeded && can.settings && !setupDone) {
    return <SetupWizard onDone={() => { setSetupDone(true); reload() }} />
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
  const newLeads = (data.leads ?? []).filter((l) => l.status === 'new').length
  const openTasks = (data.tasks ?? []).filter((t) => t.status !== 'done').length

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
  } else if (section === 'leads') {
    body = <LeadsView data={data} reload={reload} open={setSheet} />
  } else if (section === 'tasks') {
    body = <TasksView data={data} reload={reload} open={setSheet} />
  } else if (section === 'insights') {
    body = <InsightsView data={data} />
  } else if (section === 'money' && can.money) {
    body = <MoneyView data={data} />
  } else if (section === 'settings' && can.settings) {
    body = <SettingsView />
  } else {
    body = (
      <div className="screen">
        <header className="page-head">
          <span className="eyebrow">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1>Studio overview</h1>
          <button className="link-btn" style={{ marginTop: 6 }} onClick={() => go('insights')}>
            View studio insights →
          </button>
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
    ['leads', 'Leads', 'mail', newLeads > 0],
    ['tasks', 'Tasks', 'note', openTasks > 0],
    ...(can.money ? ([['money', 'Money', 'wallet', overdue.length > 0]] as [string, string, string, boolean][]) : []),
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
      {section === 'tasks' && (
        <button className="fab" onClick={() => setSheet({ kind: 'task' })}>
          <Icon name="plus" /> New task
        </button>
      )}
      {sheet?.kind === 'onboard' && <OnboardSheet services={data.services} onClose={() => setSheet(null)} onDone={(cid) => (reload(), go(`clients/${cid}`))} />}
      {sheet?.kind === 'convert' && <OnboardSheet services={data.services} lead={sheet.lead} onClose={() => setSheet(null)} onDone={(cid) => (reload(), go(`clients/${cid}`))} />}
      {sheet?.kind === 'task' && <TaskSheet task={sheet.task} projectId={sheet.projectId} data={data} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'asset' && <AssetSheet asset={sheet.asset} staff onClose={() => setSheet(null)} onChanged={reload} />}
      {sheet?.kind === 'doc' && <DocumentSheet doc={sheet.doc} canSign={false} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'newdoc' && <NewDocSheet client={sheet.client} projects={data.projects.filter((p) => p.clientId === sheet.client.id)} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'invoice' && <InvoiceSheet project={sheet.project} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'record' && <RecordPaymentSheet payment={sheet.payment} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'upload' && <UploadSheet projects={[sheet.project]} initialProject={sheet.project.id} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'project' && <NewProjectSheet client={sheet.client} services={data.services} onClose={() => setSheet(null)} onDone={(pid) => (reload(), go(`projects/${pid}`))} />}
      {sheet?.kind === 'override' && <OverrideSheet {...sheet} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'notices' && (
        <Sheet title="Activity" onClose={() => setSheet(null)}>
          <PushBanner />
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
  const setBill = async (phase: Phase, percent: number) => {
    try {
      await api(`/phases/${phase.id}`, { method: 'PATCH', body: { billPercent: percent } })
      toast(percent > 0 ? `${phase.name} bills ${percent}%` : `${phase.name} is no longer a payment milestone`, 'Saved.')
      reload()
    } catch (e) {
      toast('Not saved', (e as Error).message, 'bad')
    }
  }
  const latest = project.assets.filter((a) => !project.assets.some((n) => n.versionOf === a.id))
  const phase = currentPhase(project)
  // The opening gate's real state: the deposit invoice only exists once the agreement is signed,
  // so no deposit means the signature is still outstanding.
  const deposit = project.payments.find((p) => p.kind === 'deposit')
  const gateStatus = project.workUnlocked
    ? phase
      ? `Now: ${phase.name}`
      : 'All phases done'
    : !deposit
      ? 'Waiting for the signed agreement'
      : deposit.proofAt
        ? 'Deposit proof sent — confirm it to start the work'
        : 'Waiting for the deposit payment'
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
          <span className="signal-dot" /> {gateStatus}
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
          <div className="between" style={{ marginBottom: 14 }}>
            <span className="muted">
              {latest.length} file{latest.length === 1 ? '' : 's'}
              {latest.filter((a) => a.status === 'pending').length > 0 ? ` · ${latest.filter((a) => a.status === 'pending').length} to review` : ''}
            </span>
            <Button variant="ghost small" icon="upload" onClick={() => open({ kind: 'upload', project })}>
              Share a file
            </Button>
          </div>
          {latest.length === 0 ? <Empty icon="upload">No files yet. Share a deliverable or ask the client for what you need.</Empty> : <FilesHub project={project} onOpen={(a) => open({ kind: 'asset', asset: a })} />}
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
                <strong className="amount">{money(project.payments.filter((p) => p.status !== 'cancelled').reduce((t, p) => t + p.amountPaid, 0))}</strong>
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
                  {(p.proofAt || p.externalUrl || (can.money && unpaid)) && (
                    <div className="pay-actions">
                      {can.money && unpaid && (
                        <Button variant="quiet small" icon="wallet" onClick={() => open({ kind: 'record', payment: p, project })}>
                          Record payment
                        </Button>
                      )}
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
          <Timeline project={project} mode="staff" onSet={setPhase} onBill={can.money ? setBill : undefined} />
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

/** Animated money figure (kobo → formatted), eased like CountUp. */
function CountMoney({ value }: { value: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(value)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1100)
      setN(value * (1 - Math.pow(1 - p, 3)))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <>{money(Math.round(n))}</>
}

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** Owner money dashboard — collected, outstanding, overdue, expected, per-client and a 6-month trend, all from console data. */
function MoneyView({ data }: { data: ConsoleData }) {
  const clientName = (cid: number) => data.clients.find((c) => c.id === cid)?.company ?? 'Unknown'
  const pays = data.projects.flatMap((p) => p.payments.map((pay) => ({ pay, project: p })))
  const open = (s: Payment['status']) => s === 'due' || s === 'overdue'
  // What's still owed on an open invoice (full amount less any part-payments).
  const remaining = (p: Payment) => Math.max(0, p.amount - p.amountPaid)
  const sumRemaining = (list: { pay: Payment }[]) => list.reduce((s, x) => s + remaining(x.pay), 0)

  const paid = pays.filter((x) => x.pay.status === 'paid')
  const outstanding = pays.filter((x) => open(x.pay.status))
  const overdue = pays.filter((x) => x.pay.status === 'overdue')
  const awaiting = outstanding.filter((x) => x.pay.proofAt) // client sent proof, not yet confirmed

  // Collected counts every naira received, including part-payments on still-open invoices.
  const collected = pays.filter((x) => x.pay.status !== 'cancelled').reduce((s, x) => s + x.pay.amountPaid, 0)
  const owed = sumRemaining(outstanding)
  const overdueAmt = sumRemaining(overdue)

  const now = new Date()
  const thisMonth = ym(now)
  const expectedThisMonth = sumRemaining(outstanding.filter((x) => x.pay.dueDate && ym(new Date(x.pay.dueDate + 'T00:00:00')) === thisMonth))
  const rate = collected + owed > 0 ? collected / (collected + owed) : 0

  // Per-client totals, most owed first.
  const byClient = new Map<number, { collected: number; owed: number }>()
  for (const { pay, project } of pays) {
    if (pay.status === 'cancelled') continue
    const e = byClient.get(project.clientId) ?? { collected: 0, owed: 0 }
    e.collected += pay.amountPaid
    if (open(pay.status)) e.owed += remaining(pay)
    byClient.set(project.clientId, e)
  }
  const clients = [...byClient.entries()]
    .map(([cid, v]) => ({ cid, ...v }))
    .filter((c) => c.collected || c.owed)
    .sort((a, b) => b.owed - a.owed || b.collected - a.collected)
  const clientMax = Math.max(1, ...clients.map((c) => c.collected + c.owed))

  // 6-month collected trend.
  const months: { key: string; label: string; total: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ key: ym(d), label: d.toLocaleDateString('en-GB', { month: 'short' }), total: 0 })
  }
  for (const { pay } of paid) {
    if (!pay.paidAt) continue
    const key = ym(new Date(pay.paidAt))
    const m = months.find((x) => x.key === key)
    if (m) m.total += pay.amount
  }
  const trendMax = Math.max(1, ...months.map((m) => m.total))

  const recent = [...paid]
    .filter((x) => x.pay.paidAt)
    .sort((a, b) => (a.pay.paidAt! < b.pay.paidAt! ? 1 : -1))
    .slice(0, 6)

  if (pays.length === 0) {
    return (
      <div className="screen">
        <header className="page-head">
          <span className="eyebrow">Money</span>
          <h1>Where the money stands</h1>
        </header>
        <Empty icon="wallet">No invoices yet. Set a price when you onboard a client and the deposit invoice goes out automatically once the agreement is signed.</Empty>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="page-head">
        <span className="eyebrow">Money</span>
        <h1>Where the money stands</h1>
      </header>

      <div className="money-hero">
        <span className="eyebrow">Collected to date</span>
        <strong className="money-hero-figure">
          <CountMoney value={collected} />
        </strong>
        <div className="collect-bar" role="img" aria-label={`${Math.round(rate * 100)}% of invoiced money collected`}>
          <span className="fill" style={{ width: `${Math.round(rate * 100)}%` }} />
        </div>
        <span className="money-hero-sub">
          {Math.round(rate * 100)}% of invoiced money collected · {money(owed)} still outstanding
        </span>
      </div>

      <div className="money-kpis stagger">
        <div className="money-kpi">
          <span className="eyebrow">Outstanding</span>
          <strong>{money(owed)}</strong>
          <span className="kpi-foot">{outstanding.length} invoice{outstanding.length === 1 ? '' : 's'}</span>
        </div>
        <div className={`money-kpi ${overdueAmt > 0 ? 'bad' : ''}`}>
          <span className="eyebrow">Overdue</span>
          <strong>{money(overdueAmt)}</strong>
          <span className="kpi-foot">{overdue.length} invoice{overdue.length === 1 ? '' : 's'}</span>
        </div>
        <div className="money-kpi">
          <span className="eyebrow">Due this month</span>
          <strong>{money(expectedThisMonth)}</strong>
          <span className="kpi-foot">{data.projects.filter((p) => p.status !== 'cancelled').length} active project{data.projects.filter((p) => p.status !== 'cancelled').length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {awaiting.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h3>Awaiting your confirmation</h3>
            <span className="muted">{money(sumRemaining(awaiting))}</span>
          </div>
          <div className="list stagger">
            {awaiting.map(({ pay, project }) => (
              <button key={pay.id} className="row" onClick={() => go(`projects/${project.id}`)}>
                <span className="icon-tile warn">
                  <Icon name="clock" />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {clientName(project.clientId)} · {pay.label}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    Proof sent {ago(pay.proofAt)} — confirm to start the next phase
                  </span>
                </span>
                <span className="money-amt">{money(remaining(pay))}</span>
                <Icon name="chevron" className="chev" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h3>Collected by month</h3>
        </div>
        <div className="trend">
          {months.map((m) => (
            <div key={m.key} className="trend-col" title={`${m.label}: ${money(m.total)}`}>
              <span className="trend-val">{m.total > 0 ? money(m.total) : ''}</span>
              <span className="trend-bar-wrap">
                <span className={`trend-bar ${m.key === thisMonth ? 'now' : ''}`} style={{ height: `${Math.round((m.total / trendMax) * 100)}%` }} />
              </span>
              <span className="trend-label">{m.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h3>By client</h3>
        </div>
        <div className="client-money">
          {clients.map((c) => (
            <button key={c.cid} className="client-money-row" onClick={() => go(`clients/${c.cid}`)}>
              <div className="cm-top">
                <span className="cm-name">{clientName(c.cid)}</span>
                <span className="cm-figs">
                  <strong>{money(c.collected)}</strong>
                  {c.owed > 0 && <em>{money(c.owed)} owed</em>}
                </span>
              </div>
              <span className="cm-bar">
                <span className="cm-seg paid" style={{ flexGrow: Math.max(0, c.collected) }} />
                <span className="cm-seg owed" style={{ flexGrow: Math.max(0, c.owed) }} />
                <span className="cm-seg rest" style={{ flexGrow: Math.max(0, clientMax - c.collected - c.owed) }} />
              </span>
            </button>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h3>Recent payments</h3>
          </div>
          <div className="list stagger">
            {recent.map(({ pay, project }) => (
              <button key={pay.id} className="row" onClick={() => go(`projects/${project.id}`)}>
                <span className="icon-tile ok">
                  <Icon name="check" />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {clientName(project.clientId)} · {pay.label}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    Paid {ago(pay.paidAt)}
                    {pay.method ? ` · ${pay.method}` : ''}
                  </span>
                </span>
                <span className="money-amt ok">{money(pay.amount)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function InsightsView({ data }: { data: ConsoleData }) {
  const now = new Date()
  const thisMonth = (iso: string | null) => {
    if (!iso) return false
    const d = new Date(iso)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }
  const leads = data.leads ?? []
  const tasks = data.tasks ?? []
  const team = data.team ?? []
  const projects = data.projects

  // Pipeline
  const converted = leads.filter((l) => l.status === 'converted').length
  const decided = leads.filter((l) => l.status === 'converted' || l.status === 'archived').length
  const winRate = decided ? Math.round((converted / decided) * 100) : 0
  const newLeadsMonth = leads.filter((l) => thisMonth(l.createdAt)).length
  const leadSplit: [string, number, string][] = [
    ['New', leads.filter((l) => l.status === 'new').length, 'var(--signal)'],
    ['Contacted', leads.filter((l) => l.status === 'contacted').length, 'var(--foam)'],
    ['Converted', converted, 'var(--accent)'],
    ['Archived', leads.filter((l) => l.status === 'archived').length, 'var(--line)'],
  ]
  const leadTotal = leadSplit.reduce((s, [, n]) => s + n, 0)

  // Projects
  const active = projects.filter((p) => p.status === 'active')
  const overdue = active.filter((p) => p.dueDate && new Date(p.dueDate + 'T00:00:00').getTime() < Date.now() - 86400e3)
  const completed = projects.filter((p) => p.status === 'completed')
  const avgProgress = active.length ? Math.round(active.reduce((s, p) => s + p.progress, 0) / active.length) : 0

  // Delivery & quality
  const phases = projects.flatMap((p) => p.phases)
  const donePhases = phases.filter((ph) => ph.startedAt && ph.completedAt)
  const avgTurnaround = donePhases.length
    ? Math.round(donePhases.reduce((s, ph) => s + (new Date(ph.completedAt!).getTime() - new Date(ph.startedAt!).getTime()) / 86400e3, 0) / donePhases.length)
    : 0
  const toReview = projects.flatMap((p) => p.assets).filter((a) => a.status === 'pending').length

  // Satisfaction
  const reviews = projects.flatMap((p) => p.reviews).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0

  // Team load
  const openByPerson = team
    .map((m) => ({ name: m.name, open: tasks.filter((t) => t.status !== 'done' && t.assigneeId === m.id).length }))
    .sort((a, b) => b.open - a.open)
  const maxLoad = Math.max(1, ...openByPerson.map((p) => p.open))

  return (
    <div className="screen">
      <header className="page-head">
        <span className="eyebrow">Insights</span>
        <h1>How the studio is doing</h1>
        <p className="muted">A read on your pipeline, delivery and team — built from everything already in Project Desk.</p>
      </header>

      <section className="section">
        <div className="section-head">
          <h3>Pipeline</h3>
        </div>
        <div className="kpis">
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">Win rate</span>
            <strong>
              <CountUp value={winRate} />%
            </strong>
          </div>
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">New this month</span>
            <strong>
              <CountUp value={newLeadsMonth} />
            </strong>
          </div>
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">Clients won</span>
            <strong>
              <CountUp value={converted} />
            </strong>
          </div>
        </div>
        {leadTotal > 0 && (
          <>
            <div className="split-bar" aria-hidden="true">
              {leadSplit.map(([label, n, color]) => n > 0 && <span key={label} style={{ width: `${(n / leadTotal) * 100}%`, background: color }} />)}
            </div>
            <div className="split-legend">
              {leadSplit.map(([label, n, color]) => (
                <span key={label}>
                  <i style={{ background: color }} /> {label} {n}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h3>Projects</h3>
        </div>
        <div className="insight-ring">
          <Ring value={avgProgress} />
          <div>
            <strong style={{ display: 'block', fontSize: '1.05rem' }}>Average progress</strong>
            <span className="muted">across {active.length} active project{active.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="kpis">
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">Active</span>
            <strong>
              <CountUp value={active.length} />
            </strong>
          </div>
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">Overdue</span>
            <strong style={{ color: overdue.length ? 'var(--bad)' : undefined }}>
              <CountUp value={overdue.length} />
            </strong>
          </div>
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">Completed</span>
            <strong>
              <CountUp value={completed.length} />
            </strong>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h3>Delivery &amp; quality</h3>
        </div>
        <div className="kpis">
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">Avg phase turnaround</span>
            <strong>
              {avgTurnaround > 0 ? (
                <>
                  <CountUp value={avgTurnaround} />
                  <span style={{ fontSize: '1rem' }}>d</span>
                </>
              ) : (
                '—'
              )}
            </strong>
          </div>
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">Phases done</span>
            <strong>
              <CountUp value={donePhases.length} />
            </strong>
          </div>
          <div className="kpi" style={{ cursor: 'default' }}>
            <span className="eyebrow">To review</span>
            <strong style={{ color: toReview ? 'var(--warn)' : undefined }}>
              <CountUp value={toReview} />
            </strong>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h3>Client satisfaction</h3>
        </div>
        {reviews.length === 0 ? (
          <Empty icon="star">No reviews yet.</Empty>
        ) : (
          <>
            <div className="sat-head">
              <strong className="sat-score">{avgRating.toFixed(1)}</strong>
              <span className="stars" aria-label={`${avgRating.toFixed(1)} out of 5`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Icon key={i} name="star" className={i <= Math.round(avgRating) ? 'star-on' : 'star-off'} />
                ))}
              </span>
              <span className="muted">
                {reviews.length} review{reviews.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="list">
              {reviews.slice(0, 3).map((r) => (
                <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <span className="grow">
                    <span className="stars small" aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Icon key={i} name="star" className={i <= r.rating ? 'star-on' : 'star-off'} />
                      ))}
                    </span>
                    <span className="muted" style={{ display: 'block', fontSize: '.9rem', marginTop: 2 }}>
                      "{r.body}" — {r.authorName}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {openByPerson.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h3>Team load</h3>
            <span className="file-group-count">{tasks.filter((t) => t.status !== 'done').length} open</span>
          </div>
          <div className="load-bars">
            {openByPerson.map((p) => (
              <div key={p.name} className="load-row">
                <span className="load-name">{p.name.split(' ')[0]}</span>
                <span className="load-track">
                  <i style={{ width: `${(p.open / maxLoad) * 100}%` }} />
                </span>
                <span className="load-n">{p.open}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

const TASK_STATUS: Record<Task['status'], { label: string; tone: string; next: Task['status'] }> = {
  todo: { label: 'To do', tone: '', next: 'doing' },
  doing: { label: 'Doing', tone: 'warn', next: 'done' },
  done: { label: 'Done', tone: 'ok', next: 'todo' },
}
function TaskRow({ task, projectName, onEdit, onCycle }: { task: Task; projectName: string; onEdit: () => void; onCycle: () => void | Promise<void> }) {
  const due = task.dueDate ? new Date(task.dueDate + 'T00:00:00') : null
  const overdue = due && task.status !== 'done' && due.getTime() < Date.now() - 86400e3
  const st = TASK_STATUS[task.status]
  return (
    <div className={`row task-row${task.status === 'done' ? ' task-done' : ''}`}>
      <button className="task-open grow" onClick={onEdit}>
        <span className={`prio-dot prio-${task.priority}`} aria-hidden="true" />
        <span className="grow">
          <span className="title" style={{ display: 'block' }}>
            {task.title}
          </span>
          <span className="sub" style={{ display: 'block' }}>
            {[projectName, due ? `${overdue ? 'Overdue · ' : 'Due '}${date(task.dueDate)}` : ''].filter(Boolean).join(' · ') || 'No project'}
          </span>
        </span>
      </button>
      <Button variant={`chip ${st.tone}`} onClick={onCycle}>
        {st.label}
      </Button>
    </div>
  )
}

function TasksView({ data, reload, open }: { data: ConsoleData; reload: () => void; open: (s: Sheets) => void }) {
  const tasks = data.tasks ?? []
  const team = data.team ?? []
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open')
  const projectName = (pid: number | null) => (pid ? (data.projects.find((p) => p.id === pid)?.name ?? '') : '')
  const cycle = async (task: Task) => {
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: TASK_STATUS[task.status].next } })
      reload()
    } catch (e) {
      toast('That did not work', (e as Error).message, 'bad')
    }
  }
  const shown = tasks.filter((t) => (filter === 'all' ? true : filter === 'done' ? t.status === 'done' : t.status !== 'done'))
  const openCount = (assigneeId: number | null) => tasks.filter((t) => t.status !== 'done' && t.assigneeId === assigneeId).length
  // Group shown tasks by assignee, people with open work first, unassigned last.
  const groups: { id: number | null; name: string }[] = [...team.map((m) => ({ id: m.id as number | null, name: m.name })), { id: null, name: 'Unassigned' }]
    .filter((g) => shown.some((t) => t.assigneeId === g.id))
    .sort((a, b) => openCount(b.id) - openCount(a.id))
  return (
    <div className="screen">
      <header className="page-head">
        <span className="eyebrow">Tasks</span>
        <h1>{tasks.filter((t) => t.status !== 'done').length ? `${tasks.filter((t) => t.status !== 'done').length} open` : 'All clear'}</h1>
        <p className="muted">Your team's own to-do list. Assign work, see who is carrying what, and tap a status to move it along. Clients never see these.</p>
      </header>
      {team.length > 0 && (
        <div className="workload">
          {team.map((m) => (
            <div key={m.id} className="workload-chip">
              <strong>{openCount(m.id)}</strong>
              <span>{m.name.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      )}
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          ['open', 'Open'],
          ['done', 'Done'],
          ['all', 'All'],
        ]}
      />
      <div style={{ marginTop: 16, display: 'grid', gap: 18 }}>
        {shown.length === 0 && <Empty icon="note">No tasks here. Add one with the button below.</Empty>}
        {groups.map((g) => (
          <section key={g.id ?? 'none'} className="section">
            <div className="section-head">
              <h3>{g.name}</h3>
              <span className="file-group-count">{openCount(g.id)} open</span>
            </div>
            <div className="list">
              {shown
                .filter((t) => t.assigneeId === g.id)
                .map((t) => (
                  <TaskRow key={t.id} task={t} projectName={projectName(t.projectId)} onEdit={() => open({ kind: 'task', task: t })} onCycle={() => cycle(t)} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function TaskSheet({ task, projectId, data, onClose, onDone }: { task?: Task; projectId?: number; data: ConsoleData; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    title: task?.title ?? '',
    details: task?.details ?? '',
    assigneeId: task?.assigneeId ? String(task.assigneeId) : '',
    projectId: task?.projectId ? String(task.projectId) : projectId ? String(projectId) : '',
    priority: task?.priority ?? 'normal',
    dueDate: task?.dueDate ?? '',
    status: task?.status ?? 'todo',
  })
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const body = {
    title: f.title,
    details: f.details,
    assigneeId: f.assigneeId ? Number(f.assigneeId) : 0,
    projectId: f.projectId ? Number(f.projectId) : 0,
    priority: f.priority,
    dueDate: f.dueDate,
    status: f.status,
  }
  const save = async () => {
    setError('')
    try {
      if (task) await api(`/tasks/${task.id}`, { method: 'PATCH', body })
      else await api('/tasks', { body })
      onClose()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const remove = async () => {
    if (!task) return
    try {
      await api(`/tasks/${task.id}`, { method: 'DELETE' })
      onClose()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Sheet title={task ? 'Edit task' : 'New task'} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <Field label="Task">
        <input value={f.title} onChange={set('title')} placeholder="What needs doing?" autoFocus />
      </Field>
      <div className="grid-2">
        <Field label="Assign to">
          <select value={f.assigneeId} onChange={set('assigneeId')}>
            <option value="">Unassigned</option>
            {(data.team ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project (optional)">
          <select value={f.projectId} onChange={set('projectId')}>
            <option value="">No project</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select value={f.priority} onChange={set('priority')}>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Due date (optional)">
          <input type="date" value={f.dueDate} onChange={set('dueDate')} />
        </Field>
      </div>
      {task && (
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            <option value="todo">To do</option>
            <option value="doing">Doing</option>
            <option value="done">Done</option>
          </select>
        </Field>
      )}
      <Field label="Details (optional)">
        <textarea value={f.details} onChange={set('details')} />
      </Field>
      <Button variant="accent block" icon="check" disabled={!f.title.trim()} onClick={save}>
        {task ? 'Save task' : 'Add task'}
      </Button>
      {task && (
        <button className="link-btn" style={{ marginTop: 14, color: 'var(--bad)' }} onClick={remove}>
          Delete task
        </button>
      )}
    </Sheet>
  )
}

const LEAD_TONE: Record<Lead['status'], string> = { new: 'warn', contacted: '', converted: 'ok', archived: '' }
const LEAD_LABEL: Record<Lead['status'], string> = { new: 'New', contacted: 'Contacted', converted: 'Converted', archived: 'Archived' }

function LeadsView({ data, reload, open }: { data: ConsoleData; reload: () => void; open: (s: Sheets) => void }) {
  const leads = data.leads ?? []
  const [filter, setFilter] = useState<'open' | 'converted' | 'archived' | 'all'>('open')
  const [busy, setBusy] = useState(0)
  const serviceLabel = (key: string) => data.services[key]?.label ?? ''
  const shown = leads.filter((l) =>
    filter === 'all' ? true : filter === 'open' ? l.status === 'new' || l.status === 'contacted' : l.status === filter,
  )
  const move = async (lead: Lead, status: Lead['status']) => {
    setBusy(lead.id)
    try {
      await api(`/leads/${lead.id}`, { method: 'PATCH', body: { status } })
      reload()
    } catch (e) {
      toast('That did not work', (e as Error).message, 'bad')
    } finally {
      setBusy(0)
    }
  }
  const counts = {
    open: leads.filter((l) => l.status === 'new' || l.status === 'contacted').length,
    converted: leads.filter((l) => l.status === 'converted').length,
    archived: leads.filter((l) => l.status === 'archived').length,
  }
  return (
    <div className="screen">
      <header className="page-head">
        <span className="eyebrow">Leads</span>
        <h1>{counts.open ? `${counts.open} enquir${counts.open === 1 ? 'y' : 'ies'} to follow up` : 'Enquiries'}</h1>
        <p className="muted">New enquiries from your public form. Mark who you have contacted, then convert the good ones into clients.</p>
      </header>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          ['open', `Open${counts.open ? ` (${counts.open})` : ''}`],
          ['converted', 'Converted'],
          ['archived', 'Archived'],
          ['all', 'All'],
        ]}
      />
      <div className="list cards stagger" style={{ marginTop: 16 }}>
        {shown.length === 0 && <Empty icon="mail">No enquiries here yet.</Empty>}
        {shown.map((l) => (
          <div key={l.id} className="card lead-card">
            <div className="lead-top">
              <div className="grow">
                <strong style={{ display: 'block', fontSize: '1.05rem' }}>{l.company || l.contactName}</strong>
                <span className="muted" style={{ fontSize: '.88rem' }}>
                  {l.company ? `${l.contactName} · ` : ''}
                  {ago(l.createdAt)}
                </span>
              </div>
              <Pill tone={LEAD_TONE[l.status]}>{LEAD_LABEL[l.status]}</Pill>
            </div>
            <div className="lead-meta">
              <a href={`mailto:${l.email}`}>{l.email}</a>
              {l.phone && <a href={`tel:${l.phone}`}>{l.phone}</a>}
              {serviceLabel(l.service) && <span>{serviceLabel(l.service)}</span>}
              {l.budget && <span>Budget: {l.budget}</span>}
            </div>
            {l.message && <p className="lead-msg">{l.message}</p>}
            {l.status !== 'converted' && (
              <div className="lead-actions">
                {l.status === 'new' && (
                  <Button variant="ghost" onClick={() => move(l, 'contacted')} busy={busy === l.id}>
                    Mark contacted
                  </Button>
                )}
                <Button variant="accent" icon="sparkle" onClick={() => open({ kind: 'convert', lead: l })}>
                  Convert to client
                </Button>
                {l.status !== 'archived' && (
                  <Button variant="ghost" onClick={() => move(l, 'archived')} busy={busy === l.id}>
                    Archive
                  </Button>
                )}
                {l.status === 'archived' && (
                  <Button variant="ghost" onClick={() => move(l, 'new')} busy={busy === l.id}>
                    Reopen
                  </Button>
                )}
              </div>
            )}
            {l.status === 'converted' && l.clientId && (
              <div className="lead-actions">
                <Button variant="ghost" onClick={() => go(`clients/${l.clientId}`)}>
                  Open client
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function OnboardSheet({ services, lead, onClose, onDone }: { services: Record<string, ServiceDef>; lead?: Lead; onClose: () => void; onDone: (clientId: number) => void }) {
  const keys = Object.keys(services)
  const [f, setF] = useState({
    company: lead?.company ?? '',
    contactName: lead?.contactName ?? '',
    email: lead?.email ?? '',
    phone: lead?.phone ?? '',
    industry: '',
    service: (lead?.service && services[lead.service] ? lead.service : keys[0]) ?? 'website',
    projectName: '',
    dueDate: '',
    notes: lead?.message ? `From enquiry: ${lead.message}` : '',
    price: '',
    depositPercent: String(boot.brand.depositPercent ?? 50),
  })
  const [milestones, setMilestones] = useState<Record<number, string>>({})
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const svc = services[f.service]
  const submit = async () => {
    setError('')
    try {
      const r = await api<{ clientId: number }>('/clients', { body: { ...f, milestones } })
      if (lead) {
        try {
          await api(`/leads/${lead.id}`, { method: 'PATCH', body: { status: 'converted', clientId: r.clientId } })
        } catch {
          /* client is created; the lead status is non-critical */
        }
      }
      toast(`${f.company} is onboarded`, `Invite and agreement sent to ${f.email}.`)
      onClose()
      onDone(r.clientId)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Sheet title={lead ? 'Convert enquiry to client' : 'Onboard a client'} onClose={onClose}>
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
        <select
          value={f.service}
          onChange={(e) => {
            setF({ ...f, service: e.target.value })
            setMilestones({})
          }}
        >
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
      {can.money && svc && naira(f.price) > 0 && <MilestonePlanner phases={svc.phases} price={f.price} deposit={f.depositPercent} milestones={milestones} onChange={setMilestones} />}
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
      <div className="price-grid">
        <Field label={`Project price (${boot.brand.currency})`} hint="The agreement states this figure.">
          <input className="price-big" inputMode="decimal" value={price} onChange={(e) => onChange(e.target.value, pct)} placeholder="1,500,000" />
        </Field>
        <Field label="Deposit %" hint="Billed on signing.">
          <div className="pct-box">
            <input inputMode="numeric" value={pct} onChange={(e) => onChange(price, e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
            <i>%</i>
          </div>
        </Field>
      </div>
      <p className="hint">
        {amount > 0 ? (
          <>
            When the agreement is signed, a <strong>{money(Math.round(amount * p))}</strong> deposit invoice goes to the client automatically.
          </>
        ) : (
          'Optional. With a price, the deposit invoice goes out automatically once the agreement is signed.'
        )}
      </p>
    </div>
  )
}

/** A percentage 0-100 from a typed string. */
const pctOf = (v: string) => Math.max(0, Math.min(100, Number(v) || 0))

/** Lets the team mark which phases bill the client, and for how much, as a share of the price. */
function MilestonePlanner({
  phases,
  price,
  deposit,
  milestones,
  onChange,
}: {
  phases: { name: string; signoff: boolean }[]
  price: string
  deposit: string
  milestones: Record<number, string>
  onChange: (m: Record<number, string>) => void
}) {
  const amount = naira(price)
  const dep = pctOf(deposit)
  const billed = phases.map((_p, i) => pctOf(milestones[i] ?? ''))
  const sum = dep + billed.reduce((t, v) => t + v, 0)
  const rest = Math.max(0, 100 - sum)
  const state = sum === 100 ? 'ok' : sum > 100 ? 'over' : 'under'
  return (
    <div className="ms-planner">
      <div className="ms-planner-head">
        <div className="eyebrow">Payment schedule</div>
        <span className={`ms-badge ${state}`}>{sum}% of price</span>
      </div>
      <p className="hint">Deposit bills on signing. Give any phase a share to bill it when that phase completes — the next phase then waits until it is paid.</p>
      <div className="ms-bar" role="img" aria-label={`${sum}% of the price assigned to payments`}>
        {dep > 0 && (
          <span className="seg dep" style={{ flexGrow: dep }} title={`Deposit — ${dep}%`} />
        )}
        {billed.map((v, i) => (v > 0 ? <span key={i} className="seg mile" style={{ flexGrow: v }} title={`${phases[i].name} — ${v}%`} /> : null))}
        {rest > 0 && <span className="seg rest" style={{ flexGrow: rest }} />}
      </div>
      <div className="ms-list">
        <div className="ms-item fixed">
          <span className="dot dep" />
          <span className="ms-name">
            Deposit
            <i>on signing</i>
          </span>
          <span className="ms-pct">{dep}%</span>
          <span className="ms-amt">{amount > 0 ? money(Math.round(amount * dep)) : '—'}</span>
        </div>
        {phases.map((p, i) => {
          const v = billed[i]
          return (
            <div key={i} className={`ms-item ${v > 0 ? 'on' : ''}`}>
              <span className={`dot ${v > 0 ? 'mile' : 'off'}`} />
              <span className="ms-name">
                {p.name}
                {p.signoff ? <i>sign-off</i> : null}
              </span>
              <span className="ms-input">
                <input
                  inputMode="numeric"
                  value={milestones[i] ?? ''}
                  placeholder="0"
                  aria-label={`Payment for ${p.name}`}
                  onChange={(e) => onChange({ ...milestones, [i]: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })}
                />
                <i>%</i>
              </span>
              <span className="ms-amt">{amount > 0 && v > 0 ? money(Math.round(amount * v)) : ''}</span>
            </div>
          )
        })}
      </div>
      <p className={`ms-total ${state}`}>
        {state === 'ok' ? '✓ Fully scheduled — 100% of the price assigned.' : state === 'over' ? `${sum - 100}% over the price — trim a milestone.` : `${rest}% not yet assigned.`}
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
  const [milestones, setMilestones] = useState<Record<number, string>>({})
  const svc = services[service]
  return (
    <Sheet title={`New project for ${client.company}`} onClose={onClose}>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Service">
        <select
          value={service}
          onChange={(e) => {
            setService(e.target.value)
            setMilestones({})
          }}
        >
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
      {can.money && svc && naira(price) > 0 && <MilestonePlanner phases={svc.phases} price={price} deposit={pct} milestones={milestones} onChange={setMilestones} />}
      <Button
        variant="accent block"
        disabled={!name.trim()}
        onClick={async () => {
          const r = await api<{ projectId: number }>('/projects', { body: { clientId: client.id, name, service, dueDate, ...(can.money ? { price, depositPercent: pct, milestones } : {}) } })
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

/** Records a payment (part or full) against an invoice. Reaching the full amount settles it. */
function RecordPaymentSheet({ payment, onClose, onDone }: { payment: Payment; onClose: () => void; onDone: () => void }) {
  const left = Math.max(0, payment.amount - payment.amountPaid)
  const [amount, setAmount] = useState(String(Math.round(left / 100)))
  const [method, setMethod] = useState('Bank transfer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const entered = naira(amount) * 100
  const settles = entered >= left
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api(`/payments/${payment.id}/record`, { body: { amount, method } })
      toast(settles ? 'Payment confirmed' : 'Part-payment recorded', settles ? 'The client gets their receipt by email.' : `${money(Math.max(0, left - entered))} still outstanding. The client has been told.`)
      onDone()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Sheet title="Record a payment" onClose={onClose}>
      <div className="proof-sum" style={{ marginBottom: 18 }}>
        <span className="muted">{payment.label}</span>
        <strong className="amount">{money(left, payment.currency)} left</strong>
      </div>
      {payment.amountPaid > 0 && <p className="hint" style={{ marginTop: -8 }}>{money(payment.amountPaid, payment.currency)} of {money(payment.amount, payment.currency)} already paid.</p>}
      {error && <div className="form-error">{error}</div>}
      <div className="grid-2">
        <Field label={`Amount received (${boot.brand.currency})`}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Method">
          <input value={method} onChange={(e) => setMethod(e.target.value)} />
        </Field>
      </div>
      <p className="hint">{entered <= 0 ? 'Enter the amount you received.' : settles ? 'This settles the invoice — a receipt goes to the client and any held phase starts.' : `Records a part-payment. ${money(Math.max(0, left - entered))} will remain.`}</p>
      <Button variant="accent block" icon={settles ? 'check' : 'wallet'} disabled={busy || entered <= 0} onClick={submit}>
        {busy ? 'Saving…' : settles ? 'Confirm full payment' : `Record ${money(entered)}`}
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
  invoiceVat: boolean
  invoiceNaija: boolean
}

/** First-run wizard: walks a new owner through the essentials, then marks setup complete. */
function SetupWizard({ onDone }: { onDone: () => void }) {
  const [s, setS] = useState<SettingsData | null>(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api<SettingsData>('/settings').then(setS)
  }, [])
  if (!s) return <div className="setup"><div className="setup-card"><Skeleton /></div></div>
  const upd = (patch: Partial<SettingsData>) => setS({ ...s, ...patch })

  const steps: { title: string; blurb: string; body: React.ReactNode }[] = [
    {
      title: 'Your business',
      blurb: 'The basics clients see first.',
      body: (
        <>
          <Field label="Business name">
            <input value={s.businessName} onChange={(e) => upd({ businessName: e.target.value })} placeholder="Acme Studio" />
          </Field>
          <div className="grid-2">
            <Field label="Currency" hint="Three-letter code, e.g. NGN, USD.">
              <input value={s.currency} maxLength={3} onChange={(e) => upd({ currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Website">
              <input value={s.businessWebsite} onChange={(e) => upd({ businessWebsite: e.target.value })} placeholder="https://" />
            </Field>
          </div>
        </>
      ),
    },
    {
      title: 'Your look',
      blurb: 'Your brand across the portal and emails.',
      body: (
        <>
          <Field label="Brand colour" hint="A hex colour such as #0f6b4f.">
            <div className="color-field">
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(s.brandColor) ? s.brandColor : '#0b3b40'} onChange={(e) => upd({ brandColor: e.target.value })} />
              <input value={s.brandColor} onChange={(e) => upd({ brandColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Logo URL" hint="Leave empty to use the built-in mark for now.">
            <input value={s.logoUrl} onChange={(e) => upd({ logoUrl: e.target.value })} placeholder="https://…/logo.svg" />
          </Field>
        </>
      ),
    },
    {
      title: 'Getting paid',
      blurb: 'How deposits and invoices work.',
      body: (
        <>
          <div className="grid-2">
            <Field label="Deposit %" hint="Pre-filled when you onboard a client.">
              <input type="number" min={0} max={100} value={s.depositPercent} onChange={(e) => upd({ depositPercent: Number(e.target.value) })} />
            </Field>
            <Field label="Invoices due after (days)">
              <input type="number" min={0} max={90} value={s.invoiceDueDays} onChange={(e) => upd({ invoiceDueDays: Number(e.target.value) })} />
            </Field>
          </div>
          {s.invoiceNaija ? (
            <p className="hint">InvoiceNaija is connected, so it raises and emails invoices with its own bank accounts and pay page.</p>
          ) : (
            <Field label="Bank details for invoices" hint="Shown in invoice emails. Account name, bank and number.">
              <textarea value={s.bankDetails} onChange={(e) => upd({ bankDetails: e.target.value })} placeholder={'Account name\nBank\n0000000000'} />
            </Field>
          )}
        </>
      ),
    },
    {
      title: 'Contact & emails',
      blurb: 'These sign off every email the portal sends.',
      body: (
        <>
          <div className="grid-2">
            <Field label="Legal name">
              <input value={s.legalName} onChange={(e) => upd({ legalName: e.target.value })} placeholder={s.businessName} />
            </Field>
            <Field label="RC number">
              <input value={s.rcNumber} onChange={(e) => upd({ rcNumber: e.target.value })} />
            </Field>
            <Field label="Email">
              <input type="email" value={s.businessEmail} onChange={(e) => upd({ businessEmail: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input type="tel" value={s.businessPhone} onChange={(e) => upd({ businessPhone: e.target.value })} />
            </Field>
          </div>
          <Field label="Address">
            <input value={s.businessAddress} onChange={(e) => upd({ businessAddress: e.target.value })} />
          </Field>
          <Field label="Tagline">
            <input value={s.tagline} onChange={(e) => upd({ tagline: e.target.value })} placeholder="What you do, in a few words" />
          </Field>
        </>
      ),
    },
  ]

  const finish = async () => {
    setBusy(true)
    setError('')
    try {
      await api('/settings', {
        method: 'PUT',
        body: {
          businessName: s.businessName,
          currency: s.currency,
          businessWebsite: s.businessWebsite,
          brandColor: s.brandColor,
          logoUrl: s.logoUrl,
          depositPercent: s.depositPercent,
          invoiceDueDays: s.invoiceDueDays,
          bankDetails: s.bankDetails,
          legalName: s.legalName,
          rcNumber: s.rcNumber,
          businessEmail: s.businessEmail,
          businessPhone: s.businessPhone,
          businessAddress: s.businessAddress,
          tagline: s.tagline,
          setupComplete: true,
        },
      })
      toast('All set', `${s.businessName} is ready to onboard clients.`)
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  const skip = async () => {
    setBusy(true)
    try {
      await api('/settings', { method: 'PUT', body: { setupComplete: true } })
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const last = step === steps.length - 1
  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-top">
          <span className="eyebrow">Welcome</span>
          <button className="link-btn" onClick={skip} disabled={busy}>Skip for now</button>
        </div>
        <div className="setup-prog" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>
        <h1 className="setup-title">{steps[step].title}</h1>
        <p className="muted setup-blurb">{steps[step].blurb}</p>
        {error && <div className="form-error">{error}</div>}
        <div className="setup-body" key={step}>
          {steps[step].body}
        </div>
        <div className="setup-actions">
          {step > 0 && (
            <Button variant="ghost" icon="back" onClick={() => setStep(step - 1)} disabled={busy}>
              Back
            </Button>
          )}
          {last ? (
            <Button variant="accent" icon="sparkle" onClick={finish} disabled={busy || !s.businessName}>
              {busy ? 'Saving…' : 'Finish setup'}
            </Button>
          ) : (
            <Button variant="accent" onClick={() => setStep(step + 1)} disabled={step === 0 && !s.businessName}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  )
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
                Invoices are raised and emailed by InvoiceNaija, with its bank accounts and pay page. Payments confirmed here are recorded there, and its receipt goes to the client.
              </p>
              <label className="check" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={s.invoiceVat} onChange={(e) => setS({ ...s, invoiceVat: e.target.checked })} />
                <span>Add VAT to project invoices (at InvoiceNaija's rate)</span>
              </label>
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
                invoiceVat: s.invoiceVat,
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
