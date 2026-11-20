/* NetKit core: pure IP math, no DOM. Runs in browsers and in Node (for tests). */
(function (root) {
  'use strict';
  var NK = root.NK || {};

  /* ---------- IPv4 ---------- */
  function ipv4ToInt(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
    if (!m) return null;
    var n = 0;
    for (var i = 1; i <= 4; i++) {
      var o = parseInt(m[i], 10);
      if (o > 255) return null;
      n = n * 256 + o;
    }
    return n;
  }
  function intToIpv4(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  function prefixToMask(p) { return p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0; }
  function maskToPrefix(mask) {
    for (var p = 0; p <= 32; p++) if (prefixToMask(p) === mask) return p;
    return -1;
  }

  var V4_SPECIAL = [
    ['0.0.0.0/8', '"This" network', 'RFC 1122'],
    ['10.0.0.0/8', 'Private (RFC 1918)', 'RFC 1918'],
    ['100.64.0.0/10', 'Shared address space (CGNAT)', 'RFC 6598'],
    ['127.0.0.0/8', 'Loopback', 'RFC 1122'],
    ['169.254.0.0/16', 'Link-local (APIPA)', 'RFC 3927'],
    ['172.16.0.0/12', 'Private (RFC 1918)', 'RFC 1918'],
    ['192.0.0.0/24', 'IETF protocol assignments', 'RFC 6890'],
    ['192.0.2.0/24', 'Documentation (TEST-NET-1)', 'RFC 5737'],
    ['192.88.99.0/24', '6to4 relay anycast (deprecated)', 'RFC 7526'],
    ['192.168.0.0/16', 'Private (RFC 1918)', 'RFC 1918'],
    ['198.18.0.0/15', 'Benchmarking', 'RFC 2544'],
    ['198.51.100.0/24', 'Documentation (TEST-NET-2)', 'RFC 5737'],
    ['203.0.113.0/24', 'Documentation (TEST-NET-3)', 'RFC 5737'],
    ['224.0.0.0/4', 'Multicast', 'RFC 5771'],
    ['240.0.0.0/4', 'Reserved (Class E)', 'RFC 1112'],
    ['255.255.255.255/32', 'Limited broadcast', 'RFC 919']
  ].map(function (r) {
    var parts = r[0].split('/'), p = +parts[1], s = ipv4ToInt(parts[0]);
    return { start: s, end: s + Math.pow(2, 32 - p) - 1, prefix: p, label: r[1], rfc: r[2] };
  });

  /* Classify an address or a whole block (network + prefix). */
  function ipv4Kind(net, prefix) {
    prefix = prefix === undefined ? 32 : prefix;
    if (prefix === 0) return { label: 'Entire IPv4 address space (default route)', rfc: '' };
    var bStart = net, bEnd = net + Math.pow(2, 32 - prefix) - 1, best = null, overlap = false;
    V4_SPECIAL.forEach(function (r) {
      if (r.start <= bStart && r.end >= bEnd) { if (!best || r.prefix > best.prefix) best = r; }
      else if (r.start <= bEnd && r.end >= bStart) overlap = true;
    });
    if (best) return { label: best.label, rfc: best.rfc };
    if (overlap) return { label: 'Mixed: block spans public and special-purpose ranges', rfc: '' };
    return { label: 'Public (globally routable)', rfc: '' };
  }
  function ipv4Class(n) {
    var f = n >>> 24;
    if (f < 128) return 'A'; if (f < 192) return 'B'; if (f < 224) return 'C';
    if (f < 240) return 'D (multicast)'; return 'E (reserved)';
  }

  function cidr4Info(ip, p) {
    var mask = prefixToMask(p), wild = (~mask) >>> 0;
    var net = (ip & mask) >>> 0, bc = (net | wild) >>> 0;
    var total = Math.pow(2, 32 - p), usable, first, last;
    if (p === 32) { usable = 1; first = net; last = net; }
    else if (p === 31) { usable = 2; first = net; last = bc; }
    else { usable = total - 2; first = net + 1; last = bc - 1; }
    return { ip: ip, prefix: p, mask: mask, wildcard: wild, network: net, broadcast: bc,
             first: first, last: last, total: total, usable: usable };
  }
  function ipInCidr4(ip, net, p) { return ((ip & prefixToMask(p)) >>> 0) === net; }

  function splitV4(net, p, newP, limit) {
    var count = Math.pow(2, newP - p), size = Math.pow(2, 32 - newP), out = [];
    for (var i = 0, n = Math.min(count, limit); i < n; i++) out.push(cidr4Info(net + i * size, newP));
    return { count: count, items: out };
  }

  function parseV4Spec(s) {
    s = s.trim();
    var m, ip, p;
    if ((m = /^(\S+?)\s*\/\s*(\d{1,2})$/.exec(s))) {
      ip = ipv4ToInt(m[1]); p = +m[2];
      return (ip === null || p > 32) ? null : { v: 4, ip: ip, prefix: p, bare: false };
    }
    if ((m = /^(\S+)\s+(\S+)$/.exec(s))) {
      ip = ipv4ToInt(m[1]); var mk = ipv4ToInt(m[2]);
      if (ip === null || mk === null) return null;
      p = maskToPrefix(mk);
      if (p < 0) p = maskToPrefix((~mk) >>> 0); /* wildcard mask */
      return p < 0 ? null : { v: 4, ip: ip, prefix: p, bare: false };
    }
    ip = ipv4ToInt(s);
    return ip === null ? null : { v: 4, ip: ip, prefix: 32, bare: true };
  }

  function parseAnyIpv4(s) {
    s = (s || '').trim();
    var v = ipv4ToInt(s), m;
    if (v !== null) return { n: v, from: 'dotted decimal' };
    s = s.replace(/\s+/g, '');
    if (/^\d{1,10}$/.test(s)) { var d = Number(s); return d <= 4294967295 ? { n: d, from: 'decimal integer' } : null; }
    if ((m = /^0x([0-9a-f]{1,8})$/i.exec(s))) return { n: parseInt(m[1], 16), from: 'hexadecimal' };
    if ((m = /^(?:0b)?([01]{32})$/i.exec(s))) return { n: parseInt(m[1], 2), from: 'binary' };
    if (/^[01]{8}(\.[01]{8}){3}$/.test(s)) return { n: parseInt(s.replace(/\./g, ''), 2), from: 'dotted binary' };
    return null;
  }

  function ptrName4(n) { return intToIpv4(n).split('.').reverse().join('.') + '.in-addr.arpa'; }
  function toDottedBinary(n) {
    var o = [];
    for (var i = 3; i >= 0; i--) o.push(('00000000' + ((n >>> (i * 8)) & 255).toString(2)).slice(-8));
    return o.join('.');
  }

  /* ---------- IPv6 (BigInt) ---------- */
  var ALL128 = (1n << 128n) - 1n;

  function parseIpv6(str) {
    if (typeof str !== 'string') return null;
    var s = str.trim().toLowerCase();
    var z = s.indexOf('%'); if (z >= 0) s = s.slice(0, z);
    if (s.indexOf(':') < 0) return null;
    var m = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
    if (m) {
      var v4 = ipv4ToInt(m[2]); if (v4 === null) return null;
      s = m[1] + (v4 >>> 16).toString(16) + ':' + (v4 & 0xffff).toString(16);
    }
    var halves = s.split('::');
    if (halves.length > 2) return null;
    var head = halves[0] ? halves[0].split(':') : [];
    var tail = (halves.length === 2 && halves[1]) ? halves[1].split(':') : [];
    var groups;
    if (halves.length === 1) {
      if (head.length !== 8) return null;
      groups = head;
    } else {
      var missing = 8 - head.length - tail.length;
      if (missing < 1) return null;
      groups = head.slice();
      for (var i = 0; i < missing; i++) groups.push('0');
      groups = groups.concat(tail);
    }
    var n = 0n;
    for (var j = 0; j < 8; j++) {
      if (!/^[0-9a-f]{1,4}$/.test(groups[j])) return null;
      n = (n << 16n) | BigInt(parseInt(groups[j], 16));
    }
    return n;
  }
  function ipv6Groups(n) {
    var g = [];
    for (var i = 7; i >= 0; i--) g.push(Number((n >> BigInt(i * 16)) & 0xffffn));
    return g;
  }
  function formatIpv6(n, expanded) {
    var g = ipv6Groups(n);
    if (expanded) return g.map(function (x) { return ('0000' + x.toString(16)).slice(-4); }).join(':');
    var best = -1, bestLen = 0, cur = -1, curLen = 0, i;
    for (i = 0; i < 8; i++) {
      if (g[i] === 0) { if (cur < 0) { cur = i; curLen = 1; } else curLen++; if (curLen > bestLen) { best = cur; bestLen = curLen; } }
      else { cur = -1; curLen = 0; }
    }
    var parts = g.map(function (x) { return x.toString(16); });
    if (bestLen >= 2) return parts.slice(0, best).join(':') + '::' + parts.slice(best + bestLen).join(':');
    return parts.join(':');
  }
  function ptrName6(n) {
    return formatIpv6(n, true).replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa';
  }
  function ptrZone6(net, p) {
    if (p <= 0 || p % 4 !== 0) return null;
    return formatIpv6(net, true).replace(/:/g, '').slice(0, p / 4).split('').reverse().join('.') + '.ip6.arpa';
  }

  var V6_SPECIAL = [
    ['::/128', 'Unspecified address'], ['::1/128', 'Loopback'], ['::ffff:0:0/96', 'IPv4-mapped address'],
    ['64:ff9b::/96', 'NAT64 well-known prefix'], ['100::/64', 'Discard-only prefix'],
    ['2001::/32', 'Teredo tunnelling'], ['2001:db8::/32', 'Documentation'], ['2002::/16', '6to4'],
    ['2000::/3', 'Global unicast'], ['fc00::/7', 'Unique local address (ULA)'],
    ['fe80::/10', 'Link-local unicast'], ['ff00::/8', 'Multicast']
  ].map(function (r) {
    var a = r[0].split('/');
    return { net: parseIpv6(a[0]), prefix: +a[1], label: r[1] };
  });
  function ipv6Kind(n) {
    var best = null;
    V6_SPECIAL.forEach(function (r) {
      var mask = ALL128 ^ ((1n << BigInt(128 - r.prefix)) - 1n);
      if ((n & mask) === r.net && (!best || r.prefix > best.prefix)) best = r;
    });
    return best ? best.label : 'Reserved / unassigned';
  }
  function ipv6Info(n, p) {
    var host = BigInt(128 - p), hostMask = (1n << host) - 1n;
    var net = n & (ALL128 ^ hostMask);
    return { ip: n, prefix: p, network: net, first: net, last: net | hostMask, total: 1n << host,
             slash64s: p <= 64 ? (1n << BigInt(64 - p)) : null, kind: ipv6Kind(net) };
  }
  function parseV6Spec(s) {
    s = s.trim();
    var m = /^(\S+?)\s*\/\s*(\d{1,3})$/.exec(s), a = s, p = 128, bare = true;
    if (m) { a = m[1]; p = +m[2]; bare = false; if (p > 128) return null; }
    var n = parseIpv6(a);
    return n === null ? null : { v: 6, ip: n, prefix: p, bare: bare };
  }

  /* Any of: IPv4, IPv4/len, IPv4 mask, IPv6, IPv6/len */
  function parseSpec(s) {
    s = (s || '').trim();
    if (!s) return null;
    return s.indexOf(':') >= 0 ? parseV6Spec(s) : parseV4Spec(s);
  }

  function fmtBig(n) { return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtNum(n) { return Number(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  var api = {
    ipv4ToInt: ipv4ToInt, intToIpv4: intToIpv4, prefixToMask: prefixToMask, maskToPrefix: maskToPrefix,
    ipv4Kind: ipv4Kind, ipv4Class: ipv4Class, cidr4Info: cidr4Info, ipInCidr4: ipInCidr4, splitV4: splitV4,
    parseV4Spec: parseV4Spec, parseAnyIpv4: parseAnyIpv4, ptrName4: ptrName4, toDottedBinary: toDottedBinary,
    parseIpv6: parseIpv6, formatIpv6: formatIpv6, ptrName6: ptrName6, ptrZone6: ptrZone6, ipv6Kind: ipv6Kind,
    ipv6Info: ipv6Info, parseV6Spec: parseV6Spec, parseSpec: parseSpec, fmtBig: fmtBig, fmtNum: fmtNum
  };
  for (var k in api) NK[k] = api[k];

  if (typeof module !== 'undefined' && module.exports) module.exports = NK;
  else root.NK = NK;
})(typeof window !== 'undefined' ? window : globalThis);
