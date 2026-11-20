/* NetKit shared browser helpers: DOM, fetch, clipboard, theme, ads. */
(function () {
  'use strict';
  var NK = window.NK = window.NK || {};

  NK.$ = function (s, r) { return (r || document).querySelector(s); };
  NK.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  NK.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* fetch JSON with a timeout; throws Error with a readable message */
  NK.fetchJson = function (url, opts, ms) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 10000) : null;
    var o = opts || {};
    if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).hostname);
      return r.json();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') throw new Error('Request timed out (' + new URL(url).hostname + ')');
      if (e instanceof TypeError) throw new Error('Network error or blocked by an ad blocker/extension (' + new URL(url).hostname + ')');
      throw e;
    }).then(function (j) { if (timer) clearTimeout(timer); return j; },
            function (e) { if (timer) clearTimeout(timer); throw e; });
  };

  /* DNS over HTTPS (JSON API) */
  NK.doh = function (name, type, provider) {
    var q = '?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type);
    if (provider === 'google') return NK.fetchJson('https://dns.google/resolve' + q);
    return NK.fetchJson('https://cloudflare-dns.com/dns-query' + q, { headers: { accept: 'application/dns-json' } });
  };

  /* shareable URLs: ?q=...&type=... */
  NK.getParam = function (k) {
    try { return new URLSearchParams(location.search).get(k) || ''; } catch (e) { return ''; }
  };
  NK.setParams = function (obj) {
    try {
      var u = new URL(location.href);
      Object.keys(obj).forEach(function (k) { if (obj[k]) u.searchParams.set(k, obj[k]); else u.searchParams.delete(k); });
      history.replaceState(null, '', u);
    } catch (e) { /* ignore */ }
  };

  NK.copy = function (text, el) {
    function done() {
      if (!el) return;
      el.classList.add('copied');
      setTimeout(function () { el.classList.remove('copied'); }, 900);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      document.body.removeChild(t);
    }
  };

  /* hide table rows that do not match the filter text */
  NK.filterRows = function (input, rowSel, countEl) {
    function run() {
      var q = input.value.trim().toLowerCase(), shown = 0;
      NK.$$(rowSel).forEach(function (tr) {
        var hit = !q || (tr.getAttribute('data-s') || tr.textContent).toLowerCase().indexOf(q) >= 0;
        tr.hidden = !hit; if (hit) shown++;
      });
      if (countEl) countEl.textContent = shown + ' shown';
    }
    input.addEventListener('input', run); run();
  };

  document.addEventListener('DOMContentLoaded', function () {
    /* click-to-copy */
    document.addEventListener('click', function (e) {
      var c = e.target.closest('.copyable');
      if (c) { NK.copy(c.getAttribute('data-copy-text') || c.textContent.trim(), c); return; }
      var b = e.target.closest('[data-copy]');
      if (b) {
        var t = NK.$(b.getAttribute('data-copy'));
        if (t) NK.copy(t.textContent.trim(), b);
      }
    });
    NK.$$('.copyable').forEach(function (el) { el.title = 'Click to copy'; });

    /* theme toggle */
    var btn = NK.$('#theme-toggle');
    if (btn) btn.addEventListener('click', function () {
      var root = document.documentElement, cur = root.getAttribute('data-theme');
      if (!cur) cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      var next = cur === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('nk-theme', next); } catch (e) { /* ignore */ }
    });

    /* AdSense units (only present when configured at build time) */
    NK.$$('ins.adsbygoogle').forEach(function () {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ignore */ }
    });
  });
})();
