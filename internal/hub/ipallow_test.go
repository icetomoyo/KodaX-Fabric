package hub

import (
	"net"
	"testing"
)

func TestIPAllowedIPv4IPv6AndFailClosed(t *testing.T) {
	ok, closed := ipAllowed(net.ParseIP("127.0.0.1"), nil)
	if !ok || closed {
		t.Fatal("empty allow")
	}
	ok, closed = ipAllowed(net.ParseIP("10.1.2.3"), []string{"10.1.0.0/16"})
	if !ok || closed {
		t.Fatal("cidr")
	}
	ok, closed = ipAllowed(net.ParseIP("2001:db8::1"), []string{"2001:db8::/32"})
	if !ok || closed {
		t.Fatal("ipv6")
	}
	ok, closed = ipAllowed(net.ParseIP("127.0.0.1"), []string{"not-valid"})
	if ok || !closed {
		t.Fatal("invalid must fail closed")
	}
	ok, closed = ipAllowed(net.ParseIP("8.8.8.8"), []string{"1.2.3.4"})
	if ok || closed {
		t.Fatal("mismatch")
	}
	ok, closed = ipAllowed(net.ParseIP("127.0.0.1"), []string{"127.0.0.1", "bad-rule"})
	if ok || !closed {
		t.Fatal("later invalid rule must fail closed")
	}
	ok, closed = ipAllowed(net.ParseIP("2001:db8::1"), []string{"2001:db8::1", "not-a-cidr"})
	if ok || !closed {
		t.Fatal("ipv6 later invalid rule must fail closed")
	}
}
