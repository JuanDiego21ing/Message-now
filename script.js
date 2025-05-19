let username = null;
const usernameInput = document.getElementById("username");
const setUsernameButton = document.getElementById("set-username");
const createChatButton = document.getElementById("create-chat");
const availableChatsList = document.getElementById("available-chats");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

let peer;
let isInitiator = false;

setUsernameButton.addEventListener("click", () => {
  username = usernameInput.value.trim();
  if (username) {
    document.getElementById("user-setup").style.display = "none";
    alert(`Tu nombre será: ${username}`);
  } else {
    alert("Por favor, ingresa un nombre.");
  }
});

createChatButton.addEventListener("click", () => {
  if (!username) {
    alert("Por favor, ingresa tu nombre primero.");
    return;
  }

  isInitiator = true;
  console.log("Creando una conexión...");
  peer = new SimplePeer({ initiator: true, trickle: false });

  peer.on("signal", (data) => {
    console.log("SEÑAL (Oferta):", JSON.stringify(data));
  });

  peer.on("connect", () => {
    console.log("¡CONECTADO!");
  });

  peer.on("data", (data) => {
    console.log("Datos recibidos:", data.toString());
    try {
      const message = JSON.parse(data.toString());
      displayMessage(message.sender, message.text, false);
    } catch (e) {
      console.error("Error al parsear el mensaje:", e);
    }
  });

  peer.on("close", () => {
    console.log("Conexión cerrada.");
    peer.destroy();
  });

  peer.on("error", (err) => {
    console.error("Error:", err);
  });
});

const offerInput = document.getElementById("offer-input");
const joinButton = document.getElementById("join-button");
let peer2;

joinButton.addEventListener("click", () => {
  if (!username) {
    alert("Por favor, ingresa tu nombre primero.");
    return;
  }

  const offer = offerInput.value.trim();
  if (offer) {
    console.log("Recibiendo Oferta:", offer);
    try {
      const offerData = JSON.parse(offer);
      peer2 = new SimplePeer({ initiator: false, trickle: false });

      peer2.on("signal", (data) => {
        console.log("SEÑAL (Respuesta):", JSON.stringify(data));
      });

      peer2.on("connect", () => {
        console.log("¡CONECTADO como receptor!");
      });

      peer2.on("data", (data) => {
        console.log("Datos recibidos (receptor):", data.toString());
        try {
          const message = JSON.parse(data.toString());
          displayMessage(message.sender, message.text, false);
        } catch (e) {
          console.error("Error al parsear el mensaje:", e);
        }
      });

      peer2.on("close", () => {
        console.log("Conexión cerrada (receptor).");
        peer2.destroy();
      });

      peer2.on("error", (err) => {
        console.error("Error (receptor):", err);
      });

      peer2.signal(offerData);
    } catch (e) {
      console.error("Error al procesar la oferta:", e);
      alert("La oferta no es válida.");
    }
  } else {
    alert("Por favor, pega la oferta del otro peer.");
  }
});

const answerInput = document.getElementById("answer-input");
const processAnswerButton = document.getElementById("process-answer-button");

if (processAnswerButton) {
  processAnswerButton.addEventListener("click", () => {
    const answer = answerInput.value.trim();
    if (answer && peer) {
      console.log("Procesando Respuesta:", answer);
      try {
        const answerData = JSON.parse(answer);
        peer.signal(answerData);
      } catch (e) {
        console.error("Error al parsear la respuesta:", e);
        alert("La respuesta no es válida.");
      }
    } else {
      alert("Por favor, pega la respuesta del otro peer.");
    }
  });
}

sendButton.addEventListener("click", () => {
  const message = messageInput.value.trim();
  if (message && (peer || peer2)) {
    const sender = username || "Anónimo";
    const messageToSend = JSON.stringify({ sender: sender, text: message });

    if (peer && peer.connected) {
      peer.send(messageToSend);
      displayMessage(sender, message, true);
    }
    if (peer2 && peer2.connected) {
      peer2.send(messageToSend);
      displayMessage(sender, message, true);
    }
    messageInput.value = "";
  } else if (!username) {
    alert("Por favor, ingresa tu nombre primero.");
  } else {
    alert("No estás conectado a ningún chat aún.");
  }
});

function displayMessage(sender, text, isMe) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message");
  messageDiv.innerHTML = `<strong>${isMe ? "Yo" : sender}:</strong> ${text}`;
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
