const express = require("express");
const path = require("path");
const routes = require("./routes");
const { publicDir } = require("./config/paths");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", routes);
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  return res.sendFile(path.join(publicDir, "index.html"));
});

module.exports = app;
