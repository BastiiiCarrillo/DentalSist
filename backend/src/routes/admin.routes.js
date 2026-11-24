const express = require('express');
const router = express.Router();
const {
  obtenerResumenAdmin,
  obtenerMedicosAdmin,
  obtenerPacientesAdmin,
  obtenerDetallePacienteAdmin,
  obtenerRecetasAdmin,
  obtenerLogsAdmin
} = require('../controllers/admin');
const { verificarToken, verificarRol } = require('../controllers/auth.controller');

router.use(verificarToken, verificarRol('SuperAdmin', 'Admin'));

router.get('/resumen', obtenerResumenAdmin);
router.get('/medicos', obtenerMedicosAdmin);
router.get('/pacientes', obtenerPacientesAdmin);
router.get('/pacientes/:rut/detalle', obtenerDetallePacienteAdmin);
router.get('/recetas', obtenerRecetasAdmin);
router.get('/logs', obtenerLogsAdmin);

module.exports = router;
