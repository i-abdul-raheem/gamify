require("dotenv").config();

const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const passport = require("passport");
const { OAuth2Client } = require("google-auth-library");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const {
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
} = require("./db");

const app = express();
const publicDir = path.join(__dirname, "public");
const sessionSecret = process.env.SESSION_SECRET;
const mongoUri = process.env.MONGODB_URI;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback";
const mobileJwtSecret = process.env.MOBILE_JWT_SECRET || `${sessionSecret}-mobile`;
const googleAudienceIds = [
  googleClientId,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_WEB_CLIENT_ID
].filter(Boolean);
const googleTokenClient = googleAudienceIds.length ? new OAuth2Client() : null;

let isPassportConfigured = false;

if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required.");
}

if (googleClientId && googleClientSecret && !isPassportConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: googleCallbackUrl
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = await findOrCreateUser(profile);
          done(null, user.id);
        } catch (error) {
          done(error);
        }
      }
    )
  );

  passport.serializeUser((userId, done) => {
    done(null, userId);
  });

  passport.deserializeUser(async (userId, done) => {
    try {
      const user = await getUserById(userId);
      done(null, user || false);
    } catch (error) {
      done(error);
    }
  });

  isPassportConfigured = true;
}

const databaseReady = connectDatabase();

app.use(async (_req, _res, next) => {
  try {
    await databaseReady;
    next();
  } catch (error) {
    next(error);
  }
});

app.use(express.json());
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: process.env.NODE_ENV === "production",
    store: MongoStore.create({
      mongoUrl: mongoUri,
      collectionName: "sessions"
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(async (req, _res, next) => {
  if (req.user) {
    next();
    return;
  }

  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    next();
    return;
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const payload = jwt.verify(token, mobileJwtSecret);
    const user = await getUserById(payload.sub);

    if (user) {
      req.user = user;
    }
  } catch (_error) {}

  next();
});
app.use(express.static(publicDir));

app.get(["/", "/create", "/quests", "/quests/:goalId", "/todos"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    database: "mongodb",
    authConfigured: Boolean(googleClientId && googleClientSecret)
  });
});

app.get("/auth/google", (req, res, next) => {
  if (!googleClientId || !googleClientSecret) {
    res.status(500).json({ error: "Google OAuth is not configured." });
    return;
  }

  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

app.post("/api/mobile/auth/google", async (req, res, next) => {
  if (!googleTokenClient || !googleAudienceIds.length) {
    res.status(500).json({ error: "Google OAuth is not configured." });
    return;
  }

  const idToken = req.body.idToken?.trim();

  if (!idToken) {
    res.status(400).json({ error: "Google ID token is required." });
    return;
  }

  try {
    const ticket = await googleTokenClient.verifyIdToken({
      idToken,
      audience: googleAudienceIds
    });
    const payload = ticket.getPayload();

    if (!payload?.sub) {
      res.status(401).json({ error: "Invalid Google token." });
      return;
    }

    const user = await findOrCreateUser({
      id: payload.sub,
      displayName: payload.name || "Goal Quest User",
      emails: [{ value: payload.email || `${payload.sub}@example.com` }],
      photos: [{ value: payload.picture || "" }]
    });

    res.json({
      token: createMobileToken(user),
      user: serializeUser(user)
    });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!googleClientId || !googleClientSecret) {
      res.status(500).json({ error: "Google OAuth is not configured." });
      return;
    }

    passport.authenticate("google", {
      failureRedirect: "/?authError=google"
    })(req, res, next);
  },
  (_req, res) => {
    res.redirect("/quests");
  }
);

app.post("/auth/logout", (req, res, next) => {
  req.logout((logoutError) => {
    if (logoutError) {
      next(logoutError);
      return;
    }

    req.session.destroy((sessionError) => {
      if (sessionError) {
        next(sessionError);
        return;
      }

      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ authenticated: false });
    return;
  }

  res.json({
    authenticated: true,
    user: serializeUser(req.user)
  });
});

app.use("/api", ensureAuthenticated);

app.get("/api/goals", async (req, res, next) => {
  try {
    const goals = await listGoals(req.user.id);
    res.json({ goals });
  } catch (error) {
    next(error);
  }
});

app.get("/api/goals/:goalId", async (req, res, next) => {
  try {
    const goal = await getGoalById(req.user.id, req.params.goalId);

    if (!goal) {
      res.status(404).json({ error: "Goal not found." });
      return;
    }

    res.json({ goal });
  } catch (error) {
    next(error);
  }
});

app.post("/api/goals", async (req, res, next) => {
  try {
    const title = req.body.title?.trim();
    const theme = req.body.theme?.trim() || "Personal mastery";
    const reward = req.body.reward?.trim() || "A satisfying streak";

    if (!title) {
      res.status(400).json({ error: "Goal title is required." });
      return;
    }

    const goal = await createGoal(req.user.id, { title, theme, reward });
    const goals = await listGoals(req.user.id);
    res.status(201).json({ goal, goals });
  } catch (error) {
    next(error);
  }
});

app.post("/api/goals/:goalId/tasks", async (req, res, next) => {
  try {
    const title = req.body.title?.trim();
    const duration = Number(req.body.duration);
    const reminderAt = req.body.reminderAt?.trim() || "";

    if (!title || !Number.isFinite(duration) || duration <= 0) {
      res.status(400).json({ error: "Valid title and duration are required." });
      return;
    }

    const task = await createTask(req.user.id, req.params.goalId, { title, duration, reminderAt });

    if (!task) {
      res.status(404).json({ error: "Goal not found." });
      return;
    }

    const goals = await listGoals(req.user.id);
    res.status(201).json({ task, goals });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/tasks/:taskId/toggle", async (req, res, next) => {
  try {
    const task = await toggleTask(req.user.id, req.params.taskId);

    if (!task) {
      res.status(404).json({ error: "Task not found." });
      return;
    }

    const goals = await listGoals(req.user.id);
    res.json({ task, goals });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/tasks/:taskId/notified", async (req, res, next) => {
  try {
    const task = await markTaskNotified(req.user.id, req.params.taskId);

    if (!task) {
      res.status(404).json({ error: "Task not found." });
      return;
    }

    res.json({ ok: true, task });
  } catch (error) {
    next(error);
  }
});

app.get("/api/todos", async (req, res, next) => {
  try {
    const todos = await listTodos(req.user.id);
    res.json({ todos });
  } catch (error) {
    next(error);
  }
});

app.post("/api/todos", async (req, res, next) => {
  try {
    const title = req.body.title?.trim();

    if (!title) {
      res.status(400).json({ error: "Todo title is required." });
      return;
    }

    const todo = await createTodo(req.user.id, title);
    const todos = await listTodos(req.user.id);
    res.status(201).json({ todo, todos });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/todos/:todoId/toggle", async (req, res, next) => {
  try {
    const todo = await toggleTodo(req.user.id, req.params.todoId);

    if (!todo) {
      res.status(404).json({ error: "Todo not found." });
      return;
    }

    const todos = await listTodos(req.user.id);
    res.json({ todo, todos });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/todos/:todoId", async (req, res, next) => {
  try {
    const deleted = await deleteTodo(req.user.id, req.params.todoId);

    if (!deleted) {
      res.status(404).json({ error: "Todo not found." });
      return;
    }

    const todos = await listTodos(req.user.id);
    res.json({ ok: true, todos });
  } catch (error) {
    next(error);
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

function ensureAuthenticated(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  next();
}

function serializeUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl
  };
}

function createMobileToken(user) {
  return jwt.sign({ sub: user.id, type: "mobile" }, mobileJwtSecret, {
    expiresIn: "30d"
  });
}

module.exports = { app, databaseReady };
