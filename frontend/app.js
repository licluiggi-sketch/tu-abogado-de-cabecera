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
   LOGIN CON CAPTCHA
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

  // 🔥 OBTENER TOKEN DEL CAPTCHA
  const captchaToken = document.querySelector(
    ".cf-turnstile textarea"
  )?.value;

  if (!captchaToken) {
    mensaje.textContent = "Por favor, verifica el CAPTCHA.";
    mensaje.style.color = "red";
    return;
  }

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password, captchaToken })
    });

    const data = await res.json();

    if (data.success) {
      localStorage.setItem("token", data.token);
      window.location.href = "chat.html";
    } else {
      mensaje.textContent = data.message || "Credenciales incorrectas.";
      mensaje.className = "error";
    }

  } catch (error) {
    mensaje.textContent = "Error de conexión.";
    mensaje.className = "error";
  }
}

/* =========================
   REGISTRO CON CAPTCHA
========================= */
async function register() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const confirmPassword = document.getElementById("confirmPassword").value.trim();
  const mensaje = document.getElementById("mensaje");

  mensaje.textContent = "";
  mensaje.className = "";

  // Validar campos
  if (!email || !password || !confirmPassword) {
    mensaje.textContent = "Completa todos los campos.";
    mensaje.className = "error";
    return;
  }

  // Validar contraseñas
  if (password !== confirmPassword) {
    mensaje.textContent = "Las contraseñas no coinciden.";
    mensaje.className = "error";
    return;
  }

  // Validar longitud de contraseña
  if (password.length < 6) {
    mensaje.textContent = "La contraseña debe tener al menos 6 caracteres.";
    mensaje.className = "error";
    return;
  }

  // Obtener token del CAPTCHA de Cloudflare
  const captchaToken = document.querySelector(
    "input[name='cf-turnstile-response']"
  )?.value;

  if (!captchaToken) {
    mensaje.textContent = "Por favor, verifica el CAPTCHA.";
    mensaje.className = "error";
    return;
  }

  try {
    const res = await fetch("/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        captchaToken
      })
    });

    const data = await res.json();

    if (data.success) {
      mensaje.textContent = "Registro exitoso. Redirigiendo...";
      mensaje.className = "success";

      // Reiniciar CAPTCHA
      if (window.turnstile) {
        turnstile.reset();
      }

      setTimeout(() => {
        window.location.href = "index.html";
      }, 1500);
    } else {
      mensaje.textContent =
        data.error || data.message || "El usuario ya existe.";
      mensaje.className = "error";

      // Reiniciar CAPTCHA en caso de error
      if (window.turnstile) {
        turnstile.reset();
      }
    }

  } catch (error) {
    console.error("Error en registro:", error);
    mensaje.textContent = "Error de conexión con el servidor.";
    mensaje.className = "error";

    if (window.turnstile) {
      turnstile.reset();
    }
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
async function recuperarPassword() {
  const emailInput = document.getElementById("recoveryEmail");
  const mensaje = document.getElementById("mensaje");
  const boton = document.getElementById("btnRecuperar");

  if (!emailInput || !mensaje) return;

  const email = emailInput.value.trim();

  mensaje.textContent = "";
  mensaje.className = "";

  // Validar correo
  if (!email) {
    mensaje.textContent = "Ingresa tu correo electrónico.";
    mensaje.className = "error";
    return;
  }

  // Validar formato de correo
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    mensaje.textContent = "Ingresa un correo electrónico válido.";
    mensaje.className = "error";
    return;
  }

  // Obtener token de Cloudflare Turnstile
  let captchaToken = "";
  if (typeof turnstile !== "undefined") {
    captchaToken = turnstile.getResponse();
  }

  if (!captchaToken) {
    mensaje.textContent = "Por favor, verifica que no eres un robot.";
    mensaje.className = "error";
    return;
  }

  // Deshabilitar botón para evitar múltiples envíos
  if (boton) {
    boton.disabled = true;
    boton.textContent = "Enviando...";
  }

  try {
    const res = await fetch("/recuperar-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        captchaToken
      })
    });

    const data = await res.json();

    if (data.success) {
      mensaje.textContent =
        "📩 Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.";
      mensaje.className = "success";
      emailInput.value = "";
    } else {
      mensaje.textContent =
        data.message || "No se pudo procesar la solicitud.";
      mensaje.className = "error";
    }

    // Reiniciar CAPTCHA
    if (typeof turnstile !== "undefined") {
      turnstile.reset();
    }

  } catch (error) {
    console.error("Error:", error);
    mensaje.textContent = "Error de conexión con el servidor.";
    mensaje.className = "error";
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.textContent = "Enviar solicitud";
    }
  }
}

function toggleAllPasswords() {
  const password = document.getElementById("password");
  const confirmPassword = document.getElementById("confirmPassword");

  if (!password || !confirmPassword) return;

  const type = password.type === "password" ? "text" : "password";
  password.type = type;
  confirmPassword.type = type;
}