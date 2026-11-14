"""Токены и строка подключения после замены python-jose на PyJWT и psycopg2 на psycopg 3."""

import base64
import hashlib
import hmac
import json
import time

import pytest
from fastapi import HTTPException

from app.config import Settings, settings
from app.workspace_auth import (
    create_admin_token,
    create_workspace_token,
    decode_workspace_token,
    verify_admin_token,
)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _hs256(payload: dict, secret: str, header: dict | None = None) -> str:
    """Собрать JWT вручную — так, как его выпускала любая стандартная библиотека."""
    head = _b64(json.dumps(header or {"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64(json.dumps(payload).encode())
    signature = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{_b64(signature)}"


class TestWorkspaceTokens:
    def test_roundtrip(self):
        token = create_workspace_token("ws-1", "team", "Команда")
        payload = decode_workspace_token(token)
        assert payload["workspace_id"] == "ws-1"
        assert payload["workspace_slug"] == "team"
        assert payload["workspace_name"] == "Команда"

    def test_token_issued_by_previous_library_is_accepted(self):
        """Сессии, выданные до замены библиотеки, не должны слететь при выкате."""
        token = _hs256(
            {
                "workspace_id": "ws-1",
                "workspace_slug": "team",
                "workspace_name": "Команда",
                "exp": int(time.time()) + 3600,
            },
            settings.workspace_jwt_secret,
        )
        assert decode_workspace_token(token)["workspace_id"] == "ws-1"

    @pytest.mark.parametrize(
        "token_factory",
        [
            lambda: _hs256({"workspace_id": "ws-1", "exp": int(time.time()) - 10}, settings.workspace_jwt_secret),
            lambda: _hs256({"workspace_id": "ws-1", "exp": int(time.time()) + 3600}, "чужой-секрет-" + "x" * 32),
            lambda: _hs256(
                {"workspace_id": "ws-1", "exp": int(time.time()) + 3600},
                settings.workspace_jwt_secret,
                header={"alg": "none", "typ": "JWT"},
            ),
            lambda: _b64(b'{"alg":"none"}') + "." + _b64(b'{"workspace_id":"ws-1"}') + ".",
            lambda: "не-токен",
            lambda: "",
        ],
        ids=["expired", "wrong-secret", "alg-none-signed", "alg-none-unsigned", "garbage", "empty"],
    )
    def test_invalid_tokens_are_401(self, token_factory):
        with pytest.raises(HTTPException) as err:
            decode_workspace_token(token_factory())
        assert err.value.status_code == 401

    def test_admin_secret_does_not_open_workspace(self):
        with pytest.raises(HTTPException):
            decode_workspace_token(create_admin_token())


class TestAdminTokens:
    def test_roundtrip(self):
        assert verify_admin_token(create_admin_token()) is True

    def test_workspace_token_is_not_admin(self):
        assert verify_admin_token(create_workspace_token("ws-1", "team", "Команда")) is False

    def test_wrong_subject_is_rejected(self):
        token = _hs256({"sub": "user", "exp": int(time.time()) + 3600}, settings.admin_jwt_secret)
        assert verify_admin_token(token) is False

    def test_garbage_is_rejected(self):
        assert verify_admin_token("мусор") is False


class TestDatabaseUrl:
    @pytest.mark.parametrize(
        ("given", "expected"),
        [
            ("postgresql://u:p@db:5432/retro", "postgresql+psycopg://u:p@db:5432/retro"),
            ("postgres://u:p@db/retro", "postgresql+psycopg://u:p@db/retro"),
            ("postgresql://postgres:@/retro?host=/run/pg", "postgresql+psycopg://postgres:@/retro?host=/run/pg"),
            ("postgresql+psycopg://u:p@db/retro", "postgresql+psycopg://u:p@db/retro"),
            ("sqlite://", "sqlite://"),
            ("sqlite:///file.db", "sqlite:///file.db"),
        ],
    )
    def test_driver_is_made_explicit(self, given, expected):
        assert Settings(database_url=given).sqlalchemy_database_url == expected

    def test_engine_for_postgres_uses_psycopg3(self):
        from sqlalchemy import create_engine

        from app.database import _engine_options

        url = Settings(database_url="postgresql://u:p@127.0.0.1:1/retro").sqlalchemy_database_url
        engine = create_engine(url, **_engine_options(url))
        assert engine.dialect.driver == "psycopg"
