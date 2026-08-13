package hub

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"kodax-fabric/internal/store"
)

type upResult struct {
	status int
	header http.Header
	body   []byte
}

func (s *Server) newUpstreamReq(r *http.Request, ch *store.Channel, path string, body []byte) (*http.Request, error) {
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
	return upReq, nil
}

func copyRateLimitHeaders(dst http.Header, src http.Header) {
	for k, vals := range src {
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
				dst.Add(k, v)
			}
		}
	}
}

func (s *Server) fetchUpstream(r *http.Request, ch *store.Channel, path string, body []byte) (upResult, error) {
	upReq, err := s.newUpstreamReq(r, ch, path, body)
	if err != nil {
		return upResult{}, err
	}
	resp, err := s.Client.Do(upReq)
	if err != nil {
		return upResult{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return upResult{status: resp.StatusCode}, err
	}
	h := make(http.Header)
	copyRateLimitHeaders(h, resp.Header)
	return upResult{status: resp.StatusCode, header: h, body: raw}, nil
}

func writeFetched(w http.ResponseWriter, res upResult) {
	for k, vals := range res.header {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(res.status)
	_, _ = w.Write(res.body)
}

func (s *Server) proxy(w http.ResponseWriter, r *http.Request, ch *store.Channel, path string, body []byte, stream bool) (int, error) {
	if !stream {
		res, err := s.fetchUpstream(r, ch, path, body)
		if err != nil {
			return 0, err
		}
		writeFetched(w, res)
		return res.status, nil
	}
	upReq, err := s.newUpstreamReq(r, ch, path, body)
	if err != nil {
		return 0, err
	}
	resp, err := s.Client.Do(upReq)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	copyRateLimitHeaders(w.Header(), resp.Header)
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "text/event-stream")
	}
	w.WriteHeader(resp.StatusCode)
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
