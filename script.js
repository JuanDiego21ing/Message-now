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

// Referencias para el nuevo modal de nombre de sala
const roomNameModal = document.getElementById("room-name-modal");
const roomNameInput = document.getElementById("room-name-input");
const confirmRoomNameButton = document.getElementById(
  "confirm-room-name-button"
);
const cancelRoomNameButton = document.getElementById("cancel-room-name-button");

let signalingSocket;
const SIGNALING_SERVER_URL = "ws://localhost:8081";
const RECONNECT_INTERVAL = 5000;

const activePeers = new Map();
let currentChatId = null;
let currentChatName = null; // Nuevo: Para almacenar el nombre de la sala
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
    setStatusMessage(`Conectado al chat.`, "success");
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

    console.log(`Peers activos restantes: ${activePeers.size}`);
    if (activePeers.size === 0 && currentChatId) {
      setStatusMessage(
        "Todos los demás participantes se han desconectado del chat.",
        "warning"
      );
      setTimeout(showLobbyUI, 3000);
      currentChatId = null;
      currentChatName = null; // Limpiar nombre del chat
    }
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
          if (currentChatId === data.chatId) {
            setStatusMessage(
              "El chat al que estabas conectado se cerró en el servidor.",
              "warning"
            );
            activePeers.forEach((peer) => peer.destroy());
            activePeers.clear();
            currentChatId = null;
            currentChatName = null;
            setTimeout(showLobbyUI, 3000);
          }
          break;
        case "chat_members_update":
          // Esta actualización ahora también incluye el nombre de la sala
          if (data.chatId === currentChatId) {
            currentChatMembers = data.members; // Asegúrate de actualizar la lista completa
            currentChatName = data.chatName; // Nuevo: obtener el nombre de la sala
            handleChatMembersUpdate(data.members);
            updateMembersList(); // Asegurarse de que la lista se actualice con los nombres de la sala
          }
          break;
        case "signal":
          const senderClientId = data.senderId;
          const signalData = data.signal;

          let peerToSignal = activePeers.get(senderClientId);

          if (peerToSignal) {
            peerToSignal.signal(signalData);
          } else if (signalData.type === "offer") {
            const remoteUsername =
              currentChatMembers[senderClientId] ||
              `Usuario ${senderClientId.substring(0, 8)}`;
            peerToSignal = createPeer(senderClientId, remoteUsername, false);
            peerToSignal.signal(signalData);
          } else {
            console.warn(
              `Señal recibida de ${senderClientId} sin peer existente o no es oferta inicial. Ignorada.`
            );
          }
          break;
        case "error":
          setStatusMessage(`Error del servidor: ${data.message}`, "error");
          console.error("Error del servidor:", data.message);
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
    activePeers.forEach((peer) => peer.destroy());
    activePeers.clear();
    currentChatId = null;
    currentChatName = null;
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
  // currentChatMembers ya se actualiza en onmessage, aquí solo manejamos la creación/destrucción de peers
  const peersToDestroy = [];
  activePeers.forEach((peerInstance, remoteClientId) => {
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
  // La actualización de la lista visual ahora se hace en onmessage (chat_members_update) y en peer.on('connect/close/error')
}

// --- Event Listeners Iniciales / Ocultar UI ---
function hideInitialUI() {
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
}
document.addEventListener("DOMContentLoaded", hideInitialUI);

setUsernameButton.addEventListener("click", () => {
  username = usernameInput.value.trim();
  if (
    username &&
    username.length >= 3 &&
    username.length <= 20 &&
    username !== "Sistema"
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

// Cuando se hace clic en "Crear Nuevo Chat", mostrar el modal
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

  // Mostrar el modal
  roomNameInput.value = ""; // Limpiar el input
  roomNameModal.style.display = "flex"; // Usar 'flex' para centrar
  roomNameInput.focus(); // Poner el foco en el input
});

// Event listener para el botón "Crear Sala" del modal
confirmRoomNameButton.addEventListener("click", () => {
  const roomName = roomNameInput.value.trim();
  if (roomName && roomName.length >= 3 && roomName.length <= 30) {
    currentChatId = Math.random().toString(36).substring(2, 15);
    currentChatName = roomName; // Guardar el nombre de la sala

    setStatusMessage(`Creando chat (Nombre: "${roomName}")...`, "info");
    signalingSocket.send(
      JSON.stringify({
        type: "create_chat",
        chatId: currentChatId,
        chatName: currentChatName, // Enviar el nombre de la sala al servidor
        username: username,
        clientId: clientId,
      })
    );

    roomNameModal.style.display = "none"; // Ocultar el modal
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

// Event listener para el botón "Cancelar" del modal
cancelRoomNameButton.addEventListener("click", () => {
  roomNameModal.style.display = "none"; // Ocultar el modal
  setStatusMessage("Creación de chat cancelada.", "info");
});

// Lógica para la Lista de Chats
function updateAvailableChats(chats) {
  availableChatsList.innerHTML = "";
  if (chats.length === 0) {
    availableChatsList.innerHTML = "<li>No hay chats disponibles aún.</li>";
    return;
  }
  // Ordenar los chats por nombre o por creador para mejor visualización
  chats.sort((a, b) =>
    (a.chatName || a.chatId).localeCompare(b.chatName || b.chatId)
  );

  chats.forEach((chat) => addChatToList(chat));
}

function addChatToList(chat) {
  if (document.getElementById(`chat-${chat.chatId}`)) {
    // Actualizar el conteo de miembros si ya existe
    const listItem = document.getElementById(`chat-${chat.chatId}`);
    const memberCountSpan = listItem.querySelector(".member-count");
    if (memberCountSpan) {
      memberCountSpan.textContent = chat.memberCount;
    }
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
  // Añadimos chatName
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
  currentChatName = chatName; // Guardar el nombre de la sala
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
    if (activePeers.size === 0 && currentChatId) {
      displayMessage(username, message, true);
      messageInput.value = "";
      setStatusMessage(
        "Eres el único en este chat por ahora. Esperando a otros...",
        "info"
      );
      return;
    }

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
      setStatusMessage(
        "No se pudo enviar el mensaje. Ningún peer conectado actualmente.",
        "error"
      );
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

leaveChatButton.addEventListener("click", () => {
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
      })
    );

    activePeers.forEach((peer) => peer.destroy());
    activePeers.clear();

    currentChatId = null;
    currentChatName = null;
    currentChatMembers = {}; // Limpiar también la lista de miembros locales

    showLobbyUI();
    setStatusMessage(
      "Has salido del chat. Puedes crear uno nuevo o unirte a uno existente.",
      "success"
    );
  } else {
    setStatusMessage("No estás actualmente en un chat activo.", "warning");
  }
});
