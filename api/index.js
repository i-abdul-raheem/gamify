const { app, databaseReady } = require("../app");

module.exports = async (req, res) => {
  await databaseReady;
  return app(req, res);
};
