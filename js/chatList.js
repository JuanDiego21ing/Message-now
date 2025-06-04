// js/chatList.js
import * as UIElements from "./uiElements.js";
import * as State from "./state.js";
import { setStatusMessage, showChatUI, displayMessage } from "./uiHelpers.js";
import { setIsJoiningOrCreatingChat } from "./signaling.js";

export function updateAvailableChats(chats) {
  UIElements.availableChatsList.innerHTML = ""; // Clear previous list
  if (!Array.isArray(chats) || chats.length === 0) {
    UIElements.availableChatsList.innerHTML =
      "<li>No hay chats disponibles aún.</li>";
    return;
  }
  // Sort chats by name, then by ID if name is missing
  chats.sort((a, b) => {
    const nameA = a.chatName || a.chatId || "";
    const nameB = b.chatName || b.chatId || "";
    return nameA.localeCompare(nameB);
  });

  chats.forEach((chat) => addChatToList(chat));
}

export function addChatToList(chat) {
  if (!chat || !chat.chatId) {
    console.warn("Intento de añadir chat inválido a la lista:", chat);
    return;
  }

  const existingListItem = document.getElementById(`chat-${chat.chatId}`);
  if (existingListItem) {
    const nameStrong = existingListItem.querySelector("strong");
    if (nameStrong) {
      nameStrong.textContent =
        chat.chatName || `ID: ${chat.chatId.substring(0, 8)}...`;
    }
    const creatorSpan = existingListItem.querySelector(".creator");
    if (creatorSpan) {
      creatorSpan.textContent = chat.creator || "Desconocido";
    }
    const memberCountSpan = existingListItem.querySelector(".member-count");
    if (memberCountSpan) {
      memberCountSpan.textContent = chat.memberCount;
    }
    const joinButton = existingListItem.querySelector("button");
    if (joinButton) {
      joinButton.dataset.chatname = chat.chatName || "";
    }
    return;
  }

  const listItem = document.createElement("li");
  listItem.id = `chat-${chat.chatId}`;
  listItem.innerHTML = `
        Sala: <strong>${
          chat.chatName || `ID: ${chat.chatId.substring(0, 8)}...`
        }</strong>
        <br>Creador: <span class="creator">${
          chat.creator || "Desconocido"
        }</span> 
        (<span class="member-count">${
          chat.memberCount || 0
        }</span> participante/s)
        <button data-chatid="${chat.chatId}" data-chatname="${
    chat.chatName || ""
  }">Unirse</button>
    `;

  const joinButton = listItem.querySelector("button");
  joinButton.addEventListener("click", () => {
    const targetChatId = joinButton.dataset.chatid;
    const targetChatName =
      joinButton.dataset.chatname || `ID: ${targetChatId.substring(0, 8)}...`;
    requestJoinChat(targetChatId, targetChatName);
  });
  UIElements.availableChatsList.appendChild(listItem);
}

export function removeChatFromList(chatId) {
  const listItem = document.getElementById(`chat-${chatId}`);
  if (listItem) {
    listItem.remove();
    if (UIElements.availableChatsList.children.length === 0) {
      UIElements.availableChatsList.innerHTML =
        "<li>No hay chats disponibles aún.</li>";
    }
  }
}

export function requestJoinChat(chatId, chatName) {
  // ---- LOG AÑADIDO PARA DEPURACIÓN ----
  console.log(
    "REQUEST JOIN CHAT (chatList.js): State.username is:",
    State.getUsername()
  );
  console.log(
    "REQUEST JOIN CHAT (chatList.js): State.getAuthToken is present:",
    State.getAuthToken() ? "Yes" : "No"
  );
  // ---- FIN DE LOGS ----

  const username = State.getUsername(); // Obtiene el username del usuario autenticado
  const currentChatId = State.getCurrentChatId();
  const signalingSocket = State.getSignalingSocket();
  const clientId = State.getClientId(); // Este es el connId del WebSocket

  if (!username) {
    // Esta verificación ahora se basa en el usuario autenticado
    setStatusMessage(
      "Debes estar autenticado para unirte a un chat. Por favor, inicia sesión.", // Mensaje actualizado
      "error"
    );
    return;
  }
  if (currentChatId) {
    setStatusMessage(
      "Ya estás en un chat. Sal de él para unirte a otro.",
      "warning"
    );
    return;
  }
  if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
    setStatusMessage(
      "No conectado al servidor de señalización. Intenta de nuevo.",
      "error"
    );
    return;
  }

  setIsJoiningOrCreatingChat(true);
  State.setCurrentChatId(chatId);
  State.setCurrentChatName(chatName);

  setStatusMessage(
    `Solicitando unirse al chat "${chatName || chatId.substring(0, 8)}"...`,
    "info"
  );

  signalingSocket.send(
    JSON.stringify({
      type: "register_user",
      chatId: chatId,
      // El servidor ya toma el username y el connId (equivalente a este clientId) del objeto 'ws' autenticado
      // por el token, así que enviar estos desde el cliente es redundante pero no dañino si el servidor los ignora.
      username: username,
      clientId: clientId,
    })
  );

  showChatUI();
  displayMessage(
    "Sistema",
    `Intentando unirse al chat "${chatName || chatId.substring(0, 8)}"...`,
    false
  );
}
