const express = require('express');
const router = express.Router();
const { login, registro, actualizarPassword } = require('../controllers/auth.controller');
const { verificarBloqueoEscalonado } = require('../middleware/seguridad');

router.post('/login', verificarBloqueoEscalonado, login);
router.post('/registro', registro);
router.post('/cambiar-password', actualizarPassword);

module.exports = router;
