package hub

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"kodax-fabric/internal/store"
)

func (s *Server) proxy(w http.ResponseWriter, r *http.Request, ch *store.Channel, path string, body []byte, stream bool) (int, error) {
	url := strings.TrimRight(ch.BaseURL, "/") + path
	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	upReq.Header.Set("Content-Type", "application/json")
	if ch.Protocol == store.ProtocolAnthropic {
		upReq.Header.Set("X-Api-Key", ch.Secret)
		upReq.Header.Set("Anthropic-Version", "2023-06-01")
	} else {
		upReq.Header.Set("Authorization", "Bearer "+ch.Secret)
	}
	if v := r.Header.Get("Accept"); v != "" {
		upReq.Header.Set("Accept", v)
	}

	resp, err := s.Client.Do(upReq)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	for k, vals := range resp.Header {
		lk := strings.ToLower(k)
		if lk == "x-ratelimit-limit-requests" ||
			lk == "x-ratelimit-remaining-requests" ||
			lk == "x-ratelimit-limit-tokens" ||
			lk == "x-ratelimit-remaining-tokens" ||
			lk == "x-ratelimit-reset-requests" ||
			lk == "x-ratelimit-reset-tokens" ||
			strings.HasPrefix(lk, "x-ratelimit-") ||
			lk == "retry-after" ||
			lk == "anthropic-ratelimit-requests-limit" ||
			lk == "anthropic-ratelimit-requests-remaining" ||
			lk == "content-type" {
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}
	}
	if stream && w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "text/event-stream")
	}

	w.WriteHeader(resp.StatusCode)
	if stream {
		flusher, _ := w.(http.Flusher)
		buf := make([]byte, 4096)
		for {
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if _, werr := w.Write(buf[:n]); werr != nil {
					return resp.StatusCode, werr
				}
				if flusher != nil {
					flusher.Flush()
				}
			}
			if readErr != nil {
				if readErr == io.EOF {
					return resp.StatusCode, nil
				}
				return resp.StatusCode, readErr
			}
		}
	}
	_, err = io.Copy(w, resp.Body)
	return resp.StatusCode, err
}
