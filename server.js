// server.js
const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8081 });

console.log("Servidor de señalización iniciado en ws://localhost:8081");

const clients = new Map();

const activeChats = {};

wss.on("connection", (ws) => {
  const clientId = generateUniqueId();
  clients.set(clientId, ws);
  ws.clientId = clientId;

  console.log(
    `Nuevo cliente conectado. ID: ${clientId}. Total de clientes: ${clients.size}`
  );

  ws.send(JSON.stringify({ type: "your_id", clientId: clientId }));

  const chatListToSend = Object.keys(activeChats).map((chatId) => ({
    chatId: chatId,
    creator: activeChats[chatId].creator,
    chatName: activeChats[chatId].chatName,
    memberCount: Object.keys(activeChats[chatId].members).length,
  }));
  ws.send(JSON.stringify({ type: "chat_list", chats: chatListToSend }));

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Mensaje recibido de ${ws.clientId}:`, data.type);

      switch (data.type) {
        case "register_user":
          const regChatId = data.chatId;
          const regUsername = data.username;

          if (!activeChats[regChatId]) {
            console.warn(
              `Intento de registrar usuario en chat no existente: ${regChatId}`
            );
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Chat con ID ${regChatId} no encontrado.`,
              })
            );
            return;
          }

          if (ws.currentChatId && ws.currentChatId !== regChatId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Ya estás en otro chat. Sal de él primero.",
              })
            );
            return;
          }

          activeChats[regChatId].members[clientId] = regUsername;
          ws.username = regUsername;
          ws.currentChatId = regChatId;

          console.log(
            `Usuario ${regUsername} (ID: ${clientId}) se unió al chat ${regChatId}.`
          );

          const chatMembers = activeChats[regChatId].members;
          const chatName = activeChats[regChatId].chatName;
          for (const memberClientId in chatMembers) {
            const memberSocket = clients.get(memberClientId);
            if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
              memberSocket.send(
                JSON.stringify({
                  type: "chat_members_update",
                  chatId: regChatId,
                  chatName: chatName,
                  members: chatMembers,
                })
              );
            }
          }

          sendUpdatedChatListToAllClients();
          break;

        case "create_chat":
          const newChatId = data.chatId;
          const newChatName = data.chatName;
          const creatorUsername = data.username;

          if (activeChats[newChatId]) {
            console.warn(`Intento de crear chat existente: ${newChatId}`);
            ws.send(
              JSON.stringify({ type: "error", message: "Chat ya existe." })
            );
            return;
          }

          if (ws.currentChatId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message:
                  "Ya estás en un chat. Sal de él primero para crear uno nuevo.",
              })
            );
            return;
          }

          activeChats[newChatId] = {
            creator: creatorUsername,
            chatName: newChatName,
            members: { [clientId]: creatorUsername },
          };
          ws.username = creatorUsername;
          ws.currentChatId = newChatId;

          console.log(
            `Chat creado. ID: ${newChatId}, Nombre: "${newChatName}" por ${creatorUsername} (ID: ${clientId})`
          );

          sendUpdatedChatListToAllClients();

          ws.send(
            JSON.stringify({
              type: "chat_members_update",
              chatId: newChatId,
              chatName: newChatName,
              members: activeChats[newChatId].members,
            })
          );
          break;

        case "signal":
          const senderClientId = ws.clientId;
          const receiverClientId = data.receiverId;
          const signalData = data.signal;

          const receiverSocket = clients.get(receiverClientId);

          if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
            receiverSocket.send(
              JSON.stringify({
                type: "signal",
                senderId: senderClientId,
                signal: signalData,
                chatId: data.chatId,
              })
            );
          } else {
            console.warn(
              `Receptor ${receiverClientId} no encontrado o no listo para señal.`
            );
            ws.send(
              JSON.stringify({
                type: "error",
                message: `El destinatario de la señal ${receiverClientId} no está disponible.`,
              })
            );
          }
          break;

        case "leave_chat":
          const leaveChatId = data.chatId || ws.currentChatId;
          const willDeleteChat = data.deleteChat || false;

          handleUserLeave(ws, leaveChatId, willDeleteChat);
          break;

        case "request_chat_list":
          sendUpdatedChatListToAllClients(ws);
          break;

        default:
          console.warn(`Tipo de mensaje desconocido: ${data.type}`);
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Tipo de mensaje desconocido: ${data.type}`,
            })
          );
          break;
      }
    } catch (e) {
      console.error("Error al parsear mensaje del cliente:", e.message);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Formato de mensaje JSON inválido.",
        })
      );
    }
  });

  ws.on("close", () => {
    console.log(`Cliente desconectado. ID: ${ws.clientId}`);
    clients.delete(ws.clientId);

    if (ws.currentChatId) {
      handleUserLeave(ws, ws.currentChatId, false);
    }
  });

  ws.on("error", (error) => {
    console.error("Error en la conexión WebSocket con cliente:", error);
  });
});

function generateUniqueId() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

function handleUserLeave(leavingWs, chatId, deleteChatExplicitly) {
  if (
    !chatId ||
    !activeChats[chatId] ||
    !activeChats[chatId].members[leavingWs.clientId]
  ) {
    console.warn(
      `Intento de salir de chat no existente o no se era miembro: ${chatId} por ${leavingWs.clientId}`
    );
    return;
  }

  const chat = activeChats[chatId];
  const leavingUsername = leavingWs.username;
  const leavingClientId = leavingWs.clientId;

  delete chat.members[leavingClientId];
  delete leavingWs.currentChatId;

  console.log(
    `Usuario ${leavingUsername} (ID: ${leavingClientId}) dejó el chat ${chatId}.`
  );

  const remainingMemberCount = Object.keys(chat.members).length;

  if (remainingMemberCount === 0 && deleteChatExplicitly) {
    console.log(`Chat ${chatId} vacío y solicitud de eliminación, eliminando.`);
    delete activeChats[chatId];

    clients.forEach((clientSocket) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(
          JSON.stringify({ type: "chat_removed", chatId: chatId })
        );
      }
    });
  } else if (remainingMemberCount > 0) {
    console.log(
      `Chat ${chatId} tiene ${remainingMemberCount} miembros restantes. Actualizando...`
    );
    const chatName = chat.chatName;
    for (const memberClientId in chat.members) {
      const memberSocket = clients.get(memberClientId);
      if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
        memberSocket.send(
          JSON.stringify({
            type: "chat_members_update",
            chatId: chatId,
            chatName: chatName,
            members: chat.members,
          })
        );
      }
    }
  } else {
    console.log(
      `Chat ${chatId} ahora está vacío pero no se ha solicitado eliminarlo. Permanecerá activo.`
    );
  }

  sendUpdatedChatListToAllClients();
}

function sendUpdatedChatListToAllClients(targetWs = null) {
  const chatListToSend = Object.keys(activeChats).map((chatId) => ({
    chatId: chatId,
    creator: activeChats[chatId].creator,
    chatName: activeChats[chatId].chatName,
    memberCount: Object.keys(activeChats[chatId].members).length,
  }));

  if (targetWs) {
    targetWs.send(JSON.stringify({ type: "chat_list", chats: chatListToSend }));
  } else {
    clients.forEach((clientSocket) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(
          JSON.stringify({ type: "chat_list", chats: chatListToSend })
        );
      }
    });
  }
}
