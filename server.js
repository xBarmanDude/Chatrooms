const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("joinRoom", (room) => {
        socket.join(room);
    });

    // FIXED: match frontend "message"
    socket.on("message", (data) => {
        if (!data || !data.room || !data.msg || !data.name) return;

        io.to(data.room).emit("message", {
    name: data.name,
    msg: data.msg,
    room: data.room,
    senderId: socket.id
});
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});