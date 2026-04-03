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
const rateLimit = require("express-rate-limit");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

/* =========================
   PUERTO Y SECRET
========================= */
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "abogado_secret_2026";

/* =========================
   RATE LIMIT
========================= */
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
});

/* =========================
   STRIPE WEBHOOK (ANTES de json)
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

  console.log("📩 Evento:", event.type);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    stripe.subscriptions.retrieve(session.subscription)
      .then(subscription => {

        const status = subscription.status;
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
          [
            tipo,
            session.customer,
            session.subscription,
            status,
            subscription.items.data[0].price.id,
            session.customer_email
          ]
        );
      });
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;

    db.run(
      `UPDATE usuarios 
       SET tipo = 'FREE',
           subscription_status = ?
       WHERE stripe_subscription_id = ?`,
      [subscription.status, subscription.id]
    );
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;

    db.run(
      `UPDATE usuarios 
       SET tipo = 'FREE',
           subscription_status = 'past_due'
       WHERE stripe_subscription_id = ?`,
      [invoice.subscription]
    );
  }

  res.json({ received: true });
});

/* =========================
   MIDDLEWARES
========================= */
app.use(cors({
  origin: process.env.BASE_URL,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// 🔥 SERVIR FRONTEND + PWA
app.use(express.static(path.join(__dirname, "frontend")));
app.use(express.static(path.join(__dirname, "frontend/public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

/* =========================
   BASE SQLITE
========================= */
const db = new sqlite3.Database("./abogado.db");

db.run(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    tipo TEXT DEFAULT 'FREE',
    consultas_hoy INTEGER DEFAULT 0,
    consultas_total INTEGER DEFAULT 0,
    ultima_consulta TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    subscription_status TEXT DEFAULT 'inactive',
    subscription_plan TEXT
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
   OPENAI
========================= */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================
   JWT
========================= */
function verificarToken(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) return res.status(401).json({ error: "Token requerido" });

  const token = header.split(" ")[1];

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Token inválido" });
    req.usuario = decoded;
    next();
  });
}

/* =========================
   REGISTER
========================= */
app.post("/register", async (req, res) => {

  const { email, password, captchaToken } = req.body;

  if (!email || !password || !captchaToken) {
    return res.json({ success: false });
  }

  try {

    const verify = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: process.env.TURNSTILE_SECRET,
          response: captchaToken
        })
      }
    );

    const captchaData = await verify.json();
    if (!captchaData.success) return res.json({ success: false });

    const hashed = bcrypt.hashSync(password, 10);

    db.run(
      "INSERT INTO usuarios (email, password) VALUES (?, ?)",
      [email, hashed],
      function (err) {
        if (err) return res.json({ success: false });
        res.json({ success: true });
      }
    );

  } catch {
    res.json({ success: false });
  }

});

/* =========================
   LOGIN
========================= */
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, user) => {
    if (!user) return res.json({ success: false });

    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) return res.json({ success: false });

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
app.post("/consulta", verificarToken, chatLimiter, async (req, res) => {

  const origin = req.headers.origin;
  if (origin !== process.env.BASE_URL) {
    return res.status(403).json({ respuesta: "Acceso no permitido" });
  }

  const userId = req.usuario.id;
  const pregunta = req.body.pregunta;

  if (!pregunta || pregunta.length > 2000) {
    return res.json({ respuesta: "Pregunta inválida" });
  }

  db.get("SELECT * FROM usuarios WHERE id = ?", [userId], async (err, user) => {

    if (!user) return res.status(404).json({ respuesta: "Usuario no encontrado" });

    const hoy = new Date().toISOString().split("T")[0];
    let consultasHoy = user.consultas_hoy;

    if (user.ultima_consulta !== hoy) consultasHoy = 0;

    const LIMITE_FREE = 2;
    const esPremiumActivo = ["active", "trialing"].includes(user.subscription_status);

    if (!esPremiumActivo && consultasHoy >= LIMITE_FREE) {
      return res.json({
        respuesta: "Has alcanzado el límite FREE",
        limite: true
      });
    }

    try {

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Eres un abogado experto en derecho mexicano." },
          { role: "user", content: pregunta }
        ],
        max_tokens: 800
      });

      const respuestaIA = completion.choices[0].message.content;

      db.run(
        "INSERT INTO consultas (usuario_id, pregunta, respuesta) VALUES (?, ?, ?)",
        [userId, pregunta, respuestaIA]
      );

      db.run(
        "UPDATE usuarios SET consultas_total = consultas_total + 1 WHERE id=?",
        [userId]
      );

      if (!esPremiumActivo) {
        db.run(
          "UPDATE usuarios SET consultas_hoy = ?, ultima_consulta = ? WHERE id = ?",
          [consultasHoy + 1, hoy, userId]
        );
      }

      res.json({ respuesta: respuestaIA });

    } catch {
      res.status(500).json({ respuesta: "Error IA" });
    }
  });
});

/* =========================
   ESTADO
========================= */
app.get("/estado", verificarToken, (req, res) => {
  db.get(
    "SELECT tipo, consultas_hoy, subscription_status FROM usuarios WHERE id = ?",
    [req.usuario.id],
    (err, user) => res.json(user)
  );
});

/* =========================
   HISTORIAL
========================= */
app.get("/historial", verificarToken, (req, res) => {
  db.all(
    "SELECT pregunta, respuesta, fecha FROM consultas WHERE usuario_id = ?",
    [req.usuario.id],
    (err, rows) => res.json(rows)
  );
});

/* =========================
   STRIPE CHECKOUT
========================= */
app.post("/crear-sesion-checkout", verificarToken, async (req, res) => {

  db.get("SELECT email FROM usuarios WHERE id = ?", [req.usuario.id], async (err, user) => {

    const baseUrl = process.env.BASE_URL;

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
      subscription_data: { trial_period_days: 7 },
      success_url: `${baseUrl}/chat.html`,
      cancel_url: `${baseUrl}/chat.html`,
    });

    res.json({ url: session.url });
  });
});

/* ========================= */
app.listen(PORT, () => {
  console.log(`🚀 Servidor funcionando en puerto ${PORT}`);
});