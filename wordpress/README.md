# Project Desk for WordPress

The WordPress version of Project Desk: a plugin that holds the data and business rules, with a
REST API that the phone-first client app (stage 2) talks to. It is built first for Banks
Solution (bankssolution.ng) and keeps every business-specific detail in settings so other
businesses can install it later.

The original Cloudflare app in `src/` stays as the reference for screens and rules.

## What stage 1 contains

| Area | What works |
| --- | --- |
| Onboarding | One call creates the client, their WordPress account and invite email, the first project with its phases, and the service agreement to sign. |
| Sign-in | Invite link to set a password, email and password, one-time email sign-in link, Google sign-in for invited emails. No self sign-up. |
| Roles | Owner (everything), Project manager (projects, uploads, messages, phases; no money, settings or staff), Client (own portal only). WordPress administrators get owner rights. |
| Phases | Three opening phases on every project, then the service's work phases from settings. Work cannot start until the agreement is signed and the deposit paid. Sign-off phases need the client's approval in the portal. Monthly services never auto-close. |
| Agreements | Text from a settings template with `{business}`, `{company}`, `{service}` and `{date}`. Signing records name, drawn signature, time, IP address, browser and a SHA-256 fingerprint of the text; signed documents cannot be edited. |
| Uploads | Resumable uploads in 8 MB pieces (default limit 2 GB per file), text notes, file versions, review with accept or changes requested. |
| Payments | Invoices in naira (stored in kobo), overdue detection, mark paid; a paid deposit plus a signed agreement starts the work. |
| Follow-ups | Project messages, milestone reviews, in-app notifications for every event, branded emails through `wp_mail` (FluentSMTP delivers them). WhatsApp is recorded as queued until a provider is connected through the `pd_send_whatsapp` filter. |

## Security choices

- Files live in a private folder (`uploads/project-desk-private`, deny rules written on
  install; set `PD_STORAGE_DIR` to a folder outside the web root on hosts that ignore
  `.htaccess`). They are only served through the API after an access check.
- The file type is detected from the bytes on the server. HTML, SVG and anything else a
  browser could run is always a download, with `nosniff` and a sandbox policy. Program files
  (`.php` and similar) are refused.
- The API uses the WordPress cookie plus the `X-WP-Nonce` header. Sign-in endpoints return
  the nonce; the app page will print it inline at start-up.
- Sign-in attempts are rate limited; email sign-in links are hashed, single use and expire in
  15 minutes; the magic-link endpoint never reveals whether an email exists.
- No demo data, and nobody becomes an admin by signing in first.

## API

All routes are under `/wp-json/project-desk/v1`.

- Public: `GET /session`, `POST /auth/login`, `/auth/magic-link`, `/auth/magic`,
  `/auth/google`, `/auth/accept-invite`, `/auth/logout`.
- Staff: `GET /console`, `POST /clients`, `PATCH /clients/:id`, `POST /clients/:id/invite`,
  `POST /projects`, `PATCH /projects/:id`, `POST /projects/:id/phases`, `PATCH /phases/:id`
  (owners may pass `override`), `PATCH /assets/:id`, `POST /documents`,
  `PATCH /documents/:id`.
- Money (owners): `POST /projects/:id/payments`, `PATCH /payments/:id`.
- Owners: `GET|PUT /settings`, `GET|POST /staff`.
- Client and staff: `GET /portal` (`?clientId=` for staff preview),
  `POST /projects/:id/uploads`, `PUT /uploads/:id?offset=`, `GET /uploads/:id`,
  `POST /uploads/:id/finish`, `POST /projects/:id/notes`, `GET /files/:id`,
  `POST /projects/:id/messages`, `POST /notifications/read`.
- Client: `POST /documents/:id/sign`, `POST /phases/:id/approve`,
  `POST /projects/:id/reviews`.

## Running the tests

The tests run against a real WordPress and MySQL install. Use a throwaway site: they delete
the plugin's data and its test users.

```sh
ln -s "$PWD/wordpress/project-desk" /path/to/wordpress/wp-content/plugins/project-desk
php wordpress/tests/run.php /path/to/wordpress
```

## Next stages

2. The phone-first app (installable PWA) served at clients.bankssolution.ng.
3. Brief-to-client conversion from Banks Core, InvoiceNaija invoices and Paystack, WhatsApp.
4. PDF copies of signed agreements and automatic reminders.
5. Pilot on staging, then launch.
6. Settings screen and packaging for other businesses.
