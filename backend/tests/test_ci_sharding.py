from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.run_test_shard import select_shard


def test_shards_cover_every_test_once_and_keep_files_and_order_together():
    items = [SimpleNamespace(path=Path(name), nodeid=f"{name}::{index}")
             for name, count in (("a.py", 7), ("b.py", 5), ("c.py", 3), ("d.py", 1))
             for index in range(count)]
    shards = [select_shard(items, index, 2) for index in (1, 2)]
    assert sorted(item.nodeid for shard in shards for item in shard) == sorted(item.nodeid for item in items)
    assert not {item.nodeid for item in shards[0]} & {item.nodeid for item in shards[1]}
    for name in {item.path for item in items}:
        assert sum(any(item.path == name for item in shard) for shard in shards) == 1
    for shard in shards:
        assert shard == [item for item in items if item in shard]
    assert [len(shard) for shard in shards] == [8, 8]
    assert shards == [select_shard(list(items), index, 2) for index in (1, 2)]


@pytest.mark.parametrize("shard,total", [(0, 2), (3, 2), (1, 0)])
def test_invalid_shard_is_rejected(shard, total):
    with pytest.raises(ValueError):
        select_shard([], shard, total)
