// js/signaling.js
import * as State from "./state.js";
import {
  setStatusMessage,
  showLobbyUI,
  updateMembersList,
  displayMessage,
  showChatUI, // Asegúrate de importar showChatUI
} from "./uiHelpers.js";
import {
  updateAvailableChats,
  addChatToList,
  removeChatFromList,
} from "./chatList.js";
import { createPeer, handleChatMembersUpdate } from "./webrtc.js";

// La librería SweetAlert2 (Swal) ya está disponible globalmente
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

  const token = State.getAuthToken();
  if (!token) {
    console.error("Intento de conexión WebSocket sin token de autenticación.");
    Swal.fire(
      "Error de Autenticación",
      "No se puede conectar al chat sin un token de sesión. Por favor, inicia sesión.",
      "error"
    );
    return;
  }

  setStatusMessage("Conectando al servidor de chat...", "info");

  const socket = new WebSocket(`${State.SIGNALING_SERVER_URL}?token=${token}`);
  State.setSignalingSocket(socket);

  socket.onopen = () => {
    console.log(
      "Conexión WebSocket establecida y autenticada (esperando your_id)."
    );
    clearTimeout(reconnectTimer);
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log(`<= Mensaje del Servidor: ${data.type}`, data);

      switch (data.type) {
        case "your_id":
          State.setClientId(data.clientId);
          setStatusMessage(`Conectado como ${State.getUsername()}`, "success");
          break;

        case "chat_list":
          updateAvailableChats(data.chats);
          // Modificación para evitar el bug visual: se añade la comprobación de la bandera.
          if (
            State.getClientId() &&
            !State.getCurrentChatId() &&
            !currentOperationIsJoinOrCreate
          ) {
            showLobbyUI(false);
          }
          break;

        case "chat_removed":
          removeChatFromList(data.chatId);
          if (State.getCurrentChatId() === data.chatId) {
            Swal.fire(
              "Chat Eliminado",
              "El chat al que estabas conectado ha sido eliminado por el servidor.",
              "warning"
            );
            State.resetCurrentChatState();
            setTimeout(() => showLobbyUI(true), 1500);
          }
          break;

        case "chat_members_update":
          if (data.chatId === State.getCurrentChatId()) {
            const myConnId = State.getClientId();
            const currentMembersBeforeUpdate = {
              ...State.getCurrentChatMembers(),
            };
            const iWasMember = !!currentMembersBeforeUpdate[myConnId];

            State.setCurrentChatMembers(data.members);
            if (data.chatName) State.setCurrentChatName(data.chatName);

            if (currentOperationIsJoinOrCreate && data.members[myConnId]) {
              if (
                !iWasMember ||
                Object.keys(currentMembersBeforeUpdate).length === 0
              ) {
                // ---- CAMBIO IMPORTANTE AQUÍ ----
                // Ahora que el servidor confirmó, mostramos la UI del chat.
                showChatUI();

                setStatusMessage(
                  `Te has unido a "${
                    State.getCurrentChatName() ||
                    State.getCurrentChatId().substring(0, 8)
                  }".`,
                  "success"
                );
              }
              setIsJoiningOrCreatingChat(false);
            }

            const newMemberIds = Object.keys(data.members);
            const oldMemberIds = Object.keys(currentMembersBeforeUpdate);

            newMemberIds.forEach((id) => {
              if (id !== myConnId && !oldMemberIds.includes(id)) {
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
          const senderConnId = data.senderId;
          const signalData = data.signal;
          let peerToSignal = State.getActivePeer(senderConnId);

          if (peerToSignal) {
            peerToSignal.signal(signalData);
          } else if (signalData.type === "offer") {
            if (
              State.getCurrentChatMembers()[senderConnId] &&
              data.chatId === State.getCurrentChatId()
            ) {
              const remoteUsername =
                State.getCurrentChatMembers()[senderConnId];
              peerToSignal = createPeer(senderConnId, remoteUsername, false);
              peerToSignal.signal(signalData);
            } else {
              console.warn(
                `Oferta P2P recibida de un cliente ${senderConnId} no esperado o chat incorrecto. Ignorada.`,
                data
              );
            }
          } else {
            console.warn(
              `Señal P2P (tipo ${signalData.type}) de ${senderConnId} sin peer o no es oferta. Ignorada.`,
              data
            );
          }
          break;

        case "error":
          Swal.fire("Error del Servidor", data.message, "error");
          console.error("Error del servidor de chat:", data.message, data);
          setIsJoiningOrCreatingChat(false);

          if (data.message.includes("Autenticación")) {
            State.clearAuthenticatedUser();
            setTimeout(() => {
              document.getElementById("main-app-area").style.display = "none";
              document.getElementById("auth-area").style.display = "block";
            }, 2000);
          } else {
            const kickToLobbyMessages = [
              "Chat con ID",
              "no encontrado",
              "Ya estás en otro chat",
              "Chat ya existe",
            ];
            if (kickToLobbyMessages.some((msg) => data.message.includes(msg))) {
              if (State.getCurrentChatId()) {
                State.resetCurrentChatState();
                setTimeout(() => showLobbyUI(true), 1500);
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
      console.error("Error al parsear mensaje del servidor:", e, event.data);
      setStatusMessage("Error procesando mensaje del servidor.", "error");
    }
  };

  socket.onclose = (event) => {
    console.log(
      "Desconectado del servidor de señalización",
      event.code,
      event.reason
    );
    setIsJoiningOrCreatingChat(false);
    State.setSignalingSocket(null);

    const intentionalClose =
      event.code === 1000 ||
      event.code === 4001 ||
      event.reason.includes("Token inválido");

    if (intentionalClose) {
      setStatusMessage("Desconectado del servidor.", "info");
      if (!State.getAuthToken()) {
        document.getElementById("main-app-area").style.display = "none";
        document.getElementById("auth-area").style.display = "block";
      }
      return;
    }

    setStatusMessage("Desconectado. Reintentando conectar...", "error");
    clearTimeout(reconnectTimer);
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
  };
}
