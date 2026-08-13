package hub

import (
	"net"
	"net/http"
	"strings"
)

func remoteIP(r *http.Request) net.IP {
	if r == nil {
		return nil
	}
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = h
	}
	return net.ParseIP(host)
}

// ipAllowed reports whether ip may call. failClosed means the allow-list is
// present but unusable (invalid CIDR/IP) and the request must be rejected.
func ipAllowed(ip net.IP, allow []string) (ok bool, failClosed bool) {
	var rules []string
	for _, raw := range allow {
		raw = strings.TrimSpace(raw)
		if raw != "" {
			rules = append(rules, raw)
		}
	}
	if len(rules) == 0 {
		return true, false
	}
	if ip == nil {
		return false, true
	}
	type rule struct {
		ip  net.IP
		net *net.IPNet
	}
	parsed := make([]rule, 0, len(rules))
	for _, raw := range rules {
		if strings.Contains(raw, "/") {
			_, n, err := net.ParseCIDR(raw)
			if err != nil {
				return false, true
			}
			parsed = append(parsed, rule{net: n})
			continue
		}
		p := net.ParseIP(raw)
		if p == nil {
			return false, true
		}
		parsed = append(parsed, rule{ip: p})
	}
	for _, r := range parsed {
		if r.net != nil && r.net.Contains(ip) {
			return true, false
		}
		if r.ip != nil && r.ip.Equal(ip) {
			return true, false
		}
	}
	return false, false
}
