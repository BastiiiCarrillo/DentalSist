const bcrypt = require('bcrypt');
const {
  buscarMedicoPorId,
  buscarMedicoPorEmail,
  buscarMedicoPorRut,
  buscarUsuarioPorRut,
  obtenerCitasPorMedico,
  obtenerCitasPorPaciente,
  obtenerTodasLasCitas,
  listarPacientesSistema,
  actualizarEstadoCita,
  obtenerFichaClinica,
  registrarAtencionEnFicha,
  guardarReceta,
  obtenerRecetaPorId,
  validarRutChileno,
  formatearRut,
  guardarTurnoMedico
} = require('../models/dataStore');
const { firmarReceta, verificarFirmaReceta } = require('../services/recetaCrypto');
const { registrarEvento } = require('../services/logger');
const { obtenerIpCliente } = require('../services/ipClient');

const MAPA_UUIDS_ESP = {
  'DOC-1': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  'DOC-2': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  'DOC-3': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',
  'DOC-4': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4',
  'DOC-5': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5',
  'DOC-6': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6',
  'DOC-7': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb7',
  'DOC-8': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8',
  'DOC-9': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9',
  'DOC-10': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10',
  'DOC-11': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11',
  'DOC-12': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb12'
};

const TRANSICIONES_ESTADO = {
  PENDIENTE: ['CONFIRMADA', 'EN_ATENCION', 'ATENDIDA', 'CANCELADA', 'NO_ASISTIO'],
  CONFIRMADA: ['EN_ATENCION', 'ATENDIDA', 'CANCELADA', 'NO_ASISTIO'],
  EN_ATENCION: ['ATENDIDA', 'CANCELADA', 'NO_ASISTIO'],
  NO_ASISTIO: ['EN_ATENCION', 'ATENDIDA'],
  ATENDIDA: [],
  CANCELADA: []
};

async function cargarFichaCompleta(rut) {
  const rutLimpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  let ficha = obtenerFichaClinica(rut);

  let nombrePaciente = 'Paciente';
  let telefono = '+56 9 8765 4321';
  let email = '';
  let alergias = 'Sin alergias conocidas';
  let antecedentes = 'Sin antecedentes sistemicos de riesgo';
  let consultasDb = [];

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rPac = await db.query(
        'SELECT nombre, apellido, telefono, email, alergias_cifradas, antecedentes_cifrados FROM pacientes WHERE REPLACE(REPLACE(rut, $1, $2), $3, $4) = $5 LIMIT 1;',
        ['.', '', '-', '', rutLimpio]
      );
      if (rPac.rows && rPac.rows.length > 0) {
        nombrePaciente = `${rPac.rows[0].nombre} ${rPac.rows[0].apellido}`.trim();
        telefono = rPac.rows[0].telefono || telefono;
        email = rPac.rows[0].email || '';
        if (rPac.rows[0].alergias_cifradas) {
          alergias = rPac.rows[0].alergias_cifradas.replace(/^AES256GCM:[^:]*:/, '');
        }
        if (rPac.rows[0].antecedentes_cifrados) {
          antecedentes = rPac.rows[0].antecedentes_cifrados.replace(/^AES256GCM:[^:]*:/, '');
        }
      }

      const rFichas = await db.query(
        'SELECT fc.id, TO_CHAR(fc.created_at, \'YYYY-MM-DD\') as fecha, fc.tipo_consulta as "tipoAtencion", fc.diagnostico_cifrado as diagnostico, fc.tratamiento_realizado as tratamiento, fc.observaciones, e.nombre as "nombreMedico" FROM fichas_clinicas fc JOIN pacientes p ON fc.paciente_id = p.id LEFT JOIN especialistas e ON fc.especialista_id = e.id WHERE REPLACE(REPLACE(p.rut, $1, $2), $3, $4) = $5 ORDER BY fc.created_at DESC;',
        ['.', '', '-', '', rutLimpio]
      );
      if (rFichas.rows && rFichas.rows.length > 0) {
        consultasDb = rFichas.rows.map(r => ({
          id: r.id,
          fecha: r.fecha || '',
          tipoAtencion: r.tipoAtencion || 'Consulta Odontológica',
          nombreMedico: r.nombreMedico || 'Especialista Dental',
          diagnostico: (r.diagnostico || '').replace(/^AES256GCM:[^:]*:/, ''),
          tratamiento: r.tratamiento || '',
          observaciones: r.observaciones || ''
        }));
      }
    }
  } catch (eDb) {
  }

  if (!ficha) {
    ficha = {
      id: `FICHA-${rutLimpio}`,
      rutPaciente: rutLimpio,
      rutFormateado: formatearRut(rutLimpio),
      nombrePaciente,
      telefono,
      email,
      alergias,
      antecedentes,
      historialConsultas: []
    };
  } else {
    ficha = { ...ficha };
    if (nombrePaciente !== 'Paciente') ficha.nombrePaciente = nombrePaciente;
    if (telefono) ficha.telefono = telefono;
    if (email) ficha.email = email;
    if (!ficha.rutFormateado) ficha.rutFormateado = formatearRut(rutLimpio);
  }

  if (consultasDb.length > 0) {
    const memoria = Array.isArray(ficha.historialConsultas) ? ficha.historialConsultas : [];
    const combinado = [...consultasDb];
    memoria.forEach(m => {
      const ya = combinado.some(d => d.diagnostico === m.diagnostico && d.tratamiento === m.tratamiento);
      if (!ya) combinado.push(m);
    });
    ficha.historialConsultas = combinado;
  }

  let citasPrevias = obtenerCitasPorPaciente(rut);
  let esPacienteInvitado = !buscarUsuarioPorRut(rut);
  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rCuenta = await db.query(
        'SELECT id FROM usuarios WHERE REPLACE(REPLACE(rut, $1, $2), $3, $4) = $5 AND UPPER(rol) = $6 LIMIT 1;',
        ['.', '', '-', '', rutLimpio, 'PACIENTE']
      );
      if (rCuenta.rows && rCuenta.rows.length > 0) {
        esPacienteInvitado = false;
      }
      const rCitas = await db.query(
        'SELECT c.id, TO_CHAR(c.fecha, \'YYYY-MM-DD\') as fecha, c.hora_inicio as hora, c.tipo_consulta as especialidad, c.estado, c.sillon_numero as sillon, COALESCE(c.es_invitado, false) as "esInvitado", c.motivo_cancelacion as "motivoCancelacion", c.cancelada_por as "canceladaPor", e.nombre as "nombreMedico" FROM citas c JOIN pacientes p ON c.paciente_id = p.id LEFT JOIN especialistas e ON c.especialista_id = e.id WHERE REPLACE(REPLACE(p.rut, $1, $2), $3, $4) = $5 ORDER BY c.fecha DESC, c.hora_inicio DESC;',
        ['.', '', '-', '', rutLimpio]
      );
      if (rCitas.rows && rCitas.rows.length > 0) {
        citasPrevias = rCitas.rows.map(r => ({
          id: r.id,
          fecha: String(r.fecha).substring(0, 10),
          hora: String(r.hora).substring(0, 5),
          especialidad: r.especialidad,
          estado: r.estado,
          sillon: 'Box ' + r.sillon,
          esInvitado: Boolean(r.esInvitado || esPacienteInvitado),
          nombreMedico: r.nombreMedico || 'Especialista Dental',
          motivoCancelacion: r.motivoCancelacion || null,
          canceladaPor: r.canceladaPor || null
        }));
      }
    }
  } catch (eDb) {
  }

  ficha.tieneCuenta = !esPacienteInvitado;
  ficha.esInvitado = esPacienteInvitado || citasPrevias.some(c => Boolean(c.esInvitado));
  ficha.citasPrevias = citasPrevias;
  return ficha;
}

async function obtenerAgenda(req, res) {
  const { idMedico } = req.params;
  const { fecha } = req.query;

  const rolToken = (req.usuario && req.usuario.rol ? req.usuario.rol : '').toUpperCase();
  const esAdmin = rolToken === 'SUPERADMIN' || rolToken === 'ADMIN';

  let medico = buscarMedicoPorId(idMedico);
  if (!medico && req.usuario) {
    if (req.usuario.rut) medico = buscarMedicoPorRut(req.usuario.rut);
    if (!medico && req.usuario.email) medico = buscarMedicoPorEmail(req.usuario.email);
  }
  if (!medico) {
    try {
      const db = require('../models/db');
      if (db.obtenerPool()) {
        const rEsp = await db.query('SELECT e.id, e.nombre, e.email, e.rut, es.nombre as especialidad, e.sillon_habitual as sillon, e.registro_sis as "registroSis", e.registro_colegio as "registroColegio" FROM especialistas e LEFT JOIN especialidades es ON e.especialidad_id = es.id WHERE e.id::text = $1 LIMIT 1;', [idMedico]);
        if (rEsp.rows && rEsp.rows.length > 0) {
          const row = rEsp.rows[0];
          medico = { ...row, sillon: row.sillon ? `Box ${row.sillon}` : 'Box 1' };
        }
      }
    } catch (e) {}
  }

  if (!medico && esAdmin) {
    medico = {
      id: idMedico,
      nombre: (req.usuario && req.usuario.nombre) || 'Administrador DentalSis',
      especialidad: 'Supervisión Clínica General',
      sillon: 'Todos los Boxes',
      registroSis: 'ADMIN-SIS-2026'
    };
  }

  if (!medico) {
    return res.status(404).json({ error: 'Medico especialista no encontrado.' });
  }

  if (!esAdmin && req.usuario) {
    const idTok = String(req.usuario.id || '');
    const rutTok = (req.usuario.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
    const emailTok = (req.usuario.email || '').toLowerCase();
    const medRut = (medico.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
    const coincideMedico = idTok === String(medico.id)
      || idTok === String(medico.uuid || '')
      || idTok === String(idMedico)
      || (rutTok && medRut && rutTok === medRut)
      || (emailTok && medico.email && emailTok === medico.email.toLowerCase());
    if (!coincideMedico) {
      registrarEvento('ACCESO_AGENDA_NO_AUTORIZADO', `Especialista intento acceder a agenda de ${medico.id}`, obtenerIpCliente(req), idTok, 'PELIGRO');
      return res.status(403).json({ error: 'Acceso denegado: Solo puedes consultar tu propia agenda medica.' });
    }
  }

  const citasMemoria = esAdmin
    ? (fecha ? obtenerTodasLasCitas().filter(c => c.fecha === fecha) : [...obtenerTodasLasCitas()])
    : obtenerCitasPorMedico(medico.id, fecha);

  let citasDb = [];
  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      let espUuid = MAPA_UUIDS_ESP[idMedico] || MAPA_UUIDS_ESP[medico.id] || medico.uuid || idMedico;
      let sql = '';
      let params = [];

      if (esAdmin && !MAPA_UUIDS_ESP[idMedico] && !medico.uuid) {
        sql = `
          SELECT c.id, TO_CHAR(c.fecha, 'YYYY-MM-DD') as fecha, c.hora_inicio as hora, c.tipo_consulta as especialidad, c.estado, c.sillon_numero as sillon,
                 COALESCE(c.es_invitado, false) as "esInvitado",
                 EXISTS (
                   SELECT 1 FROM usuarios u
                   WHERE REPLACE(REPLACE(u.rut, '.', ''), '-', '') = REPLACE(REPLACE(p.rut, '.', ''), '-', '')
                     AND UPPER(u.rol) = 'PACIENTE'
                 ) as "tieneCuentaPaciente",
                 c.motivo_cancelacion as "motivoCancelacion", c.cancelada_por as "canceladaPor",
                 p.nombre || ' ' || p.apellido as "nombrePaciente", REPLACE(REPLACE(p.rut, '.', ''), '-', '') as "rutLimpio", p.rut as "rutFormateado", p.telefono as "telefonoPaciente",
                 e.nombre as "nombreMedico"
          FROM citas c
          JOIN pacientes p ON c.paciente_id = p.id
          LEFT JOIN especialistas e ON c.especialista_id = e.id
          WHERE 1=1
        `;
        if (fecha) {
          sql += ' AND c.fecha = $1';
          params.push(fecha);
        }
      } else {
        sql = `
          SELECT c.id, TO_CHAR(c.fecha, 'YYYY-MM-DD') as fecha, c.hora_inicio as hora, c.tipo_consulta as especialidad, c.estado, c.sillon_numero as sillon,
                 COALESCE(c.es_invitado, false) as "esInvitado",
                 EXISTS (
                   SELECT 1 FROM usuarios u
                   WHERE REPLACE(REPLACE(u.rut, '.', ''), '-', '') = REPLACE(REPLACE(p.rut, '.', ''), '-', '')
                     AND UPPER(u.rol) = 'PACIENTE'
                 ) as "tieneCuentaPaciente",
                 c.motivo_cancelacion as "motivoCancelacion", c.cancelada_por as "canceladaPor",
                 p.nombre || ' ' || p.apellido as "nombrePaciente", REPLACE(REPLACE(p.rut, '.', ''), '-', '') as "rutLimpio", p.rut as "rutFormateado", p.telefono as "telefonoPaciente",
                 e.nombre as "nombreMedico"
          FROM citas c
          JOIN pacientes p ON c.paciente_id = p.id
          LEFT JOIN especialistas e ON c.especialista_id = e.id
          WHERE (c.especialista_id::text = $1 OR c.especialista_id::text = $2 OR c.especialista_id::text = $3)
        `;
        params = [String(espUuid), String(idMedico), String(medico.id)];
        if (fecha) {
          sql += ' AND c.fecha = $4';
          params.push(fecha);
        }
      }
      sql += ' ORDER BY c.fecha ASC, c.hora_inicio ASC;';

      const resDb = await db.query(sql, params);
      if (resDb.rows && resDb.rows.length > 0) {
        citasDb = resDb.rows.map(r => ({
          id: r.id,
          idMedico: medico.id,
          nombreMedico: r.nombreMedico || medico.nombre,
          fecha: String(r.fecha).substring(0, 10),
          hora: String(r.hora).substring(0, 5),
          especialidad: r.especialidad,
          estado: r.estado,
          sillon: 'Box ' + r.sillon,
          esInvitado: Boolean(r.esInvitado || !r.tieneCuentaPaciente),
          nombrePaciente: r.nombrePaciente,
          rutPaciente: r.rutLimpio || (r.rutFormateado || '').replace(/[^0-9kK]/g, '').toUpperCase(),
          rutFormateado: r.rutFormateado || r.rutLimpio,
          telefonoPaciente: r.telefonoPaciente,
          motivoCancelacion: r.motivoCancelacion || null,
          canceladaPor: r.canceladaPor || null
        }));
      }
    }
  } catch (eDb) {
  }

  const citasCombinadas = [...citasDb];
  citasMemoria.forEach(cm => {
    const rutMem = (cm.rutPaciente || '').replace(/[^0-9kK]/g, '').toUpperCase();
    const yaExiste = citasCombinadas.some(cd =>
      cd.id === cm.id || (cd.fecha === cm.fecha && cd.hora === cm.hora && cd.rutPaciente === rutMem)
    );
    if (!yaExiste) {
      citasCombinadas.push({
        ...cm,
        rutPaciente: rutMem || cm.rutPaciente
      });
    }
  });

  citasCombinadas.sort((a, b) => {
    const cmpFecha = (a.fecha || '').localeCompare(b.fecha || '');
    if (cmpFecha !== 0) return cmpFecha;
    return (a.hora || '').localeCompare(b.hora || '');
  });

  return res.status(200).json({
    medico: {
      id: medico.id,
      nombre: medico.nombre,
      especialidad: medico.especialidad,
      sillon: medico.sillon || 'Box 1',
      registroSis: medico.registroSis || 'MED-SIS-2026-081',
      registroColegio: medico.registroColegio || 'COL-ODONT-4491'
    },
    fecha: fecha || 'Todas',
    totalCitas: citasCombinadas.length,
    citas: citasCombinadas
  });
}

function obtenerFechaHoyChile() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  } catch (e) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function formatearFechaDMYBackend(fechaISO) {
  if (!fechaISO || !/^\d{4}-\d{2}-\d{2}/.test(fechaISO)) return fechaISO || '';
  const p = fechaISO.substring(0, 10).split('-');
  return `${p[2]}-${p[1]}-${p[0]}`;
}

async function cambiarEstado(req, res) {
  const { idCita } = req.params;
  const { nuevoEstado, motivoCancelacion, motivo, passwordConfirmacion, password } = req.body || {};
  const ip = obtenerIpCliente(req);

  const estadosValidos = ['PENDIENTE', 'CONFIRMADA', 'EN_ATENCION', 'ATENDIDA', 'CANCELADA', 'NO_ASISTIO'];
  if (!estadosValidos.includes(nuevoEstado)) {
    return res.status(400).json({ error: 'Estado de cita invalido.' });
  }

  let citaMemoria = obtenerTodasLasCitas().find(c => c.id === idCita) || null;
  let citaDb = null;
  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rActual = await db.query(
        'SELECT id, estado, TO_CHAR(fecha, \'YYYY-MM-DD\') as fecha, especialista_id FROM citas WHERE id::text = $1 LIMIT 1;',
        [idCita]
      );
      if (rActual.rows && rActual.rows.length > 0) {
        citaDb = rActual.rows[0];
      }
    }
  } catch (eDb) {}

  const citaObjetivo = citaDb || citaMemoria;
  if (!citaObjetivo) {
    return res.status(404).json({ error: 'Cita no encontrada.' });
  }

  if (req.usuario) {
    const rolTokenUp = (req.usuario.rol || '').toUpperCase();
    const esAdminEstado = rolTokenUp === 'SUPERADMIN' || rolTokenUp === 'ADMIN';
    if (!esAdminEstado) {
      let medicoSolicitante = req.usuario.id ? buscarMedicoPorId(req.usuario.id) : null;
      if (!medicoSolicitante && req.usuario.rut) medicoSolicitante = buscarMedicoPorRut(req.usuario.rut);
      if (!medicoSolicitante && req.usuario.email) medicoSolicitante = buscarMedicoPorEmail(req.usuario.email);
      const idsPropios = new Set(
        [
          req.usuario.id,
          medicoSolicitante && medicoSolicitante.id,
          medicoSolicitante && medicoSolicitante.uuid,
          medicoSolicitante && MAPA_UUIDS_ESP[medicoSolicitante.id]
        ].filter(Boolean).map(String)
      );
      const idDuenoCita = citaDb
        ? String(citaDb.especialista_id || '')
        : String(citaMemoria.idMedico || '');
      if (idDuenoCita && !idsPropios.has(idDuenoCita)) {
        registrarEvento('CAMBIO_ESTADO_NO_AUTORIZADO', `Intento no autorizado de modificar cita ${idCita}`, ip, req.usuario.id, 'PELIGRO');
        return res.status(403).json({ error: 'Acceso denegado: No puedes modificar citas asignadas a otro especialista.' });
      }
    }
  }

  const fechaCita = String(citaObjetivo.fecha || '').substring(0, 10);
  const hoyChile = obtenerFechaHoyChile();

  if (nuevoEstado === 'EN_ATENCION' && fechaCita && fechaCita !== hoyChile) {
    return res.status(400).json({
      error: `Solo puedes iniciar atención para citas programadas para el día de hoy (${formatearFechaDMYBackend(hoyChile)}).`
    });
  }

  if ((nuevoEstado === 'ATENDIDA' || nuevoEstado === 'NO_ASISTIO') && fechaCita && fechaCita > hoyChile) {
    return res.status(400).json({
      error: 'No puedes marcar asistencia o inasistencia en citas de fechas futuras.'
    });
  }

  const estadoActual = citaObjetivo.estado;
  const permitidos = TRANSICIONES_ESTADO[estadoActual] || [];
  if (!permitidos.includes(nuevoEstado) && estadoActual !== nuevoEstado) {
    return res.status(400).json({ error: `Transicion de estado no permitida desde ${estadoActual} a ${nuevoEstado}.` });
  }

  let detallesCancelacion = {};
  if (nuevoEstado === 'CANCELADA') {
    const motivoFinal = (motivoCancelacion || motivo || '').trim();
    if (motivoFinal.length < 5 || motivoFinal.length > 500) {
      return res.status(400).json({ error: 'Debe ingresar un motivo valido para cancelar la consulta (entre 5 y 500 caracteres).' });
    }

    const clave = passwordConfirmacion || password || '';
    if (!clave) {
      return res.status(401).json({ error: 'Autorizacion obligatoria: Ingrese su contrasena de especialista para cancelar la consulta.' });
    }

    const idMedReq = (req.usuario && req.usuario.id) ? req.usuario.id : req.body.idMedico;
    let medico = idMedReq ? buscarMedicoPorId(idMedReq) : null;
    if (!medico && req.usuario) {
      if (req.usuario.rut) medico = buscarMedicoPorRut(req.usuario.rut);
      if (!medico && req.usuario.email) medico = buscarMedicoPorEmail(req.usuario.email);
    }
    if (!medico) {
      try {
        const db = require('../models/db');
        if (db.obtenerPool()) {
          const rEsp = await db.query(
            'SELECT id, nombre, email, rut, password_hash as "passwordHash" FROM especialistas WHERE id::text = $1 OR LOWER(email) = LOWER($2) LIMIT 1;',
            [String(idMedReq || ''), (req.usuario && req.usuario.email) || '']
          );
          if (rEsp.rows && rEsp.rows.length > 0) {
            medico = rEsp.rows[0];
          } else {
            const rUsr = await db.query(
              'SELECT id, nombre, email, rut, password_hash as "passwordHash" FROM usuarios WHERE id::text = $1 OR LOWER(email) = LOWER($2) LIMIT 1;',
              [String(idMedReq || ''), (req.usuario && req.usuario.email) || '']
            );
            if (rUsr.rows && rUsr.rows.length > 0) medico = rUsr.rows[0];
          }
        }
      } catch (eDb) {}
    }

    if (!medico || !medico.passwordHash) {
      return res.status(404).json({ error: 'No fue posible verificar al especialista solicitante.' });
    }

    if (!bcrypt.compareSync(clave, medico.passwordHash)) {
      registrarEvento('CANCELACION_ESPECIALISTA_DENEGADA', `Clave incorrecta al intentar cancelar cita ${idCita}`, ip, medico.id, 'PELIGRO', {
        usuarioNombre: medico.nombre,
        usuarioRol: 'Especialista'
      });
      return res.status(403).json({ error: 'Contrasena incorrecta. Cancelacion de consulta denegada.' });
    }

    detallesCancelacion = {
      motivoCancelacion: motivoFinal,
      canceladaPor: 'ESPECIALISTA'
    };
  }

  let citaActualizada = null;
  if (citaMemoria) {
    citaActualizada = actualizarEstadoCita(idCita, nuevoEstado, detallesCancelacion);
  }

  let actualizadaDb = null;
  try {
    const db = require('../models/db');
    if (db.obtenerPool() && citaDb) {
      const rUpd = nuevoEstado === 'CANCELADA'
        ? await db.query(
          'UPDATE citas SET estado = $1, motivo_cancelacion = $2, cancelada_por = $3, cancelada_en = CURRENT_TIMESTAMP WHERE id::text = $4 RETURNING id, estado, motivo_cancelacion as "motivoCancelacion", cancelada_por as "canceladaPor";',
          [nuevoEstado, detallesCancelacion.motivoCancelacion, 'ESPECIALISTA', idCita]
        )
        : await db.query('UPDATE citas SET estado = $1 WHERE id::text = $2 RETURNING id, estado;', [nuevoEstado, idCita]);
      if (rUpd.rows && rUpd.rows.length > 0) {
        actualizadaDb = rUpd.rows[0];
      }
    }
  } catch (eDb) {}

  const respuestaCita = citaActualizada || { id: idCita, fecha: fechaCita, estado: nuevoEstado, ...detallesCancelacion };
  const actorNombreCambio = (req.usuario && req.usuario.nombre) || 'Especialista';
  const actorRolCambio = (req.usuario && req.usuario.rol) || 'Especialista';
  if (nuevoEstado === 'CANCELADA') {
    registrarEvento(
      'CITA_CANCELADA_POR_ESPECIALISTA',
      `Cita ${idCita} (${fechaCita}) cancelada por especialista. Motivo: ${detallesCancelacion.motivoCancelacion}`,
      ip,
      (req.usuario && req.usuario.id) || 'ESPECIALISTA',
      'INFO',
      { usuarioNombre: actorNombreCambio, usuarioRol: actorRolCambio }
    );
  } else {
    registrarEvento(
      'ESTADO_CITA_ACTUALIZADO',
      `Cita ${idCita} (${fechaCita}) cambio a ${nuevoEstado}`,
      ip,
      (req.usuario && req.usuario.id) || 'ESPECIALISTA',
      'INFO',
      { usuarioNombre: actorNombreCambio, usuarioRol: actorRolCambio }
    );
  }

  return res.status(200).json({
    mensaje: 'Estado de cita actualizado exitosamente.',
    cita: respuestaCita
  });
}

async function obtenerFichaPaciente(req, res) {
  const { rut } = req.params;

  if (!rut || !validarRutChileno(rut)) {
    return res.status(400).json({ error: 'RUT chileno invalido.' });
  }

  const ficha = await cargarFichaCompleta(rut);
  return res.status(200).json({ ficha });
}

function actualizarFichaConReautenticacion(req, res) {
  const { rut } = req.params;
  const idMedico = (req.usuario && req.usuario.id) ? req.usuario.id : req.body.idMedico;
  const {
    passwordConfirmacion,
    tipoAtencion,
    diagnostico,
    tratamiento,
    observaciones
  } = req.body;
  const ip = obtenerIpCliente(req);

  if (!rut || !validarRutChileno(rut)) {
    return res.status(400).json({ error: 'RUT chileno invalido.' });
  }

  if (!idMedico) {
    return res.status(400).json({ error: 'Identificador de medico especialista requerido.' });
  }

  let medico = buscarMedicoPorId(idMedico);
  if (!medico && req.usuario) {
    if (req.usuario.rut) medico = buscarMedicoPorRut(req.usuario.rut);
    if (!medico && req.usuario.email) medico = buscarMedicoPorEmail(req.usuario.email);
  }
  if (!medico || !medico.passwordHash) {
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

  if (
    typeof diagnostico !== 'string' || !diagnostico.trim() || diagnostico.trim().length > 2000
    || typeof tratamiento !== 'string' || !tratamiento.trim() || tratamiento.trim().length > 2000
    || typeof tipoAtencion !== 'string' || !tipoAtencion.trim() || tipoAtencion.trim().length > 120
  ) {
    return res.status(400).json({
      error: 'Debe ingresar tipo de atencion, diagnostico y tratamiento validos.'
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

  const rutLimpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  const espUuid = MAPA_UUIDS_ESP[medico.id] || medico.uuid || idMedico;

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      db.query(
        'INSERT INTO fichas_clinicas (paciente_id, especialista_id, tipo_consulta, diagnostico_cifrado, tratamiento_realizado, observaciones) VALUES ((SELECT id FROM pacientes WHERE REPLACE(REPLACE(rut, \'.\', \'\'), \'-\', \'\') = $1 LIMIT 1), (SELECT id FROM especialistas WHERE id::text = $2 OR nombre ILIKE $3 LIMIT 1), $4, $5, $6, $7);',
        [rutLimpio, String(espUuid), `%${medico.nombre}%`, tipoAtencion, diagnostico, tratamiento, observaciones || '']
      ).catch(() => {});
    }
  } catch (eDb) {
  }

  registrarEvento('FICHA_MODIFICADA_CON_EXITO', `Ficha del paciente ${rut} actualizada por ${medico.nombre}`, ip, idMedico, 'INFO');

  return res.status(200).json({
    mensaje: 'Ficha clinica actualizada con re-autenticacion verificada.',
    registro
  });
}

function emitirReceta(req, res) {
  const idMedico = (req.usuario && req.usuario.id) ? req.usuario.id : req.body.idMedico;
  const {
    rutPaciente,
    nombrePaciente: nombreEnviado,
    medicamentos,
    indicaciones,
    passwordConfirmacion
  } = req.body;
  const ip = obtenerIpCliente(req);

  if (!rutPaciente || !validarRutChileno(rutPaciente)) {
    return res.status(400).json({ error: 'RUT del paciente invalido o no especificado.' });
  }

  let medico = buscarMedicoPorId(idMedico);
  if (!medico && req.usuario) {
    if (req.usuario.rut) medico = buscarMedicoPorRut(req.usuario.rut);
    if (!medico && req.usuario.email) medico = buscarMedicoPorEmail(req.usuario.email);
  }
  if (!medico || !medico.passwordHash) {
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

  if (!Array.isArray(medicamentos) || medicamentos.length === 0 || medicamentos.some(m => !m || typeof m !== 'object' || typeof m.nombre !== 'string' || !m.nombre.trim())) {
    return res.status(400).json({ error: 'Debe prescribir al menos un medicamento valido con su posologia.' });
  }

  let nombreFinal = nombreEnviado || '';
  if (!nombreFinal) {
    const ficha = obtenerFichaClinica(rutPaciente);
    if (ficha && ficha.nombrePaciente) {
      nombreFinal = ficha.nombrePaciente;
    }
  }

  const idReceta = `REC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const fechaEmision = new Date().toISOString();

  const recetaBase = {
    id: idReceta,
    rutPaciente,
    nombrePaciente: nombreFinal || 'Paciente Registrado',
    idMedico: medico.id,
    nombreMedico: medico.nombre,
    especialidad: medico.especialidad || 'Cirugía Bucal',
    registroSis: medico.registroSis || 'MED-SIS-2026-081',
    registroColegio: medico.registroColegio || 'COL-ODONT-4491',
    medicamentos,
    indicaciones: indicaciones || 'Seguir indicaciones medicas al pie de la letra.',
    fechaEmision
  };

  const recetaFirmada = firmarReceta(recetaBase);
  recetaFirmada.nombrePaciente = nombreFinal || 'Paciente Registrado';
  recetaFirmada.especialidad = medico.especialidad || 'Cirugía Bucal';
  recetaFirmada.registroSis = medico.registroSis || 'MED-SIS-2026-081';
  recetaFirmada.registroColegio = medico.registroColegio || 'COL-ODONT-4491';

  guardarReceta(recetaFirmada);

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      db.query(
        'INSERT INTO recetas (folio, paciente_id, especialista_id, indicaciones_generales, firma_hmac) VALUES ($1, (SELECT id FROM pacientes WHERE REPLACE(REPLACE(rut, \'.\', \'\'), \'-\', \'\') = $2 LIMIT 1), (SELECT id FROM especialistas WHERE id::text = $3 OR nombre ILIKE $4 LIMIT 1), $5, $6) RETURNING id;',
        [recetaFirmada.id, rutPaciente.replace(/[^0-9kK]/g, '').toUpperCase(), medico.id, `%${medico.nombre}%`, recetaFirmada.indicaciones, recetaFirmada.firmaHMAC || recetaFirmada.firmaCriptografica]
      ).then(rIns => {
        if (rIns && rIns.rows && rIns.rows[0]) {
          const recId = rIns.rows[0].id;
          for (const item of medicamentos) {
            db.query(
              'INSERT INTO receta_items (receta_id, medicamento_id, nombre, dosis, presentacion, cantidad, frecuencia, dias, posologia, total_unidades) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);',
              [recId, item.medicamentoId || 'MED-01', item.nombre || 'Medicamento', item.dosis || '', item.presentacion || '', String(item.cantidad || 1), item.frecuencia || '', String(item.dias || 1), item.posologia || '', parseInt(item.totalUnidades || 1, 10)]
            ).catch(() => {});
          }
        }
      }).catch(() => {});
    }
  } catch (eDb) {
  }

  registrarEvento('RECETA_FIRMADA_EMITIDA', `Receta digital ${idReceta} emitida con HMAC-SHA256 para ${rutPaciente}`, ip, idMedico, 'INFO');

  return res.status(201).json({
    mensaje: 'Receta digital emitida y firmada criptograficamente.',
    receta: recetaFirmada
  });
}

function verificarRecetaPublica(req, res) {
  const { receta } = req.body;
  const ip = obtenerIpCliente(req);

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

function ingresarTurno(req, res) {
  const ip = obtenerIpCliente(req);
  const idMedico = (req.usuario && req.usuario.id) ? req.usuario.id : req.body.idMedico;
  const { fecha, horaInicio, horaFin, sillon } = req.body;

  try {
    const turno = guardarTurnoMedico({ idMedico, fecha, horaInicio, horaFin, sillon });

    try {
      const db = require('../models/db');
      if (db.obtenerPool()) {
        db.query(
          'INSERT INTO turnos_especialistas (especialista_id, fecha, hora_inicio, hora_fin, sillon_numero, estado) VALUES ((SELECT id FROM especialistas WHERE nombre ILIKE $1 OR id::text = $2 LIMIT 1), $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING;',
          [`%${turno.nombreMedico}%`, turno.idMedico, fecha, horaInicio, horaFin, parseInt(sillon || 1, 10), 'DISPONIBLE']
        ).catch(() => {});
      }
    } catch (eDb) {
    }

    registrarEvento('TURNO_MEDICO_REGISTRADO', `Nuevo turno para ${turno.nombreMedico} el ${fecha} a las ${horaInicio}`, ip, idMedico, 'INFO');
    return res.status(201).json({
      mensaje: 'Turno registrado exitosamente.',
      turno
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

async function autorizarAccesoHistorial(req, res) {
  const { rutPaciente, passwordConfirmacion } = req.body;
  const idMedico = (req.usuario && req.usuario.id) ? req.usuario.id : req.body.idMedico;
  const ip = obtenerIpCliente(req);

  if (!rutPaciente || !validarRutChileno(rutPaciente)) {
    return res.status(400).json({ error: 'RUT chileno de paciente invalido.' });
  }

  if (!idMedico) {
    return res.status(400).json({ error: 'Identificador de medico especialista requerido.' });
  }

  let medico = buscarMedicoPorId(idMedico);
  if (!medico && req.usuario) {
    if (req.usuario.rut) medico = buscarMedicoPorRut(req.usuario.rut);
    if (!medico && req.usuario.email) medico = buscarMedicoPorEmail(req.usuario.email);
  }

  if (!medico) {
    try {
      const db = require('../models/db');
      if (db.obtenerPool()) {
        const rutReqClean = ((req.usuario && req.usuario.rut) || '').replace(/[^0-9kK]/g, '').toUpperCase();
        const emailReqClean = ((req.usuario && req.usuario.email) || '').trim().toLowerCase();
        const rEsp = await db.query(
          'SELECT id, nombre, email, rut, password_hash as "passwordHash" FROM especialistas WHERE id::text = $1 OR ($2 <> \'\' AND LOWER(email) = $2) OR ($3 <> \'\' AND REPLACE(REPLACE(rut, \'.\', \'\'), \'-\', \'\') = $3) LIMIT 1;',
          [String(idMedico), emailReqClean, rutReqClean]
        );
        if (rEsp.rows && rEsp.rows.length > 0) {
          medico = rEsp.rows[0];
        } else {
          const rU = await db.query(
            'SELECT id, nombre, email, rut, password_hash as "passwordHash" FROM usuarios WHERE (UPPER(rol) IN (\'ODONTOLOGO\', \'SUPERADMIN\', \'ADMIN\')) AND (id::text = $1 OR ($2 <> \'\' AND LOWER(email) = $2) OR ($3 <> \'\' AND REPLACE(REPLACE(rut, \'.\', \'\'), \'-\', \'\') = $3)) LIMIT 1;',
            [String(idMedico), emailReqClean, rutReqClean]
          );
          if (rU.rows && rU.rows.length > 0) {
            medico = {
              id: rU.rows[0].id,
              nombre: rU.rows[0].nombre,
              email: rU.rows[0].email,
              rut: rU.rows[0].rut,
              passwordHash: rU.rows[0].passwordHash
            };
          }
        }
      }
    } catch (eDb) {
    }
  }

  if (!medico || !medico.passwordHash) {
    return res.status(404).json({ error: 'Medico especialista no encontrado.' });
  }

  if (!passwordConfirmacion) {
    registrarEvento('FIRMA_ACCESO_HISTORIAL_FALLIDA', `Intento de acceso a historial de paciente ${rutPaciente} sin clave`, ip, idMedico, 'ALERTA');
    return res.status(401).json({
      error: 'Firma electronica obligatoria: Ingrese su contrasena para firmar el acceso al historial clinico.'
    });
  }

  const passwordValida = bcrypt.compareSync(passwordConfirmacion, medico.passwordHash);
  if (!passwordValida) {
    registrarEvento('FIRMA_ACCESO_HISTORIAL_DENEGADA', `Intento no autorizado de consulta de historial para paciente ${rutPaciente} con contrasena incorrecta`, ip, idMedico, 'PELIGRO');
    return res.status(403).json({
      error: 'Firma electronica rechazada: Contrasena de especialista incorrecta. Acceso registrado en auditoria.'
    });
  }

  const rutLimpio = rutPaciente.replace(/[^0-9kK]/g, '').toUpperCase();
  registrarEvento('FIRMA_ACCESO_HISTORIAL_EXITOSA', `Especialista ${medico.nombre} (ID ${medico.id}) firmo con clave y accedio al historial clinico del paciente ${rutLimpio}`, ip, idMedico, 'INFO');

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      await db.query(
        'INSERT INTO eventos_seguridad (tipo_evento, descripcion, severidad, usuario_id, ip_origen) VALUES ($1, $2, $3, $4, $5);',
        ['FIRMA_ACCESO_HISTORIAL_EXITOSA', `Especialista ${medico.nombre} firmo con clave y accedio al historial de paciente ${rutLimpio}`, 'INFO', String(medico.id), ip]
      );
    }
  } catch (eDb) {
  }

  const ficha = await cargarFichaCompleta(rutPaciente);

  return res.status(200).json({
    ok: true,
    mensaje: 'Firma electronica verificada con exito. Acceso al historial clinico registrado en auditoria.',
    firma: {
      especialista: medico.nombre,
      idMedico: medico.id,
      rutEspecialista: medico.rut,
      rutPaciente: rutLimpio,
      fechaHora: new Date().toISOString()
    },
    ficha
  });
}

async function buscarPacientes(req, res) {
  const qRaw = (req.query.q || '').trim();
  const normalizar = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const qNorm = normalizar(qRaw);
  const qRut = qRaw.replace(/[^0-9kK]/g, '').toUpperCase();

  const mapa = new Map();
  const rutsConCuenta = new Set();
  const integrar = (item) => {
    if (!item || !item.rutPaciente) return;
    const key = String(item.rutPaciente).replace(/[^0-9kK]/g, '').toUpperCase();
    if (!key || key.length < 7) return;
    if (item.tieneCuenta) rutsConCuenta.add(key);
    const prev = mapa.get(key);
    if (!prev) {
      mapa.set(key, {
        rutPaciente: key,
        rutFormateado: item.rutFormateado || formatearRut(key),
        nombrePaciente: (item.nombrePaciente || 'Paciente DentalSis').trim(),
        ultimaFecha: item.ultimaFecha || '',
        totalCitas: Number(item.totalCitas) || 0,
        atendido: Boolean(item.atendido),
        tieneCuenta: Boolean(item.tieneCuenta),
        esInvitado: Boolean(item.esInvitado)
      });
    } else {
      if (item.nombrePaciente && (prev.nombrePaciente === 'Paciente DentalSis' || prev.nombrePaciente === 'Paciente')) {
        prev.nombrePaciente = item.nombrePaciente.trim();
      }
      prev.totalCitas = Math.max(prev.totalCitas, Number(item.totalCitas) || 0);
      if (item.ultimaFecha && (!prev.ultimaFecha || item.ultimaFecha > prev.ultimaFecha)) {
        prev.ultimaFecha = item.ultimaFecha;
      }
      if (item.atendido) prev.atendido = true;
      if (item.esInvitado) prev.esInvitado = true;
    }
  };

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const [rPac, rUsr] = await Promise.all([
        db.query(`
          SELECT p.rut,
                 TRIM(CONCAT(COALESCE(p.nombre, ''), ' ', COALESCE(p.apellido, ''))) as "nombrePaciente",
                 COUNT(DISTINCT c.id) as "totalCitas",
                 MAX(TO_CHAR(c.fecha, 'YYYY-MM-DD')) as "ultimaFecha",
                 (COUNT(DISTINCT fc.id) > 0 OR COALESCE(BOOL_OR(c.estado = 'ATENDIDA'), false)) as atendido,
                 COALESCE(BOOL_OR(c.es_invitado), false) as "esInvitado"
          FROM pacientes p
          LEFT JOIN citas c ON c.paciente_id = p.id
          LEFT JOIN fichas_clinicas fc ON fc.paciente_id = p.id
          GROUP BY p.id, p.rut, p.nombre, p.apellido
          ORDER BY atendido DESC, "totalCitas" DESC, "ultimaFecha" DESC NULLS LAST, p.nombre ASC
          LIMIT 100;
        `),
        db.query(`SELECT rut, nombre FROM usuarios WHERE UPPER(rol) = 'PACIENTE';`)
      ]);
      if (rUsr && rUsr.rows) {
        rUsr.rows.forEach(u => {
          const rutLimpio = (u.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
          integrar({
            rutPaciente: rutLimpio,
            rutFormateado: u.rut || formatearRut(rutLimpio),
            nombrePaciente: u.nombre || 'Paciente',
            tieneCuenta: true
          });
        });
      }
      if (rPac.rows && rPac.rows.length > 0) {
        rPac.rows.forEach(r => {
          const rutLimpio = (r.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
          integrar({
            rutPaciente: rutLimpio,
            rutFormateado: r.rut || formatearRut(rutLimpio),
            nombrePaciente: r.nombrePaciente || 'Paciente',
            ultimaFecha: r.ultimaFecha || '',
            totalCitas: parseInt(r.totalCitas, 10) || 0,
            atendido: Boolean(r.atendido),
            esInvitado: Boolean(r.esInvitado)
          });
        });
      }
    }
  } catch (eDb) {
  }

  listarPacientesSistema().forEach(integrar);

  let lista = Array.from(mapa.values()).map(p => {
    const tieneCuenta = rutsConCuenta.has(p.rutPaciente);
    return {
      ...p,
      tieneCuenta,
      esInvitado: !tieneCuenta || p.esInvitado
    };
  });

  if (qNorm) {
    lista = lista.filter(p => {
      const nomNorm = normalizar(p.nombrePaciente);
      const rutFmt = (p.rutFormateado || '').toUpperCase();
      return nomNorm.includes(qNorm) || (qRut && p.rutPaciente.includes(qRut)) || rutFmt.includes(qRaw.toUpperCase());
    });
  }

  lista.sort((a, b) => {
    if (a.atendido !== b.atendido) return a.atendido ? -1 : 1;
    if (b.totalCitas !== a.totalCitas) return b.totalCitas - a.totalCitas;
    if ((b.ultimaFecha || '') !== (a.ultimaFecha || '')) return (b.ultimaFecha || '').localeCompare(a.ultimaFecha || '');
    return a.nombrePaciente.localeCompare(b.nombrePaciente);
  });

  const resultados = lista.slice(0, 50);
  return res.status(200).json({
    total: resultados.length,
    pacientes: resultados
  });
}

module.exports = {
  obtenerAgenda,
  cambiarEstado,
  obtenerFichaPaciente,
  autorizarAccesoHistorial,
  actualizarFichaConReautenticacion,
  emitirReceta,
  verificarRecetaPublica,
  ingresarTurno,
  buscarPacientes,
  cargarFichaCompleta
};
