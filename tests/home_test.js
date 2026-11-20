const { chromium } = require('playwright');
const base = 'http://localhost:8123';
(async () => {
  const b = await chromium.launch(); const errs = []; let fails = 0;
  const chk = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' :: ' + x)); };
  for (const [name, w, scheme] of [['desk', 1200, 'light'], ['mob', 390, 'dark']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(base + '/');
    const t = async s => (await p.innerText(s)).replace(/\s+/g, ' ');
    chk(name + ' initial range', /10\.0\.0\.0to10\.0\.3\.255|10\.0\.0\.0 ?to ?10\.0\.3\.255/.test(await t('#range')), await t('#range'));
    await p.click('.pf:text-is("/26")'); chk(name + ' tap /26', (await p.inputValue('#cidr')) === '10.0.0.0/26' && /64 addresses/.test(await t('#count')), await t('#count'));
    await p.fill('#cidr', '172.16.5.9/20'); chk(name + ' type', /172\.16\.0\.0.*172\.16\.15\.255/.test(await t('#range')));
    chk(name + ' url updated', /q=172\.16\.5\.9(%2F|\/)20/.test(p.url()), p.url());
    chk(name + ' steps rendered', (await p.locator('#steps > li').count()) === 7);
    await p.selectOption('#split-k', '2'); chk(name + ' split', /4 subnets/.test(await t('#split-out')));
    await p.fill('#need-n', '120'); chk(name + ' need 120 -> /25', /\/25/.test(await t('#need-out')));
    chk(name + ' tool cards', (await p.locator('#tool-cards .card').count()) === 8);
    await p.fill('#tool-search', 'dns'); { const n = await p.locator('#tool-cards .card:not([hidden])').count(); chk(name + ' card search filters', n >= 1 && n < 8, n); }
    // styling sanity: viewer input must not inherit the site's boxed input style
    const st = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('#cidr')); return { bt: c.borderTopWidth, bb: c.borderBottomWidth, fs: parseFloat(c.fontSize) }; });
    chk(name + ' big borderless input', st.bt === '0px' && st.bb === '2px' && st.fs >= 27, JSON.stringify(st));
    chk(name + ' no h-scroll', (await p.evaluate(() => document.documentElement.scrollWidth)) <= w);
    await p.goto(base + '/?q=192.168.1.0/27'); chk(name + ' deep link', (await p.inputValue('#cidr')) === '192.168.1.0/27' && /32 addresses/.test(await t('#count')), await t('#count'));
    await p.goto(base + '/?q=garbage'); chk(name + ' bad deep link falls back', /10\.0\.3\.255/.test(await t('#range')));
    await p.goto(base + '/'); await p.screenshot({ path: '/tmp/claude-0/-home-claude/41a70653-37da-5b63-b743-3736638dd488/scratchpad/home-' + name + '.png', clip: { x: 0, y: 0, width: w, height: name === 'desk' ? 1500 : 1700 } });
    await ctx.close();
  }
  console.log(errs.length ? 'JS ERRORS: ' + errs.join('\n') : 'No JS errors.'); console.log('FAILS:', fails); await b.close();
})();
