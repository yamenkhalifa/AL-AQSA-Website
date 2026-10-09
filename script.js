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

window.addEventListener('scroll', () => {
  header?.classList.toggle('is-stuck', window.scrollY > 16);
}, { passive: true });

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((item) => revealObserver.observe(item));

const year = document.querySelector('[data-year]');
if (year) year.textContent = new Date().getFullYear();

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
