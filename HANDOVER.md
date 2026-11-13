# Project Desk — handover note

Written 13 November 2026. This document is the entry point for any developer or
AI model picking up the project. Read it before changing code, then read
`README.md` for run commands and environment details.

---

## 1. What this is

**Project Desk** is a project-management dashboard for a web design agency. It
is a single application with two faces:

- **Agency console** (internal): clients, projects, phase pipelines, asset
  review, invoices, documents, reviews, notification log.
- **Client portal** (external): onboarding, project progress, an upload drive,
  payments, documents to sign, milestone reviews, a project message thread.

The two sides share one database, so an action taken by the studio (e.g. marking
a phase complete) is immediately visible to the client and generates a
notification.

**Live preview environment (published):**
https://site-9765b4f20d614f98a2908bf5dfbfc6d3.freebuff.page
Production has not been deployed. The site ID is
`8b7f3f5c-2a1e-4c9d-9f60-6d2c1a4e7b31` (stored here deliberately; do not move it
into `.freebuff/project-id`).

The original brief also asked for this to eventually run on the agency's
WordPress platform (plugin or multisite). **That port has not been started.**
This app is the reference implementation of the data model, rules and screens
for it. See §12.

---

## 2. Objectives

1. Let a new client be onboarded in one action: portal access, first project,
   full phase pipeline, onboarding agreement to sign.
2. Show clients exactly how far their project has progressed, phase by phase,
   without asking.
3. Give clients an organised place to send assets, and give the studio a review
   workflow with an explicit outcome per file (accepted / changes needed).
4. Track money: deposits, milestone invoices, due dates, overdue, paid.
5. Capture signed contracts/retainers digitally and keep the evidence.
6. Capture client feedback per milestone and per project.
7. Notify the right side at every event — in-app, email, WhatsApp — and keep an
   auditable log of what was sent.
8. Feel like a modern 2026 product on both sides, including dark mode.

Non-goals so far: accounting/tax, time tracking, resource planning, paying
invoices online, multi-agency tenancy, WordPress.

---

## 3. Roles and access model

There is one admin role and one client role.

- **Agency admin**: the first account ever to sign in becomes the admin, and the
  demo dataset is seeded for it. There is no UI to promote anyone; more admins
  currently require a database row.
- **Client**: a signed-in account is linked to a client record by matching the
  client's contact email (case-insensitive) to the account email. Everyone else
  sees a "ask your project manager for an invite" screen.
- An admin can open any client's portal **read-only** (`/api/portal?clientId=…`).
  The API rejects client-only writes from an admin preview session.
- All records are scoped by `client_id`; admin routes are gated by role, client
  routes by the member's own `client_id`.

Identity is handled by **Sign in with Freebuff** (`@freebuff/auth`). There are no
passwords in this app. The `members` table maps a Freebuff `sub` to a role and
optional `client_id`.

---

## 4. Stack

| Layer | Choice |
| --- | --- |
| UI | React 19 + TypeScript, single-page app, no router (state-driven views) |
| Build | Vite 8 with `@cloudflare/vite-plugin` (runs in workerd locally) |
| Server | Hono 4 inside a Cloudflare Worker |
| Data | D1 (SQLite) |
| Files | R2 bucket binding `FILES` |
| Auth | Sign in with Freebuff |
| Hosting | Freebuff Sites (preview published) |
| Tests | `bun test` with Miniflare providing a real local D1 |

No CSS framework. One hand-written stylesheet driven by CSS custom properties.

---

## 5. File map

```
src/shared/types.ts     Domain types, labels, money/date/progress helpers (shared)
src/worker/index.ts     Worker entry: wraps Hono with the auth SDK
src/worker/auth.ts      Env type, Sign in with Freebuff, local preview identity
src/worker/db.ts        Schema (idempotent), row mappers, loaders, demo seed
src/worker/notify.ts    Notification pipeline: in-app + Resend email + Twilio WhatsApp
src/worker/app.ts       All HTTP routes, validation, authorization, business rules
src/client/main.tsx     Whole UI: app root, admin console, client portal, theme, toasts
src/client/style.css    Design tokens (light + dark), layout, components, motion
tests/app.test.ts       API tests: roles, isolation, uploads, reviews, phases, signing
deploy.json             Sites deploy manifest (Worker module + static assets)
wrangler.jsonc          Local bindings: DB (D1), FILES (R2), LOCAL_PREVIEW flag
```

Entry flow: `index.html` → `src/client/main.tsx` → `GET /api/session` decides
between the sign-in gate, the "unlinked account" screen, the admin console and
the client portal.

---

## 6. Data model

All ids are UUIDs except the seeded demo rows, which use readable ids such as
`cl-northwind`, `pr-northwind-site`, `ph-pr-northwind-site-3`.

- `members` — `sub` (PK), name, email, role (`admin`|`client`), client_id.
- `clients` — company, contact_name, email, phone, website, industry,
  status (`onboarding`|`active`|`paused`|`archived`), notes, created_at.
- `projects` — client_id, name, type (`website`|`web_app`|`seo`|`branding`|
  `retainer`), summary, status (`active`|`completed`|`on_hold`), start_date,
  due_date.
- `phases` — project_id, name, position, status (`queued`|`ongoing`|`completed`),
  note, started_at, completed_at.
- `assets` — project_id, client_id, category (brief, brand, copy, images, video,
  references, data), name, kind, size, mime, storage_key (R2 key or null for
  seeded records), status (`pending`|`accepted`|`changes_requested`),
  review_note, uploaded_by.
- `payments` — project_id, client_id, label, amount_cents, currency, due_date,
  status (`due`|`paid`|`overdue`), paid_at, method.
- `documents` — client_id, project_id (nullable), title, kind (contract,
  retainer, nda, sow, onboarding), body (plain text), status
  (`awaiting_signature`|`signed`), signature_name, signature_image (PNG data
  URL), signed_at.
- `reviews` — project_id, client_id, milestone, rating 1–5, body, author_name.
- `threads` — one per project; `messages` — thread_id, author_role, author_name,
  body.
- `notifications` — audience (`admin`|`client`), client_id, project_id, channel
  (`in_app`|`email`|`whatsapp`), title, body, status (`sent`|`queued`|`failed`),
  recipient, read_at.

Schema creation is idempotent (`ensureSchema`) and runs on first data request per
isolate. There is **no migrations system yet** — append new `CREATE TABLE IF NOT
EXISTS` / `CREATE INDEX` statements to the `schema` array in `db.ts`, and for
destructive changes add an explicit migration step.

---

## 7. Business rules that matter

**Phase pipeline.** Each project type has a fixed pipeline (see `PIPELINES` in
`db.ts` and `pipelineFor` in `app.ts` — note these are duplicated; keep them in
sync or consolidate). Only one phase can be `ongoing`: marking a later phase
ongoing auto-completes every earlier incomplete one. Setting a phase back to
`queued` clears its timestamps. When every phase is complete the project status
becomes `completed`. Every change notifies the client and, if all phases are now
done, says the project is closed out.

**Asset review.** Uploads always start as `pending`. Accepting or requesting
changes is an admin action; a change request requires a non-empty note (the API
returns 400 otherwise). The client sees the outcome and the note, and receives a
notification. Every upload also notifies the agency on all channels.

**Payments.** Derived "overdue" is computed in the UI from `due_date < today`
when status is `due`; the database status stays `due` unless the studio sets it
to `paid` or `overdue`. Marking paid records `paid_at` and notifies the client.

**Documents.** Only the client can sign, only for their own client record, only
while `awaiting_signature`. Requires a full name and a PNG data URL under 400kB
from the signature pad. Signing notifies the agency by email and WhatsApp.

**Reviews.** Client-only, rating 1–5, body ≥ 10 characters, milestone optional
(free text, prefilled from completed phases in the UI). Notifies the agency.

**Notifications.** `notify()` always writes an `in_app` row and then attempts the
requested external channels. Missing provider config is not an error: the row is
saved as `queued` with the intended recipient so the outbox shows what would have
gone out. `sent`/`failed` reflect the provider response.

**Onboarding.** Creating a client also creates: the first project with a full
queued pipeline, a project thread, and an onboarding agreement awaiting
signature; then sends a welcome notification with the agreement link text. It
refuses duplicate contact emails.

---

## 8. API surface

All under `/api`, JSON unless noted. Mutations require a same-origin request.

- `GET /health`, `GET /session` (role bootstrap + demo seed).
- Admin: `GET /admin/data` (clients, all projects with phases/assets/payments/
  reviews/thread, all documents, admin notifications, channel readiness),
  `POST /admin/clients`, `PATCH /admin/clients/:id`,
  `POST /admin/projects`, `POST /admin/projects/:id/phases`,
  `PATCH /admin/phases/:id`, `PATCH /admin/assets/:id`,
  `POST /admin/projects/:id/payments`, `PATCH /admin/payments/:id`,
  `POST /admin/documents`, `POST /admin/projects/:id/messages`,
  `POST /admin/notifications/read`.
- Client: `GET /portal` (+ `?clientId=` for admin preview), `POST
  /portal/projects/:id/assets` (multipart, 25MB limit), `GET
  /portal/assets/:id/file`, `POST /portal/documents/:id/sign`,
  `POST /portal/projects/:id/reviews`, `POST /portal/projects/:id/messages`,
  `POST /portal/notifications/read`.
- Unknown `/api/*` returns JSON 404; everything else falls through to static
  assets.

Validation is manual and deliberately small: length caps via `text()`, `oneOf()`
for enums, `money()` to cents, `date()` for `YYYY-MM-DD`. Keep that style.

---

## 9. UI notes

- One stylesheet, token-driven: every colour is a CSS variable in `:root`, with
  `[data-theme='dark']` overriding them. **When adding UI, use tokens — never
  hard-code a colour,** or it will look wrong in one theme.
- Theme: `html[data-theme]` set at module load from `localStorage['pd-theme']`
  or the OS preference. `ThemeToggle` writes both. The toggle appears in the
  authenticated sidebar and on the sign-in card.
- Toasts: module-level store in `main.tsx` (`toast(title, { body, tone })`) plus
  `<ToastViewport />` mounted once in `App`. Toasts auto-dismiss at 2.6s, animate
  out, dock bottom on small screens. Use them for outcomes; keep inline errors
  for form validation.
- `BusyBar` is the thin top progress bar; pass the relevant busy flag.
- Motion is CSS-only and respects `prefers-reduced-motion`.
- Views are state-driven (`view` + `selected`), no URLs. Deep links would need a
  router — not present.
- Admin preview of a client portal reuses the same components with `preview`
  hiding write actions.

---

## 10. Running, testing, deploying

```sh
bun install
bun run dev        # vite on 0.0.0.0:3000 in this workspace (default 5173)
bun test           # 11 API tests against a real local D1
bun run typecheck  # client + worker tsconfigs
bun run build      # dist/project_desk/index.js + dist/client
```

Local preview identity: with no `FREEBUFF_CLIENT_ID`/`APP_ORIGIN`:

- loopback hosts → one `local-preview` identity is used, which becomes admin;
- `pv-*.style.dev` **only when `LOCAL_PREVIEW=true`** (set in `wrangler.jsonc`
  for local dev) → same behaviour, so the Cloud preview works;
- anything else → signed out.

This fallback can never activate once real auth variables exist, because
`isLocalPreview()` returns false when either is set. Do not weaken that guard;
do not set `APP_ORIGIN` locally (it disables the preview identity and the local
app becomes unusable without real sign-in).

Deploying (Sites): `deploy.json` points at `dist/project_desk/index.js` and
`dist/client`. The environment needs `DB` (D1) and `FILES` (R2) bindings and
Freebuff auth enabled; then `sites_deploy` and check `sites_inspect` for
`published: true`. `deploy.json` does not carry `vars`, so `LOCAL_PREVIEW` never
reaches a deployment.

---

## 11. Demo data

`seedDemo()` in `db.ts` runs once, when the first admin is created, and only if
the `clients` table is empty. It creates three clients (Northwind Coffee Co.,
Lumen Health Clinic, Vertex Legal), four projects across website/SEO/web-app,
phases at different states, twelve sample asset records (one with changes
requested, one video, one archive), eight invoices, five documents (two awaiting
signature for Lumen), three reviews, message threads and notifications across all
three channels (WhatsApp/email rows are seeded as `queued`).

Seeded asset rows have no R2 object, so their "Open" link is intentionally
absent; only real uploads have files. **Remove or gate the seed before giving
this to real clients** — it currently runs in any fresh environment on first
sign-in.

---

## 12. Known gaps / suggested next steps

1. **WordPress port** — explicitly requested by the owner and not started. The
   realistic routes are a custom plugin (custom tables mirroring §6, admin
   screens, a client role with a portal template, REST endpoints mirroring §8) or
   a headless setup. The phase/asset/notification rules in §7 are the contract
   to preserve.
2. **Email + WhatsApp not configured** on the deployment: `RESEND_API_KEY`,
   `AGENCY_EMAIL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_WHATSAPP_FROM`, `AGENCY_WHATSAPP`. Until set, those rows are `queued`.
   No retry queue exists.
3. **No production deployment.** Preview only. First account to sign in there
   becomes admin — configure auth and seed carefully.
4. **Only one admin, no invitations UI.** Additional admins are a DB edit.
   Consider an `ADMIN_EMAILS` allowlist or an invite table.
5. **Demo seed** runs on first sign-in in any environment (see §11).
6. **Notifications mark themselves read on app load**, so unread counts are
   mostly cosmetic; a proper notifications panel/route does not exist yet.
7. **No pagination anywhere.** Fine for tens of records; add limits before this
   grows. Several loaders use `IN (...)` with the full id list.
8. **No real-time.** The client sees changes on refresh/reload. Sites realtime
   could be added for live phase/asset updates.
9. **No payment processing** — invoices are tracked, not charged.
10. **Signature evidence** is a name plus a drawn PNG stored in D1; no PDF
    generation, hashing or timestamped certificate.
11. **Currency is USD** everywhere (`currency` column exists but no UI).
12. **No file versioning** — a "Replace" upload adds a new asset row rather than
    superseding the old one; the UI does not link them.
13. **Client asset categories are fixed**; per-project folder configuration was
    not built.
14. **Overdue is derived in the UI**, so the stored status can drift from what is
    shown.
15. **Accessibility**: focus rings, labels and roles are in place, but there has
    been no audit; dialogs do not trap focus.
16. **Test coverage** is API-only. There are no UI tests; the UI was verified
    manually in a browser.

---

## 13. Conventions / gotchas

- TypeScript strict; no `any` in the shipped code. Both tsconfigs must pass.
- All queries bind parameters. Ownership is enforced by `client_id`/`member`
  checks, not by trusting request ids.
- Mutations must pass `isSameOriginRequest`; keep that middleware intact.
- Assets are namespaced in R2 as `<clientId>/<projectId>/<uuid>-<filename>`.
- Do not log, commit or echo provider keys. Secrets belong in the host's secret
  store.
- The UI intentionally has no external dependencies beyond React — keep it that
  way unless there is a strong reason.
- `screenshots/` holds the reference screenshots for the current design; they are
  not deployed.

If you are an AI model: start with `src/shared/types.ts`, then read §7, then
`src/worker/app.ts`. Do not restructure the app, change the auth guard, or
introduce a second data store without being asked.
