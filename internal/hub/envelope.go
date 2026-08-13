package hub

import (
	"encoding/json"
	"net/http"

	"kodax-fabric/internal/store"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeUnauthorized(w http.ResponseWriter, protocol string) {
	if protocol == store.ProtocolAnthropic {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"type": "error",
			"error": map[string]any{
				"type":    "authentication_error",
				"message": "invalid virtual key",
			},
		})
		return
	}
	writeJSON(w, http.StatusUnauthorized, map[string]any{
		"error": map[string]any{
			"message": "invalid virtual key",
			"type":    "invalid_request_error",
			"code":    "invalid_api_key",
		},
	})
}

func writeUnavailable(w http.ResponseWriter, protocol string) {
	if protocol == store.ProtocolAnthropic {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"type": "error",
			"error": map[string]any{
				"type":    "api_error",
				"message": "no matching channel in pool",
			},
		})
		return
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{
		"error": map[string]any{
			"message": "no matching channel in pool",
			"type":    "server_error",
			"code":    "provider_unavailable",
		},
	})
}

func writeRateLimited(w http.ResponseWriter, protocol, dim string) {
	code := "vk_rate_limit_exceeded"
	msg := "virtual key RPM limit exceeded"
	if dim == "provider" {
		code = "provider_rate_limit_exceeded"
		msg = "provider RPM limit exceeded"
	}
	if protocol == store.ProtocolAnthropic {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"type": "error",
			"error": map[string]any{
				"type":      "rate_limit_error",
				"message":   msg,
				"dimension": dim,
			},
		})
		return
	}
	writeJSON(w, http.StatusTooManyRequests, map[string]any{
		"error": map[string]any{
			"message":   msg,
			"type":      "rate_limit_error",
			"code":      code,
			"dimension": dim,
		},
	})
}

func writeBudgetExceeded(w http.ResponseWriter, protocol string) {
	if protocol == store.ProtocolAnthropic {
		writeJSON(w, http.StatusPaymentRequired, map[string]any{
			"type": "error",
			"error": map[string]any{
				"type":    "invalid_request_error",
				"message": "virtual key monthly token budget exceeded",
			},
		})
		return
	}
	writeJSON(w, http.StatusPaymentRequired, map[string]any{
		"error": map[string]any{
			"message": "virtual key monthly token budget exceeded",
			"type":    "insufficient_quota",
			"code":    "budget_exceeded",
		},
	})
}

func writeCircuitOpen(w http.ResponseWriter, protocol string) {
	if protocol == store.ProtocolAnthropic {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"type":  "error",
			"error": map[string]any{"type": "api_error", "message": "all matching channels are in circuit-open", "code": "circuit_open"},
		})
		return
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{
		"error": map[string]any{"message": "all matching channels are in circuit-open", "type": "server_error", "code": "circuit_open"},
	})
}

func writeForbidden(w http.ResponseWriter, protocol, msg string) {
	if protocol == store.ProtocolAnthropic {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"type":  "error",
			"error": map[string]any{"type": "permission_error", "message": msg},
		})
		return
	}
	writeJSON(w, http.StatusForbidden, map[string]any{
		"error": map[string]any{"message": msg, "type": "invalid_request_error", "code": "model_not_allowed"},
	})
}

func extractCallerKey(r *http.Request) string {
	if k := r.Header.Get("X-Api-Key"); k != "" {
		return k
	}
	auth := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(auth) > len(prefix) && auth[:len(prefix)] == prefix {
		return auth[len(prefix):]
	}
	return auth
}
