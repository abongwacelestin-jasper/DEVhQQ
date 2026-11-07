"""Command line: ``devhq-models serve | train | synthetic``.

devhq-models serve --host 0.0.0.0 --port 8000
devhq-models train --model all --source synthetic
devhq-models train --model overdue --source file --path export.json
devhq-models train --model all --source backend      # pulls GET /api/insights/_export (signed)
devhq-models synthetic --out data/synthetic.json     # write the SYNTHETIC cold-start set
"""

from __future__ import annotations

import os

# Native thread pools must be capped before numpy/scikit-learn are imported.
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import argparse
import json
import logging
import sys
from pathlib import Path

import httpx

from .config import load_settings
from .features.schema import Dataset
from .registry.registry import MODEL_NAMES, ModelRegistry
from .registry.store import make_store
from .security.hmac_auth import signed_headers
from .training import pipeline
from .training.synthetic import generate

EXPORT_PATH = "/api/insights/_export"


def pull_backend_export(base_url: str, token: str) -> Dataset:
    """Fetch the feature export from the backend, signed with ML_SERVICE_TOKEN."""
    headers = signed_headers(token, "GET", EXPORT_PATH)
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(base_url.rstrip("/") + EXPORT_PATH, headers=headers)
    resp.raise_for_status()
    return Dataset.model_validate(resp.json())


def _load_dataset(args: argparse.Namespace) -> Dataset:
    if args.source == "synthetic":
        return generate(args.seed)
    if args.source == "file":
        if not args.path:
            raise SystemExit("--path is required with --source file")
        return Dataset.model_validate_json(Path(args.path).read_bytes())
    settings = load_settings()
    if not settings.backend_url or not settings.service_token:
        raise SystemExit("BACKEND_URL and ML_SERVICE_TOKEN are required with --source backend")
    return pull_backend_export(settings.backend_url, settings.service_token)


def cmd_train(args: argparse.Namespace) -> int:
    settings = load_settings()
    if not settings.registry_key:
        raise SystemExit("ML_SERVICE_TOKEN or MODEL_SIGNING_KEY is required to sign models")
    registry = ModelRegistry(make_store(settings.s3, settings.model_dir), settings.registry_key)
    ds = _load_dataset(args)
    names = list(MODEL_NAMES) if args.model == "all" else [args.model]
    ok = True
    for name in names:
        result = pipeline.run(name, ds, registry, seed=args.seed, promote=not args.no_promote)
        print(json.dumps(result, indent=2))
        ok = ok and bool(result["passed"])
    return 0 if ok else 2


def cmd_synthetic(args: argparse.Namespace) -> int:
    ds = generate(args.seed)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(ds.model_dump_json(by_alias=True))
    print(f"wrote SYNTHETIC dataset to {args.out}")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .api.app import create_app

    uvicorn.run(
        create_app(),
        host=args.host,
        port=args.port,
        proxy_headers=False,
        server_header=False,
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())
    parser = argparse.ArgumentParser(prog="devhq-models")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="run the HTTP service")
    serve.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    serve.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    serve.set_defaults(func=cmd_serve)

    train = sub.add_parser("train", help="train, evaluate and (if it passes) promote")
    train.add_argument("--model", choices=[*MODEL_NAMES, "all"], default="all")
    train.add_argument("--source", choices=["synthetic", "file", "backend"], default="synthetic")
    train.add_argument("--path")
    train.add_argument("--seed", type=int, default=7)
    train.add_argument("--no-promote", action="store_true")
    train.set_defaults(func=cmd_train)

    synth = sub.add_parser("synthetic", help="write the SYNTHETIC cold-start dataset")
    synth.add_argument("--out", required=True)
    synth.add_argument("--seed", type=int, default=7)
    synth.set_defaults(func=cmd_synthetic)

    args = parser.parse_args(argv)
    code: int = args.func(args)
    return code


if __name__ == "__main__":
    sys.exit(main())
