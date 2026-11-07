package store

import (
	"context"
	"testing"
	"time"

	"planmyday/server/internal/schedule"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenSQLite("file:" + t.Name() + "?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestEmailMatchDoesNotDuplicateUsers(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, err := s.UpsertOAuthUser(ctx, "google", "old-subject", "user_existing", "ada@example.com", "Ada", "", "tok", 0)
	if err != nil {
		t.Fatal(err)
	}
	if id != "user_existing" {
		t.Fatalf("id = %s", id)
	}
	again, err := s.UpsertOAuthUser(ctx, "github", "999", "someone-else", "ada@example.com", "Ada Lovelace", "", "tok2", 0)
	if err != nil {
		t.Fatal(err)
	}
	if again != "user_existing" {
		t.Fatalf("second id = %s", again)
	}
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("users = %d", n)
	}
	var accounts int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM accounts WHERE user_id = ?`, "user_existing").Scan(&accounts); err != nil {
		t.Fatal(err)
	}
	if accounts != 2 {
		t.Fatalf("accounts = %d", accounts)
	}
}

func TestASAPPersistsDisplacedTasks(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	userID, err := s.UpsertOAuthUser(ctx, "dev", "sam@example.com", "", "sam@example.com", "Sam", "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateTimezone(ctx, userID, "Pacific/Auckland"); err != nil {
		t.Fatal(err)
	}
	loc, _ := time.LoadLocation("Pacific/Auckland")
	now := time.Date(2026, 11, 9, 10, 0, 0, 0, loc)
	start := schedule.FormatStamp(now)
	end := schedule.FormatStamp(now.Add(time.Hour))
	other, err := s.InsertTask(ctx, s.DB, userID, TaskInput{Title: "Standup", Duration: intPtr(60), Start: &start, End: &end})
	if err != nil {
		t.Fatal(err)
	}
	focal, err := s.InsertTask(ctx, s.DB, userID, TaskInput{Title: "Urgent", Duration: intPtr(30)})
	if err != nil {
		t.Fatal(err)
	}
	_, changes, err := s.PlaceTask(ctx, userID, focal.ID, "asap", now)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 2 {
		t.Fatalf("changes = %+v", changes)
	}
	savedOther, err := s.getOwned(ctx, s.DB, userID, other.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := parsePtr(savedOther.ScheduledStart)
	want := now.Add(30 * time.Minute)
	if got == nil || !got.Equal(want) {
		t.Fatalf("displaced start = %v want %v", got, want)
	}
	savedFocal, err := s.getOwned(ctx, s.DB, userID, focal.ID)
	if err != nil {
		t.Fatal(err)
	}
	if parsePtr(savedFocal.ScheduledStart) == nil || !parsePtr(savedFocal.ScheduledStart).Equal(now) {
		t.Fatalf("focal start = %v", savedFocal.ScheduledStart)
	}
}

func intPtr(n int) *int { return &n }
