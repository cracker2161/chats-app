const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Filter = require('bad-words');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const filter = new Filter();

// MongoDB connection
mongoose.connect('mongodb://localhost/enhanced-chat', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  password: String,
  avatar: String,
  status: String,
  lastSeen: Date,
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  settings: {
    theme: String,
    notifications: Boolean,
    language: String,
    fontSize: Number,
    soundEnabled: Boolean
  }
});

const User = mongoose.model('User', userSchema);

// Message Schema
const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  room: String,
  content: String,
  type: String, // text, image, file
  timestamp: { type: Date, default: Date.now },
  reactions: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: String
  }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

const Message = mongoose.model('Message', messageSchema);

// Room Schema
const roomSchema = new mongoose.Schema({
  name: String,
  type: String, // public, private, direct
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  settings: {
    isModerated: Boolean,
    maxUsers: Number,
    allowLinks: Boolean,
    allowFiles: Boolean
  }
});

const Room = mongoose.model('Room', roomSchema);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);

// Active users and rooms tracking
const activeUsers = new Map();
const activeRooms = new Map();
const typingUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User Authentication
  socket.on('authenticate', async ({ token }) => {
    try {
      const decoded = jwt.verify(token, 'your-secret-key');
      const user = await User.findById(decoded.userId);
      if (user) {
        socket.userId = user._id;
        activeUsers.set(socket.id, {
          userId: user._id,
          username: user.username,
          status: 'online'
        });
        
        // Broadcast user online status
        io.emit('user status', {
          userId: user._id,
          status: 'online'
        });
        
        // Join user's rooms
        const rooms = await Room.find({ members: user._id });
        rooms.forEach(room => {
          socket.join(room._id.toString());
        });
      }
    } catch (error) {
      socket.emit('auth error', { message: 'Authentication failed' });
    }
  });

  // Message Handling
  socket.on('chat message', async (data) => {
    try {
      if (!socket.userId) return;

      // Filter profanity
      const cleanContent = filter.clean(data.content);
      
      // Create and save message
      const message = new Message({
        sender: socket.userId,
        room: data.roomId,
        content: cleanContent,
        type: data.type
      });
      await message.save();

      // Broadcast message
      io.to(data.roomId).emit('chat message', {
        ...message.toObject(),
        sender: activeUsers.get(socket.id)
      });

      // Handle notifications
      const room = await Room.findById(data.roomId);
      room.members.forEach(memberId => {
        if (memberId.toString() !== socket.userId.toString()) {
          io.to(activeUsers.get(memberId)?.socketId).emit('notification', {
            type: 'new_message',
            message: `New message in ${room.name}`
          });
        }
      });
    } catch (error) {
      socket.emit('error', { message: 'Message sending failed' });
    }
  });

  // Typing Indicators
  socket.on('typing start', ({ roomId }) => {
    if (!socket.userId) return;
    
    const roomTyping = typingUsers.get(roomId) || new Set();
    roomTyping.add(socket.userId);
    typingUsers.set(roomId, roomTyping);
    
    io.to(roomId).emit('typing update', Array.from(roomTyping));
  });

  socket.on('typing end', ({ roomId }) => {
    if (!socket.userId) return;
    
    const roomTyping = typingUsers.get(roomId);
    if (roomTyping) {
      roomTyping.delete(socket.userId);
      io.to(roomId).emit('typing update', Array.from(roomTyping));
    }
  });

  // Room Management
  socket.on('create room', async (data) => {
    try {
      const room = new Room({
        name: data.name,
        type: data.type,
        members: [socket.userId],
        admins: [socket.userId],
        settings: data.settings
      });
      await room.save();
      
      socket.join(room._id.toString());
      io.emit('room created', room);
    } catch (error) {
      socket.emit('error', { message: 'Room creation failed' });
    }
  });

  // User Status and Presence
  socket.on('set status', async ({ status }) => {
    if (!socket.userId) return;
    
    try {
      await User.findByIdAndUpdate(socket.userId, {
        status,
        lastSeen: new Date()
      });
      
      const userData = activeUsers.get(socket.id);
      if (userData) {
        userData.status = status;
        io.emit('user status', {
          userId: socket.userId,
          status
        });
      }
    } catch (error) {
      socket.emit('error', { message: 'Status update failed' });
    }
  });

  // Disconnect Handling
  socket.on('disconnect', async () => {
    if (!socket.userId) return;
    
    try {
      await User.findByIdAndUpdate(socket.userId, {
        status: 'offline',
        lastSeen: new Date()
      });
      
      activeUsers.delete(socket.id);
      io.emit('user status', {
        userId: socket.userId,
        status: 'offline'
      });
    } catch (error) {
      console.error('Disconnect handling error:', error);
    }
  });
});

server.listen(4000, () => {
  console.log('Enhanced Chat Server running on http://localhost:4000');
});
