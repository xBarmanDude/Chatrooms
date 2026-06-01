const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Connect to MongoDB
mongoose.connect("mongodb+srv://xBarmanDude:renderer425@cluster0.3mlsxhc.mongodb.net/chatapp?appName=Cluster0");

// Message model
const Message = mongoose.model("Message", new mongoose.Schema({
    name: String,
    msg: String,
    room: String,
    time: { type: Date, default: Date.now }
}));

app.use(express.static("public"));

io.on("connection", async (socket) => {
    console.log("User connected:", socket.id);

    socket.on("joinRoom", async (room) => {
        socket.join(room);

        // Load last 50 messages from database
        const messages = await Message.find({ room }).sort({ time: 1 }).limit(50);
        socket.emit("loadMessages", messages);
    });

    socket.on("message", async (data) => {
        if (!data || !data.room || !data.msg || !data.name) return;

        // Save to database
        await Message.create({ name: data.name, msg: data.msg, room: data.room });

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

server.listen(process.env.PORT || 3000, () => {
    console.log("Server running on port " + (process.env.PORT || 3000));
});