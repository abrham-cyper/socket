const express = require('express');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const http = require('http'); // Import HTTP to create the server
const socketIo = require('socket.io'); // Import Socket.IO

const app = express();
const server = http.createServer(app); // Create an HTTP server
const io = socketIo(server); // Attach Socket.IO to the server

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/chat_app', { useNewUrlParser: true, useUnifiedTopology: true });

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Define Conversation and Message models
const conversationSchema = new mongoose.Schema({
  participants: [String], // Array of usernames participating in the conversation
  conversationId: { type: String, unique: true },
});

const Conversation = mongoose.model('Conversation', conversationSchema);

const messageSchema = new mongoose.Schema({
  conversationId: String,          // Unique ID for each conversation
  senderUsername: String,          // Username of the sender
  receiverUsername: String,        // Username of the receiver
  message: String,
  whosend: String,                 // Who sent the message (senderUsername)
  timestamp: { type: Date, default: Date.now },
});

const Message = mongoose.model('Message', messageSchema);

// Middleware to parse JSON
app.use(express.json());



// Create a new conversation
app.post('/api/conversations', async (req, res) => {
  const { senderUsername, receiverUsername } = req.body;

  if (!senderUsername || !receiverUsername) {
    return res.status(400).json({ message: 'Sender and receiver are required' });
  }

  // Check if a conversation already exists between the two participants
  let conversation = await Conversation.findOne({
    participants: { $all: [senderUsername, receiverUsername] }
  });

  // If no conversation exists, create a new one
  if (!conversation) {
    const conversationId = uuidv4(); // Generate a unique conversation ID
    conversation = new Conversation({
      participants: [senderUsername, receiverUsername],
      conversationId
    });

    try {
      await conversation.save();
      res.status(200).json({ conversationId });
    } catch (error) {
      res.status(500).json({ message: 'Error creating conversation' });
    }
  } else {
    // If the conversation exists, return the existing conversationId
    res.json({ conversationId: conversation.conversationId });
  }
});

// Get all messages from a specific conversation
app.get('/api/messages/conversation/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  try {
    const messages = await Message.find({ conversationId });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching messages' });
  }
});


app.get('/api/messages/list/:senderUsername', async (req, res) => {
  const { senderUsername } = req.params;
  try {
    console.log('Fetching data for senderUsername:', senderUsername); // Debugging line
    
    // Use the Conversation model here, not the schema
    const userslist = await Conversation.find(
      { participants: senderUsername },
      { participants: 1, conversationId: 1, _id: 0 }
    );

    // Assuming you want receiverUsername too, we need to filter it out
    const formattedList = userslist.map(convo => {
      const receiverUsername = convo.participants.find(participant => participant !== senderUsername);
      return {
        conversationId: convo.conversationId,
        receiverUsername,
      };
    });

    res.json(formattedList);
  } catch (error) {
    console.log('Error:', error); // Log the error to see more details
    res.status(500).json({ message: 'Error fetching messages', error: error.message });
  }
});



// Send a new message in a specific conversation
app.post('/api/messages', async (req, res) => {
  const { conversationId, senderUsername, receiverUsername, message } = req.body;

  if (!conversationId || !senderUsername || !receiverUsername || !message) {
    return res.status(400).json({ message: 'Conversation ID, sender, receiver, and message are required' });
  }

  try {
    // Create a new message with 'whosend' set to sender's username
    const newMessage = new Message({ conversationId, senderUsername, receiverUsername, message, whosend: senderUsername });
    await newMessage.save();

    // Emit the message to all connected clients in the same conversation
    io.to(conversationId).emit('newMessage', newMessage);

    res.status(200).json(newMessage);
  } catch (error) {
    res.status(500).json({ message: 'Error saving message' });
  }
});

// Socket.IO connection for chat and video/audio calls
io.on('connection', (socket) => {
  console.log('A user connected');

  // Join a conversation room
  socket.on('joinConversation', (conversationId) => {
    socket.join(conversationId);
    console.log(`User joined conversation: ${conversationId}`);
  });

  // Handle offer from caller (video/audio call)
  socket.on('offer', (data) => {
    console.log('Offer received:', data);
    socket.to(data.receiverId).emit('offer', data);
  });

  // Handle answer from receiver (video/audio call)
  socket.on('answer', (data) => {
    console.log('Answer received:', data);
    socket.to(data.callerId).emit('answer', data);
  });

  // Handle ICE candidate from a peer (WebRTC)
  socket.on('ice-candidate', (data) => {
    console.log('ICE candidate received:', data);
    socket.to(data.targetId).emit('ice-candidate', data);
  });

  // Disconnect event
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
