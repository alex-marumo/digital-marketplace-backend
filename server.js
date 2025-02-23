const express = require("express");
const cors = require("cors");
const http = require("http");
const { sequelize } = require("./models");

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/artworks", require("./routes/artworkRoutes"));

const server = http.createServer(app);
const setupSocket = require("./socket");
setupSocket(server);

// Sync DB and start server
const PORT = process.env.PORT || 5000;
sequelize.sync().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
