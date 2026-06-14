// Enrich data/artifacts.json from the British Museum object pages.
//
// This mirrors the proven recipe in your harvest.ts (real Chrome, headed,
// anti-automation args, a warmed persistent profile, a fixed render wait),
// generalised to every object in our dataset. It fills ONLY blank fields
// (material, date_text, description) and trims descriptions to 2 sentences.
//
// Reuse your already-Cloudflare-warmed profile and existing Playwright install:
//
//   cd ~/bm-test
//   BM_PROFILE=/Users/davidwaite/.gemini/antigravity/scratch/british-museum-extractor/chrome_data_extractor \
//   NODE_PATH=/Users/davidwaite/.gemini/antigravity/scratch/british-museum-extractor/node_modules \
//   node tools/enrich.mjs --dump Y_EA77434     # 1. sanity check one object
//   ...same env... node tools/enrich.mjs --limit 20 --dry   # 2. preview 20
//   ...same env... node tools/enrich.mjs                     # 3. full run -> writes artifacts.json
//
// Flags: --limit N | --dry | --dump BM_ID | --headless
// It's resumable: blanks-only + checkpoints every 25, so stop/restart freely.
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = process.env.BM_ARTIFACTS || path.join(__dirname, "..", "data", "artifacts.json");
const PROFILE = process.env.BM_PROFILE || path.join(__dirname, ".enrich_profile_chrome");
const OBJECT_URL = (id) => `https://www.britishmuseum.org/collection/object/${id}`;
const DESC_MAX = 300;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, d) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : d; };
const LIMIT = parseInt(opt("--limit", "0"), 10);
const DRY = flag("--dry");
const DUMP = opt("--dump", null);
const HEADLESS = flag("--headless");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function twoSentences(text) {
  text = (text || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const parts = text.split(/(?<=[.!?])\s+/);
  let out = parts.slice(0, 2).join(" ").trim();
  if (out.length > DESC_MAX) out = out.slice(0, DESC_MAX).replace(/\s+\S*$/, "").replace(/[,;:]$/, "") + "…";
  return out;
}

// Parse the object page's <dt>/<dd> detail list (runs in the browser).
async function parseDetails(page) {
  return await page.evaluate(() => {
    const data = {};
    for (const dt of Array.from(document.querySelectorAll("dt"))) {
      const key = (dt.textContent || "").trim();
      if (!key) continue;
      const parts = [];
      let el = dt.nextElementSibling;
      while (el && el.tagName.toLowerCase() === "dd") {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (t) parts.push(t);
        el = el.nextElementSibling;
      }
      if (parts.length && !(key in data)) data[key] = parts.join(", ");
    }
    return data;
  });
}

function mapFields(d) {
  return {
    description: twoSentences(d["Description"] || ""),
    date_text: (d["Production date"] || d["Date"] || d["Cultures/periods"] || "").trim(),
    material: (d["Materials"] || d["Material"] || "").trim(),
  };
}

async function warm(page) {
  await page.goto("https://www.britishmuseum.org/collection/search?keyword=museum&has_image=1",
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  try {
    const btn = page.locator('button:has-text("Allow all cookies"), button:has-text("Reject all cookies")').first();
    if (await btn.isVisible({ timeout: 2500 })) { await btn.click(); await sleep(1500); }
  } catch { /* no modal */ }
}

async function fetchObject(page, id) {
  await page.goto(OBJECT_URL(id), { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(6000); // let the detail list + carousel render (matches harvest.ts)
  let html = await page.content();
  if (!html.includes("object-detail__data-term")) {
    await sleep(4000);
    html = await page.content();
  }
  if (!html.includes("object-detail__data-term")) return null; // CF/empty — retry next run
  return mapFields(await parseDetails(page));
}

function needsEnrich(a) {
  return !(a.material && a.date_text && a.description);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(ARTIFACTS, "utf8"));
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled", "--test-type",
           "--hide-crash-restore-bubble", "--no-sandbox"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  try {
    await warm(page);

    if (DUMP) {
      const fields = await fetchObject(page, DUMP);
      if (!fields) { console.log(`No detail fields for ${DUMP} (Cloudflare/empty).`); return; }
      console.log("=== mapped (what would be written) ===");
      console.log(JSON.stringify(fields, null, 2));
      return;
    }

    let todo = data.filter((a) => needsEnrich(a) && a.bm_id);
    if (LIMIT) todo = todo.slice(0, LIMIT);
    console.log(`${todo.length} objects still have blanks; processing${DRY ? " (dry run)" : ""}…`);

    const filled = { material: 0, date_text: 0, description: 0 };
    let noRecord = 0;
    for (let i = 0; i < todo.length; i++) {
      const a = todo[i];
      let fields = null;
      try {
        fields = await fetchObject(page, a.bm_id);
      } catch (e) {
        console.log(`  [${i + 1}/${todo.length}] ${a.bm_id}: ${e.message}`);
      }
      if (!fields) { noRecord++; }
      else {
        for (const f of ["material", "date_text", "description"]) {
          if (!a[f] && fields[f]) { a[f] = fields[f]; filled[f]++; }
        }
      }
      if ((i + 1) % 25 === 0) {
        console.log(`  …${i + 1}/${todo.length}  filled: ${JSON.stringify(filled)}  misses: ${noRecord}`);
        if (!DRY) fs.writeFileSync(ARTIFACTS, JSON.stringify(data, null, 1));
      }
      await sleep(1200); // polite throttle
    }

    console.log(`\nDone. Filled: ${JSON.stringify(filled)}. No record for ${noRecord}.`);
    if (DRY) console.log("Dry run — artifacts.json NOT written.");
    else { fs.writeFileSync(ARTIFACTS, JSON.stringify(data, null, 1)); console.log(`Wrote ${ARTIFACTS}`); }
  } finally {
    await ctx.close();
  }
}

main().catch((e) => { console.error("[fatal]", e); process.exit(1); });
