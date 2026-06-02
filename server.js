const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const session = require("express-session");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const MongoStore = require("connect-mongo");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect("mongodb+srv://xBarmanDude:renderer425@cluster0.3mlsxhc.mongodb.net/chatapp?appName=Cluster0");

cloudinary.config({
    cloud_name: "dfdpgmrtz",
    api_key: "149859293988411",
    api_secret: "zTciMovkqHrtN6rVQNXjS3N_DL8"
});

const upload = multer({
    storage: multer.memoryStorage()
});

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
    password: String,
    lastSeen: Date
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: "chatapp_secret",
    resave: false,
    saveUninitialized: false,
    store: new MongoStore({
    mongoUrl: "mongodb+srv://xBarmanDude:renderer425@cluster0.3mlsxhc.mongodb.net/chatapp?appName=Cluster0"
}),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
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

// upload
app.post("/upload", upload.single("image"), async (req, res) => {
    try {
        const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                {
                    folder: "chat_uploads",
                    resource_type: "auto"
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            ).end(req.file.buffer);
        });

        res.json({
            success: true,
            url: result.secure_url
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.use(express.static("public"));

// memory
const onlineUsers = new Map();

// socket
io.on("connection", (socket) => {

    socket.on("userOnline", (username) => {
        onlineUsers.set(socket.id, username);
        io.emit("onlineUsers", Array.from(onlineUsers.values()));
    });

    socket.on("joinRoom", async (room) => {
        socket.join(room);
        const messages = await Message.find({ room, isDM: false }).sort({ time: 1 }).limit(50);
        socket.emit("loadMessages", messages);
    });

    socket.on("getLastSeen", async (data) => {
        const users = await User.find({}, "username lastSeen").lean();

        const map = {};
        users.forEach(u => {
            if (u.lastSeen) map[u.username] = u.lastSeen;
        });

        socket.emit("lastSeenData", map);
    });

    socket.on("joinDM", async (data) => {
        const dmRoom = [data.from, data.to].sort().join("_");
        socket.join(dmRoom);

        const messages = await Message.find({ room: dmRoom, isDM: true })
            .sort({ time: 1 })
            .limit(50);

        socket.emit("loadMessages", messages);
    });

    socket.on("call-user", (data) => {
    io.to(data.to).emit("incoming-call", {
        from: data.from,
        type: data.type // "audio" or "video"
    });
});

socket.on("accept-call", (data) => {
    io.to(data.to).emit("call-accepted", {
        from: data.from
    });
});

socket.on("reject-call", (data) => {
    io.to(data.to).emit("call-rejected", {
        from: data.from
    });
});

    socket.on("dm", async (data) => {
        if (!data?.from || !data?.to || !data?.msg) return;

        const dmRoom = [data.from, data.to].sort().join("_");

        await Message.create({
            name: data.from,
            msg: data.msg,
            room: dmRoom,
            to: data.to,
            isDM: true
        });

        io.to(dmRoom).emit("message", {
            name: data.from,
            msg: data.msg,
            room: dmRoom,
            senderId: socket.id
        });
    });

    socket.on("message", async (data) => {
        if (!data?.room || !data?.msg || !data?.name) return;

        await Message.create({
            name: data.name,
            msg: data.msg,
            room: data.room,
            isDM: false
        });

        io.to(data.room).emit("message", {
            name: data.name,
            msg: data.msg,
            room: data.room,
            senderId: socket.id
        });
    });

    socket.on("deleteMessage", async (data) => {
        if (!data?.id) return;

        await Message.findByIdAndDelete(data.id);
        io.emit("messageDeleted", { id: data.id });
    });

    // CALL SYSTEM (SIGNALING)
socket.on("call-user", ({ to, from, offer }) => {
    const targetSocketId = [...onlineUsers.entries()]
        .find(([id, name]) => name === to)?.[0];

    if (targetSocketId) {
        io.to(targetSocketId).emit("incoming-call", {
            from,
            offer
        });
    }
});

socket.on("call-accepted", ({ to, answer }) => {
    socket.to(to).emit("call-accepted", { answer });
});

socket.on("ice-candidate", ({ to, candidate }) => {
    socket.to(to).emit("ice-candidate", { candidate });
});

socket.on("end-call", ({ to }) => {
    socket.to(to).emit("call-ended");
});

    socket.on("disconnect", async () => {
        const username = onlineUsers.get(socket.id);

        if (username) {
            await User.updateOne(
                { username },
                { lastSeen: new Date() }
            );
        }

        onlineUsers.delete(socket.id);
        io.emit("onlineUsers", Array.from(onlineUsers.values()));
    });
});

server.listen(process.env.PORT || 3000, () => {
    console.log("Server running on port " + (process.env.PORT || 3000));
});