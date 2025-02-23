const socketio = require("socket.io");

const setupSocket = (server) => {
  const io = socketio(server, {
    cors: { origin: "*" },
  });
  io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);
    socket.on("message", (data) => {
      // broadcast message to all connected clients
      io.emit("message", data);
    });
    socket.on("disconnect", () => console.log("Client disconnected:", socket.id));
  });
};

module.exports = setupSocket;
