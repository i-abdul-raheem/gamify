const state = {
  goals: [],
  todos: [],
  user: null,
  isLoading: true,
  route: parseRoute(window.location.pathname)
};

const authLoading = document.querySelector("#authLoading");
const topbar = document.querySelector("#topbar");
const topbarBrand = document.querySelector("#topbarBrand");
const topbarMenuButton = document.querySelector("#topbarMenuButton");
const topbarActions = document.querySelector("#topbarActions");
const viewRoot = document.querySelector("#viewRoot");
const tabbar = document.querySelector("#tabbar");
const notificationSound = typeof Audio === "function" ? new Audio("/beep.mp3") : null;

if (notificationSound) {
  notificationSound.preload = "auto";
}

initialize();

async function initialize() {
  setupTopbarMenu();
  setupGlobalEvents();
  registerServiceWorker();
  render();

  try {
    await refreshAuthState();

    if (state.user) {
      await loadInitialData();
      remindersIntervalId = window.setInterval(processReminders, 30000);
      processReminders();
    }

    syncRouteAccess();
  } finally {
    state.isLoading = false;
    render();
  }
}

let remindersIntervalId = null;

function setupTopbarMenu() {
  if (!topbar || !topbarMenuButton || !topbarActions) {
    return;
  }

  topbarMenuButton.addEventListener("click", () => {
    const isOpen = topbar.dataset.menuOpen === "true";
    setTopbarMenuState(!isOpen);
  });

  document.addEventListener("click", (event) => {
    if (!topbar.contains(event.target)) {
      setTopbarMenuState(false);
    }
  });

  topbarActions.addEventListener("click", (event) => {
    if (window.innerWidth <= 640 && event.target.closest("a, button")) {
      setTopbarMenuState(false);
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 640) {
      setTopbarMenuState(false);
    }
  });
}

function setupGlobalEvents() {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("submit", handleDocumentSubmit);
  window.addEventListener("popstate", handlePopState);
}

function handleDocumentClick(event) {
  const internalLink = event.target.closest("a[href]");

  if (internalLink) {
    const href = internalLink.getAttribute("href");

    if (shouldHandleClientNavigation(internalLink, href, event)) {
      event.preventDefault();
      navigate(href);
      return;
    }
  }

  const notifyButton = event.target.closest("#notifyButton");

  if (notifyButton) {
    event.preventDefault();
    handleNotifications();
    return;
  }

  const logoutButton = event.target.closest("#logoutButton");

  if (logoutButton) {
    event.preventDefault();
    logout();
    return;
  }

  const taskToggle = event.target.closest("[data-task-toggle]");

  if (taskToggle) {
    event.preventDefault();
    toggleTaskById(taskToggle.dataset.taskToggle);
    return;
  }

  const todoToggle = event.target.closest("[data-todo-toggle]");

  if (todoToggle) {
    event.preventDefault();
    toggleTodoById(todoToggle.dataset.todoToggle);
    return;
  }

  const todoDelete = event.target.closest("[data-todo-delete]");

  if (todoDelete) {
    event.preventDefault();
    deleteTodoById(todoDelete.dataset.todoDelete);
  }
}

function handleDocumentSubmit(event) {
  const form = event.target;

  if (form.id === "goalForm") {
    createGoalFromForm(event);
    return;
  }

  if (form.id === "taskForm") {
    createTaskFromForm(event);
    return;
  }

  if (form.id === "todoForm") {
    createTodoFromForm(event);
  }
}

function handlePopState() {
  state.route = parseRoute(window.location.pathname);
  syncRouteAccess();
  render();
}

function shouldHandleClientNavigation(link, href, event) {
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    link.target === "_blank" ||
    link.hasAttribute("download") ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }

  if (href.startsWith("/auth/")) {
    return false;
  }

  const url = new URL(link.href, window.location.origin);
  return url.origin === window.location.origin;
}

function setTopbarMenuState(isOpen) {
  if (!topbar || !topbarMenuButton) {
    return;
  }

  topbar.dataset.menuOpen = isOpen ? "true" : "false";
  topbarMenuButton.setAttribute("aria-expanded", String(isOpen));
}

function navigate(pathname, options = {}) {
  const { replace = false } = options;
  const nextRoute = parseRoute(pathname);
  const targetPath = buildPath(nextRoute);

  if (!replace && targetPath === buildPath(state.route)) {
    return;
  }

  if (replace) {
    window.history.replaceState({}, "", targetPath);
  } else {
    window.history.pushState({}, "", targetPath);
  }

  state.route = nextRoute;
  syncRouteAccess();
  render();
}

function syncRouteAccess() {
  if (state.user || !isProtectedRoute(state.route)) {
    return;
  }

  state.route = parseRoute("/");
  window.history.replaceState({}, "", "/");
}

function isProtectedRoute(route) {
  return route.page !== "home";
}

function parseRoute(pathname) {
  if (pathname === "/create") {
    return { page: "create" };
  }

  if (pathname === "/quests") {
    return { page: "quests" };
  }

  if (pathname === "/todos") {
    return { page: "todos" };
  }

  const questMatch = pathname.match(/^\/quests\/([^/]+)$/);

  if (questMatch) {
    return { page: "quest", goalId: questMatch[1] };
  }

  return { page: "home" };
}

function buildPath(route) {
  if (route.page === "create") {
    return "/create";
  }

  if (route.page === "quests") {
    return "/quests";
  }

  if (route.page === "todos") {
    return "/todos";
  }

  if (route.page === "quest" && route.goalId) {
    return `/quests/${route.goalId}`;
  }

  return "/";
}

async function refreshAuthState() {
  try {
    const data = await requestJson("/api/auth/me");
    state.user = data.user;
    document.body.dataset.auth = "authenticated";
  } catch (error) {
    if (error.status === 401) {
      state.user = null;
      document.body.dataset.auth = "guest";
      return;
    }

    throw error;
  }
}

async function loadInitialData() {
  const [goalsData, todosData] = await Promise.all([requestJson("/api/goals"), requestJson("/api/todos")]);
  state.goals = goalsData.goals;
  state.todos = todosData.todos;
}

function render() {
  document.body.dataset.ui = state.isLoading ? "loading" : "ready";
  document.body.dataset.page = state.route.page;
  renderAuthLoading();
  renderTopbar();
  renderView();
  renderTabbar();
}

function renderAuthLoading() {
  if (!authLoading) {
    return;
  }

  authLoading.hidden = !state.isLoading;
}

function renderTopbar() {
  const showGuestLanding = state.route.page === "home" && !state.user;

  topbar.hidden = showGuestLanding;
  tabbar.hidden = showGuestLanding;

  if (showGuestLanding) {
    return;
  }

  const headingMap = {
    home: "Home",
    create: "Create",
    quests: "All Quests",
    todos: "Todos",
    quest: getActiveGoal()?.title || "Quest"
  };

  topbarBrand.innerHTML = `
    <p class="eyebrow">Goal Quest</p>
    <h2>${escapeHtml(headingMap[state.route.page] || "Goal Quest")}</h2>
  `;

  topbarActions.innerHTML = renderTopbarActions();
}

function renderTopbarActions() {
  const authMarkup = state.user
    ? `
        <div class="auth-user">
          ${state.user.avatarUrl ? `<img class="auth-avatar" src="${escapeHtml(state.user.avatarUrl)}" alt="${escapeHtml(state.user.displayName)}" />` : ""}
          <span>${escapeHtml(state.user.displayName)}</span>
        </div>
        <button id="logoutButton" class="auth-button auth-button-logout" type="button">Logout</button>
      `
    : `
        <a class="google-signin-button" href="/auth/google">
          <span class="google-signin-icon" aria-hidden="true">
            ${googleIconMarkup()}
          </span>
          <span>Sign in with Google</span>
        </a>
      `;

  let routeAction = "";

  if (state.route.page === "home") {
    routeAction = renderNotifyButton();
  } else if (state.route.page === "create") {
    routeAction = `<a class="topbar-link" href="/quests">All Quests</a>`;
  } else if (state.route.page === "quests") {
    routeAction = `<a class="topbar-link" href="/create">New Goal</a>`;
  } else if (state.route.page === "quest") {
    routeAction = `<a class="topbar-link" href="/quests">Back</a>`;
  } else if (state.route.page === "todos") {
    routeAction = `<a class="topbar-link" href="/quests">All Quests</a>`;
  }

  return `${routeAction}<div class="auth-slot">${authMarkup}</div>`;
}

function renderNotifyButton() {
  if (!state.user) {
    return `<button id="notifyButton" class="notify-button" type="button">Login for Alerts</button>`;
  }

  if (!("Notification" in window)) {
    return `<button id="notifyButton" class="notify-button" type="button" disabled>Alerts Unsupported</button>`;
  }

  if (Notification.permission === "granted") {
    return "";
  }

  return `<button id="notifyButton" class="notify-button" type="button">Enable Alerts</button>`;
}

function renderView() {
  viewRoot.innerHTML = renderViewMarkup();
}

function renderViewMarkup() {
  if (state.route.page === "home") {
    return state.user ? renderHomeView() : renderGuestHomeView();
  }

  if (state.route.page === "create") {
    return renderCreateView();
  }

  if (state.route.page === "quests") {
    return renderQuestsView();
  }

  if (state.route.page === "quest") {
    return renderQuestDetailView();
  }

  if (state.route.page === "todos") {
    return renderTodosView();
  }

  return "";
}

function renderTabbar() {
  if (state.route.page === "home" && !state.user) {
    return;
  }

  const activePage = state.route.page === "quest" ? "quests" : state.route.page;
  const items = [
    { label: "Home", href: "/", page: "home" },
    { label: "Create", href: "/create", page: "create" },
    { label: "Quests", href: "/quests", page: "quests" },
    { label: "Todos", href: "/todos", page: "todos" }
  ];

  tabbar.innerHTML = items
    .map((item) => `<a class="tabbar-link${item.page === activePage ? " is-active" : ""}" href="${item.href}">${item.label}</a>`)
    .join("");
}

function renderGuestHomeView() {
  return `
    <section class="guest-home">
      <header class="guest-hero">
        <p class="eyebrow">Goal Quest</p>
        <h1>Turn ambition into a game you actually want to play.</h1>
        <p class="hero-text">
          Sign in to create quests, break them into sessions, track momentum, and keep everything synced to your account.
        </p>
        <div class="hero-actions">
          <a class="google-signin-button google-signin-button-large" href="/auth/google">
            <span class="google-signin-icon" aria-hidden="true">${googleIconMarkup()}</span>
            <span>Sign in with Google</span>
          </a>
        </div>
      </header>

      <section class="guest-grid">
        <article class="panel guest-panel">
          <p class="section-label">How It Works</p>
          <h2>Build goals as quests</h2>
          <p class="support-copy">Create a goal, attach tasks, set reminders, and earn XP as you complete focused sessions.</p>
        </article>
        <article class="panel guest-panel">
          <p class="section-label">Why It Helps</p>
          <h2>Keep momentum visible</h2>
          <p class="support-copy">See progress, keep streak energy high, and make your goals feel structured instead of vague.</p>
        </article>
      </section>

      <p class="guest-credit">
        Created By: Abdul Raheem
        <a href="https://github.com/i-abdul-raheem" target="_blank" rel="noreferrer">GitHub</a>
        <a href="https://www.linkedin.com/in/i-am-abdul-raheem" target="_blank" rel="noreferrer">LinkedIn</a>
      </p>
    </section>
  `;
}

function renderHomeView() {
  const totalGoals = state.goals.length;
  const allTasks = state.goals.flatMap((goal) => goal.tasks);
  const completedTasks = allTasks.filter((task) => task.completed).length;
  const totalXp = state.goals.reduce((sum, goal) => sum + goal.xp, 0);
  const overdueTasks = allTasks.filter(
    (task) => !task.completed && task.reminderAt && new Date(task.reminderAt).getTime() <= Date.now()
  ).length;

  return `
    <section class="hero-card">
      <div class="hero-copy">
        <p class="eyebrow">Quest Engine</p>
        <h1>Turn goals into streaks, XP, and momentum.</h1>
        <p class="hero-text">
          Track learning missions, stay consistent, and move through focused sessions with reminders.
        </p>
      </div>
      <div class="hero-actions">
        <a class="primary-link" href="/create">Create Goal</a>
        <a class="secondary-link" href="/quests">View Quests</a>
      </div>
    </section>

    <section class="stats-grid">
      ${renderStatsCards([
        { label: "Quests", value: totalGoals },
        { label: "Tasks Done", value: completedTasks },
        { label: "Total XP", value: totalXp },
        { label: "Overdue", value: overdueTasks }
      ])}
    </section>

    <section class="panel panel-upcoming">
      <div class="panel-heading">
        <div>
          <p class="section-label">Next Up</p>
          <h2>Upcoming tasks</h2>
        </div>
        <span class="pill">Queue</span>
      </div>
      <div class="upcoming-list">${renderUpcomingTasks()}</div>
    </section>

    <section class="panel panel-featured">
      <div class="panel-heading">
        <div>
          <p class="section-label">Live Snapshot</p>
          <h2>Top quests</h2>
        </div>
        <span class="pill">Overview</span>
      </div>
      <div class="homeGoalPreview home-goal-preview">${renderHomePreviewCards()}</div>
    </section>
  `;
}

function renderCreateView() {
  return `
    <section class="panel panel-featured panel-first create-primary">
      <div class="panel-heading">
        <div>
          <p class="section-label">New Quest</p>
          <h2>Build your next level-up</h2>
        </div>
        <span class="pill">Planner</span>
      </div>
      <div class="create-intro">
        <div class="create-intro-card">
          <span>1</span>
          <p>Name the outcome you actually want.</p>
        </div>
        <div class="create-intro-card">
          <span>2</span>
          <p>Give it a theme and a reward so it feels worth returning to.</p>
        </div>
      </div>
      <p class="support-copy">
        Give the goal a theme and a reward so it feels like a real mission instead of a vague intention.
      </p>
      <form id="goalForm" class="goal-form">
        <label>
          <span>Goal</span>
          <input name="goalTitle" type="text" placeholder="Learn NLP" required />
        </label>
        <label>
          <span>Theme</span>
          <input name="goalTheme" type="text" placeholder="Transformers, embeddings..." />
        </label>
        <label>
          <span>Reward</span>
          <input name="goalReward" type="text" placeholder="Unlock a weekend break" />
        </label>
        <button type="submit" class="primary-button">Start Quest</button>
      </form>
    </section>

    <section class="panel create-secondary">
      <div class="panel-heading">
        <div>
          <p class="section-label">Active Count</p>
          <h2>Current momentum</h2>
        </div>
      </div>
      <p class="support-copy create-secondary-copy">
        Once you create a quest, it gets its own page where you can add sessions, reminders, and progress.
      </p>
      <section class="stats-grid">
        ${renderStatsCards([
          { label: "Quests", value: state.goals.length },
          { label: "Tasks Done", value: state.goals.flatMap((goal) => goal.tasks).filter((task) => task.completed).length },
          { label: "Total XP", value: state.goals.reduce((sum, goal) => sum + goal.xp, 0) }
        ])}
      </section>
    </section>
  `;
}

function renderQuestsView() {
  return `
    <section class="panel panel-first minimal-panel">
      <div class="panel-heading">
        <div>
          <p class="section-label">Directory</p>
          <h2>Choose a quest</h2>
        </div>
        <span class="pill">Minimal</span>
      </div>
      <div class="quest-directory">${renderQuestDirectoryItems()}</div>
    </section>
  `;
}

function renderQuestDetailView() {
  const goal = getActiveGoal();

  if (!goal) {
    return `
      <section id="questHero" class="hero-card panel-first">
        <p class="empty-state">Quest not found.</p>
      </section>
    `;
  }

  const completedTasks = goal.tasks.filter((task) => task.completed).length;
  const progress = goal.tasks.length ? Math.round((completedTasks / goal.tasks.length) * 100) : 0;

  return `
    <section id="questHero" class="hero-card panel-first">
      <p class="eyebrow">${escapeHtml(goal.theme)}</p>
      <h1>${escapeHtml(goal.title)}</h1>
      <p class="hero-text">Reward: ${escapeHtml(goal.reward)}</p>
      <div class="quest-hero-stats">
        <div class="quest-hero-stat">
          <span>Level</span>
          <strong>Lvl ${Math.max(1, Math.floor(goal.xp / 120) + 1)}</strong>
        </div>
        <div class="quest-hero-stat">
          <span>XP</span>
          <strong>${goal.xp}</strong>
        </div>
        <div class="quest-hero-stat">
          <span>Progress</span>
          <strong>${progress}%</strong>
        </div>
      </div>
      <div class="progress-track quest-progress-track">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
    </section>

    <section class="panel panel-featured">
      <div class="panel-heading">
        <div>
          <p class="section-label">New Task</p>
          <h2>Add a session</h2>
        </div>
        <span class="pill">Detail</span>
      </div>
      <form id="taskForm" class="task-form">
        <label>
          <span>Task name</span>
          <input name="taskTitle" type="text" placeholder="Read attention mechanism notes" required />
        </label>
        <div class="task-form-row">
          <label>
            <span>Minutes</span>
            <input name="taskDuration" type="number" min="5" step="5" value="30" required />
          </label>
          <label>
            <span>Reminder</span>
            <input name="taskReminder" type="datetime-local" />
          </label>
        </div>
        <button type="submit" class="primary-button">Add Task</button>
      </form>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <div>
          <p class="section-label">Task Board</p>
          <h2>Work queue</h2>
        </div>
      </div>
      <div class="task-list">${renderTaskBoard(goal)}</div>
    </section>
  `;
}

function renderTodosView() {
  const totalTodos = state.todos.length;
  const completedTodos = state.todos.filter((todo) => todo.completed).length;
  const openTodos = totalTodos - completedTodos;

  return `
    <section class="hero-card panel-first">
      <div class="hero-copy">
        <p class="eyebrow">Focus Module</p>
        <h1>Keep quick tasks out of your head.</h1>
        <p class="hero-text">Use the todo tab for fast captures while your bigger goals stay organized as quests.</p>
      </div>
    </section>

    <section class="panel panel-featured">
      <div class="panel-heading">
        <div>
          <p class="section-label">New Todo</p>
          <h2>Add a quick task</h2>
        </div>
        <span class="pill">Lightweight</span>
      </div>
      <form id="todoForm" class="todo-form">
        <label>
          <span>Todo</span>
          <input name="todoTitle" type="text" placeholder="Reply to the design review" required />
        </label>
        <button type="submit" class="primary-button">Add Todo</button>
      </form>
    </section>

    <section class="stats-grid todo-summary">
      ${renderStatsCards([
        { label: "Total", value: totalTodos },
        { label: "Open", value: openTodos },
        { label: "Done", value: completedTodos }
      ])}
    </section>

    <section class="panel">
      <div class="panel-heading">
        <div>
          <p class="section-label">Todo Board</p>
          <h2>What still needs attention</h2>
        </div>
      </div>
      <div class="todo-list">${renderTodoList()}</div>
    </section>
  `;
}

function renderStatsCards(stats) {
  return stats
    .map(
      (stat) => `
        <article class="stat-card">
          <strong>${escapeHtml(String(stat.value))}</strong>
          <span>${escapeHtml(String(stat.label))}</span>
        </article>
      `
    )
    .join("");
}

function renderHomePreviewCards() {
  if (!state.goals.length) {
    return `<p class="empty-state">No quests yet. Start one from the Create page.</p>`;
  }

  return state.goals
    .slice(0, 3)
    .map((goal) => {
      const completedTasks = goal.tasks.filter((task) => task.completed).length;
      return `
        <article class="preview-card">
          <p class="goal-theme">${escapeHtml(goal.theme)}</p>
          <h3>${escapeHtml(goal.title)}</h3>
          <p class="preview-copy">${completedTasks}/${goal.tasks.length || 0} tasks complete</p>
          <div class="preview-footer">
            <span>${goal.xp} XP</span>
            <a href="/quests/${goal.id}">Open</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderUpcomingTasks() {
  const upcomingTasks = state.goals
    .flatMap((goal) =>
      goal.tasks
        .filter((task) => !task.completed)
        .map((task) => ({
          ...task,
          goalId: goal.id,
          goalTitle: goal.title,
          goalTheme: goal.theme
        }))
    )
    .sort((left, right) => {
      const leftHasReminder = Boolean(left.reminderAt);
      const rightHasReminder = Boolean(right.reminderAt);

      if (leftHasReminder && rightHasReminder) {
        return new Date(left.reminderAt).getTime() - new Date(right.reminderAt).getTime();
      }

      if (leftHasReminder) {
        return -1;
      }

      if (rightHasReminder) {
        return 1;
      }

      return 0;
    })
    .slice(0, 4);

  if (!upcomingTasks.length) {
    return `<p class="empty-state">No upcoming tasks yet. Add a few sessions to your quests and they will show up here.</p>`;
  }

  return upcomingTasks
    .map((task) => {
      const schedule = task.reminderAt
        ? new Date(task.reminderAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
          })
        : "No reminder";

      return `
        <a class="upcoming-item" href="/quests/${task.goalId}">
          <div class="upcoming-copy">
            <p class="goal-theme">${escapeHtml(task.goalTheme)}</p>
            <h3>${escapeHtml(task.title)}</h3>
            <p>${task.duration} min • ${escapeHtml(schedule)}</p>
          </div>
          <div class="upcoming-meta">
            <span>${escapeHtml(task.goalTitle)}</span>
            <strong>Open</strong>
          </div>
        </a>
      `;
    })
    .join("");
}

function renderQuestDirectoryItems() {
  if (!state.goals.length) {
    return `<p class="empty-state">No quests yet. Start with one bold goal and build tasks under it.</p>`;
  }

  return state.goals
    .map((goal) => {
      const completedTasks = goal.tasks.filter((task) => task.completed).length;
      return `
        <a class="directory-item" href="/quests/${goal.id}">
          <div class="directory-copy">
            <p class="goal-theme">${escapeHtml(goal.theme)}</p>
            <h3 class="directory-title">${escapeHtml(goal.title)}</h3>
          </div>
          <div class="directory-meta">
            <span class="directory-progress">${completedTasks}/${goal.tasks.length || 0} tasks</span>
            <strong class="directory-xp">${goal.xp} XP</strong>
          </div>
        </a>
      `;
    })
    .join("");
}

function renderTaskBoard(goal) {
  if (!goal.tasks.length) {
    return `<p class="empty-state">No tasks yet. Add a focused session to start the quest.</p>`;
  }

  return goal.tasks
    .map((task) => {
      const isDue = task.reminderAt && new Date(task.reminderAt).getTime() <= Date.now() && !task.completed;
      return `
        <div class="task-item${task.completed ? " is-complete" : ""}">
          <button class="task-toggle" type="button" aria-label="Toggle task completion" data-task-toggle="${task.id}">
            ${task.completed ? "✓" : isDue ? "!" : "○"}
          </button>
          <div class="task-copy">
            <strong class="task-title">${escapeHtml(task.title)}</strong>
            <p class="task-detail">${escapeHtml(formatTaskDetail(task))}</p>
          </div>
          <div class="task-points">+${task.duration} XP</div>
        </div>
      `;
    })
    .join("");
}

function renderTodoList() {
  if (!state.todos.length) {
    return `<p class="empty-state">No todos yet. Add one small task and keep the list moving.</p>`;
  }

  return state.todos
    .map(
      (todo) => `
        <article class="todo-item${todo.completed ? " is-complete" : ""}">
          <button class="todo-toggle" type="button" aria-label="Toggle todo completion" data-todo-toggle="${todo.id}">
            ${todo.completed ? "✓" : "○"}
          </button>
          <div class="todo-copy">
            <strong>${escapeHtml(todo.title)}</strong>
            <p>${todo.completed ? "Completed" : "Open"} • ${new Date(todo.createdAt).toLocaleDateString([], {
              month: "short",
              day: "numeric"
            })}</p>
          </div>
          <button class="todo-delete" type="button" aria-label="Delete todo" data-todo-delete="${todo.id}">Delete</button>
        </article>
      `
    )
    .join("");
}

async function handleNotifications() {
  if (!state.user) {
    redirectToGoogleAuth();
    return;
  }

  if (!("Notification" in window)) {
    alert("Notifications are not supported in this browser.");
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission === "granted") {
    playNotificationSound();
    showNotification("Alerts enabled", "Goal Quest will remind you about scheduled tasks.");
  }

  render();
}

async function createGoalFromForm(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const title = formData.get("goalTitle")?.toString().trim();
  const theme = formData.get("goalTheme")?.toString().trim() || "Personal mastery";
  const reward = formData.get("goalReward")?.toString().trim() || "A satisfying streak";

  if (!title) {
    return;
  }

  const data = await requestJson("/api/goals", {
    method: "POST",
    body: JSON.stringify({ title, theme, reward })
  });

  state.goals = data.goals;
  event.target.reset();
  navigate(`/quests/${data.goal.id}`);
}

async function createTaskFromForm(event) {
  event.preventDefault();

  const goal = getActiveGoal();

  if (!goal) {
    return;
  }

  const formData = new FormData(event.target);
  const title = formData.get("taskTitle")?.toString().trim();
  const duration = Number(formData.get("taskDuration"));
  const reminderAt = formData.get("taskReminder")?.toString() || "";

  if (!title || !Number.isFinite(duration) || duration <= 0) {
    return;
  }

  const data = await requestJson(`/api/goals/${goal.id}/tasks`, {
    method: "POST",
    body: JSON.stringify({ title, duration, reminderAt })
  });

  state.goals = data.goals;
  event.target.reset();
  render();
}

async function createTodoFromForm(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const title = formData.get("todoTitle")?.toString().trim();

  if (!title) {
    return;
  }

  const data = await requestJson("/api/todos", {
    method: "POST",
    body: JSON.stringify({ title })
  });

  state.todos = data.todos;
  event.target.reset();
  render();
}

async function toggleTaskById(taskId) {
  const data = await requestJson(`/api/tasks/${taskId}/toggle`, {
    method: "PATCH"
  });

  state.goals = data.goals;
  render();
}

async function toggleTodoById(todoId) {
  const data = await requestJson(`/api/todos/${todoId}/toggle`, {
    method: "PATCH"
  });

  state.todos = data.todos;
  render();
}

async function deleteTodoById(todoId) {
  const data = await requestJson(`/api/todos/${todoId}`, {
    method: "DELETE"
  });

  state.todos = data.todos;
  render();
}

function getActiveGoal() {
  if (state.route.page !== "quest") {
    return null;
  }

  return state.goals.find((goal) => goal.id === state.route.goalId) || null;
}

function formatTaskDetail(task) {
  const reminder = task.reminderAt
    ? `Reminder ${new Date(task.reminderAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })}`
    : "No reminder";

  return `${task.duration} min session • ${reminder}`;
}

async function processReminders() {
  if (!state.user) {
    return;
  }

  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const dueTasks = [];

  state.goals.forEach((goal) => {
    goal.tasks.forEach((task) => {
      if (!task.reminderAt || task.completed || task.notified) {
        return;
      }

      if (new Date(task.reminderAt).getTime() <= Date.now()) {
        dueTasks.push({ goal, task });
      }
    });
  });

  for (const entry of dueTasks) {
    showNotification(entry.goal.title, `${entry.task.title} is scheduled now for ${entry.task.duration} minutes.`);
    await requestJson(`/api/tasks/${entry.task.id}/notified`, {
      method: "PATCH"
    });
  }

  if (dueTasks.length) {
    const goalsData = await requestJson("/api/goals");
    state.goals = goalsData.goals;
    render();
  }
}

async function logout() {
  await requestJson("/auth/logout", {
    method: "POST"
  });

  state.user = null;
  state.goals = [];
  state.todos = [];
  document.body.dataset.auth = "guest";
  navigate("/", { replace: true });
  render();
}

function redirectToGoogleAuth() {
  window.location.href = "/auth/google";
}

function showNotification(title, body) {
  playNotificationSound();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((registration) => {
      registration.showNotification(title, {
        body,
        icon: "/app-icon.svg",
        badge: "/app-icon.svg"
      });
    });
    return;
  }

  new Notification(title, { body });
}

function playNotificationSound() {
  if (!notificationSound) {
    return;
  }

  notificationSound.currentTime = 0;
  notificationSound.play().catch(() => {});
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

function googleIconMarkup() {
  return `
    <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#EA4335" d="M9 7.364v3.562h4.95c-.218 1.146-.872 2.117-1.854 2.77l3 2.327c1.746-1.61 2.754-3.982 2.754-6.796 0-.654-.058-1.281-.167-1.863H9z"/>
      <path fill="#34A853" d="M3.636 10.713 2.96 11.23.567 13.094A8.99 8.99 0 0 0 9 18c2.43 0 4.468-.803 5.954-2.177l-3-2.327c-.803.54-1.826.859-2.954.859-2.32 0-4.289-1.567-4.995-3.68l-.369.028z"/>
      <path fill="#4A90E2" d="M.567 4.906A9 9 0 0 0 0 9c0 1.468.352 2.857.967 4.094l3.07-2.38A5.41 5.41 0 0 1 3.745 9c0-.598.103-1.178.292-1.713l-3.47-2.38z"/>
      <path fill="#FBBC05" d="M9 3.58c1.322 0 2.51.455 3.444 1.347l2.583-2.584C13.462.893 11.425 0 9 0A8.99 8.99 0 0 0 .567 4.906l3.47 2.38C4.744 5.173 6.713 3.58 9 3.58z"/>
    </svg>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return payload;
}
