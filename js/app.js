// js/app.js
import * as State from "./state.js";
import * as UIElements from "./uiElements.js";
import {
  setStatusMessage,
  displayMessage,
  showLobbyUI,
  // hideInitialUI, // Ya no se usa, initializeApp maneja la UI inicial
  updateMembersList,
  clearStatusMessage,
} from "./uiHelpers.js";
import {
  connectToSignalingServer,
  setIsJoiningOrCreatingChat,
} from "./signaling.js";
import { initModalEventHandlers } from "./modalHandlers.js";
import { sendMessageToPeers } from "./webrtc.js";

// Función para mostrar el área de autenticación y ocultar la app principal
function showAuthUI() {
  console.log("APP.JS: showAuthUI() INVOCADO");
  UIElements.authAreaDiv.style.display = "block";
  UIElements.mainAppAreaDiv.style.display = "none";
  UIElements.loginFormContainer.style.display = "block"; // Mostrar login por defecto
  UIElements.registerFormContainer.style.display = "none";
  hideChatElements();
}

// Función para mostrar la app principal (lobby/chat) y ocultar autenticación
function showMainAppUI() {
  UIElements.authAreaDiv.style.display = "none";
  UIElements.mainAppAreaDiv.style.display = "block";
  UIElements.authenticatedUsernameDisplay.textContent =
    State.getUsername() || "N/A";
  UIElements.createChatButton.style.display = "block";
  UIElements.chatListDiv.style.display = "block";
  UIElements.availableChatsList.innerHTML =
    "<li>Conectando y cargando chats...</li>";
}

function hideChatElements() {
  if (UIElements.chatAreaDiv) UIElements.chatAreaDiv.style.display = "none";
  if (UIElements.messageInputAreaDiv)
    UIElements.messageInputAreaDiv.style.display = "none";
  if (UIElements.leaveChatButton)
    UIElements.leaveChatButton.style.display = "none";
}

async function handleRegistration(event) {
  event.preventDefault();
  const username = UIElements.registerUsernameInput.value.trim();
  const password = UIElements.registerPasswordInput.value.trim();

  if (!username || !password) {
    setStatusMessage(
      "Todos los campos son obligatorios para registrarse.",
      "warning"
    );
    return;
  }
  if (password.length < 6) {
    setStatusMessage(
      "La contraseña debe tener al menos 6 caracteres.",
      "warning"
    );
    return;
  }

  try {
    setStatusMessage("Registrando...", "info");
    // ---- URL MODIFICADA A RELATIVA ----
    const response = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    // Manejo de respuesta mejorado
    if (!response.ok) {
      let errorMsg = `Error en registro (HTTP ${response.status} ${response.statusText})`;
      try {
        const errorData = await response.json(); // Intenta parsear como JSON
        errorMsg = errorData.message || errorMsg;
      } catch (e) {
        console.warn(
          "La respuesta de error del servidor para /register no era JSON."
        );
        // errorMsg ya tiene el status HTTP, lo cual es suficiente si no hay cuerpo JSON
      }
      setStatusMessage(errorMsg, "error");
      return;
    }

    const data = await response.json(); // Si response.ok, esperamos JSON
    // El servidor envía 201 en éxito, lo cual es 'ok'
    setStatusMessage(
      data.message || "Registro exitoso. Ahora puedes iniciar sesión.",
      "success"
    );
    UIElements.registerFormContainer.style.display = "none";
    UIElements.loginFormContainer.style.display = "block";
    UIElements.registerForm.reset();
  } catch (error) {
    // Error de red o similar
    console.error("Error en fetch /register:", error);
    setStatusMessage("Error de red al intentar registrar.", "error");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = UIElements.loginUsernameInput.value.trim();
  const password = UIElements.loginPasswordInput.value.trim();

  if (!username || !password) {
    setStatusMessage("Usuario y contraseña son obligatorios.", "warning");
    return;
  }

  try {
    setStatusMessage("Iniciando sesión...", "info");
    // ---- URL MODIFICADA A RELATIVA ----
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      let errorMsg = `Error en inicio de sesión (HTTP ${response.status} ${response.statusText})`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.message || errorMsg;
      } catch (e) {
        console.warn(
          "La respuesta de error del login no era JSON o no pudo ser parseada."
        );
      }
      setStatusMessage(errorMsg, "error");
      State.clearAuthenticatedUser();
      return;
    }

    const data = await response.json();

    if (data.token) {
      State.setAuthenticatedUser(data.username, data.userId, data.token);

      console.log(
        "LOGIN SUCCESS (app.js): State.username set to:",
        State.getUsername()
      );
      console.log(
        "LOGIN SUCCESS (app.js): State.userId set to:",
        State.getUserId()
      );
      console.log(
        "LOGIN SUCCESS (app.js): State.authToken set:",
        State.getAuthToken() ? "Yes, token present" : "No, token MISSING!"
      );

      setStatusMessage(data.message || "Inicio de sesión exitoso.", "success");
      UIElements.loginForm.reset();
      showMainAppUI();
      connectToSignalingServer();
    } else {
      setStatusMessage(
        data.message || "Error en inicio de sesión: no se recibió token.",
        "error"
      );
      State.clearAuthenticatedUser();
    }
  } catch (error) {
    console.error("Error en fetch /login o al procesar la respuesta:", error);
    setStatusMessage(
      "Error de red o respuesta inesperada al intentar iniciar sesión.",
      "error"
    );
    State.clearAuthenticatedUser();
  }
}

function handleLogout() {
  console.log("LOGOUT (app.js): Iniciando cierre de sesión...");
  setStatusMessage("Cerrando sesión...", "info");
  const signalingSocket = State.getSignalingSocket();
  if (
    signalingSocket &&
    (signalingSocket.readyState === WebSocket.OPEN ||
      signalingSocket.readyState === WebSocket.CONNECTING)
  ) {
    console.log("LOGOUT (app.js): Cerrando WebSocket...");
    signalingSocket.close(1000, "Logout by user");
  } else {
    console.log("LOGOUT (app.js): WebSocket no estaba abierto o conectado.");
  }
  State.clearAuthenticatedUser();
  State.resetCurrentChatState();
  console.log("LOGOUT (app.js): Llamando a showAuthUI()...");
  showAuthUI();
  UIElements.availableChatsList.innerHTML = "";
  UIElements.messagesDiv.innerHTML = "";
  UIElements.membersList.innerHTML = "";
  setStatusMessage("Sesión cerrada.", "success");
  console.log("LOGOUT (app.js): Cierre de sesión completado en cliente.");
}

function initializeApp() {
  UIElements.loginForm.addEventListener("submit", handleLogin);
  UIElements.registerForm.addEventListener("submit", handleRegistration);
  UIElements.logoutButton.addEventListener("click", handleLogout);

  UIElements.showRegisterLink.addEventListener("click", (e) => {
    e.preventDefault();
    UIElements.loginFormContainer.style.display = "none";
    UIElements.registerFormContainer.style.display = "block";
    clearStatusMessage();
  });

  UIElements.showLoginLink.addEventListener("click", (e) => {
    e.preventDefault();
    UIElements.registerFormContainer.style.display = "none";
    UIElements.loginFormContainer.style.display = "block";
    clearStatusMessage();
  });

  if (State.loadStateFromStorage() && State.getAuthToken()) {
    setStatusMessage(
      `Bienvenido de nuevo, ${State.getUsername()}! Conectando...`,
      "info"
    );
    showMainAppUI();
    connectToSignalingServer();
  } else {
    showAuthUI();
  }

  initModalEventHandlers();

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

      if (
        !currentChatId ||
        !signalingSocket ||
        signalingSocket.readyState !== WebSocket.OPEN
      ) {
        setStatusMessage(
          "No estás actualmente en un chat activo o conectado para salir.",
          "warning"
        );
        State.resetCurrentChatState();
        showLobbyUI(true); // showLobbyUI(true) para que intente recargar lista de chats
        return;
      }

      const memberCount = Object.keys(State.getCurrentChatMembers()).length;
      const myConnId = State.getClientId();

      if (memberCount === 1 && State.getCurrentChatMembers()[myConnId]) {
        UIElements.confirmLeaveMessage.textContent =
          "¡Atención! Eres el único usuario en esta sala. Si sales, la sala podría borrarse. ¿Deseas salir?";
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

  if (
    currentChatId &&
    signalingSocket &&
    signalingSocket.readyState === WebSocket.OPEN
  ) {
    console.log(
      `Enviando leave_chat para ${currentChatId}. Solicitar borrado: ${requestDeleteChat}`
    );
    signalingSocket.send(
      JSON.stringify({
        type: "leave_chat",
        chatId: currentChatId,
        deleteChat: requestDeleteChat,
      })
    );
    State.resetCurrentChatState();
    showLobbyUI(true); // showLobbyUI(true) para que intente recargar lista de chats

    if (requestDeleteChat) {
      setStatusMessage("Has salido y solicitado eliminar la sala.", "success");
    } else {
      setStatusMessage("Has salido del chat.", "success");
    }
  } else {
    setStatusMessage(
      "Error al intentar salir del chat. No conectado o sin chat activo.",
      "error"
    );
    State.resetCurrentChatState();
    showLobbyUI(true); // showLobbyUI(true) para que intente recargar lista de chats
  }
}

document.addEventListener("DOMContentLoaded", initializeApp);
