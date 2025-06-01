let username = null;
let clientId = null; // El ID único que nos asigna el servidor de señalización

const usernameInput = document.getElementById("username");
const setUsernameButton = document.getElementById("set-username");
const createChatButton = document.getElementById("create-chat");
const availableChatsList = document.getElementById("available-chats");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const leaveChatButton = document.getElementById("leave-chat-button");

const statusMessageDiv = document.getElementById("status-message");
const membersList = document.getElementById("members-list"); // Referencia a la lista de miembros

// Referencias para el modal de nombre de sala
const roomNameModal = document.getElementById("room-name-modal");
const roomNameInput = document.getElementById("room-name-input");
const confirmRoomNameButton = document.getElementById(
  "confirm-room-name-button"
);
const cancelRoomNameButton = document.getElementById("cancel-room-name-button");

// Nuevas referencias para el modal de advertencia de salida
const confirmLeaveModal = document.getElementById("confirm-leave-modal");
const confirmLeaveMessage = document.getElementById("confirm-leave-message");
const confirmLeaveButton = document.getElementById("confirm-leave-button");
const cancelLeaveButton = document.getElementById("cancel-leave-button");

let signalingSocket;
const SIGNALING_SERVER_URL = "ws://localhost:8081";
const RECONNECT_INTERVAL = 5000;

const activePeers = new Map();
let currentChatId = null;
let currentChatName = null;
let currentChatMembers = {}; // { clientId: username, ... }

// --- Funciones de Utilidad y UI ---
function displayMessage(sender, text, isMe) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message");
  const sanitizedText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  messageDiv.innerHTML = `<strong>${
    isMe ? "Yo" : sender
  }:</strong> ${sanitizedText}`;
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function setStatusMessage(message, type = "info") {
  if (statusMessageDiv) {
    statusMessageDiv.textContent = message;
    statusMessageDiv.className = `status-message ${type}`;
    statusMessageDiv.style.display = "block";
  }
}

function clearStatusMessage() {
  if (statusMessageDiv) {
    statusMessageDiv.textContent = "";
    statusMessageDiv.className = "status-message";
    statusMessageDiv.style.display = "none";
  }
}

// Función para actualizar la lista de miembros visualmente
function updateMembersList() {
  membersList.innerHTML = ""; // Limpiar la lista actual

  // Añadirme a mí mismo primero
  const myListItem = document.createElement("li");
  myListItem.textContent = `${username} (Tú)`;
  myListItem.classList.add("me");
  membersList.appendChild(myListItem);

  for (const remoteClientId in currentChatMembers) {
    if (remoteClientId === clientId) continue; // Ya me añadí

    const memberUsername = currentChatMembers[remoteClientId];
    const listItem = document.createElement("li");
    listItem.textContent = memberUsername;

    // Verificar si estamos conectados P2P con este miembro
    if (
      activePeers.has(remoteClientId) &&
      activePeers.get(remoteClientId).connected
    ) {
      listItem.classList.add("connected");
      listItem.textContent += " (Conectado)";
    } else {
      listItem.textContent += " (Uniéndose...)"; // O "desconectado"
    }
    membersList.appendChild(listItem);
  }
  // También, para el bug de la salida, verificar si somos el único.
  // Esto es para la UI, no para la lógica de la sala (que la maneja el servidor)
  if (
    Object.keys(currentChatMembers).length === 1 &&
    currentChatMembers[clientId]
  ) {
    setStatusMessage(
      "Eres el único en este chat por ahora. Esperando a otros...",
      "info"
    );
  } else {
    clearStatusMessage(); // Si hay más de uno, limpiar el mensaje de "único"
  }
}

// Función para mostrar la interfaz de chat
function showChatUI() {
  document.getElementById("user-setup").style.display = "none";
  createChatButton.style.display = "none";
  document.getElementById("chat-list").style.display = "none";

  document.getElementById("chat-area").style.display = "block";
  document.getElementById("message-input-area").style.display = "flex";
  if (leaveChatButton) leaveChatButton.style.display = "inline-block";

  // Actualizar el título del chat
  document.querySelector("#chat-area h2").textContent = `Chat: ${
    currentChatName || currentChatId.substring(0, 8)
  }`;

  clearStatusMessage();
  updateMembersList(); // Actualizar la lista de miembros al mostrar la UI de chat
}

// Función para mostrar la interfaz de "lobby" (crear/unirse a chat)
function showLobbyUI() {
  document.getElementById("user-setup").style.display = "none";
  createChatButton.style.display = "block";
  document.getElementById("chat-list").style.display = "block";

  document.getElementById("chat-area").style.display = "none";
  document.getElementById("message-input-area").style.display = "none";
  if (leaveChatButton) leaveChatButton.style.display = "none";

  messagesDiv.innerHTML = "";
  messageInput.value = "";
  membersList.innerHTML = ""; // Limpiar lista de miembros
  activePeers.clear(); // Limpiar peers activos cuando volvemos al lobby
  currentChatMembers = {}; // Limpiar miembros del chat

  if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    signalingSocket.send(JSON.stringify({ type: "request_chat_list" }));
  }
  clearStatusMessage();
  setStatusMessage(
    "Bienvenido de nuevo al lobby. Crea o únete a un chat.",
    "info"
  );
}

function createPeer(remoteClientId, remoteUsername, initiator) {
  console.log(
    `Creando peer con ${remoteUsername} (ID: ${remoteClientId}). Iniciador: ${initiator}`
  );
  setStatusMessage(`Conectando con ${remoteUsername}...`, "info");

  // Aquí podrías añadir STUN/TURN servers si la aplicación va a usarse en redes complejas
  // const configuration = {
  //     iceServers: [
  //         { urls: 'stun:stun.l.google.com:19302' },
  //         // { urls: 'turn:YOUR_TURN_SERVER_URL:PORT', username: 'user', credential: 'password' }
  //     ]
  // };
  // const peer = new SimplePeer({ initiator: initiator, trickle: false, config: configuration });
  const peer = new SimplePeer({ initiator: initiator, trickle: false });

  peer.remoteUsername = remoteUsername;
  peer.remoteClientId = remoteClientId;

  peer.on("signal", (data) => {
    console.log(
      `Enviando señal a ${remoteUsername} (ID: ${remoteClientId}). Tipo: ${data.type}`
    );
    signalingSocket.send(
      JSON.stringify({
        type: "signal",
        receiverId: remoteClientId,
        signal: data,
        chatId: currentChatId,
      })
    );
  });

  peer.on("connect", () => {
    console.log(
      `¡CONECTADO con ${peer.remoteUsername} (ID: ${peer.remoteClientId})!`
    );
    displayMessage("Sistema", `${peer.remoteUsername} se ha conectado.`, false);
    // setStatusMessage(`Conectado al chat.`, 'success'); // Se puede comentar para evitar sobrescribir el "eres el único"
    showChatUI(); // Asegurarse de que la UI de chat se muestre
    updateMembersList(); // ¡Importante! Actualizar la lista al establecer conexión P2P
  });

  peer.on("data", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (
        message &&
        typeof message.sender === "string" &&
        typeof message.text === "string"
      ) {
        displayMessage(message.sender, message.text, false);
      } else {
        console.warn("Mensaje recibido en formato inesperado:", message);
      }
    } catch (e) {
      console.error("Error al parsear el mensaje P2P recibido:", e);
      displayMessage(
        "Sistema",
        `Error al recibir mensaje de ${peer.remoteUsername}.`,
        true
      );
    }
  });

  peer.on("close", () => {
    console.log(
      `Conexión con ${peer.remoteUsername} (ID: ${peer.remoteClientId}) cerrada.`
    );
    displayMessage(
      "Sistema",
      `${peer.remoteUsername} se ha desconectado.`,
      false
    );
    activePeers.delete(peer.remoteClientId);
    updateMembersList(); // ¡Importante! Actualizar la lista al cerrar conexión P2P

    // Ya no cerramos el chat si size === 0, el servidor lo mantiene si hay un usuario.
    // La lógica de "eres el único" ahora la maneja updateMembersList()
    console.log(`Peers activos restantes: ${activePeers.size}`);
    // if (activePeers.size === 0 && currentChatId) {
    //      setStatusMessage("Todos los demás participantes se han desconectado del chat.", 'warning');
    //      setTimeout(showLobbyUI, 3000); // Esto ya no es necesario si queremos mantener al usuario en la sala
    //      currentChatId = null;
    //      currentChatName = null;
    // }
  });

  peer.on("error", (err) => {
    console.error(
      `Error del Peer WebRTC con ${peer.remoteUsername} (ID: ${peer.remoteClientId}):`,
      err
    );
    setStatusMessage(
      `Error con la conexión a ${peer.remoteUsername}: ${err.message}.`,
      "error"
    );
    peer.destroy();
    activePeers.delete(remoteClientId);
    updateMembersList(); // Actualizar la lista si hay un error en la conexión P2P
  });

  activePeers.set(remoteClientId, peer);
  return peer;
}

// --- Configuración del WebSocket de Señalización ---
function connectToSignalingServer() {
  if (
    signalingSocket &&
    (signalingSocket.readyState === WebSocket.OPEN ||
      signalingSocket.readyState === WebSocket.CONNECTING)
  ) {
    console.log("Ya conectado o conectando al servidor de señalización.");
    return;
  }

  setStatusMessage("Conectando al servidor de señalización...", "info");
  signalingSocket = new WebSocket(SIGNALING_SERVER_URL);

  signalingSocket.onopen = () => {
    console.log("Conectado al servidor de señalización");
    setStatusMessage("Conectado al servidor de señalización.", "success");
    if (username) {
      showLobbyUI();
    }
  };

  signalingSocket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("Mensaje del servidor de señalización:", data.type);

      switch (data.type) {
        case "your_id":
          clientId = data.clientId;
          console.log(`Mi Client ID asignado por el servidor: ${clientId}`);
          break;
        case "chat_list":
          updateAvailableChats(data.chats);
          break;
        case "new_chat_available":
          addChatToList(data.chat);
          break;
        case "chat_removed":
          removeChatFromList(data.chatId);
          // Si el chat en el que estoy se elimina (porque el último usuario salió explícitamente)
          if (currentChatId === data.chatId) {
            setStatusMessage(
              "El chat al que estabas conectado ha sido eliminado.",
              "warning"
            );
            activePeers.forEach((peer) => peer.destroy());
            activePeers.clear();
            currentChatId = null;
            currentChatName = null;
            currentChatMembers = {};
            setTimeout(showLobbyUI, 3000);
          }
          break;
        case "chat_members_update":
          if (data.chatId === currentChatId) {
            currentChatMembers = data.members;
            currentChatName = data.chatName;
            handleChatMembersUpdate(data.members);
            updateMembersList();
          }
          break;
        case "signal":
          const senderClientId = data.senderId;
          const signalData = data.signal;

          let peerToSignal = activePeers.get(senderClientId);

          if (peerToSignal) {
            peerToSignal.signal(signalData);
          } else if (signalData.type === "offer") {
            // Asegúrate de que el senderId esté en currentChatMembers antes de crear un peer
            if (currentChatMembers[senderClientId]) {
              const remoteUsername = currentChatMembers[senderClientId];
              peerToSignal = createPeer(senderClientId, remoteUsername, false);
              peerToSignal.signal(signalData);
            } else {
              console.warn(
                `Oferta recibida de un cliente no esperado en el chat: ${senderClientId}. Ignorada.`
              );
            }
          } else {
            console.warn(
              `Señal recibida de ${senderClientId} sin peer existente o no es oferta inicial. Ignorada.`
            );
          }
          break;
        case "error":
          setStatusMessage(`Error del servidor: ${data.message}`, "error");
          console.error("Error del servidor:", data.message);
          // Si el error es por intentar unirse a un chat no existente o ya estar en uno
          if (
            data.message.includes("Chat con ID") ||
            data.message.includes("Ya estás en otro chat")
          ) {
            // Resetear estado del chat y volver al lobby si es un error de unión/creación
            currentChatId = null;
            currentChatName = null;
            activePeers.forEach((peer) => peer.destroy());
            activePeers.clear();
            currentChatMembers = {};
            setTimeout(showLobbyUI, 3000);
          }
          break;
      }
    } catch (e) {
      setStatusMessage("Error procesando mensaje del servidor.", "error");
      console.error(
        "Error al parsear mensaje del servidor de señalización:",
        e.message
      );
    }
  };

  signalingSocket.onclose = (event) => {
    console.log(
      "Desconectado del servidor de señalización",
      event.code,
      event.reason
    );
    setStatusMessage(
      "Desconectado del servidor de señalización. Reintentando...",
      "error"
    );
    // No limpiamos el currentChatId/Name aquí, porque el servidor es quien decidirá si la sala se cerró.
    // Si el servidor se cae, el usuario podría estar en un chat que sigue existiendo al reconectar.
    activePeers.forEach((peer) => peer.destroy());
    activePeers.clear();
    currentChatMembers = {}; // Limpiar miembros locales
    setTimeout(connectToSignalingServer, RECONNECT_INTERVAL);
  };

  signalingSocket.onerror = (error) => {
    console.error("Error del WebSocket de señalización:", error);
    setStatusMessage(
      "Fallo en la conexión al servidor de señalización. Asegúrate de que esté ejecutándose.",
      "error"
    );
  };
}

function handleChatMembersUpdate(members) {
  const peersToDestroy = [];
  activePeers.forEach((peerInstance, remoteClientId) => {
    // Si un peer activo ya no está en la lista de miembros recibida, destruirlo
    if (!members[remoteClientId]) {
      console.log(
        `Miembro ${peerInstance.remoteUsername} (ID: ${remoteClientId}) ya no está en el chat. Cerrando conexión P2P.`
      );
      peersToDestroy.push(peerInstance);
    }
  });

  peersToDestroy.forEach((peer) => peer.destroy());

  // Crear/iniciar conexiones P2P con nuevos miembros
  for (const remoteClientId in members) {
    if (remoteClientId !== clientId && !activePeers.has(remoteClientId)) {
      const initiator = clientId < remoteClientId;
      createPeer(remoteClientId, members[remoteClientId], initiator);
    }
  }
}

// --- Event Listeners Iniciales / Ocultar UI ---
function hideInitialUI() {
  document.getElementById("user-setup").style.display = "flex"; // Asegurarse que el setup inicial se vea
  if (document.getElementById("chat-area"))
    document.getElementById("chat-area").style.display = "none";
  if (document.getElementById("message-input-area"))
    document.getElementById("message-input-area").style.display = "none";
  if (document.getElementById("chat-list"))
    document.getElementById("chat-list").style.display = "none";
  if (createChatButton) createChatButton.style.display = "none";
  if (statusMessageDiv) statusMessageDiv.style.display = "none";
  if (leaveChatButton) leaveChatButton.style.display = "none";
  if (roomNameModal) roomNameModal.style.display = "none"; // Ocultar el modal al inicio
  if (confirmLeaveModal) confirmLeaveModal.style.display = "none"; // Ocultar el modal de salida
}
document.addEventListener("DOMContentLoaded", hideInitialUI);

setUsernameButton.addEventListener("click", () => {
  username = usernameInput.value.trim();
  if (
    username &&
    username.length >= 3 &&
    username.length <= 20 &&
    username.toLowerCase() !== "sistema"
  ) {
    // Max 20 chars
    document.getElementById("user-setup").style.display = "none";
    setStatusMessage(`Tu nombre: ${username}.`, "info");
    connectToSignalingServer();
  } else {
    setStatusMessage(
      "Por favor, ingresa un nombre válido (3-20 caracteres, no 'Sistema').",
      "error"
    );
    usernameInput.value = "";
  }
});

createChatButton.addEventListener("click", () => {
  if (!username) {
    setStatusMessage("Por favor, ingresa tu nombre primero.", "error");
    return;
  }
  if (currentChatId) {
    setStatusMessage(
      "Ya estás en un chat. Sal de él para crear uno nuevo.",
      "warning"
    );
    return;
  }

  roomNameInput.value = "";
  roomNameModal.style.display = "flex";
  roomNameInput.focus();
});

confirmRoomNameButton.addEventListener("click", () => {
  const roomName = roomNameInput.value.trim();
  if (roomName && roomName.length >= 3 && roomName.length <= 30) {
    currentChatId = Math.random().toString(36).substring(2, 15);
    currentChatName = roomName;

    setStatusMessage(`Creando chat (Nombre: "${roomName}")...`, "info");
    signalingSocket.send(
      JSON.stringify({
        type: "create_chat",
        chatId: currentChatId,
        chatName: currentChatName,
        username: username,
        clientId: clientId,
      })
    );

    roomNameModal.style.display = "none";
    showChatUI();
    displayMessage(
      "Sistema",
      `Has creado el chat "${currentChatName}". Comparte este nombre para que otros se unan.`,
      false
    );
    displayMessage("Sistema", `Esperando a otros participantes...`, false);
  } else {
    setStatusMessage(
      "Por favor, ingresa un nombre de sala válido (3-30 caracteres).",
      "warning"
    );
  }
});

cancelRoomNameButton.addEventListener("click", () => {
  roomNameModal.style.display = "none";
  setStatusMessage("Creación de chat cancelada.", "info");
});

// Lógica para la Lista de Chats
function updateAvailableChats(chats) {
  availableChatsList.innerHTML = "";
  if (chats.length === 0) {
    availableChatsList.innerHTML = "<li>No hay chats disponibles aún.</li>";
    return;
  }
  chats.sort((a, b) =>
    (a.chatName || a.chatId).localeCompare(b.chatName || b.chatId)
  );

  chats.forEach((chat) => addChatToList(chat));
}

function addChatToList(chat) {
  const existingListItem = document.getElementById(`chat-${chat.chatId}`);
  if (existingListItem) {
    const memberCountSpan = existingListItem.querySelector(".member-count");
    if (memberCountSpan) {
      memberCountSpan.textContent = chat.memberCount;
    }
    // No añadir duplicados, solo actualizar si ya existe.
    return;
  }

  const listItem = document.createElement("li");
  listItem.id = `chat-${chat.chatId}`;
  listItem.innerHTML = `
        Sala: <strong>${
          chat.chatName || `ID: ${chat.chatId.substring(0, 8)}...`
        }</strong>
        <br>Creador: ${chat.creator} (<span class="member-count">${
    chat.memberCount
  }</span> participantes) 
        <button data-chatid="${chat.chatId}">Unirse</button>
    `;

  const joinButton = listItem.querySelector("button");
  joinButton.addEventListener("click", () =>
    requestJoinChat(chat.chatId, chat.chatName, chat.creator)
  );
  availableChatsList.appendChild(listItem);
}

function removeChatFromList(chatId) {
  const listItem = document.getElementById(`chat-${chatId}`);
  if (listItem) {
    listItem.remove();
    if (availableChatsList.children.length === 0) {
      availableChatsList.innerHTML = "<li>No hay chats disponibles aún.</li>";
    }
  }
}

function requestJoinChat(chatId, chatName, creator) {
  if (!username) {
    setStatusMessage("Por favor, ingresa tu nombre primero.", "error");
    return;
  }
  if (currentChatId) {
    setStatusMessage(
      "Ya estás en un chat. Sal de él para unirte a otro.",
      "warning"
    );
    return;
  }

  setStatusMessage(
    `Solicitando unirse al chat "${chatName || chatId.substring(0, 8)}"...`,
    "info"
  );
  currentChatId = chatId;
  currentChatName = chatName;
  signalingSocket.send(
    JSON.stringify({
      type: "register_user",
      chatId: chatId,
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

sendButton.addEventListener("click", () => {
  const message = messageInput.value.trim();
  if (message) {
    const sender = username || "Anónimo";
    const messageToSend = JSON.stringify({ sender: sender, text: message });

    let sentToAtLeastOne = false;
    activePeers.forEach((peerInstance) => {
      if (peerInstance.connected) {
        peerInstance.send(messageToSend);
        sentToAtLeastOne = true;
      }
    });

    if (sentToAtLeastOne) {
      displayMessage(sender, message, true);
      messageInput.value = "";
    } else {
      // Si eres el único y envías un mensaje, se muestra localmente.
      if (
        Object.keys(currentChatMembers).length === 1 &&
        currentChatMembers[clientId]
      ) {
        displayMessage(sender, message, true);
        messageInput.value = "";
        setStatusMessage(
          "Eres el único en este chat por ahora. Esperando a otros...",
          "info"
        );
      } else {
        setStatusMessage(
          "No se pudo enviar el mensaje. Ningún peer conectado actualmente.",
          "error"
        );
      }
    }
  } else {
    setStatusMessage("No puedes enviar un mensaje vacío.", "warning");
  }
});

messageInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    sendButton.click();
  }
});

// Lógica para el botón "Salir del Chat"
leaveChatButton.addEventListener("click", () => {
  if (
    !currentChatId ||
    !signalingSocket ||
    signalingSocket.readyState !== WebSocket.OPEN
  ) {
    setStatusMessage("No estás actualmente en un chat activo.", "warning");
    return;
  }

  const memberCount = Object.keys(currentChatMembers).length;
  // Si eres el último usuario en el chat
  if (memberCount === 1 && currentChatMembers[clientId]) {
    confirmLeaveMessage.textContent =
      "¡Atención! Eres el único usuario en esta sala. Si sales, la sala se borrará para siempre. ¿Deseas salir?";
    confirmLeaveModal.style.display = "flex";
  } else {
    // No eres el último, simplemente sales
    performLeaveChat(false); // No se solicita la eliminación del chat
  }
});

// Event listener para el botón "Confirmar Salir" del modal de advertencia
confirmLeaveButton.addEventListener("click", () => {
  performLeaveChat(true); // Se solicita la eliminación del chat
  confirmLeaveModal.style.display = "none";
});

// Event listener para el botón "Cancelar" del modal de advertencia
cancelLeaveButton.addEventListener("click", () => {
  confirmLeaveModal.style.display = "none";
  setStatusMessage("Has decidido permanecer en la sala.", "info");
});

// Nueva función para encapsular la lógica de salir del chat
function performLeaveChat(deleteChat) {
  if (
    currentChatId &&
    signalingSocket &&
    signalingSocket.readyState === WebSocket.OPEN
  ) {
    signalingSocket.send(
      JSON.stringify({
        type: "leave_chat",
        chatId: currentChatId,
        clientId: clientId,
        deleteChat: deleteChat, // Nuevo: indicar al servidor si se debe eliminar el chat
      })
    );

    activePeers.forEach((peer) => peer.destroy());
    activePeers.clear();

    currentChatId = null;
    currentChatName = null;
    currentChatMembers = {};

    showLobbyUI();
    if (deleteChat) {
      setStatusMessage(
        "Has salido del chat y la sala ha sido eliminada.",
        "success"
      );
    } else {
      setStatusMessage(
        "Has salido del chat. Puedes crear uno nuevo o unirte a uno existente.",
        "success"
      );
    }
  } else {
    setStatusMessage("Error al intentar salir del chat.", "error");
  }
}
