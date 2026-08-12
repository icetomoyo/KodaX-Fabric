package hub

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"kodax-fabric/internal/store"
)

type attemptResult struct {
	status    int
	retryable bool
	err       error
	tokens    int64
}

func (s *Server) proxy(w http.ResponseWriter, r *http.Request, ch *store.Channel, path string, body []byte, stream bool) attemptResult {
	url := strings.TrimRight(ch.BaseURL, "/") + path
	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return attemptResult{status: 0, retryable: true, err: err}
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
		return attemptResult{status: 0, retryable: true, err: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		_, _ = io.Copy(io.Discard, resp.Body)
		return attemptResult{status: resp.StatusCode, retryable: true, err: nil}
	}

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
					return attemptResult{status: resp.StatusCode, err: werr}
				}
				if flusher != nil {
					flusher.Flush()
				}
			}
			if readErr != nil {
				if readErr == io.EOF {
					return attemptResult{status: resp.StatusCode}
				}
				return attemptResult{status: resp.StatusCode, err: readErr}
			}
		}
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return attemptResult{status: resp.StatusCode, err: err}
	}
	_, _ = w.Write(raw)
	return attemptResult{status: resp.StatusCode, tokens: parseUsageTokens(raw)}
}

func parseUsageTokens(raw []byte) int64 {
	var u struct {
		Usage struct {
			TotalTokens      int64 `json:"total_tokens"`
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
			InputTokens      int64 `json:"input_tokens"`
			OutputTokens     int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(raw, &u) != nil {
		return 0
	}
	if u.Usage.TotalTokens > 0 {
		return u.Usage.TotalTokens
	}
	if u.Usage.PromptTokens+u.Usage.CompletionTokens > 0 {
		return u.Usage.PromptTokens + u.Usage.CompletionTokens
	}
	return u.Usage.InputTokens + u.Usage.OutputTokens
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
