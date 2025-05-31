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

          activeChats[regChatId].members[clientId] = regUsername;
          ws.username = regUsername;
          ws.currentChatId = regChatId;

          console.log(
            `Usuario ${regUsername} (ID: ${clientId}) se unió al chat ${regChatId}.`
          );

          const chatMembers = activeChats[regChatId].members;
          const chatName = activeChats[regChatId].chatName; // Obtener el nombre de la sala
          for (const memberClientId in chatMembers) {
            const memberSocket = clients.get(memberClientId);
            if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
              memberSocket.send(
                JSON.stringify({
                  type: "chat_members_update",
                  chatId: regChatId,
                  chatName: chatName, // ¡Nuevo! Enviar el nombre de la sala en la actualización
                  members: chatMembers,
                })
              );
            }
          }
          break;

        case "create_chat":
          const newChatId = data.chatId;
          const newChatName = data.chatName; // ¡Nuevo! Obtener el nombre de la sala
          const creatorUsername = data.username;

          if (activeChats[newChatId]) {
            console.warn(`Intento de crear chat existente: ${newChatId}`);
            ws.send(
              JSON.stringify({ type: "error", message: "Chat ya existe." })
            );
            return;
          }

          activeChats[newChatId] = {
            creator: creatorUsername,
            chatName: newChatName, // ¡Nuevo! Almacenar el nombre de la sala
            members: { [clientId]: creatorUsername },
          };
          ws.username = creatorUsername;
          ws.currentChatId = newChatId;

          console.log(
            `Chat creado. ID: ${newChatId}, Nombre: ${newChatName} por ${creatorUsername} (ID: ${clientId})`
          );

          clients.forEach((clientSocket) => {
            if (clientSocket.readyState === WebSocket.OPEN) {
              clientSocket.send(
                JSON.stringify({
                  type: "new_chat_available",
                  chat: {
                    chatId: newChatId,
                    chatName: newChatName, // ¡Nuevo! Incluir el nombre de la sala
                    creator: creatorUsername,
                    memberCount: 1,
                  },
                })
              );
            }
          });

          // Inmediatamente después de crear el chat, enviar una actualización de miembros al creador
          ws.send(
            JSON.stringify({
              type: "chat_members_update",
              chatId: newChatId,
              chatName: newChatName, // ¡Nuevo!
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
          if (
            leaveChatId &&
            activeChats[leaveChatId] &&
            activeChats[leaveChatId].members[clientId]
          ) {
            delete activeChats[leaveChatId].members[clientId];
            console.log(
              `Usuario ${ws.username} (ID: ${clientId}) dejó el chat ${leaveChatId}.`
            );

            delete ws.currentChatId;

            if (Object.keys(activeChats[leaveChatId].members).length === 0) {
              console.log(`Chat ${leaveChatId} vacío, eliminando.`);
              delete activeChats[leaveChatId];
              clients.forEach((clientSocket) => {
                if (clientSocket.readyState === WebSocket.OPEN) {
                  clientSocket.send(
                    JSON.stringify({
                      type: "chat_removed",
                      chatId: leaveChatId,
                    })
                  );
                }
              });
            } else {
              const remainingMembers = activeChats[leaveChatId].members;
              const chatName = activeChats[leaveChatId].chatName; // Obtener el nombre de la sala
              for (const memberClientId in remainingMembers) {
                const memberSocket = clients.get(memberClientId);
                if (
                  memberSocket &&
                  memberSocket.readyState === WebSocket.OPEN
                ) {
                  memberSocket.send(
                    JSON.stringify({
                      type: "chat_members_update",
                      chatId: leaveChatId,
                      chatName: chatName, // ¡Nuevo!
                      members: remainingMembers,
                    })
                  );
                }
              }
            }
          } else {
            console.warn(
              `Intento de salir de chat no existente o no se era miembro: ${leaveChatId} por ${clientId}`
            );
          }
          break;

        case "request_chat_list":
          const currentChatList = Object.keys(activeChats).map((chatId) => ({
            chatId: chatId,
            creator: activeChats[chatId].creator,
            chatName: activeChats[chatId].chatName, // ¡Nuevo!
            memberCount: Object.keys(activeChats[chatId].members).length,
          }));
          ws.send(
            JSON.stringify({ type: "chat_list", chats: currentChatList })
          );
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

    if (ws.currentChatId && activeChats[ws.currentChatId]) {
      const chat = activeChats[ws.currentChatId];
      if (chat.members[ws.clientId]) {
        delete chat.members[ws.clientId];
        console.log(
          `Miembro ${ws.username || ws.clientId} se desconectó del chat ${
            ws.currentChatId
          }.`
        );

        if (Object.keys(chat.members).length === 0) {
          console.log(
            `Chat ${ws.currentChatId} vacío debido a desconexión, eliminando.`
          );
          delete activeChats[ws.currentChatId];
          clients.forEach((clientSocket) => {
            if (clientSocket.readyState === WebSocket.OPEN) {
              clientSocket.send(
                JSON.stringify({
                  type: "chat_removed",
                  chatId: ws.currentChatId,
                })
              );
            }
          });
        } else {
          const remainingMembers = chat.members;
          const chatName = chat.chatName; // Obtener el nombre de la sala
          for (const memberClientId in remainingMembers) {
            const memberSocket = clients.get(memberClientId);
            if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
              memberSocket.send(
                JSON.stringify({
                  type: "chat_members_update",
                  chatId: ws.currentChatId,
                  chatName: chatName, // ¡Nuevo!
                  members: remainingMembers,
                })
              );
            }
          }
        }
      }
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
