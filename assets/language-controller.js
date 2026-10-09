/* Bundled translations only: no visitor content is sent to translation providers. */
(() => {
  const registry = new Map(siteLanguages.map((item) => [item.code, item]));
  const aliases = { no: 'nb', tl: 'fil', iw: 'he' };
  const normalize = (value) => {
    if (typeof value !== 'string') return null;
    const base = value.toLowerCase().split(/[-_]/)[0];
    const code = aliases[base] || base;
    return registry.has(code) ? code : null;
  };
  let saved;
  try { saved = localStorage.getItem('alaqsa-language'); } catch { /* Storage is optional. */ }
  const preferred = (navigator.languages || [navigator.language]).map(normalize).find(Boolean) || 'en';
  const initial = normalize(saved) || preferred;
  let language = siteTranslations[initial] ? initial : siteTranslations[preferred] ? preferred : 'en';
  let revision = 0;
  const listeners = new Set();
  const loading = new Map();
  const t = (key) => siteTranslations[language][key] ?? siteTranslations.en[key] ?? key;
  const pickers = [];
  const announce = (key, suffix = '') => pickers.forEach((picker) => {
    picker.status.dataset.state = key === 'language.error' ? 'error' : 'notice';
    picker.status.textContent = `${t(key)}${suffix ? ` ${suffix}` : ''}`;
  });

  const render = () => {
    document.documentElement.lang = language;
    document.documentElement.dir = registry.get(language).dir;
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      // Translation files are authored assets. Form input and server messages never become HTML.
      element.innerHTML = t(element.dataset.i18n);
    });
    ['aria-label', 'alt', 'content'].forEach((attribute) => {
      document.querySelectorAll(`[data-i18n-${attribute}]`).forEach((element) => {
        element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
      });
    });
    const whatsapp = document.querySelector('.contact-whatsapp');
    if (whatsapp) whatsapp.href = `https://wa.me/31684050907?text=${encodeURIComponent(t('whatsapp.greeting'))}`;
    pickers.forEach((picker) => picker.render());
    listeners.forEach((listener) => listener());
  };

  const load = (code) => {
    if (siteTranslations[code]) return Promise.resolve();
    if (!loading.has(code)) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 12000);
      loading.set(code, fetch(`assets/locales/${code}.json`, { signal: controller.signal })
        .then((response) => { if (!response.ok) throw new Error('Translation unavailable'); return response.json(); })
        .then((data) => {
          if (!data || Object.keys(siteTranslations.en).some((key) => typeof data[key] !== 'string' || !data[key].trim())) {
            throw new Error('Incomplete translation');
          }
          siteTranslations[code] = data;
        }).finally(() => { window.clearTimeout(timer); loading.delete(code); }));
    }
    return loading.get(code);
  };

  const set = async (value, remember = true) => {
    const code = normalize(value);
    if (!code) return false;
    const request = ++revision;
    if (!siteTranslations[code]) announce('language.loading');
    try {
      // Built-in languages switch synchronously, including when superseding a pending load.
      if (!siteTranslations[code]) await load(code);
      if (request !== revision) return false;
      const section = [...document.querySelectorAll('main section, main.policy')]
        .find((element) => element.getBoundingClientRect().bottom > 100);
      const top = section?.getBoundingClientRect().top;
      language = code;
      if (remember) { try { localStorage.setItem('alaqsa-language', language); } catch { /* Keep page choice. */ } }
      render();
      if (section) window.scrollBy({ top: section.getBoundingClientRect().top - top, behavior: 'instant' });
      announce('language.changed', registry.get(language).nativeName);
      return true;
    } catch {
      if (request === revision) announce('language.error');
      return false;
    }
  };
  window.SiteLanguage = {
    get language() { return language; },
    get languages() { return siteLanguages; },
    t, subscribe(listener) { listeners.add(listener); }, set,
  };

  document.querySelectorAll('[data-language-picker]').forEach((root, index) => {
    const trigger = root.querySelector('[data-language-trigger]');
    const name = root.querySelector('[data-language-name]');
    const panel = root.querySelector('[data-language-panel]');
    const search = root.querySelector('[data-language-search]');
    const list = root.querySelector('[data-language-list]');
    const empty = root.querySelector('[data-language-empty]');
    const status = root.querySelector('[data-language-status]');
    let filtered = siteLanguages;
    let active = 0;
    const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const highlight = () => {
      [...list.children].forEach((option, i) => { option.dataset.active = String(i === active); });
      if (list.children[active]) {
        search.setAttribute('aria-activedescendant', list.children[active].id);
        list.children[active].scrollIntoView({ block: 'nearest' });
      } else search.removeAttribute('aria-activedescendant');
    };
    const close = (focus = false) => {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      search.setAttribute('aria-expanded', 'false');
      if (focus) trigger.focus({ preventScroll: true });
    };
    const select = (code) => { close(true); void set(code); };
    const filter = () => {
      const query = fold(search.value.trim());
      filtered = siteLanguages.filter((item) => fold(`${item.name} ${item.nativeName} ${item.code}`).includes(query));
      list.replaceChildren();
      filtered.forEach((item, i) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.tabIndex = -1;
        option.id = `language-option-${index}-${item.code}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(item.code === language));
        option.dataset.code = item.code;
        const native = document.createElement('bdi');
        native.lang = item.code;
        native.textContent = item.nativeName;
        const english = document.createElement('small');
        english.lang = 'en'; english.dir = 'ltr'; english.textContent = item.name;
        option.append(native, english);
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => select(item.code));
        option.addEventListener('pointermove', () => { active = i; highlight(); });
        list.append(option);
      });
      active = Math.max(0, filtered.findIndex((item) => item.code === language));
      empty.hidden = filtered.length > 0;
      highlight();
    };
    const open = () => {
      status.textContent = ''; status.dataset.state = 'notice';
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-expanded', 'true');
      search.value = ''; filter(); search.focus({ preventScroll: true });
    };
    trigger.addEventListener('click', () => panel.hidden ? open() : close());
    trigger.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
      if (event.key === 'Escape') close(true);
    });
    search.addEventListener('input', filter);
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && filtered.length) {
        event.preventDefault();
        active = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1
          : (active + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
        highlight();
      }
      if (event.key === 'Enter' && filtered[active]) { event.preventDefault(); select(filtered[active].code); }
    });
    document.addEventListener('pointerdown', (event) => { if (!root.contains(event.target)) close(); });
    root.addEventListener('focusout', (event) => { if (!root.contains(event.relatedTarget)) close(); });
    pickers.push({ status, render() {
      root.hidden = false;
      name.textContent = registry.get(language).nativeName; name.lang = language;
      trigger.setAttribute('aria-label', `${t('language.label')}: ${registry.get(language).nativeName}`);
      search.placeholder = t('language.search'); search.setAttribute('aria-label', t('language.search'));
      list.setAttribute('aria-label', t('language.label')); empty.textContent = t('language.empty');
      if (!panel.hidden) filter();
    } });
  });
  render();
  if (initial !== language) void set(initial, false).then((success) => {
    if (!success && revision === 1 && preferred !== language) void set(preferred, false);
  });
})();
