const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const session = require("express-session");
const MongoStore = require("connect-mongo/session");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect("mongodb+srv://xBarmanDude:renderer425@cluster0.3mlsxhc.mongodb.net/chatapp?appName=Cluster0");

// Models
const Message = mongoose.model("Message", new mongoose.Schema({
    name: String,
    msg: String,
    room: String,
    to: String,
    isDM: { type: Boolean, default: false },
    time: { type: Date, default: Date.now }
}));

const User = mongoose.model("User", new mongoose.Schema({
    username: { type: String, unique: true },
    password: String
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: "chatapp_secret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
    mongoUrl: "mongodb+srv://xBarmanDude:renderer425@cluster0.3mlsxhc.mongodb.net/chatapp?appName=Cluster0",
    mongoOptions: { useNewUrlParser: true, useUnifiedTopology: true }
})
}));

// Routes
app.get("/", (req, res) => {
    if (req.session.username) {
        res.sendFile(__dirname + "/public/chat.html");
    } else {
        res.sendFile(__dirname + "/public/login.html");
    }
});

app.post("/register", async (req, res) => {
    const { username, password } = req.body;
    const existing = await User.findOne({ username });
    if (existing) return res.json({ error: "Username already taken" });
    const hashed = await bcrypt.hash(password, 10);
    await User.create({ username, password: hashed });
    req.session.username = username;
    res.json({ success: true });
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.json({ error: "User not found" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ error: "Wrong password" });
    req.session.username = username;
    res.json({ success: true });
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

app.get("/session", (req, res) => {
    res.json({ username: req.session.username || "Anonymous" });
});

app.get("/users", async (req, res) => {
    if (!req.session.username) return res.json({ error: "Not logged in" });
    const users = await User.find({}, "username").lean();
    res.json(users.filter(u => u.username !== req.session.username));
});

app.use(express.static("public"));

// Socket
io.on("connection", async (socket) => {
    console.log("User connected:", socket.id);

    socket.on("joinRoom", async (room) => {
    socket.join(room);
    const messages = await Message.find({ room }).sort({ time: 1 }).limit(50);
    socket.emit("loadMessages", messages);
});

socket.on("joinDM", async (data) => {
    const dmRoom = [data.from, data.to].sort().join("_");
    socket.join(dmRoom);
    const messages = await Message.find({ room: dmRoom, isDM: true }).sort({ time: 1 }).limit(50);
    socket.emit("loadMessages", messages);
});

socket.on("dm", async (data) => {
    if (!data || !data.from || !data.to || !data.msg) return;
    const dmRoom = [data.from, data.to].sort().join("_");
    await Message.create({ name: data.from, msg: data.msg, room: dmRoom, to: data.to, isDM: true });
    io.to(dmRoom).emit("message", {
        name: data.from,
        msg: data.msg,
        room: dmRoom,
        senderId: socket.id
    });
});

    socket.on("message", async (data) => {
        if (!data || !data.room || !data.msg || !data.name) return;
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