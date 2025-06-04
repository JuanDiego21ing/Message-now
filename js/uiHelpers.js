// js/uiHelpers.js
import * as UIElements from "./uiElements.js";
import * as State from "./state.js";

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
  messageDiv.innerHTML = `<strong>${
    isMe ? "Yo" : sender
  }:</strong> ${sanitizedText}`;
  UIElements.messagesDiv.appendChild(messageDiv);
  UIElements.messagesDiv.scrollTop = UIElements.messagesDiv.scrollHeight;
}

export function setStatusMessage(message, type = "info") {
  if (UIElements.statusMessageDiv) {
    UIElements.statusMessageDiv.textContent = message;
    UIElements.statusMessageDiv.className = `status-message ${type}`;
    UIElements.statusMessageDiv.style.display = "block";

    if (type === "success" || type === "info") {
      setTimeout(() => {
        // Solo limpiar si el mensaje no ha cambiado (para evitar borrar un error posterior)
        if (
          UIElements.statusMessageDiv.textContent === message &&
          UIElements.statusMessageDiv.classList.contains(type)
        ) {
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
  if (!UIElements.membersList) {
    console.warn("Elemento membersList no encontrado en updateMembersList");
    return;
  }
  UIElements.membersList.innerHTML = "";

  const myUsername = State.getUsername(); // Nombre de usuario autenticado
  const myConnId = State.getClientId(); // ID de la conexión WebSocket actual
  const currentChatMembers = State.getCurrentChatMembers(); // Debería ser { connId1: username1, connId2: username2, ... }

  // Añadir al usuario actual (Tú) a la lista
  // El servidor ya incluye al propio usuario en la lista de miembros que envía,
  // así que esta lógica podría ser redundante o causar duplicados si no se maneja con cuidado.
  // La clave es que `currentChatMembers` debe ser la fuente de verdad.
  // Si `currentChatMembers` ya contiene mi `myConnId` con mi `myUsername`, el bucle de abajo me añadirá.
  // Vamos a simplificar: el bucle se encargará de todos, y marcaremos al propio usuario.

  if (
    Object.keys(currentChatMembers).length === 0 &&
    State.getCurrentChatId()
  ) {
    // Si estamos en un chat pero la lista de miembros está vacía (ej. justo al crear)
    // podríamos añadirnos temporalmente, pero es mejor esperar la actualización del servidor.
    // Por ahora, si está vacío, no mostramos nada o un mensaje de "cargando miembros".
    // UIElements.membersList.innerHTML = "<li>Cargando miembros...</li>";
    // return; // Opcional, dependiendo de si se quiere mostrar algo mientras llega la lista
  }

  for (const memberConnId in currentChatMembers) {
    const memberUsername = currentChatMembers[memberConnId];
    const listItem = document.createElement("li");
    listItem.textContent = memberUsername;

    if (memberConnId === myConnId) {
      // Si este miembro soy yo
      listItem.textContent += " (Tú)";
      listItem.classList.add("me");
    }

    const peer = State.getActivePeer(memberConnId); // Usar connId para buscar el peer
    if (peer && peer.connected) {
      listItem.classList.add("connected");
      listItem.textContent += " (Conectado P2P)";
    } else if (memberConnId !== myConnId) {
      // No mostrar "Uniéndose..." para mí mismo si no estoy conectado P2P conmigo mismo
      listItem.classList.add("connecting");
      listItem.textContent += " (Estableciendo P2P...)";
    }
    UIElements.membersList.appendChild(listItem);
  }
}

export function showChatUI() {
  // UIElements.userSetupDiv.style.display = "none"; // userSetupDiv ya no existe, esta línea causaría error si no se comenta/elimina.
  // app.js ahora controla la visibilidad de authAreaDiv y mainAppAreaDiv.
  if (UIElements.authAreaDiv) UIElements.authAreaDiv.style.display = "none"; // Ocultar autenticación
  if (UIElements.mainAppAreaDiv)
    UIElements.mainAppAreaDiv.style.display = "block"; // Mostrar área principal

  UIElements.createChatButton.style.display = "none"; // Ocultar en la vista de chat
  UIElements.chatListDiv.style.display = "none"; // Ocultar en la vista de chat

  UIElements.chatAreaDiv.style.display = "block";
  UIElements.messageInputAreaDiv.style.display = "flex";
  if (UIElements.leaveChatButton)
    UIElements.leaveChatButton.style.display = "inline-block";

  const chatName = State.getCurrentChatName();
  const chatId = State.getCurrentChatId();
  const roomNameDisplay =
    chatName || (chatId ? `ID: ${chatId.substring(0, 8)}...` : "Chat");

  if (UIElements.chatAreaTitle) {
    UIElements.chatAreaTitle.textContent = `Chat: ${roomNameDisplay}`;
  }
  updateMembersList();
}

export function showLobbyUI(doRequestChatList = true) {
  // UIElements.userSetupDiv.style.display = "none"; // userSetupDiv ya no existe
  if (UIElements.authAreaDiv) UIElements.authAreaDiv.style.display = "none"; // Ocultar autenticación
  if (UIElements.mainAppAreaDiv)
    UIElements.mainAppAreaDiv.style.display = "block"; // Mostrar área principal

  UIElements.createChatButton.style.display = "block"; // Mostrar en el lobby
  UIElements.chatListDiv.style.display = "block"; // Mostrar en el lobby

  UIElements.chatAreaDiv.style.display = "none";
  UIElements.messageInputAreaDiv.style.display = "none";
  if (UIElements.leaveChatButton)
    UIElements.leaveChatButton.style.display = "none";

  UIElements.messagesDiv.innerHTML = "";
  UIElements.messageInput.value = "";
  UIElements.membersList.innerHTML = "";

  const signalingSocket = State.getSignalingSocket();
  if (
    doRequestChatList &&
    signalingSocket &&
    signalingSocket.readyState === WebSocket.OPEN
  ) {
    console.log(
      "UIHELPERS (showLobbyUI): Solicitando explícitamente chat_list"
    );
    signalingSocket.send(JSON.stringify({ type: "request_chat_list" }));
  }

  // Solo establecer mensaje de bienvenida si no hay un error o warning importante
  if (
    UIElements.statusMessageDiv &&
    !UIElements.statusMessageDiv.classList.contains("error") &&
    !UIElements.statusMessageDiv.classList.contains("warning")
  ) {
    setStatusMessage("Bienvenido al lobby. Crea o únete a un chat.", "info");
  }
}

/**
 * Esta función podría ya no ser necesaria o su lógica ha sido absorbida
 * por showAuthUI y showMainAppUI en app.js
 */
export function hideInitialUI() {
  console.warn(
    "UIHELPERS: hideInitialUI() llamada, pero podría ser obsoleta. Verificar su uso."
  );
  // UIElements.userSetupDiv.style.display = "flex"; // userSetupDiv ya no existe
  if (UIElements.authAreaDiv) UIElements.authAreaDiv.style.display = "flex"; // Mostrar auth por defecto si esto se llamara
  if (UIElements.mainAppAreaDiv)
    UIElements.mainAppAreaDiv.style.display = "none";

  if (UIElements.chatAreaDiv) UIElements.chatAreaDiv.style.display = "none";
  if (UIElements.messageInputAreaDiv)
    UIElements.messageInputAreaDiv.style.display = "none";
  if (UIElements.chatListDiv) UIElements.chatListDiv.style.display = "none";
  if (UIElements.createChatButton)
    UIElements.createChatButton.style.display = "none";
  // statusMessageDiv se maneja por setStatusMessage/clearStatusMessage
  if (UIElements.leaveChatButton)
    UIElements.leaveChatButton.style.display = "none";
  if (UIElements.roomNameModal) UIElements.roomNameModal.style.display = "none";
  if (UIElements.confirmLeaveModal)
    UIElements.confirmLeaveModal.style.display = "none";
}
