"""保存期限清理（NFR-8）：每天跑一次，刪掉到期的錄音、逐字稿、沒送出的紀錄與 7 天前的行程提案，期限見 app/services/privacy.py 與 app/services/itinerary_ai.py。

正式環境由 K8s CronJob `retention` 呼叫（deploy/helm/meddemo/templates/retention.yaml）；
本機要跑就在 backend 目錄執行 `uv run python -m app.jobs.retention`。
"""

import logging

from app.db import session_factory
from app.services.itinerary_ai import purge_proposals
from app.services.privacy import purge

log = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    with session_factory()() as session:
        result = purge(session)
        proposals = purge_proposals(session)
        session.commit()
    log.info(
        "保存期限清理完成：沒送出的紀錄 %d 筆、錄音 %d 段、逐字稿 %d 段；補做去識別 %d 段",
        result.unconfirmed_deleted,
        result.audio_deleted,
        result.transcripts_deleted,
        result.transcripts_deidentified,
    )
    log.info("跟熊熊滾說要怎麼排的提案：刪掉 %d 筆超過 7 天的", proposals)


if __name__ == "__main__":
    main()
