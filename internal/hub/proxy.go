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

func (s *Server) fetchWithAuthFallback(r *http.Request, ch *store.Channel, path string, body []byte) (*http.Response, error, bool) {
	resp, err := s.fetchUpstream(r, ch, path, body)
	if err != nil || resp == nil {
		return resp, err, false
	}
	if resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
		return resp, nil, false
	}
	if ch.FallbackSecret == "" {
		return resp, nil, false
	}
	discardUpstream(resp)
	fb := *ch
	fb.Secret = ch.FallbackSecret
	fb.FallbackSecret = ""
	resp2, err2 := s.fetchUpstream(r, &fb, path, body)
	return resp2, err2, true
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

func writeUpstream(w http.ResponseWriter, resp *http.Response, stream bool, beforeHeader func(), onData func([]byte)) (int, error) {
	defer resp.Body.Close()
	copyPassHeaders(w, resp)
	if stream && w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "text/event-stream")
	}
	if !stream {
		body, err := io.ReadAll(resp.Body)
		if onData != nil {
			onData(body)
		}
		if beforeHeader != nil {
			beforeHeader()
		}
		w.WriteHeader(resp.StatusCode)
		_, werr := w.Write(body)
		if err != nil {
			return resp.StatusCode, err
		}
		return resp.StatusCode, werr
	}
	if beforeHeader != nil {
		beforeHeader()
	}
	w.WriteHeader(resp.StatusCode)
	flusher, _ := w.(http.Flusher)
	if flusher != nil {
		flusher.Flush()
	}
	buf := make([]byte, 4096)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if onData != nil {
				onData(buf[:n])
			}
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

func discardUpstream(resp *http.Response) {
	if resp == nil {
		return
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
}
