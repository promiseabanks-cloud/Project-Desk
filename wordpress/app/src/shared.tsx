import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import {
  ago,
  api,
  boot,
  bytes,
  CATEGORY_LABEL,
  date,
  fileUrl,
  money,
  uploadFile,
  type Asset,
  type Doc,
  type Message,
  type Payment,
  type Phase,
  type Project,
} from './api'
import { Button, Empty, Field, haptic, Icon, MiniRing, Pill, Sheet, SignaturePad, toast } from './ui'

/** Loads data and refreshes it when the app comes back into view and every 45 seconds. */
export function useLoad<T>(path: string, query?: Record<string, string | number>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const key = path + JSON.stringify(query ?? {})
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(path, { query }))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    reload()
    const onVisible = () => document.visibilityState === 'visible' && reload()
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => document.visibilityState === 'visible' && reload(), 45000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [reload])
  return { data, error, reload }
}

export const assetIcon = (a: Asset) =>
  a.kind === 'note' ? 'note' : a.kind === 'image' ? 'image' : a.kind === 'video' ? 'video' : 'file'

export function assetTone(a: Asset): [string, string] {
  if (a.status === 'accepted') return ['ok', a.fromStaff ? 'From the team' : 'Accepted']
  if (a.status === 'changes_requested') return ['bad', 'Changes needed']
  return ['warn', 'In review']
}

export function AssetRow({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const [tone, label] = assetTone(asset)
  const showThumb = asset.kind === 'image' && asset.hasFile && !asset.name.toLowerCase().endsWith('.svg') && !/heic|heif|tiff?/i.test(asset.name)
  return (
    <button className="row" onClick={onOpen}>
      {showThumb ? (
        <img className="thumb" src={fileUrl(asset.id)} alt="" loading="lazy" />
      ) : (
        <span className={`icon-tile ${tone === 'bad' ? 'bad' : ''}`}>
          <Icon name={assetIcon(asset)} />
        </span>
      )}
      <span className="grow">
        <span className="title" style={{ display: 'block' }}>
          {asset.name}
        </span>
        <span className="sub" style={{ display: 'block' }}>
          {CATEGORY_LABEL[asset.category] ?? asset.category} · {asset.kind === 'note' ? 'Note' : bytes(asset.size)} · {ago(asset.createdAt)}
        </span>
      </span>
      <Pill tone={tone}>{label}</Pill>
    </button>
  )
}

/** Shows a file or note. Staff can accept or ask for changes. */
export function AssetSheet({
  asset,
  onClose,
  staff,
  onChanged,
  onReplace,
}: {
  asset: Asset
  onClose: () => void
  staff?: boolean
  onChanged?: () => void
  onReplace?: () => void
}) {
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const url = fileUrl(asset.id)
  const inline = /^(image\/(jpeg|png|gif|webp|avif)|video\/(mp4|webm|quicktime)|application\/pdf)$/.test(asset.mime)
  const review = async (status: 'accepted' | 'changes_requested') => {
    await api(`/assets/${asset.id}`, { method: 'PATCH', body: { status, note } })
    toast(status === 'accepted' ? 'File accepted' : 'Changes requested', status === 'accepted' ? 'The client has been told.' : 'The client will see your note.')
    onChanged?.()
    onClose()
  }
  const [tone, label] = assetTone(asset)
  return (
    <Sheet title={asset.name} onClose={onClose}>
      <div className="gap wrap" style={{ marginBottom: 16 }}>
        <Pill tone={tone}>{label}</Pill>
        <span className="muted" style={{ fontSize: '.88rem' }}>
          {asset.uploadedBy} · {date(asset.createdAt, true)}
        </span>
      </div>
      {asset.kind === 'note' && <div className="note-text">{asset.body}</div>}
      {asset.hasFile && inline && asset.kind === 'image' && <img className="media-full" src={url} alt={asset.name} />}
      {asset.hasFile && inline && asset.kind === 'video' && <video className="media-full" src={url} controls playsInline preload="metadata" />}
      {asset.hasFile && (
        <div className="gap wrap" style={{ marginTop: 16 }}>
          <a className="btn ghost" href={url} target="_blank" rel="noopener">
            <Icon name={inline ? 'eye' : 'download'} /> {inline ? 'Open full size' : 'Download'} · {bytes(asset.size)}
          </a>
          {onReplace && asset.status === 'changes_requested' && (
            <Button variant="accent" icon="upload" onClick={onReplace}>
              Upload a new version
            </Button>
          )}
        </div>
      )}
      {asset.reviewNote && (
        <div className="card" style={{ marginTop: 18, borderColor: asset.status === 'changes_requested' ? 'var(--bad)' : undefined }}>
          <div className="eyebrow">Note from the team</div>
          <p style={{ marginTop: 6 }}>{asset.reviewNote}</p>
        </div>
      )}
      {staff && !asset.fromStaff && (
        <div style={{ marginTop: 24 }}>
          <hr className="rule" style={{ marginBottom: 20 }} />
          {asking ? (
            <>
              <Field label="What needs to change?">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: please send the logo as a PNG with a transparent background." />
              </Field>
              <div className="gap">
                <Button variant="danger" disabled={!note.trim()} onClick={() => review('changes_requested')}>
                  Send request
                </Button>
                <Button variant="ghost" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="gap wrap">
              <Button variant="accent" icon="check" onClick={() => review('accepted')}>
                Accept
              </Button>
              <Button variant="ghost" onClick={() => setAsking(true)}>
                Ask for changes
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

type QueueItem = { id: string; file: File; progress: number; state: 'waiting' | 'sending' | 'done' | 'failed'; error?: string }

/** Upload files and text notes to a project. */
export function UploadSheet({
  projects,
  initialProject,
  replaces,
  onClose,
  onDone,
}: {
  projects: Project[]
  initialProject?: number
  replaces?: Asset
  onClose: () => void
  onDone: () => void
}) {
  const [projectId, setProjectId] = useState(initialProject ?? projects[0]?.id ?? 0)
  const [category, setCategory] = useState(replaces?.category ?? 'brief')
  const [mode, setMode] = useState<'files' | 'note'>('files')
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [over, setOver] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const running = useRef(false)

  const add = (files: FileList | null) => {
    if (!files?.length) return
    haptic(8)
    const limit = boot.brand.maxUploadMb * 1024 * 1024
    const items: QueueItem[] = Array.from(files).map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      progress: 0,
      state: file.size > limit ? 'failed' : 'waiting',
      error: file.size > limit ? `Over the ${boot.brand.maxUploadMb} MB limit` : undefined,
    }))
    setQueue((q) => [...q, ...(replaces ? items.slice(0, 1) : items)])
  }

  useEffect(() => {
    if (running.current) return
    const next = queue.find((q) => q.state === 'waiting')
    if (!next || !projectId) return
    running.current = true
    const update = (patch: Partial<QueueItem>) => setQueue((q) => q.map((x) => (x.id === next.id ? { ...x, ...patch } : x)))
    update({ state: 'sending' })
    uploadFile(projectId, next.file, category, (p) => update({ progress: p }), replaces?.id)
      .then(() => {
        update({ state: 'done', progress: 1 })
        haptic([6, 30, 6])
      })
      .catch((e: Error) => update({ state: 'failed', error: e.message }))
      .finally(() => {
        running.current = false
        setQueue((q) => [...q])
      })
  }, [queue, projectId, category, replaces])

  const allDone = queue.length > 0 && queue.every((q) => q.state === 'done' || q.state === 'failed')
  useEffect(() => {
    if (!allDone) return
    const ok = queue.filter((q) => q.state === 'done').length
    if (ok) {
      toast(ok === 1 ? 'File sent' : `${ok} files sent`, 'The team will review and let you know.')
      onDone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone])

  const sendNote = async () => {
    await api(`/projects/${projectId}/notes`, { body: { title: noteTitle, body: noteBody, category: 'notes' } })
    toast('Note sent', 'The team will read it shortly.')
    onDone()
    onClose()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    add(e.dataTransfer.files)
  }

  return (
    <Sheet title={replaces ? `New version of ${replaces.name}` : 'Send to the team'} onClose={onClose}>
      {!replaces && projects.length > 1 && (
        <Field label="Project">
          <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!replaces && (
        <div style={{ marginBottom: 20 }}>
          <div className="segmented">
            <button className={mode === 'files' ? 'on' : ''} onClick={() => setMode('files')}>
              Files, photos, videos
            </button>
            <button className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>
              Write a note
            </button>
          </div>
        </div>
      )}
      {mode === 'note' ? (
        <div className="screen">
          <Field label="Title">
            <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="About our business" />
          </Field>
          <Field label="Your text" hint="Copy for pages, answers to our questions, anything you want us to know.">
            <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} style={{ minHeight: 180 }} />
          </Field>
          <Button variant="accent block" icon="send" disabled={!noteTitle.trim() || noteBody.trim().length < 2} onClick={sendNote}>
            Send note
          </Button>
        </div>
      ) : (
        <div className="screen">
          {!replaces && (
            <div style={{ marginBottom: 18 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>
                Folder
              </div>
              <div className="chips">
                {boot.brand.categories
                  .filter((c) => c !== 'notes')
                  .map((c) => (
                    <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)}>
                      {CATEGORY_LABEL[c] ?? c}
                    </button>
                  ))}
              </div>
            </div>
          )}
          <div
            className={`drop ${over ? 'over' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          >
            <Icon name="upload" />
            <strong>Tap to choose, or drop files here</strong>
            <span className="muted" style={{ fontSize: '.86rem' }}>
              Photos, videos, documents, design files or a zip, up to {boot.brand.maxUploadMb >= 1024 ? `${(boot.brand.maxUploadMb / 1024).toFixed(0)} GB` : `${boot.brand.maxUploadMb} MB`} each. Big files keep going if your connection drops.
            </span>
            <input ref={input} type="file" multiple={!replaces} hidden onChange={(e) => add(e.target.files)} />
          </div>
          <div style={{ marginTop: 10 }}>
            {queue.map((q) => (
              <div key={q.id} className="queue-item">
                {q.state === 'done' ? (
                  <span className="icon-tile ok" style={{ width: 34, height: 34, borderRadius: '50%' }}>
                    <Icon name="check" />
                  </span>
                ) : q.state === 'failed' ? (
                  <span className="icon-tile bad" style={{ width: 34, height: 34, borderRadius: '50%' }}>
                    <Icon name="x" />
                  </span>
                ) : (
                  <MiniRing value={q.progress} />
                )}
                <div className="grow" style={{ minWidth: 0, flex: 1 }}>
                  <div className="title" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {q.file.name}
                  </div>
                  <div className="muted" style={{ fontSize: '.84rem' }}>
                    {q.state === 'failed' ? q.error : q.state === 'done' ? 'Sent' : q.state === 'sending' ? `${Math.round(q.progress * 100)}% of ${bytes(q.file.size)}` : 'Waiting'}
                  </div>
                </div>
                {q.state === 'failed' && !q.error?.startsWith('Over') && (
                  <Button variant="ghost small" onClick={() => setQueue((all) => all.map((x) => (x.id === q.id ? { ...x, state: 'waiting', error: undefined } : x)))}>
                    Retry
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  )
}

/** Phase timeline. Clients approve sign-off phases; staff move phases forward. */
export function Timeline({
  project,
  mode,
  onApprove,
  onSet,
}: {
  project: Project
  mode: 'client' | 'staff' | 'preview'
  onApprove?: (phase: Phase) => void
  onSet?: (phase: Phase, status: Phase['status']) => void
}) {
  return (
    <div className="timeline stagger">
      {project.phases.map((ph) => (
        <div key={ph.id} className={`step ${ph.status}`}>
          <span className="node">{ph.status === 'completed' && <Icon name="check" />}</span>
          <div className="step-body">
            <div className="between" style={{ alignItems: 'flex-start' }}>
              <span className="name">{ph.name}</span>
              {ph.status === 'ongoing' && <Pill tone="live">Now</Pill>}
            </div>
            <div className="muted" style={{ fontSize: '.84rem' }}>
              {ph.status === 'completed' && ph.completedAt ? `Done ${date(ph.completedAt)}` : ph.status === 'ongoing' && ph.startedAt ? `Started ${date(ph.startedAt)}` : ph.stage === 'opening' ? 'Getting started' : 'Up next'}
              {ph.signoff && (ph.approvedAt ? ' · Approved by you' : ' · Needs your approval')}
            </div>
            {ph.note && <p style={{ marginTop: 6, fontSize: '.92rem' }}>{ph.note}</p>}
            {mode === 'client' && ph.signoff && ph.status === 'ongoing' && !ph.approvedAt && onApprove && (
              <div className="step-actions">
                <Button variant="accent small" icon="check" onClick={() => onApprove(ph)}>
                  Review and approve
                </Button>
              </div>
            )}
            {mode === 'staff' && onSet && (
              <div className="step-actions">
                {ph.status !== 'ongoing' && ph.status !== 'completed' && (
                  <Button variant="ghost small" onClick={() => onSet(ph, 'ongoing')}>
                    Start
                  </Button>
                )}
                {ph.status === 'ongoing' && (
                  <Button variant="accent small" icon="check" onClick={() => onSet(ph, 'completed')}>
                    Mark complete
                  </Button>
                )}
                {ph.status !== 'queued' && (
                  <Button variant="quiet small" onClick={() => onSet(ph, 'queued')}>
                    Reset
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Thread({ project, me, onSent, canWrite = true }: { project: Project; me: 'client' | 'staff'; onSent: () => void; canWrite?: boolean }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [project.messages.length])
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await api(`/projects/${project.id}/messages`, { body: { body: text } })
      setText('')
      haptic(6)
      onSent()
    } catch (e) {
      toast('Message not sent', (e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <div className="thread">
        {project.messages.length === 0 && <Empty icon="chat">No messages yet. Say hello to the team.</Empty>}
        {project.messages.map((m: Message) => (
          <div key={m.id} className={`bubble ${m.authorRole === me ? 'mine' : ''}`}>
            {m.body}
            <small>
              {m.authorRole === me ? 'You' : m.authorName} · {ago(m.createdAt)}
            </small>
          </div>
        ))}
        <div ref={end} />
      </div>
      {canWrite && (
        <div className="composer">
          <textarea
            rows={1}
            value={text}
            placeholder="Write a message"
            onChange={(e) => {
              setText(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${e.target.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
            }}
          />
          <button className="send" onClick={send} disabled={busy || !text.trim()} aria-label="Send">
            {busy ? <span className="spinner" /> : <Icon name="send" />}
          </button>
        </div>
      )}
    </div>
  )
}

export function DocumentSheet({ doc, onClose, canSign, onSigned }: { doc: Doc; onClose: () => void; canSign: boolean; onSigned?: () => void }) {
  const [name, setName] = useState('')
  const [sig, setSig] = useState('')
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const sign = async () => {
    setError('')
    try {
      await api(`/documents/${doc.id}/sign`, { body: { name, signature: sig, agree } })
      haptic([10, 40, 10, 40, 30])
      toast('Signed', 'A copy is saved in Documents.')
      onSigned?.()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Sheet title={doc.title} onClose={onClose}>
      <div className="gap" style={{ marginBottom: 14 }}>
        {doc.status === 'signed' ? <Pill tone="ok">Signed {date(doc.signedAt)}</Pill> : <Pill tone="warn">Waiting for signature</Pill>}
      </div>
      <div className="doc-body">{doc.body}</div>
      {doc.status === 'signed' ? (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="eyebrow">Signed by</div>
          {doc.signatureImage && <img className="sig-img" src={doc.signatureImage} alt={`Signature of ${doc.signatureName}`} />}
          <p>
            <strong>{doc.signatureName}</strong> · {date(doc.signedAt, true)}
          </p>
          <p className="mono muted" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>
            Fingerprint {doc.bodyHash.slice(0, 16)}…{doc.signerIp ? ` · IP ${doc.signerIp}` : ''}
          </p>
        </div>
      ) : canSign ? (
        <div style={{ marginTop: 22 }}>
          {error && <div className="form-error">{error}</div>}
          <Field label="Your full legal name">
            <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Signature
          </div>
          <SignaturePad onChange={setSig} />
          <label className="check" style={{ margin: '18px 0' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I have read this document and agree to it. I understand my typed name and drawn signature are my electronic signature.</span>
          </label>
          <Button variant="accent block" icon="sign" disabled={!agree || !sig || name.trim().length < 2} onClick={sign}>
            Sign document
          </Button>
        </div>
      ) : null}
    </Sheet>
  )
}

export function PaymentRow({ p, action }: { p: Payment; action?: React.ReactNode }) {
  const awaiting = p.status !== 'paid' && p.status !== 'cancelled' && !!p.proofAt
  const tone = p.status === 'paid' ? 'ok' : awaiting ? '' : p.status === 'overdue' ? 'bad' : p.status === 'cancelled' ? '' : 'warn'
  const label = p.status === 'overdue' ? 'Overdue' : p.status[0].toUpperCase() + p.status.slice(1)
  return (
    <div className="row">
      <span className={`icon-tile ${tone}`}>
        <Icon name={p.status === 'paid' ? 'check' : awaiting ? 'clock' : p.status === 'overdue' ? 'alert' : 'wallet'} />
      </span>
      <span className="grow">
        <span className="title" style={{ display: 'block' }}>
          {p.label}
        </span>
        <span className="sub" style={{ display: 'block' }}>
          {p.status === 'paid'
            ? `Paid ${date(p.paidAt)}${p.method ? ` · ${p.method}` : ''}`
            : awaiting
              ? `Proof sent ${date(p.proofAt)} · awaiting confirmation`
              : p.dueDate
                ? `Due ${date(p.dueDate)}`
                : 'Due'}
        </span>
      </span>
      <span style={{ textAlign: 'right', display: 'grid', gap: 4, justifyItems: 'end' }}>
        <span className="amount">{money(p.amount, p.currency)}</span>
        {action ?? <Pill tone={tone}>{awaiting ? 'Checking' : label}</Pill>}
      </span>
    </div>
  )
}

/** A client's invoice with the ways to pay it and to send proof of payment. */
export function ClientPaymentCard({ p, project, canAct, onProof }: { p: Payment; project?: string; canAct: boolean; onProof: () => void }) {
  const open = p.status === 'due' || p.status === 'overdue'
  return (
    <div className={`pay-card${open ? ' open' : ''}`}>
      <PaymentRow p={p} />
      {project && <span className="pay-project">{project}</span>}
      {open && canAct && (
        <div className="pay-actions">
          {p.externalUrl && (
            <a className="btn accent small" href={p.externalUrl} target="_blank" rel="noopener">
              <Icon name="wallet" />
              View and pay
            </a>
          )}
          <Button variant={p.externalUrl ? 'ghost small' : 'accent small'} icon="upload" onClick={onProof}>
            {p.proofAt ? 'Send another proof' : "I've paid, send proof"}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The client attaches a transfer receipt (or types the reference) for the team to confirm. */
export function ProofSheet({ payment, projectId, onClose, onDone }: { payment: Payment; projectId: number; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const send = async () => {
    setBusy(true)
    try {
      const assetId = file ? await uploadFile(projectId, file, 'payments', setProgress) : 0
      await api(`/payments/${payment.id}/proof`, { body: { assetId, note } })
      haptic([6, 30, 6])
      toast('Proof sent', 'We will confirm your payment and email your receipt.')
      onDone()
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="Send proof of payment" onClose={onClose}>
      <div className="proof-sum">
        <span className="muted">{payment.label}</span>
        <strong className="amount">{money(payment.amount, payment.currency)}</strong>
      </div>
      <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button className={`drop proof-drop${file ? ' has' : ''}`} onClick={() => input.current?.click()}>
        <Icon name={file ? 'check' : 'upload'} />
        <span>
          <strong>{file ? file.name : 'Attach your transfer receipt'}</strong>
          <span className="muted">{file ? `${bytes(file.size)} · tap to change` : 'A screenshot or PDF from your bank app'}</span>
        </span>
        {busy && file && <i className="proof-bar" style={{ width: `${Math.round(progress * 100)}%` }} />}
      </button>
      <Field label="Transfer reference or note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. GTB transfer, ref 0034…" />
      </Field>
      <Button variant="accent block" busy={busy} disabled={!file && note.trim().length < 3} onClick={send}>
        Send to the team
      </Button>
    </Sheet>
  )
}

export function ReviewSheet({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: () => void }) {
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const done = project.phases.filter((p) => p.status === 'completed' && p.stage === 'work')
  const [milestone, setMilestone] = useState(done[done.length - 1]?.name ?? '')
  const submit = async () => {
    await api(`/projects/${project.id}/reviews`, { body: { rating, body, milestone } })
    toast('Thank you!', 'Your review means a lot to the team.')
    onDone()
    onClose()
  }
  return (
    <Sheet title="How are we doing?" onClose={onClose}>
      <div className="stars" style={{ marginBottom: 20 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={n <= rating ? 'on' : ''} onClick={() => (setRating(n), haptic(5))} aria-label={`${n} stars`}>
            ★
          </button>
        ))}
      </div>
      {done.length > 0 && (
        <Field label="Milestone">
          <select value={milestone} onChange={(e) => setMilestone(e.target.value)}>
            {done.map((p) => (
              <option key={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Your review">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What went well, and what could be better?" />
      </Field>
      <Button variant="accent block" disabled={!rating || body.trim().length < 10} onClick={submit}>
        Send review
      </Button>
    </Sheet>
  )
}
