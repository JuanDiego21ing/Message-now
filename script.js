let username = null;
let clientId = null; // El ID único que nos asigna el servidor de señalización

const usernameInput = document.getElementById("username");
const setUsernameButton = document.getElementById("set-username");
const createChatButton = document.getElementById("create-chat");
const availableChatsList = document.getElementById("available-chats");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const leaveChatButton = document.getElementById("leave-chat-button"); // Nuevo botón para salir del chat

const statusMessageDiv = document.getElementById("status-message");

let signalingSocket;
const SIGNALING_SERVER_URL = "ws://localhost:8081";
const RECONNECT_INTERVAL = 5000;

const activePeers = new Map();
let currentChatId = null;
let currentChatMembers = {};

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

// Función para mostrar la interfaz de chat
function showChatUI() {
  document.getElementById("user-setup").style.display = "none";
  createChatButton.style.display = "none";
  document.getElementById("chat-list").style.display = "none";

  document.getElementById("chat-area").style.display = "block";
  document.getElementById("message-input-area").style.display = "flex";
  if (leaveChatButton) leaveChatButton.style.display = "inline-block"; // Mostrar botón de salir

  clearStatusMessage();
}

// Función para mostrar la interfaz de "lobby" (crear/unirse a chat)
function showLobbyUI() {
  document.getElementById("user-setup").style.display = "none"; // Nombre ya ingresado
  createChatButton.style.display = "block"; // Mostrar botón de crear
  document.getElementById("chat-list").style.display = "block"; // Mostrar lista de chats

  document.getElementById("chat-area").style.display = "none";
  document.getElementById("message-input-area").style.display = "none";
  if (leaveChatButton) leaveChatButton.style.display = "none"; // Ocultar botón de salir

  messagesDiv.innerHTML = ""; // Limpiar mensajes del chat anterior
  messageInput.value = ""; // Limpiar input de mensaje

  // Re-solicitar la lista de chats si es necesario, o simplemente mostrar la que tenemos
  if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    signalingSocket.send(JSON.stringify({ type: "request_chat_list" })); // Pedir la lista de chats de nuevo
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
    showChatUI(); // Mostrar la UI de chat una vez conectado con al menos un peer
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

    console.log(`Peers activos restantes: ${activePeers.size}`);
    if (activePeers.size === 0 && currentChatId) {
      setStatusMessage(
        "Todos los demás participantes se han desconectado del chat.",
        "warning"
      );
      // Si no hay más peers, volvemos al lobby
      setTimeout(showLobbyUI, 3000);
      currentChatId = null; // Reseteamos el chat ID
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
      // Si el usuario ya está logeado, mostramos el lobby
      showLobbyUI();
    }
    // Se espera el mensaje 'your_id' y 'chat_list' del servidor
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
            setTimeout(showLobbyUI, 3000); // Volver al lobby
          }
          break;
        case "chat_members_update":
          if (data.chatId === currentChatId) {
            handleChatMembersUpdate(data.members);
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
  currentChatMembers = members;

  // Conectar con nuevos miembros
  for (const remoteClientId in members) {
    if (remoteClientId !== clientId && !activePeers.has(remoteClientId)) {
      const initiator = clientId < remoteClientId;
      createPeer(remoteClientId, members[remoteClientId], initiator);
    }
  }

  // Desconectar de miembros que ya no están en el chat
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
  if (leaveChatButton) leaveChatButton.style.display = "none"; // Ocultar botón de salir al inicio
}
document.addEventListener("DOMContentLoaded", hideInitialUI);

setUsernameButton.addEventListener("click", () => {
  username = usernameInput.value.trim();
  if (username && username.length >= 3 && username !== "Sistema") {
    document.getElementById("user-setup").style.display = "none";
    setStatusMessage(`Tu nombre: ${username}.`, "info");
    connectToSignalingServer();
  } else {
    setStatusMessage(
      "Por favor, ingresa un nombre válido (mínimo 3 caracteres, no 'Sistema').",
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

  currentChatId = Math.random().toString(36).substring(2, 15);

  setStatusMessage(
    `Creando chat (ID: ${currentChatId.substring(0, 8)}...).`,
    "info"
  );
  signalingSocket.send(
    JSON.stringify({
      type: "create_chat",
      chatId: currentChatId,
      username: username,
      clientId: clientId,
    })
  );

  // El creador se une directamente a la interfaz de chat
  showChatUI();
  displayMessage(
    "Sistema",
    `Has creado el chat. Comparte el ID (${currentChatId.substring(
      0,
      8
    )}...) para que otros se unan.`,
    false
  );
  displayMessage("Sistema", `Esperando a otros participantes...`, false);

  // No es necesario deshabilitar el botón de crear chat, showChatUI lo oculta
});

// Lógica para la Lista de Chats
function updateAvailableChats(chats) {
  availableChatsList.innerHTML = "";
  if (chats.length === 0) {
    availableChatsList.innerHTML = "<li>No hay chats disponibles aún.</li>";
    return;
  }
  chats.forEach((chat) => addChatToList(chat));
}

function addChatToList(chat) {
  if (document.getElementById(`chat-${chat.chatId}`)) {
    return;
  }

  const listItem = document.createElement("li");
  listItem.id = `chat-${chat.chatId}`;
  listItem.innerHTML = `Chat de <strong>${chat.creator}</strong> (${chat.memberCount} participantes) <button data-chatid="${chat.chatId}">Unirse</button>`;

  const joinButton = listItem.querySelector("button");
  joinButton.addEventListener("click", () =>
    requestJoinChat(chat.chatId, chat.creator)
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

function requestJoinChat(chatId, creator) {
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

  setStatusMessage(`Solicitando unirse al chat de ${creator}...`, "info");
  currentChatId = chatId;
  signalingSocket.send(
    JSON.stringify({
      type: "register_user",
      chatId: chatId,
      username: username,
      clientId: clientId,
    })
  );

  showChatUI(); // Mostrar la UI de chat inmediatamente al intentar unirse
  displayMessage(
    "Sistema",
    `Intentando unirse al chat de ${creator}...`,
    false
  );
}

sendButton.addEventListener("click", () => {
  const message = messageInput.value.trim();
  if (message) {
    if (activePeers.size === 0 && currentChatId) {
      // Permitir enviar si eres el único en el chat (como creador)
      displayMessage(username, message, true); // Muestra tu propio mensaje
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

// --- Nuevo Event Listener para el botón de salir del chat ---
leaveChatButton.addEventListener("click", () => {
  if (
    currentChatId &&
    signalingSocket &&
    signalingSocket.readyState === WebSocket.OPEN
  ) {
    // Enviar un mensaje al servidor para indicar que estamos abandonando el chat
    signalingSocket.send(
      JSON.stringify({
        type: "leave_chat",
        chatId: currentChatId,
        clientId: clientId,
      })
    );

    // Limpiar todas las conexiones P2P activas
    activePeers.forEach((peer) => peer.destroy());
    activePeers.clear();

    currentChatId = null; // Reiniciar el ID del chat
    currentChatMembers = {}; // Limpiar miembros

    showLobbyUI(); // Volver a la interfaz del lobby
    setStatusMessage(
      "Has salido del chat. Puedes crear uno nuevo o unirte a uno existente.",
      "success"
    );
  } else {
    setStatusMessage("No estás actualmente en un chat activo.", "warning");
  }
});
