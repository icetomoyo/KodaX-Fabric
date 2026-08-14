package main

import (
	"net"
	"net/http"
	"strings"
	"testing"
)

func TestPingRedisRejectsBareTCP(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
		}
	}()
	if pingRedis("redis://" + ln.Addr().String()) {
		t.Fatal("bare TCP must not count as redis up")
	}
}

func TestPingRedisAcceptsPong(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		buf := make([]byte, 64)
		n, _ := c.Read(buf)
		if !strings.Contains(string(buf[:n]), "PING") {
			return
		}
		_, _ = c.Write([]byte("+PONG\r\n"))
	}()
	if !pingRedis("redis://" + ln.Addr().String()) {
		t.Fatal("PING/PONG should pass")
	}
}

func TestHealthStatusRequiresRedisWhenConfigured(t *testing.T) {
	code, body := healthStatus(true, true, false)
	if code != http.StatusServiceUnavailable {
		t.Fatalf("status %d want 503", code)
	}
	if body.OK || body.Redis {
		t.Fatalf("body %+v", body)
	}
	code, body = healthStatus(true, false, false)
	if code != http.StatusOK || !body.OK || !body.Redis {
		t.Fatalf("unconfigured redis should stay 200 %+v", body)
	}
}
