# PROJECT_CONTEXT

> Compact functional and technical map. Read this first, then inspect only relevant source files. Source code and current contracts take precedence; update this file when important behavior changes, replacing stale details rather than appending a diary. Never record credentials or enquiry contents.

Last updated: 2026-10-16
Source baseline: `0b2df54` (`main`), with local consultancy refinements.

## 1. Product and scope

AL-AQSA's public marketing website at https://al-aqsa.eu targets prospective clients for Mendix consulting, web applications/PWAs, website development and training. Ten public HTML pages cover the homepage, services, websites, applications, Mendix, projects, Sahiony Group case study, founder/about, contact and privacy. Visitors select a language and enquire through the contact page, email or WhatsApp. Proposal FAQs appear on the homepage, services and contact pages; commitments are agreed in the proposal rather than published as fixed prices or timelines.

Implemented scope is a brochure site plus email enquiries: no accounts, admin portal, payments, application database, ORM or migrations. Live hosting configuration and inbox delivery are not established by source inspection.

## 2. Architecture, stack and quick navigation

Plain HTML/CSS/browser JavaScript → same-origin PHP handler → authenticated SMTP (or legacy PHP mail). No frontend framework, package installation, bundler or build step. PHP 8.x with sessions, OpenSSL and writable temporary storage is required for the full form. PHPMailer 7.1.1 is vendored; Node and Python are test tools.

| Work area | Start here |
| --- | --- |
| Public pages, SEO metadata, form markup | Root HTML pages; enquiry form in `contact.html` |
| Responsive layout, design tokens, RTL, reduced motion | `styles.css` and shared `assets/redesign.css`; page-specific body classes |
| Menu, reveal animations, form submission/retries | `script.js` |
| Immediate English/Arabic translations and browser language registry | `assets/language.js` |
| Language selection, loading, rendering, dropdown/search | `assets/language-controller.js` |
| Translation dictionaries and server language allowlist | `assets/locales/*.json`, `assets/locales/registry.json` |
| Validation, security, rate limits, email transport | `contact.php`: `field()`, `respond()`, `reserveSend()`, `sendAuthenticatedEnquiry()` |
| Privacy content, indexing | `privacy.html`, `robots.txt`, `sitemap.xml` |
| Deployment implementation and CI | `scripts/deploy-ftps.sh`, `.github/workflows/deploy-mijndomein.yml` |
| Enquiry PR checks | `.github/workflows/check-enquiry-mail.yml` |
| Setup and operational troubleshooting | `README.md` |
| Mail dependency/license | `vendor/phpmailer/` |

Script order matters: `assets/language.js` → `assets/language-controller.js` → `script.js`. Shared browser API: `window.SiteLanguage` exposes `language`, `languages`, `t()`, `set()`, `subscribe()`.

Service CTA query contract: `contact.html?service=websites|applications|mendix` maps only those allowlisted slugs to the existing canonical service values, and only when the select is empty. Ordinary/invalid URLs retain the default. Mobile navigation moves focus to its first link, cycles through links and the toggle, makes background content inert, and restores toggle focus on Escape. Desktop resizing clears the overlay/inert state.

External services: MijnDomein mail/hosting, Google Fonts, and a WhatsApp contact link. No live translation API or third-party form service.

## 3. Functional rules and API

| Contract | Behavior |
| --- | --- |
| `GET contact.php?lang=...` | Starts/reuses session; returns `ok`, `message`, `message_key`, and security `token`. Token lifetime: one hour. |
| `POST contact.php` | Multipart or URL-encoded fields: `name`, `email`, `project`, `message`, empty honeypot `website`, `token`, `request_id`; optional `lang`. No file uploads. |
| Validation | Name 1–160 Unicode characters; email valid and ≤254 bytes; message 1–5,000 characters. Additional byte/control-character checks; request body limit 32,768 bytes. |
| Service values | Exact English values: `Mendix consulting`, `Web application or PWA`, `Website design & development`, `Training or workshop`, `Something else`. Translated labels must not change values. |
| Responses | JSON `ok`, `message`, stable `message_key`; caught failures also return `error_code`. Statuses include 200, 403, 405, 409, 413, 415, 422, 429 and 503; rate limiting includes `Retry-After`. |
| Duplicate handling | `request_id` is 32 lowercase hex characters. Same accepted ID + same payload returns success without resending; same ID + changed payload returns 409. Records expire after one hour, subject to session lifetime. |
| Abuse limits | At most 5 send attempts per network address and 30 globally per rolling hour, across sessions. Uses `REMOTE_ADDR`, not forwarded headers. |

The browser fetches a token before each POST, uses same-origin cookies and no-store requests, disables controls while sending, clears fields only after confirmed success, and retains text on error. Network retries reuse the request ID; editing a field resets it. GET timeout is 10 seconds; POST timeout is 25 seconds.

Email sender, recipient and envelope sender are fixed to `info@al-aqsa.eu`; only Reply-To uses the validated visitor email. Messages are plain-text UTF-8. Success means transport acceptance, not confirmed inbox delivery.

## 4. Security and data model

No user authentication or roles. Public enquiries use a session-bound token, same-authority Origin checks, cross-site Fetch Metadata rejection, honeypot, input validation and rate limits. Session cookie `alaqsa_enquiry` is HttpOnly, SameSite=Strict, and Secure when PHP detects HTTPS. Session locking serializes concurrent submissions.

Transient records:
- Session: token/time and accepted request IDs mapped to payload digests/timestamps; enquiry bodies are not stored in a website database.
- Private system-temp directory `alaqsa-enquiries-<path hash>/limits.json`: random salt and HMAC-address attempt timestamps; file locking protects updates. Expired attempts are filtered on later attempts.
- Browser localStorage `alaqsa-language`: selected language; failures are tolerated.

Server logs contain failure category and exception class, not submitted content, addresses or tokens. Keep these privacy guarantees when changing the handler or tests.

## 5. Languages and coding conventions

40 languages. English/Arabic load immediately; other dictionaries load from same-origin JSON and cache for the page. Saved preference overrides supported browser preference; English is the fallback. Arabic, Hebrew, Persian and Urdu use RTL. Failed loads retain the current language; revision tracking prevents stale loads overriding newer choices.

Keep the browser registry in `assets/language.js` aligned with `assets/locales/registry.json`. English/Arabic dictionaries are duplicated in `assets/language.js` and their JSON files: update both. Preserve all English keys and embedded links. Dropdown descriptions use `Intl.DisplayNames`, falling back to English; search includes localized/native/English names and codes.

Use existing `data-*` interaction hooks and `data-i18n*` translation keys. Authored translation HTML is rendered with `innerHTML`; visitor input/server feedback must remain text. Keep canonical form values and `message_key` stable so pending feedback can change language. Maintain RTL, keyboard interaction, accessible status feedback and reduced-motion behavior.

## 6. Configuration and deployment

Hosting target: MijnDomein/Plesk, PHP-enabled `httpdocs`. Handler reads `../private/alaqsa-enquiry/mail.json` and PHPMailer classes beside it, outside the document root. SMTP uses `mail.mijndomein.nl:587`, LOGIN + STARTTLS, certificate verification and disabled debug output.

| Variable | Purpose |
| --- | --- |
| `FTP_SERVER` | Required Actions secret: plain FTP hostname matching server certificate |
| `FTP_USERNAME`, `FTP_PASSWORD` | Required Actions secrets: deployment account |
| `SMTP_PASSWORD` | Optional deployment secret: mailbox password; generates private SMTP configuration |
| `GITHUB_SHA` | Required deployment environment value supplied by Actions; temporary upload naming |

Missing SMTP secret preserves existing private configuration. Missing private config selects legacy PHP `mail()`; an SMTP failure never falls back to mail. README reports legacy transport rejection on the live host; authenticated SMTP is the intended operational path.

Deployment workflow runs on matching website/deployment changes pushed to `main`, or manual dispatch on `main`; runs serialize. It checks syntax/tests then uses explicit FTPS with verified TLS. Private mail configuration receives mode 600. Website uploads include assets and the root website files in the deployment allowlist, including all ten HTML pages, with `index.html` last; each transfer uses a temporary file then rename. Other remote files are preserved, including obsolete assets. Documentation-only changes do not trigger deployment and are not uploaded.

Static-only hosting cannot run the handler. Keep `contact.php` same-origin and excluded from caching. An existing `index.php` can override the homepage. For manual deployment with SMTP, include the private configuration/library setup from README, not just public website files.

## 7. Development and verification

No dependency-install/build/migration command. For a local PHP preview, run `php -S 127.0.0.1:8000` from the repository root; actual mail needs configured transport. Use isolated fake transports for automated checks (PHP 8.x, Python 3, Node; OpenSSL for SMTP tests, Bash for deployment checks):

```sh
php -l contact.php
node --check script.js
node --check assets/language.js
node --check assets/language-controller.js
python3 tests/contact_form_test.py
python3 tests/contact_smtp_test.py
node --test tests/contact_ui_test.cjs
node --test tests/language_test.cjs
python3 tests/deploy_ftps_test.py
bash -n scripts/deploy-ftps.sh
```

Backend tests start local PHP/fake mail servers; SMTP tests cover authentication and TLS rejection. JS tests use Node's test runner and DOM/VM stubs; they are not full-browser end-to-end tests. Deployment tests simulate uploads. Automated tests do not send real email. After deployment, manually verify mobile/RTL/keyboard UI and actual inbox delivery.

`python tests/site_structure_test.py` verifies ten pages, translation keys and deployment coverage. Optional `node --test tests/website_browser_test.cjs` uses local Playwright/Chrome (skips if Playwright is absent). It checks all pages in English/Arabic/German at desktop and narrow widths, menu focus, service preselection, FAQ expansion, and mocked form failure/success. `CHROME_PATH` selects Chrome; `WEBSITE_SCREENSHOTS` enables local screenshots. Browser tests use a loopback-only static server and never send real enquiries.

## 8. Decisions, limitations and working notes

- Preserve the static frontend + small PHP endpoint architecture: no build step and compatible with the documented hosting. Bundled translations avoid sending visitor content to translation providers.
- Keep SMTP secrets/private library outside `httpdocs`; preserve duplicate protection, session locking and cross-session rate limiting when modifying mail delivery.
- Reverse proxies can group visitors under one rate-limit address. Do not casually trust forwarded-IP headers.
- README marks translation drafts as lacking professional native-speaker review.
- Deployment is atomic per file, not for the whole release; removed assets need separate cleanup.
- Implemented features above were inspected in source; this document does not certify live delivery or test success. No additional roadmap is established here.
- For non-trivial tasks: read this map, inspect relevant files, make a concise plan, implement, verify, then update only materially changed context. Avoid scanning vendor code, all locale dictionaries, or the entire repository unless the task requires it.
