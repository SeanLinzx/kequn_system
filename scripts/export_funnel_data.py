#!/usr/bin/env python3
"""从大道合原始数据导出 funnel.json，供 system 后端诊断 API 使用。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[2] / "分析案例-大道合"
sys.path.insert(0, str(BASE))

from build_insight_lab import compute_core, compute_daily_payload, load_data  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "data" / "stores" / "dadao-yintan"


def export_store(out_dir: Path, meta: dict) -> None:
    data = load_data()
    core = compute_core(data)
    payload = compute_daily_payload(data)
    out_dir.mkdir(parents=True, exist_ok=True)

    funnel = {
        "meta": meta,
        "base": {
            "capture": core["capture"],
            "conv": core["conv"],
            "aov": core["aov"],
            "rev_per_pass": core["rev_per_pass"],
        },
        "days": payload["days"],
        "daybuckets": payload.get("daybuckets", []),
        "dayhours": payload.get("dayhours", []),
        "lo": data["lo"].strftime("%Y-%m-%d"),
        "hi": data["hi"].strftime("%Y-%m-%d"),
    }
    (out_dir / "funnel.json").write_text(
        json.dumps(funnel, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Exported {out_dir / 'funnel.json'} ({len(funnel['days'])} days)")


if __name__ == "__main__":
    export_store(
        OUT,
        {
            "id": "dadao-yintan",
            "name": "长沙望城银杉路零食店",
            "isReal": True,
            "location": "长沙市望城区银杉路",
        },
    )
