#!/usr/bin/env python3
"""
Enrich data/artifacts.json from the British Museum collection website.

Network access is required, so run this on a machine that can reach
britishmuseum.org (e.g. your Mac) — NOT inside the Claude sandbox.

Behaviour (per your settings):
  - ONLY fills blank fields (material, date_text, description). Never
    overwrites a value that is already present.
  - description is trimmed to at most 2 sentences (and a hard char cap).
  - Resumable + polite: every fetched page is cached under
    tools/.enrich_cache/, so re-runs skip work and you can stop/restart.

Typical use:
  1. Validate the field mapping on one object first:
       python3 tools/enrich.py --dump Y_EA77434
     (prints the raw record the parser found — check it has the right
      description/date/material, then paste it to me if anything's off.)
  2. Dry-run a handful:
       python3 tools/enrich.py --limit 20 --dry-run
  3. Full run (writes data/artifacts.json):
       python3 tools/enrich.py

Flags:
  --limit N     only process the first N objects that still have blanks
  --dry-run     fetch + parse + report, but don't write artifacts.json
  --dump ID     fetch one bm_id, print the parsed record, exit
  --delay S     seconds between live fetches (default 1.0; be kind)
"""
import argparse
import gzip
import json
import re
import sys
import time
import urllib.request
import urllib.error
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

def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "en-GB,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


def get_page(bm_id, delay):
    """Return the page HTML, from cache if present, else fetch + cache."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{bm_id}.html"
    if cached.exists():
        return cached.read_text("utf-8", "replace"), True
    url = OBJECT_URL.format(bm_id=bm_id)
    last = None
    for attempt in range(4):
        try:
            html = fetch(url)
            cached.write_text(html, "utf-8")
            time.sleep(delay)
            return html, False
        except urllib.error.HTTPError as e:
            if e.code == 404:
                cached.write_text("", "utf-8")  # remember the miss
                return "", False
            last = e
        except Exception as e:  # noqa: BLE001 - network is messy; retry
            last = e
        time.sleep(2 ** attempt)
    raise RuntimeError(f"failed to fetch {url}: {last}")


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
    args = ap.parse_args()

    data = json.loads(DATA.read_text("utf-8"))

    if args.dump:
        html, cached = get_page(args.dump, args.delay)
        if not html:
            print(f"No page for {args.dump} (404 or empty).")
            return
        a = next((x for x in data if x.get("bm_id") == args.dump), {})
        parsed = parse_object(html, args.dump, a.get("museum_number"))
        if not parsed:
            print("Could not locate the object record in __NEXT_DATA__.")
            print("Paste this script's output to Claude so the mapping can be fixed.")
            return
        rec = parsed.pop("_record")
        print("=== extracted fields ===")
        print(json.dumps(parsed, indent=2, ensure_ascii=False))
        print("\n=== raw record keys ===")
        print(sorted(rec.keys()))
        print("\n=== raw record (first 2000 chars) ===")
        print(json.dumps(rec, indent=2, ensure_ascii=False)[:2000])
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
            html, cached = get_page(a["bm_id"], args.delay)
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

    print(f"\nDone. Filled: {filled}. No record found for {no_record} objects.")
    if args.dry_run:
        print("Dry run — data/artifacts.json NOT written.")
    else:
        DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
        print(f"Wrote {DATA}")


if __name__ == "__main__":
    main()
