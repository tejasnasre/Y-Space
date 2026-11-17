# Postgres with pg_cron (clock) and pgmq (message queue), on the SAME Alpine base as the stock postgres:17-alpine image.
# Staying on Alpine (musl) matters: an existing data volume keeps its text sort order. Do not swap in a Debian image.
FROM postgres:17-alpine

ARG PG_CRON_VERSION=v1.6.8
ARG PGMQ_VERSION=v1.13.1

# pg_cron: clang/llvm 21 match how the base image's Postgres was built (--with-llvm), so its bitcode builds too.
# pgmq: pure SQL, nothing to compile, `make install` just copies the extension's SQL files into place.
RUN apk add --no-cache --virtual .ext-build build-base git clang21 llvm21 \
 && git clone --depth 1 --branch "${PG_CRON_VERSION}" https://github.com/citusdata/pg_cron.git /tmp/pg_cron \
 && cd /tmp/pg_cron && make && make install \
 && git clone --depth 1 --branch "${PGMQ_VERSION}" https://github.com/pgmq/pgmq.git /tmp/pgmq \
 && cd /tmp/pgmq/pgmq-extension && make && make install \
 && cd / && rm -rf /tmp/pg_cron /tmp/pgmq \
 && apk del .ext-build
