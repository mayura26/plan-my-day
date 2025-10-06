# Plan My Day - Testing Checklist

## 🧪 **Authentication & User Management**

### ✅ **Sign In/Sign Out**
- [ ] **Google OAuth**: Click "Sign in with Google" → redirects to Google → returns to app
- [ ] **GitHub OAuth**: Click "Sign in with GitHub" → redirects to GitHub → returns to app
- [ ] **Sign Out**: Click sign out button → redirects to homepage
- [ ] **Session Persistence**: Refresh page → user stays logged in
- [ ] **Protected Routes**: Try accessing `/tasks` or `/calendar` without auth → redirects to sign in

### ✅ **User Profile**
- [ ] **User Info Display**: Check if name/email shows correctly in navigation
- [ ] **User Avatar**: Verify profile picture displays (if available)

---

## 🏠 **Homepage & Navigation**

### ✅ **Non-Authenticated Homepage**
- [ ] **Marketing Page**: Shows hero section, features, and "Get Started Free" button
- [ ] **Feature Cards**: All feature cards display properly
- [ ] **CTA Buttons**: "Get Started Free" redirects to sign in
- [ ] **Navigation**: No navigation bar visible when not logged in

### ✅ **Authenticated Homepage**
- [ ] **Dashboard View**: Shows personalized welcome message
- [ ] **Quick Action Cards**: "Manage Tasks", "Calendar View", "AI Scheduling" cards
- [ ] **Navigation Bar**: Shows Home, Tasks, Calendar links
- [ ] **User Info**: Shows user name and sign out option
- [ ] **Theme Toggle**: Dark/light mode switch works

### ✅ **Navigation**
- [ ] **Active States**: Current page highlighted in navigation
- [ ] **Mobile Menu**: Hamburger menu works on mobile devices
- [ ] **Responsive**: Navigation adapts to different screen sizes
- [ ] **Links Work**: All navigation links redirect to correct pages

---

## 📋 **Task Management**

### ✅ **Task Creation**
- [ ] **Create Button**: "Create Task" button opens dialog
- [ ] **Required Fields**: Title field is required (shows error if empty)
- [ ] **All Fields**: Fill out all form fields (title, description, priority, type, group, duration, energy level)
- [ ] **Task Type**: Can select "Task" or "Event"
- [ ] **Priority**: Can select priority 1-5 (1 = most urgent)
- [ ] **Group Selection**: Can assign task to a group or leave ungrouped
- [ ] **Duration**: Can set duration in minutes
- [ ] **Energy Level**: Can set required energy level 1-5
- [ ] **Form Validation**: Error messages show for invalid inputs
- [ ] **Success**: Task appears in task list after creation

### ✅ **Task Display**
- [ ] **Task Cards**: All tasks display as cards with proper styling
- [ ] **Priority Colors**: High priority tasks (1-2) show in red/orange
- [ ] **Status Indicators**: Pending, in progress, completed statuses show correctly
- [ ] **Task Type**: "Task" vs "Event" labels display
- [ ] **Group Colors**: Tasks show group color indicators
- [ ] **Task Details**: Title, description, priority, duration all visible

### ✅ **Task Editing**
- [ ] **Edit Button**: Click edit button opens edit dialog
- [ ] **Pre-filled Form**: All current task data loads in form
- [ ] **Modify Fields**: Change title, description, priority, type, group, etc.
- [ ] **Task Type Change**: Can change from "Task" to "Event" and vice versa
- [ ] **Group Change**: Can move task between groups
- [ ] **Save Changes**: Updates reflect in task list
- [ ] **Cancel**: Cancel button closes dialog without saving

### ✅ **Task Actions**
- [ ] **Mark Complete**: Click complete button → task status changes to completed
- [ ] **Mark In Progress**: Click in progress button → task status changes
- [ ] **Delete Task**: Click delete button → confirmation dialog → task removed
- [ ] **Schedule Task**: Click schedule button (placeholder functionality)
- [ ] **Extend Task**: Click extend button (placeholder functionality)

### ✅ **Task Filtering & Sorting**
- [ ] **Group Filtering**: Select different groups → tasks filter correctly
- [ ] **All Tasks**: Select "All Tasks" → shows all tasks
- [ ] **Empty Groups**: Groups with no tasks show "No tasks" message
- [ ] **Task Count**: Group badges show correct task counts

---

## 📅 **Calendar View**

### ✅ **Calendar Display**
- [ ] **Calendar Loads**: Calendar page loads without errors
- [ ] **Date Navigation**: Can navigate between months/weeks
- [ ] **Today Highlight**: Current date is highlighted
- [ ] **Task Indicators**: Days with tasks show visual indicators

### ✅ **Task Display in Calendar**
- [ ] **Scheduled Tasks**: Tasks with scheduled_start/end appear on calendar
- [ ] **Color Coding**: Tasks show in priority colors (red=high, green=low)
- [ ] **Event vs Task**: Different styling for events vs tasks
- [ ] **Time Display**: Task times show correctly (start - end)

### ✅ **Calendar Interactions**
- [ ] **Date Selection**: Click on date → shows tasks for that day
- [ ] **Task Details**: Click on task in calendar → shows task details
- [ ] **Week Stats**: "This Week" stats show correct counts
- [ ] **Navigation**: Calendar navigation buttons work

### ✅ **Calendar Features**
- [ ] **Filter Button**: Filter button present (functionality TBD)
- [ ] **Add Task**: "Add Task" button redirects to task creation
- [ ] **Responsive**: Calendar works on mobile devices

---

## 📁 **Task Groups**

### ✅ **Group Management**
- [ ] **Create Group**: "New Group" button opens creation dialog
- [ ] **Group Name**: Can enter group name (required field)
- [ ] **Group Color**: Can select from color palette
- [ ] **Group Creation**: New group appears in sidebar
- [ ] **Edit Group**: Click edit button → modify name/color
- [ ] **Delete Group**: Click delete → confirmation → group removed

### ✅ **Group Display**
- [ ] **Color Indicators**: Groups show with selected colors
- [ ] **Group List**: All groups display in sidebar
- [ ] **All Tasks Option**: "All Tasks" option always available
- [ ] **Group Selection**: Clicking group highlights it
- [ ] **Task Count**: Groups show number of tasks (if any)

### ✅ **Group Integration**
- [ ] **Task Assignment**: Can assign tasks to groups during creation
- [ ] **Group Filtering**: Selecting group filters tasks correctly
- [ ] **Group Change**: Can move tasks between groups via editing
- [ ] **Ungrouped Tasks**: Tasks without groups show in "All Tasks"

---

## 🎨 **UI/UX Testing**

### ✅ **Responsive Design**
- [ ] **Desktop**: All features work on desktop (1920x1080)
- [ ] **Tablet**: Layout adapts for tablet (768px)
- [ ] **Mobile**: Mobile navigation and layout work (375px)
- [ ] **Touch Interactions**: All buttons/links work on touch devices

### ✅ **Theme System**
- [ ] **Light Mode**: Default light theme displays correctly
- [ ] **Dark Mode**: Dark theme toggle works
- [ ] **Theme Persistence**: Theme choice persists across page refreshes
- [ ] **Consistent Styling**: All components respect theme

### ✅ **Loading States**
- [ ] **Page Loading**: Loading spinners show during data fetch
- [ ] **Form Loading**: "Creating..." / "Updating..." states work
- [ ] **Button States**: Buttons show loading states during operations
- [ ] **Error Handling**: Error messages display for failed operations

### ✅ **Accessibility**
- [ ] **Keyboard Navigation**: Can navigate with Tab key
- [ ] **Screen Reader**: Proper labels and descriptions
- [ ] **Color Contrast**: Text is readable in both themes
- [ ] **Focus Indicators**: Focus states visible for interactive elements

---

## 🔧 **Technical Testing**

### ✅ **Data Persistence**
- [ ] **Task Creation**: Tasks persist after page refresh
- [ ] **Task Updates**: Edits persist after page refresh
- [ ] **Group Creation**: Groups persist after page refresh
- [ ] **User Session**: Login persists across browser sessions

### ✅ **Error Handling**
- [ ] **Network Errors**: Graceful handling of network failures
- [ ] **Invalid Data**: Form validation prevents invalid submissions
- [ ] **404 Pages**: Non-existent routes show proper error pages
- [ ] **API Errors**: Server errors show user-friendly messages

### ✅ **Performance**
- [ ] **Page Load Speed**: Pages load quickly (< 3 seconds)
- [ ] **Smooth Interactions**: No lag in UI interactions
- [ ] **Memory Usage**: No memory leaks during extended use
- [ ] **Large Datasets**: App handles many tasks/groups efficiently

---

## 🚀 **Browser Compatibility**

### ✅ **Modern Browsers**
- [ ] **Chrome**: All features work in latest Chrome
- [ ] **Firefox**: All features work in latest Firefox
- [ ] **Safari**: All features work in latest Safari
- [ ] **Edge**: All features work in latest Edge

### ✅ **Mobile Browsers**
- [ ] **iOS Safari**: Works on iPhone/iPad
- [ ] **Android Chrome**: Works on Android devices
- [ ] **Touch Gestures**: Swipe, tap, pinch work correctly

---

## 📱 **PWA Features (Future)**

### ✅ **Installation**
- [ ] **Install Prompt**: Browser shows install prompt
- [ ] **App Icon**: Custom app icon displays
- [ ] **Splash Screen**: Custom splash screen shows
- [ ] **Standalone Mode**: App runs without browser UI

### ✅ **Offline Functionality**
- [ ] **Offline Access**: App works without internet
- [ ] **Data Sync**: Changes sync when connection restored
- [ ] **Offline Indicators**: Clear offline/online status

---

## 🎯 **User Scenarios**

### ✅ **New User Flow**
1. [ ] Visit homepage → see marketing page
2. [ ] Click "Get Started Free" → redirect to sign in
3. [ ] Sign in with Google/GitHub → redirect to dashboard
4. [ ] Create first task → task appears in list
5. [ ] Create first group → group appears in sidebar
6. [ ] Assign task to group → task filters correctly

### ✅ **Daily Usage Flow**
1. [ ] Sign in → see dashboard
2. [ ] Navigate to Tasks → see task list
3. [ ] Create new task → assign to group
4. [ ] Navigate to Calendar → see scheduled tasks
5. [ ] Edit existing task → changes reflect everywhere
6. [ ] Mark task complete → status updates

### ✅ **Group Management Flow**
1. [ ] Create multiple groups with different colors
2. [ ] Assign tasks to different groups
3. [ ] Filter by group → see only relevant tasks
4. [ ] Edit group → change name/color
5. [ ] Delete group → tasks become ungrouped

---

## 🐛 **Known Issues to Test**

### ✅ **Edge Cases**
- [ ] **Empty States**: App handles no tasks/groups gracefully
- [ ] **Long Text**: Very long task titles/descriptions display correctly
- [ ] **Special Characters**: Emojis and special chars work in text fields
- [ ] **Rapid Actions**: Multiple quick clicks don't break functionality

### ✅ **Data Validation**
- [ ] **Required Fields**: Can't submit forms without required data
- [ ] **Number Limits**: Duration/priority within valid ranges
- [ ] **Text Length**: Very long text doesn't break layout
- [ ] **Duplicate Names**: Can create groups with same names

---

## 📊 **Testing Results**

### ✅ **Test Execution**
- [ ] **Date Tested**: ___________
- [ ] **Tester**: ___________
- [ ] **Browser**: ___________
- [ ] **Device**: ___________

### ✅ **Issues Found**
- [ ] **Critical Issues**: ___________
- [ ] **Minor Issues**: ___________
- [ ] **Enhancement Suggestions**: ___________

### ✅ **Overall Assessment**
- [ ] **Functionality**: All core features work as expected
- [ ] **Performance**: App performs well under normal usage
- [ ] **User Experience**: Interface is intuitive and responsive
- [ ] **Ready for Production**: App is ready for user testing

---

*This checklist should be completed for each major release to ensure quality and functionality.*
