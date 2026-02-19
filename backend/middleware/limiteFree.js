const FREE_LIMIT = 5;

module.exports = function limitarFree(req, res, next) {
  const user = req.user;

  if (user.plan === "PREMIUM") {
    return next();
  }

  if (user.consultas_usadas >= FREE_LIMIT) {
    return res.status(403).json({
      mensaje: "Has alcanzado tu límite gratuito. Actualiza a Premium ⚖️"
    });
  }

  next();
};
