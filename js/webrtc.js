/* global SimplePeer */ // Indica a linters que SimplePeer es una variable global

import * as State from "./state.js";
import {
  displayMessage,
  setStatusMessage,
  updateMembersList,
} from "./uiHelpers.js";

export function createPeer(remoteClientId, remoteUsername, initiator) {
  console.log(
    `Creando peer con ${remoteUsername} (ID: ${remoteClientId}). Iniciador: ${initiator}`
  );
  setStatusMessage(`Conectando con ${remoteUsername}...`, "info");

  const peer = new SimplePeer({ initiator: initiator, trickle: false });

  peer.remoteUsername = remoteUsername;
  peer.remoteClientId = remoteClientId; // Almacenamos para referencia

  peer.on("signal", (data) => {
    console.log(
      `Enviando señal P2P a ${remoteUsername} (ID: ${remoteClientId}). Tipo: ${data.type}`
    );
    const signalingSocket = State.getSignalingSocket();
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
      signalingSocket.send(
        JSON.stringify({
          type: "signal",
          receiverId: remoteClientId,
          senderId: State.getClientId(), // El servidor usará su ws.clientId, pero esto es para info
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
      `¡CONECTADO P2P con ${peer.remoteUsername} (ID: ${peer.remoteClientId})!`
    );
    displayMessage(
      "Sistema",
      `${peer.remoteUsername} se ha conectado vía P2P.`,
      false
    );
    updateMembersList(); // Actualiza para mostrar estado "Conectado"
    clearStatusMessage(); // Limpia "Conectando con X..."
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
      `Conexión P2P con ${peer.remoteUsername} (ID: ${peer.remoteClientId}) cerrada.`
    );
    displayMessage(
      "Sistema",
      `${peer.remoteUsername} se ha desconectado P2P.`,
      false
    );
    State.removeActivePeer(peer.remoteClientId);
    updateMembersList(); // Actualizar la lista de miembros
    console.log(`Peers activos restantes: ${State.getActivePeers().size}`);
  });

  peer.on("error", (err) => {
    console.error(
      `Error del Peer WebRTC con ${peer.remoteUsername} (ID: ${peer.remoteClientId}):`,
      err.message || err
    );
    // setStatusMessage(`Error de conexión P2P con ${peer.remoteUsername}: ${err.message || err.code}.`, "error");
    // El mensaje anterior puede ser muy técnico.
    displayMessage(
      "Sistema",
      `Problema de conexión con ${peer.remoteUsername}. Intentando reconectar si es necesario.`,
      false
    );

    // No destruir el peer inmediatamente aquí si SimplePeer intenta reconectar.
    // Pero si el error es fatal, sí. Para 'iceConnectionFailed', SimplePeer puede intentar reconectar.
    // Si el error es por ejemplo 'err-negotiation', sí podría ser necesario destruir.
    if (
      err.code !== "ERR_CONNECTION_FAILURE" &&
      err.code !== "ERR_ICE_CONNECTION_FAILURE"
    ) {
      if (peer && !peer.destroyed) peer.destroy();
    }
    State.removeActivePeer(remoteClientId); // Asegurarse de quitarlo del mapa si se destruye
    updateMembersList();
  });

  State.addActivePeer(remoteClientId, peer);
  return peer;
}

export function handleChatMembersUpdate(newMembers) {
  const myClientId = State.getClientId();
  const currentActivePeers = State.getActivePeers();

  // Destruir peers para miembros que ya no están en la lista del servidor
  currentActivePeers.forEach((peerInstance, peerClientId) => {
    if (!newMembers[peerClientId]) {
      // Si el peer activo ya no está en la lista de miembros del chat
      console.log(
        `Miembro ${peerInstance.remoteUsername} (ID: ${peerClientId}) ya no está en el chat (según servidor). Cerrando conexión P2P.`
      );
      if (peerInstance && !peerInstance.destroyed) {
        peerInstance.destroy(); // Esto activará el 'close' y lo eliminará de activePeers
      } else {
        State.removeActivePeer(peerClientId); // Si ya estaba destruido, solo quitarlo del mapa
      }
    }
  });

  // Crear/iniciar conexiones P2P con nuevos miembros
  for (const remoteClientId in newMembers) {
    if (
      remoteClientId !== myClientId &&
      !currentActivePeers.has(remoteClientId)
    ) {
      const remoteUsername = newMembers[remoteClientId];
      // Determinar quién es el iniciador de forma consistente (evita glare)
      const initiator = myClientId < remoteClientId;
      console.log(
        `Necesitamos conectar con ${remoteUsername} (ID: ${remoteClientId}). Iniciador: ${initiator}`
      );
      createPeer(remoteClientId, remoteUsername, initiator);
    }
  }
  updateMembersList(); // Actualizar la lista de miembros en la UI con los nuevos estados
}

export function sendMessageToPeers(messageText) {
  const sender = State.getUsername() || "Anónimo";
  const messageToSend = JSON.stringify({ sender: sender, text: messageText });
  const currentChatMembers = State.getCurrentChatMembers();
  const myClientId = State.getClientId();
  const activePeers = State.getActivePeers();

  let sentToAtLeastOnePeer = false;
  activePeers.forEach((peerInstance) => {
    if (peerInstance.connected) {
      try {
        peerInstance.send(messageToSend);
        sentToAtLeastOnePeer = true;
      } catch (error) {
        console.error(
          `Error enviando mensaje P2P a ${peerInstance.remoteUsername}:`,
          error
        );
        // setStatusMessage(`Error enviando mensaje a ${peerInstance.remoteUsername}.`, "error");
      }
    } else {
      console.warn(
        `Intento de enviar mensaje a peer no conectado: ${peerInstance.remoteUsername}`
      );
    }
  });

  if (sentToAtLeastOnePeer) {
    displayMessage(sender, messageText, true); // Muestra tu propio mensaje
    return true;
  } else {
    // Si no hay peers conectados pero eres el único en el chat (según el estado), aún muestra tu mensaje
    if (
      Object.keys(currentChatMembers).length === 1 &&
      currentChatMembers[myClientId]
    ) {
      displayMessage(sender, messageText, true); // Muestra localmente
      setStatusMessage(
        "Eres el único en este chat. El mensaje no se envió a nadie más.",
        "info"
      );
      return true; // Consideramos que el mensaje se "envió" localmente
    }
    // Si hay otros miembros esperados pero no peers conectados
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
