#!/usr/bin/env python3
"""NetKit static site builder.

    python3 build.py            # writes ./dist
    python3 -m http.server -d dist 8000

Edit config.json for site name, domain, contact email and AdSense IDs.
Tool pages live in src/tools/*.html, info pages in src/pages/*.html.
"""
import datetime
import hashlib
import html
import json
import re
import shutil
from pathlib import Path

import data

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))

SITE = CFG["site_name"]
TAGLINE = CFG["tagline"]
DOMAIN = CFG["domain"].strip().strip("/")
BASE = f"https://{DOMAIN}"
EMAIL = CFG["contact_email"]
SOURCEAPP = re.sub(r"[^a-z0-9]+", "-", SITE.lower()).strip("-") or "netkit"

PUB = CFG["adsense"].get("publisher_id", "").strip()
if PUB:
    if re.fullmatch(r"\d+", PUB):
        PUB = "ca-pub-" + PUB
    elif PUB.startswith("pub-"):
        PUB = "ca-" + PUB
GSC = CFG.get("google_site_verification", "").strip()
SLOTS = CFG["adsense"].get("slots", {})
HAS_ASIDE = bool(PUB and SLOTS.get("sidebar", "").strip())

TODAY = datetime.date.today()
UPDATED = TODAY.strftime("%B %d, %Y").replace(" 0", " ")

NAV_EXTRA = []  # filled below
pages_written = []  # (path, priority)


# ------------------------------------------------------------------ helpers
def e(s):
    return html.escape(str(s), quote=True)


def fmt(n):
    return f"{n:,}"


def ip(n):
    return ".".join(str((n >> s) & 255) for s in (24, 16, 8, 0))


def pmask(p):
    return 0 if p == 0 else (0xFFFFFFFF << (32 - p)) & 0xFFFFFFFF


def read_fragment(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
    if not m:
        raise SystemExit(f"{path}: missing front matter")
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    widget, _, article = m.group(2).partition("<!--ARTICLE-->")
    return meta, widget.strip(), article.strip()


def ad(key):
    slot = SLOTS.get(key, "").strip()
    if not (PUB and slot):
        return ""
    return (
        '<aside class="ad" aria-label="Advertisement"><span class="ad-label">Advertisement</span>'
        f'<ins class="adsbygoogle" style="display:block" data-ad-client="{PUB}" data-ad-slot="{e(slot)}" '
        'data-ad-format="auto" data-full-width-responsive="true"></ins></aside>'
    )


def faq_jsonld(article):
    items = re.findall(r"<details>\s*<summary>(.*?)</summary>\s*(.*?)</details>", article, re.S)
    if not items:
        return None
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": re.sub(r"<[^>]+>", "", q).strip(),
                "acceptedAnswer": {"@type": "Answer", "text": html.unescape(re.sub(r"<[^>]+>", "", a)).strip()},
            }
            for q, a in items
        ],
    }


# ------------------------------------------------------------------ generated tables
def subnet_table():
    notes = {
        0: "Entire IPv4 space (default route)", 8: "Large private block, e.g. 10.0.0.0/8", 12: "RFC 1918 172.16.0.0/12",
        16: "Class B-sized, e.g. 192.168.0.0/16", 24: "Typical office VLAN", 29: "Small DMZ / ISP hand-off",
        30: "Point-to-point link (classic)", 31: "Point-to-point link (RFC 3021)", 32: "Single host, loopback, router ID",
    }
    rows = []
    for p in range(0, 33):
        total = 2 ** (32 - p)
        usable = 1 if p == 32 else 2 if p == 31 else total - 2
        m = pmask(p)
        rows.append(
            f'<tr data-s="/{p} {ip(m)} {ip(~m & 0xFFFFFFFF)} {notes.get(p, "")}">'
            f'<td><a href="/cidr/{p}/">/{p}</a></td><td class="mono copyable">{ip(m)}</td>'
            f'<td class="mono copyable">{ip(~m & 0xFFFFFFFF)}</td><td>{fmt(total)}</td><td>{fmt(usable)}</td>'
            f'<td class="muted">{e(notes.get(p, ""))}</td></tr>'
        )
    return (
        '<div class="table-wrap"><table class="data" id="subnet-table"><thead><tr><th>CIDR</th><th>Subnet mask</th>'
        '<th>Wildcard</th><th>Addresses</th><th>Usable hosts</th><th>Typical use</th></tr></thead><tbody>'
        + "".join(rows) + "</tbody></table></div>"
    )


def ipv6_table():
    rows = [
        (16, "Very large allocation", "2^112"), (32, "Typical minimum ISP / LIR allocation", "2^96"),
        (48, "Typical end-site (enterprise or large customer) assignment", "2^80"),
        (56, "Common residential or small-site assignment", "2^72"),
        (60, "Small site, 16 subnets", "2^68"), (64, "Single subnet (required for SLAAC)", "2^64"),
        (127, "Router-to-router point-to-point link (RFC 6164)", "2"), (128, "Single host or loopback", "1"),
    ]
    body = "".join(
        f'<tr><td class="mono">/{p}</td><td class="mono">{c}</td><td>{e(u)}</td>'
        f'<td>{fmt(2 ** (64 - p)) if p <= 64 else "n/a"}</td></tr>'
        for p, u, c in rows
    )
    return (
        '<div class="table-wrap"><table class="data"><thead><tr><th>Prefix</th><th>Addresses</th><th>Typical use</th>'
        '<th>/64 subnets inside</th></tr></thead><tbody>' + body + "</tbody></table></div>"
    )


def port_table():
    rows = []
    for port, proto, svc, note in sorted(data.PORTS, key=lambda r: (r[0], r[1])):
        rows.append(
            f'<tr data-s="{port} {proto} {e(svc)} {e(note)}"><td class="mono">{port}</td><td>{proto}</td>'
            f'<td><strong>{e(svc)}</strong></td><td class="muted">{e(note)}</td></tr>'
        )
    return (
        '<div class="table-wrap"><table class="data"><thead><tr><th>Port</th><th>Protocol</th><th>Service</th>'
        '<th>Notes</th></tr></thead><tbody id="port-rows">' + "".join(rows) + "</tbody></table></div>"
    )


def proto_table():
    rows = "".join(
        f'<tr><td class="mono">{n}</td><td><strong>{e(k)}</strong></td><td>{e(name)}</td><td class="muted">{e(note)}</td></tr>'
        for n, k, name, note in data.PROTOCOLS
    )
    return (
        '<div class="table-wrap"><table class="data"><thead><tr><th>Number</th><th>Keyword</th><th>Name</th>'
        '<th>Notes</th></tr></thead><tbody>' + rows + "</tbody></table></div>"
    )


GEN = {
    "SUBNET_TABLE": subnet_table(), "IPV6_TABLE": ipv6_table(), "PORT_TABLE": port_table(), "PROTO_TABLE": proto_table(),
    "PORT_COUNT": str(len(data.PORTS)),
}


def fill(s):
    vars_ = {"SITE": SITE, "DOMAIN": DOMAIN, "EMAIL": EMAIL, "UPDATED": UPDATED, "SOURCEAPP": SOURCEAPP,
             "YEAR": str(TODAY.year), **GEN}
    return re.sub(r"\{\{(\w+)\}\}", lambda m: vars_.get(m.group(1), m.group(0)), s)


# ------------------------------------------------------------------ layout
def asset_hash(rel):
    return hashlib.md5((SRC / rel).read_bytes()).hexdigest()[:8]


CSS_V, NET_V, APP_V = asset_hash("assets/css/style.css"), asset_hash("assets/js/net.js"), asset_hash("assets/js/app.js")


def layout(*, title, desc, path, h1="", lead="", body="", hero="", jsonld=(), crumb_name=None, noindex=False, tools=(), ads=True):
    url = BASE + path
    full_title = title if path == "/" else f"{title} | {SITE}"
    ld = "".join(f'<script type="application/ld+json">{json.dumps(j, ensure_ascii=False)}</script>' for j in jsonld if j)
    adsense = ""
    if PUB:
        adsense = (
            f'<meta name="google-adsense-account" content="{PUB}">'
            f'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={PUB}" '
            'crossorigin="anonymous"></script>'
        )
    verify = f'<meta name="google-site-verification" content="{e(GSC)}">' if GSC else ""
    robots = "noindex,follow" if noindex else "index,follow,max-image-preview:large"
    tabs = "".join(
        f'<a class="tab" href="/{t["slug"]}/"' + (' aria-current="page"' if path == f'/{t["slug"]}/' else "") + f'>{e(t["nav"])}</a>'
        for t in tools
    )
    crumbs = ""
    if crumb_name:
        crumbs = f'<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; {e(crumb_name)}</nav>'
    head_block = hero or (f'{crumbs}<h1>{e(h1)}</h1><p class="lead">{e(lead)}</p>' if h1 else crumbs)
    has_aside = HAS_ASIDE and ads
    aside = f'<aside class="aside">{ad("sidebar")}</aside>' if has_aside else ""
    if hero:
        main = f'{hero}<main><div class="wrap"><div class="layout{" has-aside" if has_aside else ""}"><div class="content">{body}</div>{aside}</div></div></main>'
    else:
        main = (f'<main><div class="wrap"><div class="layout{" has-aside" if has_aside else ""}"><div class="content">'
                f'{head_block}{body}</div>{aside}</div></div></main>')
    tool_links = "".join(f'<li><a href="/{t["slug"]}/">{e(t["nav"])}</a></li>' for t in tools)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(full_title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}">
<meta name="robots" content="{robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{e(SITE)}">
<meta property="og:title" content="{e(full_title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0b6bde">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script>try{{var t=localStorage.getItem('nk-theme');if(t)document.documentElement.setAttribute('data-theme',t)}}catch(e){{}}</script>
<link rel="stylesheet" href="/assets/css/style.css?v={CSS_V}">
{verify}{adsense}{ld}
</head>
<body>
<header class="site-header"><div class="wrap">
<a class="logo" href="/"><span class="logo-mark" aria-hidden="true">/24</span>{e(SITE)}</a>
<div class="header-actions"><button class="icon-btn" id="theme-toggle" type="button" aria-label="Toggle dark mode">Theme</button></div>
</div></header>
<nav class="tabs" aria-label="Tools"><div class="wrap">{tabs}</div></nav>
<script src="/assets/js/net.js?v={NET_V}"></script>
<script src="/assets/js/app.js?v={APP_V}"></script>
{main}
<footer class="site-footer"><div class="wrap">
<div class="cols">
<div><h4>{e(SITE)}</h4><p>{e(TAGLINE)}. Calculators run in your browser; lookups use public APIs.</p></div>
<div><h4>Tools</h4><ul>{tool_links}</ul></div>
<div><h4>Company</h4><ul><li><a href="/about/">About</a></li><li><a href="/privacy/">Privacy policy</a></li><li><a href="/terms/">Terms of use</a></li><li><a href="/contact/">Contact</a></li></ul></div>
</div>
<p class="fine">&copy; {TODAY.year} {e(SITE)}. Results are provided for information only; verify before using them in production changes.</p>
</div></footer>
</body>
</html>
"""


def write(path, content, priority="0.6", index=True):
    out = DIST / path.lstrip("/")
    if path.endswith("/"):
        out = out / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(content, encoding="utf-8")
    if index:
        pages_written.append((path, priority))


# ------------------------------------------------------------------ pages
def load_tools():
    tools = []
    for f in sorted((SRC / "tools").glob("*.html")):
        meta, widget, article = read_fragment(f)
        meta.update(widget=widget, article=article)
        meta.setdefault("nav", meta["h1"])
        tools.append(meta)
    tools.sort(key=lambda t: int(t.get("order", 99)))
    return tools


def build_tool(t, tools):
    path = f"/{t['slug']}/"
    by_slug = {x["slug"]: x for x in tools}
    rel = [by_slug[s.strip()] for s in t.get("related", "").split(",") if s.strip() in by_slug]
    related = ""
    if rel:
        cards = "".join(
            f'<a class="card" href="/{r["slug"]}/"><span class="glyph">{e(r["glyph"])}</span><h3>{e(r["nav"])}</h3><p>{e(r["card"])}</p></a>'
            for r in rel
        )
        related = f'<section class="related"><h2>Related tools</h2><div class="cards">{cards}</div></section>'
    article = fill(t["article"])
    body = (
        f'{fill(t["widget"])}{ad("in_content")}'
        f'<section class="article">{article}'
        f'<p class="muted" style="margin-top:22px">Last reviewed {UPDATED}.</p></section>'
        f'{related}{ad("bottom")}'
    )
    ld = [
        {"@context": "https://schema.org", "@type": "WebApplication", "name": t["h1"], "url": BASE + path,
         "applicationCategory": "DeveloperApplication", "operatingSystem": "Any", "browserRequirements": "Requires JavaScript",
         "description": t["description"], "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": BASE + "/"},
            {"@type": "ListItem", "position": 2, "name": t["nav"], "item": BASE + path}]},
        faq_jsonld(article),
    ]
    write(path, layout(title=t["title"], desc=t["description"], path=path, h1=t["h1"], lead=fill(t["lead"]),
                       body=body, jsonld=ld, crumb_name=t["nav"], tools=tools), "0.9")


def build_home(tools):
    cards = "".join(
        f'<a class="card" href="/{t["slug"]}/" data-s="{e(t["nav"] + " " + t["card"] + " " + t.get("keywords", ""))}">'
        f'<span class="glyph">{e(t["glyph"])}</span><h3>{e(t["nav"])}</h3><p>{e(t["card"])}</p></a>'
        for t in tools
    )
    meta, widget, article = read_fragment(SRC / "pages" / "home.html")
    top, _, rest = widget.partition("<!--TOOLS-->")
    hero = (
        f'<section class="hero"><div class="wrap"><h1>{e(meta["h1"])}</h1><p class="lead">{e(fill(meta["lead"]))}</p></div></section>'
    )
    tools_block = (
        '<h2 class="sub" id="tools">More tools</h2>'
        '<label class="sr-only" for="tool-search">Search tools</label>'
        '<input class="search" id="tool-search" type="text" placeholder="Search tools: cidr, dns, bgp, port 443…" autocomplete="off">'
        f'<div class="cards" id="tool-cards">{cards}</div>'
        '<script>NK.filterRows(NK.$("#tool-search"),"#tool-cards .card");</script>'
    )
    article_html = fill(article)
    body = (
        f'{fill(top)}{tools_block}{ad("in_content")}{fill(rest)}'
        f'<section class="article">{article_html}</section>{ad("bottom")}'
    )
    ld = [{"@context": "https://schema.org", "@type": "WebSite", "name": SITE, "url": BASE + "/"},
          {"@context": "https://schema.org", "@type": "WebApplication", "name": "CIDR Visualizer", "url": BASE + "/",
           "applicationCategory": "DeveloperApplication", "operatingSystem": "Any", "browserRequirements": "Requires JavaScript",
           "description": meta["description"], "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}},
          faq_jsonld(article_html)]
    write("/", layout(title=meta["title"], desc=meta["description"], path="/", body=body, hero=hero, jsonld=ld, tools=tools), "1.0")


def build_info_pages(tools):
    for f in sorted((SRC / "pages").glob("*.html")):
        if f.stem == "home":
            continue
        meta, widget, article = read_fragment(f)
        path = f"/{f.stem}/"
        body = f'<section class="article">{fill(widget)}{fill(article)}</section>'
        write(path, layout(title=meta["title"], desc=meta["description"], path=path, h1=meta["h1"], lead=meta.get("lead", ""),
                           body=body, crumb_name=meta["h1"], tools=tools, ads=False), "0.3")


# ------------------------------------------------------------------ programmatic /cidr/<prefix>/ pages
def prefix_note(p, total, usable):
    special = {
        0: "A /0 matches every IPv4 address. It is used for the default route (0.0.0.0/0) and nothing else.",
        8: "A /8 is a very large block, the size of a historic Class A. 10.0.0.0/8 is the best-known private example.",
        16: "A /16 is a large site or campus block, the size of a historic Class B. 192.168.0.0/16 is a common private example.",
        24: "A /24 is the classic LAN subnet: 254 usable hosts, easy to read in dotted decimal, and the default for many office VLANs.",
        30: "A /30 leaves exactly two usable addresses, which made it the traditional choice for point-to-point links.",
        31: "A /31 has two addresses and no network or broadcast address (RFC 3021), so every address is usable. It is the modern choice for point-to-point links.",
        32: "A /32 is a single address. It is used for loopbacks, router IDs, host routes and ACL entries that match one host.",
    }
    if p in special:
        return special[p]
    if p >= 29:
        return f"A /{p} is a very small subnet ({fmt(usable)} usable hosts), suited to management segments, DMZ hand-offs or links with a handful of devices."
    if p >= 25:
        return f"A /{p} gives {fmt(usable)} usable hosts, which fits small VLANs such as servers, voice, guest Wi-Fi or a small branch."
    if p >= 22:
        return f"A /{p} gives {fmt(usable)} usable hosts, a good fit for a department, a floor or a medium branch office."
    if p >= 16:
        return f"A /{p} holds {fmt(total)} addresses. Blocks this size are usually site or data-centre allocations that get divided into smaller subnets."
    if p >= 9:
        return f"A /{p} holds {fmt(total)} addresses. Blocks this size are regional or provider aggregates and are always subdivided before use."
    return f"A /{p} holds {fmt(total)} addresses and is only seen as a large provider or registry aggregate."


def build_prefix_pages(tools):
    for p in range(0, 33):
        total = 2 ** (32 - p)
        usable = 1 if p == 32 else 2 if p == 31 else total - 2
        mask, wild = pmask(p), ~pmask(p) & 0xFFFFFFFF
        path = f"/cidr/{p}/"
        # example blocks
        parent_p, base = (24, "192.168.1.0") if p >= 24 else (16, "172.16.0.0") if p >= 16 else (8, "10.0.0.0") if p >= 8 else (0, "0.0.0.0")
        base_i = sum(int(x) << s for x, s in zip(base.split("."), (24, 16, 8, 0)))
        count = 2 ** (p - parent_p)
        rows = []
        for i in range(min(count, 16)):
            n = base_i + i * total
            b = n + total - 1
            first, last = (n, b) if p >= 31 else (n + 1, b - 1)
            rows.append(f'<tr><td class="mono">{ip(n)}/{p}</td><td class="mono">{ip(first)} – {ip(last)}</td>'
                        f'<td class="mono">{ip(b) if p < 31 else "—"}</td></tr>')
        more = f"<p class='muted'>Showing the first 16 of {fmt(count)} blocks.</p>" if count > 16 else ""
        first_n = base_i
        gw = first_n + 1 if p < 31 else first_n
        if p == 32:
            cisco = f"interface Loopback0\n ip address {base.rsplit('.', 1)[0]}.1 255.255.255.255\n!\naccess-list 10 permit host {base.rsplit('.', 1)[0]}.1"
            junos = f"set interfaces lo0 unit 0 family inet address {base.rsplit('.', 1)[0]}.1/32"
            linux = f"ip addr add {base.rsplit('.', 1)[0]}.1/32 dev lo"
        elif p == 0:
            cisco = "ip route 0.0.0.0 0.0.0.0 192.0.2.1"
            junos = "set routing-options static route 0.0.0.0/0 next-hop 192.0.2.1"
            linux = "ip route add default via 192.0.2.1"
        else:
            cisco = (f"interface Vlan10\n ip address {ip(gw)} {ip(mask)}\n!\n"
                     f"access-list 10 permit {ip(first_n)} {ip(wild)}")
            junos = f"set interfaces ge-0/0/0 unit 0 family inet address {ip(gw)}/{p}"
            linux = f"ip addr add {ip(gw)}/{p} dev eth0"
        binmask = ".".join(format((mask >> s) & 255, "08b") for s in (24, 16, 8, 0))
        facts = [("CIDR notation", f"/{p}"), ("Subnet mask", ip(mask)), ("Wildcard mask", ip(wild)),
                 ("Total addresses", fmt(total)), ("Usable hosts", fmt(usable)), ("Binary mask", binmask),
                 ("Host bits", str(32 - p))]
        kv = "".join(f'<div><dt>{k}</dt><dd class="mono copyable">{v}</dd></div>' for k, v in facts)
        usable_formula = ("2<sup>(32−%d)</sup> = %s; /31 and /32 are special cases" % (p, fmt(total))) if p >= 31 else \
            ("2<sup>(32−%d)</sup> − 2 = %s − 2 = %s" % (p, fmt(total), fmt(usable)))
        faq = (
            f"<details><summary>How many usable hosts are in a /{p}?</summary><p>{fmt(usable)}. "
            + ("A /31 uses both addresses on point-to-point links (RFC 3021)." if p == 31 else
               "A /32 is one address." if p == 32 else
               f"A /{p} has {fmt(total)} addresses; the first is the network address and the last is the broadcast address, so {fmt(usable)} are usable.") +
            f"</p></details><details><summary>What is the subnet mask for /{p}?</summary><p>{ip(mask)}. The wildcard mask, used in ACLs and OSPF network statements, is {ip(wild)}.</p></details>"
        )
        nav_links = []
        if p > 0:
            nav_links.append(f'<a href="/cidr/{p - 1}/">&larr; /{p - 1}</a>')
        nav_links.append('<a href="/subnet-chart/">Full subnet chart</a>')
        nav_links.append('<a href="/cidr-calculator/">CIDR calculator</a>')
        if p < 32:
            nav_links.append(f'<a href="/cidr/{p + 1}/">/{p + 1} &rarr;</a>')
        body = (
            f'<div class="tool"><dl class="kv">{kv}</dl></div>{ad("in_content")}'
            f'<section class="article"><h2>What a /{p} means</h2><p>{prefix_note(p, total, usable)}</p>'
            f'<p>The prefix length is the number of leading bits that identify the network. A /{p} uses {p} network bits and leaves {32 - p} host bits, '
            f'so the block contains {fmt(total)} addresses. Usable hosts: {usable_formula}.</p>'
            f'<h2>Example /{p} blocks inside {base}/{parent_p}</h2>'
            f'<div class="table-wrap"><table class="data"><thead><tr><th>Network</th><th>Usable range</th><th>Broadcast</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>{more}'
            f'<h2>Configuration examples</h2><h3>Cisco IOS</h3><pre class="code">{e(cisco)}</pre>'
            f'<h3>Juniper Junos</h3><pre class="code">{e(junos)}</pre><h3>Linux</h3><pre class="code">{e(linux)}</pre>'
            f'<p>Addresses shown are examples from private or documentation space. Replace them with your own plan.</p>'
            f'<h2>FAQ</h2>{faq}'
            f'<p class="chips">{" · ".join(nav_links)}</p></section>{ad("bottom")}'
        )
        title = f"/{p} Subnet Mask: {ip(mask)} ({fmt(usable)} Usable Hosts)"
        desc = (f"/{p} CIDR = subnet mask {ip(mask)}, wildcard {ip(wild)}, {fmt(total)} total addresses and "
                f"{fmt(usable)} usable hosts. Example ranges and Cisco, Junos and Linux config.")
        ld = [faq_jsonld(faq), {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": BASE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Subnet chart", "item": BASE + "/subnet-chart/"},
            {"@type": "ListItem", "position": 3, "name": f"/{p}", "item": BASE + path}]}]
        write(path, layout(title=title, desc=desc, path=path, h1=f"/{p} Subnet Mask: {ip(mask)}",
                           lead=f"{fmt(total)} addresses · {fmt(usable)} usable hosts · wildcard {ip(wild)}", body=body,
                           jsonld=ld, crumb_name=f"/{p}", tools=tools), "0.5")


# ------------------------------------------------------------------ site files
def build_site_files(tools):
    nf = layout(title="Page not found", desc="Page not found", path="/404.html", h1="Page not found",
                lead="That page does not exist. Try one of the tools below.",
                body='<p><a class="btn" href="/">Browse all tools</a></p>', noindex=True, tools=tools, ads=False)
    write("/404.html", nf, index=False)
    urls = "".join(
        f"<url><loc>{BASE}{p}</loc><lastmod>{TODAY.isoformat()}</lastmod><priority>{pr}</priority></url>"
        for p, pr in sorted(pages_written)
    )
    write("/sitemap.xml", f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n', index=False)
    write("/robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n", index=False)
    if PUB:
        write("/ads.txt", f"google.com, {PUB.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n", index=False)


def check_links():
    bad = []
    for f in DIST.rglob("*.html"):
        text = re.sub(r"<script\b[^>]*>.*?</script>", "", f.read_text(encoding="utf-8"), flags=re.S)
        for href in re.findall(r'href="(/[^"#?]*)', text):
            target = DIST / href.lstrip("/")
            if href.endswith("/"):
                target = target / "index.html"
            if not target.exists():
                bad.append(f"{f.relative_to(DIST)} -> {href}")
    return bad


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copytree(SRC / "assets", DIST / "assets")
    if (SRC / "root").exists():
        for f in (SRC / "root").iterdir():
            shutil.copy2(f, DIST / f.name)
    tools = load_tools()
    for t in tools:
        build_tool(t, tools)
    build_home(tools)
    build_info_pages(tools)
    build_prefix_pages(tools)
    build_site_files(tools)
    bad = check_links()
    print(f"Built {len(pages_written)} indexable pages -> {DIST}")
    if bad:
        print("BROKEN INTERNAL LINKS:\n  " + "\n  ".join(bad))
        raise SystemExit(1)
    print("Internal links OK.")
    if DOMAIN == "yourdomain.com":
        print("NOTE: set \"domain\" and \"contact_email\" in config.json before deploying.")
    if not PUB:
        print("NOTE: AdSense not configured (adsense.publisher_id is empty): no ad code or ads.txt was emitted.")


if __name__ == "__main__":
    main()
