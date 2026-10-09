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

document.querySelector('[data-contact-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const subject = `AL-AQSA website enquiry — ${form.get('project')}`;
  const body = [
    `Name: ${form.get('name')}`,
    `Email: ${form.get('email')}`,
    `Service: ${form.get('project')}`,
    '',
    'Project details:',
    form.get('message'),
  ].join('\n');
  window.location.href = `mailto:info@al-aqsa.eu?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});
