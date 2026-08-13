FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=v0.1.0
ARG GIT_COMMIT=unknown
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${GIT_COMMIT}" \
    -o /out/gateway ./cmd/gateway && \
    CGO_ENABLED=0 go build -ldflags "-s -w" -o /out/bootstrap ./cmd/bootstrap && \
    CGO_ENABLED=0 go build -ldflags "-s -w" -o /out/mockprovider ./cmd/mockprovider

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget \
 && adduser -D -H -u 65532 app
COPY --from=build /out/gateway /usr/local/bin/gateway
COPY --from=build /out/bootstrap /usr/local/bin/bootstrap
COPY --from=build /out/mockprovider /usr/local/bin/mockprovider
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/gateway"]
