#!/usr/bin/env python3
"""
Enrich data/artifacts.json from the British Museum collection website.

The BM site sits behind Cloudflare, so plain HTTP gets a 403. This uses
Playwright (a real browser) to pass the challenge, reusing ONE browser
context so the clearance cookie carries across every request. Run it on a
machine that can reach britishmuseum.org (e.g. your Mac) — NOT in the
Claude sandbox.

One-time setup:
  pip install playwright
  playwright install chromium

Behaviour (per your settings):
  - ONLY fills blank fields (material, date_text, description). Never
    overwrites a value that is already present.
  - description is trimmed to at most 2 sentences (and a hard char cap).
  - Resumable + polite: every fetched page is cached under
    tools/.enrich_cache/, so re-runs skip work and you can stop/restart.

Typical use:
  1. Validate the field mapping on one object first:
       python3 tools/enrich.py --dump Y_EA77434
     It also saves the rendered HTML to tools/.enrich_cache/Y_EA77434.html
     — if the extracted fields look wrong/empty, send me that file.
  2. Dry-run a handful:
       python3 tools/enrich.py --limit 20 --dry-run
  3. Full run (writes data/artifacts.json):
       python3 tools/enrich.py

Flags:
  --limit N     only process the first N objects that still have blanks
  --dry-run     fetch + parse + report, but don't write artifacts.json
  --dump ID     fetch one bm_id, print the parsed record + save HTML, exit
  --delay S     seconds between live fetches (default 1.0; be kind)
  --headed      show the browser window (sometimes helps clear Cloudflare)
"""
import argparse
import json
import re
import time
from html import unescape as html_unescape
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data" / "artifacts.json"
CACHE = BASE / "tools" / ".enrich_cache"
OBJECT_URL = "https://www.britishmuseum.org/collection/object/{bm_id}"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")
DESC_MAX_CHARS = 300


# --------------------------------------------------------------- networking

class Fetcher:
    """Playwright browser with a PERSISTENT profile so the Cloudflare
    clearance cookie survives across pages and across runs. Once you clear
    the challenge once (use --headed the first time), later pages sail through."""

    PROFILE = BASE / "tools" / ".enrich_profile"

    def __init__(self, headed=False, delay=1.0, channel="chrome"):
        self.headed = headed
        self.delay = delay
        self.channel = channel
        self._pw = self._ctx = None

    def _ensure(self):
        if self._ctx:
            return
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise SystemExit(
                "Playwright is required:\n"
                "  pip install playwright && playwright install chromium")
        self._pw = sync_playwright().start()
        opts = dict(
            headless=not self.headed,
            user_agent=UA, locale="en-GB", timezone_id="Europe/London",
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        # Prefer the real installed Google Chrome (clears Cloudflare far more
        # reliably than bundled Chromium); fall back to Chromium if absent.
        try:
            self._ctx = self._pw.chromium.launch_persistent_context(
                str(self.PROFILE), channel=self.channel, **opts)
        except Exception:  # noqa: BLE001 - chrome channel not installed
            self._ctx = self._pw.chromium.launch_persistent_context(
                str(self.PROFILE), **opts)
        # Hide the most obvious automation tell from Cloudflare.
        self._ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")

    def get(self, url):
        self._ensure()
        page = self._ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            reloaded = False
            for i in range(20):  # up to ~40s of challenge/render wait
                html = page.content()
                title = (page.title() or "").lower()
                if "object-detail__data-term" in html:
                    return html
                if i == 10 and not reloaded:  # nudge a stuck challenge once
                    reloaded = True
                    try:
                        page.reload(wait_until="domcontentloaded", timeout=60000)
                    except Exception:  # noqa: BLE001
                        pass
                page.wait_for_timeout(2000)
            return page.content()  # give back whatever we have
        finally:
            page.close()
            time.sleep(self.delay)

    def close(self):
        try:
            self._ctx and self._ctx.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            self._pw and self._pw.stop()
        except Exception:  # noqa: BLE001
            pass


def get_page(fetcher, bm_id):
    """Return page HTML; cache only SUCCESSFUL renders so a Cloudflare
    challenge page is never cached (and will be retried on the next run)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{bm_id}.html"
    if cached.exists():
        return cached.read_text("utf-8", "replace")
    html = fetcher.get(OBJECT_URL.format(bm_id=bm_id)) or ""
    if "object-detail__data-term" in html:
        cached.write_text(html, "utf-8")
    return html


# --------------------------------------------------------------- parsing

# Each BM object field renders as:
#   <div class="object-detail__data-item">
#     <dt class="object-detail__data-term">Materials</dt>
#     <dd class="object-detail__data-description">…</dd> [<dd>…</dd> …]
#   </div>
# We map the labels below onto our three fields (first match wins).
LABELS = {
    "description": ["Description"],
    "date_text": ["Production date", "Date", "Cultures/periods"],
    "material": ["Materials", "Material"],
}


def strip_tags(s):
    s = re.sub(r"<[^>]+>", " ", s)
    s = html_unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def parse_fields(doc):
    """Return {label: value} for every detail row on the object page."""
    fields = {}
    for chunk in doc.split('<div class="object-detail__data-item">')[1:]:
        mt = re.search(r'<dt class="object-detail__data-term">(.*?)</dt>', chunk, re.DOTALL)
        if not mt:
            continue
        label = strip_tags(mt.group(1))
        dds = re.findall(
            r'<dd class="object-detail__data-description">(.*?)</dd>', chunk, re.DOTALL)
        vals = [v for v in (strip_tags(d) for d in dds) if v]
        if label and vals and label not in fields:
            fields[label] = ", ".join(vals)
    return fields


def two_sentences(text):
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = " ".join(parts[:2]).strip()
    if len(out) > DESC_MAX_CHARS:
        out = out[:DESC_MAX_CHARS].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return out


def parse_object(html):
    fields = parse_fields(html)
    if not fields:
        return None

    def first(label_keys):
        for k in label_keys:
            if fields.get(k):
                return fields[k]
        return ""

    return {
        "description": two_sentences(first(LABELS["description"])),
        "date_text": first(LABELS["date_text"]),
        "material": first(LABELS["material"]),
        "_fields": fields,
    }


# --------------------------------------------------------------- main

def needs_enrich(a):
    return not (a.get("material") and a.get("date_text") and a.get("description"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dump", metavar="BM_ID")
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--channel", default="chrome",
                    help="browser channel: chrome (default), msedge, or '' for bundled Chromium")
    args = ap.parse_args()

    data = json.loads(DATA.read_text("utf-8"))
    fetcher = Fetcher(headed=args.headed, delay=args.delay,
                      channel=args.channel or None)

    try:
        if args.dump:
            html = get_page(fetcher, args.dump)
            saved = CACHE / f"{args.dump}.html"
            if not html:
                print(f"No page for {args.dump} (404 or empty).")
                return
            parsed = parse_object(html)
            if not parsed:
                print("No detail fields found (Cloudflare page or empty render).")
                print(f"Rendered HTML saved to {saved} — send me that file.")
                return
            fields = parsed.pop("_fields")
            print("=== mapped (what will be written) ===")
            print(json.dumps(parsed, indent=2, ensure_ascii=False))
            print("\n=== all BM fields on the page ===")
            for k, v in fields.items():
                print(f"  {k}: {v[:160]}")
            return

        todo = [a for a in data if needs_enrich(a) and a.get("bm_id")]
        if args.limit:
            todo = todo[:args.limit]
        print(f"{len(todo)} objects still have blanks; processing "
              f"{len(todo)}{' (dry run)' if args.dry_run else ''}…")

        filled = {"material": 0, "date_text": 0, "description": 0}
        no_record = 0
        for i, a in enumerate(todo, 1):
            try:
                html = get_page(fetcher, a["bm_id"])
            except Exception as e:  # noqa: BLE001
                print(f"  [{i}/{len(todo)}] {a['bm_id']}: fetch error: {e}")
                continue
            parsed = parse_object(html) if html else None
            if not parsed:
                no_record += 1
            else:
                for field in ("material", "date_text", "description"):
                    if not a.get(field) and parsed.get(field):
                        a[field] = parsed[field]
                        filled[field] += 1
            if i % 50 == 0:
                print(f"  …{i}/{len(todo)}  filled so far: {filled}")
                if not args.dry_run:  # checkpoint so progress survives a stop
                    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")

        print(f"\nDone. Filled: {filled}. No record found for {no_record} objects.")
        if args.dry_run:
            print("Dry run — data/artifacts.json NOT written.")
        else:
            DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
            print(f"Wrote {DATA}")
    finally:
        fetcher.close()


if __name__ == "__main__":
    main()
