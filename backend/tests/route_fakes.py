"""跟熊熊滾說要怎麼排的測試共用：假的 Gemini。"""


class FakeLLM:
    """照順序回寫好的操作清單，記下收到的提示；不連網路、不花錢。"""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts: list[str] = []

    def json(self, *, system, prompt, schema, effort="medium", media=()):
        self.prompts.append(prompt)
        return {"operations": self.replies.pop(0)}
