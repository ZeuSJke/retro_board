FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
# requirements.txt — полный lock с хешами (make lock): ставится ровно то, что проверено
RUN pip install --no-cache-dir --root-user-action=ignore --require-hashes -r requirements.txt

RUN groupadd --gid 1000 retro \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin retro

COPY --chown=retro:retro . .
COPY --chmod=0755 entrypoint.sh /entrypoint.sh

USER 1000:1000
EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
