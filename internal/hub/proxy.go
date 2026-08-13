package hub

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"kodax-fabric/internal/store"
)

func retryableStatus(status int, err error) bool {
	if err != nil {
		return true
	}
	return status == http.StatusTooManyRequests || status >= 500
}

func (s *Server) fetchUpstream(r *http.Request, ch *store.Channel, path string, body []byte) (*http.Response, error) {
	url := strings.TrimRight(ch.BaseURL, "/") + path
	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
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
	return s.Client.Do(upReq)
}

func copyPassHeaders(w http.ResponseWriter, resp *http.Response) {
	for k, vals := range resp.Header {
		lk := strings.ToLower(k)
		if strings.HasPrefix(lk, "x-ratelimit-") ||
			lk == "retry-after" ||
			strings.HasPrefix(lk, "anthropic-ratelimit-") ||
			lk == "content-type" {
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}
	}
}

func writeUpstream(w http.ResponseWriter, resp *http.Response, stream bool) (int, error) {
	defer resp.Body.Close()
	copyPassHeaders(w, resp)
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
	_, err := io.Copy(w, resp.Body)
	return resp.StatusCode, err
}

func discardUpstream(resp *http.Response) {
	if resp == nil {
		return
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
}
