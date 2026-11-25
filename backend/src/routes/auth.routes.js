const express = require('express');
const router = express.Router();
const {
  login,
  logout,
  obtenerSesionActual,
  registro,
  actualizarPassword,
  completarPasswordTemporal,
  verificarToken,
  verificarTokenCambioTemporal
} = require('../controllers/auth.controller');
const { verificarBloqueoEscalonado, limiteOperacionesSensibles } = require('../middleware/seguridad');

router.post('/login', verificarBloqueoEscalonado, login);
router.post('/logout', logout);
router.get('/sesion', obtenerSesionActual);
router.post('/registro', registro);
router.post('/cambiar-password', verificarToken, limiteOperacionesSensibles, actualizarPassword);
router.post('/completar-password-temporal', verificarTokenCambioTemporal, limiteOperacionesSensibles, completarPasswordTemporal);

module.exports = router;
