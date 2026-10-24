package main

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// webApp serves the built Vue app from dir: each file Vite wrote as it is, and index.html for
// every other path, so a page the app's router owns (/account, /checkout/return) loads from a
// bookmark, a refresh or Stripe's redirect too. Files under /assets/ have a content hash in their
// name, so they are cached for good; index.html is checked again on every load.
type webApp struct {
	files fs.FS
	serve http.Handler
}

// newWebApp serves the build in dir, and fails when there is none.
func newWebApp(dir string) (*webApp, error) {
	files := os.DirFS(dir)
	if _, err := fs.Stat(files, "index.html"); err != nil {
		return nil, fmt.Errorf("no web app in %s (build it with `npm run build`): %w", dir, err)
	}
	return &webApp{files: files, serve: http.FileServerFS(files)}, nil
}

func (a *webApp) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		a.serve.ServeHTTP(w, r)
		return
	}
	if name != "" && name != "index.html" {
		if info, err := fs.Stat(a.files, name); err == nil && !info.IsDir() {
			a.serve.ServeHTTP(w, r)
			return
		} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
			http.Error(w, "unreadable file", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, a.files, "index.html")
}
