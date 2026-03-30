package handler

import (
	"net"
	"net/http"
	"time"
)

const (
	defaultMetadataCacheTTL   = 2 * time.Minute
	defaultMetadataCacheLimit = 128
	defaultMaxProxyBodySize   = 16 * 1024 * 1024
)

// RuntimeOptions contains memory-sensitive handler configuration.
type RuntimeOptions struct {
	MetadataCacheTTL time.Duration
	MaxProxyBodySize int64
}

var (
	metadataCacheTTL         = defaultMetadataCacheTTL
	metadataCacheLimit       = defaultMetadataCacheLimit
	maxProxyBodySize   int64 = defaultMaxProxyBodySize

	shortHTTPClient = newShortHTTPClient()
	proxyHTTPClient = newProxyHTTPClient()
)

// SetRuntimeOptions applies runtime settings before the server starts.
func SetRuntimeOptions(opts RuntimeOptions) {
	if opts.MetadataCacheTTL > 0 {
		metadataCacheTTL = opts.MetadataCacheTTL
	}
	if opts.MaxProxyBodySize > 0 {
		maxProxyBodySize = opts.MaxProxyBodySize
	}
}

func newShortHTTPClient() *http.Client {
	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		MaxIdleConns:        16,
		MaxIdleConnsPerHost: 4,
		MaxConnsPerHost:     8,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	return &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
	}
}

func newProxyHTTPClient() *http.Client {
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   16,
		MaxConnsPerHost:       32,
		IdleConnTimeout:       120 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &http.Client{
		Timeout:   605 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}
