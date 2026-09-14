"""不連網路的 Gemini 用戶端：用真的 SDK 組請求，只把最後送出 HTTP 的那一步換掉。

測的是 SDK 實際要送給 Gemini 的內容（路徑、欄位名稱、格式），又不會真的呼叫、花到錢。
"""

import json

from google import genai


class CannedResponse:
    def __init__(self, body):
        self.body = json.dumps(body)
        self.headers = {}


def offline_client(monkeypatch, *responses):
    """回傳 (用戶端, 送出的請求清單)；每送出一個請求，就照順序回一個 responses 裡寫好的內容。"""
    client = genai.Client(api_key="test-key")
    sent = []
    queue = list(responses)

    def request(http_method, path, request_dict, http_options=None):
        sent.append({"path": path, "body": request_dict})
        return CannedResponse(queue.pop(0))

    monkeypatch.setattr(client._api_client, "request", request)
    return client, sent


def text_reply(text, finish="STOP"):
    return {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": finish}]}
