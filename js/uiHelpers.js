// js/uiHelpers.js
import * as UIElements from "./uiElements.js";
import * as State from "./state.js";

/**
 * Muestra un mensaje en el área de chat principal.
 * Añade clases para estilizar las "burbujas" de chat.
 * @param {string} sender - El nombre del remitente ("Sistema", "Yo", u otro usuario).
 * @param {string} text - El contenido del mensaje.
 * @param {boolean} isMe - True si el mensaje es del usuario actual.
 */
export function displayMessage(sender, text, isMe) {
  if (!UIElements.messagesDiv) return;

  const messageWrapper = document.createElement("div");
  messageWrapper.classList.add("message");

  // Añadir clases para estilizar según el remitente
  if (isMe) {
    messageWrapper.classList.add("me");
  } else if (sender.toLowerCase() === "sistema") {
    messageWrapper.classList.add("system");
  }

  // Sanitizar el texto para evitar inyección de HTML
  const sanitizedText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Usar innerHTML de forma segura con el texto ya sanitizado
  messageWrapper.innerHTML = `<strong>${
    isMe ? "Yo" : sender
  }:</strong> ${sanitizedText}`;

  UIElements.messagesDiv.appendChild(messageWrapper);
  // Hacer scroll automático al último mensaje
  UIElements.messagesDiv.scrollTop = UIElements.messagesDiv.scrollHeight;
}

/**
 * MODIFICADO: Muestra una notificación "toast" no bloqueante usando SweetAlert2.
 * Reemplaza la antigua barra de estado.
 * @param {string} message - El mensaje a mostrar.
 * @param {string} type - El tipo de notificación ('info', 'success', 'warning', 'error').
 */
export function setStatusMessage(message, type = "info") {
  // Swal está disponible globalmente desde el script en index.html
  const Toast = Swal.mixin({
    toast: true,
    position: "top-end", // Aparece en la esquina superior derecha
    showConfirmButton: false,
    timer: 3500, // Duración del toast en milisegundos
    timerProgressBar: true,
    didOpen: (toast) => {
      // Pausar el timer si el mouse está sobre el toast
      toast.addEventListener("mouseenter", Swal.stopTimer);
      toast.addEventListener("mouseleave", Swal.resumeTimer);
    },
  });

  Toast.fire({
    icon: type, // 'success', 'error', 'warning', 'info', 'question'
    title: message,
  });
}

/**
 * OBSOLETO: La función clearStatusMessage ya no es necesaria,
 * ya que los toasts de SweetAlert2 desaparecen automáticamente.
 * La dejamos aquí comentada por si algún archivo la llama, pero debería eliminarse.
 */
export function clearStatusMessage() {
  // console.warn("Llamada a clearStatusMessage() que es obsoleta.");
}

/**
 * MODIFICADO: Actualiza la lista de participantes en la sala de chat.
 * Ahora añade clases de Bootstrap para un mejor estilo.
 */
export function updateMembersList() {
  if (!UIElements.membersList) return;
  UIElements.membersList.innerHTML = "";

  const myConnId = State.getClientId();
  const currentChatMembers = State.getCurrentChatMembers(); // { connId: username }

  for (const memberConnId in currentChatMembers) {
    const memberUsername = currentChatMembers[memberConnId];

    // Crear el elemento de la lista con clases de Bootstrap
    const listItem = document.createElement("li");
    listItem.className =
      "list-group-item d-flex justify-content-between align-items-center";

    // Contenedor para el nombre y la etiqueta "Tú"
    const nameSpan = document.createElement("span");
    nameSpan.textContent = memberUsername;

    if (memberConnId === myConnId) {
      const youBadge = document.createElement("span");
      youBadge.className = "badge bg-primary rounded-pill ms-2";
      youBadge.textContent = "Tú";
      nameSpan.appendChild(youBadge);
    }

    listItem.appendChild(nameSpan);

    // Contenedor para el estado de la conexión P2P
    const peer = State.getActivePeer(memberConnId);
    if (peer && peer.connected) {
      const statusBadge = document.createElement("span");
      statusBadge.className =
        "badge bg-success-subtle text-success-emphasis rounded-pill";
      statusBadge.textContent = "Conectado";
      listItem.appendChild(statusBadge);
    } else if (memberConnId !== myConnId) {
      const statusBadge = document.createElement("span");
      statusBadge.className =
        "badge bg-secondary-subtle text-secondary-emphasis rounded-pill";
      statusBadge.textContent = "Estableciendo...";
      listItem.appendChild(statusBadge);
    }

    UIElements.membersList.appendChild(listItem);
  }
}

/**
 * MODIFICADO: Muestra la interfaz de chat, ocultando el lobby.
 * Se han limpiado referencias a elementos obsoletos.
 */
export function showChatUI() {
  if (UIElements.mainAppAreaDiv)
    UIElements.mainAppAreaDiv.style.display = "block";
  if (document.getElementById("lobby-area"))
    document.getElementById("lobby-area").style.display = "none";

  UIElements.chatAreaDiv.style.display = "block";

  const chatName = State.getCurrentChatName();
  const chatId = State.getCurrentChatId();
  const roomNameDisplay =
    chatName || (chatId ? `ID: ${chatId.substring(0, 8)}...` : "Chat");

  if (UIElements.chatAreaTitle) {
    UIElements.chatAreaTitle.textContent = `Chat: ${roomNameDisplay}`;
  }
  updateMembersList();
}

/**
 * MODIFICADO: Muestra la interfaz del lobby, ocultando el chat.
 * Se han limpiado referencias a elementos obsoletos.
 */
export function showLobbyUI(doRequestChatList = true) {
  if (UIElements.mainAppAreaDiv)
    UIElements.mainAppAreaDiv.style.display = "block";
  if (document.getElementById("lobby-area"))
    document.getElementById("lobby-area").style.display = "block";

  UIElements.chatAreaDiv.style.display = "none";

  UIElements.messagesDiv.innerHTML = "";
  UIElements.messageInput.value = "";
  UIElements.membersList.innerHTML = "";

  const signalingSocket = State.getSignalingSocket();
  if (
    doRequestChatList &&
    signalingSocket &&
    signalingSocket.readyState === WebSocket.OPEN
  ) {
    console.log(
      "UIHELPERS (showLobbyUI): Solicitando explícitamente chat_list"
    );
    signalingSocket.send(JSON.stringify({ type: "request_chat_list" }));
  }

  // Ya no usamos setStatusMessage para esto, app.js puede manejarlo si es necesario.
  // setStatusMessage("Bienvenido al lobby. Crea o únete a un chat.", "info");
}

/**
 * OBSOLETO: Esta función ya no debería ser necesaria. La lógica de inicialización
 * en app.js (showAuthUI vs showMainAppUI) se encarga de la vista inicial.
 */
export function hideInitialUI() {
  console.warn(
    "Llamada a hideInitialUI() que es obsoleta. Considerar eliminar la llamada desde donde se origine."
  );
}
