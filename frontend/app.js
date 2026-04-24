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
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => console.log("PWA activa"))
      .catch((err) => console.log("Error SW:", err));
  });
}

/* =========================
   OBTENER CAPTCHA (CORRECTO)
========================= */
function obtenerCaptcha() {
  if (typeof turnstile !== "undefined") {
    return turnstile.getResponse();
  }
  return "";
}

/* =========================
   LOGIN
========================= */
async function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const mensaje = document.getElementById("mensaje");

  mensaje.textContent = "";
  mensaje.className = "";

  if (!email || !password) {
    mensaje.textContent = "Completa todos los campos.";
    mensaje.className = "error";
    return;
  }

  const captchaToken = obtenerCaptcha();

  if (!captchaToken) {
    mensaje.textContent = "Por favor, verifica el CAPTCHA.";
    mensaje.className = "error";
    return;
  }

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, captchaToken }),
    });

    const data = await res.json();

    if (data.success) {
      localStorage.setItem("token", data.token);
      window.location.href = "chat.html";
    } else {
      mensaje.textContent = data.message || "Credenciales incorrectas.";
      mensaje.className = "error";
      turnstile.reset();
    }
  } catch (error) {
    mensaje.textContent = "Error de conexión.";
    mensaje.className = "error";
  }
}

/* =========================
   REGISTRO
========================= */
async function register() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const confirmPassword = document
    .getElementById("confirmPassword")
    .value.trim();
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
    mensaje.textContent = "Mínimo 6 caracteres.";
    mensaje.className = "error";
    return;
  }

  const captchaToken = obtenerCaptcha();

  if (!captchaToken) {
    mensaje.textContent = "Verifica el CAPTCHA.";
    mensaje.className = "error";
    return;
  }

  try {
    const res = await fetch("/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, captchaToken }),
    });

    const data = await res.json();

    if (data.success) {
      mensaje.textContent = "Registro exitoso...";
      mensaje.className = "success";

      turnstile.reset();

      setTimeout(() => {
        window.location.href = "index.html";
      }, 1500);
    } else {
      mensaje.textContent = data.message || "Error al registrar.";
      mensaje.className = "error";
      turnstile.reset();
    }
  } catch (error) {
    mensaje.textContent = "Error de conexión.";
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
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ pregunta }),
    });

    const data = await res.json();

    // Mostrar respuesta
    botMsg.innerText = data.respuesta || "Sin respuesta";

    // 🚀 UPSELL AGRESIVO PRO
    if (data.limite) {

      botMsg.innerHTML += `
        <div style="
          margin-top:15px;
          padding:15px;
          border-radius:10px;
          background:#fff3cd;
          border:1px solid #ffeeba;
          text-align:center;
        ">
          <h3>🚫 Límite alcanzado</h3>

          <p><b>Solo tienes 2 consultas gratis al día</b></p>

          <hr>

          <p><b>⚖️ Con PREMIUM desbloqueas:</b></p>
          <p>✔ Consultas ILIMITADAS</p>
          <p>✔ Contratos listos para usar</p>
          <p>✔ Cálculo de liquidaciones</p>
          <p>✔ Asesoría legal más precisa</p>

          <hr>

          <p style="color:red;"><b>🔥 Oferta: Acceso inmediato</b></p>

          <button onclick="upgradePremium()" style="
            background:#28a745;
            color:white;
            padding:10px 20px;
            border:none;
            border-radius:8px;
            cursor:pointer;
            font-size:16px;
         ">
            🚀 Activar PREMIUM
         </button>
       </div>
     `;

     // 🔒 BLOQUEAR INPUT
     const input = document.getElementById("pregunta");
     if (input) input.disabled = true;
    }

    if (data.limite) {
      botMsg.innerHTML += `<br><br><button onclick="upgradePremium()">🚀 Actualizar a PREMIUM</button>`;
    }

    cargarEstadoUsuario();
  } catch (error) {
    botMsg.innerText = "❌ Error al consultar.";
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
      headers: { Authorization: "Bearer " + token },
    });

    const historial = await res.json();

    chat.innerHTML = "";

    historial.forEach((item) => {
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
      headers: { Authorization: "Bearer " + token },
    });

    const data = await res.json();

    const esPremium =
      data.subscription_status === "active" ||
      data.subscription_status === "trialing" ||
      data.tipo === "PREMIUM";

    if (esPremium) {
      estado.innerHTML = `
        🌟 PREMIUM – ilimitado
        <br><br>
        <button onclick="cerrarSesion()">Cerrar sesión</button>
      `;
    } else {
      estado.innerHTML = `
        🟡 FREE
        <br><br>
        <button onclick="upgradePremium()">🚀 Premium</button>
        <br><br>
        <button onclick="cerrarSesion()">Cerrar sesión</button>
      `;
    }
  } catch (error) {
    estado.innerHTML = "Error estado.";
  }
}

/* =========================
   STRIPE
========================= */
async function upgradePremium() {
  const token = getToken();

  try {
    const res = await fetch("/crear-sesion-checkout", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    }
  } catch (error) {
    alert("Error pago");
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
   MOSTRAR CONTRASEÑA
========================= */
function togglePassword(id, icon) {
  const input = document.getElementById(id);

  if (input.type === "password") {
    input.type = "text";
    icon.textContent = "🙈";
  } else {
    input.type = "password";
    icon.textContent = "👁️";
  }
}

/* =========================
   RECUPERAR PASSWORD
========================= */
async function recuperarPassword() {
  const email = document.getElementById("recoveryEmail").value.trim();
  const mensaje = document.getElementById("mensaje");

  if (!email) {
    mensaje.textContent = "Ingresa tu correo.";
    mensaje.className = "error";
    return;
  }

  const captchaToken = obtenerCaptcha();

  if (!captchaToken) {
    mensaje.textContent = "Verifica CAPTCHA.";
    mensaje.className = "error";
    return;
  }

  try {
    const res = await fetch("/recuperar-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, captchaToken }),
    });

    const data = await res.json();

    if (data.success) {
      mensaje.textContent = "Revisa tu correo.";
      mensaje.className = "success";
    } else {
      mensaje.textContent = data.message || "Error.";
      mensaje.className = "error";
    }

    turnstile.reset();
  } catch (error) {
    mensaje.textContent = "Error conexión.";
    mensaje.className = "error";
  }
}

/* =========================
   CARGAR ABOGADOS
========================= */
async function cargarAbogados() {
  const cont = document.getElementById("lista-abogados");
  if (!cont) return;

  try {
    const res = await fetch("/abogados");
    const data = await res.json();

    if (data.length === 0) {
      cont.innerHTML = "No hay abogados disponibles.";
      return;
    }

    cont.innerHTML = data.map(a => `
      <div style="
        border:1px solid #ccc;
        padding:10px;
        border-radius:8px;
        margin-bottom:10px;
      ">
        <b>${a.nombre}</b><br>
        ⚖️ ${a.especialidad}<br>
        📍 ${a.ciudad}<br>
        📞 ${a.telefono}<br>
        ✉️ ${a.email}
      </div>
    `).join("");

  } catch (error) {
    console.error(error);
    cont.innerHTML = "Error cargando abogados.";
  }
}