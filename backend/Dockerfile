FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

RUN groupadd --gid 1000 retro \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin retro

COPY --chown=retro:retro . .
COPY --chmod=0755 entrypoint.sh /entrypoint.sh

USER 1000:1000
EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
