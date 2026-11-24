const express = require('express');
const router = express.Router();
const {
  obtenerResumenAdmin,
  obtenerMedicosAdmin,
  obtenerPacientesAdmin,
  obtenerDetallePacienteAdmin,
  obtenerRecetasAdmin,
  obtenerLogsAdmin,
  obtenerUsuariosResetAdmin,
  restablecerPasswordUsuarioAdmin
} = require('../controllers/admin');
const { verificarToken, verificarRol } = require('../controllers/auth.controller');
const { limiteOperacionesSensibles } = require('../middleware/seguridad');

router.use(verificarToken, verificarRol('SuperAdmin', 'Admin'));

router.get('/resumen', obtenerResumenAdmin);
router.get('/medicos', obtenerMedicosAdmin);
router.get('/pacientes', obtenerPacientesAdmin);
router.get('/pacientes/:rut/detalle', obtenerDetallePacienteAdmin);
router.get('/recetas', obtenerRecetasAdmin);
router.get('/logs', obtenerLogsAdmin);
router.get('/usuarios', obtenerUsuariosResetAdmin);
router.post('/usuarios/restablecer-password', limiteOperacionesSensibles, restablecerPasswordUsuarioAdmin);

module.exports = router;
