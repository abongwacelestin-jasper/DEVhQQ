"""Byte stores behind the model registry: S3-compatible (MinIO locally) or a local directory."""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Protocol

from ..config import S3Settings

_SAFE_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,250}$")


def _check_key(key: str) -> str:
    if not _SAFE_KEY.fullmatch(key) or ".." in key.split("/"):
        raise ValueError(f"unsafe object key: {key!r}")
    return key


class ObjectStore(Protocol):
    description: str

    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    def get(self, key: str) -> bytes | None: ...


class LocalStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.description = f"local:{self.root}"

    def _path(self, key: str) -> Path:
        p = (self.root / _check_key(key)).resolve()
        if self.root not in p.parents:
            raise ValueError("key escapes the store root")
        return p

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic replace so a reader never sees a half-written artifact.
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.is_file() else None


class S3Store:
    def __init__(self, s3: S3Settings, prefix: str = "models") -> None:
        import boto3
        from botocore.config import Config

        if not s3.bucket:
            raise ValueError("S3_BUCKET_MODELS is not set")
        self.bucket = s3.bucket
        self.prefix = prefix
        self.description = f"s3://{s3.bucket}/{prefix}"
        self._client = boto3.client(
            "s3",
            endpoint_url=s3.endpoint,
            region_name=s3.region,
            aws_access_key_id=s3.access_key_id,
            aws_secret_access_key=s3.secret_access_key,
            config=Config(
                s3={"addressing_style": "path" if s3.force_path_style else "auto"},
                connect_timeout=5,
                read_timeout=30,
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
        from botocore.exceptions import ClientError

        self._client_error = ClientError

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{_check_key(key)}"

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(
            Bucket=self.bucket, Key=self._key(key), Body=data, ContentType=content_type
        )

    def get(self, key: str) -> bytes | None:
        try:
            obj = self._client.get_object(Bucket=self.bucket, Key=self._key(key))
        except self._client_error as e:
            code = str(e.response.get("Error", {}).get("Code", ""))
            if code in {"NoSuchKey", "404", "NotFound"}:
                return None
            raise
        body: bytes = obj["Body"].read()
        return body


def make_store(s3: S3Settings, local_dir: Path) -> ObjectStore:
    """S3 when fully configured, otherwise the local directory fallback."""
    if s3.configured:
        return S3Store(s3)
    return LocalStore(local_dir)
