const { app, databaseReady } = require("./app");

const PORT = process.env.PORT || 3000;

databaseReady
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Goal Quest running at http://localhost:${PORT}`);
      console.log("Database: MongoDB");
    });
  })
  .catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
