// js/uiHelpers.js
import * as UIElements from './uiElements.js';
import * as State from './state.js';
// ... (otras importaciones y funciones displayMessage, setStatusMessage, etc. sin cambios) ...

export function displayMessage(sender, text, isMe) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message");
  if (isMe) {
    messageDiv.classList.add("me");
  } else if (sender.toLowerCase() === "sistema") {
    messageDiv.classList.add("system");
  }

  const sanitizedText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  messageDiv.innerHTML = `<strong>${isMe ? "Yo" : sender}:</strong> ${sanitizedText}`;
  UIElements.messagesDiv.appendChild(messageDiv);
  UIElements.messagesDiv.scrollTop = UIElements.messagesDiv.scrollHeight;
}

export function setStatusMessage(message, type = "info") {
  if (UIElements.statusMessageDiv) {
    UIElements.statusMessageDiv.textContent = message;
    UIElements.statusMessageDiv.className = `status-message ${type}`;
    UIElements.statusMessageDiv.style.display = "block";

    if (type === "success" || type === "info") { // Auto-hide info y success
        setTimeout(() => {
            if (UIElements.statusMessageDiv.textContent === message) {
                clearStatusMessage();
            }
        }, 3500);
    }
  }
}

export function clearStatusMessage() {
  if (UIElements.statusMessageDiv) {
    UIElements.statusMessageDiv.textContent = "";
    UIElements.statusMessageDiv.className = "status-message";
    UIElements.statusMessageDiv.style.display = "none";
  }
}

export function updateMembersList() {
  UIElements.membersList.innerHTML = ""; 

  const myUsername = State.getUsername();
  const myClientId = State.getClientId();
  const currentChatMembers = State.getCurrentChatMembers();

  if (myUsername && myClientId && currentChatMembers[myClientId]) {
    const myListItem = document.createElement("li");
    myListItem.textContent = `${myUsername} (Tú)`;
    myListItem.classList.add("me");
    UIElements.membersList.appendChild(myListItem);
  }

  for (const remoteClientId in currentChatMembers) {
    if (remoteClientId === myClientId) continue;

    const memberUsername = currentChatMembers[remoteClientId];
    const listItem = document.createElement("li");
    listItem.textContent = memberUsername;

    const peer = State.getActivePeer(remoteClientId);
    if (peer && peer.connected) {
      listItem.classList.add("connected");
      listItem.textContent += " (Conectado)";
    } else {
      listItem.classList.add("connecting");
      listItem.textContent += " (Uniéndose...)";
    }
    UIElements.membersList.appendChild(listItem);
  }
}


export function showChatUI() {
  UIElements.userSetupDiv.style.display = "none";
  UIElements.createChatButton.style.display = "none";
  UIElements.chatListDiv.style.display = "none";

  UIElements.chatAreaDiv.style.display = "block";
  UIElements.messageInputAreaDiv.style.display = "flex";
  if (UIElements.leaveChatButton) UIElements.leaveChatButton.style.display = "inline-block";

  const chatName = State.getCurrentChatName();
  const chatId = State.getCurrentChatId();
  const roomNameDisplay = chatName || (chatId ? `ID: ${chatId.substring(0, 8)}...` : 'Chat');
  
  UIElements.chatAreaTitle.textContent = `Chat: ${roomNameDisplay}`;
  updateMembersList();
}

// MODIFICADO: Añadido parámetro doRequestChatList
export function showLobbyUI(doRequestChatList = true) {
  UIElements.userSetupDiv.style.display = "none"; // Asegurarse que el setup de usuario esté oculto
  UIElements.createChatButton.style.display = "block";
  UIElements.chatListDiv.style.display = "block";

  UIElements.chatAreaDiv.style.display = "none";
  UIElements.messageInputAreaDiv.style.display = "none";
  if (UIElements.leaveChatButton) UIElements.leaveChatButton.style.display = "none";

  UIElements.messagesDiv.innerHTML = "";
  UIElements.messageInput.value = "";
  UIElements.membersList.innerHTML = ""; // Limpiar lista de miembros al volver al lobby

  const signalingSocket = State.getSignalingSocket();
  // Solo solicitar la lista si se indica explícitamente
  if (doRequestChatList && signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    console.log("showLobbyUI: Solicitando explícitamente chat_list");
    signalingSocket.send(JSON.stringify({ type: "request_chat_list" }));
  }
  // El mensaje de bienvenida al lobby se puede poner aquí o cuando la lista de chats se actualice.
  // Por ahora, lo dejamos aquí.
  // No borrar el status message si ya hay uno importante de error.
  if (!UIElements.statusMessageDiv.classList.contains('error') && !UIElements.statusMessageDiv.classList.contains('warning')) {
    setStatusMessage("Bienvenido al lobby. Crea o únete a un chat.", "info");
  }
}

export function hideInitialUI() {
  UIElements.userSetupDiv.style.display = "flex";
  UIElements.chatAreaDiv.style.display = "none";
  UIElements.messageInputAreaDiv.style.display = "none";
  UIElements.chatListDiv.style.display = "none";
  UIElements.createChatButton.style.display = "none";
  UIElements.statusMessageDiv.style.display = "none";
  UIElements.leaveChatButton.style.display = "none";
  UIElements.roomNameModal.style.display = "none";
  UIElements.confirmLeaveModal.style.display = "none";
}