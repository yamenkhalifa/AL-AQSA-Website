const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/language.js'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '../assets/language-controller.js'), 'utf8');
const locale = code => JSON.parse(fs.readFileSync(path.join(__dirname, `../assets/locales/${code}.json`), 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({ saved, preferences = ['en-US'], blocked = false, fetch } = {}) {
  const storage = new Map(saved ? [['alaqsa-language', saved]] : []);
  const heading = { dataset: { i18n: 'hero.title' }, innerHTML: '' };
  const option = { dataset: { i18n: 'form.website' }, value: 'Website design & development' };
  const whatsapp = {};
  const document = { documentElement: {},
    querySelector(selector) { return selector === '.contact-whatsapp' ? whatsapp : null; },
    querySelectorAll(selector) { return selector === '[data-i18n]' ? [heading, option] : []; } };
  const sandbox = { document, navigator: { languages: preferences },
    window: { setTimeout, clearTimeout }, AbortController,
    fetch: fetch || (async url => ({ ok: true, json: async () => locale(path.basename(url, '.json')) })),
    localStorage: { getItem(key) { if (blocked) throw Error(); return storage.get(key); },
      setItem(key, value) { if (blocked) throw Error(); storage.set(key, value); } } };
  vm.runInNewContext(source + controller, sandbox);
  return { ...sandbox, storage, heading, option, whatsapp };
}

test('browser preferences, regional codes, aliases and saved choices resolve correctly', async () => {
  for (const [options, expected] of [
    [{ preferences: ['ar-SA'] }, 'ar'], [{ preferences: ['AR'] }, 'ar'],
    [{ preferences: ['unsupported', 'nl-NL'] }, 'nl'], [{ preferences: ['pt-BR'] }, 'pt'],
    [{ preferences: ['no-NO'] }, 'nb'], [{ preferences: ['tl-PH'] }, 'fil'],
    [{ saved: 'en', preferences: ['ar'] }, 'en'], [{ saved: 'ar' }, 'ar'],
    [{ saved: 'invalid', preferences: ['ar'] }, 'ar'], [{ preferences: [] }, 'en'],
  ]) {
    const ui = setup(options); await tick();
    assert.equal(ui.document.documentElement.lang, expected);
    assert.equal(ui.document.documentElement.dir, expected === 'ar' ? 'rtl' : 'ltr');
  }
});

test('switch updates content and WhatsApp while preserving submission values; cache loads once', async () => {
  let requests = 0;
  const ui = setup({ fetch: async url => { requests++; return { ok: true, json: async () => locale(path.basename(url, '.json')) }; } });
  let updates = 0; ui.window.SiteLanguage.subscribe(() => updates++);
  await ui.window.SiteLanguage.set('ar');
  assert.match(ui.heading.innerHTML, /أعمالك/);
  assert.match(decodeURIComponent(ui.whatsapp.href), /مرحبًا/);
  assert.equal(ui.option.value, 'Website design & development');
  await ui.window.SiteLanguage.set('nl'); await ui.window.SiteLanguage.set('en'); await ui.window.SiteLanguage.set('nl');
  assert.equal(requests, 1); assert.equal(updates, 4);
  assert.equal(ui.storage.get('alaqsa-language'), 'nl');
  await ui.window.SiteLanguage.set('unsupported'); assert.equal(ui.document.documentElement.lang, 'nl');
});

test('blocked storage works; failed or incomplete downloads retain the current language', async () => {
  const ui = setup({ blocked: true, preferences: ['ar'] });
  await ui.window.SiteLanguage.set('en'); assert.equal(ui.document.documentElement.lang, 'en');
  for (const fetch of [async () => { throw Error(); }, async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({}) })]) {
    const failed = setup({ saved: 'ar', fetch });
    assert.equal(await failed.window.SiteLanguage.set('de'), false);
    assert.equal(failed.window.SiteLanguage.language, 'ar'); assert.equal(failed.storage.get('alaqsa-language'), 'ar');
  }
});

test('latest selection wins, including a built-in language selected during downloading', async () => {
  const pending = new Map();
  const ui = setup({ fetch: url => new Promise(resolve => pending.set(path.basename(url, '.json'), resolve)) });
  const german = ui.window.SiteLanguage.set('de'); const french = ui.window.SiteLanguage.set('fr');
  pending.get('fr')({ ok: true, json: async () => locale('fr') }); await french;
  pending.get('de')({ ok: true, json: async () => locale('de') }); await german;
  assert.equal(ui.window.SiteLanguage.language, 'fr');
  const dutch = ui.window.SiteLanguage.set('nl'); await ui.window.SiteLanguage.set('ar');
  pending.get('nl')({ ok: true, json: async () => locale('nl') }); await dutch;
  assert.equal(ui.window.SiteLanguage.language, 'ar');
});

test('40 complete dictionaries preserve markup and server feedback coverage', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/locales/registry.json'), 'utf8'));
  const embedded = vm.runInNewContext(source + '\nsiteTranslations;');
  assert.equal(registry.length, 40); const base = locale('en');
  for (const item of registry) {
    const data = locale(item.code);
    assert.deepEqual(Object.keys(data).sort(), Object.keys(base).sort(), item.code);
    for (const [key, value] of Object.entries(data)) {
      assert.equal(typeof value, 'string'); assert.ok(value.trim(), `${item.code}/${key}`);
      const tags = text => (text.match(/<[^>]+>/g) || []).sort();
      if (!['ar', 'en'].includes(item.code)) assert.deepEqual(tags(value), tags(base[key]), `${item.code}/${key}`);
    }
    if (embedded[item.code]) assert.deepEqual(JSON.parse(JSON.stringify(embedded[item.code])), data);
  }
  for (const file of ['index.html', 'privacy.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-aria-label|-alt|-content)?="([^"]+)"/g)) assert.ok(base[match[1]], match[1]);
  }
});
