// server.js
const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8081 }); // Usamos el puerto 8081 que te funcionó

console.log("Servidor de señalización iniciado en ws://localhost:8081");

// Almacena todas las conexiones WebSocket activas, mapeadas por un ID de cliente único.
// Esto es crucial para poder dirigir señales a clientes específicos.
// { clientId: ws_object, ... }
const clients = new Map(); // Usamos un Map para asociar IDs con sockets

// Almacena información de los chats activos y sus miembros.
// { chatId: { creator: 'username', members: { clientId: 'username', ... } }, ... }
const activeChats = {};

wss.on("connection", (ws) => {
  // Generar un ID único para cada cliente conectado
  const clientId = generateUniqueId();
  clients.set(clientId, ws);
  ws.clientId = clientId; // Añadir el clientId al objeto ws para fácil referencia

  console.log(
    `Nuevo cliente conectado. ID: ${clientId}. Total de clientes: ${clients.size}`
  );

  // Informar al cliente su propio ID para que pueda identificar sus señales
  ws.send(JSON.stringify({ type: "your_id", clientId: clientId }));

  // Enviar la lista de chats activos al cliente recién conectado
  const chatListToSend = Object.keys(activeChats).map((chatId) => ({
    chatId: chatId,
    creator: activeChats[chatId].creator,
    memberCount: Object.keys(activeChats[chatId].members).length, // Número de miembros
  }));
  ws.send(JSON.stringify({ type: "chat_list", chats: chatListToSend }));

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Mensaje recibido de ${ws.clientId}:`, data.type);

      switch (data.type) {
        case "register_user":
          // Un cliente se registra con su username en un chat específico
          const regChatId = data.chatId;
          const regUsername = data.username;

          if (!activeChats[regChatId]) {
            console.warn(
              `Intento de registrar usuario en chat no existente: ${regChatId}`
            );
            return;
          }

          // Asociar el clientId y username a la sesión del chat
          activeChats[regChatId].members[clientId] = regUsername;
          ws.username = regUsername; // Asociar username al socket
          ws.currentChatId = regChatId; // Asociar chatId al socket

          console.log(
            `Usuario ${regUsername} (ID: ${clientId}) se unió al chat ${regChatId}.`
          );

          // Notificar a TODOS los miembros del chat (incluido el recién unido)
          // quiénes son los otros miembros para que puedan establecer conexiones P2P.
          const chatMembers = activeChats[regChatId].members;
          for (const memberClientId in chatMembers) {
            const memberSocket = clients.get(memberClientId);
            if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
              memberSocket.send(
                JSON.stringify({
                  type: "chat_members_update",
                  chatId: regChatId,
                  members: chatMembers, // Envía todo el mapa de miembros
                })
              );
            }
          }
          break;

        case "create_chat":
          // Cuando un cliente crea un chat (es el primer miembro)
          const newChatId = data.chatId;
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
            members: { [clientId]: creatorUsername }, // El creador es el primer miembro
          };
          ws.username = creatorUsername;
          ws.currentChatId = newChatId;

          console.log(
            `Chat creado. ID: ${newChatId} por ${creatorUsername} (ID: ${clientId})`
          );

          // Notificar a todos los clientes CONECTADOS (no solo los del chat)
          // sobre el nuevo chat disponible en la lista general.
          clients.forEach((clientSocket) => {
            if (clientSocket.readyState === WebSocket.OPEN) {
              clientSocket.send(
                JSON.stringify({
                  type: "new_chat_available",
                  chat: {
                    chatId: newChatId,
                    creator: creatorUsername,
                    memberCount: 1,
                  },
                })
              );
            }
          });
          break;

        case "signal":
          // Reenviar señales (ofertas, respuestas, ICE candidates) entre dos peers específicos
          const senderClientId = ws.clientId;
          const receiverClientId = data.receiverId; // El cliente al que va dirigida la señal
          const signalData = data.signal;

          const receiverSocket = clients.get(receiverClientId);

          if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
            receiverSocket.send(
              JSON.stringify({
                type: "signal",
                senderId: senderClientId,
                signal: signalData,
                chatId: data.chatId, // Asegurarnos de que el chatId se reenvíe
              })
            );
          } else {
            console.warn(
              `Receptor ${receiverClientId} no encontrado o no listo para señal.`
            );
            // Opcional: enviar un mensaje de error al remitente
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Receptor ${receiverClientId} no disponible.`,
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

            // Si no quedan miembros en el chat, eliminar el chat
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
              // Notificar a los miembros restantes sobre la actualización
              const remainingMembers = activeChats[leaveChatId].members;
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
                      members: remainingMembers,
                    })
                  );
                }
              }
            }
          }
          // Limpiar el estado del socket
          delete ws.currentChatId;
          break;
      }
    } catch (e) {
      console.error("Error al parsear mensaje del cliente:", e.message);
    }
  });

  ws.on("close", () => {
    console.log(`Cliente desconectado. ID: ${ws.clientId}`);
    clients.delete(ws.clientId); // Eliminar de la lista global de clientes

    // Lógica para limpiar chats si el cliente desconectado era un miembro
    if (ws.currentChatId && activeChats[ws.currentChatId]) {
      const chat = activeChats[ws.currentChatId];
      if (chat.members[ws.clientId]) {
        delete chat.members[ws.clientId];
        console.log(
          `Miembro ${ws.username} (ID: ${ws.clientId}) se desconectó del chat ${ws.currentChatId}.`
        );

        if (Object.keys(chat.members).length === 0) {
          // Chat vacío, eliminarlo
          console.log(
            `Chat ${ws.currentChatId} vacío debido a desconexión, eliminando.`
          );
          delete activeChats[ws.currentChatId];
          clients.forEach((clientSocket) => {
            // Notificar a todos sobre la eliminación
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
          // Notificar a los miembros restantes sobre la desconexión
          const remainingMembers = chat.members;
          for (const memberClientId in remainingMembers) {
            const memberSocket = clients.get(memberClientId);
            if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
              memberSocket.send(
                JSON.stringify({
                  type: "chat_members_update",
                  chatId: ws.currentChatId,
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

// Función simple para generar IDs únicos
function generateUniqueId() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}
