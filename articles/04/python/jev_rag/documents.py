"""Load documents from a folder and split them into heading-aware chunks."""

import re
from dataclasses import dataclass, field
from pathlib import Path

SUPPORTED_SUFFIXES = {".md", ".markdown", ".txt", ".pdf"}


@dataclass
class Document:
    id: str  # path relative to the docs root
    title: str
    text: str
    category: str = "general"
    access: list[str] = field(default_factory=lambda: ["all"])


@dataclass
class Chunk:
    id: str
    doc_id: str
    doc_title: str
    heading: str
    text: str
    category: str = "general"
    access: list[str] = field(default_factory=lambda: ["all"])

    @property
    def display_text(self) -> str:
        """Text given to Jev / the LLM: title and heading give each chunk context."""
        location = (
            f"{self.doc_title} > {self.heading}" if self.heading else self.doc_title
        )
        return f"【{location}】\n{self.text}"

    def visible_to(self, user_groups: list[str] | None) -> bool:
        if "all" in self.access:
            return True
        return bool(user_groups) and any(g in self.access for g in user_groups)


def parse_front_matter(raw: str) -> tuple[dict[str, object], str]:
    """Minimal YAML front matter: `key: value` and `key: [a, b]`."""
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw
    meta: dict[str, object] = {}
    for line in raw[3:end].strip().splitlines():
        if ":" not in line:
            continue
        key, value = (s.strip() for s in line.split(":", 1))
        if value.startswith("[") and value.endswith("]"):
            meta[key] = [v.strip() for v in value[1:-1].split(",") if v.strip()]
        else:
            meta[key] = value.strip("'\"")
    return meta, raw[end + 4 :].lstrip("\n")


def _read_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as e:  # pragma: no cover - optional dependency
        raise RuntimeError("PDF support requires `pip install pypdf`") from e
    return "\n\n".join(page.extract_text() or "" for page in PdfReader(path).pages)


def load_documents(root: str | Path) -> list[Document]:
    root = Path(root)
    docs = []
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() not in SUPPORTED_SUFFIXES or not path.is_file():
            continue
        if path.name.lower() == "readme.md":
            continue
        raw = (
            _read_pdf(path)
            if path.suffix.lower() == ".pdf"
            else path.read_text(encoding="utf-8")
        )
        meta, body = parse_front_matter(raw)
        heading = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
        access = meta.get("access", ["all"])
        docs.append(
            Document(
                id=path.relative_to(root).as_posix(),
                title=str(
                    meta.get("title") or (heading.group(1) if heading else path.stem)
                ),
                text=body,
                category=str(meta.get("category", "general")),
                access=access if isinstance(access, list) else [str(access)],
            )
        )
    return docs


def _split_long(text: str, max_chars: int) -> list[str]:
    """Split on sentence boundaries, carrying one sentence over as overlap."""
    sentences = [s for s in re.split(r"(?<=[。！？])", text) if s.strip()]
    parts: list[str] = []
    current: list[str] = []
    for s in sentences:
        if current and len("".join(current)) + len(s) > max_chars:
            parts.append("".join(current).strip())
            current = [current[-1]]
        current.append(s)
    if current:
        parts.append("".join(current).strip())
    return parts


def chunk_document(doc: Document, max_chars: int = 400) -> list[Chunk]:
    """Split by Markdown headings (#, ##, ###); long sections by sentences."""
    sections: list[tuple[str, str]] = []
    headings: dict[int, str] = {}  # level -> heading text (H1 is the doc title)
    buffer: list[str] = []

    def flush():
        body = "\n".join(buffer).strip()
        if body:
            path = [headings[lv] for lv in (2, 3) if lv in headings]
            sections.append((" > ".join(path), body))
        buffer.clear()

    for line in doc.text.splitlines():
        m = re.match(r"^(#{1,3})\s+(.+)$", line)
        if m:
            flush()
            level = len(m.group(1))
            headings = {lv: h for lv, h in headings.items() if lv < level}
            headings[level] = m.group(2).strip()
        else:
            buffer.append(line)
    flush()

    chunks = []
    for heading, body in sections:
        for part in _split_long(body, max_chars) if len(body) > max_chars else [body]:
            chunks.append(
                Chunk(
                    id=f"{doc.id}#{len(chunks) + 1}",
                    doc_id=doc.id,
                    doc_title=doc.title,
                    heading=heading,
                    text=part,
                    category=doc.category,
                    access=list(doc.access),
                )
            )
    return chunks
