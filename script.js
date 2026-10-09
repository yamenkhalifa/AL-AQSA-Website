const header = document.querySelector('[data-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const menu = document.querySelector('[data-menu]');

const closeMenu = () => {
  if (!menuToggle || !menu) return;
  menuToggle.setAttribute('aria-expanded', 'false');
  menu.classList.remove('is-open');
  document.body.classList.remove('menu-open');
};

menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menu?.classList.toggle('is-open', !isOpen);
  document.body.classList.toggle('menu-open', !isOpen);
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

document.querySelector('[data-year]').textContent = new Date().getFullYear();

const contactForm = document.querySelector('[data-contact-form]');

if (contactForm) {
  const submitButton = contactForm.querySelector('button[type="submit"]');
  const status = contactForm.querySelector('[data-form-status]');
  const buttonContent = submitButton.innerHTML;
  let sending = false;
  let requestId = null;

  const showStatus = (message, state) => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const request = async (options, timeout) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(contactForm.action, {
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
  contactForm.addEventListener('input', () => { requestId = null; });

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !contactForm.reportValidity()) return;
    const fields = new FormData(contactForm);
    const controls = [...contactForm.elements].filter((control) => !control.disabled);
    sending = true;
    controls.forEach((control) => { control.disabled = true; });
    contactForm.setAttribute('aria-busy', 'true');
    submitButton.textContent = 'Sending…';
    showStatus('Sending your enquiry…', 'pending');

    try {
      if (!requestId) {
        requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
          (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
      const prepared = await request({ method: 'GET' }, 10000);
      if (!prepared.response.ok || !prepared.data.ok || typeof prepared.data.token !== 'string') {
        showStatus(prepared.data.message || 'Please try again, or email info@al-aqsa.eu.', 'error');
        return;
      }
      fields.set('token', prepared.data.token);
      fields.set('request_id', requestId);
      const { response, data } = await request({ method: 'POST', body: fields }, 25000);
      if (!response.ok || !data.ok) {
        showStatus(data.message, 'error');
        return;
      }
      contactForm.reset();
      requestId = null;
      showStatus(data.message, 'success');
    } catch {
      showStatus('We couldn’t confirm whether your enquiry was sent. Your text is still here. Please try again, or email info@al-aqsa.eu.', 'error');
    } finally {
      sending = false;
      controls.forEach((control) => { control.disabled = false; });
      contactForm.removeAttribute('aria-busy');
      submitButton.innerHTML = buttonContent;
      status.focus({ preventScroll: true });
    }
  });

  submitButton.disabled = false;
}
