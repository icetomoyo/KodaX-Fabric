FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod ./
COPY . .
RUN go mod tidy && go test ./... && \
    CGO_ENABLED=0 go build -o /out/gateway ./cmd/gateway && \
    CGO_ENABLED=0 go build -o /out/bootstrap ./cmd/bootstrap

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/gateway /usr/local/bin/gateway
COPY --from=build /out/bootstrap /usr/local/bin/bootstrap
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/gateway"]
