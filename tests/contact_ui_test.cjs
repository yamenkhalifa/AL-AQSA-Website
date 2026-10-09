const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// A small DOM boundary stub exercises the shipped submission code without dependencies.
function setup(fetch, language = null) {
  const handlers = {};
  const button = { disabled: true, innerHTML: 'Send enquiry', textContent: '' };
  const status = { dataset: {}, textContent: '', focus() {} };
  const input = { disabled: false };
  const fields = { name: 'Visitor', email: 'visitor@example.com', project: 'Something else',
    message: 'Please build my website', website: '' };
  let resets = 0;
  const form = {
    action: 'https://al-aqsa.eu/contact.php', elements: [input, button],
    querySelector: (selector) => selector.startsWith('button') ? button : status,
    addEventListener: (event, handler) => { handlers[event] = handler; },
    reportValidity: () => true, setAttribute() {}, removeAttribute() {},
    reset: () => { resets++; },
  };
  const document = {
    querySelector: (selector) => selector === '[data-contact-form]' ? form
      : selector === '[data-year]' ? {} : null,
    querySelectorAll: () => [],
  };
  const sandbox = {
    document, window: { addEventListener() {}, setTimeout, clearTimeout },
    IntersectionObserver: class { observe() {} },
    FormData: class extends Map { constructor() { super(Object.entries(fields)); } },
    crypto: webcrypto, Uint8Array, AbortController, fetch,
  };
  if (language) {
    const dictionaries = vm.runInNewContext(fs.readFileSync(require.resolve('../assets/language.js'), 'utf8').split('(() => {')[0] + '\nsiteTranslations;');
    const listeners = [];
    sandbox.window.SiteLanguage = {
      language,
      t(key) { return dictionaries[this.language][key]; },
      subscribe(listener) { listeners.push(listener); },
      set(value) { this.language = value; listeners.forEach(listener => listener()); },
    };
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../script.js'), 'utf8'), sandbox);
  return { button, input, status, fields, handlers, language: sandbox.window.SiteLanguage, get resets() { return resets; },
    submit: () => handlers.submit({ preventDefault() {} }) };
}

test('Arabic requests use canonical service values and feedback follows language changes during sending', async () => {
  let finish;
  let posted;
  const ui = setup(async (url, options) => {
    if (options.method === 'GET') {
      assert.ok(url.endsWith('?lang=ar'));
      return ready();
    }
    posted = options.body;
    return new Promise(resolve => { finish = resolve; });
  }, 'ar');
  const submission = ui.submit();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal(posted.get('lang'), 'ar');
  assert.equal(posted.get('project'), 'Something else');
  assert.match(ui.button.textContent, /جارٍ/);
  ui.language.set('en');
  assert.equal(ui.button.textContent, 'Sending…');
  assert.equal(ui.status.textContent, 'Sending your enquiry…');
  finish(response(true, { ok: true, message: 'شكرًا لك', message_key: 'server.success' }));
  await submission;
  assert.match(ui.status.textContent, /Thank you/);
  assert.match(ui.button.innerHTML, /Send enquiry/);
  ui.language.set('ar');
  assert.match(ui.status.textContent, /شكرًا/);
  assert.match(ui.button.innerHTML, /أرسل/);
});

test('Arabic server and uncertain-network errors retain text and localize feedback', async () => {
  const rejected = setup(async (_, options) => options.method === 'GET' ? ready()
    : response(false, { ok: false, message: 'Please enter a valid email address.', message_key: 'server.email' }), 'ar');
  await rejected.submit();
  assert.match(rejected.status.textContent, /بريد إلكتروني صحيح/);
  assert.equal(rejected.resets, 0);
  const disconnected = setup(async () => { throw new Error('network lost'); }, 'ar');
  await disconnected.submit();
  assert.match(disconnected.status.textContent, /ما زال نصك محفوظًا/);
  assert.equal(disconnected.resets, 0);
});

const response = (ok, data) => ({ ok, json: async () => data });
const ready = () => response(true, { ok: true, token: 'session-token', message: 'Ready' });

test('submits in-page and resets only after server acceptance', async () => {
  const requests = [];
  const ui = setup(async (url, options) => {
    requests.push({ url, options });
    assert.equal(ui.button.disabled, true);
    assert.equal(ui.input.disabled, true);
    return options.method === 'GET' ? ready()
      : response(true, { ok: true, message: 'Enquiry submitted.' });
  });
  assert.equal(ui.button.disabled, false);
  await ui.submit();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, 'https://al-aqsa.eu/contact.php');
  assert.equal(requests[1].options.body.get('token'), 'session-token');
  assert.equal(requests[1].options.body.get('message'), ui.fields.message);
  assert.equal(requests[1].options.credentials, 'same-origin');
  assert.equal(ui.resets, 1);
  assert.equal(ui.status.dataset.state, 'success');
  assert.equal(ui.input.disabled, false);
  assert.equal(ui.button.disabled, false);
});

test('server rejection retains entered text and permits retry', async () => {
  const ui = setup(async (_, options) => options.method === 'GET' ? ready()
    : response(false, { ok: false, message: 'Please try again later.' }));
  await ui.submit();
  assert.equal(ui.resets, 0);
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.status.textContent, 'Please try again later.');
  assert.equal(ui.button.disabled, false);
});

test('lost response retries keep the same request ID; edits use a new one', async () => {
  const ids = [];
  const ui = setup(async (_, options) => {
    if (options.method === 'GET') return ready();
    ids.push(options.body.get('request_id'));
    throw new TypeError('Network disconnected');
  });
  await ui.submit();
  await ui.submit();
  assert.equal(ids[0], ids[1]);
  assert.equal(ui.resets, 0);
  assert.match(ui.status.textContent, /couldn’t confirm/);
  ui.fields.message = 'Updated enquiry';
  ui.handlers.input();
  await ui.submit();
  assert.notEqual(ids[1], ids[2]);
});

test('rapid double submission sends once', async () => {
  let resume;
  let posts = 0;
  const ui = setup(async (_, options) => {
    if (options.method === 'GET') return ready();
    posts++;
    await new Promise((resolve) => { resume = resolve; });
    return response(true, { ok: true, message: 'Submitted' });
  });
  const first = ui.submit();
  await new Promise(setImmediate);
  await ui.submit();
  assert.equal(posts, 1);
  resume();
  await first;
});

test('a static host response never appears as a successful email', async () => {
  const ui = setup(async () => ({ ok: true, json: async () => { throw new SyntaxError('HTML'); } }));
  await ui.submit();
  assert.equal(ui.resets, 0);
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.button.disabled, false);
});
