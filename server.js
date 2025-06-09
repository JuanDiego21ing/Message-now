// server.js
const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path"); 

// --- CONFIGURACIÓN ---
const PORT = process.env.PORT || 8081;
const JWT_SECRET = "tu_secreto_jwt_super_seguro_y_largo_aqui"; 
const SALT_ROUNDS = 10;


const app = express();


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- SERVIR ARCHIVOS ESTÁTICOS DEL CLIENTE ---
// Esto sirve los archivos (index.html, styles.css, carpeta js/) desde el mismo
// directorio donde se encuentra este server.js.
app.use(express.static(path.join(__dirname))); // Sirve archivos de la carpeta actual
// Ruta principal para servir index.html cuando alguien accede a la raíz (ej. http://192.168.1.109:8081/)
app.get("/", (req, res) => {
  console.log(">>> Solicitud GET a / : Sirviendo index.html");
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- CONFIGURACIÓN DEL POOL DE CONEXIÓN A POSTGRESQL ---
const pool = new Pool({
  user: "postgres",
  host: "localhost", 
  database: "chat_app",
  password: "postgres", 
  port: 5432,
});

pool.on("connect", () => {
  console.log(
    "Conectado exitosamente a la base de datos PostgreSQL (chat_app)"
  );
});
pool.on("error", (err) => {
  console.error("Error inesperado en el cliente del pool de PostgreSQL", err);
  process.exit(-1);
});

// --- RUTAS HTTP PARA AUTENTICACIÓN ---
app.post("/register", async (req, res) => {
  console.log(">>> Solicitud POST a /register recibida. Cuerpo:", req.body);
  const { username, password } = req.body;

  if (!username || !password) {
    console.log(">>> /register: Faltan username o password.");
    return res.status(400).json({
      message: "El nombre de usuario y la contraseña son obligatorios.",
    });
  }
  if (password.length < 6) {
    console.log(">>> /register: Contraseña muy corta.");
    return res
      .status(400)
      .json({ message: "La contraseña debe tener al menos 6 caracteres." });
  }

  try {
    console.log(
      `>>> /register: Verificando si el usuario '${username}' existe...`
    );
    const userCheck = await pool.query(
      "SELECT username FROM users WHERE username = $1",
      [username]
    );
    if (userCheck.rows.length > 0) {
      console.log(`>>> /register: Usuario '${username}' ya existe.`);
      return res.status(409).json({
        message: "El nombre de usuario ya está en uso. Por favor, elige otro.",
      });
    }

    console.log(`>>> /register: Hasheando contraseña para '${username}'...`);
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    const hashedPassword = await bcrypt.hash(password, salt);

    console.log(`>>> /register: Insertando usuario '${username}' en la BD...`);
    const newUserResult = await pool.query(
      "INSERT INTO users (username, hashed_password, salt) VALUES ($1, $2, $3) RETURNING user_id, username, created_at",
      [username, hashedPassword, salt]
    );

    const registeredUser = newUserResult.rows[0];
    console.log(
      `>>> /register: Usuario registrado exitosamente: ${registeredUser.username} (DB UserID: ${registeredUser.user_id})`
    );
    res.status(201).json({
      message: "Usuario registrado exitosamente.",
      user: {
        user_id: registeredUser.user_id,
        username: registeredUser.username,
        created_at: registeredUser.created_at,
      },
    });
  } catch (err) {
    console.error(
      ">>> /register: Error durante el registro:",
      err.stack || err.message || err
    );
    res.status(500).json({
      message: "Error interno del servidor al intentar registrar el usuario.",
    });
  }
});

app.post("/login", async (req, res) => {
  console.log(">>> Solicitud POST a /login recibida. Cuerpo:", req.body);
  const { username, password } = req.body;

  if (!username || !password) {
    console.log(">>> /login: Faltan username o password.");
    return res.status(400).json({
      message: "El nombre de usuario y la contraseña son obligatorios.",
    });
  }

  try {
    console.log(`>>> /login: Buscando usuario '${username}' en la BD...`);
    const result = await pool.query(
      "SELECT user_id, username, hashed_password, salt FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      console.log(`>>> /login: Usuario '${username}' no encontrado.`);
      return res.status(401).json({ message: "Credenciales inválidas." });
    }

    const user = result.rows[0];
    console.log(`>>> /login: Verificando contraseña para '${username}'...`);
    const isValidPassword = await bcrypt.compare(
      password,
      user.hashed_password
    );

    if (!isValidPassword) {
      console.log(`>>> /login: Contraseña inválida para '${username}'.`);
      return res.status(401).json({ message: "Credenciales inválidas." });
    }

    console.log(`>>> /login: Generando token JWT para '${username}'...`);
    const tokenPayload = {
      userId: user.user_id,
      username: user.username,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "1h" });

    console.log(
      `>>> /login: Usuario logueado exitosamente: ${user.username} (DB UserID: ${user.user_id})`
    );
    res.json({
      message: "Inicio de sesión exitoso.",
      token: token,
      username: user.username,
      userId: user.user_id,
    });
  } catch (err) {
    console.error(
      ">>> /login: Error durante el inicio de sesión:",
      err.stack || err.message || err
    );
    res.status(500).json({
      message: "Error interno del servidor al intentar iniciar sesión.",
    });
  }
});

// --- CONFIGURACIÓN DEL SERVIDOR HTTP Y WEBSOCKET ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();
const activeChats = {};

function generateUniqueId() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

// ----- LÓGICA DE WEBSOCKET -----
wss.on("connection", (ws, req) => {
  console.log(">>> Nueva conexión WebSocket entrante...");
  const urlParams = new URLSearchParams(req.url.split("?")[1]);
  const token = urlParams.get("token");
  let authenticatedUser = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      authenticatedUser = {
        userId: decoded.userId,
        username: decoded.username,
      };
      ws.userId = decoded.userId;
      ws.username = decoded.username;
      console.log(
        `>>> WebSocket: Cliente autenticado con token: ${ws.username} (UserID: ${ws.userId})`
      );
    } catch (err) {
      console.warn(
        ">>> WebSocket: Token JWT inválido o expirado. Mensaje:",
        err.message
      );
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Autenticación fallida: Token inválido o expirado.",
        })
      );
      ws.terminate();
      return;
    }
  } else {
    console.warn(
      ">>> WebSocket: Intento de conexión sin token. Cerrando conexión."
    );
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Autenticación requerida para conexión WebSocket.",
      })
    );
    ws.terminate();
    return;
  }

  const connId = generateUniqueId();
  clients.set(connId, ws);
  ws.connId = connId;

  console.log(
    `>>> WebSocket: Nuevo cliente conectado y autenticado: ${ws.username}. ConnID: ${ws.connId}. Total: ${clients.size}`
  );
  ws.send(
    JSON.stringify({
      type: "your_id",
      clientId: ws.connId, // Este es el connId que el cliente usa para identificarse en algunos mensajes P2P
      username: ws.username,
    })
  );

  sendUpdatedChatListToClient(ws);

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message);
      console.log(
        `>>> WebSocket: Mensaje recibido de ${ws.username} (ConnID: ${ws.connId}):`,
        data.type
      );
    } catch (e) {
      console.error(
        `>>> WebSocket: Error al parsear mensaje de ${ws.username} (ConnID: ${ws.connId}):`,
        e.message,
        message.toString().substring(0, 100)
      );
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Formato de mensaje JSON inválido.",
        })
      );
      return;
    }

    const currentAuthenticatedUsername = ws.username;

    switch (data.type) {
      case "register_user": // Unirse a un chat
        const regChatId = data.chatId;
        const regUsername = currentAuthenticatedUsername;

        if (!activeChats[regChatId]) {
          console.log(
            `>>> WebSocket /register_user: Chat ${regChatId} no encontrado para ${ws.username}.`
          );
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Chat con ID ${regChatId} no encontrado.`,
              kickToLobby: true,
            })
          );
          return;
        }
        if (ws.currentChatId && ws.currentChatId !== regChatId) {
          console.log(
            `>>> WebSocket /register_user: ${ws.username} ya está en el chat ${ws.currentChatId}, no puede unirse a ${regChatId}.`
          );
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Ya estás en otro chat. Sal de él primero.",
            })
          );
          return;
        }

        activeChats[regChatId].members[ws.connId] = regUsername;
        ws.currentChatId = regChatId;

        console.log(
          `>>> WebSocket /register_user: Usuario ${regUsername} (ConnID: ${ws.connId}) se unió al chat ${regChatId} ("${activeChats[regChatId].chatName}").`
        );
        broadcastChatMembersUpdate(regChatId);
        sendUpdatedChatListToAllClients();
        break;

      case "create_chat":
        const newChatId = data.chatId;
        const newChatName = data.chatName;
        const creatorUsername = currentAuthenticatedUsername;

        if (activeChats[newChatId]) {
          console.log(
            `>>> WebSocket /create_chat: Intento de crear chat existente ${newChatId} por ${ws.username}.`
          );
          ws.send(
            JSON.stringify({ type: "error", message: "ID de Chat ya existe." })
          );
          return;
        }
        if (ws.currentChatId) {
          console.log(
            `>>> WebSocket /create_chat: ${ws.username} ya está en un chat, no puede crear ${newChatName}.`
          );
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Ya estás en un chat. Sal primero.",
            })
          );
          return;
        }

        activeChats[newChatId] = {
          creator: creatorUsername,
          creatorUserId: ws.userId,
          chatName: newChatName,
          members: { [ws.connId]: creatorUsername },
        };
        ws.currentChatId = newChatId;

        console.log(
          `>>> WebSocket /create_chat: Chat creado: "${newChatName}" (ID: ${newChatId}) por ${creatorUsername} (UserID: ${ws.userId}, ConnID: ${ws.connId})`
        );
        ws.send(
          JSON.stringify({
            type: "chat_members_update",
            chatId: newChatId,
            chatName: newChatName,
            members: activeChats[newChatId].members,
          })
        );
        sendUpdatedChatListToAllClients();
        break;

      case "signal":
        const senderConnId = ws.connId;
        const receiverConnId = data.receiverId;
        const signalData = data.signal;
        const signalChatId = data.chatId;

        console.log(
          `>>> WebSocket /signal: ${ws.username} (ConnID: ${senderConnId}) enviando señal a ${receiverConnId} para chat ${signalChatId}`
        );
        if (ws.currentChatId !== signalChatId) {
          console.warn(
            `>>> WebSocket /signal: Cliente ${ws.username} intentó enviar señal para chat incorrecto.`
          );
          return;
        }
        const receiverSocket = clients.get(receiverConnId);
        if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
          if (receiverSocket.currentChatId === signalChatId) {
            receiverSocket.send(
              JSON.stringify({
                type: "signal",
                senderId: senderConnId,
                signal: signalData,
                chatId: signalChatId,
              })
            );
          } else {
            console.warn(
              `>>> WebSocket /signal: Receptor ${receiverConnId} no está en el chat correcto.`
            );
          }
        } else {
          console.warn(
            `>>> WebSocket /signal: Receptor ${receiverConnId} no encontrado o no listo.`
          );
        }
        break;

      case "leave_chat":
        const leaveChatId = data.chatId || ws.currentChatId;
        const willDeleteChat = data.deleteChat || false;
        console.log(
          `>>> WebSocket /leave_chat: ${ws.username} (ConnID: ${ws.connId}) intentando salir del chat ${leaveChatId}. Borrar: ${willDeleteChat}`
        );
        if (
          ws.currentChatId === leaveChatId ||
          (!ws.currentChatId && leaveChatId)
        ) {
          handleUserLeave(ws, leaveChatId, willDeleteChat);
        } else {
          console.warn(
            `>>> WebSocket /leave_chat: Intento de ${ws.username} de salir de un chat incorrecto.`
          );
        }
        break;

      case "request_chat_list":
        console.log(
          `>>> WebSocket /request_chat_list: ${ws.username} (ConnID: ${ws.connId}) solicitó lista de chats.`
        );
        sendUpdatedChatListToClient(ws);
        break;

      default:
        console.warn(
          `>>> WebSocket: Tipo de mensaje desconocido de ${ws.username} (ConnID: ${ws.connId}): ${data.type}`
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Tipo de mensaje desconocido: ${data.type}`,
          })
        );
        break;
    }
  });

  ws.on("close", () => {
    console.log(
      `>>> WebSocket: Cliente WebSocket desconectado: ${
        ws.username || "Usuario no autenticado"
      } (ConnID: ${ws.connId}, UserID: ${ws.userId || "N/A"})`
    );
    clients.delete(ws.connId);
    if (ws.currentChatId) {
      handleUserLeave(ws, ws.currentChatId, false);
    }
  });

  ws.on("error", (error) => {
    console.error(
      `>>> WebSocket: Error en WebSocket con ${
        ws.username || "Cliente desconocido"
      } (ConnID: ${ws.connId}):`,
      error
    );
  });
});
// (Fin de wss.on("connection"))

function handleUserLeave(leavingWs, chatIdToLeave, deleteChatExplicitly) {
  if (!chatIdToLeave) {
    console.warn(
      `>>> handleUserLeave: ${leavingWs.username} (ConnID: ${leavingWs.connId}) intentó salir sin especificar un chat ID y no estaba en ninguno.`
    );
    return;
  }
  if (
    !activeChats[chatIdToLeave] ||
    !activeChats[chatIdToLeave].members[leavingWs.connId]
  ) {
    console.warn(
      `>>> handleUserLeave: Intento de ${leavingWs.username} (ConnID: ${leavingWs.connId}) de salir de chat ${chatIdToLeave} del que no es miembro o no existe.`
    );
    return;
  }

  const chat = activeChats[chatIdToLeave];
  const leavingUsername = leavingWs.username;
  const leavingConnId = leavingWs.connId;

  delete chat.members[leavingConnId];

  if (
    leavingWs.readyState === WebSocket.OPEN &&
    leavingWs.currentChatId === chatIdToLeave
  ) {
    delete leavingWs.currentChatId;
  }

  console.log(
    `>>> handleUserLeave: Usuario ${leavingUsername} (ConnID: ${leavingConnId}) dejó el chat ${chatIdToLeave} ("${chat.chatName}").`
  );

  const remainingMemberCount = Object.keys(chat.members).length;

  if (remainingMemberCount === 0 && deleteChatExplicitly) {
    console.log(
      `>>> handleUserLeave: Chat ${chatIdToLeave} ("${chat.chatName}") vacío y se solicita eliminar. Eliminando...`
    );
    delete activeChats[chatIdToLeave];
    broadcastChatRemoved(chatIdToLeave);
  } else if (remainingMemberCount > 0) {
    console.log(
      `>>> handleUserLeave: Chat ${chatIdToLeave} ("${chat.chatName}") tiene ${remainingMemberCount} miembros restantes. Actualizando miembros...`
    );
    broadcastChatMembersUpdate(chatIdToLeave);
  } else {
    console.log(
      `>>> handleUserLeave: Chat ${chatIdToLeave} ("${chat.chatName}") ahora está vacío. No se eliminó explícitamente.`
    );
  }
  sendUpdatedChatListToAllClients();
}

function broadcastChatMembersUpdate(chatId) {
  if (!activeChats[chatId]) {
    console.warn(
      `>>> broadcastChatMembersUpdate: Intento de broadcast para chat no existente: ${chatId}`
    );
    return;
  }
  const chatName = activeChats[chatId].chatName;
  const members = activeChats[chatId].members;
  const message = JSON.stringify({
    type: "chat_members_update",
    chatId: chatId,
    chatName: chatName,
    members: members,
  });
  console.log(
    `>>> broadcastChatMembersUpdate: Enviando actualización para chat ${chatId} a ${
      Object.keys(members).length
    } miembros.`
  );
  for (const memberConnId in members) {
    const memberSocket = clients.get(memberConnId);
    if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
      memberSocket.send(message);
    }
  }
}

function broadcastChatRemoved(chatId) {
  const message = JSON.stringify({ type: "chat_removed", chatId: chatId });
  console.log(
    `>>> broadcastChatRemoved: Notificando eliminación del chat ${chatId} a todos los clientes.`
  );
  clients.forEach((clientSocket) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(message);
    }
  });
}

function sendUpdatedChatListToAllClients() {
  const chatList = Object.keys(activeChats).map((chatId) => ({
    chatId: chatId,
    creator: activeChats[chatId].creator,
    chatName: activeChats[chatId].chatName,
    memberCount: Object.keys(activeChats[chatId].members).length,
  }));
  console.log(
    ">>> sendUpdatedChatListToAllClients: Enviando lista de chats actualizada a todos los clientes."
  );
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "chat_list", chats: chatList }));
    }
  });
}

function sendUpdatedChatListToClient(targetWs) {
  if (targetWs && targetWs.readyState === WebSocket.OPEN) {
    const chatList = Object.keys(activeChats).map((chatId) => ({
      chatId: chatId,
      creator: activeChats[chatId].creator,
      chatName: activeChats[chatId].chatName,
      memberCount: Object.keys(activeChats[chatId].members).length,
    }));
    console.log(
      `>>> sendUpdatedChatListToClient: Enviando lista de chats a ${targetWs.username} (ConnID: ${targetWs.connId})`
    );
    targetWs.send(JSON.stringify({ type: "chat_list", chats: chatList }));
  }
}

// --- INICIAR EL SERVIDOR ---
server.listen(PORT, () => {
  console.log(
    `Servidor HTTP y WebSocket escuchando en http://localhost:${PORT}`
  );
  // Para pruebas en red local, informa también sobre la IP de red si es posible
  // (esto es más complejo de obtener programáticamente de forma fiable todas las IPs,
  //  pero el usuario ya conoce su IP 192.168.1.109)
  console.log(
    `   Accesible en tu red local a través de la IP de esta máquina en el puerto ${PORT}`
  );
});
