const express = require('express');
const router = express.Router();
const {
  obtenerAgenda,
  cambiarEstado,
  obtenerFichaPaciente,
  autorizarAccesoHistorial,
  actualizarFichaConReautenticacion,
  emitirReceta,
  verificarRecetaPublica,
  ingresarTurno
} = require('../controllers/especialista');
const { verificarToken, verificarRol } = require('../controllers/auth.controller');
const { limiteOperacionesSensibles } = require('../middleware/seguridad');

router.get('/agenda/:idMedico', verificarToken, verificarRol('Odontologo', 'SuperAdmin'), obtenerAgenda);
router.patch('/citas/:idCita/estado', verificarToken, verificarRol('Odontologo', 'SuperAdmin'), cambiarEstado);
router.get('/ficha/:rut', verificarToken, verificarRol('Odontologo', 'SuperAdmin'), obtenerFichaPaciente);
router.post('/acceso-historial', verificarToken, verificarRol('Odontologo', 'SuperAdmin'), limiteOperacionesSensibles, autorizarAccesoHistorial);
router.post('/ficha/:rut', verificarToken, verificarRol('Odontologo'), limiteOperacionesSensibles, actualizarFichaConReautenticacion);
router.post('/recetas', verificarToken, verificarRol('Odontologo'), limiteOperacionesSensibles, emitirReceta);
router.post('/turnos', verificarToken, verificarRol('Odontologo'), limiteOperacionesSensibles, ingresarTurno);
router.post('/recetas/verificar', verificarRecetaPublica);

module.exports = router;
