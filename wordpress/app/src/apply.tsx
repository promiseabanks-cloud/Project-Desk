import { useState, type FormEvent } from 'react'
import { api, boot } from './api'
import { BrandMark, Button, Field, Icon } from './ui'

/**
 * Public enquiry form. A prospective client fills this in with no sign-in; it lands as a lead
 * for the team. Reached at #/apply. The hidden "website" field is a honeypot — bots fill it,
 * people leave it blank, and the server drops those silently.
 */
export function ApplyForm() {
  const services = boot.brand.services ?? {}
  const keys = Object.keys(services)
  const [f, setF] = useState({ company: '', contactName: '', email: '', phone: '', service: '', budget: '', message: '', website: '' })
  const [state, setState] = useState<'form' | 'sent'>('form')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/leads', { body: f })
      setState('sent')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-art">
        <BrandMark />
        <h1>Let's build something.</h1>
        <p>Tell the {boot.brand.businessName} team about your project and we will come back to you with next steps.</p>
      </div>
      <div className="auth-card">
        {state === 'sent' ? (
          <div className="screen" style={{ display: 'grid', gap: 14 }}>
            <span className="icon-tile ok" style={{ width: 54, height: 54 }}>
              <Icon name="check" />
            </span>
            <h2>Thanks — we have your enquiry.</h2>
            <p className="muted">The {boot.brand.businessName} team will be in touch at {f.email} shortly. Keep an eye on your inbox.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="screen">
            <h2 style={{ marginBottom: 6 }}>Start an enquiry</h2>
            <p className="muted" style={{ marginBottom: 22 }}>
              A few details are all we need to get started. Fields marked with * are required.
            </p>
            {error && <div className="form-error">{error}</div>}
            <Field label="Company or brand">
              <input value={f.company} onChange={set('company')} autoComplete="organization" />
            </Field>
            <div className="grid-2">
              <Field label="Your name *">
                <input value={f.contactName} onChange={set('contactName')} autoComplete="name" required />
              </Field>
              <Field label="Email *">
                <input type="email" inputMode="email" value={f.email} onChange={set('email')} autoComplete="email" required />
              </Field>
              <Field label="Phone (WhatsApp)">
                <input type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" />
              </Field>
              <Field label="Budget (optional)">
                <input value={f.budget} onChange={set('budget')} placeholder="e.g. ₦1.5M" />
              </Field>
            </div>
            {keys.length > 0 && (
              <Field label="What do you need?">
                <select value={f.service} onChange={set('service')}>
                  <option value="">Not sure yet</option>
                  {keys.map((k) => (
                    <option key={k} value={k}>
                      {services[k].label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Tell us about your project">
              <textarea value={f.message} onChange={set('message')} rows={4} placeholder="What are you trying to achieve, and by when?" />
            </Field>
            {/* Honeypot: hidden from people, catches bots. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} />
              </label>
            </div>
            <Button type="submit" variant="block" busy={busy} disabled={!f.contactName || !f.email}>
              Send enquiry
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
