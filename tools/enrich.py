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
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data" / "artifacts.json"
CACHE = BASE / "tools" / ".enrich_cache"
OBJECT_URL = "https://www.britishmuseum.org/collection/object/{bm_id}"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")
DESC_MAX_CHARS = 300

# Fields we are allowed to fill, mapped to the candidate keys we look for in
# the British Museum page record. Edit the candidate lists if --dump shows the
# real keys differ.
FIELD_CANDIDATES = {
    "description": ["description", "Description", "physicalDescription", "comment"],
    "date_text": ["date", "productionDate", "production_date", "Date", "dateText"],
    "material": ["material", "materials", "Materials", "Material", "medium"],
}


# --------------------------------------------------------------- networking

class Fetcher:
    """Lazily-started Playwright browser with a persistent context so the
    Cloudflare clearance cookie is reused for every object."""

    def __init__(self, headed=False, delay=1.0):
        self.headed = headed
        self.delay = delay
        self._pw = self._browser = self._ctx = None

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
        self._browser = self._pw.chromium.launch(headless=not self.headed)
        self._ctx = self._browser.new_context(
            user_agent=UA, locale="en-GB", viewport={"width": 1280, "height": 900})

    def get(self, url):
        self._ensure()
        page = self._ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            # Give Cloudflare's challenge + client render time to settle.
            for _ in range(6):
                html = page.content()
                title = (page.title() or "").lower()
                if "just a moment" not in title and "__NEXT_DATA__" in html:
                    break
                page.wait_for_timeout(2000)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:  # noqa: BLE001
                pass
            return page.content()
        finally:
            page.close()
            time.sleep(self.delay)

    def close(self):
        for obj in (self._ctx, self._browser):
            try:
                obj and obj.close()
            except Exception:  # noqa: BLE001
                pass
        try:
            self._pw and self._pw.stop()
        except Exception:  # noqa: BLE001
            pass


def get_page(fetcher, bm_id):
    """Return the page HTML, from cache if present, else fetch + cache."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{bm_id}.html"
    if cached.exists():
        return cached.read_text("utf-8", "replace")
    html = fetcher.get(OBJECT_URL.format(bm_id=bm_id))
    cached.write_text(html or "", "utf-8")
    return html or ""


# --------------------------------------------------------------- parsing

def extract_next_data(html):
    """Pull the embedded __NEXT_DATA__ JSON blob the BM site ships."""
    m = re.search(
        r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def walk(node):
    """Yield every dict in a nested JSON structure."""
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


def find_record(blob, bm_id, museum_number):
    """Heuristically locate the object's detail dict within the page blob."""
    best, best_score = None, -1
    needles = {bm_id, (museum_number or "").replace(" ", "")}
    for d in walk(blob):
        text = json.dumps(d, ensure_ascii=False)
        score = 0
        if any(n and n in text for n in needles):
            score += 2
        # Looks like an object record if it carries several detail-ish keys.
        score += sum(1 for keys in FIELD_CANDIDATES.values()
                     for k in keys if k in d)
        if score > best_score:
            best, best_score = d, score
    return best if best_score >= 2 else None


def as_text(value):
    """Flatten a string / list / nested label dict into plain text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return ", ".join(t for t in (as_text(v) for v in value) if t)
    if isinstance(value, dict):
        for k in ("label", "name", "title", "value", "text"):
            if k in value:
                return as_text(value[k])
    return ""


def pick(record, field):
    for key in FIELD_CANDIDATES[field]:
        if key in record:
            txt = as_text(record[key])
            if txt:
                return txt
    return ""


def two_sentences(text):
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = " ".join(parts[:2]).strip()
    if len(out) > DESC_MAX_CHARS:
        out = out[:DESC_MAX_CHARS].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return out


def parse_object(html, bm_id, museum_number):
    blob = extract_next_data(html)
    if blob is None:
        return None
    record = find_record(blob, bm_id, museum_number)
    if record is None:
        return None
    return {
        "description": two_sentences(pick(record, "description")),
        "date_text": pick(record, "date_text"),
        "material": pick(record, "material"),
        "_record": record,
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
    args = ap.parse_args()

    data = json.loads(DATA.read_text("utf-8"))
    fetcher = Fetcher(headed=args.headed, delay=args.delay)

    try:
        if args.dump:
            html = get_page(fetcher, args.dump)
            saved = CACHE / f"{args.dump}.html"
            if not html:
                print(f"No page for {args.dump} (404 or empty).")
                return
            a = next((x for x in data if x.get("bm_id") == args.dump), {})
            parsed = parse_object(html, args.dump, a.get("museum_number"))
            if not parsed:
                print("Could not locate the object record in __NEXT_DATA__.")
                print(f"Rendered HTML saved to {saved}")
                print("Send me that file and I'll fix the parser to match the page.")
                return
            rec = parsed.pop("_record")
            print("=== extracted fields ===")
            print(json.dumps(parsed, indent=2, ensure_ascii=False))
            print("\n=== raw record keys ===")
            print(sorted(rec.keys()))
            print("\n=== raw record (first 2000 chars) ===")
            print(json.dumps(rec, indent=2, ensure_ascii=False)[:2000])
            print(f"\n(rendered HTML also saved to {saved})")
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
            parsed = parse_object(html, a["bm_id"], a.get("museum_number")) if html else None
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
