"""預先為已確認的型錄照片建立 embedding-2 索引；增量重跑只處理變動圖片。"""

from __future__ import annotations

import argparse
import gzip
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sys

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.embeddings import IMAGES_PER_REQUEST, get_embedder
from app.services.product_appearance import INDEX_PATH, INDEX_VERSION, MANIFEST_PATH, ROOT, embedding_model, manifest_digest, unit_vector


def read_cache(path: Path) -> dict:
    if not path.is_file():
        return {}
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        data = json.load(stream)
    return data if data.get("version") == INDEX_VERSION and data.get("model") == embedding_model() else {}


def write_index(path: Path, data: dict) -> None:
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as stream:
            stream.write(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode())
    temporary.replace(path)


def png_media(path: Path) -> tuple[bytes, str]:
    # embedding-2 收 PNG/JPEG；型錄的 WebP 先轉成白底 PNG。
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        canvas = Image.new("RGBA", rgba.size, "white")
        canvas.alpha_composite(rgba)
        output = BytesIO()
        canvas.convert("RGB").save(output, format="PNG")
    return output.getvalue(), "image/png"


def build_index(output: Path = INDEX_PATH, *, refresh: bool = False) -> dict:
    manifest_bytes = MANIFEST_PATH.read_bytes()
    manifest = json.loads(manifest_bytes)
    checkpoint = output.with_name(output.name + ".partial")
    cache = {} if refresh else {**read_cache(output).get("sources", {}), **read_cache(checkpoint).get("sources", {})}
    source_ids = sorted({mapping["source"] for mapping in manifest["products"].values() if mapping["kind"] in ("exact", "series")})
    data = {"version": INDEX_VERSION, "model": embedding_model(), "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(), "complete": False, "sources": {}}
    pending = []
    for key in source_ids:
        source = manifest["sources"][key]
        path = (ROOT / "frontend/public" / source["file"].lstrip("/")).resolve()
        if not path.is_relative_to((ROOT / "frontend/public/product-photos").resolve()):
            raise ValueError("照片路徑不在型錄目錄")
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        previous = cache.get(key)
        if previous and previous["sha256"] == checksum:
            unit_vector(previous["vector"])
            data["sources"][key] = previous
        else:
            pending.append((key, path, checksum))
    print(f"照片 {len(source_ids)} 張，沿用 {len(data['sources'])} 張，待建立 {len(pending)} 張", flush=True)
    embedder = get_embedder() if pending else None
    for start in range(0, len(pending), IMAGES_PER_REQUEST):
        batch = pending[start : start + IMAGES_PER_REQUEST]
        vectors = embedder.embed_media([png_media(path) for _, path, _ in batch])
        for (key, _, checksum), vector in zip(batch, vectors, strict=True):
            data["sources"][key] = {"sha256": checksum, "vector": [round(value, 8) for value in unit_vector(vector)]}
        write_index(checkpoint, data)
        print(f"已建立 {len(data['sources'])}/{len(source_ids)} 張", flush=True)
    dimensions = {len(source["vector"]) for source in data["sources"].values()}
    if len(dimensions) != 1:
        raise ValueError("向量維度不一致，不取代既有索引")
    if manifest_digest(MANIFEST_PATH) != data["manifest_sha256"]:
        raise ValueError("建立向量期間照片對應表已變更；保留既有索引，請重跑以接續更新")
    data["complete"] = True
    write_index(output, data)
    checkpoint.unlink(missing_ok=True)
    return {"photos": len(source_ids), "embedded": len(pending), "dimension": dimensions.pop()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="全部重新計算向量")
    args = parser.parse_args()
    print(json.dumps(build_index(refresh=args.refresh), ensure_ascii=False))
