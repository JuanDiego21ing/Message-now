let username = null;
let clientId = null; // El ID único que nos asigna el servidor de señalización

const usernameInput = document.getElementById("username");
const setUsernameButton = document.getElementById("set-username");
const createChatButton = document.getElementById("create-chat");
const availableChatsList = document.getElementById("available-chats");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

// WebSocket para el servidor de señalización
let signalingSocket;
const SIGNALING_SERVER_URL = "ws://localhost:8081"; // Asegúrate de que coincida con el puerto de tu server.js

// Almacenará todas las conexiones P2P activas, mapeadas por el clientId del peer remoto.
// { remoteClientId: SimplePeer_instance, ... }
const activePeers = new Map();
let currentChatId = null; // El ID del chat al que estamos conectados

// --- Funciones de Utilidad ---
function b64Encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64Decode(str) {
  return decodeURIComponent(escape(atob(str)));
}

function displayMessage(sender, text, isMe) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message");
  messageDiv.innerHTML = `<strong>${isMe ? "Yo" : sender}:</strong> ${text}`;
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight; // Hacer scroll al último mensaje
}

// Función para inicializar un nuevo SimplePeer
function createPeer(remoteClientId, remoteUsername, initiator) {
  console.log(
    `Creando peer con ${remoteUsername} (ID: ${remoteClientId}). Iniciador: ${initiator}`
  );
  const peer = new SimplePeer({ initiator: initiator, trickle: false }); // trickle: false para enviar todas las ICE de golpe

  // Almacenar el nombre de usuario del peer remoto en la instancia de SimplePeer para usarlo en eventos
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
        receiverId: remoteClientId, // A quién va dirigida esta señal
        signal: data,
        chatId: currentChatId, // Para que el servidor sepa el contexto
      })
    );
  });

  peer.on("connect", () => {
    console.log(
      `¡CONECTADO con ${peer.remoteUsername} (ID: ${peer.remoteClientId})!`
    );
    displayMessage("Sistema", `${peer.remoteUsername} se ha conectado.`, false);
    // Ocultar la UI inicial y mostrar la de chat
    document.getElementById("user-setup").style.display = "none";
    createChatButton.style.display = "none";
    document.getElementById("chat-list").style.display = "none";

    document.getElementById("chat-area").style.display = "block";
    document.getElementById("message-input-area").style.display = "flex";
  });

  peer.on("data", (data) => {
    console.log(
      `Datos recibidos de ${peer.remoteUsername} (ID: ${peer.remoteClientId}):`,
      data.toString()
    );
    try {
      const message = JSON.parse(data.toString());
      displayMessage(message.sender, message.text, false);
    } catch (e) {
      console.error("Error al parsear el mensaje recibido:", e);
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
    activePeers.delete(peer.remoteClientId); // Eliminar el peer de la colección
    console.log(`Peers activos restantes: ${activePeers.size}`);
    if (activePeers.size === 0 && currentChatId) {
      // Si no quedan peers activos y estábamos en un chat, consideramos que el chat se cerró para nosotros
      alert(
        "Todos los demás se desconectaron o el chat se cerró. Recargando..."
      );
      location.reload();
    }
  });

  peer.on("error", (err) => {
    console.error(
      `Error del Peer WebRTC con ${peer.remoteUsername} (ID: ${peer.remoteClientId}):`,
      err
    );
    displayMessage(
      "Sistema",
      `Error en la conexión con ${peer.remoteUsername}: ${err.message}`,
      false
    );
    // Podríamos intentar reconectar o simplemente eliminar este peer problemático
    peer.destroy();
    activePeers.delete(peer.remoteClientId);
  });

  activePeers.set(remoteClientId, peer); // Guardar la instancia de peer
  return peer;
}

// --- Configuración del WebSocket de Señalización ---
function connectToSignalingServer() {
  signalingSocket = new WebSocket(SIGNALING_SERVER_URL);

  signalingSocket.onopen = () => {
    console.log("Conectado al servidor de señalización");
    if (username) {
      document.getElementById("chat-list").style.display = "block";
      createChatButton.style.display = "block";
    }
  };

  signalingSocket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    console.log("Mensaje del servidor de señalización:", data.type);

    switch (data.type) {
      case "your_id":
        clientId = data.clientId; // Almacenar nuestro propio ID de cliente
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
        // Si el chat eliminado es el que estamos, forzar recarga/limpieza
        if (currentChatId === data.chatId) {
          alert("El chat al que estabas conectado se cerró.");
          location.reload();
        }
        break;
      case "chat_members_update":
        // ¡Este es el mensaje clave para Full-Mesh!
        console.log("Actualización de miembros del chat:", data.members);
        if (data.chatId === currentChatId) {
          // Solo si es nuestro chat actual
          handleChatMembersUpdate(data.members);
        }
        break;
      case "signal":
        // Recibimos una señal de otro peer a través del servidor
        const senderClientId = data.senderId;
        const signalData = data.signal;

        // Si la señal es para nosotros y tenemos un peer con ese remitente...
        let peerToSignal = activePeers.get(senderClientId);

        if (peerToSignal) {
          console.log(
            `Recibida señal de ${senderClientId}. Tipo: ${signalData.type}. Reenviando a peer local.`
          );
          peerToSignal.signal(signalData);
        } else if (signalData.type === "offer") {
          // Si recibimos una oferta y no tenemos un peer con ese remitente,
          // significa que es una nueva conexión que nos inician.
          console.log(
            `Recibida OFERTA de ${senderClientId}. Creando nuevo peer receptor.`
          );
          // Encontraría el nombre de usuario del remitente si el servidor lo incluyera en la señal.
          // Para esta demo, podemos usar un nombre genérico o buscarlo en la lista de miembros si ya la tenemos.
          // Idealmente, el servidor incluiría `senderUsername` aquí.
          // Por ahora, asumimos que ya tenemos la lista de miembros en `currentChatMembers`
          const remoteUsername =
            currentChatMembers[senderClientId] ||
            `Desconocido (ID: ${senderClientId.substring(0, 8)})`;
          peerToSignal = createPeer(senderClientId, remoteUsername, false); // No somos el iniciador
          peerToSignal.signal(signalData);
        } else {
          console.warn(
            `Señal recibida de ${senderClientId} pero no hay peer existente o no es una oferta inicial. Tipo: ${signalData.type}`
          );
        }
        break;
      case "error":
        console.error("Error del servidor:", data.message);
        alert("Error del servidor: " + data.message);
        break;
    }
  };

  signalingSocket.onclose = (event) => {
    console.log(
      "Desconectado del servidor de señalización",
      event.code,
      event.reason
    );
    alert(
      "Desconectado del servidor de señalización. Asegúrate de que el servidor esté ejecutándose (node server.js)."
    );
    setTimeout(connectToSignalingServer, 5000); // Intentar reconectar
  };

  signalingSocket.onerror = (error) => {
    console.error("Error del WebSocket de señalización:", error);
  };
}

let currentChatMembers = {}; // Guardará la lista de miembros del chat actual { clientId: username, ... }

// Maneja la actualización de miembros del chat para establecer/cerrar conexiones P2P
function handleChatMembersUpdate(members) {
  currentChatMembers = members; // Actualizar nuestra lista local de miembros del chat

  // Crear/iniciar conexiones P2P con nuevos miembros
  for (const remoteClientId in members) {
    if (remoteClientId !== clientId && !activePeers.has(remoteClientId)) {
      // Este es un nuevo peer en el chat con el que no estamos conectados
      // El iniciador es el que tiene el ClientID lexicográficamente menor.
      // Esto asegura que cada par de peers solo inicie una conexión entre ellos.
      const initiator = clientId < remoteClientId; // Ejemplo de lógica de iniciador determinista
      createPeer(remoteClientId, members[remoteClientId], initiator);
    }
  }

  // Cerrar conexiones P2P con miembros que ya no están en el chat
  // Iterar sobre activePeers y verificar si el remoteClientId todavía está en 'members'
  activePeers.forEach((peerInstance, remoteClientId) => {
    if (!members[remoteClientId]) {
      console.log(
        `Miembro ${peerInstance.remoteUsername} (ID: ${remoteClientId}) ya no está en el chat. Cerrando conexión P2P.`
      );
      peerInstance.destroy(); // Cierra la conexión P2P
      // La eliminación del mapa activePeers se maneja en peer.on("close")
    }
  });
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
}
document.addEventListener("DOMContentLoaded", hideInitialUI);

setUsernameButton.addEventListener("click", () => {
  username = usernameInput.value.trim();
  if (username && username !== "Sistema") {
    // "Sistema" como nombre reservado
    document.getElementById("user-setup").style.display = "none";
    alert(`Tu nombre será: ${username}`);
    connectToSignalingServer(); // Conectar al servidor de señalización
  } else {
    alert("Por favor, ingresa un nombre válido y no 'Sistema'.");
  }
});

// El botón "Crear Nuevo Chat" ahora interactúa con el servidor de señalización
createChatButton.addEventListener("click", () => {
  if (!username) {
    alert("Por favor, ingresa tu nombre primero.");
    return;
  }
  if (currentChatId) {
    alert("Ya estás en un chat. Sal de él para crear uno nuevo.");
    return;
  }

  currentChatId = Math.random().toString(36).substring(2, 15); // Generar un ID de chat simple

  console.log(`Intentando crear chat ID: ${currentChatId} como iniciador.`);
  signalingSocket.send(
    JSON.stringify({
      type: "create_chat",
      chatId: currentChatId,
      username: username,
      clientId: clientId, // Enviamos nuestro clientId al servidor
    })
  );

  // Una vez que el chat es creado y confirmado por el servidor,
  // el servidor enviará un 'chat_members_update' para que nos conectemos
  createChatButton.disabled = true;
  document.getElementById("chat-list").style.display = "none";
  displayMessage(
    "Sistema",
    `Has creado el chat (ID: ${currentChatId.substring(
      0,
      8
    )}...). Esperando a otros participantes...`,
    false
  );
});

// Lógica para la Lista de Chats (misma que antes)
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
    alert("Por favor, ingresa tu nombre primero.");
    return;
  }
  if (currentChatId) {
    alert("Ya estás en un chat. Sal de él para unirte a otro.");
    return;
  }
  console.log(`Solicitando unirse al chat ID: ${chatId}`);
  currentChatId = chatId; // Establecer el chat actual
  signalingSocket.send(
    JSON.stringify({
      type: "register_user", // Cambiamos a register_user para que el servidor nos añada a la lista
      chatId: chatId,
      username: username,
      clientId: clientId, // Enviamos nuestro clientId al servidor
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
  if (message && activePeers.size > 0) {
    // Enviar si hay al menos un peer conectado
    const sender = username || "Anónimo";
    const messageToSend = JSON.stringify({ sender: sender, text: message });

    activePeers.forEach((peerInstance) => {
      if (peerInstance.connected) {
        peerInstance.send(messageToSend);
      }
    });
    displayMessage(sender, message, true);
    messageInput.value = "";
  } else if (!username) {
    alert("Por favor, ingresa tu nombre primero.");
  } else {
    alert("No estás conectado a ningún otro participante en este chat.");
  }
});
