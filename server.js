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
const userSocketMap = new Map();
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const webpush = require('web-push');
webpush.setVapidDetails(
    'mailto:chatrooms@app.com',
    'BJcFZ9-DOXiATq4if51Pgw9eirLRgbE_fbkxOo4kb5LFY1kzi5vprKKIUU8mOpztltKGnvlD4LOEJnuD-HgXak8',
    'OjV_FojsHyiWNHkdH32YKGZTcoak259DmPlItc9dEB4'
);

mongoose.connect("mongodb+srv://xBarmanDude:renderer425@cluster0.3mlsxhc.mongodb.net/chatapp?appName=Cluster0");

cloudinary.config({
    cloud_name: "dfdpgmrtz",
    api_key: "149859293988411",
    api_secret: "zTciMovkqHrtN6rVQNXjS3N_DL8"
});

const upload = multer({ storage: multer.memoryStorage() });

const Message = mongoose.model("Message", new mongoose.Schema({
    name: String,
    avatar: { type: String, default: "" },
    msg: String,
    room: String,
    to: String,
    isDM: { type: Boolean, default: false },
    time: { type: Date, default: Date.now },
edited: { type: Boolean, default: false }
}));

const User = mongoose.model("User", new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    avatar: { type: String, default: "" },
    lastSeen: Date
}));

const PushSub = mongoose.model("PushSub", new mongoose.Schema({
    username: { type: String, unique: true },
    subscription: Object
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: "chatapp_secret",
    resave: false,
    saveUninitialized: false,
    store: new MongoStore({
        mongoUrl: "mongodb+srv://xBarmanDude:renderer425@cluster0.3mlsxhc.mongodb.net/chatapp?appName=Cluster0"
    }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.get("/", (req, res) => {
    if (req.session.username) res.sendFile(__dirname + "/public/chat.html");
    else res.sendFile(__dirname + "/public/login.html");
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

app.get("/session", async (req, res) => {
    if (!req.session.username) return res.json({ username: "Anonymous", avatar: "" });
    const user = await User.findOne({ username: req.session.username }, "avatar");
    res.json({ username: req.session.username, avatar: user?.avatar || "" });
});

app.get("/users", async (req, res) => {
    if (!req.session.username) return res.json({ error: "Not logged in" });
    const users = await User.find({}, "username avatar").lean();
    res.json(users.filter(u => u.username !== req.session.username));
});

app.post("/upload", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });

        const originalName = req.file.originalname;
        const lastDotIndex = originalName.lastIndexOf(".");
        const nameWithoutExtension = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
        const ext = lastDotIndex !== -1 ? originalName.substring(lastDotIndex) : "";
        const safeName = nameWithoutExtension.replace(/[?&#\\%<>+ ]/g, "-");
        
        let customPublicId = Date.now() + "_" + safeName;
        const mimeType = req.file.mimetype;
        let resourceType = "auto";

        // Force documents/PDFs to use the 'raw' asset pathway
        if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/") && !mimeType.startsWith("audio/")) {
            resourceType = "raw";
            customPublicId += ext; // Raw assets MUST keep their extension explicitly inside the public_id
        }

        const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                { 
                    folder: "chat_uploads", 
                    resource_type: resourceType,
                    public_id: customPublicId 
                },
                (error, result) => { if (error) reject(error); else resolve(result); }
            ).end(req.file.buffer);
        });
        
        res.json({ success: true, url: result.secure_url });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.get('/get-agora-token', (req, res) => {
    const channelName = req.query.channel;
    const uid = req.query.uid || ""; 
    
    if (!channelName) {
        return res.status(400).json({ error: 'Channel name is required' });
    }

    const appId = 'affd93b1f9d84aa99e304aabe79347e4';
    const appCertificate = 'cb826790b03e45f79a1c727825c575d3'; 
    const role = RtcRole.PUBLISHER;
    
    const expirationTimeInSeconds = 7200; 
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUserAccount(
        appId, 
        appCertificate, 
        channelName, 
        uid, 
        role, 
        privilegeExpiredTs
    );

    return res.json({ token: token });
});

app.post("/update-profile", upload.single("avatar"), async (req, res) => {
    if (!req.session.username) return res.status(401).json({ success: false, error: "Unauthorized" });
    try {
        if (!req.file) return res.status(400).json({ success: false, error: "No image file provided" });

        const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                { folder: "avatars", resource_type: "image" },
                (error, result) => { if (error) reject(error); else resolve(result); }
            ).end(req.file.buffer);
        });

        await User.updateOne({ username: req.session.username }, { avatar: result.secure_url });
        res.json({ success: true, avatar: result.secure_url });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: 'BJcFZ9-DOXiATq4if51Pgw9eirLRgbE_fbkxOo4kb5LFY1kzi5vprKKIUU8mOpztltKGnvlD4LOEJnuD-HgXak8' });
});

app.post('/subscribe', async (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: 'Unauthorized' });
    const { subscription } = req.body;
    await PushSub.findOneAndUpdate(
        { username: req.session.username },
        { username: req.session.username, subscription },
        { upsert: true, new: true }
    );
    res.json({ success: true });
});

app.use(express.static("public"));

const onlineUsers = new Map();

io.on("connection", (socket) => {

    socket.on("typing", (data) => {
    const targetSocketId = userSocketMap.get(data.to);
    if (targetSocketId) {
        io.to(targetSocketId).emit("userTyping", { from: onlineUsers.get(socket.id) });
    }
});

socket.on("subscribeAllDMs", async (myUsername) => {
    const users = await User.find({ username: { $ne: myUsername } }, "username").lean();
    users.forEach(u => {
        const dmRoom = [myUsername, u.username].sort().join("_");
        socket.join(dmRoom);
    });
});

socket.on("editMessage", async (data) => {
    if (!data?.id || !data?.msg) return;
    const message = await Message.findByIdAndUpdate(
        data.id,
        { msg: data.msg, edited: true },
        { new: true }
    );
    if (!message) return;
    io.to(message.room).emit("messageEdited", { id: data.id, msg: data.msg });
});

socket.on("call-invite", ({ to, from, room }) => {
    const targetId = userSocketMap.get(to);
    if (targetId) io.to(targetId).emit("call-invite", { from, room });
});

    socket.on("userOnline", (username) => {
        userSocketMap.set(username, socket.id);
onlineUsers.set(socket.id, username);

io.emit("onlineUsers", Array.from(userSocketMap.keys()));
    });

    socket.on("joinRoom", async (room) => {
    const targetRoom = room || "general";
    socket.join(targetRoom);
    
    const messages = await Message.find({ room: targetRoom, isDM: false })
                                  .sort({ time: -1 }) 
                                  .limit(50);
                                  
    socket.emit("loadMessages", messages.reverse()); 
});

    socket.on("getLastSeen", async () => {
        const users = await User.find({}, "username lastSeen").lean();
        const map = {};
        users.forEach(u => { if (u.lastSeen) map[u.username] = u.lastSeen; });
        socket.emit("lastSeenData", map);
    });

    socket.on("joinDM", async (data) => {
    const dmRoom = [data.from, data.to].sort().join("_");
    socket.join(dmRoom);
    
    const messages = await Message.find({ room: dmRoom, isDM: true })
        .sort({ time: -1 }) 
        .limit(50);
        
    socket.emit("loadMessages", messages.reverse()); // Reverse back to chronological
});

socket.on("dm", async (data) => {
    const from = (data.from || "");
    const to = (data.to || "");
    const msg = data.msg;
    if (!from || !to || !msg) return;

    const dmRoom = [from.trim(), to.trim()].sort().join("_");
    const user = await User.findOne({ username: from }, "avatar");

    const newMsg = await Message.create({
        name: from, avatar: user?.avatar || "", msg, room: dmRoom, to, isDM: true
    });

    io.to(dmRoom).emit("message", newMsg);
    const recipientSub = await PushSub.findOne({ username: to });
    if (recipientSub && !userSocketMap.has(to)) {
    try {
        await webpush.sendNotification(
            recipientSub.subscription,
            JSON.stringify({
                title: `💬 ${from}`,
                body: msg.startsWith('https://') 
                    ? '📎 Sent an attachment' 
                    : (msg.length > 60 ? msg.substring(0, 60) + '...' : msg)
            })
        );
    } catch (err) {
        if (err.statusCode === 410) await PushSub.deleteOne({ username: to });
    }
}
});

socket.on("message", async (data) => {
    const room = "general"; 
    if (!data?.msg || !data?.name) return;

    const user = await User.findOne({ username: data.name }, "avatar");

    const newMsg = await Message.create({ 
        name: data.name,
        avatar: user?.avatar || "",
        msg: data.msg, 
        room: room,
        isDM: false 
    });

    io.to(room).emit("message", newMsg);
});

    socket.on("deleteMessage", async (data) => {
        if (!data?.id) return;
        await Message.findByIdAndDelete(data.id);
        io.emit("messageDeleted", { id: data.id });
    });

    socket.on("disconnect", async () => {
    const username = onlineUsers.get(socket.id);

    if (username) {
        userSocketMap.delete(username);
        onlineUsers.delete(socket.id);
        await User.updateOne({ username }, { lastSeen: new Date() });
    }

    io.emit("onlineUsers", Array.from(userSocketMap.keys()));
});
});

server.listen(process.env.PORT || 3000, () => {
    console.log("Server running on port " + (process.env.PORT || 3000));
});