const {
  validarRutChileno,
  obtenerMedicosDisponibles,
  crearCita,
  obtenerCitasPorPaciente,
  obtenerFichaClinica,
  obtenerRecetasPorPaciente
} = require('../models/dataStore');
const { registrarEvento } = require('../services/logger');

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validarDatosReserva(body) {
  const { rut, nombre, email, telefono, idMedico, fecha, hora } = body;

  if (!rut || !validarRutChileno(rut)) {
    return 'RUT chileno invalido conforme a verificacion Modulo 11.';
  }

  if (!nombre || typeof nombre !== 'string' || nombre.trim().length < 3 || /\d/.test(nombre) || !/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/.test(nombre.trim())) {
    return 'El nombre completo del paciente es obligatorio y solo debe contener letras (minimo 3 caracteres).';
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

async function mapearEspecialista(idMedico, especialidad, nombre) {
  const MAPA = {
    'DOC-1': { espUuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', sillon: 1 },
    'DOC-2': { espUuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', sillon: 2 },
    'DOC-3': { espUuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', sillon: 3 },
    'DOC-4': { espUuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', sillon: 4 },
    'DOC-5': { espUuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', sillon: 2 },
    'DOC-6': { espUuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', sillon: 2 },
    'DOC-7': { espUuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', sillon: 3 }
  };
  if (idMedico && MAPA[idMedico]) {
    return MAPA[idMedico];
  }
  const db = require('../models/db');
  if (db.obtenerPool() && (idMedico || nombre)) {
    try {
      const condiciones = [];
      const params = [];
      if (idMedico && idMedico.length > 20) {
        params.push(idMedico);
        condiciones.push(`id::text = $${params.length}`);
      }
      if (nombre && nombre.trim().length > 2) {
        params.push(`%${nombre.trim()}%`);
        condiciones.push(`nombre ILIKE $${params.length}`);
      }
      if (condiciones.length > 0) {
        const rEsp = await db.query(
          `SELECT id, sillon_habitual FROM especialistas WHERE ${condiciones.join(' OR ')} LIMIT 1;`,
          params
        );
        if (rEsp.rows && rEsp.rows.length > 0) {
          return { espUuid: rEsp.rows[0].id, sillon: rEsp.rows[0].sillon_habitual || 1 };
        }
      }
    } catch (e) {}
  }
  if (especialidad) {
    if (especialidad.toLowerCase().includes('general')) return MAPA['DOC-2'];
    if (especialidad.toLowerCase().includes('endodoncia')) return MAPA['DOC-3'];
    if (especialidad.toLowerCase().includes('ortodoncia')) return MAPA['DOC-4'];
  }
  return MAPA['DOC-1'];
}

async function reservarCita(req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
  const errorValidacion = validarDatosReserva(req.body);

  if (errorValidacion) {
    registrarEvento('RESERVA_RECHAZADA', errorValidacion, ip, req.body.rut, 'ALERTA');
    return res.status(400).json({ error: errorValidacion });
  }

  const { espUuid, sillon } = await mapearEspecialista(req.body.idMedico, req.body.especialidad, '');

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const horaInicio = req.body.hora.length === 5 ? req.body.hora + ':00' : req.body.hora;
      const rCheck = await db.query(
        'SELECT id FROM citas WHERE fecha = $1::date AND hora_inicio = $2::time AND (especialista_id = $3 OR sillon_numero = $4) AND estado != \'CANCELADA\' LIMIT 1;',
        [req.body.fecha, horaInicio, espUuid, sillon]
      );
      if (rCheck.rows && rCheck.rows.length > 0) {
        registrarEvento('CONFLICTO_RESERVA', 'Horario ya ocupado en Neon DB', ip, req.body.rut, 'ALERTA');
        return res.status(409).json({ error: 'El horario seleccionado ya no se encuentra disponible. Por favor elige otro horario.' });
      }
    }
  } catch (eCheck) {}

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
        const resPac = await db.query(
          'INSERT INTO pacientes (rut, nombre, apellido, fecha_nacimiento, telefono, email) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (rut) DO UPDATE SET telefono = EXCLUDED.telefono, email = EXCLUDED.email RETURNING id;',
          [cita.rutFormateado, nom, ape, '2000-01-01', req.body.telefono.trim(), req.body.email.trim().toLowerCase()]
        );
        let pacId = (resPac && resPac.rows && resPac.rows[0]) ? resPac.rows[0].id : null;
        if (!pacId) {
          const rBusq = await db.query('SELECT id FROM pacientes WHERE rut = $1;', [cita.rutFormateado]);
          if (rBusq.rows.length > 0) pacId = rBusq.rows[0].id;
        }
        if (pacId) {
          const horaInicio = cita.hora.length === 5 ? cita.hora + ':00' : cita.hora;
          const partesHora = cita.hora.split(':');
          const h = parseInt(partesHora[0], 10);
          const m = parseInt(partesHora[1] || '0', 10);
          const finMin = m + 45;
          const horaFin = (finMin >= 60 ? `${String(h + 1).padStart(2, '0')}:${String(finMin - 60).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:${String(finMin).padStart(2, '0')}:00`);

          const rIns = await db.query(
            'INSERT INTO citas (paciente_id, especialista_id, sillon_numero, fecha, hora_inicio, hora_fin, tipo_consulta, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id;',
            [pacId, espUuid, sillon, cita.fecha, horaInicio, horaFin, cita.especialidad || 'Consulta Odontologica', 'CONFIRMADA']
          );
          if (!rIns || !rIns.rows || rIns.rows.length === 0) {
            return res.status(409).json({ error: 'El horario seleccionado ya no se encuentra disponible.' });
          }
        }
      }
    } catch (eDb) {
      if (eDb && (eDb.code === '23505' || (eDb.message && eDb.message.includes('unique')))) {
        return res.status(409).json({ error: 'El horario seleccionado ya se encuentra reservado en la clínica.' });
      }
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

async function consultarDisponibilidad(req, res) {
  const { especialidad, fecha, hora, idMedico } = req.query;

  if (!fecha) {
    return res.status(400).json({ error: 'Se requiere especificar la fecha.' });
  }

  const { espUuid, sillon } = await mapearEspecialista(idMedico, especialidad, '');

  let horasOcupadas = [];
  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      let q = 'SELECT hora_inicio::text as hora FROM citas WHERE fecha = $1::date AND estado != \'CANCELADA\'';
      const params = [fecha];
      if (espUuid || sillon) {
        q += ' AND (especialista_id = $2 OR sillon_numero = $3)';
        params.push(espUuid, sillon);
      }
      const r = await db.query(q, params);
      if (r && r.rows) {
        r.rows.forEach(row => {
          const h = (String(row.hora || '')).slice(0, 5);
          if (h && !horasOcupadas.includes(h)) {
            horasOcupadas.push(h);
          }
        });
      }
    }
  } catch (eDb) {}

  const { citas } = require('../models/dataStore');
  citas.forEach(c => {
    if (c.fecha === fecha && c.estado !== 'CANCELADA') {
      if (!idMedico || c.idMedico === idMedico || c.sillon === `Box ${sillon}`) {
        const h = (c.hora || '').slice(0, 5);
        if (h && !horasOcupadas.includes(h)) {
          horasOcupadas.push(h);
        }
      }
    }
  });

  if (hora) {
    const medicosDisponibles = obtenerMedicosDisponibles(especialidad, fecha, hora);
    return res.status(200).json({
      fecha,
      hora,
      especialidad: especialidad || 'Todas',
      disponibles: medicosDisponibles,
      horasOcupadas
    });
  }

  return res.status(200).json({
    fecha,
    especialidad: especialidad || 'Todas',
    horasOcupadas
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
  const fichaLocal = obtenerFichaClinica(rut);
  const recetasLocales = obtenerRecetasPorPaciente(rut);

  citas = citas.map((c, idx) => {
    const consulta = (fichaLocal && fichaLocal.historialConsultas) ? (fichaLocal.historialConsultas.find(hc => hc.fecha === c.fecha) || fichaLocal.historialConsultas[idx]) : null;
    const rec = recetasLocales.find(r => r.fechaEmision && r.fechaEmision.startsWith(c.fecha)) || recetasLocales[idx] || null;
    return {
      ...c,
      indicaciones: (rec && rec.indicaciones) || (consulta && consulta.observaciones) || null,
      medicamentos: (rec && rec.medicamentos) || [],
      diagnostico: consulta ? consulta.diagnostico : null,
      tratamiento: consulta ? consulta.tratamiento : null,
      observaciones: consulta ? consulta.observaciones : null
    };
  });

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rDb = await db.query(
        'SELECT c.id, c.fecha, c.hora_inicio as hora, c.tipo_consulta as especialidad, c.estado, c.sillon_numero as sillon, e.nombre as "nombreMedico" FROM citas c JOIN pacientes p ON c.paciente_id = p.id LEFT JOIN especialistas e ON c.especialista_id = e.id WHERE REPLACE(REPLACE(p.rut, $1, $2), $3, $4) = $5 ORDER BY c.fecha DESC, c.hora_inicio DESC;',
        ['.', '', '-', '', rutLimpio]
      );
      if (rDb.rows && rDb.rows.length > 0) {
        let fichasDb = [];
        let recetasDb = [];
        try {
          const rFichas = await db.query(
            'SELECT fc.cita_id, fc.tipo_consulta, fc.diagnostico_cifrado, fc.tratamiento_realizado, fc.observaciones, fc.created_at FROM fichas_clinicas fc JOIN pacientes p ON fc.paciente_id = p.id WHERE REPLACE(REPLACE(p.rut, $1, $2), $3, $4) = $5 ORDER BY fc.created_at DESC;',
            ['.', '', '-', '', rutLimpio]
          );
          if (rFichas && rFichas.rows) fichasDb = rFichas.rows;
        } catch (eF) {}

        try {
          const rRecetas = await db.query(
            'SELECT r.id, r.cita_id, r.indicaciones_generales, r.created_at FROM recetas r JOIN pacientes p ON r.paciente_id = p.id WHERE REPLACE(REPLACE(p.rut, $1, $2), $3, $4) = $5 ORDER BY r.created_at DESC;',
            ['.', '', '-', '', rutLimpio]
          );
          if (rRecetas && rRecetas.rows) {
            for (const rec of rRecetas.rows) {
              const rItems = await db.query(
                'SELECT nombre, dosis, presentacion, cantidad, frecuencia, dias, posologia FROM receta_items WHERE receta_id = $1;',
                [rec.id]
              );
              rec.medicamentos = (rItems && rItems.rows) ? rItems.rows : [];
            }
            recetasDb = rRecetas.rows;
          }
        } catch (eR) {}

        citas = rDb.rows.map((r, idx) => {
          const fechaStr = r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : String(r.fecha).substring(0, 10);
          const fMatch = fichasDb.find(f => f.cita_id === r.id || (f.created_at && f.created_at.toISOString && f.created_at.toISOString().startsWith(fechaStr))) || fichasDb[idx] || null;
          const rMatch = recetasDb.find(rc => rc.cita_id === r.id || (rc.created_at && rc.created_at.toISOString && rc.created_at.toISOString().startsWith(fechaStr))) || recetasDb[idx] || null;

          let diagLimpio = null;
          if (fMatch && fMatch.diagnostico_cifrado) {
            diagLimpio = fMatch.diagnostico_cifrado.replace(/^AES256GCM:[^:]*:/, '');
          }

          return {
            id: r.id,
            fecha: fechaStr,
            hora: String(r.hora).substring(0, 5),
            especialidad: r.especialidad,
            estado: r.estado,
            sillon: 'Box ' + r.sillon,
            nombreMedico: r.nombreMedico || 'Especialista Dental',
            diagnostico: diagLimpio,
            tratamiento: fMatch ? fMatch.tratamiento_realizado : null,
            observaciones: fMatch ? fMatch.observaciones : null,
            indicaciones: (rMatch && rMatch.indicaciones_generales) || (fMatch && fMatch.observaciones) || null,
            medicamentos: (rMatch && rMatch.medicamentos) ? rMatch.medicamentos : []
          };
        });
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
