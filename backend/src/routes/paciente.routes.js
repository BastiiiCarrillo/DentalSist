const express = require('express');
const router = express.Router();
const {
  reservarCita,
  consultarDisponibilidad,
  consultarMisCitas,
  cancelarCitaPaciente
} = require('../controllers/paciente');
const { verificarToken } = require('../controllers/auth.controller');
const { limiteOperacionesSensibles } = require('../middleware/seguridad');

router.post('/reservar', limiteOperacionesSensibles, reservarCita);
router.get('/disponibilidad', consultarDisponibilidad);
router.get('/mis-citas', verificarToken, consultarMisCitas);
router.get('/citas/:rut', verificarToken, consultarMisCitas);
router.post('/citas/:idCita/cancelar', verificarToken, limiteOperacionesSensibles, cancelarCitaPaciente);

module.exports = router;
