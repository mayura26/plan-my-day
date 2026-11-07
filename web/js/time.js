export function tzOffset(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour) % 24;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

export function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  return new Date(guess.getTime() - tzOffset(guess, timeZone));
}

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: parts.weekday,
    key: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function dayKey(date, timeZone) {
  return zonedParts(date, timeZone).key;
}

export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function startOfDayUtc(key, timeZone) {
  const [year, month, day] = key.split("-").map(Number);
  return zonedToUtc(year, month, day, 0, 0, timeZone);
}

export function formatTime(iso, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function formatDayTitle(date, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function hoursFor(awake, date, timeZone) {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" })
    .format(date)
    .toLowerCase();
  const index = names.indexOf(weekday);
  const day = awake?.[names[index]];
  if (day && Number.isFinite(day.start) && Number.isFinite(day.end) && day.end > day.start) {
    return day;
  }
  return { start: 9, end: 17 };
}

export function fromLocalValue(value, timeZone) {
  if (!value) return null;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return zonedToUtc(year, month, day, hour, minute, timeZone).toISOString();
}

export function toLocalValue(iso, timeZone) {
  if (!iso) return "";
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (n) => String(n).padStart(2, "0");
  return `${parts.key}T${pad(parts.hour)}:${pad(parts.minute)}`;
}
