package main

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"os"
	"time"
)

// outboundClient is the HTTP client the app calls Stripe and Resend with. It is Go's default
// transport, so it follows HTTPS_PROXY and NO_PROXY, and it trusts the system's certificate
// authorities plus, when SSL_CERT_FILE names a PEM file, the ones in that file.
//
// Go reads SSL_CERT_FILE itself on Linux. On macOS and Windows it asks the operating system to
// verify certificates and ignores the variable, so a private authority that is not in the
// system's store (a company's TLS-inspecting proxy, or a test proxy) is refused there. Adding
// the file to a copy of the system pool makes every platform honour it. With the variable unset,
// as in production, the client trusts exactly what the default one does.
func outboundClient() (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()

	if file := os.Getenv("SSL_CERT_FILE"); file != "" {
		roots, err := withExtraRoots(file)
		if err != nil {
			return nil, err
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	}

	return &http.Client{Transport: transport, Timeout: 30 * time.Second}, nil
}

// withExtraRoots is the system's pool with the certificates in file added to it.
func withExtraRoots(file string) (*x509.CertPool, error) {
	pem, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("read SSL_CERT_FILE: %w", err)
	}

	roots, err := x509.SystemCertPool()
	if err != nil {
		roots = x509.NewCertPool()
	}
	if !roots.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("SSL_CERT_FILE %s holds no PEM certificate", file)
	}

	return roots, nil
}
