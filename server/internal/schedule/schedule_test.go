package schedule

import (
	"errors"
	"testing"
	"time"
)

func auckland(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Pacific/Auckland")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func at(loc *time.Location, y, m, d, h, min int) time.Time {
	return time.Date(y, time.Month(m), d, h, min, 0, 0, loc)
}

func owned(id string, dur int, start, end *time.Time) Item {
	return Item{ID: id, Duration: dur, Start: start, End: end, Status: "pending", Owned: true, Priority: 3}
}

func ptr(t time.Time) *time.Time { return &t }

func codeOf(err error) string {
	var f *Failure
	if errors.As(err, &f) {
		return f.Code
	}
	return ""
}

func TestNowDoesNotMoveOtherTasks(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 9, 10, 0)
	other := owned("other", 60, ptr(at(loc, 2026, 11, 9, 10, 0)), ptr(at(loc, 2026, 11, 9, 11, 0)))
	focal := owned("new", 30, nil, nil)
	res, err := Place(Request{
		Mode: "now", FocalID: "new", Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: []Item{focal, other},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Changes) != 1 || res.Changes[0].ID != "new" {
		t.Fatalf("changes = %+v", res.Changes)
	}
	if !res.Changes[0].Start.Equal(at(loc, 2026, 11, 9, 11, 0)) {
		t.Fatalf("start = %s", res.Changes[0].Start)
	}
}

func TestASAPPlacesAtNowAndDisplaces(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 9, 10, 0)
	other := owned("other", 60, ptr(now), ptr(at(loc, 2026, 11, 9, 11, 0)))
	focal := owned("new", 30, nil, nil)
	res, err := Place(Request{
		Mode: "asap", FocalID: "new", Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: []Item{focal, other},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Changes) != 2 {
		t.Fatalf("changes = %+v", res.Changes)
	}
	byID := map[string]Change{}
	for _, ch := range res.Changes {
		byID[ch.ID] = ch
	}
	if !byID["new"].Start.Equal(now) || !byID["new"].End.Equal(at(loc, 2026, 11, 9, 10, 30)) {
		t.Fatalf("focal = %+v", byID["new"])
	}
	if !byID["other"].Start.Equal(at(loc, 2026, 11, 9, 10, 30)) {
		t.Fatalf("displaced = %+v", byID["other"])
	}
}

func TestTodayDoesNotSpillIntoTomorrow(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 9, 16, 30)
	focal := owned("new", 60, nil, nil)
	_, err := Place(Request{
		Mode: "today", FocalID: "new", Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: []Item{focal},
	})
	if codeOf(err) != "no_slot" {
		t.Fatalf("err = %v", err)
	}
}

func TestNextWeekStaysInsideTheWeek(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 4, 10, 0) // Wednesday; next week is Mon 9 – Sun 15
	items := []Item{owned("new", 60, nil, nil)}
	for day := 9; day <= 15; day++ {
		start := at(loc, 2026, 11, day, 9, 0)
		end := at(loc, 2026, 11, day, 17, 0)
		wall := owned("wall", 8*60, &start, &end)
		wall.Locked = true
		wall.ID = start.Format("wall-02")
		items = append(items, wall)
	}
	_, err := Place(Request{
		Mode: "next-week", FocalID: "new", Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: items,
	})
	if codeOf(err) != "no_slot" {
		t.Fatalf("err = %v", err)
	}
}

func TestNextMonthStaysInsideTheMonth(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 7, 10, 0)
	items := []Item{owned("new", 60, nil, nil)}
	for day := 1; day <= 31; day++ {
		start := at(loc, 2026, 12, day, 9, 0)
		end := at(loc, 2026, 12, day, 17, 0)
		wall := owned("w", 8*60, &start, &end)
		wall.Locked = true
		wall.ID = start.Format("dec-02")
		items = append(items, wall)
	}
	_, err := Place(Request{
		Mode: "next-month", FocalID: "new", Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: items,
	})
	if codeOf(err) != "no_slot" {
		t.Fatalf("err = %v", err)
	}
}

func TestCompressDayDoesNotPullFutureDays(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 9, 9, 0)
	today := owned("today", 60, ptr(at(loc, 2026, 11, 9, 15, 0)), ptr(at(loc, 2026, 11, 9, 16, 0)))
	tomorrowStart := at(loc, 2026, 11, 10, 10, 0)
	tomorrow := owned("tomorrow", 60, &tomorrowStart, ptr(at(loc, 2026, 11, 10, 11, 0)))
	res, err := CompressDay(Request{
		Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: []Item{today, tomorrow},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Changes) != 1 || res.Changes[0].ID != "today" {
		t.Fatalf("changes = %+v", res.Changes)
	}
	if !res.Changes[0].Start.Equal(now) {
		t.Fatalf("packed start = %s", res.Changes[0].Start)
	}
}

func TestFillGroupStopsAtAnotherGroup(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 9, 9, 0)
	wallStart := at(loc, 2026, 11, 9, 10, 0)
	wall := owned("wall", 60, &wallStart, ptr(at(loc, 2026, 11, 9, 11, 0)))
	wall.GroupID = "other"
	a := owned("a", 45, nil, nil)
	a.GroupID = "mine"
	b := owned("b", 45, nil, nil)
	b.GroupID = "mine"
	res, err := FillGroup(Request{
		GroupID: "mine", Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: []Item{wall, a, b},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Changes) != 1 || res.Changes[0].ID != "a" {
		t.Fatalf("changes = %+v", res.Changes)
	}
	if !res.Changes[0].Start.Equal(now) || !res.Changes[0].End.Equal(at(loc, 2026, 11, 9, 9, 45)) {
		t.Fatalf("placed = %+v", res.Changes[0])
	}
}

func TestUnscheduledDependencyBlocksPlacement(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 9, 10, 0)
	dep := owned("dep", 30, nil, nil)
	focal := owned("new", 30, nil, nil)
	focal.DependsOn = []string{"dep"}
	_, err := Place(Request{
		Mode: "now", FocalID: "new", Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: []Item{focal, dep},
	})
	if codeOf(err) != "blocked" {
		t.Fatalf("err = %v", err)
	}
}

func TestLockedTaskIsNotMovedByASAPOrCompress(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 9, 10, 0)
	pinned := owned("pinned", 60, ptr(now), ptr(at(loc, 2026, 11, 9, 11, 0)))
	pinned.Locked = true
	focal := owned("new", 30, nil, nil)
	res, err := Place(Request{
		Mode: "asap", FocalID: "new", Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: []Item{focal, pinned},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Changes) != 1 || res.Changes[0].ID != "new" {
		t.Fatalf("asap changes = %+v", res.Changes)
	}
	if !res.Changes[0].Start.Equal(at(loc, 2026, 11, 9, 11, 0)) {
		t.Fatalf("asap start = %s", res.Changes[0].Start)
	}

	morning := at(loc, 2026, 11, 9, 9, 0)
	movable := owned("later", 60, ptr(at(loc, 2026, 11, 9, 12, 0)), ptr(at(loc, 2026, 11, 9, 13, 0)))
	packed, err := CompressDay(Request{
		Now: morning, Loc: loc, Awake: DefaultWeek(),
		Items: []Item{pinned, movable},
	}, morning)
	if err != nil {
		t.Fatal(err)
	}
	if len(packed.Changes) != 1 || packed.Changes[0].ID != "later" {
		t.Fatalf("compress changes = %+v", packed.Changes)
	}
	if !packed.Changes[0].Start.Equal(morning) {
		t.Fatalf("compress start = %s", packed.Changes[0].Start)
	}
}

func TestLockedSubtaskCannotBeDraggedBeforeItsPredecessor(t *testing.T) {
	loc := auckland(t)
	now := at(loc, 2026, 11, 9, 9, 0)
	parent := owned("parent", 0, nil, nil)
	first := owned("s1", 60, nil, nil)
	first.ParentID = "parent"
	first.StepOrder = 1
	secondStart := at(loc, 2026, 11, 9, 9, 0)
	second := owned("s2", 30, &secondStart, ptr(at(loc, 2026, 11, 9, 9, 30)))
	second.ParentID = "parent"
	second.StepOrder = 2
	second.Locked = true
	_, err := Place(Request{
		Mode: "today", FocalID: "parent", Now: now, Loc: loc, Awake: DefaultWeek(),
		Items: []Item{parent, first, second},
	})
	if codeOf(err) != "locked_subtask" {
		t.Fatalf("err = %v", err)
	}
}

func TestModesMatchTheExternalContract(t *testing.T) {
	want := []string{"now", "today", "tomorrow", "next-week", "this-weekend", "next-weekend", "next-month", "asap", "due-date", "smart"}
	if len(Modes) != len(want) {
		t.Fatalf("modes = %v", Modes)
	}
	for i, m := range want {
		if Modes[i] != m || !ValidMode(m) {
			t.Fatalf("mode %d = %s", i, Modes[i])
		}
	}
	if ValidMode("shuffle") {
		t.Fatal("shuffle is a repack, not a place mode")
	}
}
