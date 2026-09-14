"""AI 模型（SDD 的 LLMClient）。服務層只依賴 LLM 這個介面（json／ajson／atext），不直接依賴特定供應商。"""

import json
from typing import Any, Protocol

from google import genai
from google.genai import types
from jsonschema import Draft202012Validator

from app.config import NotConfigured, settings

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
# Gemini 結構化輸出只支援 JSON Schema 的一部分（ai.google.dev/gemini-api/docs/structured-output 列出的關鍵字）。
# 送出前只留這些，回來之後再用完整的 schema 在本機驗證，規則一條都不少
SUPPORTED_KEYS = {
    "type", "enum", "description", "title", "properties", "required", "additionalProperties",
    "items", "minItems", "maxItems", "minimum", "maximum", "format", "anyOf",
}
# 單次請求最多等 60 秒（SDK 的單位是毫秒）。2026-09-14 實測 14 次呼叫最慢 23.6 秒（high 推理整理最終答案），
# 留兩倍多餘裕；逾時也算暫時性錯誤會重試，三次加起來約 3 分鐘，跟 RQ 預設的整個工作上限 180 秒差不多
REQUEST_TIMEOUT_MS = 60_000
# 429（用量上限）、5xx（模型忙線）這類暫時性錯誤最多重試兩次，跟換成 Gemini 之前 Anthropic SDK 的預設一樣；
# 這個 SDK 不設定就完全不重試
RETRY_ATTEMPTS = 3


class LLM(Protocol):
    # effort 是推理強度 low／medium／high，對到 Gemini 的 thinking_level
    def json(self, *, system: str, prompt: str, schema: dict[str, Any], effort: str = "medium") -> dict[str, Any]: ...

    async def ajson(
        self, *, system: str, prompt: str, schema: dict[str, Any], effort: str = "medium"
    ) -> dict[str, Any]: ...

    async def atext(self, *, system: str, prompt: str, effort: str = "medium") -> str: ...


class LLMOutputError(RuntimeError):
    """模型的輸出不能用：拒答、被截斷，或格式不符。"""


def api_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """只留 Gemini 支援的關鍵字。properties 底下是欄位名稱不是關鍵字，要逐欄往下處理。"""
    node = {key: value for key, value in schema.items() if key in SUPPORTED_KEYS}
    if "properties" in node:
        node["properties"] = {key: api_schema(value) for key, value in node["properties"].items()}
    if isinstance(node.get("items"), dict):
        node["items"] = api_schema(node["items"])
    if "anyOf" in node:
        node["anyOf"] = [api_schema(branch) for branch in node["anyOf"]]
    return node


def check_output(schema: dict[str, Any], data: Any) -> None:
    validator = Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)
    if errors := [error.message for error in validator.iter_errors(data)]:
        raise LLMOutputError("AI 模型的輸出格式不符：" + "；".join(errors[:3]))


class GeminiLLM:
    def __init__(self, api_key: str, model: str):
        # 金鑰沒填就交給 SDK 自己找（GEMINI_API_KEY 或 GOOGLE_API_KEY 環境變數）
        self.client = genai.Client(
            api_key=api_key or None,
            http_options=types.HttpOptions(
                timeout=REQUEST_TIMEOUT_MS, retry_options=types.HttpRetryOptions(attempts=RETRY_ATTEMPTS)
            ),
        )
        self.model = model

    def _config(self, system: str, effort: str, schema: dict[str, Any] | None = None) -> types.GenerateContentConfig:
        # 不設 max_output_tokens：這個上限連思考用的 token 一起算，設低了 high 推理容易被截斷；真的截斷會在下面擋掉
        return types.GenerateContentConfig(
            # 空字串（grader／rewriter 目前的呼叫方式，整段提示都放在 prompt）換成 None：
            # 沒實測過 Gemini API 對空字串 system instruction 的反應，但有回 400 的風險，
            # 不送這個欄位比較保險
            system_instruction=system or None,
            response_mime_type="application/json" if schema is not None else None,
            response_json_schema=api_schema(schema) if schema is not None else None,
            thinking_config=types.ThinkingConfig(thinking_level=effort),
            # 沒給模型任何函式；不關掉的話 SDK 照樣走自動函式呼叫的流程，還會在 log 印一條誤導的警告
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )

    def _parse_json(self, response: types.GenerateContentResponse, schema: dict[str, Any]) -> dict[str, Any]:
        if response.prompt_feedback and response.prompt_feedback.block_reason:
            raise LLMOutputError(f"AI 模型拒絕處理這個請求（{response.prompt_feedback.block_reason.value}）")
        finish = response.candidates[0].finish_reason if response.candidates else None
        if finish == types.FinishReason.MAX_TOKENS:
            raise LLMOutputError("AI 模型的回應被截斷")
        if finish != types.FinishReason.STOP or not response.text:
            # SAFETY、RECITATION 這類：模型沒有正常寫完
            raise LLMOutputError(f"AI 模型沒有正常產生回應（{finish.value if finish else '沒有候選回應'}）")
        data = json.loads(response.text)
        check_output(schema, data)
        return data

    def json(self, *, system: str, prompt: str, schema: dict[str, Any], effort: str = "medium") -> dict[str, Any]:
        response = self.client.models.generate_content(
            model=self.model, contents=prompt, config=self._config(system, effort, schema)
        )
        return self._parse_json(response, schema)

    async def ajson(
        self, *, system: str, prompt: str, schema: dict[str, Any], effort: str = "medium"
    ) -> dict[str, Any]:
        response = await self.client.aio.models.generate_content(
            model=self.model, contents=prompt, config=self._config(system, effort, schema)
        )
        return self._parse_json(response, schema)

    async def atext(self, *, system: str, prompt: str, effort: str = "medium") -> str:
        response = await self.client.aio.models.generate_content(
            model=self.model, contents=prompt, config=self._config(system, effort)
        )
        # 被擋或沒有候選回應就回空字串，呼叫端當成答不出來（照搬 CARE answer_service：空回應＝拒答標記）
        if response.prompt_feedback and response.prompt_feedback.block_reason:
            return ""
        return response.text or ""


def get_llm() -> LLM:
    config = settings()
    if not config.llm_provider:
        raise NotConfigured("AI 模型還沒設定")
    if config.llm_provider == "gemini":
        return GeminiLLM(config.llm_api_key, config.llm_model or DEFAULT_GEMINI_MODEL)
    raise NotConfigured(f"還不支援這個 AI 模型供應商：{config.llm_provider}")
