"""Command line interface.

python -m jev_rag ingest ./sample_docs --index index.json
python -m jev_rag ask "有休の繰り越し上限は？" --index index.json
python -m jev_rag serve --index index.json   # requires fastapi + uvicorn
"""

import argparse
import sys

from .config import Settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jev_rag")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser(
        "ingest", help="build the index from a folder of documents"
    )
    p_ingest.add_argument("docs_dir")
    p_ingest.add_argument("--index", default="index.json")

    p_ask = sub.add_parser("ask", help="ask a question")
    p_ask.add_argument("query")
    p_ask.add_argument("--index", default="index.json")
    p_ask.add_argument("--groups", default="", help="comma separated user groups")

    p_serve = sub.add_parser("serve", help="start the HTTP API")
    p_serve.add_argument("--index", default="index.json")
    p_serve.add_argument("--host", default="127.0.0.1")
    p_serve.add_argument("--port", type=int, default=8000)

    args = parser.parse_args(argv)
    settings = Settings.from_env()

    if args.command == "ingest":
        from .app import build_index

        index = build_index(args.docs_dir, args.index, settings)
        print(f"indexed {len(index.chunks)} chunks -> {args.index}")
        return 0

    if args.command == "ask":
        from .app import load_pipeline

        pipeline = load_pipeline(args.index, settings)
        groups = [g for g in args.groups.split(",") if g] or None
        answer = pipeline.ask(args.query, user_groups=groups)
        print(answer.text)
        if answer.citations:
            print("\n参照:")
            for i, c in enumerate(answer.citations, 1):
                print(f"  [{i}] {c.doc_title} > {c.heading}  ({c.doc_id})")
        for claim in answer.unsupported_claims:
            print(f"\n⚠️ 根拠を確認できなかった文: {claim.text}")
        print(
            f"\n[{answer.status}] {answer.total_ms:.0f} ms / "
            f"Jev {answer.jev_calls} calls / LLM {answer.llm_tokens} tokens",
            file=sys.stderr,
        )
        return 0

    if args.command == "serve":
        import uvicorn

        from .server import create_app

        uvicorn.run(create_app(args.index, settings), host=args.host, port=args.port)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
