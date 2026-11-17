import { useEffect, useRef, useState } from 'react'
import { ago, api, boot, currentPhase, date, money, type Asset, type Doc, type Payment, type Phase, type PortalData, type Project } from './api'
import { go, type Route } from './router'
import { AssetSheet, ClientPaymentCard, DocumentSheet, FilesHub, ProofSheet, PushBanner, ReviewSheet, Thread, Timeline, UploadSheet, useLoad } from './shared'
import { BrandMark, Button, Empty, Field, Icon, Pill, Ring, Segmented, Sheet, Skeleton, toast, useScrolled, useTheme } from './ui'

type Sheets =
  | { kind: 'upload'; project?: number; replaces?: Asset }
  | { kind: 'asset'; asset: Asset }
  | { kind: 'doc'; doc: Doc }
  | { kind: 'approve'; phase: Phase; project: Project }
  | { kind: 'review'; project: Project }
  | { kind: 'notices' }
  | { kind: 'proof'; payment: Payment; project: number }
  | null

/** Things waiting on the client, most urgent first. */
function todo(data: PortalData) {
  const items: { key: string; icon: string; tone: string; title: string; sub: string; act: () => void }[] = []
  return { items, build: (open: (s: Sheets) => void) => {
    for (const d of data.documents.filter((d) => d.status === 'awaiting_signature'))
      items.push({ key: `d${d.id}`, icon: 'sign', tone: 'warn', title: `Sign: ${d.title}`, sub: 'Work starts once this is signed', act: () => open({ kind: 'doc', doc: d }) })
    for (const p of data.projects) {
      for (const ph of p.phases.filter((x) => x.signoff && x.status === 'ongoing' && !x.approvedAt))
        items.push({ key: `a${ph.id}`, icon: 'check', tone: 'warn', title: `Approve: ${ph.name}`, sub: p.name, act: () => open({ kind: 'approve', phase: ph, project: p }) })
      for (const a of p.assets.filter((x) => x.status === 'changes_requested' && !p.assets.some((n) => n.versionOf === x.id)))
        items.push({ key: `f${a.id}`, icon: 'alert', tone: 'bad', title: `Changes needed: ${a.name}`, sub: a.reviewNote, act: () => open({ kind: 'asset', asset: a }) })
      for (const pay of p.payments.filter((x) => (x.status === 'due' || x.status === 'overdue') && !x.proofAt))
        items.push({ key: `p${pay.id}`, icon: 'wallet', tone: pay.status === 'overdue' ? 'bad' : '', title: `Pay: ${pay.label}, ${money(pay.amount, pay.currency)}`, sub: (pay.status === 'overdue' ? `Overdue since ${date(pay.dueDate)}` : pay.dueDate ? `Due ${date(pay.dueDate)}` : 'Due') + ' · then send your proof', act: () => go('payments') })
    }
    return items
  } }
}

export function ClientApp({ route, clientId, onSignOut }: { route: Route; clientId?: number; onSignOut?: () => void }) {
  const preview = clientId !== undefined
  const { data, reload, error } = useLoad<PortalData>('/portal', preview ? { clientId } : undefined)
  const [sheet, setSheet] = useState<Sheets>(null)
  const section = route.path[preview ? 2 : 0] ?? 'home'
  const sub = route.path[preview ? 3 : 1]
  const prefix = preview ? `clients/${clientId}/` : ''

  if (error && !data) return <Empty icon="alert">{error}</Empty>
  if (!data) return <Skeleton />

  const unread = data.notifications.filter((n) => !n.read).length
  const firstName = (data.client.contactName || '').split(' ')[0]
  const tasks = todo(data).build(setSheet)

  const approve = async (phase: Phase, note: string) => {
    await api(`/phases/${phase.id}/approve`, { body: { note } })
    toast('Approved', `${phase.name} is signed off. Thank you!`)
    reload()
  }

  let body: React.ReactNode
  if (section === 'projects' && sub) {
    const project = data.projects.find((p) => p.id === Number(sub))
    body = project ? (
      <ProjectView project={project} preview={preview} open={setSheet} reload={reload} back={() => go(prefix + 'projects')} tab={route.query.get('tab') ?? 'plan'} prefix={prefix} />
    ) : (
      <Empty>Project not found.</Empty>
    )
  } else if (section === 'projects') {
    body = (
      <div className="screen">
        <header className="page-head">
          <span className="eyebrow">Projects</span>
          <h1>Your work with us</h1>
        </header>
        <div className="list stagger">
          {data.projects.map((p) => (
            <ProjectRow key={p.id} project={p} onOpen={() => go(`${prefix}projects/${p.id}`)} />
          ))}
        </div>
      </div>
    )
  } else if (section === 'documents') {
    body = (
      <div className="screen">
        <header className="page-head">
          <span className="eyebrow">Documents</span>
          <h1>Agreements and paperwork</h1>
          <p className="muted">Read, sign and keep a copy. Signed documents are locked and timestamped.</p>
        </header>
        <div className="list stagger">
          {data.documents.length === 0 && <Empty icon="doc">Nothing to sign yet.</Empty>}
          {data.documents.map((d) => (
            <button key={d.id} className="row" onClick={() => setSheet({ kind: 'doc', doc: d })}>
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
              <Pill tone={d.status === 'signed' ? 'ok' : 'warn'}>{d.status === 'signed' ? 'Signed' : 'To sign'}</Pill>
            </button>
          ))}
        </div>
      </div>
    )
  } else if (section === 'payments') {
    const all = data.projects.flatMap((p) => p.payments.map((pay) => ({ ...pay, project: p.name, projectId: p.id })))
    const outstanding = all.filter((p) => p.status === 'due' || p.status === 'overdue').reduce((s, p) => s + p.amount, 0)
    const paid = all.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
    body = (
      <div className="screen">
        <header className="page-head">
          <span className="eyebrow">Payments</span>
          <h1>{outstanding ? `${money(outstanding)} to pay` : 'All paid up'}</h1>
          <p className="muted">{money(paid)} paid so far. Pay by transfer, send us your proof here, and your receipt arrives by email once we confirm it.</p>
        </header>
        <div className="list stagger">
          {all.length === 0 && <Empty icon="wallet">No invoices yet.</Empty>}
          {all.map((p) => (
            <ClientPaymentCard
              key={p.id}
              p={p}
              project={data.projects.length > 1 ? p.project : undefined}
              canAct={!preview}
              onProof={() => setSheet({ kind: 'proof', payment: p, project: p.projectId })}
            />
          ))}
        </div>
      </div>
    )
  } else {
    const active = data.projects.find((p) => p.status === 'active') ?? data.projects[0]
    const phase = active ? currentPhase(active) : null
    body = (
      <div className="screen">
        <header className="page-head">
          <span className="eyebrow">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1>{greeting()}{firstName ? `, ${firstName}` : ''}.</h1>
        </header>
        <div className="dash">
        <div className="dash-main">
        {active && (
          <button className="hero" style={{ width: '100%', border: 0, textAlign: 'left', cursor: 'pointer', display: 'block' }} onClick={() => go(`${prefix}projects/${active.id}`)}>
            <div className="hero-row">
              <div style={{ minWidth: 0 }}>
                <span className="eyebrow">{active.serviceLabel}</span>
                <h2>{active.name}</h2>
                <div className="hero-meta">{active.dueDate ? `Target ${date(active.dueDate)}` : `Started ${date(active.startDate)}`}</div>
              </div>
              <Ring value={active.progress} />
            </div>
            {phase && (
              <span className="current">
                <span className="signal-dot" /> Now: {phase.name}
              </span>
            )}
          </button>
        )}
        <section className="section">
          <div className="section-head">
            <h3>{tasks.length ? 'Waiting on you' : 'Nothing waiting on you'}</h3>
            {tasks.length > 0 && <Pill tone="warn">{tasks.length}</Pill>}
          </div>
          <div className="list stagger">
            {tasks.length === 0 && <Empty icon="sparkle">You're all caught up. We'll let you know when we need something.</Empty>}
            {tasks.map((t) => (
              <button key={t.key} className="row" onClick={t.act}>
                <span className={`icon-tile ${t.tone}`}>
                  <Icon name={t.icon} />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {t.title}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    {t.sub}
                  </span>
                </span>
                <Icon name="chevron" className="chev" />
              </button>
            ))}
          </div>
        </section>
        {data.projects.length > 1 && (
          <section className="section">
            <div className="section-head">
              <h3>All projects</h3>
            </div>
            <div className="list stagger">
              {data.projects.map((p) => (
                <ProjectRow key={p.id} project={p} onOpen={() => go(`${prefix}projects/${p.id}`)} />
              ))}
            </div>
          </section>
        )}
        </div>
        <aside className="dash-side">
        <Glance data={data} prefix={prefix} />
        <section className="section">
          <div className="section-head">
            <h3>Latest</h3>
          </div>
          <div className="list stagger">
            {data.notifications.slice(0, 5).map((n) => (
              <div key={n.id} className="row">
                <span className="icon-tile">
                  <Icon name="bell" />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {n.title}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    {ago(n.createdAt)}
                  </span>
                </span>
              </div>
            ))}
            {data.notifications.length === 0 && <Empty icon="bell">News about your project shows up here.</Empty>}
          </div>
        </section>
        </aside>
        </div>
      </div>
    )
  }

  const tabs: [string, string, string, boolean][] = [
    ['home', 'Home', 'home', tasks.length > 0],
    ['projects', 'Projects', 'folder', false],
    ['documents', 'Documents', 'doc', data.documents.some((d) => d.status === 'awaiting_signature')],
    ['payments', 'Payments', 'wallet', data.projects.some((p) => p.payments.some((x) => x.status === 'overdue'))],
  ]

  return (
    <>
      {preview && (
        <div className="preview-banner">
          <span>Viewing {data.client.company}'s portal as they see it</span>
          <button className="link-btn" style={{ color: 'inherit' }} onClick={() => go(`clients/${clientId}`)}>
            Back to console
          </button>
        </div>
      )}
      <Shell
        tabs={tabs}
        active={section}
        prefix={prefix}
        unread={unread}
        onBell={() => {
          setSheet({ kind: 'notices' })
          if (unread && !preview) api('/notifications/read', { method: 'POST' }).then(reload)
        }}
        onSignOut={onSignOut}
      >
        {body}
      </Shell>
      {!preview && data.projects.length > 0 && (
        <button className="fab" onClick={() => setSheet({ kind: 'upload', project: section === 'projects' && sub ? Number(sub) : undefined })}>
          <Icon name="upload" /> Send files
        </button>
      )}
      {sheet?.kind === 'upload' && (
        <UploadSheet projects={data.projects} initialProject={sheet.project} replaces={sheet.replaces} onClose={() => setSheet(null)} onDone={reload} />
      )}
      {sheet?.kind === 'asset' && (
        <AssetSheet
          asset={sheet.asset}
          onClose={() => setSheet(null)}
          onReplace={preview ? undefined : () => setSheet({ kind: 'upload', project: sheet.asset.projectId, replaces: sheet.asset })}
        />
      )}
      {sheet?.kind === 'doc' && <DocumentSheet doc={sheet.doc} canSign={!preview} onClose={() => setSheet(null)} onSigned={reload} />}
      {sheet?.kind === 'approve' && <ApproveSheet phase={sheet.phase} project={sheet.project} onClose={() => setSheet(null)} onApprove={approve} preview={preview} />}
      {sheet?.kind === 'proof' && <ProofSheet payment={sheet.payment} projectId={sheet.project} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'review' && <ReviewSheet project={sheet.project} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'notices' && (
        <Sheet title="Notifications" onClose={() => setSheet(null)}>
          <PushBanner />
          <div className="list">
            {data.notifications.length === 0 && <Empty icon="bell">No notifications yet.</Empty>}
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

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function ProjectRow({ project, onOpen, extra }: { project: Project; onOpen: () => void; extra?: string }) {
  const phase = currentPhase(project)
  return (
    <button className="row" onClick={onOpen} style={{ alignItems: 'center' }}>
      <Ring value={project.progress} size={50} light />
      <span className="grow">
        <span className="title" style={{ display: 'block' }}>
          {project.name}
        </span>
        <span className="sub" style={{ display: 'block' }}>
          {extra ? `${extra} · ` : ''}
          {project.status === 'completed' ? 'Completed' : phase ? phase.name : project.serviceLabel}
        </span>
      </span>
      <Icon name="chevron" className="chev" />
    </button>
  )
}

function ProjectView({
  project,
  preview,
  open,
  reload,
  back,
  tab,
  prefix,
}: {
  project: Project
  preview: boolean
  open: (s: Sheets) => void
  reload: () => void
  back: () => void
  tab: string
  prefix: string
}) {
  const setTab = (t: string) => go(`${prefix}projects/${project.id}?tab=${t}`, true)
  const latest = project.assets.filter((a) => !project.assets.some((n) => n.versionOf === a.id))
  return (
    <div className="screen">
      <button className="link-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', marginBottom: 14 }} onClick={back}>
        <Icon name="back" className="chev" /> Projects
      </button>
      <div className="hero">
        <div className="hero-row">
          <div style={{ minWidth: 0 }}>
            <span className="eyebrow">{project.serviceLabel}</span>
            <h2>{project.name}</h2>
            <div className="hero-meta">
              {project.status === 'completed' ? 'Completed' : project.dueDate ? `Target ${date(project.dueDate)}` : `Started ${date(project.startDate)}`}
            </div>
          </div>
          <Ring value={project.progress} />
        </div>
        {!project.workUnlocked && project.status === 'active' && (
          <span className="current">
            <span className="signal-dot" /> Starts once the agreement is signed and the deposit is paid
          </span>
        )}
      </div>
      <div className="dash">
      <div className="dash-main">
      <div style={{ margin: '22px 0 18px' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ['plan', 'Plan'],
            ['files', `Files${latest.length ? ` · ${latest.length}` : ''}`],
            ['messages', `Messages${project.messages.length ? ` · ${project.messages.length}` : ''}`],
          ]}
        />
      </div>
      {tab === 'files' ? (
        <div key="files">
          {latest.length === 0 ? <Empty icon="upload">Nothing shared yet. Send your brief, brand files or photos with the button below.</Empty> : <FilesHub project={project} onOpen={(a) => open({ kind: 'asset', asset: a })} />}
        </div>
      ) : tab === 'messages' ? (
        <Thread project={project} me="client" onSent={reload} canWrite={!preview} key="messages" />
      ) : (
        <div key="plan">
          <Timeline project={project} mode={preview ? 'preview' : 'client'} onApprove={(phase) => open({ kind: 'approve', phase, project })} />
          {!preview && project.phases.some((p) => p.status === 'completed' && p.stage === 'work') && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="between wrap">
                <div>
                  <h3>Enjoying the work?</h3>
                  <p className="muted" style={{ fontSize: '.9rem' }}>
                    A short review helps us improve.
                  </p>
                </div>
                <Button variant="ghost" icon="star" onClick={() => open({ kind: 'review', project })}>
                  Leave a review
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
      <aside className="dash-side desktop-only">
        <ProjectSide project={project} preview={preview} open={open} setTab={setTab} />
      </aside>
      </div>
    </div>
  )
}

/** At-a-glance numbers on the home screen. */
function Glance({ data, prefix }: { data: PortalData; prefix: string }) {
  const active = data.projects.find((p) => p.status === 'active') ?? data.projects[0]
  const work = active ? active.phases : []
  const done = work.filter((p) => p.status === 'completed').length
  const toSign = data.documents.filter((d) => d.status === 'awaiting_signature').length
  const due = data.projects.flatMap((p) => p.payments).filter((p) => p.status === 'due' || p.status === 'overdue')
  const owed = due.reduce((s, p) => s + p.amount, 0)
  const files = data.projects.reduce((n, p) => n + p.assets.filter((a) => !p.assets.some((x) => x.versionOf === a.id)).length, 0)
  const items: [string, string, string, string, string][] = [
    ['check', 'Stages done', work.length ? `${done} of ${work.length}` : '—', active ? `projects/${active.id}` : 'projects', ''],
    ['sign', 'To sign', toSign ? String(toSign) : 'None', 'documents', toSign ? 'warn' : ''],
    ['wallet', 'To pay', owed ? money(owed) : 'All paid', 'payments', due.some((p) => p.status === 'overdue') ? 'bad' : ''],
    ['folder', 'Files shared', String(files), active ? `projects/${active.id}?tab=files` : 'projects', ''],
  ]
  return (
    <section className="glance stagger" aria-label="At a glance">
      {items.map(([icon, label, value, to, tone]) => (
        <button key={label} className={`glance-item ${tone}`} onClick={() => go(prefix + to)}>
          <Icon name={icon} />
          <span className="glance-label">{label}</span>
          <span className="glance-value">{value}</span>
        </button>
      ))}
    </section>
  )
}

/** Desktop side panel on a project: where it stands, money, paperwork and quick actions. */
function ProjectSide({ project, preview, open, setTab }: { project: Project; preview: boolean; open: (s: Sheets) => void; setTab: (t: string) => void }) {
  const now = currentPhase(project)
  const next = project.phases.find((p) => p.status === 'queued')
  const done = project.phases.filter((p) => p.status === 'completed').length
  const paid = project.payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const total = project.payments.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + p.amount, 0)
  const rows: [string, string][] = [
    ['Now', now ? now.name : project.status === 'completed' ? 'Completed' : '—'],
    ['Up next', next ? next.name : '—'],
    ['Stages', `${done} of ${project.phases.length} done`],
    ['Started', project.startDate ? date(project.startDate) : '—'],
    ['Target', project.dueDate ? date(project.dueDate) : project.recurring ? 'Monthly' : '—'],
  ]
  return (
    <div className="side-stack">
      <div className="card">
        <span className="eyebrow">Where it stands</span>
        <dl className="facts">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {total > 0 && (
        <div className="card">
          <span className="eyebrow">Payments</span>
          <div className="between" style={{ marginTop: 10 }}>
            <strong className="amount">{money(paid)}</strong>
            <span className="muted" style={{ fontSize: '.88rem' }}>of {money(total)}</span>
          </div>
          <div className="bar" style={{ marginTop: 10 }}>
            <i style={{ width: `${Math.round((paid / total) * 100)}%` }} />
          </div>
          <button className="link-btn" style={{ marginTop: 12 }} onClick={() => go((preview ? `clients/${project.clientId}/portal/` : '') + 'payments')}>
            See invoices
          </button>
        </div>
      )}
      {!preview && (
        <div className="card side-actions">
          <Button variant="block" icon="upload" onClick={() => open({ kind: 'upload', project: project.id })}>
            Send files
          </Button>
          <Button variant="ghost" icon="chat" onClick={() => setTab('messages')}>
            Message the team
          </Button>
        </div>
      )}
    </div>
  )
}

function ApproveSheet({ phase, project, onClose, onApprove, preview }: { phase: Phase; project: Project; onClose: () => void; onApprove: (p: Phase, note: string) => Promise<void>; preview: boolean }) {
  const [note, setNote] = useState('')
  const shared = project.assets.filter((a) => a.fromStaff).slice(0, 4)
  return (
    <Sheet title={`Approve ${phase.name}`} onClose={onClose}>
      <p className="muted" style={{ marginBottom: 18 }}>
        Approving tells the team this stage is right and they can move on. If something needs to change, send a message instead.
      </p>
      {shared.length > 0 && (
        <div className="list" style={{ marginBottom: 18 }}>
          {shared.map((a) => (
            <div key={a.id} className="row">
              <span className="icon-tile">
                <Icon name="file" />
              </span>
              <span className="grow title">{a.name}</span>
            </div>
          ))}
        </div>
      )}
      <Field label="Note for the team (optional)">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="gap wrap">
        <Button
          variant="accent"
          icon="check"
          disabled={preview}
          onClick={async () => {
            await onApprove(phase, note)
            onClose()
          }}
        >
          Approve {phase.name}
        </Button>
        <Button variant="ghost" onClick={() => (onClose(), go(`projects/${project.id}?tab=messages`))}>
          Request changes
        </Button>
      </div>
    </Sheet>
  )
}

/** App frame: top bar on phones, tab bar (bottom on phones, side rail on desktop). */
export function Shell({
  tabs,
  active,
  prefix = '',
  unread,
  onBell,
  onSignOut,
  children,
  hideTabs,
  extraActions,
}: {
  tabs: [string, string, string, boolean][]
  active: string
  prefix?: string
  unread: number
  onBell: () => void
  onSignOut?: () => void
  children: React.ReactNode
  hideTabs?: boolean
  extraActions?: React.ReactNode
}) {
  const nav = useRef<HTMLElement>(null)
  // Keep the current tab in view on the phone's horizontal nav bar, however many tabs there are.
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [active])
  return (
    <div className="app">
      {!hideTabs && (
        <nav className="tabbar" aria-label="Main" ref={nav}>
          <span className="side-brand">
            <BrandOnly />
          </span>
          {tabs.map(([key, label, icon, dot]) => (
            <button key={key} className={`tab ${active === key ? 'active' : ''}`} onClick={() => go(prefix + (key === 'home' || key === 'overview' ? '' : key))} aria-current={active === key ? 'page' : undefined}>
              <Icon name={icon} />
              <span>{label}</span>
              {dot && <span className="tab-dot" />}
            </button>
          ))}
        </nav>
      )}
      <div style={{ minWidth: 0 }}>
        <TopBar unread={unread} onBell={onBell} onSignOut={onSignOut} extra={extraActions} />
        <main className="main">{children}</main>
      </div>
    </div>
  )
}

function BrandOnly() {
  return <BrandMark />
}

function TopBar({ unread, onBell, onSignOut, extra }: { unread: number; onBell: () => void; onSignOut?: () => void; extra?: React.ReactNode }) {
  const scrolled = useScrolled()
  const [theme, toggle] = useTheme()
  return (
    <div className={`topbar ${scrolled ? 'scrolled' : ''}`}>
      <span className="mobile-brand">
        <BrandMark />
      </span>
      <span className="gap">
        {extra}
        <button className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className="icon-btn" onClick={onBell} aria-label={`Notifications${unread ? `, ${unread} new` : ''}`}>
          <Icon name="bell" />
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {onSignOut && (
          <button className="icon-btn" onClick={onSignOut} aria-label="Sign out">
            <Icon name="logout" />
          </button>
        )}
      </span>
    </div>
  )
}

export const brandName = boot.brand.businessName
