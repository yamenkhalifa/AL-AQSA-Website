const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/language.js'), 'utf8');

function setup({ saved, preferred = 'en-US', blocked = false } = {}) {
  const storage = new Map(saved ? [['alaqsa-language', saved]] : []);
  const element = (dataset = {}) => ({ dataset, attributes: {}, innerHTML: '',
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; },
    addEventListener(event, handler) { this[event] = handler; } });
  const heading = element({ i18n: 'hero.title' });
  const option = element({ i18n: 'form.website' });
  option.value = 'Website design & development';
  const buttons = ['ar', 'en'].map(language => element({ language }));
  const toggle = { hidden: true };
  const whatsapp = {};
  const document = { documentElement: {},
    querySelector(selector) { return selector === '.contact-whatsapp' ? whatsapp : null; },
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [heading, option];
      if (selector === '[data-language]') return buttons;
      if (selector === '.language-toggle') return [toggle];
      return [];
    } };
  const sandbox = { document, navigator: { languages: [preferred] }, window: {},
    localStorage: { getItem(key) { if (blocked) throw Error(); return storage.get(key); },
      setItem(key, value) { if (blocked) throw Error(); storage.set(key, value); } } };
  vm.runInNewContext(source, sandbox);
  return { ...sandbox, storage, heading, option, buttons, toggle, whatsapp };
}

test('first visit uses preferred browser locale and saved choices take precedence', () => {
  for (const [options, expected] of [
    [{ preferred: 'ar-SA' }, 'ar'], [{ preferred: 'AR' }, 'ar'],
    [{ preferred: 'nl-NL' }, 'en'], [{ saved: 'en', preferred: 'ar' }, 'en'],
    [{ saved: 'ar', preferred: 'en' }, 'ar'], [{ saved: 'invalid', preferred: 'ar' }, 'ar'],
  ]) {
    const ui = setup(options);
    assert.equal(ui.document.documentElement.lang, expected);
    assert.equal(ui.document.documentElement.dir, expected === 'ar' ? 'rtl' : 'ltr');
    assert.equal(ui.toggle.hidden, false);
  }
});

test('switch updates content, active state and WhatsApp while preserving submission values', () => {
  const ui = setup();
  let updates = 0;
  ui.window.SiteLanguage.subscribe(() => updates++);
  ui.buttons[0].click();
  assert.equal(ui.storage.get('alaqsa-language'), 'ar');
  assert.match(ui.heading.innerHTML, /أعمالك/);
  assert.equal(ui.buttons[0].attributes['aria-pressed'], 'true');
  assert.equal(ui.buttons[1].attributes['aria-pressed'], 'false');
  assert.match(decodeURIComponent(ui.whatsapp.href), /مرحبًا/);
  assert.equal(ui.option.value, 'Website design & development');
  ui.buttons[1].click();
  assert.match(ui.heading.innerHTML, /business/);
  assert.equal(updates, 2);
  ui.window.SiteLanguage.set('unsupported');
  assert.equal(ui.document.documentElement.lang, 'en');
});

test('blocked storage does not prevent browser selection or manual switching', () => {
  const ui = setup({ blocked: true, preferred: 'ar' });
  assert.equal(ui.document.documentElement.lang, 'ar');
  ui.buttons[1].click();
  assert.equal(ui.document.documentElement.lang, 'en');
});

test('all authored translation keys exist in both languages and PHP messages match the dictionary', () => {
  const dictionaries = vm.runInNewContext(source.split('(() => {')[0] + '\nsiteTranslations;');
  for (const file of ['index.html', 'privacy.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-aria-label|-alt|-content)?="([^"]+)"/g)) {
      for (const language of ['en', 'ar']) assert.ok(dictionaries[language][match[1]], `${file}: ${language}/${match[1]}`);
    }
  }
  const php = fs.readFileSync(path.join(__dirname, '../contact.php'), 'utf8');
  for (const key of Object.keys(dictionaries.ar).filter(key => key.startsWith('server.'))) {
    assert.ok(php.includes(`'${key}'`));
    assert.ok(php.includes(dictionaries.ar[key]));
  }
});
