export let username = null;
export let clientId = null;
export let signalingSocket = null;
export const activePeers = new Map();
export let currentChatId = null;
export let currentChatName = null;
export let currentChatMembers = {}; // { clientId: username }

export const SIGNALING_SERVER_URL = "ws://localhost:8081";
export const RECONNECT_INTERVAL = 5000;

export function setUsername(name) {
  username = name;
}
export function getUsername() {
  return username;
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
  currentChatId = null;
  currentChatName = null;
  currentChatMembers = {};
  clearActivePeers();
}
