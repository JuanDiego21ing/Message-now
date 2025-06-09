/* global SimplePeer */

import * as State from "./state.js";
import {
  displayMessage,
  setStatusMessage,
  updateMembersList,
  clearStatusMessage, // Lo importamos para limpiar el toast de "Conectando..." si es necesario
} from "./uiHelpers.js";

export function createPeer(remoteConnId, remoteUsername, initiator) {
  console.log(
    `Creando peer con ${remoteUsername} (ID de conexión: ${remoteConnId}). Iniciador: ${initiator}`
  );
  // Esta llamada ahora mostrará un "toast" de SweetAlert2, lo cual es ideal.
  setStatusMessage(`Conectando con ${remoteUsername}...`, "info");

  const peer = new SimplePeer({ initiator: initiator, trickle: false });

  peer.remoteUsername = remoteUsername;
  peer.remoteClientId = remoteConnId; // Almacenamos el connId del peer remoto

  peer.on("signal", (data) => {
    console.log(
      `Enviando señal P2P a ${remoteUsername} (ConnID: ${remoteConnId}). Tipo: ${data.type}`
    );
    const signalingSocket = State.getSignalingSocket();
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
      signalingSocket.send(
        JSON.stringify({
          type: "signal",
          receiverId: remoteConnId, // connId del destinatario
          senderId: State.getClientId(), // connId local
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
    updateMembersList(); // Actualiza para mostrar estado "Conectado"

    // El toast "Conectando con..." desaparecerá solo, por lo que no es estrictamente
    // necesario limpiar nada. Podemos mostrar un toast de éxito si queremos.
    setStatusMessage(
      `Conexión P2P con ${peer.remoteUsername} establecida.`,
      "success"
    );
  });

  peer.on("data", (data) => {
    try {
      const message = JSON.parse(data.toString());
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
    State.removeActivePeer(peer.remoteClientId);
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
      `Problema de conexión P2P con ${peer.remoteUsername}.`,
      false
    );

    if (
      err.code !== "ERR_CONNECTION_FAILURE" &&
      err.code !== "ERR_ICE_CONNECTION_FAILURE"
    ) {
      if (peer && !peer.destroyed) peer.destroy();
    }
    State.removeActivePeer(remoteConnId);
    updateMembersList();
  });

  State.addActivePeer(remoteConnId, peer);
  return peer;
}

export function handleChatMembersUpdate(newMembers) {
  const myConnId = State.getClientId();
  const currentActivePeers = State.getActivePeers();

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
    if (remoteConnId !== myConnId && !currentActivePeers.has(remoteConnId)) {
      const remoteUsername = newMembers[remoteConnId];
      const initiator = myConnId < remoteConnId;
      console.log(
        `Necesitamos conectar con ${remoteUsername} (ConnID: ${remoteConnId}). Iniciador: ${initiator}`
      );
      createPeer(remoteConnId, remoteUsername, initiator);
    }
  }
  updateMembersList();
}

export function sendMessageToPeers(messageText) {
  const senderUsername = State.getUsername();
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
  const currentChatMembers = State.getCurrentChatMembers();
  const myConnId = State.getClientId();
  const activePeers = State.getActivePeers();

  let sentToAtLeastOnePeer = false;
  activePeers.forEach((peerInstance) => {
    if (
      peerInstance.connected &&
      currentChatMembers[peerInstance.remoteClientId]
    ) {
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
    if (
      Object.keys(currentChatMembers).length === 1 &&
      currentChatMembers[myConnId]
    ) {
      displayMessage(senderUsername, messageText, true);
      setStatusMessage(
        "Eres el único en este chat. Tu mensaje fue enviado a nadie más.",
        "info"
      );
      return true;
    }
    if (Object.keys(currentChatMembers).length > 1) {
      setStatusMessage(
        "No hay nadie conectado vía P2P para enviar el mensaje.",
        "warning"
      );
    } else {
      setStatusMessage(
        "No se pudo enviar el mensaje. Nadie conectado.",
        "error"
      );
    }
    return false;
  }
}
