# Postgres 16 Alpine + pgvector 0.8.0. Compose tags this as tokenhub-postgres:16-alpine.
# with_llvm=no skips clang bitcode; the alpine official image's JIT clang may not match.
FROM postgres:16-alpine

ARG PGVECTOR_VERSION=v0.8.0

RUN apk add --no-cache --virtual .build-deps \
      git \
      build-base \
    && git clone --branch "${PGVECTOR_VERSION}" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector OPTFLAGS="" with_llvm=no \
    && make -C /tmp/pgvector with_llvm=no install \
    && rm -rf /tmp/pgvector \
    && apk del .build-deps
