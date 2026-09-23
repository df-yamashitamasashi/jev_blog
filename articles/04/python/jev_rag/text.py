"""Lightweight Japanese text utilities (no morphological analyzer required)."""

import re
import unicodedata

# Katakana (U+30A0-U+30FF) and CJK ideographs (U+3400-U+9FFF)
_JA_CONTENT = f"{chr(0x30A0)}-{chr(0x30FF)}{chr(0x3400)}-{chr(0x9FFF)}"
_CONTENT_RUNS = re.compile(rf"[a-z0-9]+|[{_JA_CONTENT}]+")
_QUESTION_PHRASES = re.compile(
    r"(について|を?教えてください|教えて|ですか|ますか|でしょうか|何日|何回|何時間"
    r"|いくら|どのくらい|どれくらい|ください|とは|方法)"
)
_CITATION = re.compile(r"\s*[\[［]\d+(?:\s*[,，、]\s*\d+)*[\]］]")
_TOPIC_SEPARATORS = re.compile(r"と|及び|および|並びに|、|,|\bvs\b", re.IGNORECASE)


def normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower()


def tokens(text: str, strip_question: bool = False) -> list[str]:
    """ASCII words as-is, Kanji/Katakana runs as character bigrams.

    Hiragana (particles, okurigana) is ignored so that matching focuses on
    content words.
    """
    t = normalize(text)
    if strip_question:
        t = _QUESTION_PHRASES.sub(" ", t)
    out: list[str] = []
    for run in _CONTENT_RUNS.findall(t):
        if run.isascii():
            out.append(run)
        elif len(run) >= 2:
            out.extend(run[i : i + 2] for i in range(len(run) - 1))
    return out


def split_sentences(text: str) -> list[str]:
    """Split generated text into sentences (claims) and drop citation markers."""
    parts = re.split(r"(?<=[。！？!?])|\n+", text)
    sentences = []
    for p in parts:
        s = _CITATION.sub("", p).strip().lstrip("-・*　 ").strip()
        if len(s) > 5:
            sentences.append(s)
    return sentences


def split_topics(query: str) -> list[str]:
    """Split a compound query ("AとBの違いは？") into topic phrases."""
    parts = _TOPIC_SEPARATORS.split(query)
    return [p.strip() for p in parts if len(tokens(p, strip_question=True)) >= 2]
