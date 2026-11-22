// Vercel serverless function: checks which TCP ports are reachable on the CALLER'S OWN public IP.
// It never accepts a target host, so it cannot be used to scan anyone else.
const net = require('net');

function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('::ffff:')) return false;
    return true;
  }
  return false;
}

function probe(ip, port, ms) {
  return new Promise(resolve => {
    const s = new net.Socket();
    let done = false;
    const end = status => { if (!done) { done = true; s.destroy(); resolve(status); } };
    s.setTimeout(ms || 3000);
    s.once('connect', () => end('open'));
    s.once('timeout', () => end('filtered'));
    s.once('error', err => end(err && err.code === 'ECONNREFUSED' ? 'closed' : 'filtered'));
    s.connect(port, ip);
  });
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers['x-real-ip'] || '').trim() || (req.socket && req.socket.remoteAddress) || '';
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'Use GET.' })); }
  const ip = clientIp(req);
  if (!isPublicIp(ip)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Could not determine a public IP address for your connection.' })); }
  const raw = String((req.query && req.query.ports) || new URL(req.url, 'http://x').searchParams.get('ports') || '');
  const ports = [...new Set(raw.split(',').map(s => s.trim()).filter(s => /^\d{1,5}$/.test(s)).map(Number))].filter(p => p >= 1 && p <= 65535);
  if (!ports.length) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Provide ports, for example ?ports=22,80,443' })); }
  if (ports.length > 10) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'At most 10 ports per request.' })); }
  const results = await Promise.all(ports.map(async p => ({ port: p, status: await probe(ip, p, 3000) })));
  res.statusCode = 200;
  res.end(JSON.stringify({ ip, results }));
}

module.exports = handler;
module.exports.isPublicIp = isPublicIp;
module.exports.probe = probe;
