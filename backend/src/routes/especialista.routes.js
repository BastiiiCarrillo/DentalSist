const express = require('express');
const router = express.Router();
const {
  obtenerAgenda,
  cambiarEstado,
  obtenerFichaPaciente,
  actualizarFichaConReautenticacion,
  emitirReceta,
  verificarRecetaPublica
} = require('../controllers/especialista');
const { limiteOperacionesSensibles } = require('../middleware/seguridad');

router.get('/agenda/:idMedico', obtenerAgenda);
router.patch('/citas/:idCita/estado', cambiarEstado);
router.get('/ficha/:rut', obtenerFichaPaciente);
router.post('/ficha/:rut', limiteOperacionesSensibles, actualizarFichaConReautenticacion);
router.post('/recetas', limiteOperacionesSensibles, emitirReceta);
router.post('/recetas/verificar', verificarRecetaPublica);

module.exports = router;
