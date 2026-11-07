// Package schedule places and repacks tasks.
//
// Modes keep the public names used by the app and the external API.
// The policies are named for what the user is asking for:
//
//	now            next free opening, nobody else moves
//	today/tomorrow fit entirely inside that civil day, or fail
//	next-week      the next Monday–Sunday only
//	next-month     the next calendar month only
//	this/next-weekend
//	due-date       latest free slot that ends by the due time
//	asap           start at the next quarter-hour, then cascade movable tasks
//	smart          due-date, and if the day is blocked make room without
//	               pushing someone past their own due time
//
// CompressDay packs today's movable work forward. It does not pull later
// days into today. FillGroup packs one group's work from now and stops at
// the first task that belongs to someone else.
package schedule

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	grid = 15 * time.Minute
	// searchLimit caps how far a single placement may look.
	searchLimit = 30 * 24 * time.Hour
	// compressDays is how far today's overflow may spill.
	compressDays = 7
)

// Modes accepted by POST /api/tasks/{id}/schedule.
var Modes = []string{
	"now",
	"today",
	"tomorrow",
	"next-week",
	"this-weekend",
	"next-weekend",
	"next-month",
	"asap",
	"due-date",
	"smart",
}

// ValidMode reports whether mode is part of the public contract.
func ValidMode(mode string) bool {
	for _, m := range Modes {
		if m == mode {
			return true
		}
	}
	return false
}

// Failure is a placement refusal the HTTP layer maps to a status code.
type Failure struct {
	Code string
	Msg  string
}

func (f *Failure) Error() string { return f.Msg }

func fail(code, msg string) *Failure { return &Failure{Code: code, Msg: msg} }

// DayWindow is the open clock span for one weekday. End is exclusive.
type DayWindow struct {
	Open  bool
	Start int
	End   int
}

// Week is indexed by time.Weekday (Sunday = 0).
type Week struct {
	Days [7]DayWindow
}

// DefaultWeek is 09:00–17:00 every day, used when a user has no hours saved.
func DefaultWeek() Week {
	var w Week
	for i := range w.Days {
		w.Days[i] = DayWindow{Open: true, Start: 9, End: 17}
	}
	return w
}

// ParseHours reads the JSON stored in awake_hours / auto_schedule_hours.
// An empty document means the default week. A document that names only some
// days leaves the other days closed.
func ParseHours(raw string) Week {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" || raw == "{}" {
		return DefaultWeek()
	}
	var m map[string]*struct {
		Start int `json:"start"`
		End   int `json:"end"`
	}
	if err := json.Unmarshal([]byte(raw), &m); err != nil || len(m) == 0 {
		return DefaultWeek()
	}
	names := []string{"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"}
	var w Week
	any := false
	for i, name := range names {
		sp, ok := m[name]
		if !ok || sp == nil || sp.End <= sp.Start {
			continue
		}
		w.Days[i] = DayWindow{Open: true, Start: sp.Start, End: sp.End}
		any = true
	}
	if !any {
		return DefaultWeek()
	}
	return w
}

// Item is the slice of a task the scheduler needs. Owned is false for tasks
// that appear on the calendar through a share; those block time and never move.
type Item struct {
	ID        string
	Duration  int
	Start     *time.Time
	End       *time.Time
	Due       *time.Time
	Locked    bool
	Status    string
	Priority  int
	GroupID   string
	ParentID  string
	StepOrder int
	DependsOn []string
	Owned     bool
}

// Change is one row to write. Clear removes scheduled_start and scheduled_end.
type Change struct {
	ID    string
	Start time.Time
	End   time.Time
	Clear bool
}

// Result is the full set of rows a placement wants written in one transaction.
type Result struct {
	Changes []Change
}

// Request is one scheduling operation.
type Request struct {
	Mode    string
	FocalID string
	GroupID string
	Now     time.Time
	// From is the earliest instant a chained subtask may start.
	// The zero value means "start from Now".
	From       time.Time
	Loc        *time.Location
	Awake      Week
	GroupHours map[string]Week
	Items      []Item
}

// Place schedules the focal task, or its children when it is a parent.
func Place(r Request) (Result, error) {
	if r.Loc == nil {
		r.Loc = time.UTC
	}
	if !ValidMode(r.Mode) {
		return Result{}, fail("bad_mode", "unknown scheduling mode")
	}
	focal, ok := findItem(r.Items, r.FocalID)
	if !ok {
		return Result{}, fail("not_found", "task not found")
	}
	kids := children(r.Items, focal.ID)
	if len(kids) > 0 {
		return placeChildren(r, focal, kids)
	}
	return placeOne(r, focal, nil)
}

// CompressDay repacks movable tasks that are already scheduled on the civil
// day of day. Later days stay where they are, except that overflow from today
// may land on them without moving their existing tasks.
func CompressDay(r Request, day time.Time) (Result, error) {
	if r.Loc == nil {
		r.Loc = time.UTC
	}
	day = civilDay(day, r.Loc)
	var movable []Item
	for _, it := range r.Items {
		if !it.Owned || !isMovable(it) || it.Start == nil || it.End == nil {
			continue
		}
		if !sameDay(*it.Start, day, r.Loc) {
			continue
		}
		if it.Duration <= 0 {
			continue
		}
		movable = append(movable, it)
	}
	sort.SliceStable(movable, func(i, j int) bool {
		if !movable[i].Start.Equal(*movable[j].Start) {
			return movable[i].Start.Before(*movable[j].Start)
		}
		di, dj := dueOrMax(movable[i]), dueOrMax(movable[j])
		if !di.Equal(dj) {
			return di.Before(dj)
		}
		if movable[i].Priority != movable[j].Priority {
			return movable[i].Priority < movable[j].Priority
		}
		return movable[i].ID < movable[j].ID
	})

	skip := map[string]bool{}
	for _, it := range movable {
		skip[it.ID] = true
	}
	blocks := blocksExcept(r.Items, skip)
	cursor := Ceil15(r.Now)
	limit := day.AddDate(0, 0, compressDays)
	var changes []Change
	for _, it := range movable {
		dur := time.Duration(it.Duration) * time.Minute
		slot, ok := searchForward(cursor, limit, dur, r.Awake, r.Loc, blocks)
		if !ok {
			continue
		}
		blocks = append(blocks, span{Start: slot, End: slot.Add(dur), ID: it.ID})
		cursor = slot.Add(dur)
		if it.Start != nil && it.Start.Equal(slot) && it.End != nil && it.End.Equal(slot.Add(dur)) {
			continue
		}
		changes = append(changes, Change{ID: it.ID, Start: slot, End: slot.Add(dur)})
	}
	return Result{Changes: changes}, nil
}

// FillGroup packs one group's movable work from now.
// Another group's task, or a locked / in-progress task, is a wall.
// The pack stops at the first wall instead of jumping past it.
func FillGroup(r Request) (Result, error) {
	if r.Loc == nil {
		r.Loc = time.UTC
	}
	if r.GroupID == "" {
		return Result{}, fail("bad_request", "group_id is required")
	}
	hours := r.Awake
	if h, ok := r.GroupHours[r.GroupID]; ok {
		hours = h
	}
	var candidates []Item
	var walls []span
	for _, it := range r.Items {
		if it.GroupID == r.GroupID && it.Owned && isMovable(it) && it.Duration > 0 && relevantToFill(it, r.Now) {
			candidates = append(candidates, it)
			continue
		}
		if occupies(it) {
			walls = append(walls, span{Start: *it.Start, End: *it.End, ID: it.ID})
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority < candidates[j].Priority
		}
		di, dj := dueOrMax(candidates[i]), dueOrMax(candidates[j])
		if !di.Equal(dj) {
			return di.Before(dj)
		}
		si, sj := startOrMax(candidates[i]), startOrMax(candidates[j])
		if !si.Equal(sj) {
			return si.Before(sj)
		}
		return candidates[i].ID < candidates[j].ID
	})

	cursor := Ceil15(r.Now)
	horizon := r.Now.Add(14 * 24 * time.Hour)
	var changes []Change
	for _, it := range candidates {
		dur := time.Duration(it.Duration) * time.Minute
		placed := false
		guard := 0
		try := cursor
		for guard < 40 && try.Before(horizon) {
			guard++
			start, ok := snapOpen(try, hours, r.Loc)
			if !ok || !start.Before(horizon) {
				try = horizon
				break
			}
			ws, we, open := dayWindow(civilDay(start, r.Loc), hours, r.Loc)
			if !open {
				try = start.Add(time.Hour)
				continue
			}
			if start.Before(ws) {
				start = ws
			}
			end := start.Add(dur)
			if end.After(we) {
				// The open part of the day is not a wall. Try the next morning.
				nextDay := civilDay(start, r.Loc).AddDate(0, 0, 1)
				try = nextDay
				continue
			}
			if overlaps(start, end, walls) {
				// Stop the whole pack. Do not jump the gap.
				try = horizon
				break
			}
			if it.Start == nil || !it.Start.Equal(start) || it.End == nil || !it.End.Equal(end) {
				changes = append(changes, Change{ID: it.ID, Start: start, End: end})
			}
			cursor = end
			placed = true
			break
		}
		if !placed {
			break
		}
	}
	return Result{Changes: changes}, nil
}

func placeChildren(r Request, parent Item, kids []Item) (Result, error) {
	sort.SliceStable(kids, func(i, j int) bool {
		if kids[i].StepOrder != kids[j].StepOrder {
			return kids[i].StepOrder < kids[j].StepOrder
		}
		return kids[i].ID < kids[j].ID
	})
	working := append([]Item(nil), r.Items...)
	var all []Change
	cursor := r.Now
	var prevEnd time.Time
	seenFlexible := false
	for _, kid := range kids {
		if kid.Duration <= 0 {
			return Result{}, fail("no_duration", "task has no duration")
		}
		if kid.Locked {
			if kid.Start == nil || kid.End == nil || (!prevEnd.IsZero() && kid.Start.Before(prevEnd)) {
				return Result{}, fail("locked_subtask", "a pinned step cannot move to follow the previous step")
			}
			prevEnd = *kid.End
			cursor = prevEnd
			continue
		}
		if kid.Due == nil && parent.Due != nil {
			due := *parent.Due
			kid.Due = &due
		}
		sub := r
		sub.FocalID = kid.ID
		sub.Items = working
		sub.From = cursor
		// Only the first movable step uses displacement or a backward search.
		// The rest follow it, still inside the same window.
		if seenFlexible && (r.Mode == "asap" || r.Mode == "smart" || r.Mode == "due-date") {
			sub.Mode = "now"
			if parent.Due != nil && (r.Mode == "smart" || r.Mode == "due-date") {
				due := *parent.Due
				kid.Due = &due
				sub.Mode = "today"
				// Bound the follower by the parent's due instant via a synthetic window:
				// "now" would spill past the due date, so keep due-date for followers too
				// but start at the cursor. placeOne's due-date search is backward, which
				// would stack steps. Chain them forward instead.
				one, err := chainForward(sub, kid, cursor, due)
				if err != nil {
					return Result{}, err
				}
				all = append(all, one.Changes...)
				working = applyLocal(working, one.Changes)
				for _, ch := range one.Changes {
					if ch.ID == kid.ID && !ch.Clear {
						prevEnd = ch.End
						cursor = ch.End
					}
				}
				continue
			}
		}
		seenFlexible = true
		one, err := placeOne(sub, kid, nil)
		if err != nil {
			return Result{}, err
		}
		all = append(all, one.Changes...)
		working = applyLocal(working, one.Changes)
		for _, ch := range one.Changes {
			if ch.ID == kid.ID && !ch.Clear {
				prevEnd = ch.End
				cursor = ch.End
			}
		}
	}
	all = append(all, Change{ID: parent.ID, Clear: true})
	return Result{Changes: all}, nil
}

// chainForward places a follower so it starts at or after cursor and ends by until.
func chainForward(r Request, focal Item, cursor, until time.Time) (Result, error) {
	earliest, err := dependencyEarliest(focal, r.Items)
	if err != nil {
		return Result{}, err
	}
	from := later(Ceil15(cursor), earliest)
	blocks := blocksExcept(r.Items, map[string]bool{focal.ID: true})
	dur := time.Duration(focal.Duration) * time.Minute
	slot, ok := searchForward(from, until, dur, hoursFor(r, focal), r.Loc, blocks)
	if !ok {
		return Result{}, fail("no_slot", "the steps do not fit before the due date")
	}
	return Result{Changes: []Change{{ID: focal.ID, Start: slot, End: slot.Add(dur)}}}, nil
}

// placeOne schedules a single task.
func placeOne(r Request, focal Item, _ *time.Time) (Result, error) {
	if focal.Duration <= 0 {
		return Result{}, fail("no_duration", "task has no duration")
	}
	earliest, err := dependencyEarliest(focal, r.Items)
	if err != nil {
		return Result{}, err
	}
	hours := hoursFor(r, focal)
	searchFrom := r.Now
	if !r.From.IsZero() && r.From.After(searchFrom) {
		searchFrom = r.From
	}
	switch r.Mode {
	case "asap":
		if !r.From.IsZero() && r.From.After(r.Now) {
			return chainForward(r, focal, searchFrom, searchFrom.Add(searchLimit))
		}
		return placeASAP(r, focal, earliest, hours)
	case "smart":
		return placeSmart(r, focal, earliest, hours)
	case "due-date":
		if focal.Due == nil {
			return Result{}, fail("needs_due", "due-date requires a due date")
		}
		blocks := blocksExcept(r.Items, map[string]bool{focal.ID: true})
		notBefore := later(Ceil15(searchFrom), earliest)
		slot, ok := searchBackward(notBefore, *focal.Due, time.Duration(focal.Duration)*time.Minute, hours, r.Loc, blocks)
		if !ok {
			return Result{}, fail("no_slot", "no open slot before the due date")
		}
		return Result{Changes: []Change{{ID: focal.ID, Start: slot, End: slot.Add(time.Duration(focal.Duration) * time.Minute)}}}, nil
	default:
		from, until, err := window(r.Mode, r.Now, r.Loc)
		if err != nil {
			return Result{}, err
		}
		if searchFrom.After(from) {
			from = searchFrom
		}
		from = later(Ceil15(from), earliest)
		blocks := blocksExcept(r.Items, map[string]bool{focal.ID: true})
		dur := time.Duration(focal.Duration) * time.Minute
		slot, ok := searchForward(from, until, dur, hours, r.Loc, blocks)
		if !ok {
			return Result{}, fail("no_slot", "no open slot in that window")
		}
		return Result{Changes: []Change{{ID: focal.ID, Start: slot, End: slot.Add(dur)}}}, nil
	}
}

func placeASAP(r Request, focal Item, earliest time.Time, _ Week) (Result, error) {
	dur := time.Duration(focal.Duration) * time.Minute
	start := later(Ceil15(r.Now), earliest)
	blocks := blocksExcept(r.Items, map[string]bool{focal.ID: true})
	for i := 0; i < 500; i++ {
		w, hit := firstWall(start, start.Add(dur), r.Items, focal.ID)
		if !hit {
			break
		}
		start = later(Ceil15(w.End), earliest)
	}
	if wall, hit := firstWall(start, start.Add(dur), r.Items, focal.ID); hit {
		return Result{}, fail("no_slot", "pinned work occupies the only place to start")
	} else {
		_ = wall
	}

	focalEnd := start.Add(dur)
	displaced := map[string]bool{}
	queue := overlappingMovable(r.Items, focal.ID, start, focalEnd)
	var changes []Change
	changes = append(changes, Change{ID: focal.ID, Start: start, End: focalEnd})
	blocks = append(blocksExcept(r.Items, map[string]bool{focal.ID: true}), span{Start: start, End: focalEnd, ID: focal.ID})

	guard := 0
	for len(queue) > 0 {
		guard++
		if guard > 200 {
			return Result{}, fail("no_slot", "could not make room for the tasks that were in the way")
		}
		id := queue[0]
		queue = queue[1:]
		if displaced[id] {
			continue
		}
		it, ok := findItem(r.Items, id)
		if !ok || !isMovable(it) {
			continue
		}
		displaced[id] = true
		blocks = removeSpan(blocks, id)
		theirHours := hoursFor(r, it)
		theirDur := time.Duration(it.Duration) * time.Minute
		slot, found := searchForward(focalEnd, focalEnd.Add(searchLimit), theirDur, theirHours, r.Loc, blocks)
		if !found {
			return Result{}, fail("no_slot", "could not find a later slot for a task that had to move")
		}
		end := slot.Add(theirDur)
		blocks = append(blocks, span{Start: slot, End: end, ID: id})
		changes = append(changes, Change{ID: id, Start: slot, End: end})
		for _, extra := range overlappingMovable(r.Items, focal.ID, slot, end) {
			if extra != id && !displaced[extra] {
				queue = append(queue, extra)
			}
		}
	}
	return Result{Changes: changes}, nil
}

func placeSmart(r Request, focal Item, earliest time.Time, hours Week) (Result, error) {
	if focal.Due == nil {
		return Result{}, fail("needs_due", "smart requires a due date")
	}
	dur := time.Duration(focal.Duration) * time.Minute
	notBefore := later(Ceil15(r.Now), earliest)
	blocks := blocksExcept(r.Items, map[string]bool{focal.ID: true})
	if slot, ok := searchBackward(notBefore, *focal.Due, dur, hours, r.Loc, blocks); ok {
		return Result{Changes: []Change{{ID: focal.ID, Start: slot, End: slot.Add(dur)}}}, nil
	}

	// Only walls remain, so we can see whether a slot exists at all.
	var wallBlocks []span
	for _, it := range r.Items {
		if it.ID == focal.ID || !occupies(it) || isMovable(it) {
			continue
		}
		wallBlocks = append(wallBlocks, span{Start: *it.Start, End: *it.End, ID: it.ID})
	}
	slot, ok := searchBackward(notBefore, *focal.Due, dur, hours, r.Loc, wallBlocks)
	if !ok {
		return Result{}, fail("no_slot", "pinned work leaves no room before the due date")
	}
	focalEnd := slot.Add(dur)
	victims := overlappingMovable(r.Items, focal.ID, slot, focalEnd)
	sort.SliceStable(victims, func(i, j int) bool {
		a, _ := findItem(r.Items, victims[i])
		b, _ := findItem(r.Items, victims[j])
		return dueOrMax(a).After(dueOrMax(b))
	})

	blocks = append(wallBlocks, span{Start: slot, End: focalEnd, ID: focal.ID})
	// Keep non-victim movable tasks as blocks too.
	victimSet := map[string]bool{}
	for _, id := range victims {
		victimSet[id] = true
	}
	for _, it := range r.Items {
		if it.ID == focal.ID || victimSet[it.ID] || !occupies(it) || !isMovable(it) {
			continue
		}
		blocks = append(blocks, span{Start: *it.Start, End: *it.End, ID: it.ID})
	}

	changes := []Change{{ID: focal.ID, Start: slot, End: focalEnd}}
	for _, id := range victims {
		it, _ := findItem(r.Items, id)
		theirDur := time.Duration(it.Duration) * time.Minute
		limit := focalEnd.Add(searchLimit)
		if it.Due != nil {
			limit = *it.Due
		}
		if !limit.After(focalEnd) {
			return Result{}, fail("no_slot", "making room would push another task past its due date")
		}
		moved, found := searchForward(focalEnd, limit, theirDur, hoursFor(r, it), r.Loc, blocks)
		if !found || moved.Add(theirDur).After(limit) {
			return Result{}, fail("no_slot", "making room would push another task past its due date")
		}
		end := moved.Add(theirDur)
		blocks = append(blocks, span{Start: moved, End: end, ID: id})
		changes = append(changes, Change{ID: id, Start: moved, End: end})
	}
	return Result{Changes: changes}, nil
}

func window(mode string, now time.Time, loc *time.Location) (from, until time.Time, err error) {
	switch mode {
	case "now":
		return now, now.Add(searchLimit), nil
	case "today":
		start := civilDay(now, loc)
		return now, start.AddDate(0, 0, 1), nil
	case "tomorrow":
		start := civilDay(now, loc).AddDate(0, 0, 1)
		return start, start.AddDate(0, 0, 1), nil
	case "next-week":
		mon := nextMonday(now, loc)
		return mon, mon.AddDate(0, 0, 7), nil
	case "next-month":
		lt := now.In(loc)
		start := time.Date(lt.Year(), lt.Month()+1, 1, 0, 0, 0, 0, loc)
		end := time.Date(lt.Year(), lt.Month()+2, 1, 0, 0, 0, 0, loc)
		return start, end, nil
	case "this-weekend":
		return weekendRange(now, loc, false)
	case "next-weekend":
		return weekendRange(now, loc, true)
	default:
		return time.Time{}, time.Time{}, fail("bad_mode", "unknown scheduling mode")
	}
}

func weekendRange(now time.Time, loc *time.Location, next bool) (time.Time, time.Time, error) {
	day := civilDay(now, loc)
	wd := day.Weekday()
	if !next && wd == time.Sunday {
		return now, day.AddDate(0, 0, 1), nil
	}
	var sat time.Time
	switch wd {
	case time.Saturday:
		sat = day
		if next {
			sat = day.AddDate(0, 0, 7)
		}
	case time.Sunday:
		sat = day.AddDate(0, 0, 6)
	default:
		sat = day.AddDate(0, 0, int(time.Saturday-wd))
		if next {
			sat = sat.AddDate(0, 0, 7)
		}
	}
	return sat, sat.AddDate(0, 0, 2), nil
}

func nextMonday(now time.Time, loc *time.Location) time.Time {
	day := civilDay(now, loc)
	wd := day.Weekday()
	delta := (8 - int(wd)) % 7
	if delta == 0 {
		delta = 7
	}
	return day.AddDate(0, 0, delta)
}

func dependencyEarliest(focal Item, items []Item) (time.Time, error) {
	var earliest time.Time
	byID := indexItems(items)
	for _, id := range focal.DependsOn {
		dep, ok := byID[id]
		if !ok {
			return time.Time{}, fail("blocked", "this task depends on work that is not on the calendar")
		}
		switch dep.Status {
		case "completed", "cancelled", "rescheduled":
			continue
		}
		if dep.End == nil {
			return time.Time{}, fail("blocked", "this task depends on work that has no time yet")
		}
		if dep.End.After(earliest) {
			earliest = *dep.End
		}
	}
	return earliest, nil
}

type span struct {
	Start time.Time
	End   time.Time
	ID    string
}

func searchForward(from, until time.Time, dur time.Duration, hours Week, loc *time.Location, blocks []span) (time.Time, bool) {
	if dur <= 0 || !until.After(from) {
		return time.Time{}, false
	}
	cursor := Ceil15(from)
	steps := 0
	for cursor.Before(until) && steps < 20000 {
		steps++
		start, ok := snapOpen(cursor, hours, loc)
		if !ok || !start.Before(until) {
			return time.Time{}, false
		}
		cursor = start
		_, we, open := dayWindow(civilDay(cursor, loc), hours, loc)
		if !open {
			cursor = cursor.Add(24 * time.Hour)
			continue
		}
		end := cursor.Add(dur)
		if end.After(we) || end.After(until) {
			if end.After(until) && !cursor.Before(until) {
				return time.Time{}, false
			}
			next := civilDay(cursor, loc).AddDate(0, 0, 1)
			if !next.Before(until) {
				return time.Time{}, false
			}
			cursor = next
			continue
		}
		if b, hit := overlapping(cursor, end, blocks); hit {
			cursor = Ceil15(b.End)
			continue
		}
		return cursor, true
	}
	return time.Time{}, false
}

func searchBackward(notBefore, deadline time.Time, dur time.Duration, hours Week, loc *time.Location, blocks []span) (time.Time, bool) {
	if dur <= 0 || !deadline.After(notBefore) {
		return time.Time{}, false
	}
	cursor := Floor15(deadline.Add(-dur))
	steps := 0
	for !cursor.Before(notBefore) && steps < 20000 {
		steps++
		end := cursor.Add(dur)
		if end.After(deadline) {
			cursor = cursor.Add(-grid)
			continue
		}
		ws, we, open := dayWindow(civilDay(cursor, loc), hours, loc)
		if !open || cursor.Before(ws) || end.After(we) {
			cursor = cursor.Add(-grid)
			continue
		}
		if b, hit := overlapping(cursor, end, blocks); hit {
			jumped := Floor15(b.Start.Add(-dur))
			if !jumped.Before(cursor) {
				jumped = cursor.Add(-grid)
			}
			cursor = jumped
			continue
		}
		return cursor, true
	}
	return time.Time{}, false
}

func snapOpen(from time.Time, hours Week, loc *time.Location) (time.Time, bool) {
	day := civilDay(from, loc)
	for i := 0; i < 40; i++ {
		ws, we, ok := dayWindow(day, hours, loc)
		if ok && we.After(from) {
			if from.Before(ws) {
				return ws, true
			}
			return from, true
		}
		day = day.AddDate(0, 0, 1)
	}
	return time.Time{}, false
}

func dayWindow(day time.Time, hours Week, loc *time.Location) (time.Time, time.Time, bool) {
	d := hours.Days[day.In(loc).Weekday()]
	if !d.Open || d.End <= d.Start {
		return time.Time{}, time.Time{}, false
	}
	start := time.Date(day.Year(), day.Month(), day.Day(), d.Start, 0, 0, 0, loc)
	end := time.Date(day.Year(), day.Month(), day.Day(), d.End, 0, 0, 0, loc)
	return start, end, true
}

func civilDay(t time.Time, loc *time.Location) time.Time {
	lt := t.In(loc)
	return time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, loc)
}

func sameDay(a, day time.Time, loc *time.Location) bool {
	aa := a.In(loc)
	dd := day.In(loc)
	return aa.Year() == dd.Year() && aa.YearDay() == dd.YearDay()
}

// Ceil15 snaps up to the next 15-minute boundary. An exact boundary stays put.
func Ceil15(t time.Time) time.Time {
	tr := t.Truncate(grid)
	if tr.Equal(t) {
		return t
	}
	return tr.Add(grid)
}

// Floor15 snaps down to the previous 15-minute boundary.
func Floor15(t time.Time) time.Time {
	return t.Truncate(grid)
}

func hoursFor(r Request, it Item) Week {
	if it.GroupID != "" {
		if h, ok := r.GroupHours[it.GroupID]; ok {
			return h
		}
	}
	return r.Awake
}

func occupies(it Item) bool {
	if it.Start == nil || it.End == nil {
		return false
	}
	switch it.Status {
	case "completed", "cancelled", "rescheduled":
		return false
	default:
		return true
	}
}

func isMovable(it Item) bool {
	if !it.Owned || it.Locked || it.Status == "in_progress" || it.Duration <= 0 {
		return false
	}
	switch it.Status {
	case "completed", "cancelled", "rescheduled":
		return false
	default:
		return true
	}
}

func relevantToFill(it Item, now time.Time) bool {
	if it.Start == nil || it.End == nil {
		return true
	}
	return it.End.After(now)
}

func blocksExcept(items []Item, skip map[string]bool) []span {
	var out []span
	for _, it := range items {
		if skip[it.ID] || !occupies(it) {
			continue
		}
		out = append(out, span{Start: *it.Start, End: *it.End, ID: it.ID})
	}
	return out
}

func overlapping(start, end time.Time, blocks []span) (span, bool) {
	var found span
	ok := false
	for _, b := range blocks {
		if start.Before(b.End) && b.Start.Before(end) {
			if !ok || b.End.After(found.End) {
				found = b
				ok = true
			}
		}
	}
	return found, ok
}

func overlaps(start, end time.Time, blocks []span) bool {
	_, ok := overlapping(start, end, blocks)
	return ok
}

func firstWall(start, end time.Time, items []Item, self string) (span, bool) {
	var found span
	ok := false
	for _, it := range items {
		if it.ID == self || !occupies(it) || isMovable(it) {
			continue
		}
		if start.Before(*it.End) && it.Start.Before(end) {
			s := span{Start: *it.Start, End: *it.End, ID: it.ID}
			if !ok || s.End.After(found.End) {
				found = s
				ok = true
			}
		}
	}
	return found, ok
}

func overlappingMovable(items []Item, self string, start, end time.Time) []string {
	var ids []string
	for _, it := range items {
		if it.ID == self || !occupies(it) || !isMovable(it) {
			continue
		}
		if start.Before(*it.End) && it.Start.Before(end) {
			ids = append(ids, it.ID)
		}
	}
	sort.Slice(ids, func(i, j int) bool {
		a, _ := findItem(items, ids[i])
		b, _ := findItem(items, ids[j])
		if a.Start == nil || b.Start == nil {
			return ids[i] < ids[j]
		}
		if !a.Start.Equal(*b.Start) {
			return a.Start.Before(*b.Start)
		}
		return ids[i] < ids[j]
	})
	return ids
}

func removeSpan(blocks []span, id string) []span {
	out := blocks[:0]
	for _, b := range blocks {
		if b.ID != id {
			out = append(out, b)
		}
	}
	return out
}

func findItem(items []Item, id string) (Item, bool) {
	for _, it := range items {
		if it.ID == id {
			return it, true
		}
	}
	return Item{}, false
}

func indexItems(items []Item) map[string]Item {
	m := make(map[string]Item, len(items))
	for _, it := range items {
		m[it.ID] = it
	}
	return m
}

func children(items []Item, parent string) []Item {
	var kids []Item
	for _, it := range items {
		if it.ParentID == parent {
			kids = append(kids, it)
		}
	}
	return kids
}

func applyLocal(items []Item, changes []Change) []Item {
	byID := map[string]int{}
	for i, it := range items {
		byID[it.ID] = i
	}
	for _, ch := range changes {
		i, ok := byID[ch.ID]
		if !ok {
			continue
		}
		if ch.Clear {
			items[i].Start = nil
			items[i].End = nil
			continue
		}
		start, end := ch.Start, ch.End
		items[i].Start = &start
		items[i].End = &end
	}
	return items
}

func later(a, b time.Time) time.Time {
	if b.After(a) {
		return Ceil15(b)
	}
	return a
}

func dueOrMax(it Item) time.Time {
	if it.Due == nil {
		return time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	return *it.Due
}

func startOrMax(it Item) time.Time {
	if it.Start == nil {
		return time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	return *it.Start
}

// FormatStamp writes the UTC timestamp the rest of the app stores.
func FormatStamp(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// ParseStamp accepts the ISO timestamps already stored in Turso.
func ParseStamp(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, errors.New("empty time")
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognized time %q", s)
}
