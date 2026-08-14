package main

import (
	"net"
	"net/http"
	"strings"
	"time"
)

type healthBody struct {
	OK       bool   `json:"ok"`
	Service  string `json:"service"`
	Postgres bool   `json:"postgres"`
	Redis    bool   `json:"redis"`
}

func healthStatus(pgOK, redisConfigured, redisOK bool) (int, healthBody) {
	redisField := true
	if redisConfigured {
		redisField = redisOK
	}
	ok := pgOK && redisField
	code := http.StatusOK
	if !ok {
		code = http.StatusServiceUnavailable
	}
	return code, healthBody{
		OK: ok, Service: "kodax-fabric-gateway", Postgres: pgOK, Redis: redisField,
	}
}

func redisHost(raw string) string {
	raw = strings.TrimPrefix(raw, "redis://")
	if i := strings.IndexByte(raw, '/'); i >= 0 {
		raw = raw[:i]
	}
	return raw
}

func pingRedis(url string) bool {
	conn, err := net.DialTimeout("tcp", redisHost(url), 400*time.Millisecond)
	if err != nil {
		return false
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(400 * time.Millisecond))
	if _, err := conn.Write([]byte("*1\r\n$4\r\nPING\r\n")); err != nil {
		return false
	}
	buf := make([]byte, 32)
	n, err := conn.Read(buf)
	if err != nil || n == 0 {
		return false
	}
	return strings.Contains(string(buf[:n]), "PONG")
}
