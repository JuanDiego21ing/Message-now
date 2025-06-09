// js/modalHandlers.js
import * as UIElements from "./uiElements.js";
import * as State from "./state.js";
import { setStatusMessage, showChatUI, displayMessage } from "./uiHelpers.js";
import { performLeaveChat } from "./app.js";
import { setIsJoiningOrCreatingChat } from "./signaling.js";

// La librería SweetAlert2 (Swal) ya está disponible globalmente porque la añadimos en index.html

export function initModalEventHandlers() {
  if (UIElements.createChatButton) {
    UIElements.createChatButton.addEventListener("click", () => {
      // Verificaciones iniciales
      if (!State.getUsername()) {
        Swal.fire({
          icon: "error",
          title: "No Autenticado",
          text: "Debes iniciar sesión para poder crear un chat.",
        });
        return;
      }
      if (State.getCurrentChatId()) {
        Swal.fire({
          icon: "warning",
          title: "Ya estás en un chat",
          text: "Por favor, sal del chat actual antes de crear uno nuevo.",
        });
        return;
      }

      // Reemplazo del modal HTML por SweetAlert2
      Swal.fire({
        title: "Crear Nueva Sala de Chat",
        input: "text",
        inputLabel: "Nombre de la sala",
        inputPlaceholder: "Ej: Equipo de Proyecto, Amigos...",
        showCancelButton: true,
        confirmButtonText: "Crear Sala",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#198754",
        cancelButtonColor: "#dc3545",
        inputValidator: (value) => {
          if (!value || value.trim().length < 3 || value.trim().length > 30) {
            return "Por favor, ingresa un nombre válido (3-30 caracteres).";
          }
        },
      }).then((result) => {
        // Si el usuario hizo clic en "Crear Sala" y la validación pasó
        if (result.isConfirmed) {
          const roomName = result.value.trim();

          const signalingSocket = State.getSignalingSocket();

          if (
            !signalingSocket ||
            signalingSocket.readyState !== WebSocket.OPEN
          ) {
            Swal.fire(
              "Error de Conexión",
              "No se puede crear el chat, no hay conexión con el servidor de señalización.",
              "error"
            );
            return;
          }

          const newChatId =
            Math.random().toString(36).substring(2, 10) +
            Math.random().toString(36).substring(2, 10);

          setIsJoiningOrCreatingChat(true);
          State.setCurrentChatId(newChatId);
          State.setCurrentChatName(roomName);

          // Mostramos un toast mientras esperamos la confirmación del servidor.
          // NO cambiamos la UI a la vista de chat aquí.
          setStatusMessage(`Creando la sala "${roomName}"...`, "info");

          signalingSocket.send(
            JSON.stringify({
              type: "create_chat",
              chatId: newChatId,
              chatName: roomName,
            })
          );
        }
      });
    });
  }

  // El resto de los listeners para los modales antiguos ya no son necesarios
  // porque los modales HTML fueron eliminados.
}
