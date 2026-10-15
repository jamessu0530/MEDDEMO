"""Keep the design gallery's conditions in sync with the actual server rules."""
import sys
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"backend"))
from app.services.achievement_catalog import MEDAL_NAMES, medal_details

records=[]
for kind in MEDAL_NAMES:
    thresholds=(1,3,5) if kind=="stores" else (1,2,3)
    for tier,need in enumerate(thresholds,1):
        records.append({"kind":kind,"tier":tier,"need":need,**medal_details(kind,tier,need)})
(ROOT/"design/medals/gallery/achievement-data.json").write_text(json.dumps(records,ensure_ascii=False,indent=2))
