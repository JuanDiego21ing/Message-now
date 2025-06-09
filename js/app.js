// js/app.js
import * as State from "./state.js";
import * as UIElements from "./uiElements.js";
import {
  setStatusMessage,
  displayMessage,
  showLobbyUI,
  // hideInitialUI, // Ya no se usa
  updateMembersList,
  clearStatusMessage,
} from "./uiHelpers.js";
import {
  connectToSignalingServer,
  setIsJoiningOrCreatingChat,
} from "./signaling.js";
import { initModalEventHandlers } from "./modalHandlers.js";
import { sendMessageToPeers } from "./webrtc.js";

// La librería SweetAlert2 (Swal) ya está disponible globalmente

function showAuthUI() {
  console.log("APP.JS: showAuthUI() INVOCADO");
  UIElements.authAreaDiv.style.display = "block";
  UIElements.mainAppAreaDiv.style.display = "none";
  UIElements.loginFormContainer.style.display = "block";
  UIElements.registerFormContainer.style.display = "none";
  hideChatElements();
}

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
    Swal.fire(
      "Error",
      "Todos los campos son obligatorios para registrarse.",
      "warning"
    );
    return;
  }
  if (password.length < 6) {
    Swal.fire(
      "Error",
      "La contraseña debe tener al menos 6 caracteres.",
      "warning"
    );
    return;
  }

  try {
    // Usaremos un toast de SweetAlert2 para mensajes de estado
    const Toast = Swal.mixin({
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
    });
    Toast.fire({ icon: "info", title: "Registrando..." });

    const response = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();
    if (response.ok) {
      Swal.fire(
        "¡Registro Exitoso!",
        data.message || "Ahora puedes iniciar sesión.",
        "success"
      );
      UIElements.registerFormContainer.style.display = "none";
      UIElements.loginFormContainer.style.display = "block";
      UIElements.registerForm.reset();
    } else {
      Swal.fire(
        "Error de Registro",
        data.message || "No se pudo completar el registro.",
        "error"
      );
    }
  } catch (error) {
    console.error("Error en fetch /register:", error);
    Swal.fire(
      "Error de Red",
      "No se pudo conectar con el servidor para el registro.",
      "error"
    );
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = UIElements.loginUsernameInput.value.trim();
  const password = UIElements.loginPasswordInput.value.trim();

  if (!username || !password) {
    Swal.fire(
      "Campos incompletos",
      "Usuario y contraseña son obligatorios.",
      "warning"
    );
    return;
  }

  try {
    const Toast = Swal.mixin({
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
    });
    Toast.fire({ icon: "info", title: "Iniciando sesión..." });

    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: `Error HTTP ${response.status}` }));
      Swal.fire(
        "Error de Inicio de Sesión",
        errorData.message || "Credenciales inválidas.",
        "error"
      );
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

      Toast.fire({ icon: "success", title: "¡Conectado!" });

      UIElements.loginForm.reset();
      showMainAppUI();
      connectToSignalingServer();
    } else {
      Swal.fire(
        "Error",
        data.message || "Error en inicio de sesión: no se recibió token.",
        "error"
      );
      State.clearAuthenticatedUser();
    }
  } catch (error) {
    console.error("Error en fetch /login o al procesar la respuesta:", error);
    Swal.fire(
      "Error de Red",
      "No se pudo conectar con el servidor para iniciar sesión.",
      "error"
    );
    State.clearAuthenticatedUser();
  }
}

function handleLogout() {
  // Ahora usaremos SweetAlert para confirmar el logout
  Swal.fire({
    title: "¿Cerrar sesión?",
    text: "Se cerrará tu conexión actual.",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Sí, cerrar sesión",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#3085d6",
    cancelButtonColor: "#d33",
  }).then((result) => {
    if (result.isConfirmed) {
      console.log("LOGOUT (app.js): Iniciando cierre de sesión...");
      const Toast = Swal.mixin({
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
      });
      Toast.fire({ icon: "info", title: "Cerrando sesión..." });

      const signalingSocket = State.getSignalingSocket();
      if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.close(1000, "Logout by user");
      }

      State.clearAuthenticatedUser();
      State.resetCurrentChatState();

      showAuthUI();

      UIElements.availableChatsList.innerHTML = "";
      UIElements.messagesDiv.innerHTML = "";
      UIElements.membersList.innerHTML = "";
      console.log("LOGOUT (app.js): Cierre de sesión completado en cliente.");
    }
  });
}

function initializeApp() {
  UIElements.loginForm.addEventListener("submit", handleLogin);
  UIElements.registerForm.addEventListener("submit", handleRegistration);
  UIElements.logoutButton.addEventListener("click", handleLogout);

  UIElements.showRegisterLink.addEventListener("click", (e) => {
    e.preventDefault();
    UIElements.loginFormContainer.style.display = "none";
    UIElements.registerFormContainer.style.display = "block";
    clearStatusMessage(); // Podemos mantener esto o eliminarlo si Swal se encarga de todo
  });

  UIElements.showLoginLink.addEventListener("click", (e) => {
    e.preventDefault();
    UIElements.registerFormContainer.style.display = "none";
    UIElements.loginFormContainer.style.display = "block";
    clearStatusMessage();
  });

  if (State.loadStateFromStorage() && State.getAuthToken()) {
    const Toast = Swal.mixin({
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
    });
    Toast.fire({
      icon: "info",
      title: `Bienvenido de nuevo, ${State.getUsername()}!`,
    });

    showMainAppUI();
    connectToSignalingServer();
  } else {
    showAuthUI();
  }

  initModalEventHandlers();

  UIElements.sendButton.addEventListener("click", () => {
    const messageText = UIElements.messageInput.value.trim();
    if (messageText) {
      if (!sendMessageToPeers(messageText)) {
        // sendMessageToPeers ahora puede devolver false si no se envió
        // Podemos mostrar una alerta si falla
        Swal.fire({
          toast: true,
          position: "top-end",
          icon: "warning",
          title: "El mensaje no se pudo enviar a nadie.",
          showConfirmButton: false,
          timer: 2000,
        });
      } else {
        UIElements.messageInput.value = "";
      }
    }
  });

  UIElements.messageInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      UIElements.sendButton.click();
    }
  });

  if (UIElements.leaveChatButton) {
    // --- MODIFICADO: Event Listener para "Salir del Chat" ---
    UIElements.leaveChatButton.addEventListener("click", () => {
      const currentChatId = State.getCurrentChatId();
      const signalingSocket = State.getSignalingSocket();

      if (
        !currentChatId ||
        !signalingSocket ||
        signalingSocket.readyState !== WebSocket.OPEN
      ) {
        Swal.fire(
          "Error",
          "No estás en un chat activo para poder salir.",
          "error"
        );
        State.resetCurrentChatState();
        showLobbyUI(true);
        return;
      }

      const memberCount = Object.keys(State.getCurrentChatMembers()).length;
      const myConnId = State.getClientId();
      const isLastMember =
        memberCount === 1 && State.getCurrentChatMembers()[myConnId];

      // --- REEMPLAZO DEL MODAL HTML POR SWEETALERT2 ---
      Swal.fire({
        title: "¿Estás seguro?",
        text: isLastMember
          ? "¡Atención! Eres el último en la sala. Si sales, la sala podría ser eliminada."
          : "Estás a punto de salir de este chat.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Sí, ¡Salir!",
        cancelButtonText: "Cancelar",
      }).then((result) => {
        if (result.isConfirmed) {
          // Si el usuario confirma, llamamos a performLeaveChat
          // El parámetro 'isLastMember' le indica a performLeaveChat si debe solicitar la eliminación del chat.
          performLeaveChat(isLastMember);
        }
      });
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
    showLobbyUI(true);

    const Toast = Swal.mixin({
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
    });
    if (requestDeleteChat) {
      Toast.fire({
        icon: "success",
        title: "Has salido y la sala ha sido eliminada.",
      });
    } else {
      Toast.fire({ icon: "success", title: "Has salido del chat." });
    }
  } else {
    Swal.fire(
      "Error",
      "No se pudo salir del chat. No conectado o sin chat activo.",
      "error"
    );
    State.resetCurrentChatState();
    showLobbyUI(true);
  }
}

document.addEventListener("DOMContentLoaded", initializeApp);
