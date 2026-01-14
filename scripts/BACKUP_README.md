# Database Backup Script

This directory contains scripts for backing up the Plan My Day database.

## Quick Start

### Manual Backup

Run a backup manually:

```bash
npm run db:backup
# or
node scripts/backup-db-cron.mjs
```

### Automated Daily Backups (Cron)

#### Setup

1. Make the setup script executable:
   ```bash
   chmod +x scripts/setup-backup-cron.sh
   ```

2. Run the setup script to get instructions:
   ```bash
   ./scripts/setup-backup-cron.sh
   ```

3. Edit your crontab:
   ```bash
   crontab -e
   ```

4. Add one of these lines:

   **Daily backup at 2 AM:**
   ```cron
   0 2 * * * cd /path/to/plan-my-day && node scripts/backup-db-cron.mjs >> logs/backup.log 2>&1
   ```

   **Multiple daily backups (every 6 hours):**
   ```cron
   0 */6 * * * cd /path/to/plan-my-day && node scripts/backup-db-cron.mjs >> logs/backup.log 2>&1
   ```

   **Weekly backup (every Sunday at 3 AM):**
   ```cron
   0 3 * * 0 cd /path/to/plan-my-day && node scripts/backup-db-cron.mjs >> logs/backup.log 2>&1
   ```

#### Configuration

The backup script supports environment variables:

- `BACKUPS_DIR` - Directory to store backups (default: `./backups`)
- `MAX_BACKUPS` - Maximum number of backups to keep (default: `30`)
- `COMPRESS_BACKUPS` - Whether to compress old backups (default: `false`)

Example `.env.local`:
```env
BACKUPS_DIR=/var/backups/plan-my-day
MAX_BACKUPS=90
```

## Backup Format

Backups are stored as JSON files with the following naming:
- `db-backup-YYYY-MM-DDTHH-MM-SS-sssZ.json` - Timestamped backups
- `db-backup-latest.json` - Always points to the most recent backup

Each backup file contains:
- Timestamp and date
- Complete data from all tables
- Version information

## Restoring from Backup

To restore from a backup, use the restore script:

```bash
node scripts/restore-full-db.mjs
```

This will restore:
1. Users (if missing)
2. Task groups
3. Tasks (parent tasks first, then subtasks)

## Backup Location

By default, backups are stored in:
- `./backups/` (relative to project root)

You can change this by setting the `BACKUPS_DIR` environment variable.

## Cleanup

The backup script automatically cleans up old backups, keeping only the most recent `MAX_BACKUPS` (default: 30). The cleanup runs after each successful backup.

## Monitoring

Check backup logs:
```bash
tail -f logs/backup.log
```

Or check the last backup:
```bash
ls -lh backups/db-backup-*.json | tail -5
```

## Troubleshooting

### Backup fails with "Unauthorized"
- Check that `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set in `.env.local`

### Backup fails with "URL_INVALID"
- Verify your `TURSO_DATABASE_URL` is correct
- Ensure `.env.local` file exists and is readable

### Cron job not running
- Check cron logs: `grep CRON /var/log/syslog`
- Verify the path in the cron job is absolute or uses `cd`
- Ensure Node.js is in the PATH for cron: use full path or set PATH in crontab

### Disk space issues
- Reduce `MAX_BACKUPS` to keep fewer backups
- Manually delete old backups from the backups directory
- Consider compressing old backups (set `COMPRESS_BACKUPS=true`)

