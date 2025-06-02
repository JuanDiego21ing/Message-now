// js/app.js
import * as State from './state.js';
import * as UIElements from './uiElements.js';
import { setStatusMessage, displayMessage, showLobbyUI, hideInitialUI, clearStatusMessage } from './uiHelpers.js'; // updateMembersList no se usa directamente aquí
import { connectToSignalingServer } from './signaling.js'; // setIsJoiningOrCreatingChat no se usa directamente aquí
import { initModalEventHandlers } from './modalHandlers.js';
import { sendMessageToPeers } from './webrtc.js';

function initializeApp() {
  hideInitialUI();
  initModalEventHandlers();

  UIElements.setUsernameButton.addEventListener("click", () => {
    const name = UIElements.usernameInput.value.trim();
    if (name && name.length >= 3 && name.length <= 20 && name.toLowerCase() !== "sistema" && name.toLowerCase() !== "yo") {
      State.setUsername(name);
      UIElements.userSetupDiv.style.display = "none";
      connectToSignalingServer();
    } else {
      setStatusMessage("Por favor, ingresa un nombre válido (3-20 caracteres, no 'Sistema' o 'Yo').", "error");
      UIElements.usernameInput.value = "";
    }
  });

  UIElements.sendButton.addEventListener("click", () => {
    const messageText = UIElements.messageInput.value.trim();
    if (messageText) {
      if (sendMessageToPeers(messageText)) {
        UIElements.messageInput.value = "";
      }
    } else {
      setStatusMessage("No puedes enviar un mensaje vacío.", "warning");
      setTimeout(clearStatusMessage, 2000);
    }
  });

  UIElements.messageInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      UIElements.sendButton.click();
    }
  });

  if (UIElements.leaveChatButton) {
    UIElements.leaveChatButton.addEventListener("click", () => {
        const currentChatId = State.getCurrentChatId();
        const signalingSocket = State.getSignalingSocket();

        if (!currentChatId || !signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
            setStatusMessage("No estás actualmente en un chat activo o conectado para salir.", "warning");
            State.resetCurrentChatState();
            showLobbyUI(true); // Actualizar lista al forzar ir al lobby
            return;
        }

        const memberCount = Object.keys(State.getCurrentChatMembers()).length;
        const myClientId = State.getClientId();

        if (memberCount === 1 && State.getCurrentChatMembers()[myClientId]) {
            UIElements.confirmLeaveMessage.textContent =
            "¡Atención! Eres el único usuario en esta sala. Si sales, la sala se eliminara para siempre. ¿Deseas salir?"; // Ajuste de mensaje
            UIElements.confirmLeaveModal.style.display = "flex";
        } else {
            performLeaveChat(false); 
        }
    });
  }
}

export function performLeaveChat(requestDeleteChat) {
  const currentChatId = State.getCurrentChatId();
  const signalingSocket = State.getSignalingSocket();
  const clientId = State.getClientId();

  if (currentChatId && signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    console.log(`Enviando leave_chat para ${currentChatId}. Solicitar borrado: ${requestDeleteChat}`);
    signalingSocket.send(
      JSON.stringify({
        type: "leave_chat",
        chatId: currentChatId,
        clientId: clientId, 
        deleteChat: requestDeleteChat,
      })
    );

    // No mostrar mensaje de "Has salido" aquí, esperar a que el servidor confirme o la UI cambie
    // displayMessage("Sistema", "Has salido del chat.", false); // Movido o implícito por cambio de UI
    State.resetCurrentChatState();
    showLobbyUI(true); // Vuelve al lobby y solicita lista actualizada

    if (requestDeleteChat) {
      setStatusMessage("Has salido y solicitado eliminar la sala.", "success");
    } else {
      setStatusMessage("Has salido del chat.", "success");
    }
  } else {
    setStatusMessage("Error al intentar salir del chat. No conectado o sin chat activo.", "error");
    State.resetCurrentChatState();
    showLobbyUI(true); // Actualizar lista al forzar ir al lobby
  }
}

document.addEventListener("DOMContentLoaded", initializeApp);