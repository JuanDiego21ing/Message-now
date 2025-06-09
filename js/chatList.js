// js/chatList.js
import * as UIElements from "./uiElements.js";
import * as State from "./state.js";
import { setStatusMessage, showChatUI, displayMessage } from "./uiHelpers.js";
import { setIsJoiningOrCreatingChat } from "./signaling.js";

// La librería SweetAlert2 (Swal) ya está disponible globalmente

export function updateAvailableChats(chats) {
  if (!UIElements.availableChatsList) return;
  UIElements.availableChatsList.innerHTML = ""; // Limpiar lista anterior

  if (!Array.isArray(chats) || chats.length === 0) {
    // MODIFICADO: Usar clase de Bootstrap para el mensaje de "no hay chats"
    UIElements.availableChatsList.innerHTML =
      '<li class="list-group-item">No hay chats disponibles aún.</li>';
    return;
  }

  chats.sort((a, b) => {
    const nameA = a.chatName || a.chatId || "";
    const nameB = b.chatName || b.chatId || "";
    return nameA.localeCompare(nameB);
  });

  chats.forEach((chat) => addChatToList(chat));
}

/**
 * MODIFICADO: Añade o actualiza un chat en la lista con clases de Bootstrap para un mejor estilo.
 * @param {object} chat - El objeto de chat del servidor.
 */
export function addChatToList(chat) {
  if (!chat || !chat.chatId) {
    console.warn("Intento de añadir chat inválido a la lista:", chat);
    return;
  }

  const existingListItem = document.getElementById(`chat-${chat.chatId}`);

  // Si el elemento ya existe, solo actualizamos los datos dinámicos (como el número de miembros)
  if (existingListItem) {
    const memberCountBadge = existingListItem.querySelector(
      ".member-count-badge"
    );
    if (memberCountBadge) {
      memberCountBadge.textContent = `${chat.memberCount || 0} Participante(s)`;
    }
    // Podríamos actualizar también nombre y creador si pudieran cambiar, pero es menos común.
    // const nameElement = existingListItem.querySelector(".chat-name");
    // const creatorElement = existingListItem.querySelector(".chat-creator");
    return;
  }

  // Si el elemento no existe, lo creamos desde cero con la estructura de Bootstrap
  const listItem = document.createElement("li");
  // Clases de Bootstrap para un elemento de lista con contenido flexible
  listItem.className =
    "list-group-item d-flex justify-content-between align-items-center";
  listItem.id = `chat-${chat.chatId}`;

  // Contenedor para el nombre del chat y el creador
  const infoDiv = document.createElement("div");
  const chatName = chat.chatName || `Sala sin nombre`;
  const creatorName = chat.creator || "Desconocido";
  infoDiv.innerHTML = `
    <h5 class="mb-1 chat-name">${chatName}</h5>
    <small class="text-muted chat-creator">Creado por: ${creatorName}</small>
  `;

  // Contenedor para el contador de miembros y el botón de unirse
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "d-flex align-items-center gap-3";

  // Badge para el número de participantes
  const memberCountBadge = document.createElement("span");
  memberCountBadge.className =
    "badge bg-secondary rounded-pill member-count-badge";
  memberCountBadge.textContent = `${chat.memberCount || 0} Participante(s)`;

  // Botón para unirse
  const joinButton = document.createElement("button");
  joinButton.className = "btn btn-primary btn-sm";
  joinButton.textContent = "Unirse";
  joinButton.dataset.chatid = chat.chatId;
  joinButton.dataset.chatname = chat.chatName || "";

  joinButton.addEventListener("click", () => {
    requestJoinChat(joinButton.dataset.chatid, joinButton.dataset.chatname);
  });

  // Ensamblar todo
  actionsDiv.appendChild(memberCountBadge);
  actionsDiv.appendChild(joinButton);
  listItem.appendChild(infoDiv);
  listItem.appendChild(actionsDiv);

  UIElements.availableChatsList.appendChild(listItem);
}

export function removeChatFromList(chatId) {
  const listItem = document.getElementById(`chat-${chatId}`);
  if (listItem) {
    listItem.remove();
    if (UIElements.availableChatsList.children.length === 0) {
      UIElements.availableChatsList.innerHTML =
        '<li class="list-group-item">No hay chats disponibles aún.</li>';
    }
  }
}

/**
 * MODIFICADO: Usa SweetAlert2 para mostrar errores al usuario en lugar de setStatusMessage.
 * @param {string} chatId
 * @param {string} chatName
 */
export function requestJoinChat(chatId, chatName) {
  console.log(
    "REQUEST JOIN CHAT (chatList.js): State.username is:",
    State.getUsername()
  );

  const username = State.getUsername();
  const currentChatId = State.getCurrentChatId();
  const signalingSocket = State.getSignalingSocket();

  if (!username) {
    Swal.fire(
      "No Autenticado",
      "Debes iniciar sesión para unirte a un chat.",
      "error"
    );
    return;
  }
  if (currentChatId) {
    Swal.fire(
      "Acción no permitida",
      "Ya estás en un chat. Sal de él para unirte a otro.",
      "warning"
    );
    return;
  }
  if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
    Swal.fire(
      "Error de Conexión",
      "No conectado al servidor de señalización. Intenta de nuevo.",
      "error"
    );
    return;
  }

  setIsJoiningOrCreatingChat(true);
  State.setCurrentChatId(chatId);
  State.setCurrentChatName(chatName);

  // setStatusMessage ahora es un toast no bloqueante, lo cual es apropiado aquí.
  setStatusMessage(
    `Solicitando unirse al chat "${chatName || chatId.substring(0, 8)}"...`,
    "info"
  );

  signalingSocket.send(
    JSON.stringify({
      type: "register_user",
      chatId: chatId,
      // username y clientId son redundantes si el servidor usa la identidad de la conexión WebSocket
    })
  );

  showChatUI();
  displayMessage(
    "Sistema",
    `Intentando unirse al chat "${chatName || chatId.substring(0, 8)}"...`,
    false
  );
}
