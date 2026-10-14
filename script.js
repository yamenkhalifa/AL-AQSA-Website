const header = document.querySelector('[data-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const menu = document.querySelector('[data-menu]');

const renderMenuLabel = () => {
  const label = menuToggle?.querySelector('.sr-only');
  if (!label) return;
  const open = menuToggle.getAttribute('aria-expanded') === 'true';
  label.textContent = window.SiteLanguage?.t(open ? 'menu.close' : 'menu.open')
    ?? (open ? 'Close navigation' : 'Open navigation');
};
window.SiteLanguage?.subscribe(renderMenuLabel);

const closeMenu = () => {
  if (!menuToggle || !menu) return;
  menuToggle.setAttribute('aria-expanded', 'false');
  menu.classList.remove('is-open');
  document.body.classList.remove('menu-open');
  renderMenuLabel();
};

menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menu?.classList.toggle('is-open', !isOpen);
  document.body.classList.toggle('menu-open', !isOpen);
  renderMenuLabel();
});

menu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

const mobileLayout = window.matchMedia('(max-width: 820px)');
mobileLayout.addEventListener('change', (event) => {
  if (!event.matches) closeMenu();
});

window.addEventListener('scroll', () => {
  header?.classList.toggle('is-stuck', window.scrollY > 16);
}, { passive: true });

// Content stays visible unless an available observer takes responsibility for it.
if (typeof IntersectionObserver === 'function') {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.remove('reveal-pending');
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach((item) => {
    revealObserver.observe(item);
    item.classList.add('reveal-pending');
  });
}

const year = document.querySelector('[data-year]');
if (year) year.textContent = new Date().getFullYear();

// CV-led profile enhancement. This keeps the brochure architecture intact while
// giving prospective clients a clearer view of the person, experience and work
// behind AL-AQSA. Sahiony Group is presented specifically as an AL-AQSA project.
(() => {
  const founderPhoto = 'data:image/webp;base64,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';

  const style = document.createElement('style');
  style.textContent = `
    .about-mark.founder-photo { padding:0; aspect-ratio:2/3; background:#081f40; overflow:hidden; box-shadow:0 25px 60px rgba(8,31,64,.16); }
    .about-mark.founder-photo::before { display:none; }
    .about-mark.founder-photo img { width:100%; height:100%; object-fit:cover; object-position:50% 24%; }
    .founder-role { margin:0 0 18px; color:#081f40; font-weight:800; font-size:17px; }
    .founder-credentials { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 28px; }
    .founder-credentials span { padding:7px 10px; border:1px solid rgba(8,31,64,.14); background:#f6f7fa; color:#0b2a52; font:500 10px/1.35 'DM Mono',monospace; letter-spacing:.03em; text-transform:uppercase; }
    .project-credit { position:absolute; top:28px; right:28px; z-index:2; padding:7px 10px; border:1px solid rgba(255,255,255,.25); background:rgba(8,31,64,.48); color:#f2d273; font:500 10px/1.2 'DM Mono',monospace; letter-spacing:.06em; text-transform:uppercase; backdrop-filter:blur(8px); }
    .project-cta { position:relative; z-index:2; align-self:flex-start; display:inline-flex; align-items:center; gap:8px; margin-top:22px; padding-bottom:3px; border-bottom:1px solid currentColor; font-size:13px; font-weight:800; }
    .project-cta:hover { color:#f2d273; }
    [dir='rtl'] .project-credit { right:auto; left:28px; }
    @media (max-width:820px) { .about-mark.founder-photo { max-width:430px; aspect-ratio:4/5; } }
    @media (max-width:570px) { .project-credit { top:22px; right:22px; } [dir='rtl'] .project-credit { right:auto; left:22px; } }
  `;
  document.head.append(style);

  const aboutMark = document.querySelector('.about-mark');
  if (aboutMark) {
    aboutMark.classList.add('founder-photo');
    aboutMark.removeAttribute('aria-hidden');
    aboutMark.replaceChildren();
    const photo = document.createElement('img');
    photo.src = founderPhoto;
    photo.alt = 'Yamen Khalifa, Owner of AL-AQSA';
    photo.width = 320;
    photo.height = 480;
    photo.loading = 'lazy';
    photo.decoding = 'async';
    aboutMark.append(photo);
  }

  const aboutCopy = document.querySelector('.about-copy');
  const linkedin = aboutCopy?.querySelector('.inline-link');
  if (aboutCopy && linkedin) {
    const role = document.createElement('p');
    role.className = 'founder-role';
    role.textContent = 'Yamen Khalifa · Owner, AL-AQSA · Senior Mendix Developer · Software & Web Developer';

    const credentials = document.createElement('div');
    credentials.className = 'founder-credentials';
    ['Mendix Advanced Certified', 'PSM I', '5+ years', 'PWA & Native', 'REST / OData / SOAP', 'SaaS & RBAC', 'AI integrations', 'Business websites']
      .forEach((label) => {
        const item = document.createElement('span');
        item.textContent = label;
        credentials.append(item);
      });

    linkedin.before(role, credentials);
  }

  const firstProject = document.querySelector('.solution-card');
  if (firstProject) {
    const credit = document.createElement('span');
    credit.className = 'project-credit';
    credit.textContent = 'AL-AQSA project · Sahiony Group';

    const projectLink = document.createElement('a');
    projectLink.className = 'project-cta';
    projectLink.href = 'https://sahiony-group.com/';
    projectLink.target = '_blank';
    projectLink.rel = 'noopener noreferrer';
    projectLink.textContent = 'View Sahiony Group project ↗';

    firstProject.append(credit, projectLink);
  }
})();

const contactForm = document.querySelector('[data-contact-form]');

if (contactForm) {
  const submitButton = contactForm.querySelector('button[type="submit"]');
  const status = contactForm.querySelector('[data-form-status]');
  const buttonContent = submitButton.innerHTML;
  let sending = false;
  let requestId = null;
  let statusMessage = '';
  let statusKey = null;
  const translate = (key, fallback) => window.SiteLanguage?.t(key) ?? fallback;
  const validateControl = (control) => {
    if (!control?.setCustomValidity) return;
    control.setCustomValidity('');
    if (!control.validity.valid) {
      const keys = { name: 'server.name', email: 'server.email', project: 'server.service', message: 'server.message' };
      control.setCustomValidity(translate(keys[control.name] || 'server.required', 'Please check this field.'));
    }
  };
  contactForm.addEventListener('invalid', (event) => validateControl(event.target), true);
  const renderButton = () => {
    if (sending) submitButton.textContent = translate('form.sending', 'Sending…');
    else submitButton.innerHTML = translate('form.submit', buttonContent);
  };
  window.SiteLanguage?.subscribe(() => {
    renderButton();
    [...contactForm.elements].filter((control) => control.validity?.customError).forEach(validateControl);
    if (statusMessage) status.textContent = statusKey ? translate(statusKey, statusMessage) : statusMessage;
  });

  const showStatus = (message, state, key = null) => {
    statusMessage = message;
    statusKey = key;
    status.textContent = key ? translate(key, message) : message;
    status.dataset.state = state;
  };

  const request = async (options, timeout) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const language = window.SiteLanguage?.language ?? 'en';
      // Keep the original URL for English clients; POST carries its own language field.
      const url = options.method === 'GET' && language !== 'en'
        ? `${contactForm.action}${contactForm.action.includes('?') ? '&' : '?'}lang=${encodeURIComponent(language)}` : contactForm.action;
      if (options.body) options.body.set('lang', language);
      const response = await fetch(url, {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const data = await response.json();
      if (typeof data.ok !== 'boolean' || typeof data.message !== 'string') {
        throw new Error('Unexpected server response');
      }
      return { response, data };
    } finally {
      window.clearTimeout(timer);
    }
  };

  // A retry after a lost connection keeps its ID. Editing the enquiry starts a new one.
  contactForm.addEventListener('input', (event) => {
    requestId = null;
    event?.target?.setCustomValidity?.('');
  });

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !contactForm.reportValidity()) return;
    const fields = new FormData(contactForm);
    const controls = [...contactForm.elements].filter((control) => !control.disabled);
    sending = true;
    controls.forEach((control) => { control.disabled = true; });
    contactForm.setAttribute('aria-busy', 'true');
    renderButton();
    showStatus('Sending your enquiry…', 'pending', 'form.pending');

    try {
      if (!requestId) {
        requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
          (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
      const prepared = await request({ method: 'GET' }, 10000);
      if (!prepared.response.ok || !prepared.data.ok || typeof prepared.data.token !== 'string') {
        showStatus(prepared.data.message || 'Please try again, or email info@al-aqsa.eu.', 'error', prepared.data.message_key || 'form.fallback');
        return;
      }
      fields.set('token', prepared.data.token);
      fields.set('request_id', requestId);
      const { response, data } = await request({ method: 'POST', body: fields }, 25000);
      if (!response.ok || !data.ok) {
        showStatus(data.message, 'error', data.message_key);
        return;
      }
      contactForm.reset();
      requestId = null;
      showStatus(data.message, 'success', data.message_key);
    } catch {
      showStatus('We couldn’t confirm whether your enquiry was sent. Your text is still here. Please try again, or email info@al-aqsa.eu.', 'error', 'form.uncertain');
    } finally {
      sending = false;
      controls.forEach((control) => { control.disabled = false; });
      contactForm.removeAttribute('aria-busy');
      renderButton();
      status.focus({ preventScroll: true });
    }
  });

  submitButton.disabled = false;
}
