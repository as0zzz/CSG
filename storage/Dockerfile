FROM golang:1.24.8-bookworm AS build
WORKDIR /src
ARG MINIO_COMMIT=7aac2a2c5b7c882e68c1ce017d8256be2feea27f
ADD https://github.com/minio/minio/archive/${MINIO_COMMIT}.tar.gz /tmp/source.tar.gz
RUN tar -xzf /tmp/source.tar.gz --strip-components=1 -C /src
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -trimpath -o /minio .
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /minio /usr/local/bin/minio
COPY --from=build /src/LICENSE /usr/share/doc/minio/LICENSE
ENTRYPOINT ["minio"]
