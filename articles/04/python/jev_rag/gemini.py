"""Gemini adapters: answer generation (System Two) and embeddings.

Swap these for any other provider by implementing `Generator` / `Embedder`.
"""

from dataclasses import dataclass
from typing import Any, Protocol

SYSTEM_PROMPT = """あなたは社内ヘルプデスクのアシスタントです。
次のルールを必ず守って、日本語で簡潔に回答してください。
- 【資料】に書かれている内容だけを根拠にする。推測や一般常識で補わない。
- 文の末尾に、根拠にした資料の番号を [1] のように付ける。
- 資料に答えが書かれていない部分は「資料に記載がありません」と書く。
- 箇条書きや見出しは使わず、3文以内でまとめる。"""


@dataclass
class Generation:
    text: str
    input_tokens: int
    output_tokens: int
    model: str


class Generator(Protocol):
    def generate(self, query: str, sources: list[str]) -> Generation: ...


def build_prompt(query: str, sources: list[str]) -> str:
    numbered = "\n\n".join(f"[{i}] {s}" for i, s in enumerate(sources, 1))
    return f"【資料】\n{numbered}\n\n【質問】\n{query}"


class GeminiGenerator:
    def __init__(
        self, model: str, client: Any = None, system_prompt: str = SYSTEM_PROMPT
    ):
        from google import genai

        self.client = client or genai.Client()
        self.model = model
        self.system_prompt = system_prompt

    def generate(self, query: str, sources: list[str]) -> Generation:
        from google.genai import types

        resp = self.client.models.generate_content(
            model=self.model,
            contents=build_prompt(query, sources),
            config=types.GenerateContentConfig(
                system_instruction=self.system_prompt,
                temperature=0.0,
                seed=0,
                max_output_tokens=1024,
                thinking_config=types.ThinkingConfig(thinking_level="low"),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
            ),
        )
        usage = resp.usage_metadata
        return Generation(
            text=(resp.text or "").strip(),
            input_tokens=getattr(usage, "prompt_token_count", 0) or 0,
            output_tokens=(getattr(usage, "candidates_token_count", 0) or 0)
            + (getattr(usage, "thoughts_token_count", 0) or 0),
            model=getattr(resp, "model_version", None) or self.model,
        )


class GeminiEmbedder:
    def __init__(self, model: str, dimensions: int = 768, client: Any = None):
        from google import genai

        self.client = client or genai.Client()
        self.model = model
        self.dimensions = dimensions

    def embed(self, texts: list[str], kind: str) -> list[list[float]]:
        from google.genai import types

        task = "RETRIEVAL_DOCUMENT" if kind == "document" else "RETRIEVAL_QUERY"
        # One Content per text: gemini-embedding-2 merges a plain list of strings
        # into a single (multimodal) embedding.
        resp = self.client.models.embed_content(
            model=self.model,
            contents=[types.Content(parts=[types.Part(text=t)]) for t in texts],
            config=types.EmbedContentConfig(
                task_type=task, output_dimensionality=self.dimensions
            ),
        )
        if len(resp.embeddings) != len(texts):
            raise RuntimeError(
                f"expected {len(texts)} embeddings, got {len(resp.embeddings)}"
            )
        return [list(e.values) for e in resp.embeddings]
