# AL-AQSA Website

Marketing website for AL-AQSA: Mendix consulting, web applications, digital-product delivery and website development. The enquiry form sends directly to **info@al-aqsa.eu** through the PHP-enabled MijnDomein Webhosting Plus server.

## Publish on MijnDomein / Plesk

1. Download the repository as a ZIP from GitHub (**Code → Download ZIP**) and extract it.
2. Open MijnDomein → **al-aqsa.eu → Webhosting → Beheren** to open Plesk. Back up the current website files before replacing them.
3. In Plesk **Files / Bestanden**, open the domain's document root (usually `httpdocs`). Upload `index.html`, `styles.css`, `script.js`, `contact.php`, `privacy.html`, `robots.txt`, `sitemap.xml` and the `assets` folder **into that folder**, not inside another repository folder. Keep unrelated files and existing server settings.
4. Enable PHP for the domain using a supported PHP 8.x version. Confirm HTTPS is enabled and the home page uses this `index.html`; an old `index.php` may otherwise take priority. Back up or rename the old entry page only when replacing it with this site.
5. Check that `info@al-aqsa.eu` exists and can receive mail. Open `https://al-aqsa.eu/contact.php`: it should return JSON with `ok: true`. Never serve this PHP file on a static-only host.
6. Submit one test enquiry from the live website. Confirm it arrives in the inbox (also check spam), contains the name, email, selected service and message, and that **Reply** addresses the visitor. A success message means the hosting mail system accepted the email, not that inbox delivery has been confirmed.

There is no build step, third-party form activation or mailbox password to put in GitHub. If a CDN or page cache is enabled, exclude `contact.php` from caching and purge the updated HTML, CSS and JavaScript. Keep the same-origin form URL.

**Hosting requirement:** the full form requires PHP with sessions, a writable system temporary directory and a working `mail()` transport. GitHub Pages and static Cloudflare Pages can serve the design but cannot run this handler. Pointing the website there would require a different backend.

## How enquiries work

- The browser requests a same-origin, session-bound security token, then posts the form to `contact.php` over HTTPS.
- The server validates fields, rejects an anti-spam trap and unexpected origins, limits request sizes, and caps send attempts at 5 per network address and 30 overall per rolling hour. These limits survive new browser sessions. Forwarded IP headers are not trusted; a reverse proxy may group visitors under one network address.
- Emails are plain text with UTF-8 support. Sender, recipient and envelope sender are fixed to `info@al-aqsa.eu`. The validated visitor address is used only for **Reply-To**.
- Controls are disabled during sending. A server error keeps the visitor's text and offers the direct email route. Repeating the same request after a network error does not resend an already accepted enquiry while the session record remains available (up to one hour, subject to the server's session lifetime).
- No submission contents are saved in a website database. Short-lived session data stores request hashes for duplicate protection. A private folder in PHP's system temporary directory stores a random salt and hashed-address rate counters. Expired counters are purged on the next form attempt.

## If emails do not arrive

Check the inbox and spam folder first. If the form shows an error, check Plesk's PHP logs, PHP sessions, temporary-directory permissions and whether PHP `mail()` is enabled. If the form succeeds but the inbox remains empty, ask MijnDomein to check outgoing mail delivery, the domain's sender authentication and the destination mailbox.

MijnDomein documents PHP mail as the default form transport and recommends authenticated SMTP for more reliable delivery. If the host requires SMTP, the handler must be adapted to a maintained mail library such as PHPMailer with `mail.mijndomein.nl`, port `587`, STARTTLS and a mailbox login stored privately on the server. Do not paste mailbox credentials into public code, HTML or JavaScript.

Official hosting guidance:

- [Mail versturen via je website](https://mijndomein.zendesk.com/hc/nl/articles/7455412035985-Mail-versturen-via-je-website)
- [PHPMailer i.c.m. SMTP](https://mijndomein.zendesk.com/hc/nl/articles/360000860709-PHPMailer-i-c-m-SMTP)

## Files

- `index.html` — marketing website and contact form
- `styles.css` — responsive layout and form feedback
- `script.js` — navigation, animation and direct submission
- `contact.php` — email delivery, validation and abuse prevention
- `privacy.html` — privacy notice reflecting direct form submission
- `assets/al-aqsa-logo.png` — original AL-AQSA logo

## Local verification

With PHP 8.x, Python 3 and Node installed:

```sh
php -l contact.php
node --check script.js
python3 tests/contact_form_test.py
node --test tests/contact_ui_test.cjs
```

The backend test starts a local PHP server with a fake mail transport; it never sends real email. Inbox delivery must still be verified after deployment on MijnDomein.
