import type {
  NotificationAudience,
  NotificationChannel,
  NotificationStatus,
} from '../shared/types'
import type { Env } from './auth'

export type NotifyInput = {
  audience: NotificationAudience
  clientId?: string | null
  projectId?: string | null
  title: string
  body: string
  /** In-app delivery is always recorded; these are the extra channels. */
  channels?: Array<'email' | 'whatsapp'>
  /** Overrides the client contact email for client-audience messages. */
  email?: string | null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function sendEmail(
  env: Env,
  to: string,
  title: string,
  body: string,
): Promise<NotificationStatus> {
  if (!env.RESEND_API_KEY || !env.AGENCY_EMAIL || !to) return 'queued'
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.AGENCY_EMAIL,
        to: [to],
        subject: title,
        html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6;color:#14181c">
          <h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h2>
          <p style="margin:0 0 16px">${escapeHtml(body).replace(/\n/g, '<br />')}</p>
          <p style="margin:0;color:#6b7280;font-size:13px">Project Desk — client portal</p>
        </div>`,
      }),
    })
    return response.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

async function sendWhatsapp(
  env: Env,
  to: string,
  text: string,
): Promise<NotificationStatus> {
  const sid = env.TWILIO_ACCOUNT_SID
  const token = env.TWILIO_AUTH_TOKEN
  const from = env.TWILIO_WHATSAPP_FROM
  if (!sid || !token || !from || !to) return 'queued'
  try {
    const body = new URLSearchParams({
      From: `whatsapp:${from}`,
      To: `whatsapp:${to}`,
      Body: text,
    })
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    )
    return response.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

/**
 * Records every notification in the audit log and attempts the configured
 * external channels. Unconfigured channels are kept as `queued` so the agency
 * can see exactly what would have gone out.
 */
export async function notify(
  db: D1Database,
  env: Env,
  inputs: NotifyInput[],
): Promise<void> {
  for (const input of inputs) {
    const recipient =
      input.audience === 'client'
        ? (input.email ?? '')
        : (env.AGENCY_EMAIL ?? '')

    const entries: Array<{
      channel: NotificationChannel
      status: NotificationStatus
      recipient: string
    }> = [{ channel: 'in_app', status: 'sent', recipient }]

    for (const channel of input.channels ?? []) {
      const to =
        channel === 'email'
          ? input.audience === 'client'
            ? (input.email ?? '')
            : (env.AGENCY_EMAIL ?? '')
          : (env.AGENCY_WHATSAPP ?? '')
      const status =
        channel === 'email'
          ? await sendEmail(env, to, input.title, input.body)
          : await sendWhatsapp(
              env,
              to,
              `${input.title}\n\n${input.body}`,
            )
      entries.push({ channel, status, recipient: to })
    }

    const statements = entries.map((entry) =>
      db
        .prepare(
          `INSERT INTO notifications (id, audience, client_id, project_id, channel, title, body, status, recipient, created_at, read_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(
          crypto.randomUUID(),
          input.audience,
          input.clientId ?? null,
          input.projectId ?? null,
          entry.channel,
          input.title,
          input.body,
          entry.status,
          entry.recipient,
          Date.now(),
        ),
    )
    await db.batch(statements)
  }
}
