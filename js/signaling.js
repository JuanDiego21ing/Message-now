// js/signaling.js
import * as State from './state.js';
import {
  setStatusMessage,
  clearStatusMessage,
  showLobbyUI, // Esta función ahora tiene un parámetro
  updateMembersList,
  displayMessage
} from './uiHelpers.js';
import {
  updateAvailableChats,
  addChatToList,
  removeChatFromList
} from './chatList.js';
import {
  createPeer,
  handleChatMembersUpdate
} from './webrtc.js';

let reconnectTimer = null;
let currentOperationIsJoinOrCreate = false;

export function setIsJoiningOrCreatingChat(status) {
  currentOperationIsJoinOrCreate = status;
}

export function connectToSignalingServer() {
  if (State.getSignalingSocket() && (State.getSignalingSocket().readyState === WebSocket.OPEN || State.getSignalingSocket().readyState === WebSocket.CONNECTING)) {
    console.log("Ya conectado o conectando al servidor de señalización.");
    return;
  }

  setStatusMessage("Conectando al servidor de señalización...", "info");
  const socket = new WebSocket(State.SIGNALING_SERVER_URL);
  State.setSignalingSocket(socket);

  socket.onopen = () => {
    console.log("Conectado al servidor de señalización.");
    clearTimeout(reconnectTimer);
    // El servidor enviará 'your_id' y 'chat_list' automáticamente.
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      // La línea 48 que mencionas sería esta:
      console.log(`<= Mensaje del Servidor: ${data.type}`, data); 

      switch (data.type) {
        case "your_id":
          State.setClientId(data.clientId);
          const username = State.getUsername() || "Usuario"; // Tener un fallback por si acaso
          setStatusMessage(`Conectado como ${username} (ID: ${data.clientId.substring(0,6)}...)`, "success");
          // No llamamos a showLobbyUI aquí; esperamos a que llegue 'chat_list'.
          // El servidor envía 'chat_list' justo después de 'your_id'.
          break;

        case "chat_list":
          updateAvailableChats(data.chats);
          // Si tenemos un ID de cliente y no estamos actualmente en un chat,
          // entonces mostramos la UI del lobby.
          // ¡Importante! Llamamos con 'false' para NO volver a solicitar la lista.
          if (State.getClientId() && !State.getCurrentChatId()) {
            showLobbyUI(false); // Muestra UI del lobby sin solicitar nueva lista
          }
          break;

        case "chat_removed":
          removeChatFromList(data.chatId);
          if (State.getCurrentChatId() === data.chatId) {
            setStatusMessage("El chat al que estabas conectado ha sido eliminado.", "warning");
            displayMessage("Sistema", "Este chat ha sido eliminado por el servidor.", false);
            State.resetCurrentChatState();
            // Llamamos con 'true' para que actualice la lista al volver al lobby
            setTimeout(() => showLobbyUI(true), 200); // Más rápido para volver al lobby
          }
          break;

        case "chat_members_update":
          if (data.chatId === State.getCurrentChatId()) {
            const myClientId = State.getClientId();
            const currentMembersBeforeUpdate = { ...State.getCurrentChatMembers() };
            const iWasMember = !!currentMembersBeforeUpdate[myClientId];

            State.setCurrentChatMembers(data.members);
            if (data.chatName) State.setCurrentChatName(data.chatName);

            if (currentOperationIsJoinOrCreate && data.members[myClientId]) {
              if (!iWasMember || Object.keys(currentMembersBeforeUpdate).length === 0) {
                setStatusMessage(`Te has unido a "${State.getCurrentChatName() || State.getCurrentChatId().substring(0, 8)}". Configurando P2P...`, "success");
              }
              setIsJoiningOrCreatingChat(false);
            }
            
            const newMemberIds = Object.keys(data.members);
            const oldMemberIds = Object.keys(currentMembersBeforeUpdate);

            newMemberIds.forEach(id => {
                if (id !== myClientId && !oldMemberIds.includes(id)) {
                    displayMessage("Sistema", `${data.members[id]} se ha unido al chat.`, false);
                }
            });
            
            updateMembersList();
            handleChatMembersUpdate(data.members);
          }
          break;

        case "signal":
          const senderClientId = data.senderId;
          const signalData = data.signal;
          let peerToSignal = State.getActivePeer(senderClientId);

          if (peerToSignal) {
            peerToSignal.signal(signalData);
          } else if (signalData.type === "offer") {
            if (State.getCurrentChatMembers()[senderClientId] && data.chatId === State.getCurrentChatId()) {
              const remoteUsername = State.getCurrentChatMembers()[senderClientId];
              console.log(`Recibida oferta de ${remoteUsername} (ID: ${senderClientId}), creando peer (no iniciador)`);
              peerToSignal = createPeer(senderClientId, remoteUsername, false);
              peerToSignal.signal(signalData);
            } else {
              console.warn(`Oferta P2P recibida de un cliente ${senderClientId} no esperado o chat incorrecto. Ignorada.`, data);
            }
          } else {
            console.warn(`Señal P2P (tipo ${signalData.type}) de ${senderClientId} sin peer o no es oferta. Ignorada.`, data);
          }
          break;

        case "error":
          setStatusMessage(`Error del servidor: ${data.message}`, "error");
          console.error("Error del servidor:", data.message, data);
          setIsJoiningOrCreatingChat(false); 

          const kickToLobbyMessages = [
            "Chat con ID", "no encontrado", "Ya estás en otro chat", "Chat ya existe"
          ];
          if (kickToLobbyMessages.some(msg => data.message.includes(msg))) {
            if (State.getCurrentChatId()){ // Solo si estaba intentando estar en un chat
                 State.resetCurrentChatState();
                 setTimeout(() => showLobbyUI(true), 1000); // Actualizar lista al volver al lobby
            }
          }
          break;
        default:
          console.warn(`Tipo de mensaje desconocido del servidor: ${data.type}`, data);
      }
    } catch (e) {
      setStatusMessage("Error procesando mensaje del servidor.", "error");
      console.error("Error al parsear mensaje del servidor:", e, event.data);
    }
  };

  socket.onclose = (event) => {
    console.log("Desconectado del servidor de señalización", event.code, event.reason);
    setIsJoiningOrCreatingChat(false); 

    if (event.code === 1000) {
        setStatusMessage("Desconectado del servidor.", "info");
        return;
    }
    setStatusMessage("Desconectado. Reintentando conectar...", "error");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectToSignalingServer, State.RECONNECT_INTERVAL);
  };

  socket.onerror = (error) => {
    console.error("Error del WebSocket de señalización:", error);
    setIsJoiningOrCreatingChat(false);
    setStatusMessage("Fallo en la conexión al servidor. Revisa la consola.", "error");
  };
}