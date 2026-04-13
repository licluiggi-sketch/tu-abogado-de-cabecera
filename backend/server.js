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
const nodemailer = require("nodemailer");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

/* =========================
   CONFIGURACIÓN
========================= */
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "abogado_secret_2026";

/* =========================
   RATE LIMIT
========================= */
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
});

/* =========================
   RUTAS FRONTEND
========================= */
const FRONTEND_PATH = path.join(__dirname, "../frontend");
const PUBLIC_PATH = path.join(__dirname, "../frontend/public");

/* =========================
   STRIPE WEBHOOK
========================= */
app.post("/webhook-stripe", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("⚠️ Error en webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log("📩 Evento recibido:", event.type);

  // Pago completado
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
          ],
          function (err) {
            if (err) {
              console.error("❌ Error actualizando usuario:", err.message);
            } else {
              console.log("✅ Usuario actualizado a PREMIUM:", session.customer_email);
            }
          }
        );
      });
  }

  // Cancelación de suscripción
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;

    db.run(
      `UPDATE usuarios 
       SET tipo = 'FREE', subscription_status = ?
       WHERE stripe_subscription_id = ?`,
      [subscription.status, subscription.id]
    );
  }

  // Pago fallido
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;

    db.run(
      `UPDATE usuarios 
       SET tipo = 'FREE', subscription_status = 'past_due'
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
  origin: function (origin, callback) {
    // Permite solicitudes sin origen (como Postman o apps móviles)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      process.env.BASE_URL,
      "http://localhost:3000",
      "http://127.0.0.1:5500"
    ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("No permitido por CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

/* =========================
   HEALTH CHECK
========================= */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* =========================
   BASE DE DATOS SQLITE
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

db.run(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    token TEXT,
    expires DATETIME
  )
`);

/* =========================
   OPENAI
========================= */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================
   CONFIGURACIÓN DE EMAIL
========================= */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
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
app.post("/register", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.json({ success: false });
  }

  const hashed = bcrypt.hashSync(password, 10);

  db.run(
    "INSERT INTO usuarios (email, password) VALUES (?, ?)",
    [email, hashed],
    function (err) {
      if (err) {
        console.log("ERROR REGISTRO:", err.message);
        return res.json({ success: false, error: err.message });
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

  db.get(
    "SELECT * FROM usuarios WHERE email = ?",
    [email],
    (err, user) => {
      if (!user) return res.json({ success: false });

      const ok = bcrypt.compareSync(password, user.password);
      if (!ok) return res.json({ success: false });

      const token = jwt.sign(
        { id: user.id, email: user.email },
        SECRET,
        { expiresIn: "2h" }
      );

      res.json({ success: true, token });
    }
  );
});

/* =========================
   SOLICITAR RECUPERACIÓN
========================= */
app.post("/recuperar-password", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.json({ success: false, message: "Correo requerido" });
  }

  db.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, user) => {
    if (!user) {
      return res.json({ success: false, message: "Usuario no encontrado" });
    }

    const crypto = require("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hora

    db.run(
      "INSERT INTO password_resets (email, token, expires) VALUES (?, ?, ?)",
      [email, token, expires]
    );

    const resetLink = `${process.env.BASE_URL}/reset-password.html?token=${token}`;

    const mailOptions = {
      from: `"Tu Abogado de Cabecera" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Recuperación de Contraseña",
      html: `
        <h2>Recuperación de Contraseña</h2>
        <p>Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>Este enlace expirará en 1 hora.</p>
      `,
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) {
        console.error(error);
        return res.json({ success: false });
      }
      res.json({ success: true });
    });
  });
});

/* =========================
   RESTABLECER CONTRASEÑA
========================= */
app.post("/reset-password", (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.json({ success: false });
  }

  db.get(
    "SELECT * FROM password_resets WHERE token = ?",
    [token],
    (err, record) => {
      if (!record) {
        return res.json({ success: false, message: "Token inválido" });
      }

      if (new Date(record.expires) < new Date()) {
        return res.json({ success: false, message: "Token expirado" });
      }

      const hashed = bcrypt.hashSync(password, 10);

      db.run(
        "UPDATE usuarios SET password = ? WHERE email = ?",
        [hashed, record.email],
        () => {
          db.run("DELETE FROM password_resets WHERE email = ?", [record.email]);
          res.json({ success: true });
        }
      );
    }
  );
});

/* =========================
   CONSULTA IA
========================= */
app.post("/consulta", verificarToken, chatLimiter, async (req, res) => {
  try {
    const userId = req.usuario.id;
    const { pregunta } = req.body;

    // Validar pregunta
    if (!pregunta || typeof pregunta !== "string" || pregunta.trim().length === 0) {
      return res.status(400).json({ respuesta: "Pregunta inválida" });
    }

    if (pregunta.length > 2000) {
      return res.status(400).json({ respuesta: "La pregunta es demasiado larga" });
    }

    // Obtener usuario
    db.get(
      "SELECT * FROM usuarios WHERE id = ?",
      [userId],
      async (err, user) => {
        if (err) {
          console.error("Error DB:", err.message);
          return res.status(500).json({ respuesta: "Error en la base de datos" });
        }

        if (!user) {
          return res.status(404).json({ respuesta: "Usuario no encontrado" });
        }

        // Control de consultas diarias
        const hoy = new Date().toISOString().split("T")[0];
        let consultasHoy = user.consultas_hoy || 0;

        if (user.ultima_consulta !== hoy) {
          consultasHoy = 0;
        }

        const LIMITE_FREE = 2;
        const esPremiumActivo =
          ["active", "trialing"].includes(user.subscription_status) ||
          user.tipo === "PREMIUM";

        if (!esPremiumActivo && consultasHoy >= LIMITE_FREE) {
          return res.json({
            respuesta: "Has alcanzado el límite FREE",
            limite: true,
          });
        }

        try {
          // Consulta a OpenAI
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `
Eres un abogado profesional experto en derecho mexicano.

IMPORTANTE:
1. Da respuestas claras, bien estructuradas y profesionales.
2. Si no tienes información actualizada (por ejemplo, salarios, montos o fechas recientes), indícalo claramente.
3. NO inventes datos actuales.
4. Cuando sea posible, cita leyes reales:
   - Constitución Política de los Estados Unidos Mexicanos
   - Ley Federal del Trabajo
   - Código Civil Federal
   - Código Penal Federal
   - Ley de Amparo
   - Código de Comercio
   - Código Fiscal de la Federación
   - Ley Agraria
   - Ley del Seguro Social e INFONAVIT
   - Jurisprudencia
5. Explica todo en lenguaje sencillo y profesional.

FORMATO:
📜 Fundamento legal
📖 Explicación
✅ Qué puedes hacer

Incluye siempre al final:
"⚖️ Esta información es orientativa y no sustituye asesoría legal profesional."
                `,
              },
              {
                role: "user",
                content: pregunta,
              },
            ],
            max_tokens: 800,
            temperature: 0.3,
          });

          const respuestaIA =
            completion.choices?.[0]?.message?.content ||
            "No se pudo generar una respuesta.";

          // Guardar consulta
          db.run(
            "INSERT INTO consultas (usuario_id, pregunta, respuesta) VALUES (?, ?, ?)",
            [userId, pregunta, respuestaIA],
            (err) => {
              if (err) {
                console.error("Error guardando consulta:", err.message);
              }
            }
          );

          // Actualizar estadísticas
          db.run(
            "UPDATE usuarios SET consultas_total = consultas_total + 1 WHERE id = ?",
            [userId]
          );

          if (!esPremiumActivo) {
            db.run(
              "UPDATE usuarios SET consultas_hoy = ?, ultima_consulta = ? WHERE id = ?",
              [consultasHoy + 1, hoy, userId]
            );
          }

          return res.json({ respuesta: respuestaIA });

        } catch (error) {
          console.error("Error OpenAI:", error.message);
          return res.status(500).json({
            respuesta: "Error al consultar la IA. Inténtalo nuevamente.",
          });
        }
      }
    );
  } catch (error) {
    console.error("Error en /consulta:", error);
    return res.status(500).json({ respuesta: "Error interno del servidor" });
  }
});

/* =========================
   ESTADO DEL USUARIO
========================= */
app.get("/estado", verificarToken, (req, res) => {
  db.get(
    "SELECT tipo, consultas_hoy, subscription_status FROM usuarios WHERE id = ?",
    [req.usuario.id],
    (err, user) => {
      if (err || !user) {
        return res
          .status(404)
          .json({ error: "Usuario no encontrado" });
      }
      res.json(user);
    }
  );
});

/* =========================
   HISTORIAL
========================= */
app.get("/historial", verificarToken, (req, res) => {
  db.all(
    "SELECT pregunta, respuesta, fecha FROM consultas WHERE usuario_id = ? ORDER BY fecha DESC",
    [req.usuario.id],
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

/* =========================
   STRIPE CHECKOUT
========================= */
app.post("/crear-sesion-checkout", verificarToken, async (req, res) => {
  try {
    db.get(
      "SELECT email FROM usuarios WHERE id = ?",
      [req.usuario.id],
      async (err, user) => {
        if (err || !user) {
          console.error("Error obteniendo usuario:", err);
          return res.status(500).json({ error: "Usuario no encontrado" });
        }

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
      }
    );
  } catch (error) {
    console.error("Error Stripe:", error.message);
    res.status(500).json({ error: "Error al crear sesión de pago" });
  }
});

/* =========================
   RUTAS DE PRUEBA
========================= */
app.get("/reset", (req, res) => {
  db.run("DELETE FROM usuarios", () => {
    res.send("Usuarios eliminados");
  });
});

app.get("/usuarios", (req, res) => {
  db.all("SELECT * FROM usuarios", (err, rows) => {
    res.json(rows);
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* =========================
   SERVIR FRONTEND + PWA
========================= */
app.use(express.static(FRONTEND_PATH));
app.use(express.static(PUBLIC_PATH));

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, "index.html"));
});

app.use((err, req, res, next) => {
  console.error("❌ Error interno:", err.stack);
  res.status(500).json({ error: "Error interno del servidor" });
});

/* =========================
   INICIAR SERVIDOR
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Servidor funcionando en puerto ${PORT}`);
});