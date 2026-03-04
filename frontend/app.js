console.log("app.js JWT cargado");

/* =========================
   TOKEN GLOBAL
========================= */
function getToken() {
  return localStorage.getItem("token");
}

/* =========================
   PROTEGER CHAT
========================= */
if (!getToken() && window.location.pathname.includes("chat.html")) {
  window.location.href = "index.html";
}

/* =========================
   LOGIN
========================= */
async function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (data.success) {
      localStorage.setItem("token", data.token);
      window.location.href = "chat.html";
    } else {
      alert("Credenciales incorrectas");
    }

  } catch (error) {
    alert("Error de conexión");
  }
}

/* =========================
   REGISTRO
========================= */
async function register() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const res = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (data.success) {
      alert("Registro exitoso. Ahora puedes iniciar sesión.");
      window.location.href = "index.html";
    } else {
      alert("Ese correo ya está registrado");
    }

  } catch (error) {
    alert("Error al registrar");
  }
}

/* ========================= 
   CONSULTA IA
========================= */
async function consultarIA() {

  const token = getToken();
  const preguntaInput = document.getElementById("pregunta");
  const chat = document.getElementById("chat");

  const pregunta = preguntaInput.value.trim();
  if (!pregunta) return;

  preguntaInput.value = "";

  const userMsg = document.createElement("div");
  userMsg.className = "msg user";
  userMsg.innerText = pregunta;
  chat.appendChild(userMsg);

  const botMsg = document.createElement("div");
  botMsg.className = "msg bot";
  botMsg.innerText = "⚖️ Analizando...";
  chat.appendChild(botMsg);

  try {

    const res = await fetch("/consulta", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({ pregunta })
    });

    const data = await res.json();
    botMsg.innerText = data.respuesta;

    if (data.limite) {
      botMsg.innerHTML += `
        <br><br>
        <button onclick="upgradePremium()">
          🚀 Actualizar a PREMIUM
        </button>
      `;
    }

    cargarEstadoUsuario();

  } catch (error) {
    botMsg.innerText = "Error al consultar.";
  }
}

/* =========================
   HISTORIAL
========================= */
async function cargarHistorial() {

  const token = getToken();

  const res = await fetch("/historial", {
    headers: { "Authorization": "Bearer " + token }
  });

  const historial = await res.json();
  const chat = document.getElementById("chat");
  chat.innerHTML = "";

  historial.forEach(item => {
    const u = document.createElement("div");
    u.className = "msg user";
    u.innerText = item.pregunta;
    chat.appendChild(u);

    const b = document.createElement("div");
    b.className = "msg bot";
    b.innerText = item.respuesta;
    chat.appendChild(b);
  });
}

/* ========================= 
   ESTADO
========================= */
async function cargarEstadoUsuario() {

  const token = getToken();
  const estado = document.getElementById("estado-usuario");
  if (!estado) return;

  try {

    const res = await fetch("/estado", {
      headers: {
        "Authorization": "Bearer " + token
      }
    });

    const data = await res.json();

    const LIMITE_FREE = 2;
    const esPremiumActivo =
      data.subscription_status === "active" ||
      data.subscription_status === "trialing" ||
      data.tipo === "PREMIUM";

    if (esPremiumActivo) {

      estado.innerHTML = `
        🌟 Usuario PREMIUM – Consultas ilimitadas
        <br><br>
        <button onclick="cerrarSesion()">Cerrar sesión</button>
      `;

    } else {

      const restantes = LIMITE_FREE - data.consultas_hoy;

      estado.innerHTML = `
        🟡 Usuario FREE – ${restantes} consultas restantes
        <br><br>
        <button onclick="upgradePremium()">
          🚀 Actualizar a PREMIUM
        </button>
        <br><br>
        <button onclick="cerrarSesion()">Cerrar sesión</button>
      `;
    }

  } catch (error) {
    estado.innerHTML = "Error cargando estado.";
  }
}

/* =========================
   UPGRADE
========================= */
async function upgradePremium() {

  const token = getToken();

  try {

    const res = await fetch("/crear-sesion-checkout", {
      method: "POST",
      headers: { 
        "Authorization": "Bearer " + token 
      }
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("Error al crear sesión de pago");
    }

  } catch (error) {
    alert("Error al iniciar el pago");
  }
}

/* =========================
   LOGOUT
========================= */
function cerrarSesion() {
  localStorage.removeItem("token");
  window.location.href = "index.html";
}

/* AUTOLOAD */
if (window.location.pathname.includes("chat.html")) {
  cargarHistorial();
  cargarEstadoUsuario();
}