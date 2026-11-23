const express = require('express');
const router = express.Router();
const {
  reservarCita,
  consultarDisponibilidad,
  consultarMisCitas
} = require('../controllers/paciente');
const { limiteOperacionesSensibles } = require('../middleware/seguridad');

router.post('/reservar', limiteOperacionesSensibles, reservarCita);
router.get('/disponibilidad', consultarDisponibilidad);
router.get('/citas/:rut', consultarMisCitas);

module.exports = router;
