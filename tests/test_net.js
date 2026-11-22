const assert = require('assert');
const NK = require('../src/assets/js/net.js');
let n = 0; const t = (name, fn) => { fn(); n++; };

t('ipv4 parse', () => {
  assert.strictEqual(NK.ipv4ToInt('192.168.1.1'), 3232235777);
  assert.strictEqual(NK.ipv4ToInt('256.1.1.1'), null);
  assert.strictEqual(NK.ipv4ToInt('1.2.3'), null);
  assert.strictEqual(NK.intToIpv4(3232235777), '192.168.1.1');
  assert.strictEqual(NK.intToIpv4(4294967295), '255.255.255.255');
});
t('cidr /24', () => {
  const i = NK.cidr4Info(NK.ipv4ToInt('192.168.1.77'), 24);
  assert.strictEqual(NK.intToIpv4(i.network), '192.168.1.0');
  assert.strictEqual(NK.intToIpv4(i.broadcast), '192.168.1.255');
  assert.strictEqual(NK.intToIpv4(i.mask), '255.255.255.0');
  assert.strictEqual(NK.intToIpv4(i.wildcard), '0.0.0.255');
  assert.strictEqual(i.usable, 254);
  assert.strictEqual(NK.intToIpv4(i.first), '192.168.1.1');
  assert.strictEqual(NK.intToIpv4(i.last), '192.168.1.254');
});
t('cidr edge prefixes', () => {
  assert.strictEqual(NK.cidr4Info(NK.ipv4ToInt('10.0.0.0'), 8).usable, 16777214);
  assert.strictEqual(NK.cidr4Info(NK.ipv4ToInt('10.0.0.4'), 31).usable, 2);
  assert.strictEqual(NK.cidr4Info(NK.ipv4ToInt('10.0.0.4'), 32).usable, 1);
  const z = NK.cidr4Info(NK.ipv4ToInt('1.2.3.4'), 0);
  assert.strictEqual(NK.intToIpv4(z.network), '0.0.0.0');
  assert.strictEqual(NK.intToIpv4(z.broadcast), '255.255.255.255');
  assert.strictEqual(z.total, 4294967296);
  const i = NK.cidr4Info(NK.ipv4ToInt('172.16.5.9'), 20);
  assert.strictEqual(NK.intToIpv4(i.network), '172.16.0.0');
  assert.strictEqual(NK.intToIpv4(i.broadcast), '172.16.15.255');
  const hi = NK.cidr4Info(NK.ipv4ToInt('203.0.113.200'), 26);
  assert.strictEqual(NK.intToIpv4(hi.network), '203.0.113.192');
});
t('spec parsing', () => {
  assert.deepStrictEqual(NK.parseSpec('10.1.2.3/8').prefix, 8);
  assert.strictEqual(NK.parseSpec('10.1.2.3 255.255.255.0').prefix, 24);
  assert.strictEqual(NK.parseSpec('10.1.2.3 0.0.0.255').prefix, 24);   // wildcard
  assert.strictEqual(NK.parseSpec('10.1.2.3').bare, true);
  assert.strictEqual(NK.parseSpec('10.1.2.3/33'), null);
  assert.strictEqual(NK.parseSpec('10.1.2.3 255.0.255.0'), null);
  assert.strictEqual(NK.parseSpec('hello'), null);
  assert.strictEqual(NK.parseSpec('2001:db8::/32').v, 6);
  assert.strictEqual(NK.parseSpec('2001:db8::/129'), null);
});
t('split', () => {
  const s = NK.splitV4(NK.ipv4ToInt('192.168.0.0'), 24, 26, 100);
  assert.strictEqual(s.count, 4);
  assert.deepStrictEqual(s.items.map(x => NK.intToIpv4(x.network)), ['192.168.0.0','192.168.0.64','192.168.0.128','192.168.0.192']);
  assert.strictEqual(NK.splitV4(0, 8, 24, 10).items.length, 10);
});
t('in cidr', () => {
  const net = NK.ipv4ToInt('10.0.0.0');
  assert.ok(NK.ipInCidr4(NK.ipv4ToInt('10.255.1.1'), net, 8));
  assert.ok(!NK.ipInCidr4(NK.ipv4ToInt('11.0.0.1'), net, 8));
});
t('kind', () => {
  const k = (s) => { const p = NK.parseSpec(s); return NK.ipv4Kind(NK.cidr4Info(p.ip, p.prefix).network, p.prefix).label; };
  assert.match(k('192.168.1.0/24'), /Private/);
  assert.match(k('10.0.0.0/8'), /Private/);
  assert.match(k('172.20.0.0/16'), /Private/);
  assert.match(k('172.32.0.0/16'), /Public/);
  assert.match(k('8.8.8.8'), /Public/);
  assert.match(k('100.64.0.0/10'), /CGNAT/);
  assert.match(k('169.254.1.1'), /Link-local/);
  assert.match(k('127.0.0.1'), /Loopback/);
  assert.match(k('224.0.0.1'), /Multicast/);
  assert.match(k('255.255.255.255'), /broadcast/);
  assert.match(k('0.0.0.0/0'), /Entire/);
  assert.match(k('10.0.0.0/7'), /Mixed/);
  assert.match(k('128.0.0.0/1'), /Mixed/);
  assert.strictEqual(NK.ipv4Class(NK.ipv4ToInt('10.1.1.1')), 'A');
  assert.strictEqual(NK.ipv4Class(NK.ipv4ToInt('172.16.1.1')), 'B');
  assert.strictEqual(NK.ipv4Class(NK.ipv4ToInt('192.168.1.1')), 'C');
});
t('any ipv4 formats', () => {
  const want = 3232235777;
  ['192.168.1.1', '3232235777', '0xC0A80101', '11000000101010000000000100000001', '11000000.10101000.00000001.00000001']
    .forEach(s => assert.strictEqual(NK.parseAnyIpv4(s).n, want, s));
  assert.strictEqual(NK.parseAnyIpv4('4294967296'), null);
  assert.strictEqual(NK.parseAnyIpv4('nonsense'), null);
  assert.strictEqual(NK.toDottedBinary(want), '11000000.10101000.00000001.00000001');
});
t('ptr', () => {
  assert.strictEqual(NK.ptrName4(NK.ipv4ToInt('8.8.4.4')), '4.4.8.8.in-addr.arpa');
  assert.strictEqual(NK.ptrName6(NK.parseIpv6('2001:db8::1')),
    '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
  assert.strictEqual(NK.ptrZone6(NK.parseIpv6('2001:db8::'), 32), '8.b.d.0.1.0.0.2.ip6.arpa');
  assert.strictEqual(NK.ptrZone6(NK.parseIpv6('2001:db8::'), 33), null);
});
t('ipv6 parse + format', () => {
  const f = (s, e) => NK.formatIpv6(NK.parseIpv6(s), e);
  assert.strictEqual(f('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.strictEqual(f('2001:db8::1', true), '2001:0db8:0000:0000:0000:0000:0000:0001');
  assert.strictEqual(f('::'), '::');
  assert.strictEqual(f('::1'), '::1');
  assert.strictEqual(f('1::'), '1::');
  assert.strictEqual(f('fe80::1%eth0'), 'fe80::1');
  assert.strictEqual(f('::ffff:192.168.1.1'), '::ffff:c0a8:101');
  assert.strictEqual(f('2001:db8:0:1:0:0:0:1'), '2001:db8:0:1::1');
  assert.strictEqual(f('2001:0:0:1:0:0:0:1'), '2001:0:0:1::1');  // longest run wins
  assert.strictEqual(f('1:0:0:2:0:0:3:4'), '1::2:0:0:3:4');       // tie → first run
  ['', ':::', '1:2:3', '1::2::3', '12345::1', 'g::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7::8', ':1::2'].forEach(s =>
    assert.strictEqual(NK.parseIpv6(s), null, 'should reject ' + s));
});
t('ipv6 info', () => {
  const p = NK.parseSpec('2001:db8:abcd:12::5/48');
  const i = NK.ipv6Info(p.ip, p.prefix);
  assert.strictEqual(NK.formatIpv6(i.network), '2001:db8:abcd::');
  assert.strictEqual(NK.formatIpv6(i.last), '2001:db8:abcd:ffff:ffff:ffff:ffff:ffff');
  assert.strictEqual(i.total, 1n << 80n);
  assert.strictEqual(i.slash64s, 65536n);
  assert.strictEqual(i.kind, 'Documentation');
  assert.strictEqual(NK.ipv6Kind(NK.parseIpv6('fe80::1')), 'Link-local unicast');
  assert.strictEqual(NK.ipv6Kind(NK.parseIpv6('fd12:3456::1')), 'Unique local address (ULA)');
  assert.strictEqual(NK.ipv6Kind(NK.parseIpv6('2606:4700::1111')), 'Global unicast');
  assert.strictEqual(NK.ipv6Kind(NK.parseIpv6('::1')), 'Loopback');
  assert.strictEqual(NK.ipv6Kind(NK.parseIpv6('ff02::1')), 'Multicast');
  assert.strictEqual(NK.fmtBig(1n << 64n), '18,446,744,073,709,551,616');
});

t('range to cidr', () => {
  const f = (a, b) => NK.rangeToCidrs(NK.ipv4ToInt(a), NK.ipv4ToInt(b)).map(x => NK.intToIpv4(x.net) + '/' + x.prefix);
  assert.deepStrictEqual(f('10.0.0.0', '10.0.0.255'), ['10.0.0.0/24']);
  assert.deepStrictEqual(f('10.0.0.5', '10.0.0.5'), ['10.0.0.5/32']);
  assert.deepStrictEqual(f('192.168.1.10', '192.168.1.20'), ['192.168.1.10/31', '192.168.1.12/30', '192.168.1.16/30', '192.168.1.20/32']);
  assert.deepStrictEqual(f('0.0.0.0', '255.255.255.255'), ['0.0.0.0/0']);
  assert.deepStrictEqual(f('128.0.0.0', '255.255.255.255'), ['128.0.0.0/1']);
  assert.deepStrictEqual(f('10.0.0.1', '10.0.0.6'), ['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/31', '10.0.0.6/32']);
  assert.deepStrictEqual(f('10.0.0.0', '10.0.3.255'), ['10.0.0.0/22']);
  assert.deepStrictEqual(f('10.0.0.0', '10.0.5.255'), ['10.0.0.0/22', '10.0.4.0/23']);
  // random cross-check: blocks are contiguous, aligned and cover exactly the range
  for (let i = 0; i < 300; i++) {
    const a = Math.floor(Math.random() * 4294967296), len = Math.floor(Math.random() * 70000) + 1, b = Math.min(4294967295, a + len);
    const L = NK.rangeToCidrs(a, b); let cur = a;
    L.forEach(x => { assert.strictEqual(x.net, cur); const sz = Math.pow(2, 32 - x.prefix); assert.strictEqual(x.net % sz, 0); cur += sz; });
    assert.strictEqual(cur, b + 1);
  }
});
t('host prefix + vlsm', () => {
  assert.strictEqual(NK.hostPrefix(50), 26); assert.strictEqual(NK.hostPrefix(62), 26); assert.strictEqual(NK.hostPrefix(63), 25);
  assert.strictEqual(NK.hostPrefix(2), 30); assert.strictEqual(NK.hostPrefix(1), 30); assert.strictEqual(NK.hostPrefix(2, true), 31);
  assert.strictEqual(NK.hostPrefix(254), 24); assert.strictEqual(NK.hostPrefix(255), 23);
  const base = NK.ipv4ToInt('192.168.10.0');
  const r = NK.vlsmPlan(base, 24, [{ name: 'Mgmt', hosts: 10 }, { name: 'Sales', hosts: 60 }, { name: 'WAN', hosts: 2 }, { name: 'Eng', hosts: 28 }], false);
  assert.deepStrictEqual(r.allocated.map(x => x.name + ' ' + NK.intToIpv4(x.net) + '/' + x.prefix),
    ['Sales 192.168.10.0/26', 'Eng 192.168.10.64/27', 'Mgmt 192.168.10.96/28', 'WAN 192.168.10.112/30']);
  assert.strictEqual(r.failed.length, 0); assert.strictEqual(NK.intToIpv4(r.nextFree), '192.168.10.116'); assert.strictEqual(r.freeLeft, 140);
  const over = NK.vlsmPlan(base, 24, [{ name: 'A', hosts: 120 }, { name: 'B', hosts: 120 }, { name: 'C', hosts: 10 }], false);
  assert.deepStrictEqual(over.failed.map(x => x.name), ['C']); assert.strictEqual(over.allocated.length, 2);
  assert.strictEqual(NK.vlsmPlan(base, 24, [{ name: 'Big', hosts: 300 }], false).failed.length, 1);
});
t('summarize cidrs', () => {
  const P = x => { const sp = NK.parseV4Spec(x); const i = NK.cidr4Info(sp.ip, sp.prefix); return { net: i.network, prefix: i.prefix }; };
  const run = l => NK.summarizeCidrs(l.map(P));
  const fm = r => r.merged.map(x => NK.intToIpv4(x.net) + '/' + x.prefix);
  let r = run(['192.168.0.0/24', '192.168.1.0/24', '192.168.2.0/24', '192.168.3.0/24']);
  assert.deepStrictEqual(fm(r), ['192.168.0.0/22']); assert.strictEqual(NK.intToIpv4(r.supernet.net) + '/' + r.supernet.prefix, '192.168.0.0/22'); assert.strictEqual(r.extra, 0);
  r = run(['10.0.0.0/24', '10.0.1.0/24', '10.0.2.0/24']);
  assert.deepStrictEqual(fm(r), ['10.0.0.0/23', '10.0.2.0/24']); assert.strictEqual(NK.intToIpv4(r.supernet.net) + '/' + r.supernet.prefix, '10.0.0.0/22'); assert.strictEqual(r.extra, 256);
  r = run(['10.0.0.0/8', '10.1.2.0/24']); assert.deepStrictEqual(fm(r), ['10.0.0.0/8']);
  r = run(['10.0.0.0/24', '10.0.0.0/24']); assert.deepStrictEqual(fm(r), ['10.0.0.0/24']);
  r = run(['172.16.0.0/24', '172.31.255.0/24']); assert.strictEqual(r.supernet.prefix, 12);
  r = run(['0.0.0.0/1', '128.0.0.0/1']); assert.deepStrictEqual(fm(r), ['0.0.0.0/0']);
  r = run(['1.1.1.1/32']); assert.strictEqual(r.supernet.prefix, 32);
  // random: merged set covers exactly the same addresses as the inputs; supernet contains all
  for (let i = 0; i < 200; i++) {
    const l = []; for (let k = 0; k < 6; k++) { const p = 20 + Math.floor(Math.random() * 10), base = 167772160 + Math.floor(Math.random() * 4096) * 256; const sz = Math.pow(2, 32 - p); l.push({ net: base - base % sz, prefix: p }); }
    const res = NK.summarizeCidrs(l), set = new Set();
    l.forEach(x => { for (let a = x.net; a < x.net + Math.pow(2, 32 - x.prefix); a += 256) set.add(a); });
    const set2 = new Set(); res.merged.forEach(x => { for (let a = x.net; a < x.net + Math.pow(2, 32 - x.prefix); a += 256) set2.add(a); });
    assert.deepStrictEqual([...set].sort((a, b) => a - b), [...set2].sort((a, b) => a - b));
    const sz = Math.pow(2, 32 - res.supernet.prefix); assert.strictEqual(res.covered + res.extra, sz);
    l.forEach(x => assert.ok(x.net >= res.supernet.net && x.net + Math.pow(2, 32 - x.prefix) <= res.supernet.net + sz));
  }
});
console.log('OK — ' + n + ' test groups passed');
