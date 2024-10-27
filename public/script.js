const socket = io(); // Assuming you're using socket.io
const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('message');
const sendButton = document.getElementById('send-btn');
const nameInput = document.getElementById('name');
const joinButton = document.getElementById('join-btn');
const inputContainer = document.querySelector('.input-container');

let userName = '';

// Function to join chat
joinButton.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (name) {
        userName = name;
        document.getElementById('name-container').style.display = 'none';
        chatBox.style.display = 'block';
        inputContainer.style.display = 'flex'; // Show input container
    } else {
        alert('Please enter your name');
    }
});

// Function to send message
sendButton.addEventListener('click', () => {
    const message = messageInput.value.trim();

    if (userName && message) {
        socket.emit('chat message', { name: userName, message });
        messageInput.value = '';
    } else {
        alert('Please enter a message');
    }
});

// Function to receive messages
socket.on('chat message', ({ name, message }) => {
    const newMessage = document.createElement('div');
    newMessage.innerHTML = `<i class="fas fa-user"></i> ${name}: ${message}`;
    chatBox.appendChild(newMessage);
    chatBox.scrollTop = chatBox.scrollHeight; // Scroll to the bottom
});
