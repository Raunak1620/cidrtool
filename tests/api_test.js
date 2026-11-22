const assert = require('assert'), net = require('net'), h = require('../api/port-check.js');
(async () => {
  ['8.8.8.8', '1.1.1.1', '2606:4700::1111', '172.32.0.1', '100.128.0.1'].forEach(x => assert.ok(h.isPublicIp(x), x));
  ['10.1.1.1', '127.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '', 'abc', '224.0.0.1'].forEach(x => assert.ok(!h.isPublicIp(x), x));
  const srv = net.createServer(s => s.end()).listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const port = srv.address().port;
  assert.strictEqual(await h.probe('127.0.0.1', port, 1000), 'open');
  srv.close(); await new Promise(r => srv.once('close', r));
  assert.strictEqual(await h.probe('127.0.0.1', port, 1000), 'closed');
  // handler: validation paths
  const call = (headers, url) => new Promise(r => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { r({ code: this.statusCode, body: JSON.parse(b) }); } }; h({ method: 'GET', headers, url, socket: {} }, res); });
  let r = await call({ 'x-forwarded-for': '10.0.0.5' }, '/api/port-check?ports=80'); assert.strictEqual(r.code, 400);
  r = await call({ 'x-forwarded-for': '8.8.8.8' }, '/api/port-check'); assert.strictEqual(r.code, 400);
  r = await call({ 'x-forwarded-for': '8.8.8.8' }, '/api/port-check?ports=1,2,3,4,5,6,7,8,9,10,11'); assert.strictEqual(r.code, 400);
  r = await call({ 'x-forwarded-for': '8.8.8.8' }, '/api/port-check?ports=0,70000,abc'); assert.strictEqual(r.code, 400);
  console.log('OK — api tests passed');
})().catch(e => { console.error(e); process.exit(1); });
