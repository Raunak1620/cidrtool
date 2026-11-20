# NetKit: free tools for network engineers

A static website (no backend, no database) with a CIDR visualizer home page, 8 tools and 33 programmatic `/cidr/<prefix>/` pages, built for search traffic and Google AdSense.

| Tool | URL | Data source |
|---|---|---|
| CIDR visualizer (home page, IPv4, with worked maths) | `/` | local JS |
| What is my IP | `/what-is-my-ip/` | ipify, ipwho.is (fallback ipapi.co), DoH for PTR |
| CIDR / subnet calculator (IPv4 + IPv6) | `/cidr-calculator/` | local JS |
| DNS lookup (compare Cloudflare vs Google) | `/dns-lookup/` | DNS-over-HTTPS |
| BGP / ASN / prefix / RPKI | `/bgp-asn-lookup/` | RIPEstat |
| Subnet mask cheat sheet | `/subnet-chart/` | generated at build |
| Port + protocol numbers | `/port-numbers/` | `data.py` |
| IP converter (dec/hex/bin/IPv6) | `/ip-converter/` | local JS |
| Bandwidth, BDP, TCP throughput | `/bandwidth-calculator/` | local JS |

## 1. Configure
Edit `config.json`:
- `domain` and `contact_email` (used in canonical URLs, sitemap, privacy policy, contact page)
- `site_name` if you want a different brand
- `google_site_verification` (Search Console meta tag token). Files in `src/root/` are copied to the site root (used for the Search Console HTML file)
- `adsense.publisher_id` and the three slot IDs, **after** AdSense approves you (see below)

## 2. Build
```
python3 build.py          # Python 3.8+, no packages needed
python3 -m http.server -d dist 8000
```
`build.py` regenerates the whole `dist/` folder. **Run it again after every change to `config.json` or anything in `src/`.** `dist/` is committed so Vercel can serve it without running a build.

## 3. Deploy on Vercel
1. Put this folder in a GitHub repo (include `dist/`, `vercel.json`) and push.
2. On vercel.com choose **Add New, Project**, import the repo. `vercel.json` already sets: no framework, no build command, output directory `dist`, trailing slashes on.
3. Deploy. Then **Settings, Domains**, add your own domain and follow the DNS instructions. AdSense does not approve `*.vercel.app` addresses, so the custom domain is required.
4. Before the first deploy, set `domain` and `contact_email` in `config.json`, run `python3 build.py`, and commit the new `dist/`. The domain is used for canonical URLs, the sitemap and the privacy policy.

Alternative without Git: install the Vercel CLI and run `vercel --prod` in this folder.

## 4. Connect Google AdSense
1. After the site is live on your domain, submit `https://yourdomain/sitemap.xml` in Google Search Console.
2. Apply at adsense.google.com with your domain. Approval usually needs indexed pages and some real traffic; it can take days to weeks. About, Privacy, Terms and Contact pages are already included.
3. Use a real, monitored address as `contact_email`.
4. When approved: in AdSense create 3 display ad units (in-content, bottom, sidebar). Put your publisher ID (`pub-1234567890123456`) and the three slot numbers into `config.json`, run `python3 build.py`, commit `dist/` and push. The build then adds the AdSense script, the `google-adsense-account` meta tag, the ad units on tool pages, and `/ads.txt` automatically. Ads are never placed on the policy pages or the 404 page.
5. **EEA, UK and Switzerland traffic needs a Google-certified consent banner.** Turn on Google's free "Privacy & messaging" consent message in your AdSense account. This site does not include one.
6. Never click your own ads or ask others to.

## 5. Things to check before launch
- The lookup tools call third-party APIs from the visitor's browser. Free tiers (ipify, ipwho.is, ipapi.co) have rate limits and can change terms; check them, and consider a paid tier or your own small API if traffic grows. RIPEstat asks that you identify the application via `sourceapp` (set from your site name).
- Ad blockers will block some lookups (they show a clear error message). Network engineers use ad blockers heavily, so expect lower ad revenue per visit than a general audience site.
- Re-check the privacy policy if you add analytics or change data providers.

## 6. Add a tool
Copy any file in `src/tools/`, change the front matter (`slug`, `title`, `h1`, `related` …), write the widget above `<!--ARTICLE-->` and the explanatory text/FAQ below it, then rebuild. The `<details><summary>` blocks become FAQ structured data automatically.

## Tests
```
node tests/test_net.js      # IP math unit tests
node tests/browser_test.js  # Playwright UI tests with mocked APIs (serve dist on :8123 first)
node tests/home_test.js     # Playwright tests for the home page viewer
```
