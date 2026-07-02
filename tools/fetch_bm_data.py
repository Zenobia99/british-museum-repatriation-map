"""Rebuild BM dataset from local harvest cache instead of live SPARQL.

Point BM_HARVEST at your harvested_details.jsonl (produced by the harvest
run described in the README):

    BM_HARVEST=/path/to/harvested_details.jsonl python3 tools/fetch_bm_data.py
"""
import json
import os
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent  # repo root
HARVEST = Path(os.environ.get('BM_HARVEST', ''))
FINAL = BASE / 'bm_final_artifacts.json'


def main() -> None:
    if not os.environ.get('BM_HARVEST') or not HARVEST.exists():
        raise SystemExit('Set BM_HARVEST to the path of harvested_details.jsonl')

    harvested = {}
    for line in HARVEST.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        bid = rec.get('bm_id') or rec.get('id')
        if not bid:
            continue
        if bid not in harvested:
            harvested[bid] = rec
            continue
        prev = harvested[bid]
        for k in (
            'title',
            'objectType',
            'description',
            'origin',
            'date',
            'material',
            'imageUrl',
        ):
            cur = (rec.get(k) or '').strip()
            old = (prev.get(k) or '').strip()
            if len(cur) > len(old):
                prev[k] = cur
        if not prev.get('imageUrl') and rec.get('imageUrl'):
            prev['imageUrl'] = rec['imageUrl']

    print(f'Loaded {len(harvested)} harvested records')

    final_path = FINAL if FINAL.exists() else BASE / 'artifact_data.json'
    if not final_path.exists():
        raise SystemExit(f'Missing {final_path}')

    with final_path.open() as f:
        data = json.load(f)

    hero = {
        'GR_1816-0714-1': 'Elgin Marbles',
        'Y_EA24': 'Rosetta Stone',
        'Am1923-3': 'Benin Bronzes',
        'W_1928-1009-378': 'game-board',
        }

    def normalize_origin(val: str) -> str:
        raw = (val or '').strip()
        for prefix in (
            'Found/Acquired: ',
            'Excavated/Findspot: ',
            'Made in: ',
            'Published in: ',
        ):
            if raw.startswith(prefix):
                raw = raw[len(prefix):]
        for sep in ('Africa:', 'Asia:', 'Europe:', 'Americas:'):
            if sep in raw:
                raw = raw.split(sep, 1)[1].strip()
                break
        return raw or 'Unknown'

    updated = 0
    for art in data:
        bid = art.get('bm_id')
        if not bid:
            continue
        rec = harvested.get(bid)
        if not rec:
            continue
        title = (rec.get('title') or '').strip()
        otype = (rec.get('objectType') or '').strip()
        bad = {
            '',
            'unknown',
            'museum asset',
            "sorry we can't find that page...",
            'object',
            'artefact',
        }
        if bid in hero:
            art['name'] = hero[bid]
        elif title and title.lower() not in bad:
            art['name'] = title
        elif otype and otype.lower() not in bad:
            art['name'] = otype

        material = (rec.get('material') or '').strip()
        if material and material.lower() not in {'unknown', ''}:
            art['material'] = material

        origin = normalize_origin(rec.get('origin'))
        if origin and origin != 'Unknown':
            art['origin'] = origin

        date_raw = (rec.get('date') or '').strip()
        if date_raw and date_raw.lower() not in {'unknown', ''}:
            art['date_text'] = date_raw

        desc = (rec.get('description') or '').strip()
        if desc:
            art['description'] = desc

        img = (rec.get('imageUrl') or '').strip()
        if img:
            art['image_url'] = img
        updated += 1

    out = BASE / 'bm_final_artifacts.json'
    out.write_text(json.dumps(data, indent=2))
    print(f'Merged {updated} records -> {out}')
    override = {
        'Y_EA14931': {
            'name': 'tile',
            'origin': 'Tell el-Yahudiya, Egypt',
            'material': 'glazed composition',
            'date_text': 'c. 1175-1155 BC',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/16_9/29bc59b5_5a5a_4800_bf93_a3c6009c7ba9/mid_00993027_001.jpg',
            'description': 'Polychrome glazed composition tile with relief of Libyan prisoner. Face/right arm yellow-beige, left arm white, eye outlined in black.'
        },
        'Y_EA41077': {
            'name': 'anatomical votive',
            'origin': 'Deir el-Bahri, Thebes, Egypt',
            'material': 'wood',
            'date_text': 'New Kingdom',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2026_4/1_13/cb61b535_f89d_43fe_ac17_b41f00da6a63/mid_EA41078.jpg'
        },
        'Y_EA1000': {
            'name': 'base',
            'origin': 'Amarna, Egypt',
            'material': 'granite',
            'date_text': '18th Dynasty',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/1_6/24cfc18c_76b8_4ba3_b3a8_a3b7006f71f6/mid_00033229_001.jpg'
        },
        'Y_EA2295': {
            'name': 'figure',
            'origin': 'Egypt',
            'material': 'limestone',
            'date_text': '12th Dynasty',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/2_21/bc17f1c7_868c_4e68_8707_a3b80164cb43/mid_00335990_001.jpg'
        },
        'Y_EA137': {
            'name': 'figure',
            'origin': 'Upper Egypt (historic)',
            'material': 'granite',
            'date_text': '19th Dynasty',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_11/6_14/114cc417_8daa_48fa_bc73_a3db00ea45c9/mid_01243810_001.jpg'
        },
        'Y_EA47971': {
            'name': 'floor; graffito',
            'origin': 'Temple of Mentuhotep, Deir el-Bahri, Thebes, Egypt',
            'material': 'sandstone',
            'date_text': '11th Dynasty',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2025_5/21_13/c71a2d0f_3543_4b3f_acd4_b2e400d6544e/mid_EA47972__1_.jpg'
        },
        'Y_EA9953-B2': {
            'name': 'papyrus',
            'origin': 'Egypt',
            'material': 'papyrus',
            'date_text': 'New Kingdom',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/16_7/f812f83b_2ed4_491a_9f33_a3c6007521fe/mid_00981191_001.jpg'
        },
        'Y_EA2436': {
            'name': 'relief',
            'origin': 'Egypt',
            'material': 'limestone',
            'date_text': 'Ancient Egypt',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_11/10_17/f8d75c6c_c4db_455a_880c_a3df01207999/mid_01529884_001.jpg'
        },
        'Y_EA65453': {
            'name': 'relief; trial-piece',
            'origin': 'Egypt',
            'material': 'limestone',
            'date_text': 'Old Kingdom',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2018_9/25_10/87cc6548_d4a7_4265_a1fb_a96600a903a6/mid_65454a.jpg'
        },
        'W_EPH-ME-9097': {
            'name': 'print; newspaper/periodical',
            'origin': 'London, England',
            'material': 'paper',
            'date_text': '8 February 1890',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/2_13/a5c13e51_90f2_48d4_9a8c_a3b800ee79d6/mid_00030018_001.jpg'
        },
        'W_EPH-ME-6714': {
            'name': 'postcard',
            'origin': 'Unknown',
            'material': 'paper',
            'date_text': '20thC',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/2_13/a5c13e51_90f2_48d4_9a8c_a3b800ee79d6/mid_00030018_001.jpg'
        },
        'W_EPH-ME-9350': {
            'name': 'print',
            'origin': 'London, England',
            'material': 'paper',
            'date_text': '26 September 1874',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/2_13/a5c13e51_90f2_48d4_9a8c_a3b800ee79d6/mid_00030018_001.jpg'
        },
        'A_2017-3066-1': {
        'name': 'Key to the Highway (Rosetta Stone)',
        'origin': 'Cincinnati, USA',
        'material': 'etching, aquatint, and lithograph on paper',
        'date_text': '1995',
        'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/2_13/a5c13e51_90f2_48d4_9a8c_a3b800ee79d6/mid_00030018_001.jpg',
        'description': 'Shop Proof II/II. Intaglio and silkscreen.'
        },
        'A_2017-3066-2': {
        'name': 'Key to the Highway (Rosetta Stone)',
        'origin': 'Cincinnati, USA',
        'material': 'etching, aquatint, and lithograph on paper',
        'date_text': '1995',
        'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/2_13/a5c13e51_90f2_48d4_9a8c_a3b800ee79d6/mid_00030018_001.jpg',
        'description': 'Edition number 25/64. Intaglio and silkscreen.'
        },
        'Y_EA90844-abc': {
            'name': 'cast; stela',
            'origin': 'Unknown',
            'material': 'plaster',
            'date_text': 'Unknown',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/2_13/a5c13e51_90f2_48d4_9a8c_a3b800ee79d6/mid_00030018_001.jpg'
        },
        'Y_EA10303': {
            'name': 'papyrus',
            'origin': 'Egypt, probably Thebes',
            'material': 'papyrus',
            'date_text': 'Roman Period',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_10/16_16/5cfbe18f_224b_49de_ab6c_a3c6010d2bc4/mid_01026042_001.jpg'
        },
        'Y_EA13714': {
            'name': 'inlay',
            'origin': 'Egypt',
            'material': 'glazed composition',
            'date_text': 'Ramesside',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_11/2_12/3793e50b_b15b_40bf_bb1e_a3e000cc57d4/mid_01632731_001.jpg'
        },
        'Y_EA65224': {
            'name': 'relief',
            'origin': 'Egypt',
            'material': 'limestone',
            'date_text': 'New Kingdom',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2014_11/12_11/cf5618f3_452b_4b3e_8e2b_a3e0011b2cb3/mid_01633519_001.jpg'
        },
        'A_2011-3040-2': {
            'name': 'illustrated book; manga; print',
            'origin': 'London, England',
            'material': 'paper',
            'date_text': '2011',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2015_5/12_11/14557e2a_2878_4d4b_b9cf_a49600c12688/preview_JCF24435.jpg'
        },
        'A_2011-3040-1-1': {
            'name': 'illustrated book; manga; print',
            'origin': 'Tokyo, Japan',
            'material': 'paper',
            'date_text': 'Heisei Era',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2015_5/12_11/14557e2a_2878_4d4b_b9cf_a49600c12688/preview_JCF24435.jpg'
        },
        'A_2011-3040-1-2': {
            'name': 'illustrated book; manga; print',
            'origin': 'Tokyo, Japan',
            'material': 'paper',
            'date_text': 'Heisei Era',
            'image_url': 'https://media.britishmuseum.org/media/Repository/Documents/2015_5/12_11/14557e2a_2878_4d4b_b9cf_a49600c12688/preview_JCF24435.jpg'
        }
        }
    override_count = 0
    for art in data:
        bid = art.get('bm_id')
        if bid in override:
            art.update(override[bid])
            override_count += 1
    if override_count:
        out.write_text(json.dumps(data, indent=2))
        print(f'Applied {override_count} explicit overrides')
        for art in data:
            if art.get('bm_id') == 'Y_EA14931':
                print('EA14931 now:', art['name'], '|', art['origin'], '|', art.get('date_text'), '|', art['material'])
                break
    print(f'Records with date_text: {sum(1 for d in data if d.get("date_text"))}')
    print('Sample:')
    for art in data[:8]:
        print(
            f"  {art['bm_id']}: {art['name']} | {art['origin']} | {art.get('date_text') or 'no date'} | {art['material']}"
        )


if __name__ == '__main__':
    main()
