// js/modalHandlers.js

import * as UIElements from "./uiElements.js";
import * as State from "./state.js";
import { setStatusMessage, showChatUI, displayMessage } from "./uiHelpers.js";
import { performLeaveChat } from "./app.js"; // Asumiendo que está en app.js
import { setIsJoiningOrCreatingChat } from "./signaling.js";

export function initModalEventHandlers() {
  UIElements.createChatButton.addEventListener("click", () => {
    // ---- VERIFICA ESTE LOG ----
    console.log(
      "CREATE CHAT CLICKED (modalHandlers.js): State.username is:",
      State.getUsername()
    );
    console.log(
      "CREATE CHAT CLICKED (modalHandlers.js): State.getAuthToken is present:",
      State.getAuthToken() ? "Yes" : "No"
    );
    // ---- FIN DE VERIFICACIÓN ----

    if (!State.getUsername()) {
      // Esta es probablemente la condición que está fallando
      setStatusMessage(
        "Debes estar autenticado y tener un nombre de usuario para crear un chat. Intenta iniciar sesión de nuevo.",
        "error"
      );
      return;
    }
    if (State.getCurrentChatId()) {
      setStatusMessage(
        "Ya estás en un chat. Sal de él para crear uno nuevo.",
        "warning"
      );
      return;
    }

    // El resto de tu lógica para mostrar el modal de nombre de sala...
    UIElements.roomNameInput.value = "";
    UIElements.roomNameModal.style.display = "flex";
    UIElements.roomNameInput.focus();
  });

  // ... (resto de tus manejadores de eventos en initModalEventHandlers:
  //      confirmRoomNameButton, cancelRoomNameButton,
  //      confirmLeaveButton, cancelLeaveButton) ...

  // Asegúrate que confirmRoomNameButton también use el username autenticado
  UIElements.confirmRoomNameButton.addEventListener("click", () => {
    const roomName = UIElements.roomNameInput.value.trim();
    const signalingSocket = State.getSignalingSocket();
    const currentUsername = State.getUsername(); // Obtener el username autenticado
    const currentClientId = State.getClientId(); // Este es el connId del WebSocket

    console.log(
      "CONFIRM ROOM NAME (modalHandlers.js): Username for chat creation:",
      currentUsername
    ); // Log de depuración

    if (!currentUsername) {
      // Nueva verificación
      setStatusMessage(
        "Error: No se pudo obtener el nombre de usuario autenticado para crear la sala.",
        "error"
      );
      return;
    }
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
        Math.random().toString(36).substring(2, 10);

      setIsJoiningOrCreatingChat(true);
      State.setCurrentChatId(newChatId);
      State.setCurrentChatName(roomName);

      setStatusMessage(`Creando chat (Nombre: "${roomName}")...`, "info");
      signalingSocket.send(
        JSON.stringify({
          type: "create_chat",
          chatId: newChatId,
          chatName: roomName,
          // username: currentUsername, // El servidor ya usa ws.username del token
          // clientId: currentClientId, // El servidor usa ws.connId de la conexión
        })
      );

      UIElements.roomNameModal.style.display = "none";
      showChatUI();
      displayMessage(
        "Sistema",
        `Has creado el chat "${roomName}". Esperando confirmación...`,
        false
      );
    } else {
      setStatusMessage(
        "Por favor, ingresa un nombre de sala válido (3-30 caracteres).",
        "warning"
      );
    }
  });

  UIElements.cancelRoomNameButton.addEventListener("click", () => {
    UIElements.roomNameModal.style.display = "none";
  });

  UIElements.confirmLeaveButton.addEventListener("click", () => {
    performLeaveChat(true);
    UIElements.confirmLeaveModal.style.display = "none";
  });

  UIElements.cancelLeaveButton.addEventListener("click", () => {
    UIElements.confirmLeaveModal.style.display = "none";
  });
}
