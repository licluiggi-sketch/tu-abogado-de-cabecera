const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const limitarFree = require("../middleware/limiteFree");

// POST /chat
router.post("/", auth, limitarFree, async (req, res) => {
  const user = req.user;
  const { pregunta } = req.body;

  // AQUÍ VA TU IA (por ahora simulamos)
  const respuestaIA = "Respuesta legal generada ⚖️";

  // Incrementar contador si es FREE
  if (user.plan === "FREE") {
    user.consultas_usadas += 1;
    await user.save();
  }

  res.json({
    respuesta: respuestaIA,
    consultas_usadas: user.consultas_usadas,
    plan: user.plan
  });
});

module.exports = router;
