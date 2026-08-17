FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/fabric ./cmd/fabric

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/fabric /usr/local/bin/fabric
COPY testdata /testdata
ENV FIXTURE_PATH=/testdata/fixtures/openai/chat_completion.json
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/fabric"]
