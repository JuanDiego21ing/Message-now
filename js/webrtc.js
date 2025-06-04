/* global SimplePeer */ // Indica a linters que SimplePeer es una variable global

import * as State from "./state.js";
import {
  displayMessage,
  setStatusMessage,
  updateMembersList,
  // clearStatusMessage, // Esta importación estaba en tu uiHelpers.js, la añado aquí por si createPeer la usa
} from "./uiHelpers.js"; // Asegúrate que clearStatusMessage esté exportada en uiHelpers si la usas

// En la versión de uiHelpers.js que revisamos, clearStatusMessage sí está exportada.
// Sin embargo, en createPeer, el clearStatusMessage() que estaba en peer.on('connect') fue eliminado
// en una versión anterior que te pasé. Si lo necesitas, asegúrate que esté la importación.
// Por ahora, lo comentaré aquí si no se usa explícitamente.

export function createPeer(remoteClientId, remoteUsername, initiator) {
  // remoteClientId aquí es el connId del otro usuario.
  // remoteUsername es el username autenticado del otro usuario.
  console.log(
    `Creando peer con ${remoteUsername} (ID de conexión: ${remoteClientId}). Iniciador: ${initiator}` // Aclarado ID de conexión
  );
  setStatusMessage(`Conectando con ${remoteUsername}...`, "info");

  const peer = new SimplePeer({ initiator: initiator, trickle: false });

  peer.remoteUsername = remoteUsername;
  peer.remoteClientId = remoteClientId; // Almacenamos el connId remoto

  peer.on("signal", (data) => {
    console.log(
      `Enviando señal P2P a ${remoteUsername} (ConnID: ${remoteClientId}). Tipo: ${data.type}`
    );
    const signalingSocket = State.getSignalingSocket();
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
      signalingSocket.send(
        JSON.stringify({
          type: "signal",
          receiverId: remoteClientId, // Este es el connId del destinatario
          senderId: State.getClientId(), // Este es el connId local
          signal: data,
          chatId: State.getCurrentChatId(),
        })
      );
    } else {
      console.error("Signaling socket no disponible para enviar señal P2P");
      setStatusMessage(
        "Error de conexión interna. No se pudo enviar señal.",
        "error"
      );
    }
  });

  peer.on("connect", () => {
    console.log(
      `¡CONECTADO P2P con ${peer.remoteUsername} (ConnID: ${peer.remoteClientId})!`
    );
    displayMessage(
      "Sistema",
      `${peer.remoteUsername} se ha conectado vía P2P.`,
      false
    );
    updateMembersList();
    // clearStatusMessage(); // Si quieres limpiar el "Conectando con...", asegúrate que uiHelpers la exporte y la importes aquí.
    // En la última versión de uiHelpers.js, sí está.
    // Y en la última versión de webrtc.js que te pasé, esta línea SÍ estaba. La restauro.
    if (typeof clearStatusMessage === "function") clearStatusMessage();
    else console.warn("clearStatusMessage no es una función importada");
  });

  peer.on("data", (data) => {
    try {
      const message = JSON.parse(data.toString());
      // El message.sender aquí será el State.getUsername() del emisor en el momento del envío P2P
      if (
        message &&
        typeof message.sender === "string" &&
        typeof message.text === "string"
      ) {
        displayMessage(message.sender, message.text, false);
      } else {
        console.warn("Mensaje P2P recibido en formato inesperado:", message);
      }
    } catch (e) {
      console.error("Error al parsear el mensaje P2P recibido:", e);
      displayMessage(
        "Sistema",
        `Error al recibir mensaje de ${peer.remoteUsername}.`,
        false
      );
    }
  });

  peer.on("close", () => {
    console.log(
      `Conexión P2P con ${peer.remoteUsername} (ConnID: ${peer.remoteClientId}) cerrada.`
    );
    displayMessage(
      "Sistema",
      `${peer.remoteUsername} se ha desconectado P2P.`,
      false
    );
    State.removeActivePeer(peer.remoteClientId); // Usa el connId para eliminar
    updateMembersList();
    console.log(`Peers activos restantes: ${State.getActivePeers().size}`);
  });

  peer.on("error", (err) => {
    console.error(
      `Error del Peer WebRTC con ${peer.remoteUsername} (ConnID: ${peer.remoteClientId}):`,
      err.message || err
    );
    displayMessage(
      "Sistema",
      `Problema de conexión con ${peer.remoteUsername}.`, // Simplificado
      false
    );
    if (
      err.code !== "ERR_CONNECTION_FAILURE" &&
      err.code !== "ERR_ICE_CONNECTION_FAILURE" // Estos errores a veces son manejados por SimplePeer con reintentos
    ) {
      if (peer && !peer.destroyed) peer.destroy();
    }
    State.removeActivePeer(remoteClientId); // Usa connId para eliminar
    updateMembersList();
  });

  State.addActivePeer(remoteClientId, peer); // Usa connId como clave
  return peer;
}

export function handleChatMembersUpdate(newMembers) {
  // newMembers es un objeto { connId1: username1, connId2: username2, ... }
  const myConnId = State.getClientId(); // Mi propio connId
  const currentActivePeers = State.getActivePeers(); // Mapa de { connId: peerObject }

  // Destruir peers para miembros (connId) que ya no están en la lista del servidor
  currentActivePeers.forEach((peerInstance, peerConnId) => {
    if (!newMembers[peerConnId]) {
      console.log(
        `Miembro ${peerInstance.remoteUsername} (ConnID: ${peerConnId}) ya no está en el chat. Cerrando conexión P2P.`
      );
      if (peerInstance && !peerInstance.destroyed) {
        peerInstance.destroy();
      } else {
        State.removeActivePeer(peerConnId);
      }
    }
  });

  // Crear/iniciar conexiones P2P con nuevos miembros
  for (const remoteConnId in newMembers) {
    if (
      remoteConnId !== myConnId && // No conectarse a uno mismo
      !currentActivePeers.has(remoteConnId) // Solo si no tenemos ya un peer activo con este connId
    ) {
      const remoteUsername = newMembers[remoteConnId]; // Username autenticado del miembro remoto
      const initiator = myConnId < remoteConnId; // Determinación del iniciador basada en connIds
      console.log(
        `Necesitamos conectar con ${remoteUsername} (ConnID: ${remoteConnId}). Iniciador: ${initiator}`
      );
      createPeer(remoteConnId, remoteUsername, initiator);
    }
  }
  updateMembersList();
}

export function sendMessageToPeers(messageText) {
  const senderUsername = State.getUsername(); // Username autenticado del remitente
  if (!senderUsername) {
    console.error(
      "sendMessageToPeers: No hay un usuario autenticado para enviar el mensaje."
    );
    setStatusMessage(
      "Error: Debes estar logueado para enviar mensajes.",
      "error"
    );
    return false;
  }
  const messageToSend = JSON.stringify({
    sender: senderUsername,
    text: messageText,
  });
  const currentChatMembers = State.getCurrentChatMembers(); // { connId: username, ... }
  const myConnId = State.getClientId(); // Mi connId
  const activePeers = State.getActivePeers(); // { connId: peerObject, ... }

  let sentToAtLeastOnePeer = false;
  activePeers.forEach((peerInstance) => {
    // peerInstance.remoteClientId es el connId del peer remoto
    if (
      peerInstance.connected &&
      currentChatMembers[peerInstance.remoteClientId]
    ) {
      // Asegurarse que el peer sigue en la lista de miembros del chat
      try {
        peerInstance.send(messageToSend);
        sentToAtLeastOnePeer = true;
      } catch (error) {
        console.error(
          `Error enviando mensaje P2P a ${peerInstance.remoteUsername} (ConnID: ${peerInstance.remoteClientId}):`,
          error
        );
      }
    } else {
      console.warn(
        `Intento de enviar mensaje a peer no conectado o ya no en el chat: ${peerInstance.remoteUsername}`
      );
    }
  });

  if (sentToAtLeastOnePeer) {
    displayMessage(senderUsername, messageText, true);
    return true;
  } else {
    // Si soy el único miembro listado en el chat (según currentChatMembers)
    if (
      Object.keys(currentChatMembers).length === 1 &&
      currentChatMembers[myConnId]
    ) {
      displayMessage(senderUsername, messageText, true);
      setStatusMessage(
        "Eres el único en este chat. El mensaje no se envió a nadie más.",
        "info"
      );
      return true;
    }
    // Si hay otros miembros esperados pero no peers P2P conectados
    if (Object.keys(currentChatMembers).length > 1) {
      setStatusMessage(
        "No hay nadie conectado vía P2P para enviar el mensaje.",
        "warning"
      );
    } else {
      // Si currentChatMembers está vacío o solo yo pero algo falló en la condición anterior
      setStatusMessage(
        "No se pudo enviar el mensaje. Nadie conectado.",
        "error"
      );
    }
    return false;
  }
}
