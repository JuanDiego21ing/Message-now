// server.js
const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8081 }); // Usamos el puerto 8081

console.log("Servidor de señalización iniciado en ws://localhost:8081");

const clients = new Map();

// activeChats ahora almacenará también el nombre de la sala
// { chatId: { creator: 'username', chatName: 'nombre_sala', members: { clientId: 'username', ... } }, ... }
const activeChats = {};

wss.on("connection", (ws) => {
  const clientId = generateUniqueId();
  clients.set(clientId, ws);
  ws.clientId = clientId;

  console.log(
    `Nuevo cliente conectado. ID: ${clientId}. Total de clientes: ${clients.size}`
  );

  ws.send(JSON.stringify({ type: "your_id", clientId: clientId }));

  // Enviar la lista de chats activos al cliente recién conectado
  const chatListToSend = Object.keys(activeChats).map((chatId) => ({
    chatId: chatId,
    creator: activeChats[chatId].creator,
    chatName: activeChats[chatId].chatName, // ¡Nuevo! Incluir el nombre de la sala
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

          // Impedir que un usuario se una si ya está en otro chat.
          // Aunque el cliente ya tiene lógica para esto, el servidor debe ser robusto.
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
          // Después de unirse, notificar a todos los clientes sobre el cambio de miembros en la sala
          // (Esto ya se hace en el bucle de arriba, pero lo dejo aquí para claridad si hubiera otra lógica)
          // Además, enviamos la lista actualizada de chats por si el número de miembros cambió.
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

          // Impedir que un usuario cree un chat si ya está en otro.
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

          // Notificar a todos los clientes sobre el nuevo chat disponible
          sendUpdatedChatListToAllClients();

          // Inmediatamente después de crear el chat, enviar una actualización de miembros al creador
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
          const willDeleteChat = data.deleteChat || false; // Nuevo: indicador para eliminar el chat

          handleUserLeave(ws, leaveChatId, willDeleteChat);
          break;

        case "request_chat_list":
          sendUpdatedChatListToAllClients(ws); // Envía solo a quien lo solicita si se pasa ws
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

    // Cuando un cliente se desconecta, tratamos su salida como una salida de chat normal,
    // pero sin la opción de 'deleteChat' por defecto, solo limpieza si la sala se vacía.
    if (ws.currentChatId) {
      handleUserLeave(ws, ws.currentChatId, false); // No forzamos la eliminación de la sala al desconectar
    }
  });

  ws.on("error", (error) => {
    console.error("Error en la conexión WebSocket con cliente:", error);
    // Podrías intentar cerrar la conexión si no se cierra automáticamente
    // ws.close();
  });
});

function generateUniqueId() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

// Nueva función para manejar la lógica de salida de usuario
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
  delete leavingWs.currentChatId; // Eliminar la referencia del chat en el objeto WebSocket del cliente

  console.log(
    `Usuario ${leavingUsername} (ID: ${leavingClientId}) dejó el chat ${chatId}.`
  );

  const remainingMemberCount = Object.keys(chat.members).length;

  if (remainingMemberCount === 0 && deleteChatExplicitly) {
    // La sala se elimina solo si no quedan miembros Y el último usuario lo solicitó explícitamente.
    console.log(`Chat ${chatId} vacío y solicitud de eliminación, eliminando.`);
    delete activeChats[chatId];
    // Notificar a todos los clientes que el chat ha sido eliminado
    clients.forEach((clientSocket) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(
          JSON.stringify({ type: "chat_removed", chatId: chatId })
        );
      }
    });
  } else if (remainingMemberCount > 0) {
    // Si quedan miembros, enviarles la actualización
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
            members: chat.members, // Enviar la lista actualizada
          })
        );
      }
    }
  } else {
    // Caso: Queda 0 miembros, pero no se solicitó la eliminación explícita.
    // El chat permanece, pero no se notifica a nadie (porque no queda nadie).
    // Si alguien se une después, verá la sala.
    console.log(
      `Chat ${chatId} ahora está vacío pero no se ha solicitado eliminarlo. Permanecerá activo.`
    );
  }

  // Siempre enviar la lista de chats actualizada a todos los clientes después de una salida
  sendUpdatedChatListToAllClients();
}

// Nueva función para enviar la lista de chats a todos los clientes (o a uno específico)
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
