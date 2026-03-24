const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    duration: {
      type: Number,
      required: true,
      min: 1
    },
    completed: {
      type: Boolean,
      default: false
    },
    reminderAt: {
      type: String,
      default: ""
    },
    notified: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

const goalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    theme: {
      type: String,
      required: true,
      trim: true
    },
    reward: {
      type: String,
      required: true,
      trim: true
    },
    xp: {
      type: Number,
      default: 0
    },
    tasks: [taskSchema]
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    displayName: {
      type: String,
      required: true,
      trim: true
    },
    avatarUrl: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

const todoSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    completed: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);
const Goal = mongoose.models.Goal || mongoose.model("Goal", goalSchema);
const Todo = mongoose.models.Todo || mongoose.model("Todo", todoSchema);

async function connectDatabase() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is not set.");
  }

  await mongoose.connect(mongoUri);
}

function normalizeGoal(goal) {
  return {
    id: goal._id.toString(),
    title: goal.title,
    theme: goal.theme,
    reward: goal.reward,
    xp: goal.xp,
    createdAt: goal.createdAt,
    tasks: [...goal.tasks]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((task) => ({
        id: task._id.toString(),
        goalId: goal._id.toString(),
        title: task.title,
        duration: task.duration,
        completed: task.completed,
        reminderAt: task.reminderAt || "",
        notified: task.notified,
        createdAt: task.createdAt
      }))
  };
}

async function listGoals(userId) {
  const goals = await Goal.find({ userId }).sort({ createdAt: -1, _id: -1 });
  return goals.map(normalizeGoal);
}

async function getGoalById(userId, goalId) {
  if (!mongoose.isValidObjectId(goalId)) {
    return null;
  }

  const goal = await Goal.findOne({ _id: goalId, userId });
  return goal ? normalizeGoal(goal) : null;
}

async function createGoal(userId, { title, theme, reward }) {
  const goal = await Goal.create({
    userId,
    title,
    theme,
    reward,
    xp: 0,
    tasks: []
  });

  return normalizeGoal(goal);
}

async function createTask(userId, goalId, { title, duration, reminderAt }) {
  if (!mongoose.isValidObjectId(goalId)) {
    return null;
  }

  const goal = await Goal.findOne({ _id: goalId, userId });

  if (!goal) {
    return null;
  }

  goal.tasks.unshift({
    title,
    duration,
    reminderAt: reminderAt || "",
    completed: false,
    notified: false
  });

  await goal.save();
  const task = goal.tasks[0];

  return {
    id: task._id.toString(),
    goalId: goal._id.toString(),
    title: task.title,
    duration: task.duration,
    completed: task.completed,
    reminderAt: task.reminderAt || "",
    notified: task.notified,
    createdAt: task.createdAt
  };
}

async function toggleTask(userId, taskId) {
  if (!mongoose.isValidObjectId(taskId)) {
    return null;
  }

  const goal = await Goal.findOne({ userId, "tasks._id": taskId });

  if (!goal) {
    return null;
  }

  const task = goal.tasks.id(taskId);
  task.completed = !task.completed;
  task.notified = task.completed ? true : task.notified;
  goal.xp = Math.max(0, goal.xp + (task.completed ? task.duration : -task.duration));
  await goal.save();

  return {
    id: task._id.toString(),
    goalId: goal._id.toString(),
    title: task.title,
    duration: task.duration,
    completed: task.completed,
    reminderAt: task.reminderAt || "",
    notified: task.notified,
    createdAt: task.createdAt
  };
}

async function markTaskNotified(userId, taskId) {
  if (!mongoose.isValidObjectId(taskId)) {
    return null;
  }

  const goal = await Goal.findOne({ userId, "tasks._id": taskId });

  if (!goal) {
    return null;
  }

  const task = goal.tasks.id(taskId);
  task.notified = true;
  await goal.save();

  return {
    id: task._id.toString(),
    goalId: goal._id.toString(),
    title: task.title,
    duration: task.duration,
    completed: task.completed,
    reminderAt: task.reminderAt || "",
    notified: task.notified,
    createdAt: task.createdAt
  };
}

async function findOrCreateUser(profile) {
  let user = await User.findOne({ googleId: profile.id });

  if (!user) {
    user = await User.create({
      googleId: profile.id,
      email: profile.emails?.[0]?.value || `${profile.id}@example.com`,
      displayName: profile.displayName || "Goal Quest User",
      avatarUrl: profile.photos?.[0]?.value || ""
    });
  } else {
    user.email = profile.emails?.[0]?.value || user.email;
    user.displayName = profile.displayName || user.displayName;
    user.avatarUrl = profile.photos?.[0]?.value || user.avatarUrl;
    await user.save();
  }

  return user;
}

async function getUserById(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    return null;
  }

  return User.findById(userId);
}

function normalizeTodo(todo) {
  return {
    id: todo._id.toString(),
    title: todo.title,
    completed: todo.completed,
    createdAt: todo.createdAt
  };
}

async function listTodos(userId) {
  const todos = await Todo.find({ userId }).sort({ completed: 1, createdAt: -1, _id: -1 });
  return todos.map(normalizeTodo);
}

async function createTodo(userId, title) {
  const todo = await Todo.create({
    userId,
    title,
    completed: false
  });

  return normalizeTodo(todo);
}

async function toggleTodo(userId, todoId) {
  if (!mongoose.isValidObjectId(todoId)) {
    return null;
  }

  const todo = await Todo.findOne({ _id: todoId, userId });

  if (!todo) {
    return null;
  }

  todo.completed = !todo.completed;
  await todo.save();

  return normalizeTodo(todo);
}

async function deleteTodo(userId, todoId) {
  if (!mongoose.isValidObjectId(todoId)) {
    return false;
  }

  const result = await Todo.deleteOne({ _id: todoId, userId });
  return result.deletedCount > 0;
}

module.exports = {
  connectDatabase,
  listGoals,
  getGoalById,
  createGoal,
  createTask,
  toggleTask,
  markTaskNotified,
  findOrCreateUser,
  getUserById,
  listTodos,
  createTodo,
  toggleTodo,
  deleteTodo
};
