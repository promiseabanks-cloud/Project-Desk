# Project Desk

A project management dashboard for a web design agency — the client portal and
the internal console in one app.

Clients get onboarding, a project drive with reviewed assets, a phase tracker
that mirrors the studio's real progress, invoices, digitally signed contracts,
milestone reviews and an email thread. The studio gets one console to run all of
it and a full notification log.

## What is in it

**Client onboarding**
- Adding a client creates their portal, the first project, a full phase
  pipeline and an onboarding agreement in one step.
- The contact email links the client's sign-in automatically. Anyone else sees
  a "ask your project manager for an invite" screen.
- Contracts, retainers, NDAs and statements of work are signed on a drawing
  pad in the portal; signed copies stay on the record.

**Projects and phases**
- Every project type has a pipeline: website, web app, SEO, branding, retainer.
  The admin can add phases to any project.
- Phases move between *in queue*, *in progress* and *completed*. Starting a
  later phase closes the earlier ones, so there is always one current phase.
- Each change notifies the client and appears in their portal instantly. When
  the last phase completes the project closes itself.

**Asset drive with review**
- Client uploads are filed into folders: brief, brand, copy, images, video,
  references, data.
- Every file lands in the studio's review queue as *awaiting review*. The studio
  accepts it or requests changes with a required reason.
- The client sees *accepted* or *changes requested* plus the reviewer's note,
  and receives a notification either way.

**Money, feedback and messaging**
- Payment tracker: deposit, milestone and balance invoices with due dates,
  overdue detection, mark-paid and a "payment received" notification.
- Reviews: the client rates a completed milestone 1–5 and writes a review; the
  studio sees it per project.
- A project thread where messages are also emailed to the other side.

**Notifications**
- Every in-app event is recorded. Email goes through Resend and WhatsApp through
  Twilio when configured; otherwise the outbox shows the message as `queued`
  with its intended recipient so nothing is silently lost.
- The studio is alerted when a client uploads assets, signs a document, leaves a
  review or sends a message — in-app, by email, and on WhatsApp for signatures
  and reviews. The client is alerted for phase changes, asset decisions,
  invoices and payment receipts.

## Stack

React + Vite on the front end, Hono inside a Cloudflare Worker, D1 for data and
R2 for the asset drive. Sign-in uses **Sign in with Freebuff**. The whole app
runs in workerd locally through the Cloudflare Vite plugin.

## Run it

```sh
bun install
bun run dev        # http://localhost:5173
bun test           # API tests against a real local D1 database
bun run typecheck
bun run build
```

On a loopback origin with no auth configuration, the app uses one local preview
identity. That first identity becomes the **agency admin** and the desk seeds
itself with three demo clients, four projects, uploaded assets, invoices,
documents, reviews and threads so every screen has something to show. Open
*Clients → Open client portal* to see the client side (as Amara, Northwind
Coffee, with changes requested on a photo and a signed contract).

## Environment

Set these as project secrets on the host — never commit them.

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Sends transactional email |
| `AGENCY_EMAIL` | Verified sender and the address that receives agency alerts |
| `TWILIO_ACCOUNT_SID` | WhatsApp delivery |
| `TWILIO_AUTH_TOKEN` | WhatsApp delivery |
| `TWILIO_WHATSAPP_FROM` | Sender number in E.164 form |
| `AGENCY_WHATSAPP` | Studio number that receives WhatsApp alerts |

`FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER` and `APP_ORIGIN` are injected by the
hosting platform when sign-in is enabled. `DB` and `FILES` are the D1 and R2
bindings.

## Publishing

1. Create/inspect the site and deploy to **preview** first.
2. `sites_enable_auth` for the site, then provision D1 as `DB` and R2 as
   `FILES` with `sites_add_storage`.
3. Build and deploy with `sites_deploy` using `deploy.json`. The build output is
   a Worker plus static assets.
4. After the environment is published, check the real origin: sign-in, callback,
   the first-admin bootstrap, a second client account, file upload/download and
   the notification log.

## Notes and boundaries

- Admin can open any client's portal for a read-only preview; the API refuses
  client-only writes from an admin session.
- Email/WhatsApp failures are recorded as `failed` rather than retried
  automatically.
- This is a standalone web app. Porting it to WordPress (plugin or multisite)
  is a separate build — the API and data model here are the reference for it.
