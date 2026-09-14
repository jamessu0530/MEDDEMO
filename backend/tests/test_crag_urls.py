"""urls.normalize_url 的測試。

照搬 CARE `tests/unit/services/rag/test_web_whitelist.py` 裡跟 `normalize_url`
有關的部分（task-7-brief.md）。CARE 原檔把「正規化」與「白名單比對」耦在一起，
MEDDEMO 網搜不限網站（James 2026-09-14），不搬白名單，所以下面全部改成直接呼叫
`urls.normalize_url()`，不再透過 `UrlPolicy(allowed_suffixes=...)` 建構子注入。

不搬的測試與原因：
- `test_is_allowed_url_accepts_whitelist_domains`：整個測的是 `is_allowed_url`
  對白名單網域的判斷，MEDDEMO 沒有白名單，不適用。
- `test_is_allowed_url_rejects_non_whitelist` 裡「URL 格式合法但不在白名單」
  的案例（`https://www.google.com/...`、`https://example.com/`、
  `https://gov.tw.evil.com/`、`https://notgov.tw.example.com/`、
  `https://evilgov.tw/`）：測的是白名單標籤邊界比對，不是 `normalize_url`
  本身的行為（這幾個 URL 正規化都會成功），不搬。其餘「格式錯誤」的案例
  （反斜線、控制字元、百分比編碼、userinfo、IDN、host 正字集…）其實是
  `_normalize_url` 本身回傳 `None` 的行為，改寫進下面的
  `test_normalize_url_rejects_malformed`。
- `test_with_whitelist_site_filter_appends_gov_tw`：測 `with_whitelist_site_filter`
  （網搜 site: 篩選），不搬。
- `test_parse_allowed_suffixes_collapses_redundant`、
  `test_parse_allowed_suffixes_empty_returns_default`：測
  `parse_allowed_suffixes`，屬白名單設定解析，不搬。
- `test_assert_allowed_urls_reports_all_invalid`、
  `test_assert_allowed_urls_returns_normalized`：測 `UrlPolicy.assert_allowed`／
  `assert_allowed_urls`，屬白名單斷言，不搬。
- `test_module_level_wrappers_delegate_to_default_policy`：原本同時驗
  `normalize_url` 與 `assert_allowed_urls` 兩個模組層薄包裝；`assert_allowed_urls`
  不搬，只留 `normalize_url` 那半，改名為
  `test_normalize_url_works_without_policy_injection`。
"""

import pytest

from app.services.crag.urls import normalize_url

NORMALIZE_TABLE = [
    ("www.hpa.gov.tw/x", "https://www.hpa.gov.tw/x"),
    ("HTTP://WWW.HPA.GOV.TW/X", "http://www.hpa.gov.tw/X"),
    ("https://hpa.gov.tw./x", "https://hpa.gov.tw/x"),
    ("https://hpa.gov.tw:443/x", "https://hpa.gov.tw/x"),
    ("https://hpa.gov.tw/x#sec", "https://hpa.gov.tw/x"),
    ("https://hpa.gov.tw/x?utm_source=line&nodeid=1", "https://hpa.gov.tw/x?nodeid=1"),
    ("https://hpa.gov.tw", "https://hpa.gov.tw/"),
    ("https://hpa.gov.tw/x/", "https://hpa.gov.tw/x"),
]


@pytest.mark.parametrize("raw, expected", NORMALIZE_TABLE)
def test_normalize_url_matches_expected(raw, expected):
    assert normalize_url(raw) == expected


@pytest.mark.parametrize("raw, expected", NORMALIZE_TABLE)
def test_normalize_url_is_idempotent(raw, expected):
    once = normalize_url(raw)
    assert once == expected
    assert normalize_url(once) == once


def test_normalize_url_collapses_multiple_trailing_slashes():
    """code review Minor：/x// 只是多打一個斜線，應收斂成 /x，不該被當成格式錯誤。"""
    assert normalize_url("https://hpa.gov.tw/x//") == "https://hpa.gov.tw/x"
    assert normalize_url("https://hpa.gov.tw///") == "https://hpa.gov.tw/"


@pytest.mark.parametrize(
    "raw",
    ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x"],
)
def test_normalize_url_returns_none_for_non_http_scheme(raw):
    assert normalize_url(raw) is None


@pytest.mark.parametrize(
    "url",
    [
        "not-a-url",
        "",
        "https://",
        # --- 反斜線：Python 的 urlsplit 把 '\' 當一般 host 字元放行，
        #     但 Node（Firecrawl 實際抓取用）與瀏覽器都把 '\' 當路徑分隔符。
        r"https://evil.com\.gov.tw/page",
        r"https://evil.com\@x.gov.tw/",
        # --- 百分比編碼：host 正字集不允許 '%'。
        "https://evil.com%5C.gov.tw/page",
        "https://hpa.gov.tw%2egov.tw/",
        "https://www.hpa.gov.tw%2f.evil.com/",
        # --- 控制字元與空白：urlsplit 會靜默刪除 tab／CR／LF，
        #     必須在剖析前就擋。
        "https://evil.com\t.gov.tw/x",
        "https://a.gov.tw\r\n.evil.com/",
        "https://www.hpa.gov.tw/a b",
        "https://evil.com\xa0.gov.tw/x",
        # --- userinfo：'@' 前後兩邊解析器對「誰是 host」意見不一致。
        "https://www.hpa.gov.tw@evil.com/x",
        "https://www.hpa.gov.tw:pass@evil.com/",
        "https://evil.com@www.hpa.gov.tw/x",
        # --- IDN／非 ASCII authority：一律拒絕。
        "https://evil.com。gov.tw/",
        "https://台灣.gov.tw/x",
        # --- host 正字集規則：DNS 上解析不到、Node／瀏覽器都拒絕剖析的字元。
        "https://evil.com<.gov.tw/x",
        "https://evil.com>.gov.tw/x",
        "https://evil.com^.gov.tw/x",
        "https://evil.com|.gov.tw/x",
        "https://.gov.tw/",  # 空標籤（開頭）
        "https://a..gov.tw/",  # 空標籤（中間）
        # --- host 至少要有一個 '.'：單標籤主機名不是公開網址。
        "https://localhost/x",
        "https://gov/x",
        "http://intranet:8080/x",
        # --- 控制字元放在 path（而非 host），釘住剖析前的控制字元檢查。
        "https://www.hpa.gov.tw/x\x00",
        "https://www.hpa.gov.tw/x\x7f",
    ],
)
def test_normalize_url_rejects_malformed(url):
    assert normalize_url(url) is None


def test_normalize_url_works_without_policy_injection():
    """`normalize_url` 是模組層薄包裝，不需要（也沒有）UrlPolicy 注入。"""
    assert normalize_url("www.hpa.gov.tw/x") == "https://www.hpa.gov.tw/x"
