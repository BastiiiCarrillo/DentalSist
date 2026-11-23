const express = require('express');
const router = express.Router();
const {
  reservarCita,
  consultarDisponibilidad,
  consultarMisCitas
} = require('../controllers/paciente');
const { verificarToken } = require('../controllers/auth.controller');
const { limiteOperacionesSensibles } = require('../middleware/seguridad');

router.post('/reservar', limiteOperacionesSensibles, reservarCita);
router.get('/disponibilidad', consultarDisponibilidad);
router.get('/citas/:rut', verificarToken, consultarMisCitas);

module.exports = router;
