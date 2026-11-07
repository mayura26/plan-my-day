package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"net/url"
	"strings"
	"time"

	"planmyday/server/internal/schedule"

	_ "github.com/tursodatabase/libsql-client-go/libsql"
	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaFS embed.FS

// Store talks to SQLite or remote Turso through database/sql.
type Store struct {
	DB     *sql.DB
	Driver string
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// OpenSQLite opens a local database and applies the test/dev schema.
// Production Turso is never migrated from here.
func OpenSQLite(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{DB: db, Driver: "sqlite"}
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// OpenTurso connects to the existing database. It does not change the schema.
func OpenTurso(rawURL, authToken string) (*Store, error) {
	dsn := rawURL
	if authToken != "" && !strings.Contains(dsn, "authToken=") {
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		dsn += sep + "authToken=" + url.QueryEscape(authToken)
	}
	db, err := sql.Open("libsql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetConnMaxIdleTime(time.Minute)
	return &Store{DB: db, Driver: "libsql"}, nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) Ping(ctx context.Context) error {
	var one int
	return s.DB.QueryRowContext(ctx, "SELECT 1").Scan(&one)
}

func (s *Store) migrate(ctx context.Context) error {
	b, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		return err
	}
	for _, stmt := range strings.Split(string(b), ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := s.DB.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	return nil
}

func (s *Store) withTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func nowStamp() string { return schedule.FormatStamp(time.Now().UTC()) }

func normStamp(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := strings.TrimSpace(v.String)
	if s == "" {
		return nil
	}
	if t, err := schedule.ParseStamp(s); err == nil {
		out := schedule.FormatStamp(t)
		return &out
	}
	return &s
}

func ns(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

func ni(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int64)
	return &n
}

func asBool(n int) bool { return n != 0 }
