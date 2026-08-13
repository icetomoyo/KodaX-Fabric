package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err)
	}
	file := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p := r.URL.Path
		if strings.HasPrefix(p, "/admin/v1") {
			http.NotFound(w, r)
			return
		}
		if p == "/" || p == "/admin" || strings.HasPrefix(p, "/admin/") {
			http.ServeFileFS(w, r, distFS, "dist/index.html")
			return
		}
		file.ServeHTTP(w, r)
	})
}
