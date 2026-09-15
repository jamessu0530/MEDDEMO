"""保存期限清理（NFR-8）：每天跑一次，刪掉到期的錄音、逐字稿與沒送出的紀錄，期限見 app/services/privacy.py。

正式環境由 K8s CronJob `retention` 呼叫（deploy/helm/meddemo/templates/retention.yaml）；
本機要跑就在 backend 目錄執行 `uv run python -m app.jobs.retention`。
"""

import logging

from app.db import session_factory
from app.services.privacy import purge

log = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    with session_factory()() as session:
        result = purge(session)
        session.commit()
    log.info(
        "保存期限清理完成：沒送出的紀錄 %d 筆、錄音 %d 段、逐字稿 %d 段；補做去識別 %d 段",
        result.unconfirmed_deleted,
        result.audio_deleted,
        result.transcripts_deleted,
        result.transcripts_deidentified,
    )


if __name__ == "__main__":
    main()
