// Optional real-browser verification: requires Playwright and a local Chrome installation.
// CHROME_PATH may override Chrome's location; no real enquiry is sent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* Optional local browser tooling. */ }
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.webp':'image/webp', '.png':'image/png' };

test('responsive pages, translated FAQs, service enquiries and menu keyboard flow', { timeout:180000, skip:!chromium && 'Install Playwright to run the optional browser checks' }, async () => {
  const server = http.createServer(async (req, res) => {
    const filename = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', mime[path.extname(filename)] || 'text/plain'); res.end(await fs.readFile(filename)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath:process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined), headless:true });
    const page = await browser.newPage({ reducedMotion:'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    const pages = ['index','services','websites','applications','mendix','projects','sahiony-group','about','contact','privacy'];
    // Exercise real navigation, language fetching, and every public page at each size.
    for (const language of ['en','ar','de']) {
      for (const width of [1440,390,320]) {
        await page.setViewportSize({width,height:900});
        for (const name of pages) {
          await page.goto(`${base}/${name}.html`);
          await page.evaluate(code => window.SiteLanguage.set(code), language);
          assert.equal(await page.locator('html').getAttribute('lang'), language);
          assert.equal(await page.locator('html').getAttribute('dir'), language === 'ar' ? 'rtl' : 'ltr');
          assert.ok((await page.title()).includes('AL-AQSA'));
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          assert.equal(overflow, false, `${name} ${language} ${width}: horizontal overflow`);
        }
      }
    }
    await page.goto(`${base}/contact.html`);
    await page.evaluate(() => window.SiteLanguage.set('en'));
    assert.equal(await page.locator('[data-form-status]').isVisible(), false);
    await page.locator('.faq-list summary').first().click();
    assert.equal(await page.locator('.faq-list details').first().getAttribute('open'), '');
    assert.match(await page.locator('.faq-list details[open] p').textContent(), /proposal/);
    const field = page.locator('select[name="project"]');
    for (const [slug, value] of Object.entries({websites:'Website design & development', applications:'Web application or PWA', mendix:'Mendix consulting', unknown:'', constructor:'', '__proto__':''})) {
      await page.goto(`${base}/contact.html?service=${slug}`);
      assert.equal(await field.inputValue(), value);
      await page.evaluate(() => window.SiteLanguage.set('ar'));
      assert.equal(await field.inputValue(), value);
    }
    await page.goto(`${base}/contact.html`);
    assert.equal(await field.inputValue(), '');
    for (const slug of ['websites','applications','mendix']) {
      await page.goto(`${base}/${slug}.html`);
      await page.locator('.cta-row a').click();
      assert.ok(page.url().endsWith(`contact.html?service=${slug}`));
      assert.ok(await field.inputValue());
    }
    await page.setViewportSize({width:390,height:844});
    const toggle = page.locator('[data-menu-toggle]');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-menu] a')), true);
    assert.equal(await page.locator('main').evaluate(el => el.inert), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement === [...document.querySelectorAll('[data-menu] a')].at(-1)), true);
    await page.keyboard.press('Tab');
    assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('main').evaluate(el => el.inert), false);
    await toggle.click();
    await page.setViewportSize({width:1440,height:900});
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('menu-open')), false);

    // Mock the endpoint in the browser: verify failure retention and success clearing.
    await page.goto(`${base}/contact.html?service=websites`);
    await page.evaluate(() => window.SiteLanguage.set('en'));
    let accept = false;
    await page.route('**/contact.php*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(
      route.request().method() === 'GET' ? {ok:true,message:'Ready',token:'test-token'} : {ok:accept,message:accept?'Test enquiry accepted':'Test rejection'}
    ) }));
    await page.locator('[name="name"]').fill('Browser test');
    await page.locator('[name="email"]').fill('test@example.com');
    await page.locator('[name="message"]').fill('Local browser test only');
    await page.locator('button[type="submit"]').click();
    await page.locator('[data-form-status][data-state="error"]').waitFor();
    assert.equal(await page.locator('[name="message"]').inputValue(), 'Local browser test only');
    accept = true;
    await page.locator('button[type="submit"]').click();
    await page.locator('[data-form-status][data-state="success"]').waitFor();
    assert.equal(await page.locator('[name="message"]').inputValue(), '');
    assert.equal(await page.locator('button[type="submit"]').isEnabled(), true);

    if (process.env.WEBSITE_SCREENSHOTS) {
      await fs.mkdir(process.env.WEBSITE_SCREENSHOTS,{recursive:true});
      for (const [name,width,language] of [['home-desktop',1440,'en'],['home-mobile',390,'en'],['home-arabic',390,'ar'],['services',1440,'en'],['websites',1440,'en'],['applications',1440,'en'],['mendix',1440,'en'],['mendix-arabic',390,'ar'],['applications-dutch',390,'nl'],['case-study',1440,'en'],['about',1440,'en'],['contact',390,'de']]) {
        const file = name.startsWith('home')?'index':({'case-study':'sahiony-group','mendix-arabic':'mendix','applications-dutch':'applications'}[name] || name);
        const preview = await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
        await preview.goto(`${base}/${file}.html`);
        await preview.evaluate(code => window.SiteLanguage.set(code), language);
        await preview.evaluate(async () => { document.querySelectorAll('img').forEach(img => img.loading='eager'); await Promise.all([...document.images].map(img => img.decode().catch(()=>{}))); await document.fonts.ready; });
        if (width > 820) {
          const nav = await preview.locator('[data-menu] a').first().boundingBox();
          assert.ok(nav && nav.y >= 0 && nav.height < 60, JSON.stringify(nav));
        }
        await preview.screenshot({path:path.join(process.env.WEBSITE_SCREENSHOTS,`${name}.png`),fullPage:true});
        await preview.close();
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
