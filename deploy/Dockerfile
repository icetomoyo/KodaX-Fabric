FROM node:20-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web/ ./web/
RUN mkdir -p internal/webui/dist && cd web && npm run build

FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod ./
COPY . .
COPY --from=web /src/internal/webui/dist ./internal/webui/dist
RUN go mod tidy && go test ./... && \
    CGO_ENABLED=0 go build -o /out/gateway ./cmd/gateway && \
    CGO_ENABLED=0 go build -o /out/bootstrap ./cmd/bootstrap

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/gateway /usr/local/bin/gateway
COPY --from=build /out/bootstrap /usr/local/bin/bootstrap
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/gateway"]
