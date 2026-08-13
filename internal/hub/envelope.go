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
