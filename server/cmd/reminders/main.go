package main

import (
	"bufio"
	"context"
	"log"
	"os"
	"strings"
	"time"

	"planmyday/server/internal/reminders"
	"planmyday/server/internal/store"
)

func main() {
	loadEnv(".."+string(os.PathSeparator)+".env.local", ".."+string(os.PathSeparator)+".env", ".env.local", ".env")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var db *store.Store
	var err error
	if path := os.Getenv("SQLITE_PATH"); path != "" {
		db, err = store.OpenSQLite(path)
	} else {
		db, err = store.OpenTurso(os.Getenv("TURSO_DATABASE_URL"), os.Getenv("TURSO_AUTH_TOKEN"))
	}
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	secret := os.Getenv("PUSH_ACTION_SECRET")
	if secret == "" {
		secret = os.Getenv("NEXTAUTH_SECRET")
	}
	subject := os.Getenv("VAPID_SUBJECT")
	if subject == "" {
		subject = "mailto:plan@localhost"
	}
	result, err := reminders.Process(ctx, db, os.Getenv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"), os.Getenv("VAPID_PRIVATE_KEY"), subject, secret)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("scheduled=%d due=%d critical=%d sent=%d errors=%d", result.ScheduledChecked, result.DueChecked, result.CriticalChecked, result.Sent, result.Errors)
}

func loadEnv(paths ...string) {
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
			key, val, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
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
