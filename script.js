let username = null;
let clientId = null; // El ID único que nos asigna el servidor de señalización

const usernameInput = document.getElementById("username");
const setUsernameButton = document.getElementById("set-username");
const createChatButton = document.getElementById("create-chat");
const availableChatsList = document.getElementById("available-chats");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

// Nuevas referencias para elementos de la UI de estado
const statusMessageDiv = document.getElementById("status-message"); // Añadiremos este div en el HTML

// WebSocket para el servidor de señalización
let signalingSocket;
const SIGNALING_SERVER_URL = "ws://localhost:8081"; // Asegúrate de que coincida con el puerto de tu server.js
const RECONNECT_INTERVAL = 5000; // Intentar reconectar cada 5 segundos

// Almacenará todas las conexiones P2P activas, mapeadas por el clientId del peer remoto.
// { remoteClientId: SimplePeer_instance, ... }
const activePeers = new Map();
let currentChatId = null; // El ID del chat al que estamos conectados
let currentChatMembers = {}; // Guardará la lista de miembros del chat actual { clientId: username, ... }

// --- Funciones de Utilidad y UI ---
function displayMessage(sender, text, isMe) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message");
  // Sanitizar el texto para evitar inyecciones HTML básicas
  const sanitizedText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  messageDiv.innerHTML = `<strong>${
    isMe ? "Yo" : sender
  }:</strong> ${sanitizedText}`;
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight; // Hacer scroll al último mensaje
}

// Función para mostrar mensajes de estado al usuario
function setStatusMessage(message, type = "info") {
  if (statusMessageDiv) {
    statusMessageDiv.textContent = message;
    statusMessageDiv.className = `status-message ${type}`; // Para aplicar estilos CSS (info, error, success)
    statusMessageDiv.style.display = "block"; // Asegurarse de que sea visible
  }
}

function clearStatusMessage() {
  if (statusMessageDiv) {
    statusMessageDiv.textContent = "";
    statusMessageDiv.className = "status-message";
    statusMessageDiv.style.display = "none";
  }
}

// Función para inicializar un nuevo SimplePeer
function createPeer(remoteClientId, remoteUsername, initiator) {
  console.log(
    `Creando peer con ${remoteUsername} (ID: ${remoteClientId}). Iniciador: ${initiator}`
  );
  setStatusMessage(`Conectando con ${remoteUsername}...`, "info");

  const peer = new SimplePeer({ initiator: initiator, trickle: false });

  peer.remoteUsername = remoteUsername;
  peer.remoteClientId = remoteClientId;

  peer.on("signal", (data) => {
    // Enviar la señal al servidor de señalización, dirigida al peer remoto
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

    // Una vez conectado con al menos un peer, mostrar la UI de chat
    document.getElementById("user-setup").style.display = "none";
    createChatButton.style.display = "none";
    document.getElementById("chat-list").style.display = "none";
    document.getElementById("chat-area").style.display = "block";
    document.getElementById("message-input-area").style.display = "flex";
    clearStatusMessage(); // Limpiar el mensaje de "conectando"
  });

  peer.on("data", (data) => {
    try {
      const message = JSON.parse(data.toString());
      // Validar la estructura del mensaje para evitar errores si no es un JSON esperado
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
      // Si no quedan peers activos y estábamos en un chat
      setStatusMessage(
        "Todos los demás participantes se han desconectado del chat.",
        "warning"
      );
      // Podríamos ofrecer un botón para crear otro chat o volver a la lista
      setTimeout(() => location.reload(), 3000); // Recargar después de 3 segundos para volver a la lista
    }
  });

  peer.on("error", (err) => {
    console.error(
      `Error del Peer WebRTC con ${peer.remoteUsername} (ID: ${peer.remoteClientId}):`,
      err
    );
    // Podríamos dar más detalle dependiendo del tipo de error
    setStatusMessage(
      `Error con la conexión a ${peer.remoteUsername}: ${err.message}.`,
      "error"
    );
    // Asegurarse de que el peer se destruya para limpiar recursos
    peer.destroy();
    activePeers.delete(peer.remoteClientId); // Eliminar el peer de la colección
  });

  activePeers.set(remoteClientId, peer);
  return peer;
}

// --- Configuración del WebSocket de Señalización ---
function connectToSignalingServer() {
  // Si ya existe un socket, no crear uno nuevo
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
    setStatusMessage(
      "Conectado al servidor de señalización. Cargando chats...",
      "success"
    );
    if (username) {
      document.getElementById("chat-list").style.display = "block";
      createChatButton.style.display = "block";
    }
    clearStatusMessage(); // Limpiar después de un breve momento
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
            activePeers.forEach((peer) => peer.destroy()); // Cerrar todas las conexiones P2P
            activePeers.clear();
            currentChatId = null;
            setTimeout(() => location.reload(), 3000);
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
            // Si recibimos una oferta y no tenemos un peer, lo creamos
            // Asegúrate de que currentChatMembers tenga el username
            const remoteUsername =
              currentChatMembers[senderClientId] ||
              `Usuario ${senderClientId.substring(0, 8)}`;
            peerToSignal = createPeer(senderClientId, remoteUsername, false);
            peerToSignal.signal(signalData);
          } else {
            console.warn(
              `Señal recibida de ${senderClientId} sin peer existente o no es oferta inicial. Ignorada.`
            );
            // Podríamos pedir al servidor que reenvíe la lista de miembros para resincronizar
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
    // Destruir peers existentes si la conexión con el servidor se pierde
    activePeers.forEach((peer) => peer.destroy());
    activePeers.clear();
    currentChatId = null; // Resetear el chat actual si la conexión al servidor se pierde
    setTimeout(connectToSignalingServer, RECONNECT_INTERVAL);
  };

  signalingSocket.onerror = (error) => {
    console.error("Error del WebSocket de señalización:", error);
    setStatusMessage(
      "Fallo en la conexión al servidor de señalización. Asegúrate de que esté ejecutándose.",
      "error"
    );
    // No reintentar inmediatamente aquí; onclose se encargará del reintento
  };
}

// Maneja la actualización de miembros del chat para establecer/cerrar conexiones P2P
function handleChatMembersUpdate(members) {
  currentChatMembers = members;

  // Conectar con nuevos miembros
  for (const remoteClientId in members) {
    if (remoteClientId !== clientId && !activePeers.has(remoteClientId)) {
      // El iniciador es el que tiene el ClientID lexicográficamente menor
      const initiator = clientId < remoteClientId;
      createPeer(remoteClientId, members[remoteClientId], initiator);
    }
  }

  // Desconectar de miembros que ya no están en el chat
  // Crear una lista de peers a eliminar para evitar problemas al modificar el Map mientras se itera
  const peersToDestroy = [];
  activePeers.forEach((peerInstance, remoteClientId) => {
    if (!members[remoteClientId]) {
      console.log(
        `Miembro ${peerInstance.remoteUsername} (ID: ${remoteClientId}) ya no está en el chat. Cerrando conexión P2P.`
      );
      peersToDestroy.push(peerInstance);
    }
  });

  peersToDestroy.forEach((peer) => peer.destroy()); // Destruir fuera del bucle forEach del Map
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
  if (statusMessageDiv) statusMessageDiv.style.display = "none"; // Ocultar el div de estado al inicio
}
document.addEventListener("DOMContentLoaded", hideInitialUI);

setUsernameButton.addEventListener("click", () => {
  username = usernameInput.value.trim();
  if (username && username.length > 2 && username !== "Sistema") {
    document.getElementById("user-setup").style.display = "none";
    setStatusMessage(`Tu nombre: ${username}.`, "info");
    connectToSignalingServer();
  } else {
    setStatusMessage(
      "Por favor, ingresa un nombre válido (mínimo 3 caracteres, no 'Sistema').",
      "error"
    );
    usernameInput.value = ""; // Limpiar el input
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

  createChatButton.disabled = true;
  document.getElementById("chat-list").style.display = "none";
  displayMessage(
    "Sistema",
    `Has creado el chat. Esperando a otros participantes...`,
    false
  );
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
  document.getElementById("chat-list").style.display = "none";
  displayMessage(
    "Sistema",
    `Intentando unirse al chat de ${creator}...`,
    false
  );
}

sendButton.addEventListener("click", () => {
  const message = messageInput.value.trim();
  if (message) {
    // Permitir enviar si hay mensaje, la validación de conexión se hará después
    if (activePeers.size === 0) {
      setStatusMessage(
        "No hay otros participantes conectados en este chat para enviar mensajes.",
        "warning"
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

// Listener para el campo de entrada de mensaje (Enter)
messageInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    sendButton.click();
  }
});
