require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const passport = require("passport");
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
  getUserById
} = require("./db");

const app = express();
const publicDir = path.join(__dirname, "public");
const sessionSecret = process.env.SESSION_SECRET;
const mongoUri = process.env.MONGODB_URI;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback";

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
app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/create", (_req, res) => {
  res.sendFile(path.join(publicDir, "create.html"));
});

app.get("/quests", (_req, res) => {
  res.sendFile(path.join(publicDir, "quests.html"));
});

app.get("/quests/:goalId", (_req, res) => {
  res.sendFile(path.join(publicDir, "quest.html"));
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

  req.session.oauthReturnMode = req.query.mode === "popup" ? "popup" : "redirect";

  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
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
  (req, res) => {
    const returnMode = req.session.oauthReturnMode || "redirect";
    delete req.session.oauthReturnMode;

    if (returnMode === "popup") {
      res.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Signing in…</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #07111f;
        color: #f6f1e8;
        font-family: Poppins, sans-serif;
      }

      p {
        margin: 0;
        opacity: 0.82;
      }
    </style>
  </head>
  <body>
    <p>Finishing sign-in…</p>
    <script>
      (function () {
        var target = ${JSON.stringify(googleCallbackUrl ? new URL(googleCallbackUrl).origin : "")};

        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: "goalquest:auth-complete" }, target || window.location.origin);
          window.close();
          return;
        }

        window.location.replace("/quests");
      })();
    </script>
  </body>
</html>`);
      return;
    }

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
    user: {
      id: req.user.id,
      displayName: req.user.displayName,
      email: req.user.email,
      avatarUrl: req.user.avatarUrl
    }
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

app.get("*", (_req, res) => {
  res.redirect("/");
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

function ensureAuthenticated(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  next();
}

module.exports = { app, databaseReady };
