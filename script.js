let username = null;
const usernameInput = document.getElementById("username");
const setUsernameButton = document.getElementById("set-username");
const createChatButton = document.getElementById("create-chat");
const availableChatsList = document.getElementById("available-chats");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

setUsernameButton.addEventListener("click", () => {
  username = usernameInput.value.trim();
  if (username) {
    document.getElementById("user-setup").style.display = "none";
    alert(`Tu nombre será: ${username}`);
    // Aquí podríamos iniciar la lógica de descubrimiento o creación de chats
  } else {
    alert("Por favor, ingresa un nombre.");
  }
});

createChatButton.addEventListener("click", () => {
  if (username) {
    console.log("Creando un nuevo chat como:", username);
    // Aquí iría la lógica para iniciar la creación de un chat
  } else {
    alert("Por favor, ingresa tu nombre primero.");
  }
});

// Aquí irían los listeners para unirse a chats de la lista, enviar mensajes, etc.
