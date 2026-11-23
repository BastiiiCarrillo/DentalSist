const {
  validarRutChileno,
  obtenerMedicosDisponibles,
  crearCita,
  obtenerCitasPorPaciente
} = require('../models/dataStore');
const { registrarEvento } = require('../services/logger');

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validarDatosReserva(body) {
  const { rut, nombre, email, telefono, idMedico, fecha, hora } = body;

  if (!rut || !validarRutChileno(rut)) {
    return 'RUT chileno invalido conforme a verificacion Modulo 11.';
  }

  if (!nombre || typeof nombre !== 'string' || nombre.trim().length < 3) {
    return 'El nombre completo del paciente es obligatorio y debe tener al menos 3 caracteres.';
  }

  if (!email || !REGEX_EMAIL.test(email)) {
    return 'Formato de correo electronico invalido.';
  }

  if (!telefono || typeof telefono !== 'string' || telefono.trim().length < 8) {
    return 'El telefono de contacto es obligatorio.';
  }

  if (!idMedico) {
    return 'Debe seleccionar un medico especialista.';
  }

  if (!fecha || !hora) {
    return 'Debe seleccionar una fecha y bloque horario validos.';
  }

  return null;
}

function reservarCita(req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
  const errorValidacion = validarDatosReserva(req.body);

  if (errorValidacion) {
    registrarEvento('RESERVA_RECHAZADA', errorValidacion, ip, req.body.rut, 'ALERTA');
    return res.status(400).json({ error: errorValidacion });
  }

  try {
    const cita = crearCita({
      rutPaciente: req.body.rut,
      nombrePaciente: req.body.nombre.trim(),
      emailPaciente: req.body.email.trim().toLowerCase(),
      telefonoPaciente: req.body.telefono.trim(),
      idMedico: req.body.idMedico,
      fecha: req.body.fecha,
      hora: req.body.hora,
      especialidad: req.body.especialidad,
      esInvitado: req.body.esInvitado !== false
    });

    registrarEvento('RESERVA_CONFIRMADA', `Cita ${cita.id} agendada para ${cita.rutFormateado}`, ip, cita.rutPaciente, 'INFO');
    return res.status(201).json({
      mensaje: 'Cita reservada exitosamente.',
      cita
    });
  } catch (error) {
    registrarEvento('CONFLICTO_RESERVA', error.message, ip, req.body.rut, 'ALERTA');
    return res.status(409).json({ error: error.message });
  }
}

function consultarDisponibilidad(req, res) {
  const { especialidad, fecha, hora } = req.query;

  if (!fecha || !hora) {
    return res.status(400).json({ error: 'Se requiere especificar fecha y hora.' });
  }

  const medicosDisponibles = obtenerMedicosDisponibles(especialidad, fecha, hora);
  return res.status(200).json({
    fecha,
    hora,
    especialidad: especialidad || 'Todas',
    disponibles: medicosDisponibles
  });
}

function consultarMisCitas(req, res) {
  const { rut } = req.params;

  if (!rut || !validarRutChileno(rut)) {
    return res.status(400).json({ error: 'RUT chileno invalido.' });
  }

  if (req.usuario) {
    const rol = (req.usuario.rol || '').toUpperCase();
    const esPersonalClinico = rol === 'ADMIN' || rol === 'SUPERADMIN' || rol === 'ODONTOLOGO' || rol === 'RECEPCIONISTA';
    if (!esPersonalClinico && req.usuario.rut) {
      const rutToken = req.usuario.rut.replace(/[^0-9kK]/g, '').toUpperCase();
      const rutParam = rut.replace(/[^0-9kK]/g, '').toUpperCase();
      if (rutToken !== rutParam) {
        return res.status(403).json({ error: 'Acceso denegado: No tiene autorizacion para consultar citas de otro paciente.' });
      }
    }
  }

  const citas = obtenerCitasPorPaciente(rut);
  return res.status(200).json({
    rut,
    total: citas.length,
    citas
  });
}

module.exports = {
  reservarCita,
  consultarDisponibilidad,
  consultarMisCitas,
  validarDatosReserva
};
