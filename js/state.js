// js/state.js
export let username = null;
export let userId = null;
export let authToken = null;
export let clientId = null; // ID de conexión WebSocket
export let signalingSocket = null; // Asegúrate que esta declaración esté presente
export const activePeers = new Map();
export let currentChatId = null;
export let currentChatName = null;
export let currentChatMembers = {};

// ---- MODIFICACIÓN AQUÍ ----
export const SIGNALING_SERVER_URL = "ws://192.168.1.109:8081"; // IP de tu laptop anfitrión
export const RECONNECT_INTERVAL = 5000;

export function setAuthenticatedUser(authUsername, authUserId, token) {
  // ---- LOG AÑADIDO ----
  console.log(
    "STATE.JS: setAuthenticatedUser INVOCADO con -> Username:",
    authUsername,
    "| UserID:",
    authUserId,
    "| Token Presente:",
    token ? "Sí" : "No"
  );
  username = authUsername;
  userId = authUserId;
  authToken = token;
  if (token) {
    try {
      localStorage.setItem("authToken", token);
      localStorage.setItem("username", authUsername);
      localStorage.setItem("userId", authUserId);
      // ---- LOG AÑADIDO ----
      console.log(
        "STATE.JS: Token y datos de usuario GUARDADOS en localStorage."
      );
    } catch (e) {
      console.error("STATE.JS: Error al GUARDAR en localStorage:", e);
    }
  } else {
    try {
      localStorage.removeItem("authToken");
      localStorage.removeItem("username");
      localStorage.removeItem("userId");
      // ---- LOG AÑADIDO ----
      console.log(
        "STATE.JS: Token y datos de usuario ELIMINADOS de localStorage."
      );
    } catch (e) {
      console.error("STATE.JS: Error al ELIMINAR de localStorage:", e);
    }
  }
}

export function getUsername() {
  // console.log("STATE.JS: getUsername llamado, devuelve:", username);
  return username;
}
export function getUserId() {
  return userId;
}
export function getAuthToken() {
  // console.log("STATE.JS: getAuthToken llamado, devuelve token presente:", authToken ? "Sí" : "No");
  return authToken;
}

export function loadStateFromStorage() {
  // ---- LOG AÑADIDO ----
  console.log("STATE.JS: loadStateFromStorage INVOCADO.");
  const storedToken = localStorage.getItem("authToken");
  const storedUsername = localStorage.getItem("username");
  const storedUserId = localStorage.getItem("userId");
  // ---- LOG AÑADIDO ----
  console.log(
    "STATE.JS: Leyendo de localStorage -> Token:",
    storedToken ? "Sí" : "No",
    "| Username:",
    storedUsername,
    "| UserID:",
    storedUserId
  );

  if (storedToken && storedUsername && storedUserId) {
    authToken = storedToken;
    username = storedUsername;
    userId = storedUserId;
    // ---- LOG AÑADIDO ----
    console.log(
      "STATE.JS: Estado RESTAURADO desde localStorage. Username actual en variable:",
      username
    );
    return true; // Hay sesión activa
  }
  // ---- LOG AÑADIDO ----
  console.log(
    "STATE.JS: No se encontró sesión completa en localStorage para restaurar."
  );
  return false; // No hay sesión activa
}

export function clearAuthenticatedUser() {
  // ---- LOG AÑADIDO ----
  console.log("STATE.JS: clearAuthenticatedUser INVOCADO.");
  setAuthenticatedUser(null, null, null);
}

export function setClientId(id) {
  clientId = id;
}
export function getClientId() {
  return clientId;
}

export function setSignalingSocket(socket) {
  signalingSocket = socket;
}
export function getSignalingSocket() {
  return signalingSocket;
}
export function setCurrentChatId(id) {
  currentChatId = id;
}
export function getCurrentChatId() {
  return currentChatId;
}
export function setCurrentChatName(name) {
  currentChatName = name;
}
export function getCurrentChatName() {
  return currentChatName;
}
export function setCurrentChatMembers(members) {
  currentChatMembers = members;
}
export function getCurrentChatMembers() {
  return currentChatMembers;
}
export function addActivePeer(id, peer) {
  activePeers.set(id, peer);
}
export function getActivePeer(id) {
  return activePeers.get(id);
}
export function removeActivePeer(id) {
  activePeers.delete(id);
}
export function getActivePeers() {
  return activePeers;
}
export function clearActivePeers() {
  activePeers.forEach((peer) => {
    if (peer && typeof peer.destroy === "function") {
      peer.destroy();
    }
  });
  activePeers.clear();
}
export function resetCurrentChatState() {
  // ---- LOG AÑADIDO ----
  console.log("STATE.JS: resetCurrentChatState INVOCADO.");
  currentChatId = null;
  currentChatName = null;
  currentChatMembers = {};
  clearActivePeers();
}
