import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ASSET_STATUS_LABEL,
  CATEGORY_META,
  DOCUMENT_KIND_LABEL,
  PHASE_STATUS_LABEL,
  formatDate,
  money,
  projectProgress,
  type AdminData,
  type Asset,
  type AssetCategory,
  type Client,
  type ClientStatus,
  type DocumentKind,
  type Notification,
  type Payment,
  type PortalData,
  type ProjectDetail,
  type ProjectType,
  type Session,
  type SignableDocument,
} from '../shared/types'
import './style.css'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = (await response.json().catch(() => {
    throw new Error('Could not reach the project desk. Please try again.')
  })) as T & { error?: string }
  if (!response.ok)
    throw new Error(body.error || 'That did not work. Please try again.')
  return body
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const today = new Date().toISOString().slice(0, 10)

type Theme = 'light' | 'dark'
const THEME_KEY = 'pd-theme'

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Private browsing: fall through to the system preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

document.documentElement.dataset.theme = initialTheme()

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )
  return (
    <button
      type="button"
      className="theme-toggle"
      data-theme={theme}
      aria-pressed={theme === 'dark'}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      onClick={() => {
        const next: Theme = theme === 'dark' ? 'light' : 'dark'
        setTheme(next)
        document.documentElement.dataset.theme = next
        try {
          localStorage.setItem(THEME_KEY, next)
        } catch {
          // Remembering the choice is best-effort.
        }
      }}
    >
      <span className="track" aria-hidden="true">
        <span className="knob">{theme === 'dark' ? '☾' : '☀'}</span>
      </span>
      <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  )
}

type ToastItem = {
  id: number
  title: string
  body?: string
  tone: 'success' | 'error'
  leaving?: boolean
}

let toastItems: ToastItem[] = []
const toastListeners = new Set<() => void>()
let toastSeq = 0

function emitToasts() {
  for (const listener of toastListeners) listener()
}

function toast(
  title: string,
  options?: { body?: string; tone?: 'success' | 'error' },
) {
  const item: ToastItem = {
    id: ++toastSeq,
    title,
    body: options?.body,
    tone: options?.tone ?? 'success',
  }
  toastItems = [item, ...toastItems].slice(0, 4)
  emitToasts()
  window.setTimeout(() => {
    toastItems = toastItems.map((entry) =>
      entry.id === item.id ? { ...entry, leaving: true } : entry,
    )
    emitToasts()
  }, 2600)
  window.setTimeout(() => {
    toastItems = toastItems.filter((entry) => entry.id !== item.id)
    emitToasts()
  }, 3050)
}

function ToastViewport() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((value) => value + 1)
    toastListeners.add(listener)
    return () => {
      toastListeners.delete(listener)
    }
  }, [])
  if (!toastItems.length) return null
  return (
    <div className="toast-viewport" role="status" aria-live="polite">
      {toastItems.map((item) => (
        <div
          key={item.id}
          className={`toast ${item.tone} ${item.leaving ? 'leaving' : ''}`}
        >
          <span className="toast-icon" aria-hidden="true">
            {item.tone === 'error' ? '!' : '✓'}
          </span>
          <div>
            <strong>{item.title}</strong>
            {item.body && <p>{item.body}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function BusyBar({ active }: { active: boolean }) {
  return <div className={`busy-bar ${active ? 'on' : ''}`} aria-hidden="true" />
}

function paymentState(payment: Payment): 'paid' | 'due' | 'overdue' {
  if (payment.status === 'paid') return 'paid'
  if (payment.status === 'overdue') return 'overdue'
  return payment.dueDate && payment.dueDate < today ? 'overdue' : 'due'
}

function projectStatusLabel(project: ProjectDetail): string {
  if (project.status === 'completed') return 'Completed'
  if (project.status === 'on_hold') return 'On hold'
  const active = project.phases.find((phase) => phase.status === 'ongoing')
  if (active) return `In ${active.name.toLowerCase()}`
  const next = project.phases.find((phase) => phase.status === 'queued')
  return next ? `Queued: ${next.name}` : 'Active'
}

function currentPhase(project: ProjectDetail) {
  return (
    project.phases.find((phase) => phase.status === 'ongoing') ??
    project.phases.find((phase) => phase.status === 'queued') ??
    project.phases[project.phases.length - 1] ??
    null
  )
}

function unread(notifications: Notification[]): number {
  return notifications.filter((item) => item.channel === 'in_app' && !item.readAt)
    .length
}

// ------------------------------------------------------------------ primitives

function Pill({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red' | 'blue' | 'grey'
  children: React.ReactNode
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

function phaseTone(status: string): 'green' | 'amber' | 'grey' {
  return status === 'completed' ? 'green' : status === 'ongoing' ? 'amber' : 'grey'
}

function assetTone(status: string): 'green' | 'amber' | 'red' {
  return status === 'accepted'
    ? 'green'
    : status === 'changes_requested'
      ? 'red'
      : 'amber'
}

function Bar({ value }: { value: number }) {
  return (
    <div className="bar" aria-hidden="true">
      <span style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>
}

function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-label={`${value} out of 5`}>
      {'★★★★★'.slice(0, value)}
      <span className="stars-off">{'★★★★★'.slice(value)}</span>
    </span>
  )
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function Login({ session }: { session: Session }) {
  return (
    <main className="gate">
      <div className="gate-card">
        <ThemeToggle />
        <span className="wordmark">
          Project<span>Desk</span>
        </span>
        <h1>The client portal for your web design agency.</h1>
        <p>
          Onboarding, project phases, asset reviews, payments, contracts and
          feedback — one desk your clients can actually follow.
        </p>
        {session.user ? (
          <p className="notice">
            This workspace is still being set up. Please check back shortly.
          </p>
        ) : session.mode === 'freebuff' ? (
          <a className="button primary" href="/auth/freebuff/signin?returnTo=%2F">
            Sign in with Freebuff
          </a>
        ) : (
          <p className="notice">
            Sign-in is not configured for this deployment yet.
          </p>
        )}
        <ul className="gate-features">
          <li>Phase-by-phase progress your clients can see</li>
          <li>Organised asset drive with review status</li>
          <li>Contracts signed digitally, invoices tracked</li>
        </ul>
      </div>
    </main>
  )
}

function PendingInvite({ session }: { session: Session }) {
  return (
    <main className="gate">
      <div className="gate-card">
        <span className="wordmark">
          Project<span>Desk</span>
        </span>
        <h1>Almost there.</h1>
        <p>
          You are signed in as{' '}
          <strong>{session.user?.email || session.displayName || 'this account'}</strong>
          , but no agency workspace is linked to it yet.
        </p>
        <p className="notice">
          Ask your project manager to add this email address to the client
          record, then reload this page.
        </p>
        <form method="post" action="/auth/freebuff/signout">
          <button className="button">Sign out</button>
        </form>
      </div>
    </main>
  )
}

// ------------------------------------------------------------------ admin views

function AssetReviewRow({
  asset,
  projectName,
  clientName,
  busy,
  onReview,
}: {
  asset: Asset
  projectName: string
  clientName: string
  busy: boolean
  onReview: (asset: Asset, status: 'accepted' | 'changes_requested', note: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  return (
    <div className="asset-row">
      <div className={`asset-icon kind-${asset.kind}`}>
        {asset.kind === 'video'
          ? '▶'
          : asset.kind === 'image'
            ? '▣'
            : asset.kind === 'archive'
              ? '▤'
              : asset.kind === 'link'
                ? '↗'
                : '▦'}
      </div>
      <div className="asset-main">
        <div className="asset-title">
          <strong>{asset.name}</strong>
          <Pill tone={assetTone(asset.status)}>
            {ASSET_STATUS_LABEL[asset.status]}
          </Pill>
        </div>
        <p className="muted">
          {CATEGORY_META[asset.category].label} · {projectName} · {clientName} ·{' '}
          {formatDate(asset.createdAt)}
        </p>
        {asset.reviewNote && (
          <p className="review-note">“{asset.reviewNote}”</p>
        )}
        {open && (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!note.trim()) return
              onReview(asset, 'changes_requested', note.trim())
              setOpen(false)
              setNote('')
            }}
          >
            <input
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What exactly needs to change?"
              maxLength={600}
            />
            <button className="button small danger" disabled={busy || !note.trim()}>
              Send request
            </button>
            <button
              type="button"
              className="button small quiet"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </form>
        )}
      </div>
      <div className="asset-actions">
        {asset.hasFile && (
          <a
            className="button small quiet"
            href={`/api/portal/assets/${asset.id}/file`}
            target="_blank"
            rel="noreferrer"
          >
            Open
          </a>
        )}
        {asset.status !== 'accepted' && (
          <button
            className="button small"
            disabled={busy}
            onClick={() => onReview(asset, 'accepted', '')}
          >
            Accept
          </button>
        )}
        {asset.status !== 'changes_requested' && (
          <button
            className="button small danger-quiet"
            disabled={busy}
            onClick={() => setOpen((value) => !value)}
          >
            Request changes
          </button>
        )}
      </div>
    </div>
  )
}

function PhaseEditor({
  project,
  busy,
  onStatus,
}: {
  project: ProjectDetail
  busy: boolean
  onStatus: (phaseId: string, status: 'queued' | 'ongoing' | 'completed') => void
}) {
  return (
    <ol className="phases">
      {project.phases.map((phase, index) => (
        <li key={phase.id} className={`phase phase-${phase.status}`}>
          <span className="phase-index">{String(index + 1).padStart(2, '0')}</span>
          <div className="phase-name">
            <strong>{phase.name}</strong>
            <span className="muted">
              {phase.status === 'completed' && phase.completedAt
                ? `Completed ${formatDate(phase.completedAt)}`
                : phase.status === 'ongoing' && phase.startedAt
                  ? `Started ${formatDate(phase.startedAt)}`
                  : 'In queue'}
            </span>
          </div>
          <Pill tone={phaseTone(phase.status)}>
            {PHASE_STATUS_LABEL[phase.status]}
          </Pill>
          <div className="phase-actions">
            {phase.status === 'queued' && (
              <button
                className="button small"
                disabled={busy}
                onClick={() => onStatus(phase.id, 'ongoing')}
              >
                Start
              </button>
            )}
            {phase.status === 'ongoing' && (
              <button
                className="button small"
                disabled={busy}
                onClick={() => onStatus(phase.id, 'completed')}
              >
                Mark complete
              </button>
            )}
            {phase.status === 'completed' && (
              <button
                className="button small quiet"
                disabled={busy}
                onClick={() => onStatus(phase.id, 'queued')}
              >
                Reopen
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function AdminProjectPanel({
  project,
  client,
  onBack,
  busy,
  onAction,
}: {
  project: ProjectDetail
  client: Client | undefined
  onBack: () => void
  busy: boolean
  onAction: (run: () => Promise<unknown>, message?: string) => void
}) {
  const [tab, setTab] = useState<'phases' | 'assets' | 'payments' | 'docs' | 'feedback'>(
    'phases',
  )
  const [payment, setPayment] = useState({ label: '', amount: '', dueDate: '' })
  const [document, setDocument] = useState<{
    kind: DocumentKind
    title: string
    body: string
  }>({ kind: 'contract', title: '', body: '' })
  const [message, setMessage] = useState('')
  const progress = projectProgress(project)
  const outstanding = project.payments
    .filter((item) => paymentState(item) !== 'paid')
    .reduce((sum, item) => sum + item.amountCents, 0)

  return (
    <section className="panel">
      <button className="back" onClick={onBack}>
        ← All projects
      </button>
      <header className="panel-head">
        <div>
          <span className="eyebrow">{client?.company ?? 'Client'}</span>
          <h2>{project.name}</h2>
          <p className="muted">
            {projectStatusLabel(project)} · due {formatDate(project.dueDate)} ·
            started {formatDate(project.startDate)}
          </p>
        </div>
        <div className="head-stats">
          <div>
            <span className="muted">Progress</span>
            <strong>{progress}%</strong>
          </div>
          <div>
            <span className="muted">Outstanding</span>
            <strong>{money(outstanding)}</strong>
          </div>
        </div>
      </header>
      <Bar value={progress} />
      <nav className="tabs" aria-label="Project sections">
        {(
          [
            ['phases', 'Phases'],
            ['assets', `Assets (${project.assets.filter((a) => a.status === 'pending').length})`],
            ['payments', 'Payments'],
            ['docs', 'Documents'],
            ['feedback', 'Feedback'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'phases' && (
        <div className="stack">
          <PhaseEditor
            project={project}
            busy={busy}
            onStatus={(phaseId, status) =>
              onAction(
                () => api(`/api/admin/phases/${phaseId}`, json('PATCH', { status })),
                status === 'completed'
                  ? 'Phase completed — client notified'
                  : 'Phase updated — client notified',
              )
            }
          />
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              const name = (
                event.currentTarget.elements.namedItem('phase') as HTMLInputElement
              ).value.trim()
              if (!name) return
              onAction(async () => {
                await api(`/api/admin/projects/${project.id}/phases`, json('POST', { name }))
                ;(event.currentTarget.elements.namedItem('phase') as HTMLInputElement).value = ''
              }, 'Phase added to the pipeline')
            }}
          >
            <input name="phase" placeholder="Add a phase (e.g. Accessibility audit)" maxLength={120} />
            <button className="button small">Add phase</button>
          </form>
        </div>
      )}

      {tab === 'assets' && (
        <div className="stack">
          {(['brief', 'brand', 'copy', 'images', 'video', 'references', 'data'] as AssetCategory[]).map(
            (category) => {
              const items = project.assets.filter((asset) => asset.category === category)
              if (!items.length) return null
              return (
                <div key={category} className="asset-group">
                  <h3 className="group-title">
                    {CATEGORY_META[category].label}
                    <span className="muted">{items.length} items</span>
                  </h3>
                  {items.map((asset) => (
                    <AssetReviewRow
                      key={asset.id}
                      asset={asset}
                      projectName={project.name}
                      clientName={client?.contactName ?? ''}
                      busy={busy}
                      onReview={(target, status, note) =>
                        onAction(
                          () =>
                            api(
                              `/api/admin/assets/${target.id}`,
                              json('PATCH', { status, note }),
                            ),
                          status === 'accepted'
                            ? 'Asset accepted — client notified'
                            : 'Change request sent',
                        )
                      }
                    />
                  ))}
                </div>
              )
            },
          )}
          {!project.assets.length && (
            <Empty>
              Nothing uploaded yet. Assets the client sends appear here for review,
              grouped by folder.
            </Empty>
          )}
        </div>
      )}

      {tab === 'payments' && (
        <div className="stack">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Amount</th>
                <th>Due</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {project.payments.map((item) => {
                const state = paymentState(item)
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.label}</strong>
                      {item.method && <span className="muted block">{item.method}</span>}
                    </td>
                    <td>{money(item.amountCents, item.currency)}</td>
                    <td>{formatDate(item.dueDate)}</td>
                    <td>
                      <Pill tone={state === 'paid' ? 'green' : state === 'overdue' ? 'red' : 'amber'}>
                        {state === 'paid' ? 'Paid' : state === 'overdue' ? 'Overdue' : 'Due'}
                      </Pill>
                    </td>
                    <td className="right">
                      {state !== 'paid' && (
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={() =>
                            onAction(
                              () =>
                                api(
                                  `/api/admin/payments/${item.id}`,
                                  json('PATCH', { status: 'paid' }),
                                ),
                              'Payment marked paid',
                            )
                          }
                        >
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!project.payments.length && <Empty>No invoices on this project yet.</Empty>}
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!payment.label.trim() || !payment.amount || !payment.dueDate) return
              onAction(async () => {
                await api(
                  `/api/admin/projects/${project.id}/payments`,
                  json('POST', payment),
                )
                setPayment({ label: '', amount: '', dueDate: '' })
              }, 'Invoice added — client notified')
            }}
          >
            <input
              placeholder="Invoice label"
              value={payment.label}
              onChange={(event) => setPayment({ ...payment, label: event.target.value })}
            />
            <input
              placeholder="Amount (USD)"
              inputMode="decimal"
              size={10}
              value={payment.amount}
              onChange={(event) => setPayment({ ...payment, amount: event.target.value })}
            />
            <input
              type="date"
              value={payment.dueDate}
              onChange={(event) => setPayment({ ...payment, dueDate: event.target.value })}
            />
            <button className="button small">Add invoice</button>
          </form>
        </div>
      )}

      {tab === 'docs' && (
        <div className="stack">
          <p className="muted">
            Contracts and retainers live on the client record. Documents sent here
            appear in this client’s Documents tab for signature.
          </p>
          <form
            className="stack form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!document.title.trim()) return
              onAction(async () => {
                await api(
                  '/api/admin/documents',
                  json('POST', {
                    clientId: project.clientId,
                    projectId: project.id,
                    kind: document.kind,
                    title: document.title,
                    body: document.body,
                  }),
                )
                setDocument({ kind: 'contract', title: '', body: '' })
              }, 'Document sent for signature')
            }}
          >
            <label>
              Document type
              <select
                value={document.kind}
                onChange={(event) =>
                  setDocument({ ...document, kind: event.target.value as DocumentKind })
                }
              >
                {(Object.keys(DOCUMENT_KIND_LABEL) as DocumentKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {DOCUMENT_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input
                value={document.title}
                onChange={(event) => setDocument({ ...document, title: event.target.value })}
                placeholder="Retainer agreement — 2026"
              />
            </label>
            <label>
              Body (leave blank for the standard agreement)
              <textarea
                rows={7}
                value={document.body}
                onChange={(event) => setDocument({ ...document, body: event.target.value })}
              />
            </label>
            <button className="button">Send for signature</button>
          </form>
        </div>
      )}

      {tab === 'feedback' && (
        <div className="stack">
          {project.reviews.length === 0 && (
            <Empty>No client reviews on this project yet.</Empty>
          )}
          {project.reviews.map((review) => (
            <article key={review.id} className="review">
              <header>
                <strong>{review.milestone}</strong>
                <Stars value={review.rating} />
              </header>
              <p>{review.body}</p>
              <span className="muted">
                {review.authorName} · {formatDate(review.createdAt)}
              </span>
            </article>
          ))}
          <div className="thread">
            <h3 className="group-title">Email thread</h3>
            {project.thread?.messages.map((item) => (
              <div key={item.id} className={`bubble ${item.authorRole}`}>
                <span className="muted">
                  {item.authorName} · {formatDate(item.createdAt)}
                </span>
                <p>{item.body}</p>
              </div>
            ))}
            {!project.thread?.messages.length && <Empty>No messages yet.</Empty>}
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (!message.trim()) return
                onAction(async () => {
                  await api(
                    `/api/admin/projects/${project.id}/messages`,
                    json('POST', { body: message }),
                  )
                  setMessage('')
                }, 'Message sent')
              }}
            >
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Reply to the client — emailed to them as well"
              />
              <button className="button small">Send</button>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

function Admin({
  session,
  onExitPreview,
}: {
  session: Session
  onExitPreview?: () => void
}) {
  const [data, setData] = useState<AdminData | null>(null)
  const [view, setView] = useState<
    'overview' | 'clients' | 'projects' | 'reviews' | 'payments' | 'outbox'
  >('overview')
  const [selected, setSelected] = useState<string | null>(null)
  const [previewClient, setPreviewClient] = useState<Client | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newClient, setNewClient] = useState({
    company: '',
    contactName: '',
    email: '',
    phone: '',
    industry: '',
    projectName: '',
    type: 'website' as ProjectType,
    dueDate: '',
    notes: '',
  })
  const [newProject, setNewProject] = useState({
    clientId: '',
    name: '',
    type: 'website' as ProjectType,
    dueDate: '',
    summary: '',
  })

  const reload = useCallback(async () => {
    const next = await api<AdminData>('/api/admin/data')
    setData(next)
  }, [])

  useEffect(() => {
    void reload().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Could not load the desk.'),
    )
  }, [reload])

  const act = useCallback(
    (run: () => Promise<unknown>, message?: string) => {
      setBusy(true)
      setError('')
      void run()
        .then(() => {
          if (message) toast(message)
          return reload()
        })
        .catch((reason: unknown) => {
          const detail =
            reason instanceof Error ? reason.message : 'That did not work.'
          setError(detail)
          toast('Something went wrong', { body: detail, tone: 'error' })
        })
        .finally(() => setBusy(false))
    },
    [reload],
  )

  if (previewClient) {
    return (
      <Portal
        clientId={previewClient.id}
        preview
        onExit={() => setPreviewClient(null)}
      />
    )
  }

  if (!data) {
    return (
      <div className="loading">
        {error || 'Loading the studio desk…'}
      </div>
    )
  }

  const clientById = (id: string) => data.clients.find((client) => client.id === id)
  const allPayments = data.projects.flatMap((project) => project.payments)
  const reviewQueue = data.projects.flatMap((project) =>
    project.assets
      .filter((asset) => asset.status === 'pending')
      .map((asset) => ({ asset, project })),
  )
  const outstanding = allPayments
    .filter((item) => paymentState(item) !== 'paid')
    .reduce((sum, item) => sum + item.amountCents, 0)
  const activeProjects = data.projects.filter((project) => project.status === 'active')
  const awaitingSignature = data.documents.filter(
    (document) => document.status === 'awaiting_signature',
  )
  const selectedProject = data.projects.find((project) => project.id === selected) ?? null
  const unreadAdmin = unread(data.notifications)

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Project<span>Desk</span>
          <small>Agency console</small>
        </div>
        <nav>
          {(
            [
              ['overview', 'Overview'],
              ['clients', 'Clients'],
              ['projects', 'Projects'],
              ['reviews', `Asset reviews${reviewQueue.length ? ` · ${reviewQueue.length}` : ''}`],
              ['payments', 'Payments'],
              ['outbox', 'Notifications'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={view === key && !selected ? 'active' : ''}
              onClick={() => {
                setView(key)
                setSelected(null)
              }}
            >
              {label}
              {key === 'outbox' && unreadAdmin > 0 && (
                <span className="badge-dot">{unreadAdmin}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="muted">
            {session.mode === 'local' ? 'Local preview' : session.user?.email || 'Signed in'}
          </span>
          <ThemeToggle />
          <form method="post" action="/auth/freebuff/signout">
            <button className="quiet">Sign out</button>
          </form>
        </div>
      </aside>

      <main className="main">
        <BusyBar active={busy} />
        {onExitPreview && (
          <div className="preview-banner">
            Previewing a client portal.
            <button className="button small" onClick={onExitPreview}>
              Back to admin
            </button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}

        {!selected && view === 'overview' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Studio overview</span>
                <h1>Everything in flight.</h1>
                <p className="muted">
                  {activeProjects.length} active projects · {reviewQueue.length} assets
                  waiting on you
                </p>
              </div>
              <button className="button" onClick={() => setView('clients')}>
                Onboard a client
              </button>
            </header>

            <div className="kpis">
              <div className="kpi">
                <span>Active projects</span>
                <strong>{activeProjects.length}</strong>
                <small>{data.projects.length} total</small>
              </div>
              <div className="kpi">
                <span>Assets to review</span>
                <strong>{reviewQueue.length}</strong>
                <small>client uploads waiting</small>
              </div>
              <div className="kpi">
                <span>Awaiting signature</span>
                <strong>{awaitingSignature.length}</strong>
                <small>{data.clients.filter((client) => client.status === 'onboarding').length} clients onboarding</small>
              </div>
              <div className="kpi">
                <span>Outstanding</span>
                <strong>{money(outstanding)}</strong>
                <small>unpaid invoices</small>
              </div>
            </div>

            <div className="two-col">
              <div className="card">
                <h2>Project pipeline</h2>
                {activeProjects.map((project) => (
                  <button
                    key={project.id}
                    className="pipeline-row"
                    onClick={() => {
                      setView('projects')
                      setSelected(project.id)
                    }}
                  >
                    <div className="pipeline-main">
                      <strong>{project.name}</strong>
                      <span className="muted">
                        {clientById(project.clientId)?.company} ·{' '}
                        {projectStatusLabel(project)}
                      </span>
                      <Bar value={projectProgress(project)} />
                    </div>
                    <div className="pipeline-side">
                      <strong>{projectProgress(project)}%</strong>
                      <span className="muted">due {formatDate(project.dueDate)}</span>
                    </div>
                  </button>
                ))}
                {!activeProjects.length && <Empty>No active projects yet.</Empty>}
              </div>

              <div className="card">
                <h2>Latest client activity</h2>
                {data.notifications
                  .filter((item) => item.channel === 'in_app')
                  .slice(0, 6)
                  .map((item) => (
                    <div key={item.id} className="activity">
                      <span className={`dot ${item.readAt ? '' : 'unread'}`} />
                      <div>
                        <strong>{item.title}</strong>
                        <p className="muted">{item.body}</p>
                        <span className="muted">{formatDate(item.createdAt)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="card">
              <h2>Next invoices</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Due</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {allPayments
                    .filter((item) => paymentState(item) !== 'paid')
                    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                    .slice(0, 6)
                    .map((item) => {
                      const state = paymentState(item)
                      const project = data.projects.find((p) => p.id === item.projectId)
                      return (
                        <tr key={item.id}>
                          <td>{project ? clientById(project.clientId)?.company : '—'}</td>
                          <td>{item.label}</td>
                          <td>{money(item.amountCents, item.currency)}</td>
                          <td>{formatDate(item.dueDate)}</td>
                          <td>
                            <Pill tone={state === 'overdue' ? 'red' : 'amber'}>
                              {state === 'overdue' ? 'Overdue' : 'Due'}
                            </Pill>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!selected && view === 'clients' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Clients</span>
                <h1>Onboarding & accounts.</h1>
                <p className="muted">
                  Adding a client creates their portal, the project pipeline and the
                  onboarding agreement in one step.
                </p>
              </div>
            </header>

            <div className="client-grid">
              {data.clients.map((client) => {
                const projects = data.projects.filter((p) => p.clientId === client.id)
                const owed = projects
                  .flatMap((p) => p.payments)
                  .filter((p) => paymentState(p) !== 'paid')
                  .reduce((sum, p) => sum + p.amountCents, 0)
                const open = data.documents.filter(
                  (d) => d.clientId === client.id && d.status === 'awaiting_signature',
                ).length
                return (
                  <article key={client.id} className="card client-card">
                    <header>
                      <div>
                        <h2>{client.company}</h2>
                        <span className="muted">
                          {client.contactName} · {client.email}
                        </span>
                      </div>
                      <Pill
                        tone={
                          client.status === 'active'
                            ? 'green'
                            : client.status === 'onboarding'
                              ? 'amber'
                              : 'grey'
                        }
                      >
                        {client.status === 'onboarding' ? 'Onboarding' : client.status}
                      </Pill>
                    </header>
                    <p className="muted">
                      {client.industry || 'Industry not set'}
                      {client.phone ? ` · ${client.phone}` : ''}
                    </p>
                    <div className="mini-stats">
                      <span>
                        <strong>{projects.length}</strong> projects
                      </span>
                      <span>
                        <strong>{money(owed)}</strong> outstanding
                      </span>
                      <span>
                        <strong>{open}</strong> to sign
                      </span>
                    </div>
                    {client.notes && <p className="client-note">{client.notes}</p>}
                    <footer>
                      <button
                        className="button small"
                        onClick={() => setPreviewClient(client)}
                      >
                        Open client portal
                      </button>
                      <select
                        value={client.status}
                        aria-label={`Status for ${client.company}`}
                        onChange={(event) =>
                          act(
                            () =>
                              api(
                                `/api/admin/clients/${client.id}`,
                                json('PATCH', { status: event.target.value as ClientStatus }),
                              ),
                            'Client status updated',
                          )
                        }
                      >
                        {['onboarding', 'active', 'paused', 'archived'].map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </footer>
                  </article>
                )
              })}
            </div>

            <div className="card">
              <h2>Onboard a new client</h2>
              <form
                className="form grid-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  act(async () => {
                    await api('/api/admin/clients', json('POST', newClient))
                    setNewClient({
                      company: '',
                      contactName: '',
                      email: '',
                      phone: '',
                      industry: '',
                      projectName: '',
                      type: 'website',
                      dueDate: '',
                      notes: '',
                    })
                  }, 'Client onboarded — agreement ready to sign')
                }}
              >
                <label>
                  Company
                  <input
                    required
                    value={newClient.company}
                    onChange={(event) =>
                      setNewClient({ ...newClient, company: event.target.value })
                    }
                  />
                </label>
                <label>
                  Primary contact
                  <input
                    required
                    value={newClient.contactName}
                    onChange={(event) =>
                      setNewClient({ ...newClient, contactName: event.target.value })
                    }
                  />
                </label>
                <label>
                  Contact email
                  <input
                    required
                    type="email"
                    value={newClient.email}
                    onChange={(event) =>
                      setNewClient({ ...newClient, email: event.target.value })
                    }
                    placeholder="They sign in with this address"
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={newClient.phone}
                    onChange={(event) =>
                      setNewClient({ ...newClient, phone: event.target.value })
                    }
                  />
                </label>
                <label>
                  First project
                  <input
                    value={newClient.projectName}
                    onChange={(event) =>
                      setNewClient({ ...newClient, projectName: event.target.value })
                    }
                    placeholder="Website redesign"
                  />
                </label>
                <label>
                  Project type
                  <select
                    value={newClient.type}
                    onChange={(event) =>
                      setNewClient({ ...newClient, type: event.target.value as ProjectType })
                    }
                  >
                    <option value="website">Website</option>
                    <option value="web_app">Web app</option>
                    <option value="seo">SEO</option>
                    <option value="branding">Branding</option>
                    <option value="retainer">Retainer</option>
                  </select>
                </label>
                <label>
                  Target delivery
                  <input
                    type="date"
                    value={newClient.dueDate}
                    onChange={(event) =>
                      setNewClient({ ...newClient, dueDate: event.target.value })
                    }
                  />
                </label>
                <label className="span-2">
                  Notes for the team
                  <textarea
                    rows={2}
                    value={newClient.notes}
                    onChange={(event) =>
                      setNewClient({ ...newClient, notes: event.target.value })
                    }
                  />
                </label>
                <div className="span-2">
                  <button className="button primary" disabled={busy}>
                    Create client & send onboarding
                  </button>
                </div>
              </form>
            </div>
          </section>
        )}

        {!selected && view === 'projects' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Projects</span>
                <h1>Phases, assets and invoices.</h1>
              </div>
            </header>
            <div className="project-grid">
              {data.projects.map((project) => (
                <button
                  key={project.id}
                  className="card project-card"
                  onClick={() => setSelected(project.id)}
                >
                  <header>
                    <span className="eyebrow">{clientById(project.clientId)?.company}</span>
                    <Pill
                      tone={
                        project.status === 'completed'
                          ? 'green'
                          : project.status === 'on_hold'
                            ? 'grey'
                            : 'amber'
                      }
                    >
                      {project.status === 'completed'
                        ? 'Completed'
                        : project.status === 'on_hold'
                          ? 'On hold'
                          : 'Active'}
                    </Pill>
                  </header>
                  <h2>{project.name}</h2>
                  <p className="muted">{projectStatusLabel(project)}</p>
                  <Bar value={projectProgress(project)} />
                  <footer>
                    <span className="muted">{projectProgress(project)}% complete</span>
                    <span className="muted">due {formatDate(project.dueDate)}</span>
                  </footer>
                </button>
              ))}
            </div>

            <div className="card">
              <h2>Start another project</h2>
              <p className="muted">
                For a client already on the desk — the pipeline is created for you.
              </p>
              <form
                className="form grid-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  act(async () => {
                    await api('/api/admin/projects', json('POST', newProject))
                    setNewProject({
                      clientId: '',
                      name: '',
                      type: 'website',
                      dueDate: '',
                      summary: '',
                    })
                  }, 'Project created with a full phase pipeline')
                }}
              >
                <label>
                  Client
                  <select
                    required
                    value={newProject.clientId}
                    onChange={(event) =>
                      setNewProject({ ...newProject, clientId: event.target.value })
                    }
                  >
                    <option value="">Choose a client</option>
                    {data.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.company}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Project name
                  <input
                    required
                    value={newProject.name}
                    onChange={(event) =>
                      setNewProject({ ...newProject, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Type
                  <select
                    value={newProject.type}
                    onChange={(event) =>
                      setNewProject({ ...newProject, type: event.target.value as ProjectType })
                    }
                  >
                    <option value="website">Website</option>
                    <option value="web_app">Web app</option>
                    <option value="seo">SEO</option>
                    <option value="branding">Branding</option>
                    <option value="retainer">Retainer</option>
                  </select>
                </label>
                <label>
                  Target delivery
                  <input
                    type="date"
                    value={newProject.dueDate}
                    onChange={(event) =>
                      setNewProject({ ...newProject, dueDate: event.target.value })
                    }
                  />
                </label>
                <label className="span-2">
                  Summary
                  <textarea
                    rows={2}
                    value={newProject.summary}
                    onChange={(event) =>
                      setNewProject({ ...newProject, summary: event.target.value })
                    }
                  />
                </label>
                <div className="span-2">
                  <button className="button primary" disabled={busy}>
                    Create project
                  </button>
                </div>
              </form>
            </div>
          </section>
        )}

        {selected && selectedProject && (
          <AdminProjectPanel
            project={selectedProject}
            client={clientById(selectedProject.clientId)}
            busy={busy}
            onBack={() => setSelected(null)}
            onAction={act}
          />
        )}

        {!selected && view === 'reviews' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Asset tracker</span>
                <h1>Review what was sent.</h1>
                <p className="muted">
                  Clients see the outcome immediately, plus an email notification.
                </p>
              </div>
            </header>
            <div className="card">
              {reviewQueue.map(({ asset, project }) => (
                <AssetReviewRow
                  key={asset.id}
                  asset={asset}
                  projectName={project.name}
                  clientName={clientById(project.clientId)?.contactName ?? ''}
                  busy={busy}
                  onReview={(target, status, note) =>
                    act(
                      () =>
                        api(
                          `/api/admin/assets/${target.id}`,
                          json('PATCH', { status, note }),
                        ),
                      status === 'accepted'
                        ? `Accepted “${target.name}” — client notified`
                        : `Change request sent for “${target.name}”`,
                    )
                  }
                />
              ))}
              {!reviewQueue.length && (
                <Empty>Nothing waiting. Every uploaded asset has been reviewed.</Empty>
              )}
            </div>
          </section>
        )}

        {!selected && view === 'payments' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Payments</span>
                <h1>Every invoice, one ledger.</h1>
              </div>
            </header>
            <div className="kpis">
              <div className="kpi">
                <span>Collected</span>
                <strong>
                  {money(
                    allPayments
                      .filter((item) => paymentState(item) === 'paid')
                      .reduce((sum, item) => sum + item.amountCents, 0),
                  )}
                </strong>
              </div>
              <div className="kpi">
                <span>Outstanding</span>
                <strong>{money(outstanding)}</strong>
              </div>
              <div className="kpi">
                <span>Overdue invoices</span>
                <strong>
                  {allPayments.filter((item) => paymentState(item) === 'overdue').length}
                </strong>
              </div>
            </div>
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Client / project</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {allPayments.map((item) => {
                    const project = data.projects.find((p) => p.id === item.projectId)
                    const state = paymentState(item)
                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>
                            {project ? clientById(project.clientId)?.company : '—'}
                          </strong>
                          <span className="muted block">{project?.name}</span>
                        </td>
                        <td>{item.label}</td>
                        <td>{money(item.amountCents, item.currency)}</td>
                        <td>{formatDate(item.dueDate)}</td>
                        <td>
                          <Pill
                            tone={
                              state === 'paid' ? 'green' : state === 'overdue' ? 'red' : 'amber'
                            }
                          >
                            {state === 'paid' ? 'Paid' : state === 'overdue' ? 'Overdue' : 'Due'}
                          </Pill>
                        </td>
                        <td className="right">
                          {state !== 'paid' && (
                            <button
                              className="button small"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  () =>
                                    api(
                                      `/api/admin/payments/${item.id}`,
                                      json('PATCH', { status: 'paid' }),
                                    ),
                                  'Payment marked paid',
                                )
                              }
                            >
                              Mark paid
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!selected && view === 'outbox' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Notification log</span>
                <h1>What the system sent.</h1>
                <p className="muted">
                  In-app updates are always recorded. Email and WhatsApp deliver when
                  the provider keys are configured; queued messages are listed with
                  their recipient.
                </p>
              </div>
              <button
                className="button small"
                disabled={busy}
                onClick={() =>
                  act(
                    () => api('/api/admin/notifications/read', json('POST', {})),
                    'Notifications marked read',
                  )
                }
              >
                Mark all read
              </button>
            </header>
            <div className="channel-row">
              <span className={data.channels.email ? 'chip on' : 'chip'}>
                Email {data.channels.email ? 'connected' : 'not configured'}
              </span>
              <span className={data.channels.whatsapp ? 'chip on' : 'chip'}>
                WhatsApp {data.channels.whatsapp ? 'connected' : 'not configured'}
              </span>
              <span className={data.channels.storage ? 'chip on' : 'chip'}>
                Asset storage {data.channels.storage ? 'ready' : 'not configured'}
              </span>
            </div>
            <div className="card outbox">
              {data.notifications.map((item) => (
                <div key={item.id} className="outbox-row">
                  <div className="outbox-main">
                    <strong>{item.title}</strong>
                    <p className="muted">{item.body}</p>
                    <span className="muted">
                      {formatDate(item.createdAt)}
                      {item.recipient ? ` · to ${item.recipient}` : ''}
                      {item.clientId
                        ? ` · ${clientById(item.clientId)?.company ?? ''}`
                        : ''}
                    </span>
                  </div>
                  <div className="outbox-meta">
                    <Pill tone={item.channel === 'in_app' ? 'grey' : item.channel === 'email' ? 'blue' : 'green'}>
                      {item.channel === 'in_app' ? 'In-app' : item.channel === 'email' ? 'Email' : 'WhatsApp'}
                    </Pill>
                    <Pill
                      tone={
                        item.status === 'sent'
                          ? 'green'
                          : item.status === 'failed'
                            ? 'red'
                            : 'amber'
                      }
                    >
                      {item.status}
                    </Pill>
                  </div>
                </div>
              ))}
              {!data.notifications.length && <Empty>No notifications yet.</Empty>}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

// ------------------------------------------------------------------ client views

function SignaturePad({ onChange }: { onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.lineWidth = 2.4
    context.lineCap = 'round'
    context.strokeStyle = '#14181c'
  }, [])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  return (
    <div className="signature">
      <canvas
        ref={canvasRef}
        width={640}
        height={200}
        onPointerDown={(event) => {
          drawing.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          const context = event.currentTarget.getContext('2d')
          const spot = point(event)
          context?.beginPath()
          context?.moveTo(spot.x, spot.y)
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return
          const context = event.currentTarget.getContext('2d')
          const spot = point(event)
          context?.lineTo(spot.x, spot.y)
          context?.stroke()
        }}
        onPointerUp={(event) => {
          drawing.current = false
          onChange(event.currentTarget.toDataURL('image/png'))
        }}
      />
      <div className="signature-foot">
        <span className="muted">Draw your signature above</span>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            const canvas = canvasRef.current
            canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
            onChange('')
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}

function DocumentRow({
  document,
  onOpen,
}: {
  document: SignableDocument
  onOpen: () => void
}) {
  return (
    <div className="asset-row">
      <div className="asset-icon kind-document">✎</div>
      <div className="asset-main">
        <div className="asset-title">
          <strong>{document.title}</strong>
          <Pill tone={document.status === 'signed' ? 'green' : 'amber'}>
            {document.status === 'signed' ? 'Signed' : 'Awaiting signature'}
          </Pill>
        </div>
        <p className="muted">
          {DOCUMENT_KIND_LABEL[document.kind]} ·{' '}
          {document.status === 'signed'
            ? `signed by ${document.signatureName} on ${formatDate(document.signedAt)}`
            : `sent ${formatDate(document.createdAt)}`}
        </p>
      </div>
      <div className="asset-actions">
        <button className="button small" onClick={onOpen}>
          {document.status === 'signed' ? 'View' : 'Review & sign'}
        </button>
      </div>
    </div>
  )
}

function PortalProject({
  project,
  onBack,
  onRefresh,
}: {
  project: ProjectDetail
  onBack: () => void
  onRefresh: () => Promise<void>
}) {
  const [tab, setTab] = useState<'progress' | 'assets' | 'payments' | 'reviews' | 'messages'>(
    'progress',
  )
  const [message, setMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [pendingCategory, setPendingCategory] = useState<AssetCategory>('brief')
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [review, setReview] = useState({ rating: 5, milestone: '', body: '' })
  const progress = projectProgress(project)
  const active = currentPhase(project)
  const outstanding = project.payments
    .filter((item) => paymentState(item) !== 'paid')
    .reduce((sum, item) => sum + item.amountCents, 0)

  async function upload(file: File) {
    setUploading(true)
    setUploadError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('category', pendingCategory)
      const response = await fetch(`/api/portal/projects/${project.id}/assets`, {
        method: 'POST',
        body: form,
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Upload failed.')
      }
      await onRefresh()
      toast('Upload received', {
        body: `${file.name} is now in the review queue.`,
      })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Upload failed.'
      setUploadError(message)
      toast('Upload failed', { body: message, tone: 'error' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="panel">
      <BusyBar active={uploading} />
      <button className="back" onClick={onBack}>
        ← All projects
      </button>
      <header className="panel-head">
        <div>
          <span className="eyebrow">Project</span>
          <h2>{project.name}</h2>
          <p className="muted">
            {projectStatusLabel(project)} · expected completion{' '}
            {formatDate(project.dueDate)}
          </p>
        </div>
        <div className="head-stats">
          <div>
            <span className="muted">Progress</span>
            <strong>{progress}%</strong>
          </div>
          <div>
            <span className="muted">Outstanding</span>
            <strong>{money(outstanding)}</strong>
          </div>
        </div>
      </header>
      <Bar value={progress} />
      <nav className="tabs" aria-label="Project sections">
        {(
          [
            ['progress', 'Progress'],
            ['assets', `Assets (${project.assets.length})`],
            ['payments', 'Payments'],
            ['reviews', 'Reviews'],
            ['messages', 'Messages'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'progress' && (
        <div className="stack">
          <div className="progress-grid">
            <div className="card soft">
              <span className="eyebrow">Current phase</span>
              <h3>{active?.name ?? 'Not started'}</h3>
              <p className="muted">
                {active ? PHASE_STATUS_LABEL[active.status] : 'Awaiting kick-off'}
              </p>
            </div>
            <div className="card soft">
              <span className="eyebrow">Expected completion</span>
              <h3>{formatDate(project.dueDate)}</h3>
              <p className="muted">
                {project.phases.filter((phase) => phase.status === 'completed').length} of{' '}
                {project.phases.length} phases complete
              </p>
            </div>
            <div className="card soft">
              <span className="eyebrow">Next up</span>
              <h3>
                {project.phases.find((phase) => phase.status === 'queued')?.name ??
                  'Final handover'}
              </h3>
              <p className="muted">You will be notified as each phase changes</p>
            </div>
          </div>
          <ol className="phases read-only">
            {project.phases.map((phase, index) => (
              <li key={phase.id} className={`phase phase-${phase.status}`}>
                <span className="phase-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="phase-name">
                  <strong>{phase.name}</strong>
                  <span className="muted">
                    {phase.status === 'completed' && phase.completedAt
                      ? `Completed ${formatDate(phase.completedAt)}`
                      : phase.status === 'ongoing'
                        ? 'Happening now'
                        : 'In queue'}
                  </span>
                </div>
                <Pill tone={phaseTone(phase.status)}>
                  {PHASE_STATUS_LABEL[phase.status]}
                </Pill>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === 'assets' && (
        <div className="stack">
          <div className="drive-head">
            <p className="muted">
              Upload files into the right folder. We review everything you send and
              tell you if something needs another pass.
            </p>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept={CATEGORY_META[pendingCategory].accepts}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
                event.target.value = ''
              }}
            />
          </div>
          {uploadError && <p className="error">{uploadError}</p>}
          {(['brief', 'brand', 'copy', 'images', 'video', 'references', 'data'] as AssetCategory[]).map(
            (category) => {
              const items = project.assets.filter((asset) => asset.category === category)
              return (
                <div key={category} className="asset-group">
                  <h3 className="group-title">
                    {CATEGORY_META[category].label}
                    <span className="muted">{CATEGORY_META[category].hint}</span>
                  </h3>
                  {items.map((asset) => (
                    <div key={asset.id} className="asset-row">
                      {asset.kind === 'image' && asset.hasFile ? (
                        <img
                          className="thumb"
                          src={`/api/portal/assets/${asset.id}/file`}
                          alt=""
                        />
                      ) : (
                        <div className={`asset-icon kind-${asset.kind}`}>
                          {asset.kind === 'video'
                            ? '▶'
                            : asset.kind === 'image'
                              ? '▣'
                              : asset.kind === 'archive'
                                ? '▤'
                                : asset.kind === 'link'
                                  ? '↗'
                                  : '▦'}
                        </div>
                      )}
                      <div className="asset-main">
                        <div className="asset-title">
                          <strong>{asset.name}</strong>
                          <Pill tone={assetTone(asset.status)}>
                            {ASSET_STATUS_LABEL[asset.status]}
                          </Pill>
                        </div>
                        <p className="muted">
                          Uploaded {formatDate(asset.createdAt)}
                          {asset.size ? ` · ${(asset.size / 1_048_576).toFixed(1)} MB` : ''}
                        </p>
                        {asset.status === 'changes_requested' && asset.reviewNote && (
                          <p className="review-note">
                            <strong>We need:</strong> {asset.reviewNote}
                          </p>
                        )}
                        {asset.status === 'accepted' && (
                          <p className="muted">Received and accepted. Nothing else needed.</p>
                        )}
                      </div>
                      <div className="asset-actions">
                        {asset.hasFile && (
                          <a
                            className="button small quiet"
                            href={`/api/portal/assets/${asset.id}/file`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                        )}
                        <button
                          className="button small"
                          disabled={uploading}
                          onClick={() => {
                            setPendingCategory(category)
                            setTimeout(() => fileInput.current?.click(), 0)
                          }}
                        >
                          {asset.status === 'changes_requested' ? 'Replace' : 'Upload'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {!items.length && (
                    <div className="dropzone">
                      <span>{CATEGORY_META[category].hint}</span>
                      <button
                        className="button small"
                        disabled={uploading}
                        onClick={() => {
                          setPendingCategory(category)
                          setTimeout(() => fileInput.current?.click(), 0)
                        }}
                      >
                        Upload to this folder
                      </button>
                    </div>
                  )}
                </div>
              )
            },
          )}
          {uploading && <p className="muted">Uploading…</p>}
        </div>
      )}

      {tab === 'payments' && (
        <div className="stack">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Amount</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {project.payments.map((item) => {
                const state = paymentState(item)
                return (
                  <tr key={item.id}>
                    <td>{item.label}</td>
                    <td>{money(item.amountCents, item.currency)}</td>
                    <td>{formatDate(item.dueDate)}</td>
                    <td>
                      <Pill
                        tone={
                          state === 'paid' ? 'green' : state === 'overdue' ? 'red' : 'amber'
                        }
                      >
                        {state === 'paid'
                          ? `Paid ${formatDate(item.paidAt)}`
                          : state === 'overdue'
                            ? 'Overdue'
                            : 'Due'}
                      </Pill>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!project.payments.length && (
            <Empty>No invoices yet. Deposits and milestones appear here.</Empty>
          )}
          <p className="muted">
            Payments are confirmed by the studio. Once received, the invoice is marked
            paid and you get a receipt notification here and by email.
          </p>
        </div>
      )}

      {tab === 'reviews' && (
        <div className="stack">
          {project.reviews.map((item) => (
            <article key={item.id} className="review">
              <header>
                <strong>{item.milestone}</strong>
                <Stars value={item.rating} />
              </header>
              <p>{item.body}</p>
              <span className="muted">
                {item.authorName} · {formatDate(item.createdAt)}
              </span>
            </article>
          ))}
          {!project.reviews.length && (
            <Empty>
              No reviews yet. At each milestone, tell us how the work landed.
            </Empty>
          )}
          <form
            className="form"
            onSubmit={async (event) => {
              event.preventDefault()
              if (review.body.trim().length < 10) {
                setUploadError('Share a little more detail — at least 10 characters.')
                return
              }
              setUploadError('')
              setReviewBusy(true)
              try {
                const response = await fetch(`/api/portal/projects/${project.id}/reviews`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(review),
                })
                if (response.ok) {
                  setReview({ rating: 5, milestone: '', body: '' })
                  toast('Review submitted', { body: 'The studio has been notified.' })
                  await onRefresh()
                } else {
                  const body = (await response.json().catch(() => ({}))) as { error?: string }
                  setUploadError(body.error || 'Could not save the review.')
                }
              } finally {
                setReviewBusy(false)
              }
            }}
          >
            <h3 className="group-title">Leave a review</h3>
            <div className="rating-picker" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={review.rating === value}
                  className={review.rating >= value ? 'on' : ''}
                  onClick={() => setReview({ ...review, rating: value })}
                >
                  ★
                </button>
              ))}
            </div>
            <label>
              Milestone
              <select
                value={review.milestone}
                onChange={(event) => setReview({ ...review, milestone: event.target.value })}
              >
                <option value="">General feedback</option>
                {project.phases
                  .filter((phase) => phase.status === 'completed')
                  .map((phase) => (
                    <option key={phase.id} value={phase.name}>
                      {phase.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Your review
              <textarea
                rows={4}
                required
                value={review.body}
                onChange={(event) => setReview({ ...review, body: event.target.value })}
                placeholder="What worked, what you would change…"
              />
            </label>
            {uploadError && <p className="error">{uploadError}</p>}
            <button className="button primary" disabled={reviewBusy}>
              {reviewBusy && <span className="spinner" />}
              {reviewBusy ? 'Submitting…' : 'Submit review'}
            </button>
          </form>
        </div>
      )}

      {tab === 'messages' && (
        <div className="stack">
          <div className="thread">
            <h3 className="group-title">Project thread</h3>
            <p className="muted">
              Every message here is also emailed to your project manager.
            </p>
            {project.thread?.messages.map((item) => (
              <div key={item.id} className={`bubble ${item.authorRole}`}>
                <span className="muted">
                  {item.authorName} · {formatDate(item.createdAt)}
                </span>
                <p>{item.body}</p>
              </div>
            ))}
            {!project.thread?.messages.length && <Empty>No messages yet.</Empty>}
            <form
              className="inline-form"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!message.trim()) return
                const response = await fetch(
                  `/api/portal/projects/${project.id}/messages`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body: message }),
                  },
                )
                if (response.ok) {
                  setMessage('')
                  toast('Message sent', {
                    body: 'Your project manager has been notified.',
                  })
                  await onRefresh()
                }
              }}
            >
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ask a question or share an update"
              />
              <button className="button small">Send</button>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

function Portal({
  clientId,
  preview,
  onExit,
}: {
  clientId?: string
  preview?: boolean
  onExit?: () => void
}) {
  const [data, setData] = useState<PortalData | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<'home' | 'projects' | 'assets' | 'payments' | 'documents' | 'reviews'>(
    'home',
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [openDocument, setOpenDocument] = useState<SignableDocument | null>(null)
  const [signature, setSignature] = useState('')
  const [signerName, setSignerName] = useState('')
  const [signError, setSignError] = useState('')

  const reload = useCallback(async () => {
    const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''
    const next = await api<PortalData>(`/api/portal${query}`)
    setData(next)
  }, [clientId])

  useEffect(() => {
    void reload().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Could not load your desk.'),
    )
  }, [reload])

  useEffect(() => {
    if (openDocument) {
      setSignature('')
      setSignerName(data?.client.contactName ?? '')
      setSignError('')
    }
  }, [openDocument, data?.client.contactName])

  if (!data) return <div className="loading">{error || 'Opening your project desk…'}</div>

  const projects = data.projects
  const payments = projects.flatMap((project) => project.payments)
  const outstanding = payments
    .filter((item) => paymentState(item) !== 'paid')
    .reduce((sum, item) => sum + item.amountCents, 0)
  const awaiting = data.documents.filter((document) => document.status === 'awaiting_signature')
  const unreadClient = unread(data.notifications)
  const selectedProject = projects.find((project) => project.id === selected) ?? null
  const upcoming = payments
    .filter((item) => paymentState(item) !== 'paid')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]

  const nav = [
    ['home', 'Overview'],
    ['projects', `Projects (${projects.length})`],
    ['assets', `Assets (${projects.reduce((n, p) => n + p.assets.length, 0)})`],
    ['payments', 'Payments'],
    ['documents', `Documents${awaiting.length ? ` · ${awaiting.length}` : ''}`],
    ['reviews', 'Reviews'],
  ] as const

  return (
    <div className="shell portal">
      <aside className="sidebar">
        <div className="brand">
          Project<span>Desk</span>
          <small>{data.client.company}</small>
        </div>
        <nav>
          {nav.map(([key, label]) => (
            <button
              key={key}
              className={view === key && !selected ? 'active' : ''}
              onClick={() => {
                setView(key)
                setSelected(null)
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="muted">{data.client.contactName}</span>
          <ThemeToggle />
          {preview ? (
            <button className="quiet" onClick={onExit}>
              Exit preview
            </button>
          ) : (
            <form method="post" action="/auth/freebuff/signout">
              <button className="quiet">Sign out</button>
            </form>
          )}
        </div>
      </aside>

      <main className="main">
        {preview && (
          <div className="preview-banner">
            You are previewing {data.client.company}’s portal — actions are disabled.
            <button className="button small" onClick={onExit}>
              Back to admin
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}

        {!selected && view === 'home' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Welcome back</span>
                <h1>{data.client.company}</h1>
                <p className="muted">
                  {projects.length} projects · {unreadClient} unread update
                  {unreadClient === 1 ? '' : 's'}
                </p>
              </div>
            </header>

            {awaiting.length > 0 && (
              <div className="card onboarding">
                <div>
                  <span className="eyebrow">Onboarding</span>
                  <h2>
                    {awaiting.length === 1
                      ? 'One document is waiting for your signature'
                      : `${awaiting.length} documents are waiting for your signature`}
                  </h2>
                  <p className="muted">
                    Sign digitally to unlock your project schedule. It takes a minute.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    setView('documents')
                    setSelected(null)
                  }}
                >
                  Review documents
                </button>
              </div>
            )}

            <div className="kpis">
              <div className="kpi">
                <span>Active projects</span>
                <strong>{projects.filter((p) => p.status === 'active').length}</strong>
              </div>
              <div className="kpi">
                <span>Assets sent</span>
                <strong>{projects.reduce((n, p) => n + p.assets.length, 0)}</strong>
              </div>
              <div className="kpi">
                <span>Outstanding</span>
                <strong>{money(outstanding)}</strong>
              </div>
              <div className="kpi">
                <span>Next payment</span>
                <strong>{upcoming ? money(upcoming.amountCents, upcoming.currency) : '—'}</strong>
                <small>{upcoming ? `due ${formatDate(upcoming.dueDate)}` : 'all settled'}</small>
              </div>
            </div>

            <div className="two-col">
              <div className="card">
                <h2>Your projects</h2>
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className="pipeline-row"
                    onClick={() => {
                      setView('projects')
                      setSelected(project.id)
                    }}
                  >
                    <div className="pipeline-main">
                      <strong>{project.name}</strong>
                      <span className="muted">{projectStatusLabel(project)}</span>
                      <Bar value={projectProgress(project)} />
                    </div>
                    <div className="pipeline-side">
                      <strong>{projectProgress(project)}%</strong>
                      <span className="muted">due {formatDate(project.dueDate)}</span>
                    </div>
                  </button>
                ))}
                {!projects.length && <Empty>Your projects will appear here.</Empty>}
              </div>
              <div className="card">
                <h2>Updates</h2>
                {data.notifications
                  .filter((item) => item.channel === 'in_app')
                  .slice(0, 7)
                  .map((item) => (
                    <div key={item.id} className="activity">
                      <span className={`dot ${item.readAt ? '' : 'unread'}`} />
                      <div>
                        <strong>{item.title}</strong>
                        <p className="muted">{item.body}</p>
                        <span className="muted">{formatDate(item.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                {!data.notifications.length && <Empty>No updates yet.</Empty>}
              </div>
            </div>
          </section>
        )}

        {!selected && view === 'projects' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Projects</span>
                <h1>How far everything has come.</h1>
              </div>
            </header>
            <div className="project-grid">
              {projects.map((project) => (
                <button
                  key={project.id}
                  className="card project-card"
                  onClick={() => setSelected(project.id)}
                >
                  <header>
                    <span className="eyebrow">{project.type.replace('_', ' ')}</span>
                    <Pill tone={project.status === 'completed' ? 'green' : 'amber'}>
                      {project.status === 'completed' ? 'Completed' : 'Active'}
                    </Pill>
                  </header>
                  <h2>{project.name}</h2>
                  <p className="muted">{projectStatusLabel(project)}</p>
                  <Bar value={projectProgress(project)} />
                  <footer>
                    <span className="muted">{projectProgress(project)}% complete</span>
                    <span className="muted">due {formatDate(project.dueDate)}</span>
                  </footer>
                </button>
              ))}
            </div>
          </section>
        )}

        {selected && selectedProject && (
          <PortalProject
            project={selectedProject}
            onBack={() => setSelected(null)}
            onRefresh={reload}
          />
        )}

        {!selected && view === 'assets' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Assets</span>
                <h1>Everything you have sent.</h1>
                <p className="muted">
                  Organised by project and folder, with the review status for each file.
                </p>
              </div>
            </header>
            {projects.map((project) => (
              <div key={project.id} className="card">
                <header className="card-head">
                  <h2>{project.name}</h2>
                  <button
                    className="button small"
                    onClick={() => {
                      setView('projects')
                      setSelected(project.id)
                    }}
                  >
                    Open drive
                  </button>
                </header>
                {project.assets.map((asset) => (
                  <div key={asset.id} className="asset-row">
                    <div className={`asset-icon kind-${asset.kind}`}>▦</div>
                    <div className="asset-main">
                      <div className="asset-title">
                        <strong>{asset.name}</strong>
                        <Pill tone={assetTone(asset.status)}>
                          {ASSET_STATUS_LABEL[asset.status]}
                        </Pill>
                      </div>
                      <p className="muted">
                        {CATEGORY_META[asset.category].label} ·{' '}
                        {formatDate(asset.createdAt)}
                      </p>
                      {asset.status === 'changes_requested' && asset.reviewNote && (
                        <p className="review-note">{asset.reviewNote}</p>
                      )}
                    </div>
                  </div>
                ))}
                {!project.assets.length && <Empty>No files on this project yet.</Empty>}
              </div>
            ))}
          </section>
        )}

        {!selected && view === 'payments' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Payments</span>
                <h1>Deposits, milestones and balances.</h1>
              </div>
            </header>
            <div className="kpis">
              <div className="kpi">
                <span>Paid to date</span>
                <strong>
                  {money(
                    payments
                      .filter((item) => paymentState(item) === 'paid')
                      .reduce((sum, item) => sum + item.amountCents, 0),
                  )}
                </strong>
              </div>
              <div className="kpi">
                <span>Outstanding</span>
                <strong>{money(outstanding)}</strong>
              </div>
            </div>
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((item) => {
                    const project = projects.find((p) => p.id === item.projectId)
                    const state = paymentState(item)
                    return (
                      <tr key={item.id}>
                        <td>{project?.name}</td>
                        <td>{item.label}</td>
                        <td>{money(item.amountCents, item.currency)}</td>
                        <td>{formatDate(item.dueDate)}</td>
                        <td>
                          <Pill
                            tone={
                              state === 'paid' ? 'green' : state === 'overdue' ? 'red' : 'amber'
                            }
                          >
                            {state === 'paid' ? 'Paid' : state === 'overdue' ? 'Overdue' : 'Due'}
                          </Pill>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!payments.length && <Empty>No invoices yet.</Empty>}
            </div>
          </section>
        )}

        {!selected && view === 'documents' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Documents</span>
                <h1>Contracts, retainers and onboarding.</h1>
                <p className="muted">
                  Read each document and sign with your finger or mouse. Signed copies
                  stay here for good.
                </p>
              </div>
            </header>
            <div className="card">
              {data.documents.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  onOpen={() => setOpenDocument(document)}
                />
              ))}
              {!data.documents.length && <Empty>No documents yet.</Empty>}
            </div>
          </section>
        )}

        {!selected && view === 'reviews' && (
          <section className="page">
            <header className="page-head">
              <div>
                <span className="eyebrow">Reviews</span>
                <h1>Your feedback, milestone by milestone.</h1>
                <p className="muted">
                  Every review is shared with the studio instantly — by email and
                  WhatsApp.
                </p>
              </div>
            </header>
            {projects.map((project) => (
              <div key={project.id} className="card">
                <header className="card-head">
                  <h2>{project.name}</h2>
                  <button
                    className="button small"
                    onClick={() => {
                      setView('projects')
                      setSelected(project.id)
                    }}
                  >
                    Review this project
                  </button>
                </header>
                {project.reviews.map((item) => (
                  <article key={item.id} className="review">
                    <header>
                      <strong>{item.milestone}</strong>
                      <Stars value={item.rating} />
                    </header>
                    <p>{item.body}</p>
                    <span className="muted">
                      {item.authorName} · {formatDate(item.createdAt)}
                    </span>
                  </article>
                ))}
                {!project.reviews.length && <Empty>No reviews on this project yet.</Empty>}
              </div>
            ))}
          </section>
        )}
      </main>

      {openDocument && (
        <Modal
          title={openDocument.title}
          onClose={() => setOpenDocument(null)}
        >
          <div className="document-body">
            {openDocument.body.split('\n').map((line, index) =>
              line.trim() ? <p key={index}>{line}</p> : <br key={index} />,
            )}
          </div>
          {openDocument.status === 'signed' ? (
            <div className="signed-block">
              <Pill tone="green">Signed</Pill>
              <p>
                Signed by <strong>{openDocument.signatureName}</strong> on{' '}
                {formatDate(openDocument.signedAt)}.
              </p>
              {openDocument.signatureImage && (
                <img
                  className="signature-image"
                  src={openDocument.signatureImage}
                  alt={`Signature of ${openDocument.signatureName}`}
                />
              )}
            </div>
          ) : preview ? (
            <p className="notice">Signing is disabled while previewing a client.</p>
          ) : (
            <form
              className="form sign-form"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!signature) {
                  setSignError('Draw your signature in the box first.')
                  return
                }
                setSignError('')
                try {
                  await api(`/api/portal/documents/${openDocument.id}/sign`, json('POST', {
                    name: signerName,
                    signature,
                  }))
                  setOpenDocument(null)
                  toast(`“${openDocument.title}” signed`, {
                    body: 'A signed copy is saved in Documents.',
                  })
                  await reload()
                } catch (reason) {
                  setSignError(reason instanceof Error ? reason.message : 'Could not sign.')
                }
              }}
            >
              <h3 className="group-title">Sign digitally</h3>
              <label>
                Full legal name
                <input
                  required
                  value={signerName}
                  onChange={(event) => setSignerName(event.target.value)}
                />
              </label>
              <SignaturePad onChange={setSignature} />
              {signError && <p className="error">{signError}</p>}
              <div className="sign-actions">
                <span className="muted">
                  By signing you agree to the terms above on behalf of{' '}
                  {data.client.company}.
                </span>
                <button className="button primary">Sign & accept</button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------ root

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const next = await api<Session>('/api/session')
    setSession(next)
  }, [])

  useEffect(() => {
    void load().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Could not start the app.'),
    )
  }, [load])

  const markRead = useCallback(async () => {
    if (!session) return
    const path =
      session.role === 'admin'
        ? '/api/admin/notifications/read'
        : '/api/portal/notifications/read'
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined)
  }, [session])

  useEffect(() => {
    if (session?.role) void markRead()
  }, [session?.role, session?.clientId, markRead])

  const body = useMemo(() => {
    if (error) return <div className="loading">{error}</div>
    if (!session) return <div className="loading">Starting Project Desk…</div>
    if (!session.user) return <Login session={session} />
    if (session.pendingInvite) return <PendingInvite session={session} />
    if (session.role === 'admin') return <Admin session={session} />
    return <Portal />
  }, [session, error])

  return (
    <>
      {body}
      <ToastViewport />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
