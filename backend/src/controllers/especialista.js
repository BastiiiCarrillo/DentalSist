const bcrypt = require('bcrypt');
const {
  buscarMedicoPorId,
  obtenerCitasPorMedico,
  actualizarEstadoCita,
  obtenerFichaClinica,
  registrarAtencionEnFicha,
  guardarReceta,
  obtenerRecetaPorId,
  validarRutChileno
} = require('../models/dataStore');
const { firmarReceta, verificarFirmaReceta } = require('../services/recetaCrypto');
const { registrarEvento } = require('../services/logger');

function obtenerAgenda(req, res) {
  const { idMedico } = req.params;
  const { fecha } = req.query;

  const medico = buscarMedicoPorId(idMedico);
  if (!medico) {
    return res.status(404).json({ error: 'Medico especialista no encontrado.' });
  }

  const citas = obtenerCitasPorMedico(idMedico, fecha);
  return res.status(200).json({
    medico: { id: medico.id, nombre: medico.nombre, especialidad: medico.especialidad },
    fecha: fecha || 'Todas',
    totalCitas: citas.length,
    citas
  });
}

function cambiarEstado(req, res) {
  const { idCita } = req.params;
  const { nuevoEstado } = req.body;
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';

  try {
    const citaActualizada = actualizarEstadoCita(idCita, nuevoEstado);
    registrarEvento('ESTADO_CITA_ACTUALIZADO', `Cita ${idCita} cambio a ${nuevoEstado}`, ip, citaActualizada.idMedico, 'INFO');
    return res.status(200).json({
      mensaje: 'Estado de cita actualizado exitosamente.',
      cita: citaActualizada
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

function obtenerFichaPaciente(req, res) {
  const { rut } = req.params;

  if (!rut || !validarRutChileno(rut)) {
    return res.status(400).json({ error: 'RUT chileno invalido.' });
  }

  const ficha = obtenerFichaClinica(rut);
  if (!ficha) {
    return res.status(404).json({ error: 'Ficha clinica no encontrada para el paciente consultado.' });
  }

  return res.status(200).json({ ficha });
}

function actualizarFichaConReautenticacion(req, res) {
  const { rut } = req.params;
  const {
    idMedico,
    passwordConfirmacion,
    tipoAtencion,
    diagnostico,
    tratamiento,
    observaciones
  } = req.body;
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';

  if (!rut || !validarRutChileno(rut)) {
    return res.status(400).json({ error: 'RUT chileno invalido.' });
  }

  if (!idMedico) {
    return res.status(400).json({ error: 'Identificador de medico especialista requerido.' });
  }

  const medico = buscarMedicoPorId(idMedico);
  if (!medico) {
    return res.status(404).json({ error: 'Medico especialista no encontrado.' });
  }

  if (!passwordConfirmacion) {
    registrarEvento('REAUTENTICACION_FALLIDA', `Intento de edicion sin contrasena para paciente ${rut}`, ip, idMedico, 'ALERTA');
    return res.status(401).json({
      error: 'Re-autenticacion obligatoria: Debe ingresar su contrasena para registrar o modificar la ficha clinica.'
    });
  }

  const passwordValida = bcrypt.compareSync(passwordConfirmacion, medico.passwordHash);
  if (!passwordValida) {
    registrarEvento('REAUTENTICACION_DENEGADA', `Contrasena incorrecta en modificacion de ficha ${rut}`, ip, idMedico, 'PELIGRO');
    return res.status(403).json({
      error: 'Re-autenticacion fallida: Contrasena de especialista incorrecta.'
    });
  }

  if (!diagnostico || !tratamiento || !tipoAtencion) {
    return res.status(400).json({
      error: 'Debe ingresar tipo de atencion, diagnostico y tratamiento.'
    });
  }

  const registro = registrarAtencionEnFicha(rut, {
    tipoAtencion,
    medicoId: medico.id,
    nombreMedico: medico.nombre,
    diagnostico,
    tratamiento,
    observaciones
  });

  registrarEvento('FICHA_MODIFICADA_CON_EXITO', `Ficha del paciente ${rut} actualizada por ${medico.nombre}`, ip, idMedico, 'INFO');

  return res.status(200).json({
    mensaje: 'Ficha clinica actualizada con re-autenticacion verificada.',
    registro
  });
}

function emitirReceta(req, res) {
  const {
    rutPaciente,
    idMedico,
    medicamentos,
    indicaciones,
    passwordConfirmacion
  } = req.body;
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';

  if (!rutPaciente || !validarRutChileno(rutPaciente)) {
    return res.status(400).json({ error: 'RUT del paciente invalido.' });
  }

  const medico = buscarMedicoPorId(idMedico);
  if (!medico) {
    return res.status(404).json({ error: 'Medico especialista no encontrado.' });
  }

  if (!passwordConfirmacion) {
    return res.status(401).json({ error: 'Re-autenticacion obligatoria: Se requiere contrasena para firmar la receta digital.' });
  }

  const passwordValida = bcrypt.compareSync(passwordConfirmacion, medico.passwordHash);
  if (!passwordValida) {
    registrarEvento('FIRMA_RECETA_DENEGADA', `Firma rechazada por clave invalida para paciente ${rutPaciente}`, ip, idMedico, 'PELIGRO');
    return res.status(403).json({ error: 'Contrasena incorrecta. No se puede firmar la receta.' });
  }

  if (!Array.isArray(medicamentos) || medicamentos.length === 0) {
    return res.status(400).json({ error: 'Debe prescribir al menos un medicamento con su posologia.' });
  }

  const idReceta = `REC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const fechaEmision = new Date().toISOString();

  const recetaBase = {
    id: idReceta,
    rutPaciente,
    idMedico: medico.id,
    nombreMedico: medico.nombre,
    medicamentos,
    indicaciones: indicaciones || 'Seguir indicaciones medicas al pie de la letra.',
    fechaEmision
  };

  const recetaFirmada = firmarReceta(recetaBase);
  guardarReceta(recetaFirmada);

  registrarEvento('RECETA_FIRMADA_EMITIDA', `Receta digital ${idReceta} emitida con HMAC-SHA256 para ${rutPaciente}`, ip, idMedico, 'INFO');

  return res.status(201).json({
    mensaje: 'Receta digital emitida y firmada criptograficamente.',
    receta: recetaFirmada
  });
}

function verificarRecetaPublica(req, res) {
  const { receta } = req.body;
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';

  if (!receta || !receta.id) {
    return res.status(400).json({ error: 'Payload de receta digital requerido.' });
  }

  const esValida = verificarFirmaReceta(receta);

  if (!esValida) {
    registrarEvento('RECETA_ADULTERADA_DETECTADA', `Intento de validacion de receta falsa o modificada: ${receta.id}`, ip, null, 'PELIGRO');
    return res.status(400).json({
      valida: false,
      error: 'Firma criptografica invalida. La receta fue alterada o no fue emitida por DentalSis.'
    });
  }

  registrarEvento('RECETA_VERIFICADA_CORRECTA', `Receta ${receta.id} verificada con exito`, ip, null, 'INFO');
  return res.status(200).json({
    valida: true,
    mensaje: 'Receta digital autentica y firma criptografica HMAC-SHA256 valida.',
    receta: {
      id: receta.id,
      rutPaciente: receta.rutPaciente,
      nombreMedico: receta.nombreMedico,
      fechaEmision: receta.fechaEmision,
      medicamentos: receta.medicamentos,
      indicaciones: receta.indicaciones
    }
  });
}

module.exports = {
  obtenerAgenda,
  cambiarEstado,
  obtenerFichaPaciente,
  actualizarFichaConReautenticacion,
  emitirReceta,
  verificarRecetaPublica
};
