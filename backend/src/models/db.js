const store = require('./dataStore');

const db = {
  obtenerEspecialistas: () => store.obtenerEspecialistas(),
  obtenerEspecialistaPorId: (id) => store.obtenerEspecialistaPorId(id),
  obtenerSillones: () => store.obtenerSillones(),
  obtenerCitas: () => store.obtenerCitas(),
  obtenerCitaPorId: (id) => store.obtenerCitaPorId(id),
  crearCita: (datos) => store.crearCita(datos),
  actualizarEstadoCita: (id, estado) => store.actualizarEstadoCita(id, estado),
  obtenerPacientes: () => store.obtenerPacientes(),
  obtenerPacientePorRut: (rut) => store.obtenerPacientePorRut(rut),
  crearPaciente: (datos) => store.crearPaciente(datos),
  obtenerFichaClinicaPorPacienteId: (pacienteId) => store.obtenerFichaClinicaPorPacienteId(pacienteId),
  actualizarFichaClinica: (pacienteId, datos) => store.actualizarFichaClinica(pacienteId, datos),
  crearReceta: (datos) => store.crearReceta(datos),
  obtenerRecetaPorFolio: (folio) => store.obtenerRecetaPorFolio(folio),
  validarRutChileno: (rut) => store.validarRutChileno(rut)
};

module.exports = db;
