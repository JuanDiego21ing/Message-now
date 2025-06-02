import * as UIElements from "./uiElements.js";
import * as State from "./state.js";
import { setStatusMessage, showChatUI, displayMessage } from "./uiHelpers.js";
import { performLeaveChat } from "./app.js";
import { setIsJoiningOrCreatingChat } from "./signaling.js";

export function initModalEventHandlers() {
  UIElements.createChatButton.addEventListener("click", () => {
    if (!State.getUsername()) {
      setStatusMessage("Por favor, ingresa tu nombre primero.", "error");
      return;
    }
    if (State.getCurrentChatId()) {
      setStatusMessage(
        "Ya estás en un chat. Sal de él para crear uno nuevo.",
        "warning"
      );
      return;
    }
    UIElements.roomNameInput.value = "";
    UIElements.roomNameModal.style.display = "flex";
    UIElements.roomNameInput.focus();
  });

  UIElements.confirmRoomNameButton.addEventListener("click", () => {
    const roomName = UIElements.roomNameInput.value.trim();
    const signalingSocket = State.getSignalingSocket();
    const username = State.getUsername();
    const clientId = State.getClientId();

    if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
      setStatusMessage(
        "No conectado al servidor de señalización. No se puede crear chat.",
        "error"
      );
      return;
    }

    if (roomName && roomName.length >= 3 && roomName.length <= 30) {
      const newChatId =
        Math.random().toString(36).substring(2, 10) +
        Math.random().toString(36).substring(2, 10); // Slightly longer ID

      setIsJoiningOrCreatingChat(true); // Indicar que estamos creando
      State.setCurrentChatId(newChatId);
      State.setCurrentChatName(roomName);

      setStatusMessage(`Creando chat (Nombre: "${roomName}")...`, "info");
      signalingSocket.send(
        JSON.stringify({
          type: "create_chat",
          chatId: newChatId,
          chatName: roomName,
          username: username,
          clientId: clientId, // El servidor usa ws.clientId pero enviarlo no hace daño
        })
      );

      UIElements.roomNameModal.style.display = "none";
      showChatUI();
      displayMessage(
        "Sistema",
        `Has creado el chat "${roomName}". Esperando confirmación del servidor...`,
        false
      );
      // displayMessage("Sistema", `Esperando a otros participantes...`, false); // This will be clear once members_update arrives
    } else {
      setStatusMessage(
        "Por favor, ingresa un nombre de sala válido (3-30 caracteres).",
        "warning"
      );
    }
  });

  UIElements.cancelRoomNameButton.addEventListener("click", () => {
    UIElements.roomNameModal.style.display = "none";
    // setStatusMessage("Creación de chat cancelada.", "info"); // Optional message
  });

  UIElements.confirmLeaveButton.addEventListener("click", () => {
    performLeaveChat(true); // deleteChat = true
    UIElements.confirmLeaveModal.style.display = "none";
  });

  UIElements.cancelLeaveButton.addEventListener("click", () => {
    UIElements.confirmLeaveModal.style.display = "none";
    // setStatusMessage("Has decidido permanecer en la sala.", "info"); // Optional
  });
}
