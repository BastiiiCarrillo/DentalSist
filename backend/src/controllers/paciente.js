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

  const ahora = new Date();
  const hoy0 = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const partesFecha = (fecha || '').split('-').map(Number);
  if (partesFecha.length !== 3 || partesFecha.some(isNaN)) {
    return 'Debe seleccionar una fecha valida.';
  }
  const fRes = new Date(partesFecha[0], partesFecha[1] - 1, partesFecha[2]);
  if (isNaN(fRes.getTime()) || fRes < hoy0) {
    return 'No es posible agendar citas en fechas pasadas.';
  }

  if (fRes.getTime() === hoy0.getTime()) {
    const [hStr, mStr] = (hora || '').split(':');
    const hNum = parseInt(hStr, 10);
    const mNum = parseInt(mStr || '0', 10);
    if (isNaN(hNum)) {
      return 'Debe seleccionar un bloque horario valido.';
    }
    const ahoraMinutos = ahora.getHours() * 60 + ahora.getMinutes();
    const citaMinutos = hNum * 60 + mNum;
    if (citaMinutos <= ahoraMinutos) {
      return 'No es posible agendar citas en horarios pasados.';
    }
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

    try {
      const db = require('../models/db');
      if (db.obtenerPool()) {
        const partes = req.body.nombre.trim().split(' ');
        const nom = partes[0] || 'Paciente';
        const ape = partes.slice(1).join(' ') || 'Registrado';
        db.query(
          'INSERT INTO pacientes (rut, nombre, apellido, fecha_nacimiento, telefono, email) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (rut) DO UPDATE SET telefono = EXCLUDED.telefono, email = EXCLUDED.email RETURNING id;',
          [cita.rutFormateado, nom, ape, '2000-01-01', req.body.telefono.trim(), req.body.email.trim().toLowerCase()]
        ).then(async (resPac) => {
          let pacId = (resPac && resPac.rows && resPac.rows[0]) ? resPac.rows[0].id : null;
          if (!pacId) {
            const rBusq = await db.query('SELECT id FROM pacientes WHERE rut = $1;', [cita.rutFormateado]);
            if (rBusq.rows.length > 0) pacId = rBusq.rows[0].id;
          }
          if (pacId) {
            let espUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
            let sillon = 1;
            try {
              const rEsp = await db.query(
                'SELECT id, sillon_habitual FROM especialistas WHERE id::text = $1 OR nombre ILIKE $2 OR email ILIKE $3 LIMIT 1;',
                [cita.idMedico, `%${cita.nombreMedico}%`, `%${cita.idMedico}%`]
              );
              if (rEsp.rows && rEsp.rows.length > 0) {
                espUuid = rEsp.rows[0].id;
                sillon = rEsp.rows[0].sillon_habitual || 1;
              } else if (cita.idMedico === 'DOC-2' || (cita.especialidad && cita.especialidad.includes('General'))) {
                espUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
                sillon = 2;
              } else if (cita.idMedico === 'DOC-3' || (cita.especialidad && cita.especialidad.includes('Endodoncia'))) {
                espUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
                sillon = 3;
              } else if (cita.idMedico === 'DOC-4' || (cita.especialidad && cita.especialidad.includes('Ortodoncia'))) {
                espUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
                sillon = 4;
              }
            } catch (eEsp) {}
            const horaInicio = cita.hora.length === 5 ? cita.hora + ':00' : cita.hora;
            const partesHora = cita.hora.split(':');
            const h = parseInt(partesHora[0], 10);
            const m = parseInt(partesHora[1] || '0', 10);
            const finMin = m + 45;
            const horaFin = (finMin >= 60 ? `${String(h + 1).padStart(2, '0')}:${String(finMin - 60).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:${String(finMin).padStart(2, '0')}:00`);

            await db.query(
              'INSERT INTO citas (paciente_id, especialista_id, sillon_numero, fecha, hora_inicio, hora_fin, tipo_consulta, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING;',
              [pacId, espUuid, sillon, cita.fecha, horaInicio, horaFin, cita.especialidad || 'Consulta Odontologica', 'CONFIRMADA']
            );
          }
        }).catch(() => {});
      }
    } catch (eDb) {
    }

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

async function consultarMisCitas(req, res) {
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

  const rutLimpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  let citas = obtenerCitasPorPaciente(rut);

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rDb = await db.query(
        'SELECT c.id, c.fecha, c.hora_inicio as hora, c.tipo_consulta as especialidad, c.estado, c.sillon_numero as sillon, e.nombre as "nombreMedico" FROM citas c JOIN pacientes p ON c.paciente_id = p.id LEFT JOIN especialistas e ON c.especialista_id = e.id WHERE REPLACE(REPLACE(p.rut, $1, $2), $3, $4) = $5 ORDER BY c.fecha DESC, c.hora_inicio DESC;',
        ['.', '', '-', '', rutLimpio]
      );
      if (rDb.rows && rDb.rows.length > 0) {
        citas = rDb.rows.map(r => ({
          id: r.id,
          fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : String(r.fecha).substring(0, 10),
          hora: String(r.hora).substring(0, 5),
          especialidad: r.especialidad,
          estado: r.estado,
          sillon: 'Sillón ' + r.sillon,
          nombreMedico: r.nombreMedico || 'Especialista Dental'
        }));
      }
    }
  } catch (eDb) {
  }

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
