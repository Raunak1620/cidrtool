const { chromium } = require('playwright');
const base = 'http://localhost:8123';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR ' + page.url() + ' ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  await ctx.route(/ipify\.org/, r => r.fulfill({ json: { ip: r.request().url().includes('api64') ? '2001:db8::5' : '203.0.113.9' } }));
  await ctx.route(/ipwho\.is/, r => r.fulfill({ json: { success: true, city: 'Mumbai', region: 'MH', country: 'India', connection: { asn: 13335, org: 'Cloudflare', isp: 'Cloudflare, Inc.' }, timezone: { id: 'Asia/Kolkata' }, latitude: 19, longitude: 72 } }));
  await ctx.route(/cloudflare-dns\.com|dns\.google/, r => {
    const u = new URL(r.request().url()); const t = u.searchParams.get('type');
    r.fulfill({ json: { Status: 0, AD: true, Answer: t === 'PTR' ? [{ name: 'x.', type: 12, TTL: 300, data: 'host.example.net.' }] : [{ name: 'example.com.', type: t === 'MX' ? 15 : 1, TTL: 3700, data: t === 'MX' ? '10 mail.example.com.' : '93.184.216.34' }] } });
  });
  await ctx.route(/stat\.ripe\.net/, r => {
    const u = new URL(r.request().url()); const ep = u.pathname.split('/')[2];
    const data = {
      'as-overview': { holder: 'CLOUDFLARENET', announced: true, block: { resource: '13312-18431', name: 'IANA 16-bit', desc: 'Assigned by ARIN' } },
      'announced-prefixes': { prefixes: [{ prefix: '1.1.1.0/24' }, { prefix: '2606:4700::/32' }] },
      'asn-neighbours': { neighbour_counts: { left: 2, right: 1, unique: 3, uncertain: 0 }, neighbours: [{ asn: 174, type: 'left', power: 50, v4_peers: 9, v6_peers: 3 }] },
      'prefix-overview': { announced: true, resource: '1.1.1.0/24', asns: [{ asn: 13335, holder: 'CLOUDFLARENET' }], block: { resource: '1.0.0.0/8', name: 'APNIC', desc: 'x' }, actual_num_related: 0 },
      'rpki-validation': { status: 'valid' },
    }[ep];
    r.fulfill({ json: { status: 'ok', data } });
  });
  const txt = async s => (await page.locator(s).innerText()).replace(/\s+/g, ' ');
  const check = (name, cond, extra) => console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra));

  // every page loads, no JS errors
  const paths = ['/', '/what-is-my-ip/', '/cidr-calculator/', '/dns-lookup/', '/bgp-asn-lookup/', '/subnet-chart/', '/port-numbers/', '/ip-converter/', '/bandwidth-calculator/', '/cidr/24/', '/privacy/', '/about/'];
  for (const p of paths) { const r = await page.goto(base + p); check('load ' + p, r.status() === 200, r.status()); }

  // CIDR
  await page.goto(base + '/cidr-calculator/'); await page.fill('#cidr-in', '172.16.5.9/20'); await page.press('#cidr-in', 'Enter');
  let o = await txt('#cidr-out');
  check('cidr v4 network', /172\.16\.0\.0\/20/.test(o) && /255\.255\.240\.0/.test(o) && /172\.16\.15\.255/.test(o) && /4,094/.test(o), o.slice(0, 300));
  check('cidr host-bits note', /Host bits are set/.test(o), o.slice(0, 100));
  await page.fill('#chk-ip', '172.16.9.1'); check('membership yes', /Yes, inside/.test(await txt('#chk-res')), await txt('#chk-res'));
  await page.fill('#chk-ip', '172.17.0.1'); check('membership no', /No, outside/.test(await txt('#chk-res')), await txt('#chk-res'));
  await page.selectOption('#split-p', '22'); o = await txt('#split-out'); check('split', /4 subnets of \/22/.test(o) && /172\.16\.12\.0\/22/.test(o), o.slice(0, 200));
  await page.fill('#cidr-in', '2001:db8:abcd::/48'); await page.press('#cidr-in', 'Enter'); o = await txt('#cidr-out');
  check('cidr v6', /65,536/.test(o) && /Documentation/.test(o) && /ip6\.arpa/.test(o), o.slice(0, 300));
  await page.fill('#cidr-in', '10.0.0.0/33'); await page.press('#cidr-in', 'Enter'); check('cidr invalid', /Could not parse/.test(await txt('#cidr-out')), '');
  await page.goto(base + '/cidr-calculator/?q=192.168.1.0/26'); check('cidr deep link', /192\.168\.1\.63/.test(await txt('#cidr-out')), '');

  // converter
  await page.goto(base + '/ip-converter/'); await page.fill('#conv-in', '0xC0A80101'); await page.press('#conv-in', 'Enter'); o = await txt('#conv-out');
  check('conv hex->dotted', /192\.168\.1\.1/.test(o) && /3232235777/.test(o) && /hexadecimal/i.test(o), o.slice(0, 200));
  check('conv 6to4', /2002:c0a8:101::\/48/.test(o), o.match(/6to4 prefix.{0,40}/)?.[0]);
  await page.fill('#conv-in', '2001:db8::1'); await page.press('#conv-in', 'Enter'); o = await txt('#conv-out');
  check('conv v6 solicited', /ff02::1:ff00:1/.test(o), o.match(/Solicited-node multicast.{0,40}/)?.[0]);

  // bandwidth
  await page.goto(base + '/bandwidth-calculator/'); o = await txt('#t-out'); check('bw transfer 100GB/1Gbps/90%', /14m 49s/.test(o), o);
  o = await txt('#w-out'); check('bdp 1Gbps*80ms = 10MB', /10 MB/.test(o) && /6\.55 Mbps/.test(o), o);

  // port + chart filters
  await page.goto(base + '/port-numbers/?q=radius'); const shown = await page.locator('#port-rows tr:not([hidden])').count(); check('port filter radius', shown >= 4 && shown <= 8, shown);
  await page.goto(base + '/subnet-chart/'); await page.fill('#chart-q', '255.255.255.224'); check('chart filter', (await page.locator('#subnet-table tbody tr:not([hidden])').count()) === 1, '');

  // lookups w/ mocks
  await page.goto(base + '/what-is-my-ip/'); await page.waitForFunction(() => document.querySelector('#ip-details').children.length > 0);
  o = await txt('#ip-main'); check('myip main', o === '203.0.113.9', o); check('myip v6', /2001:db8::5/.test(await txt('#ip-v6')), '');
  check('myip details', /Mumbai/.test(await txt('#ip-details')) && /host\.example\.net/.test(await txt('#ip-details')), await txt('#ip-details'));
  await page.fill('#ip-q', '192.168.0.1'); await page.press('#ip-q', 'Enter'); check('myip private', /Private/.test(await txt('#ip-other')), await txt('#ip-other'));
  await page.goto(base + '/dns-lookup/'); await page.fill('#dns-name', 'example.com'); await page.check('#dns-compare'); await page.click('#dns-form .btn');
  await page.waitForSelector('#dns-out table'); o = await txt('#dns-out'); check('dns compare', /Cloudflare/.test(o) && /Google/.test(o) && /93\.184\.216\.34/.test(o) && /DNSSEC validated/.test(o), o.slice(0, 200));
  await page.fill('#dns-name', '8.8.8.8'); await page.click('#dns-form .btn'); await page.waitForFunction(() => /host\.example\.net/.test(document.querySelector('#dns-out').innerText)); check('dns ptr', true);
  await page.goto(base + '/bgp-asn-lookup/'); await page.fill('#bgp-in', 'AS13335'); await page.press('#bgp-in', 'Enter');
  await page.waitForSelector('#bgp-out .kv'); o = await txt('#bgp-out'); check('bgp asn', /CLOUDFLARENET/.test(o) && /2 \(1 IPv4, 1 IPv6\)/.test(o) && /AS174|174/.test(o), o.slice(0, 300));
  await page.fill('#bgp-in', '1.1.1.1'); await page.press('#bgp-in', 'Enter'); await page.waitForSelector('#bgp-out table'); o = await txt('#bgp-out'); check('bgp prefix+rpki', /Valid/.test(o) && /AS13335/.test(o), o.slice(0, 300));

  // mobile layout: no horizontal scroll
  const m = await b.newContext({ viewport: { width: 375, height: 800 } }); const mp = await m.newPage();
  for (const p of ['/', '/cidr-calculator/?q=10.0.0.0/8', '/subnet-chart/', '/port-numbers/', '/cidr/24/']) {
    await mp.goto(base + p); const w = await mp.evaluate(() => document.documentElement.scrollWidth); check('mobile no h-scroll ' + p, w <= 376, w);
  }
  await page.goto(base + '/cidr-calculator/?q=192.168.1.0/24'); await page.screenshot({ path: '/tmp/claude-0/-home-claude/41a70653-37da-5b63-b743-3736638dd488/scratchpad/cidr.png' });
  await mp.goto(base + '/'); await mp.screenshot({ path: '/tmp/claude-0/-home-claude/41a70653-37da-5b63-b743-3736638dd488/scratchpad/home-mobile.png' });
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'No JS errors.');
  await b.close();
})();
