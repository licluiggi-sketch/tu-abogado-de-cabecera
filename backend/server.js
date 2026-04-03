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
   CONFIG
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
   RUTAS BASE (IMPORTANTE)
========================= */
const FRONTEND_PATH = path.join(__dirname, "../frontend");
const PUBLIC_PATH = path.join(__dirname, "../frontend/public");

/* =========================
   STRIPE WEBHOOK
========================= */
app.post("/webhook-stripe", express.raw({ type: "application/json" }), (req, res) => {
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

/* =========================
   SERVIR FRONTEND + PWA
========================= */
app.use(express.static(FRONTEND_PATH));
app.use(express.static(PUBLIC_PATH));

/* =========================
   RUTA PRINCIPAL
========================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "index.html"));
});

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

  if (!email || !password) {
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
   RESET USUARIOS (TEMPORAL)
========================= */
app.get("/reset", (req, res) => {
  db.run("DELETE FROM usuarios", (err) => {
    if (err) {
      return res.send("Error al eliminar usuarios");
    }
    res.send("Usuarios eliminados");
  });
});

app.get("/usuarios", (req, res) => {
  db.all("SELECT * FROM usuarios", (err, rows) => {
    res.json(rows);
  });
});

/* ========================= */
app.listen(PORT, () => {
  console.log(`🚀 Servidor funcionando en puerto ${PORT}`);
});