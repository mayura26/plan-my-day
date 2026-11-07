package main

import (
	"bufio"
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"planmyday/server/internal/httpapi"
	"planmyday/server/internal/store"
)

func main() {
	loadEnvFiles(".."+string(os.PathSeparator)+".env.local", ".."+string(os.PathSeparator)+".env", ".env.local", ".env")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db, err := openStore(ctx)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	publicURL := os.Getenv("PUBLIC_URL")
	if publicURL == "" {
		publicURL = "http://localhost:" + port
	}
	srv := &httpapi.Server{
		Store:        db,
		PublicURL:    publicURL,
		DevLogin:     os.Getenv("ALLOW_DEV_LOGIN") == "1",
		GoogleID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		GitHubID:     os.Getenv("GITHUB_CLIENT_ID"),
		GitHubSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		OpenAIKey:    os.Getenv("OPENAI_API_KEY"),
		VAPIDPublic:  os.Getenv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
		VAPIDPrivate: os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject: os.Getenv("VAPID_SUBJECT"),
		PushSecret:   firstNonEmpty(os.Getenv("PUSH_ACTION_SECRET"), os.Getenv("NEXTAUTH_SECRET")),
		CronSecret:   os.Getenv("CRON_SECRET"),
		WebRoot:      findWeb(),
	}
	log.Printf("Plan My Day listening on %s", publicURL)
	if err := http.ListenAndServe(":"+port, srv.Handler()); err != nil {
		log.Fatal(err)
	}
}

func openStore(ctx context.Context) (*store.Store, error) {
	if path := os.Getenv("SQLITE_PATH"); path != "" {
		return store.OpenSQLite(path)
	}
	url := os.Getenv("TURSO_DATABASE_URL")
	token := os.Getenv("TURSO_AUTH_TOKEN")
	if url == "" || token == "" {
		return nil, errString("set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, or SQLITE_PATH for a local database")
	}
	db, err := store.OpenTurso(url, token)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

type errString string

func (e errString) Error() string { return string(e) }

func findWeb() string {
	if v := os.Getenv("WEB_ROOT"); v != "" {
		return v
	}
	for _, candidate := range []string{"web", filepath.Join("..", "web")} {
		if st, err := os.Stat(filepath.Join(candidate, "index.html")); err == nil && !st.IsDir() {
			abs, _ := filepath.Abs(candidate)
			return abs
		}
	}
	return "web"
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func loadEnvFiles(paths ...string) {
	for _, path := range paths {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			line = strings.TrimPrefix(line, "export ")
			key, val, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			val = strings.Trim(strings.TrimSpace(val), `"'`)
			if _, exists := os.LookupEnv(key); !exists {
				_ = os.Setenv(key, val)
			}
		}
		_ = f.Close()
	}
}
