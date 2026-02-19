require("dotenv").config();
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = 3000;
const SECRET = process.env.JWT_SECRET || "abogado_secret_2026";

/* =========================
   STRIPE WEBHOOK (ANTES de express.json)
========================= */
app.post("/webhook-stripe", express.raw({ type: "application/json" }), (req, res) => {

  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.log("⚠️ Error webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log("📩 Evento recibido:", event.type);

  /* =========================
     SUSCRIPCIÓN ACTIVADA
  ========================= */
  if (event.type === "checkout.session.completed") {

  const session = event.data.object;

  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const email = session.customer_email;

  stripe.subscriptions.retrieve(subscriptionId)
    .then(subscription => {

      const plan = subscription.items.data[0].price.id;
      const status = subscription.status;

      // Determinar tipo según status real
      const tipo = (status === "active" || status === "trialing")
        ? "PREMIUM"
        : "FREE";

      db.run(
        `UPDATE usuarios 
         SET tipo = ?,
             stripe_customer_id = ?,
             stripe_subscription_id = ?,
             subscription_status = ?,
             subscription_plan = ?
         WHERE email = ?`,
        [tipo, customerId, subscriptionId, status, plan, email],
        function (err) {
          if (err) {
            console.log("❌ Error actualizando usuario:", err);
          } else {
            console.log("✅ Usuario actualizado:", email);
            console.log("📌 Status:", status);
          }
        }
      );

    });
}

  /* =========================
     SUSCRIPCIÓN CANCELADA
  ========================= */
  if (event.type === "customer.subscription.deleted") {

  const subscription = event.data.object;
  const subscriptionId = subscription.id;
  const status = subscription.status;

  db.run(
    `UPDATE usuarios 
     SET tipo = 'FREE',
         subscription_status = ? 
     WHERE stripe_subscription_id = ?`,
    [status, subscriptionId],
    function (err) {
      if (err) {
        console.log("❌ Error downgrade:", err);
      } else {
        console.log("🔻 Usuario degradado a FREE");
        console.log("📌 Subscription ID:", subscriptionId);
        console.log("📌 Status:", status);
      }
    }
  );
}

  /* =========================
     PAGO FALLIDO
  ========================= */
  if (event.type === "invoice.payment_failed") {

  const invoice = event.data.object;
  const subscriptionId = invoice.subscription;

  db.run(
    `UPDATE usuarios 
     SET tipo = 'FREE',
         subscription_status = 'past_due'
     WHERE stripe_subscription_id = ?`,
    [subscriptionId],
    function (err) {
      if (err) {
        console.log("❌ Error pago fallido:", err);
      } else {
        console.log("💳 Pago fallido. Usuario regresado a FREE");
        console.log("📌 Subscription ID:", subscriptionId);
      }
    }
  );
}

  res.json({ received: true });
});

/* =========================
   MIDDLEWARES
========================= */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

/* =========================
   BASE DE DATOS
========================= */
const db = new sqlite3.Database("./abogado.db");

db.run(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    tipo TEXT DEFAULT 'FREE',
    consultas_hoy INTEGER DEFAULT 0,
    ultima_consulta TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS consultas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    pregunta TEXT,
    respuesta TEXT,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/* =========================
   COLUMNAS STRIPE (PRO)
========================= */

db.run(`
  ALTER TABLE usuarios ADD COLUMN stripe_customer_id TEXT
`, () => {});

db.run(`
  ALTER TABLE usuarios ADD COLUMN stripe_subscription_id TEXT
`, () => {});

db.run(`
  ALTER TABLE usuarios ADD COLUMN subscription_status TEXT DEFAULT 'inactive'
`, () => {});

db.run(`
  ALTER TABLE usuarios ADD COLUMN subscription_plan TEXT
`, () => {});

/* =========================
   OPENAI
========================= */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================
   JWT MIDDLEWARE
========================= */
function verificarToken(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) return res.status(401).json({ error: "Token requerido" });

  const token = header.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token inválido" });

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Token expirado o inválido" });
    req.usuario = decoded;
    next();
  });
}

/* =========================
   REGISTRO
========================= */
app.post("/register", (req, res) => {
  const { email, password } = req.body;
  const hashed = bcrypt.hashSync(password, 10);

  db.run(
    "INSERT INTO usuarios (email, password) VALUES (?, ?)",
    [email, hashed],
    function (err) {
      if (err) {
        return res.json({ success: false, message: "Usuario ya existe" });
      }
      res.json({ success: true });
    }
  );
});

/* =========================
   LOGIN
========================= */
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, user) => {
    if (!user) {
      return res.json({ success: false, message: "Usuario no encontrado" });
    }

    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) {
      return res.json({ success: false, message: "Contraseña incorrecta" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      SECRET,
      { expiresIn: "2h" }
    );

    res.json({ success: true, token });
  });
});

/* =========================
   CONSULTA IA
========================= */
app.post("/consulta", verificarToken, async (req, res) => {
  const userId = req.usuario.id;
  const pregunta = req.body.pregunta;

  db.get("SELECT * FROM usuarios WHERE id = ?", [userId], async (err, user) => {
    if (err || !user) {
      return res.status(500).json({ respuesta: "Usuario no encontrado" });
    }

    const hoy = new Date().toISOString().split("T")[0];
    let consultasHoy = user.consultas_hoy;

    if (user.ultima_consulta !== hoy) {
      consultasHoy = 0;
    }

   // Determinar si es realmente PREMIUM activo
const esPremiumActivo =
  user.subscription_status === "active";

if (!esPremiumActivo && consultasHoy >= 5) {
  return res.json({
    respuesta: "⚠️ Límite diario alcanzado. Actualiza a PREMIUM.",
    limite: true
  });
}

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un abogado experto en leyes mexicanas.
Responde con fundamento legal.
Finaliza con:
"Esta información es orientativa y no sustituye asesoría profesional."
`
          },
          { role: "user", content: pregunta }
        ]
      });

      const respuestaIA = completion.choices[0].message.content;

      db.run(
        "INSERT INTO consultas (usuario_id, pregunta, respuesta) VALUES (?, ?, ?)",
        [userId, pregunta, respuestaIA]
      );

      if (!esPremiumActivo) {
        db.run(
          "UPDATE usuarios SET consultas_hoy = ?, ultima_consulta = ? WHERE id = ?",
          [consultasHoy + 1, hoy, userId]
        );
      }

      res.json({ respuesta: respuestaIA });

    } catch (error) {
      console.error(error);
      res.status(500).json({ respuesta: "Error IA" });
    }
  });
});

/* =========================
   ESTADO
========================= */
app.get("/estado", verificarToken, (req, res) => {
  const userId = req.usuario.id;

  db.get(
    "SELECT tipo, consultas_hoy FROM usuarios WHERE id = ?",
    [userId],
    (err, user) => {
      res.json(user);
    }
  );
});

/* =========================
   HISTORIAL
========================= */
app.get("/historial", verificarToken, (req, res) => {
  const userId = req.usuario.id;

  db.all(
    "SELECT pregunta, respuesta, fecha FROM consultas WHERE usuario_id = ? ORDER BY fecha ASC",
    [userId],
    (err, rows) => {
      res.json(rows);
    }
  );
});

/* =========================
   STRIPE CHECKOUT
========================= */
app.post("/crear-sesion-checkout", verificarToken, async (req, res) => {

  const userId = req.usuario.id;

  db.get("SELECT email FROM usuarios WHERE id = ?", [userId], async (err, user) => {

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    try {
      const session = await stripe.checkout.sessions.create({
  payment_method_types: ["card"],
  mode: "subscription",
  customer_email: user.email,

  line_items: [
    {
      price: process.env.STRIPE_PRICE_ID,
      quantity: 1,
    },
  ],

  subscription_data: {
    trial_period_days: 7
  },

  success_url: "http://localhost:3000/chat.html",
  cancel_url: "http://localhost:3000/chat.html",
});

      res.json({ url: session.url });

    } catch (error) {
      console.error("Stripe error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });
});

/* =========================
   ADMIN DEBUG
========================= */
app.get("/ver-usuarios", (req, res) => {
  db.all("SELECT id, email, tipo FROM usuarios", [], (err, rows) => {
    res.json(rows);
  });
});

/* ========================= */
app.listen(PORT, () => {
  console.log(`Servidor funcionando en http://localhost:${PORT}`);
});
