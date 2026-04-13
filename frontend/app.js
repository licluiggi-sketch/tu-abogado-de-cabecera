console.log("Frontend cargado correctamente");

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
   SERVICE WORKER (PWA)
========================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log("PWA activa"))
      .catch(err => console.log("Error SW:", err));
  });
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

    if (!res.ok) throw new Error("Error servidor");

    const data = await res.json();

    if (data.success) {
      localStorage.setItem("token", data.token);
      window.location.href = "chat.html";
    } else {
      alert("Credenciales incorrectas");
    }

  } catch (error) {
    console.error(error);
    alert("Error de conexión con el servidor");
  }
}

/* =========================
   REGISTRO
========================= */
async function register() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const confirmPassword = document.getElementById("confirmPassword").value.trim();
  const mensaje = document.getElementById("mensaje");

  mensaje.textContent = "";
  mensaje.className = "";

  if (!email || !password || !confirmPassword) {
    mensaje.textContent = "Completa todos los campos.";
    mensaje.className = "error";
    return;
  }

  if (password !== confirmPassword) {
    mensaje.textContent = "Las contraseñas no coinciden.";
    mensaje.className = "error";
    return;
  }

  if (password.length < 6) {
    mensaje.textContent = "La contraseña debe tener al menos 6 caracteres.";
    mensaje.className = "error";
    return;
  }

  try {
    const res = await fetch("/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (data.success) {
      mensaje.textContent = "Registro exitoso. Redirigiendo...";
      mensaje.className = "success";
      setTimeout(() => {
        window.location.href = "index.html";
      }, 1500);
    } else {
      mensaje.textContent = "El usuario ya existe.";
      mensaje.className = "error";
    }

  } catch (error) {
    mensaje.textContent = "Error de conexión con el servidor.";
    mensaje.className = "error";
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

    if (!res.ok) throw new Error("Error consulta");

    const data = await res.json();

    botMsg.innerText = data.respuesta || "Sin respuesta";

    if (data.limite) {
      botMsg.innerHTML += `
        <br><br>
        <button onclick="upgradePremium()">🚀 Actualizar a PREMIUM</button>
      `;
    }

    cargarEstadoUsuario();

  } catch (error) {
    console.error(error);
    botMsg.innerText = "❌ Error al consultar IA.";
  }
}

/* =========================
   HISTORIAL
========================= */
async function cargarHistorial() {

  const token = getToken();
  const chat = document.getElementById("chat");
  if (!chat) return;

  try {

    const res = await fetch("/historial", {
      headers: { "Authorization": "Bearer " + token }
    });

    if (!res.ok) throw new Error("Error historial");

    const historial = await res.json();

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

  } catch (error) {
    console.error(error);
  }
}

/* ========================= 
   ESTADO USUARIO
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

    if (!res.ok) throw new Error("Error estado");

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

      const restantes = Math.max(0, LIMITE_FREE - (data.consultas_hoy || 0));

      estado.innerHTML = `
        🟡 Usuario FREE – ${restantes} consultas restantes
        <br><br>
        <button onclick="upgradePremium()">🚀 Actualizar a PREMIUM</button>
        <br><br>
        <button onclick="cerrarSesion()">Cerrar sesión</button>
      `;
    }

  } catch (error) {
    console.error(error);
    estado.innerHTML = "⚠️ Error cargando estado.";
  }
}

/* =========================
   UPGRADE STRIPE
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

    if (!res.ok) throw new Error("Error pago");

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("Error al crear sesión de pago");
    }

  } catch (error) {
    console.error(error);
    alert("Error al iniciar pago");
  }
}

/* =========================
   LOGOUT
========================= */
function cerrarSesion() {
  localStorage.removeItem("token");
  window.location.href = "index.html";
}

/* =========================
   AUTOLOAD CHAT
========================= */
if (window.location.pathname.includes("chat.html")) {
  cargarHistorial();
  cargarEstadoUsuario();
}

/* =========================
   MOSTRAR / OCULTAR CONTRASEÑA
========================= */
function togglePassword(inputId, icon) {
  const input = document.getElementById(inputId);

  if (input.type === "password") {
    input.type = "text";
    icon.textContent = "🙈";
  } else {
    input.type = "password";
    icon.textContent = "👁️";
  }
}

/* =========================
   RECUPERAR CONTRASEÑA
========================= */
function recuperarPassword() {
  const email = document.getElementById("recoveryEmail").value.trim();
  const mensaje = document.getElementById("mensaje");

  if (!email) {
    mensaje.textContent = "Ingresa tu correo electrónico.";
    mensaje.style.color = "red";
    return;
  }

  mensaje.textContent =
    "📩 Función en desarrollo. Próximamente recibirás un enlace de recuperación.";
  mensaje.style.color = "green";
}

function toggleAllPasswords() {
  const password = document.getElementById("password");
  const confirmPassword = document.getElementById("confirmPassword");

  const type = password.type === "password" ? "text" : "password";
  password.type = type;
  confirmPassword.type = type;
}

/* =========================
   RECUPERAR CONTRASEÑA
========================= */
async function recuperarPassword() {
  const email = document.getElementById("recoveryEmail").value.trim();
  const mensaje = document.getElementById("mensaje");

  if (!email) {
    mensaje.textContent = "Ingresa tu correo electrónico.";
    mensaje.style.color = "red";
    return;
  }

  try {
    const res = await fetch("/recuperar-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email })
    });

    const data = await res.json();

    if (data.success) {
      mensaje.textContent = "📩 Revisa tu correo para restablecer tu contraseña.";
      mensaje.style.color = "green";
    } else {
      mensaje.textContent = "No se encontró el usuario.";
      mensaje.style.color = "red";
    }
  } catch (error) {
    mensaje.textContent = "Error de conexión con el servidor.";
    mensaje.style.color = "red";
  }
}