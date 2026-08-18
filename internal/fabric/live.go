package fabric

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"time"
)

// LiveOpenAIProvider forwards the raw Chat Completions body to an OpenAI-family upstream.
type LiveOpenAIProvider struct {
	BaseURL string
	APIKey  string
	Client  *http.Client
}

func NewLiveOpenAIProvider(baseURL, apiKey string) *LiveOpenAIProvider {
	return &LiveOpenAIProvider{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		Client:  &http.Client{Timeout: 120 * time.Second},
	}
}

func (p *LiveOpenAIProvider) ChatCompletions(ctx context.Context, rawBody []byte) (int, map[string]string, io.ReadCloser, error) {
	url := p.BaseURL + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(rawBody))
	if err != nil {
		return 0, nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.Client.Do(req)
	if err != nil {
		return 0, nil, nil, err
	}
	header := map[string]string{}
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		header["Content-Type"] = ct
	}
	return resp.StatusCode, header, resp.Body, nil
}
