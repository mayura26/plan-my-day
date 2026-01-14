#!/bin/bash

# Setup script for database backup cron job
# This script helps set up a daily backup cron job

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-db-cron.mjs"
LOG_FILE="$PROJECT_DIR/logs/backup.log"

# Create logs directory if it doesn't exist
mkdir -p "$(dirname "$LOG_FILE")"

# Make backup script executable
chmod +x "$BACKUP_SCRIPT"

echo "Database Backup Cron Setup"
echo "=========================="
echo ""
echo "Project directory: $PROJECT_DIR"
echo "Backup script: $BACKUP_SCRIPT"
echo "Log file: $LOG_FILE"
echo ""
echo "To add a daily backup at 2 AM, run:"
echo ""
echo "crontab -e"
echo ""
echo "Then add this line:"
echo ""
echo "0 2 * * * cd $PROJECT_DIR && node $BACKUP_SCRIPT >> $LOG_FILE 2>&1"
echo ""
echo "Or for multiple daily backups (every 6 hours):"
echo ""
echo "0 */6 * * * cd $PROJECT_DIR && node $BACKUP_SCRIPT >> $LOG_FILE 2>&1"
echo ""
echo "To test the backup script manually, run:"
echo "  cd $PROJECT_DIR && node $BACKUP_SCRIPT"
echo ""

