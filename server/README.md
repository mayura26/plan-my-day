# Plan My Day server

Go API and static web app. The Next.js app stays in this repo until you cut over.

## Run locally

From `server/`:

```bash
# Existing Turso database. Copy nothing. Do not run the schema against it.
go run ./cmd/server

# Isolated local database, with a development sign-in that never runs in production.
ALLOW_DEV_LOGIN=1 SQLITE_PATH=../tmp-plan.db PORT=8080 go run ./cmd/server
```

The process reads `../.env.local` for `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, OAuth client ids, `OPENAI_API_KEY`, VAPID keys, and `NEXTAUTH_SECRET` (used to verify push action links). `SQLITE_PATH` wins over Turso so a local file cannot write the shared database by accident.

Open http://localhost:8080. The Next.js app can keep using port 3000. Use one app at a time for a given person when both point at Turso, because both write the same `tasks` table.

## Compare the two apps

This writes two identical local files and does not touch Turso. `SEED_EMAIL` must be the address you will sign in with.

```bash
# from server/
SEED_EMAIL=you@example.com go run ./cmd/seed

# from the repo root, Next.js on the first file
TURSO_DATABASE_URL=file:dummy/next.db npm run dev

# from server/, Go on the second file
ALLOW_DEV_LOGIN=1 SQLITE_PATH=../dummy/go.db PORT=8080 PUBLIC_URL=http://localhost:8080 go run ./cmd/server
```

Sign in to Next.js with Google as `SEED_EMAIL`. Sign in to the Go app with that same email. The calendars start with the same groups and the same week of tasks.

OAuth redirect URLs to register:

- `http://localhost:8080/auth/callback/google`
- `http://localhost:8080/auth/callback/github`
- `https://YOUR_HOST/auth/callback/google`
- `https://YOUR_HOST/auth/callback/github`

Set `PUBLIC_URL` to that origin so the callbacks match.

Reminders:

```bash
go run ./cmd/reminders
```

Or `GET /api/cron/process-reminders` with `Authorization: Bearer $CRON_SECRET`.

## Tests

```bash
go test ./...
```

Scheduler cases use `Pacific/Auckland`. They do not need Turso.

## Cutover

1. Deploy this process with the same `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Do not run `schema.sql` against that database.
2. Add the production OAuth redirect URLs above. `PUBLIC_URL` must be the public origin.
3. Point the host at this server. Keep the Next.js tree in the repo.
4. Smoke check: `GET /api/health` returns `{"ok":true,"db":"up"}`. Sign in with the same Google or GitHub email and confirm the calendar shows the existing tasks.
5. Point external clients at the same `/api/tasks/import`, `/api/tasks/agenda`, `/api/tasks/{id}/complete`, and `/api/tasks/{id}/schedule` paths. Existing `pmy_` keys keep working. `next-week` and `next-month` now stay inside the named window; that change is documented in `API_DOCUMENTATION.md`.
6. Move the reminder cron to `go run ./cmd/reminders`.
7. Remove the Next.js app only after that check, in a later change.
