// js/signaling.js
import * as State from "./state.js";
// ... (resto de tus importaciones)
import {
  setStatusMessage,
  showLobbyUI,
  updateMembersList,
  displayMessage,
  clearStatusMessage,
} from "./uiHelpers.js";
import {
  updateAvailableChats,
  addChatToList,
  removeChatFromList,
} from "./chatList.js";
import { createPeer, handleChatMembersUpdate } from "./webrtc.js";

let reconnectTimer = null;
let currentOperationIsJoinOrCreate = false;

export function setIsJoiningOrCreatingChat(status) {
  currentOperationIsJoinOrCreate = status;
}

export function connectToSignalingServer() {
  if (
    State.getSignalingSocket() &&
    (State.getSignalingSocket().readyState === WebSocket.OPEN ||
      State.getSignalingSocket().readyState === WebSocket.CONNECTING)
  ) {
    console.log("Ya conectado o conectando al servidor de señalización.");
    return;
  }

  const token = State.getAuthToken(); // ¡OBTENER EL TOKEN!
  if (!token) {
    console.error("Intento de conexión WebSocket sin token de autenticación.");
    setStatusMessage("Error: No autenticado para conectar al chat.", "error");
    // Aquí podrías redirigir al login o mostrar el formulario de login
    // Por ejemplo, llamando a una función en uiHelpers.js o app.js
    // showLoginUI(); // Suponiendo que tienes esta función
    return;
  }

  setStatusMessage("Conectando al servidor de chat...", "info");
  // ¡AÑADIR TOKEN A LA URL!
  const socket = new WebSocket(`${State.SIGNALING_SERVER_URL}?token=${token}`);
  State.setSignalingSocket(socket);

  socket.onopen = () => {
    console.log(
      "Conexión WebSocket establecida y autenticada (esperando your_id)."
    );
    clearTimeout(reconnectTimer);
    // El servidor enviará 'your_id' y 'chat_list'
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log(`<= Mensaje del Servidor: ${data.type}`, data);

      switch (data.type) {
        case "your_id":
          State.setClientId(data.clientId); // Este es el connId del WebSocket
          // El username ya debería estar en State.username desde el login
          // data.username que envía el server ahora es el username autenticado
          if (data.username && data.username !== State.getUsername()) {
            console.warn(
              "El username del token no coincide con el username del cliente. Usando el del token del servidor."
            );
            // Esto no debería pasar si el token se genera y usa correctamente
          }
          setStatusMessage(
            `Conectado al chat como ${State.getUsername()}`,
            "success"
          );
          break;

        // ... (resto de tu lógica de onmessage SIN CAMBIOS IMPORTANTES POR AHORA,
        // ya que el servidor usa el ws.username autenticado)
        case "chat_list":
          updateAvailableChats(data.chats);
          if (State.getClientId() && !State.getCurrentChatId()) {
            showLobbyUI(false);
          }
          break;

        case "chat_removed":
          removeChatFromList(data.chatId);
          if (State.getCurrentChatId() === data.chatId) {
            setStatusMessage(
              "El chat al que estabas conectado ha sido eliminado.",
              "warning"
            );
            displayMessage(
              "Sistema",
              "Este chat ha sido eliminado por el servidor.",
              false
            );
            State.resetCurrentChatState();
            setTimeout(() => showLobbyUI(true), 200);
          }
          break;

        case "chat_members_update":
          if (data.chatId === State.getCurrentChatId()) {
            const myClientId_connId = State.getClientId(); // Este es el connId
            const currentMembersBeforeUpdate = {
              ...State.getCurrentChatMembers(),
            };
            // El servidor ahora envía members como { connId: username }
            const iWasMember = !!currentMembersBeforeUpdate[myClientId_connId];

            State.setCurrentChatMembers(data.members);
            if (data.chatName) State.setCurrentChatName(data.chatName);

            if (
              currentOperationIsJoinOrCreate &&
              data.members[myClientId_connId]
            ) {
              if (
                !iWasMember ||
                Object.keys(currentMembersBeforeUpdate).length === 0
              ) {
                setStatusMessage(
                  `Te has unido a "${
                    State.getCurrentChatName() ||
                    State.getCurrentChatId().substring(0, 8)
                  }". Configurando P2P...`,
                  "success"
                );
              }
              setIsJoiningOrCreatingChat(false);
            }

            const newMemberIds_connIds = Object.keys(data.members);
            const oldMemberIds_connIds = Object.keys(
              currentMembersBeforeUpdate
            );

            newMemberIds_connIds.forEach((id) => {
              // Comparar usando connId (clientId del WebSocket)
              if (
                id !== myClientId_connId &&
                !oldMemberIds_connIds.includes(id)
              ) {
                displayMessage(
                  "Sistema",
                  `${data.members[id]} se ha unido al chat.`,
                  false
                );
              }
            });

            updateMembersList();
            handleChatMembersUpdate(data.members);
          }
          break;

        case "signal":
          const senderClientId_connId = data.senderId; // Este es un connId
          const signalData = data.signal;
          let peerToSignal = State.getActivePeer(senderClientId_connId);

          if (peerToSignal) {
            peerToSignal.signal(signalData);
          } else if (signalData.type === "offer") {
            // State.getCurrentChatMembers() es { connId: username }
            if (
              State.getCurrentChatMembers()[senderClientId_connId] &&
              data.chatId === State.getCurrentChatId()
            ) {
              const remoteUsername =
                State.getCurrentChatMembers()[senderClientId_connId];
              console.log(
                `Recibida oferta de ${remoteUsername} (ConnID: ${senderClientId_connId}), creando peer (no iniciador)`
              );
              peerToSignal = createPeer(
                senderClientId_connId,
                remoteUsername,
                false
              );
              peerToSignal.signal(signalData);
            } else {
              console.warn(
                `Oferta P2P recibida de un cliente ${senderClientId_connId} no esperado o chat incorrecto. Ignorada.`,
                data
              );
            }
          } else {
            console.warn(
              `Señal P2P (tipo ${signalData.type}) de ${senderClientId_connId} sin peer o no es oferta. Ignorada.`,
              data
            );
          }
          break;

        case "error": // Errores del servidor WebSocket (ej. token inválido al conectar)
          setStatusMessage(
            `Error del servidor de chat: ${data.message}`,
            "error"
          );
          console.error("Error del servidor de chat:", data.message, data);
          setIsJoiningOrCreatingChat(false);

          // Si el error es de autenticación, podríamos necesitar volver a mostrar el login
          if (
            data.message.includes("Autenticación fallida") ||
            data.message.includes("Autenticación requerida")
          ) {
            State.clearAuthenticatedUser(); // Limpiar token viejo
            // Aquí llamarías a una función que muestre el UI de login de nuevo
            // Por ejemplo: showAuthUI(); (a definir en uiHelpers o app.js)
            document.getElementById("main-app-area").style.display = "none";
            document.getElementById("auth-area").style.display = "block";
          } else {
            // Otros errores que podrían requerir ir al lobby
            const kickToLobbyMessages = [
              "Chat con ID",
              "no encontrado",
              "Ya estás en otro chat",
              "Chat ya existe",
            ];
            if (kickToLobbyMessages.some((msg) => data.message.includes(msg))) {
              if (State.getCurrentChatId()) {
                State.resetCurrentChatState();
                setTimeout(() => showLobbyUI(true), 1000);
              }
            }
          }
          break;
        default:
          console.warn(
            `Tipo de mensaje desconocido del servidor: ${data.type}`,
            data
          );
      }
    } catch (e) {
      setStatusMessage("Error procesando mensaje del servidor.", "error");
      console.error("Error al parsear mensaje del servidor:", e, event.data);
    }
  };

  socket.onclose = (event) => {
    console.log(
      "Desconectado del servidor de señalización",
      event.code,
      event.reason
    );
    setIsJoiningOrCreatingChat(false);
    State.setSignalingSocket(null); // Marcar el socket como cerrado/nulo

    if (event.code === 1000) {
      setStatusMessage("Desconectado del servidor.", "info");
      return;
    } else if (event.code === 4001 || event.reason.includes("Token inválido")) {
      // Ejemplo de código personalizado para error de auth
      setStatusMessage(
        "Sesión inválida. Por favor, inicia sesión de nuevo.",
        "error"
      );
      State.clearAuthenticatedUser();
      document.getElementById("main-app-area").style.display = "none";
      document.getElementById("auth-area").style.display = "block";
      return;
    }
    setStatusMessage("Desconectado. Reintentando conectar...", "error");
    clearTimeout(reconnectTimer);
    // Solo reintentar si hay un token válido, de lo contrario el usuario debe loguearse
    if (State.getAuthToken()) {
      reconnectTimer = setTimeout(
        connectToSignalingServer,
        State.RECONNECT_INTERVAL
      );
    } else {
      console.log(
        "No hay token, no se reintentará la conexión WebSocket automáticamente."
      );
      document.getElementById("main-app-area").style.display = "none";
      document.getElementById("auth-area").style.display = "block";
    }
  };

  socket.onerror = (error) => {
    console.error("Error del WebSocket de señalización:", error);
    setIsJoiningOrCreatingChat(false);
    setStatusMessage(
      "Fallo en la conexión al servidor. Revisa la consola.",
      "error"
    );
    // onclose se llamará después.
  };
}
