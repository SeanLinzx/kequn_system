#!/usr/bin/env python3
"""基于大道合真实数据生成模拟门店 funnel.json + promo-context。"""

from __future__ import annotations

import json
import random
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "stores" / "dadao-yintan" / "funnel.json"
PROMO_SRC = (
    Path(__file__).resolve().parents[2]
    / "分析案例-大道合"
    / "example1"
    / "data"
    / "promo-context.json"
)

MOCK_STORES = [
    {
        "id": "mock-xiangjiang",
        "name": "长沙湘江路零食店（模拟）",
        "scale": 0.85,
        "isReal": False,
        "location": "长沙市天心区湘江中路",
    },
    {
        "id": "mock-meixi",
        "name": "长沙梅溪湖零食店（模拟·待评估）",
        "scale": 1.12,
        "isReal": False,
        "location": "长沙市岳麓区梅溪湖路",
    },
    {
        "id": "mock-lingdu-wuyi",
        "name": "长沙五一广场零食店（模拟）",
        "scale": 0.95,
        "isReal": False,
        "location": "长沙市五一广场",
    },
    {
        "id": "mock-lingdu-nanzhan",
        "name": "长沙高铁南站零食店（模拟）",
        "scale": 1.05,
        "isReal": False,
        "location": "长沙市高铁南站",
    },
    {
        "id": "mock-guomeijia-daxue",
        "name": "长沙岳麓大学城零食店（模拟）",
        "scale": 0.75,
        "isReal": False,
        "location": "长沙市岳麓大学城",
    },
]


def scale_int(v: int, factor: float, rng: random.Random) -> int:
    noise = rng.uniform(0.92, 1.08)
    return max(0, int(round(v * factor * noise)))


def scale_float(v: float, factor: float, rng: random.Random) -> float:
    noise = rng.uniform(0.95, 1.05)
    return round(v * factor * noise, 1)


def scale_funnel(src: dict, store: dict) -> dict:
    rng = random.Random(store["id"])
    f = store["scale"]
    out = deepcopy(src)
    out["meta"] = {
        "id": store["id"],
        "name": store["name"],
        "isReal": store["isReal"],
        "location": store["location"],
    }
    for key in ("days", "daybuckets", "dayhours"):
        for row in out.get(key, []):
            for fld in ("p", "e", "o"):
                if fld in row:
                    row[fld] = scale_int(row[fld], f, rng)
            if "s" in row:
                row["s"] = scale_float(row["s"], f, rng)
    # recompute base from scaled days
    days = out["days"]
    p = sum(d["p"] for d in days)
    e = sum(d["e"] for d in days)
    o = sum(d["o"] for d in days)
    s = sum(d["s"] for d in days)
    out["base"] = {
        "capture": e / p if p else 0,
        "conv": o / e if e else 0,
        "aov": s / o if o else 0,
        "rev_per_pass": s / p if p else 0,
    }
    return out


def seed_promo_context(store_id: str, store_name: str) -> None:
    if not PROMO_SRC.exists():
        return
    ctx = json.loads(PROMO_SRC.read_text(encoding="utf-8"))
    ctx["storeMeta"]["name"] = store_name
    out = ROOT / "data" / "stores" / store_id / "promo-context.json"
    out.write_text(json.dumps(ctx, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    if not SRC.exists():
        raise SystemExit("Run export_funnel_data.py first")
    src = json.loads(SRC.read_text(encoding="utf-8"))

    # copy promo-context for dadao
    seed_promo_context("dadao-yintan", "长沙望城银杉路零食店")

    for store in MOCK_STORES:
        out_dir = ROOT / "data" / "stores" / store["id"]
        out_dir.mkdir(parents=True, exist_ok=True)
        scaled = scale_funnel(src, store)
        (out_dir / "funnel.json").write_text(
            json.dumps(scaled, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        seed_promo_context(store["id"], store["name"])
        print(f"Seeded {store['id']}")


if __name__ == "__main__":
    main()
