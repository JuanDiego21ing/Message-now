let username = null;
let clientId = null;

const usernameInput = document.getElementById("username");
const setUsernameButton = document.getElementById("set-username");
const createChatButton = document.getElementById("create-chat");
const availableChatsList = document.getElementById("available-chats");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const leaveChatButton = document.getElementById("leave-chat-button");

const statusMessageDiv = document.getElementById("status-message");
const membersList = document.getElementById("members-list");

const roomNameModal = document.getElementById("room-name-modal");
const roomNameInput = document.getElementById("room-name-input");
const confirmRoomNameButton = document.getElementById(
  "confirm-room-name-button"
);
const cancelRoomNameButton = document.getElementById("cancel-room-name-button");

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
let currentChatMembers = {};

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

function updateMembersList() {
  membersList.innerHTML = "";

  const myListItem = document.createElement("li");
  myListItem.textContent = `${username} (Tú)`;
  myListItem.classList.add("me");
  membersList.appendChild(myListItem);

  for (const remoteClientId in currentChatMembers) {
    if (remoteClientId === clientId) continue;

    const memberUsername = currentChatMembers[remoteClientId];
    const listItem = document.createElement("li");
    listItem.textContent = memberUsername;

    if (
      activePeers.has(remoteClientId) &&
      activePeers.get(remoteClientId).connected
    ) {
      listItem.classList.add("connected");
      listItem.textContent += " (Conectado)";
    } else {
      listItem.textContent += " (Uniéndose...)";
    }
    membersList.appendChild(listItem);
  }

  if (
    Object.keys(currentChatMembers).length === 1 &&
    currentChatMembers[clientId]
  ) {
    setStatusMessage(
      "Eres el único en este chat por ahora. Esperando a otros...",
      "info"
    );
  } else {
    clearStatusMessage();
  }
}

function showChatUI() {
  document.getElementById("user-setup").style.display = "none";
  createChatButton.style.display = "none";
  document.getElementById("chat-list").style.display = "none";

  document.getElementById("chat-area").style.display = "block";
  document.getElementById("message-input-area").style.display = "flex";
  if (leaveChatButton) leaveChatButton.style.display = "inline-block";

  document.querySelector("#chat-area h2").textContent = `Chat: ${
    currentChatName || currentChatId.substring(0, 8)
  }`;

  clearStatusMessage();
  updateMembersList();
}

function showLobbyUI() {
  document.getElementById("user-setup").style.display = "none";
  createChatButton.style.display = "block";
  document.getElementById("chat-list").style.display = "block";

  document.getElementById("chat-area").style.display = "none";
  document.getElementById("message-input-area").style.display = "none";
  if (leaveChatButton) leaveChatButton.style.display = "none";

  messagesDiv.innerHTML = "";
  messageInput.value = "";
  membersList.innerHTML = "";
  activePeers.clear();
  currentChatMembers = {};

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
    showChatUI();
    updateMembersList();
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
    updateMembersList();

    console.log(`Peers activos restantes: ${activePeers.size}`);
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
    updateMembersList();
  });

  activePeers.set(remoteClientId, peer);
  return peer;
}

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
          if (
            data.message.includes("Chat con ID") ||
            data.message.includes("Ya estás en otro chat")
          ) {
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

    activePeers.forEach((peer) => peer.destroy());
    activePeers.clear();
    currentChatMembers = {};
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

function hideInitialUI() {
  document.getElementById("user-setup").style.display = "flex";
  if (document.getElementById("chat-area"))
    document.getElementById("chat-area").style.display = "none";
  if (document.getElementById("message-input-area"))
    document.getElementById("message-input-area").style.display = "none";
  if (document.getElementById("chat-list"))
    document.getElementById("chat-list").style.display = "none";
  if (createChatButton) createChatButton.style.display = "none";
  if (statusMessageDiv) statusMessageDiv.style.display = "none";
  if (leaveChatButton) leaveChatButton.style.display = "none";
  if (roomNameModal) roomNameModal.style.display = "none";
  if (confirmLeaveModal) confirmLeaveModal.style.display = "none";
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

  if (memberCount === 1 && currentChatMembers[clientId]) {
    confirmLeaveMessage.textContent =
      "¡Atención! Eres el único usuario en esta sala. Si sales, la sala se borrará para siempre. ¿Deseas salir?";
    confirmLeaveModal.style.display = "flex";
  } else {
    performLeaveChat(false);
  }
});

confirmLeaveButton.addEventListener("click", () => {
  performLeaveChat(true);
  confirmLeaveModal.style.display = "none";
});

cancelLeaveButton.addEventListener("click", () => {
  confirmLeaveModal.style.display = "none";
  setStatusMessage("Has decidido permanecer en la sala.", "info");
});

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
        deleteChat: deleteChat,
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
