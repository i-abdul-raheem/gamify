const state = {
  goals: [],
  activeGoal: null,
  user: null
};

const page = document.body.dataset.page;
const notifyButton = document.querySelector("#notifyButton");
const authSlot = document.querySelector("#authSlot");
const authLoading = document.querySelector("#authLoading");
const primaryCta = document.querySelector("#primaryCta");
const secondaryCta = document.querySelector("#secondaryCta");
const goalForm = document.querySelector("#goalForm");
const taskForm = document.querySelector("#taskForm");
const goalsList = document.querySelector("#goalsList");
const statsGrid = document.querySelector("#statsGrid");
const homeGoalPreview = document.querySelector("#homeGoalPreview");
const guestHomeTemplate = document.querySelector("#guestHomeTemplate");
const questHero = document.querySelector("#questHero");
const questPageHeading = document.querySelector("#questPageHeading");
const taskBoard = document.querySelector("#taskBoard");
const taskTemplate = document.querySelector("#taskItemTemplate");
const directoryItemTemplate = document.querySelector("#directoryItemTemplate");

initialize();

async function initialize() {
  if (notifyButton) {
    notifyButton.addEventListener("click", handleNotifications);
  }

  if (goalForm) {
    goalForm.addEventListener("submit", createGoalFromForm);
  }

  if (taskForm) {
    taskForm.addEventListener("submit", createTaskFromForm);
  }

  registerServiceWorker();
  await refreshAuthState();
  render();

  if (!state.user && isProtectedPage()) {
    redirectToHome();
    return;
  }

  if (state.user) {
    await loadPageData();
    setInterval(processReminders, 30000);
    processReminders();
  }
}

function isProtectedPage() {
  return page === "create" || page === "quests" || page === "quest";
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

async function loadPageData() {
  if (page === "quest") {
    await refreshActiveGoal();
    return;
  }

  await refreshGoals();
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
  renderNotifyButton(permission);

  if (permission === "granted") {
    showNotification("Alerts enabled", "Goal Quest will remind you about scheduled tasks.");
  }
}

async function createGoalFromForm(event) {
  event.preventDefault();

  if (!state.user) {
    redirectToGoogleAuth();
    return;
  }

  const formData = new FormData(goalForm);
  const title = formData.get("goalTitle").toString().trim();
  const theme = formData.get("goalTheme").toString().trim() || "Personal mastery";
  const reward = formData.get("goalReward").toString().trim() || "A satisfying streak";

  if (!title) {
    return;
  }

  const data = await requestJson("/api/goals", {
    method: "POST",
    body: JSON.stringify({ title, theme, reward })
  });

  state.goals = data.goals;
  goalForm.reset();
  render();

  if (page === "create" && data.goal) {
    window.location.href = `/quests/${data.goal.id}`;
  }
}

async function createTaskFromForm(event) {
  event.preventDefault();

  if (!state.user) {
    redirectToGoogleAuth();
    return;
  }

  if (!state.activeGoal) {
    return;
  }

  const formData = new FormData(taskForm);
  const title = formData.get("taskTitle").toString().trim();
  const duration = Number(formData.get("taskDuration"));
  const reminderAt = formData.get("taskReminder").toString();

  if (!title || !Number.isFinite(duration) || duration <= 0) {
    return;
  }

  await requestJson(`/api/goals/${state.activeGoal.id}/tasks`, {
    method: "POST",
    body: JSON.stringify({ title, duration, reminderAt })
  });

  taskForm.reset();
  await refreshActiveGoal();
}

async function refreshGoals() {
  const data = await requestJson("/api/goals");
  state.goals = data.goals;
  render();
}

async function refreshActiveGoal() {
  const goalId = getGoalIdFromPath();

  if (!goalId) {
    state.activeGoal = null;
    render();
    return;
  }

  const goalsData = await requestJson("/api/goals");
  state.goals = goalsData.goals;

  try {
    const goalData = await requestJson(`/api/goals/${goalId}`);
    state.activeGoal = goalData.goal;
  } catch (error) {
    if (error.status === 404) {
      state.activeGoal = null;
      render();
      return;
    }

    throw error;
  }

  render();
}

function render() {
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  renderGuestHome();
  renderAuthLoading();
  renderNotifyButton(permission);
  renderAuthControls();
  renderHomeCtas();
  renderStats();
  renderHomePreview();
  renderQuestDirectory();
  renderQuestDetail();
}

function renderAuthLoading() {
  if (!authLoading || page !== "home") {
    return;
  }

  const isPending = document.body.dataset.auth === "pending";
  authLoading.hidden = !isPending;
}

function renderGuestHome() {
  if (page !== "home" || !guestHomeTemplate) {
    return;
  }

  const appContent = document.querySelector(".app-content");
  const tabbar = document.querySelector(".tabbar");

  if (!appContent || !tabbar) {
    return;
  }

  if (!state.user) {
    appContent.hidden = false;
    tabbar.hidden = true;
    if (!appContent.dataset.guestRendered) {
      appContent.innerHTML = "";
      const fragment = guestHomeTemplate.content.cloneNode(true);
      appContent.appendChild(fragment);
      appContent.dataset.guestRendered = "true";
    }
    return;
  }

  tabbar.hidden = false;
}

function renderNotifyButton(permission) {
  if (!notifyButton) {
    return;
  }

  if (!state.user) {
    notifyButton.textContent = "Login for Alerts";
    notifyButton.hidden = false;
    notifyButton.disabled = false;
    return;
  }

  if (!("Notification" in window)) {
    notifyButton.textContent = "Alerts Unsupported";
    notifyButton.hidden = false;
    notifyButton.disabled = true;
    return;
  }

  if (permission === "granted") {
    notifyButton.hidden = true;
    return;
  }

  notifyButton.hidden = false;
  notifyButton.textContent = "Enable Alerts";
  notifyButton.disabled = false;
}

function renderAuthControls() {
  if (!authSlot) {
    return;
  }

  if (!state.user) {
    authSlot.innerHTML = `<a class="auth-button auth-button-login" href="/auth/google">Continue with Google</a>`;
    return;
  }

  authSlot.innerHTML = `
    <div class="auth-user">
      ${state.user.avatarUrl ? `<img class="auth-avatar" src="${state.user.avatarUrl}" alt="${state.user.displayName}" />` : ""}
      <span>${state.user.displayName}</span>
    </div>
    <button id="logoutButton" class="auth-button auth-button-logout" type="button">Logout</button>
  `;

  authSlot.querySelector("#logoutButton").addEventListener("click", logout);
}

function renderHomeCtas() {
  if (!primaryCta || !secondaryCta) {
    return;
  }

  if (state.user) {
    primaryCta.textContent = "Create Goal";
    primaryCta.href = "/create";
    secondaryCta.textContent = "View Quests";
    secondaryCta.href = "/quests";
    return;
  }

  primaryCta.textContent = "Continue with Google";
  primaryCta.href = "/auth/google";
  secondaryCta.textContent = "How It Works";
  secondaryCta.href = "#homeGoalPreview";
}

function renderStats() {
  if (!statsGrid) {
    return;
  }

  if (!state.user) {
    statsGrid.innerHTML = `
      <article class="stat-card">
        <span>Status</span>
        <strong>Guest</strong>
      </article>
      <article class="stat-card">
        <span>Storage</span>
        <strong>MongoDB</strong>
      </article>
      <article class="stat-card">
        <span>Login</span>
        <strong>Google</strong>
      </article>
    `;
    return;
  }

  const totalGoals = state.goals.length;
  const allTasks = state.goals.flatMap((goal) => goal.tasks);
  const completedTasks = allTasks.filter((task) => task.completed).length;
  const totalXp = state.goals.reduce((sum, goal) => sum + goal.xp, 0);

  const stats = [
    { label: "Quests", value: totalGoals },
    { label: "Tasks Done", value: completedTasks },
    { label: "Total XP", value: totalXp }
  ];

  statsGrid.innerHTML = stats
    .map(
      (stat) => `
        <article class="stat-card">
          <span>${stat.label}</span>
          <strong>${stat.value}</strong>
        </article>
      `
    )
    .join("");
}

function renderHomePreview() {
  if (!homeGoalPreview) {
    return;
  }

  if (!state.user) {
    homeGoalPreview.innerHTML = `
      <p class="empty-state">
        Sign in with Google to sync quests to MongoDB and manage your progress from your account.
      </p>
    `;
    return;
  }

  if (!state.goals.length) {
    homeGoalPreview.innerHTML = `<p class="empty-state">No quests yet. Start one from the Create page.</p>`;
    return;
  }

  homeGoalPreview.innerHTML = state.goals
    .slice(0, 3)
    .map((goal) => {
      const completedTasks = goal.tasks.filter((task) => task.completed).length;
      const totalTasks = goal.tasks.length;
      return `
        <article class="preview-card">
          <p class="goal-theme">${goal.theme}</p>
          <h3>${goal.title}</h3>
          <p class="preview-copy">${completedTasks}/${Math.max(totalTasks, 1)} tasks complete</p>
          <div class="preview-footer">
            <span>${goal.xp} XP</span>
            <a href="/quests/${goal.id}">Open</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderQuestDirectory() {
  if (!goalsList || !directoryItemTemplate) {
    return;
  }

  goalsList.innerHTML = "";

  if (!state.user) {
    goalsList.innerHTML = `<p class="empty-state">Sign in with Google to view your quest directory.</p>`;
    return;
  }

  if (!state.goals.length) {
    goalsList.innerHTML = `<p class="empty-state">No quests yet. Start with one bold goal and build tasks under it.</p>`;
    return;
  }

  state.goals.forEach((goal) => {
    const completedTasks = goal.tasks.filter((task) => task.completed).length;
    const fragment = directoryItemTemplate.content.cloneNode(true);
    const item = fragment.querySelector(".directory-item");

    item.href = `/quests/${goal.id}`;
    fragment.querySelector(".goal-theme").textContent = goal.theme;
    fragment.querySelector(".directory-title").textContent = goal.title;
    fragment.querySelector(".directory-progress").textContent = `${completedTasks}/${goal.tasks.length || 0} tasks`;
    fragment.querySelector(".directory-xp").textContent = `${goal.xp} XP`;

    goalsList.appendChild(fragment);
  });
}

function renderQuestDetail() {
  if (!questHero || !taskBoard || !taskTemplate) {
    return;
  }

  if (!state.user) {
    questHero.innerHTML = `<p class="empty-state">Sign in with Google to open this quest.</p>`;
    taskBoard.innerHTML = "";
    return;
  }

  if (!state.activeGoal) {
    questHero.innerHTML = `<p class="empty-state">Quest not found.</p>`;
    taskBoard.innerHTML = "";
    return;
  }

  const completedTasks = state.activeGoal.tasks.filter((task) => task.completed).length;
  const progress = state.activeGoal.tasks.length
    ? Math.round((completedTasks / state.activeGoal.tasks.length) * 100)
    : 0;

  if (questPageHeading) {
    questPageHeading.textContent = state.activeGoal.title;
  }

  questHero.innerHTML = `
    <p class="eyebrow">${state.activeGoal.theme}</p>
    <h1>${state.activeGoal.title}</h1>
    <p class="hero-text">Reward: ${state.activeGoal.reward}</p>
    <div class="quest-hero-stats">
      <div class="quest-hero-stat">
        <span>Level</span>
        <strong>Lvl ${Math.max(1, Math.floor(state.activeGoal.xp / 120) + 1)}</strong>
      </div>
      <div class="quest-hero-stat">
        <span>XP</span>
        <strong>${state.activeGoal.xp}</strong>
      </div>
      <div class="quest-hero-stat">
        <span>Progress</span>
        <strong>${progress}%</strong>
      </div>
    </div>
    <div class="progress-track quest-progress-track">
      <div class="progress-fill" style="width: ${progress}%"></div>
    </div>
  `;

  taskBoard.innerHTML = "";

  if (!state.activeGoal.tasks.length) {
    taskBoard.innerHTML = `<p class="empty-state">No tasks yet. Add a focused session to start the quest.</p>`;
    return;
  }

  state.activeGoal.tasks.forEach((task) => {
    const taskFragment = taskTemplate.content.cloneNode(true);
    const taskItem = taskFragment.querySelector(".task-item");
    const taskToggle = taskFragment.querySelector(".task-toggle");
    const isDue = task.reminderAt && new Date(task.reminderAt).getTime() <= Date.now() && !task.completed;

    if (task.completed) {
      taskItem.classList.add("is-complete");
    }

    taskToggle.textContent = task.completed ? "✓" : isDue ? "!" : "○";
    taskFragment.querySelector(".task-title").textContent = task.title;
    taskFragment.querySelector(".task-detail").textContent = formatTaskDetail(task);
    taskFragment.querySelector(".task-points").textContent = `+${task.duration} XP`;

    taskToggle.addEventListener("click", async () => {
      await requestJson(`/api/tasks/${task.id}/toggle`, {
        method: "PATCH"
      });

      await refreshActiveGoal();
    });

    taskBoard.appendChild(taskFragment);
  });
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

  if (!state.goals.length) {
    await refreshGoalsForReminders();
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
    await loadPageData();
  }
}

async function refreshGoalsForReminders() {
  const data = await requestJson("/api/goals");
  state.goals = data.goals;
}

async function logout() {
  await requestJson("/auth/logout", {
    method: "POST"
  });

  window.location.href = "/";
}

function getGoalIdFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const lastPart = parts[parts.length - 1];
  return lastPart || null;
}

function redirectToGoogleAuth() {
  window.location.href = "/auth/google";
}

function redirectToHome() {
  window.location.href = "/";
}

function showNotification(title, body) {
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

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
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
