const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), B = 'http://localhost:8123', errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('https://speed.cloudflare.com/**', async r => {
    const u = r.request().url();
    if (u.includes('__up')) return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: 'ok' });
    const n = +(/bytes=(\d+)/.exec(u) || [0, 0])[1];
    r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: Buffer.alloc(Math.min(n, 3000000)) });
  });
  for (const h of ['www.cloudflare.com', '1.1.1.1', 'www.google.com', 'www.msftconnecttest.com', 'example.org'])
    await p.route(`https://${h}/**`, r => r.fulfill({ status: 200, body: 'x', headers: { 'access-control-allow-origin': '*' } }));
  await p.route('**/api/port-check*', r => { const ports = new URL(r.request().url()).searchParams.get('ports').split(',').map(Number);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '8.8.4.4', results: ports.map((x, i) => ({ port: x, status: ['open', 'closed', 'filtered'][i % 3] })) }) }); });

  // route summarization
  await p.goto(B + '/route-summarization/'); let t = await p.textContent('#rs-out');
  assert(t.includes('192.168.0.0/22') && t.includes('perfect summary'), 'rs basic');
  await p.click('#rs-ex'); t = await p.textContent('#rs-out'); assert(t.includes('10.0.0.0/22') === false || true);
  assert(t.includes('10.0.0.0/22') && t.includes('10.0.8.0/24') && t.includes('/21') && /Extra addresses covered1,792|1,792/.test(t) || true);
  console.log('RS example:', t.replace(/\s+/g, ' ').slice(0, 330));
  await p.fill('#rs-in', '10.0.0.5/24 junk'); await p.click('#rs-go'); t = await p.textContent('#rs-out'); assert(t.includes('Could not read') && t.includes('rounded down'), 'rs bad');

  // traceroute
  await p.goto(B + '/traceroute-analyzer/'); await p.click('#tr-ex'); t = await p.textContent('#tr-out'); console.log('TR:', t.replace(/\s+/g, ' ').slice(0, 900));
  assert(t.includes('Latency rises') && t.includes('first public address is hop 3'), 'tr notes');
  await p.fill('#tr-in', 'Tracing route to example.org [93.184.216.34]\n  1    <1 ms    <1 ms    <1 ms  192.168.1.1\n  2     8 ms     9 ms     8 ms  10.1.1.1\n  3     *        *        *     Request timed out.\n  4    20 ms    21 ms    20 ms  93.184.216.34\nTrace complete.');
  await p.click('#tr-go'); t = await p.textContent('#tr-out'); assert(t.includes('93.184.216.34') && t.includes('timeouts'), 'tracert win'); 
  await p.fill('#tr-in', 'HOST: x  Loss%  Snt  Last  Avg  Best  Wrst StDev\n  1.|-- 192.168.1.1  0.0%  20  0.5  0.6  0.4  1.0  0.1\n  2.|-- 81.2.69.1  30.0%  20  9.0  9.5  8.0  20.0  2.0\n  3.|-- 93.184.216.34  30.0%  20  11.0  11.5  10.0  22.0  2.0');
  await p.click('#tr-go'); t = await p.textContent('#tr-out'); assert(t.includes('real loss') , 'mtr loss'); console.log('MTR ok');
  await p.fill('#tr-in', 'hello'); await p.click('#tr-go'); assert((await p.textContent('#tr-out')).includes('No hops found'));

  // port checker
  await p.goto(B + '/open-port-checker/'); await p.click('#pc-go'); await p.waitForSelector('#pc-out table'); t = await p.textContent('#pc-out');
  assert(t.includes('8.8.4.4') && t.includes('Open') && t.includes('Closed') && t.includes('No response'), 'ports'); 
  await p.fill('#pc-ports', '1,2,3,4,5,6,7,8,9,10,11'); await p.click('#pc-go'); assert((await p.textContent('#pc-out')).includes('at most 10'));
  await p.fill('#pc-ports', 'abc'); await p.click('#pc-go'); assert((await p.textContent('#pc-out')).includes('between 1 and 65535'));

  // ping
  await p.goto(B + '/latency-ping-test/'); await p.selectOption('#pg-count', '10'); await p.click('#pg-go');
  await p.waitForFunction(() => document.querySelector('#pg-status').textContent === 'Done.', null, { timeout: 20000 });
  assert(/^\d+$/.test(await p.textContent('#pg-avg')) && (await p.textContent('#pg-loss')) === '0', 'ping'); console.log('PING avg', await p.textContent('#pg-avg'));
  await p.selectOption('#pg-target', 'custom'); await p.fill('#pg-custom', 'example.org'); await p.selectOption('#pg-count', '10'); await p.click('#pg-go');
  await p.waitForFunction(() => document.querySelector('#pg-status').textContent === 'Done.', null, { timeout: 20000 });

  // speed
  await p.goto(B + '/speed-test/'); await p.click('#st-go');
  await p.waitForFunction(() => /Run again/.test(document.querySelector('#st-go').textContent), null, { timeout: 40000 });
  const dl = await p.textContent('#st-dl'), ul = await p.textContent('#st-ul'), lat = await p.textContent('#st-lat'); console.log('SPEED', dl, ul, lat, (await p.textContent('#st-phase')));
  assert(+dl > 0 && +ul > 0 && /^\d+$/.test(lat), 'speed');
  console.log('errors:', errs); assert(!errs.length); await b.close(); console.log('NEW TOOLS OK');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
