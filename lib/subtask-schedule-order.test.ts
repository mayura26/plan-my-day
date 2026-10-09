import assert from "node:assert/strict";
import { test } from "node:test";
import { orderSubtaskSchedules } from "./subtask-schedule-order";
import type { Task } from "./types";

const at = (hour: number) => `2026-10-12T${String(hour).padStart(2, "0")}:00:00.000Z`;
const step = (id: string, order: number, start: number, end: number): Task => ({
  id,
  user_id: "user",
  title: id,
  priority: 3,
  status: "pending",
  duration: 60,
  scheduled_start: at(start),
  scheduled_end: at(end),
  locked: false,
  task_type: "subtask",
  notification_sent: false,
  lead_reminder_sent: false,
  due_reminder_sent: false,
  energy_level_required: 3,
  parent_task_id: "parent",
  step_order: order,
  ignored: false,
  created_at: at(0),
  updated_at: at(0),
});
const run = (tasks: Task[]) => orderSubtaskSchedules(tasks, new Set(["parent"]), [], null, "UTC");

test("rescheduling an earlier step cascades and avoids unrelated events", () => {
  const tasks = [
    step("first", 1, 11, 12),
    step("second", 2, 9, 10),
    step("third", 3, 10, 11),
    { ...step("meeting", 0, 12, 13), parent_task_id: null, locked: true },
  ];
  const moved = run(tasks);
  assert.deepEqual(
    moved.map((task) => [task.id, task.scheduled_start, task.scheduled_end]),
    [
      ["second", at(13), at(14)],
      ["third", at(14), at(15)],
    ]
  );
  assert.equal(tasks[1].scheduled_start, at(9), "planning must not mutate the original tasks");
});

test("reordering uses step order rather than current schedule or array order", () => {
  assert.equal(
    run([step("second", 2, 9, 10), step("first", 1, 10, 11)])[0].scheduled_start,
    at(11)
  );
});

test("valid gaps and completed steps are preserved", () => {
  assert.deepEqual(
    run([
      step("first", 1, 9, 10),
      step("second", 2, 12, 13),
      { ...step("completed", 3, 8, 9), status: "completed" },
    ]),
    []
  );
});

test("locked out-of-order step asks for clarification", () => {
  assert.throws(
    () => run([step("first", 1, 11, 12), { ...step("locked", 2, 9, 10), locked: true }]),
    /Unlock it/
  );
});

test("moving a step respects its group hours", () => {
  const tasks = [step("first", 1, 16, 17), { ...step("second", 2, 9, 10), group_id: "group" }];
  const moved = orderSubtaskSchedules(
    tasks,
    new Set(["parent"]),
    [
      {
        id: "group",
        user_id: "user",
        name: "Work",
        color: "blue",
        collapsed: false,
        created_at: at(0),
        updated_at: at(0),
        auto_schedule_enabled: true,
        auto_schedule_hours: { monday: { start: 9, end: 17 }, tuesday: { start: 9, end: 17 } },
      },
    ],
    null,
    "UTC"
  );
  assert.equal(moved[0].scheduled_start, "2026-10-13T09:00:00.000Z");
});

test("a calendar resize preserves the scheduled length when cascading", () => {
  const moved = run([step("first", 1, 11, 12), step("second", 2, 9, 11)]);
  assert.equal(moved[0].scheduled_end, at(14));
});
