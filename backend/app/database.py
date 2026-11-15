from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


def _engine_options(database_url: str) -> dict:
    """Параметры движка: таймауты задаём только для PostgreSQL."""
    options: dict = {"pool_pre_ping": True}
    url = make_url(database_url)
    if url.get_backend_name() != "postgresql":
        return options
    options["pool_timeout"] = settings.db_pool_timeout_s
    connect_args: dict = {}
    if "connect_timeout" not in url.query:
        connect_args["connect_timeout"] = settings.db_connect_timeout_s
    # Серверные таймауты на каждый запрос и на ожидание блокировки.
    # Если options заданы прямо в строке подключения — они главнее, не затираем.
    if "options" not in url.query:
        connect_args["options"] = (
            f"-c statement_timeout={settings.db_statement_timeout_ms} "
            f"-c lock_timeout={settings.db_lock_timeout_ms}"
        )
    options["connect_args"] = connect_args
    return options


engine = create_engine(
    settings.sqlalchemy_database_url,
    **_engine_options(settings.sqlalchemy_database_url),
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def release_connection(db: Session) -> None:
    """Вернуть соединение в пул перед долгой операцией без обращений к БД.

    Нужно перед вызовом модели: запрос идёт до полутора-трёх минут, и держать
    на это время соединение из пула нельзя. Объекты сессии после вызова
    отсоединены — всё нужное следует прочитать заранее или запросить заново.
    """
    db.close()
