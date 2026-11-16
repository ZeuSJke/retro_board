"""Эксплуатация: идентификатор запроса в ответе и журнале, проверка готовности и метрики."""

import importlib.util
import json
import logging
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlalchemy import exc as sa_exc

import main
from app.config import settings
from app.request_context import JsonLogFormatter, RequestIdFilter, configure_logging, request_id_var


class TestRequestId:
    def test_every_response_carries_an_id(self, client, workspace_headers):
        ok = client.get("/api/boards/", headers=workspace_headers)
        unauthorized = client.get("/api/boards/")
        missing = client.get("/api/boards/no-such-board", headers=workspace_headers)
        too_big = client.post(
            "/api/workspaces/login", content=b"x" * (settings.max_request_body_bytes + 1)
        )
        ids = [r.headers["x-request-id"] for r in (ok, unauthorized, missing, too_big)]
        assert [r.status_code for r in (ok, unauthorized, missing, too_big)] == [200, 401, 404, 413]
        assert all(len(i) >= 8 for i in ids) and len(set(ids)) == 4

    def test_id_from_proxy_is_kept_only_when_safe(self, client):
        kept = client.get("/api/health", headers={"X-Request-ID": "trace-0123456789abcdef"})
        assert kept.headers["x-request-id"] == "trace-0123456789abcdef"
        # Произвольный текст в журнал не попадает
        forged = client.get("/api/health", headers={"X-Request-ID": "x\tERROR admin logged in"})
        assert forged.headers["x-request-id"] != "x\tERROR admin logged in"
        short = client.get("/api/health", headers={"X-Request-ID": "abc"})
        assert short.headers["x-request-id"] != "abc"

    def test_log_records_carry_the_request_id(self):
        record = logging.LogRecord("retroboard", logging.INFO, __file__, 1, "сообщение", None, None)
        token = request_id_var.set("req-12345678")
        try:
            assert RequestIdFilter().filter(record) is True
            assert record.request_id == "req-12345678"
        finally:
            request_id_var.reset(token)
        outside = logging.LogRecord("retroboard", logging.INFO, __file__, 1, "вне запроса", None, None)
        RequestIdFilter().filter(outside)
        assert outside.request_id == "-"

    def test_id_is_available_to_handlers_during_the_request(self, client):
        seen = {}

        @main.app.get("/api/test-request-id")
        def _probe():
            seen["id"] = request_id_var.get()
            return {"ok": True}

        resp = client.get("/api/test-request-id")
        assert seen["id"] == resp.headers["x-request-id"]
        assert request_id_var.get() == "-"


class TestReadiness:
    def test_ready_when_database_answers(self, client):
        resp = client.get("/api/ready")
        assert resp.status_code == 200 and resp.json() == {"status": "ok"}
        # Проба не должна обзаводиться cookie
        assert "set-cookie" not in resp.headers

    def test_not_ready_when_database_is_down(self, client):
        """Под без связи с БД убирается из балансировки, но остаётся живым."""
        with patch.object(main.engine, "connect", side_effect=RuntimeError("нет связи")):
            resp = client.get("/api/ready")
            alive = client.get("/api/health")
        assert resp.status_code == 503
        assert alive.status_code == 200


class TestObservabilityMetricsAndJsonLogs:
    def test_metrics_endpoint_exposes_http_ws_and_error_metrics(self, client):
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/test-500").status_code == 500

        resp = client.get("/metrics")
        assert resp.status_code == 200
        assert "set-cookie" not in resp.headers
        body = resp.text
        assert "retro_http_requests_total" in body
        assert "retro_http_request_duration_seconds" in body
        assert "retro_ws_active_connections" in body
        assert "retro_ws_dropped_slow_consumers_total" in body
        assert 'retro_unhandled_errors_total{exc_type="RuntimeError",source="http"}' in body or (
            'retro_unhandled_errors_total' in body and 'source="http"' in body
        )

    def test_json_log_formatter_includes_request_id(self):
        formatter = JsonLogFormatter()
        record = logging.LogRecord(
            "retroboard", logging.WARNING, __file__, 1, "тест json", None, None
        )
        token = request_id_var.set("trace-abcdef0123")
        try:
            RequestIdFilter().filter(record)
            parsed = json.loads(formatter.format(record))
        finally:
            request_id_var.reset(token)

        assert parsed["level"] == "WARNING"
        assert parsed["request_id"] == "trace-abcdef0123"
        assert parsed["logger"] == "retroboard"
        assert parsed["message"] == "тест json"

    def test_configure_logging_switches_to_json_via_env(self, monkeypatch):
        monkeypatch.setenv("LOG_FORMAT", "json")
        configure_logging()
        try:
            root = logging.getLogger()
            assert isinstance(root.handlers[0].formatter, JsonLogFormatter)
        finally:
            monkeypatch.delenv("LOG_FORMAT", raising=False)
            configure_logging()

    def test_metrics_collapses_unmatched_403_413_404_routes(self, client, monkeypatch):
        monkeypatch.setattr(settings, "csrf_enabled", True)
        assert client.get("/api/unmatched-404-probe-abc").status_code == 404
        assert client.post("/api/unmatched-csrf-probe-xyz").status_code == 403
        assert (
            client.post(
                "/api/unmatched-size-probe-qrs",
                content=b"x" * (settings.max_request_body_bytes + 1),
            ).status_code
            == 413
        )
        client.request("FOOBAR", "/api/unmatched-method-probe")

        body = client.get("/metrics").text
        for probe in (
            "unmatched-404-probe-abc",
            "unmatched-csrf-probe-xyz",
            "unmatched-size-probe-qrs",
            "unmatched-method-probe",
        ):
            assert probe not in body
        assert "FOOBAR" not in body
        assert 'retro_http_requests_total{method="GET",route="<unmatched>",status="404"}' in body
        assert 'retro_http_requests_total{method="POST",route="<unmatched>",status="403"}' in body
        assert 'retro_http_requests_total{method="POST",route="<unmatched>",status="413"}' in body
        assert 'method="OTHER"' in body


class TestMigration0015Downgrade:
    def test_downgrade_deduplicates_conflicting_deleted_and_long_boards(self, tmp_path):
        mig_path = (
            Path(__file__).resolve().parents[1]
            / "alembic"
            / "versions"
            / "0015_partial_unique_board_indexes.py"
        )
        spec = importlib.util.spec_from_file_location("mig0015_test", mig_path)
        assert spec is not None and spec.loader is not None
        mig0015 = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mig0015)

        db_url = f"sqlite:///{tmp_path / 'mig0015.db'}"
        eng = create_engine(db_url)
        md = sa.MetaData()
        sa.Table(
            "boards",
            md,
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("workspace_id", sa.String(), nullable=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("slug", sa.String(150), nullable=True),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("workspace_id", "name", name="uq_board_workspace_name"),
            sa.UniqueConstraint("workspace_id", "slug", name="uq_board_workspace_slug"),
        )
        md.create_all(eng)

        long_name = "L" * 120
        long_slug = "s" * 150
        ts = "2026-11-15 12:00:00"
        with eng.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO boards (id, workspace_id, name, slug, deleted_at) "
                    "VALUES ('mig-del', 'mig-ws', 'Sprint 1', 'sprint-1', :ts)"
                ),
                {"ts": ts},
            )
            conn.execute(
                text(
                    "INSERT INTO boards (id, workspace_id, name, slug, deleted_at) "
                    "VALUES ('mig-long-del', 'mig-ws', :name, :slug, :ts)"
                ),
                {"name": long_name, "slug": long_slug, "ts": ts},
            )

        with eng.begin() as conn:
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                mig0015.upgrade()

        with eng.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO boards (id, workspace_id, name, slug, deleted_at) "
                    "VALUES ('mig-live', 'mig-ws', 'Sprint 1', 'sprint-1', NULL)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO boards (id, workspace_id, name, slug, deleted_at) "
                    "VALUES ('mig-long-live', 'mig-ws', :name, :slug, NULL)"
                ),
                {"name": long_name, "slug": long_slug},
            )

        # Повторное восстановление/создание живой доски с тем же именем должно падать
        try:
            with eng.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO boards (id, workspace_id, name, slug, deleted_at) "
                        "VALUES ('mig-dup-live', 'mig-ws', 'Sprint 1', 'sprint-1', NULL)"
                    )
                )
            raise AssertionError("Expected IntegrityError for duplicate live board")
        except sa_exc.IntegrityError:
            pass

        with eng.begin() as conn:
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                mig0015.downgrade()

        with eng.connect() as conn:
            rows = {
                row.id: (row.name, row.slug)
                for row in conn.execute(
                    text("SELECT id, name, slug FROM boards ORDER BY id")
                ).fetchall()
            }

        assert rows["mig-live"] == ("Sprint 1", "sprint-1")
        assert rows["mig-del"] != ("Sprint 1", "sprint-1")
        assert rows["mig-long-live"] == (long_name, long_slug)
        assert len(rows["mig-long-del"][0]) <= 120
        assert len(rows["mig-long-del"][1]) <= 150
        assert len({v[0] for v in rows.values()}) == 4
        assert len({v[1] for v in rows.values()}) == 4

        with eng.begin() as conn:
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                mig0015.upgrade()
        eng.dispose()
