### ⏳ Pending
- [ ] AI-powered task scheduling engine
- [ ] Task locking mechanism
- [ ] Automatic rescheduling logic
- [ ] Push notification system
- [ ] Notification preferences panel
- [ ] Allow shopping list style saved templates
- [ ] Allow AI to optimise tasks lists, need space for one on one with AI
- [ ] Allow open text mode which then geenrates into task/event
- [ ] SUpport voice
- [] each group has auto schedule rules. enable/disable schedule, time to schedule, and prioity 1-10 1 is highest
- [ ] auto scheuleder- concept is you select for ad ay, and then you pick what groups you want to schedule, and it goes by due date into priotity into group pirior. we canset max stress level on a day

---

## Phase 3: Google Calendar Integration (Weeks 9-12)

### ⏳ Pending
- [ ] Google OAuth integration
- [ ] Calendar sync functionality
- [ ] Conflict detection system
- [ ] Bi-directional task/event sync
- [ ] Voice task creation

---

## Phase 4: Enhanced UI & Collaboration (Weeks 13-16)

### ⏳ Pending
- [ ] Advanced calendar features
- [ ] Drag-and-drop functionality
- [ ] Multi-user collaboration
- [ ] Real-time updates
- [ ] Mobile optimization

---

## Phase 5: Advanced Features & Polish (Weeks 17-20)

### ⏳ Pending
- [ ] Learning algorithms
- [ ] Smart suggestions
- [ ] Advanced voice commands
- [ ] Analytics dashboard
- [ ] Performance optimization

---

## Current Sprint Focus

### This Week's Goals
1. **Task Management Core** ✅
   - Implement task creation, editing, and deletion ✅
   - Add task/event type distinction ✅
   - Build priority system (1-5 scale) ✅
   - Create task grouping functionality (API done, UI pending)

2. **Database Schema Implementation** ✅
   - Set up all required tables ✅
   - Implement data models ✅
   - Create API endpoints for tasks ✅

3. **Basic Calendar View** ✅
   - Weekly calendar component ✅
   - Task display in calendar ✅
   - Basic filtering options ✅

4. **Task Grouping System** ✅
   - Group management UI ✅
   - Task filtering by group ✅
   - Group selection in task form ✅

---

## Technical Debt & Issues

### 🔴 High Priority
- None currently

### 🟡 Medium Priority
- None currently

### 🟢 Low Priority
- None currently

### ✅ Recently Cleaned Up
- Removed duplicate database initialization file (lib/init-db.ts)
- Kept scripts/init-db.js as the single source of truth for database setup

---

## Next Actions

### Immediate (Today)
1. Review current codebase structure
2. Implement task data models
3. Create task CRUD API endpoints
4. Build basic task creation form

### This Week
1. Complete task management core features
2. Implement calendar view component
3. Add task grouping and filtering
4. Set up PWA foundation

### Next Week
1. User onboarding flow
2. Offline functionality
3. Push notification setup
4. Begin AI scheduling research

---

## Notes & Decisions

### Architecture Decisions
- **Database**: Turso (SQLite-based) for multi-platform support
- **UI Library**: shadcn/ui for consistent design system
- **State Management**: React Context + useReducer (to be implemented)
- **Authentication**: NextAuth.js with Google OAuth

### Development Guidelines
- Follow Windows PowerShell commands for all terminal operations
- Use shadcn components for UI consistency
- Implement mobile-first responsive design
- Prioritize validation over modification

---

## Resources & References

- [PRD Document](./PRD.md) - Complete product requirements
- [Database Schema](./PRD.md#44-key-database-schema) - SQL schema definitions
- [UI Components](./components/) - shadcn/ui component library
- [API Routes](./app/api/) - Next.js API endpoints

---

*This tracker will be updated regularly as development progresses. Each completed task should be marked with ✅ and moved to the completed section.*
