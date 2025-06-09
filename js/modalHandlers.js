// js/modalHandlers.js

import * as UIElements from "./uiElements.js";
import * as State from "./state.js";
import { setStatusMessage, showChatUI, displayMessage } from "./uiHelpers.js";
import { performLeaveChat } from "./app.js";
import { setIsJoiningOrCreatingChat } from "./signaling.js";

// La librería SweetAlert2 (Swal) ya está disponible globalmente porque la añadimos en index.html

export function initModalEventHandlers() {
  // --- 1. MODIFICADO: Event Listener para "Crear Nuevo Chat" ---
  if (UIElements.createChatButton) {
    UIElements.createChatButton.addEventListener("click", () => {
      // Estas verificaciones iniciales se mantienen
      if (!State.getUsername()) {
        // Usaremos SweetAlert2 también para este error
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

      // --- REEMPLAZO DEL MODAL HTML POR SWEETALERT2 ---
      // Ya no mostramos el div del modal, sino que llamamos a Swal.fire()
      Swal.fire({
        title: "Crear Nueva Sala de Chat",
        input: "text",
        inputLabel: "Nombre de la sala",
        inputPlaceholder: "Ej: Equipo de Proyecto, Amigos...",
        showCancelButton: true,
        confirmButtonText: "Crear Sala",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#198754", // Color verde de éxito de Bootstrap
        cancelButtonColor: "#dc3545", // Color rojo de peligro de Bootstrap
        inputValidator: (value) => {
          // Validación para el campo de entrada
          if (!value || value.trim().length < 3 || value.trim().length > 30) {
            return "Por favor, ingresa un nombre válido (3-30 caracteres).";
          }
        },
      }).then((result) => {
        // Swal.fire devuelve una promesa. El código aquí se ejecuta después de que el usuario interactúa con el modal.

        // Si el usuario hizo clic en "Crear Sala" y la validación pasó
        if (result.isConfirmed) {
          const roomName = result.value.trim();

          // --- Lógica que antes estaba en el listener de 'confirmRoomNameButton' ---
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

          // setStatusMessage ya no es necesario aquí, podríamos usar un toast de Swal si quisiéramos
          // setStatusMessage(`Creando chat (Nombre: "${roomName}")...`, "info");

          signalingSocket.send(
            JSON.stringify({
              type: "create_chat",
              chatId: newChatId,
              chatName: roomName,
            })
          );

          showChatUI();
          displayMessage(
            "Sistema",
            `Has creado el chat "${roomName}". Esperando confirmación...`,
            false
          );
        }
      });
    });
  }

  // --- 2. ELIMINACIÓN DE LISTENERS OBSOLETOS ---
  // Los siguientes listeners ya no son necesarios porque los botones a los que
  // estaban asociados (`confirm-room-name-button`, `cancel-room-name-button`)
  // han sido eliminados del HTML. SweetAlert2 maneja sus propios botones.

  // if (UIElements.confirmRoomNameButton) { ... } // BORRADO
  // if (UIElements.cancelRoomNameButton) { ... } // BORRADO

  // --- 3. MANEJADORES DEL MODAL DE "CONFIRMAR SALIDA" ---
  // Estos botones también los eliminamos del HTML.
  // La lógica para mostrar el modal de confirmación de salida está en `app.js`.
  // Modificaremos `app.js` después para que también use SweetAlert2, haciendo estos
  // listeners también obsoletos. Por ahora, los comentamos o eliminamos para limpiar.

  // if (UIElements.confirmLeaveButton) {
  //   UIElements.confirmLeaveButton.addEventListener("click", () => {
  //     performLeaveChat(true);
  //     // UIElements.confirmLeaveModal.style.display = "none";
  //   });
  // }

  // if (UIElements.cancelLeaveButton) {
  //   UIElements.cancelLeaveButton.addEventListener("click", () => {
  //     // UIElements.confirmLeaveModal.style.display = "none";
  //   });
  // }
}
