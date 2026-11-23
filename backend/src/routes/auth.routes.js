const express = require('express');
const router = express.Router();
const { login, registro, actualizarPassword, verificarToken } = require('../controllers/auth.controller');
const { verificarBloqueoEscalonado, limiteOperacionesSensibles } = require('../middleware/seguridad');

router.post('/login', verificarBloqueoEscalonado, login);
router.post('/registro', registro);
router.post('/cambiar-password', verificarToken, limiteOperacionesSensibles, actualizarPassword);

module.exports = router;
