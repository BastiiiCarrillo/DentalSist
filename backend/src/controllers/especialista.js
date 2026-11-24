const bcrypt = require('bcrypt');
const {
  buscarMedicoPorId,
  buscarMedicoPorEmail,
  buscarMedicoPorRut,
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
  'DOC-11': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11'
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
  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rCitas = await db.query(
        'SELECT c.id, TO_CHAR(c.fecha, \'YYYY-MM-DD\') as fecha, c.hora_inicio as hora, c.tipo_consulta as especialidad, c.estado, c.sillon_numero as sillon, c.motivo_cancelacion as "motivoCancelacion", c.cancelada_por as "canceladaPor", e.nombre as "nombreMedico" FROM citas c JOIN pacientes p ON c.paciente_id = p.id LEFT JOIN especialistas e ON c.especialista_id = e.id WHERE REPLACE(REPLACE(p.rut, $1, $2), $3, $4) = $5 ORDER BY c.fecha DESC, c.hora_inicio DESC;',
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
          nombreMedico: r.nombreMedico || 'Especialista Dental',
          motivoCancelacion: r.motivoCancelacion || null,
          canceladaPor: r.canceladaPor || null
        }));
      }
    }
  } catch (eDb) {
  }

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

async function cambiarEstado(req, res) {
  const { idCita } = req.params;
  const { nuevoEstado, motivoCancelacion } = req.body;
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';

  const estadosValidos = ['PENDIENTE', 'CONFIRMADA', 'EN_ATENCION', 'ATENDIDA', 'CANCELADA', 'NO_ASISTIO'];
  if (!estadosValidos.includes(nuevoEstado)) {
    return res.status(400).json({ error: 'Estado de cita invalido.' });
  }

  let citaActualizada = null;
  let errorMemoria = null;
  const detallesCancelacion = nuevoEstado === 'CANCELADA'
    ? { motivoCancelacion: (motivoCancelacion || '').trim() || 'Cancelada por especialista', canceladaPor: 'ESPECIALISTA' }
    : {};

  try {
    citaActualizada = actualizarEstadoCita(idCita, nuevoEstado, detallesCancelacion);
  } catch (eMem) {
    errorMemoria = eMem;
  }

  let actualizadaDb = null;
  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rActual = await db.query('SELECT id, estado, especialista_id FROM citas WHERE id::text = $1 LIMIT 1;', [idCita]);
      if (rActual.rows && rActual.rows.length > 0) {
        const estadoActual = rActual.rows[0].estado;
        const permitidos = TRANSICIONES_ESTADO[estadoActual] || [];
        if (!permitidos.includes(nuevoEstado) && estadoActual !== nuevoEstado) {
          return res.status(400).json({ error: `Transicion de estado no permitida desde ${estadoActual} a ${nuevoEstado}.` });
        }
        const rUpd = nuevoEstado === 'CANCELADA'
          ? await db.query(
            'UPDATE citas SET estado = $1, motivo_cancelacion = COALESCE($2, motivo_cancelacion), cancelada_por = $3, cancelada_en = CURRENT_TIMESTAMP WHERE id::text = $4 RETURNING id, estado, motivo_cancelacion as "motivoCancelacion";',
            [nuevoEstado, detallesCancelacion.motivoCancelacion || null, 'ESPECIALISTA', idCita]
          )
          : await db.query('UPDATE citas SET estado = $1 WHERE id::text = $2 RETURNING id, estado;', [nuevoEstado, idCita]);
        if (rUpd.rows && rUpd.rows.length > 0) {
          actualizadaDb = rUpd.rows[0];
        }
      }
    }
  } catch (eDb) {
  }

  if (!citaActualizada && !actualizadaDb) {
    return res.status(400).json({ error: errorMemoria ? errorMemoria.message : 'Cita no encontrada.' });
  }

  const respuestaCita = citaActualizada || { id: idCita, estado: nuevoEstado, ...detallesCancelacion };
  registrarEvento('ESTADO_CITA_ACTUALIZADO', `Cita ${idCita} cambio a ${nuevoEstado}`, ip, (req.usuario && req.usuario.id) || 'ESPECIALISTA', 'INFO');
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
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';

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
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';

  if (!rutPaciente || !validarRutChileno(rutPaciente)) {
    return res.status(400).json({ error: 'RUT del paciente invalido o no especificado.' });
  }

  let medico = buscarMedicoPorId(idMedico);
  if (!medico && req.usuario) {
    if (req.usuario.rut) medico = buscarMedicoPorRut(req.usuario.rut);
    if (!medico && req.usuario.email) medico = buscarMedicoPorEmail(req.usuario.email);
  }
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

function ingresarTurno(req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
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
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';

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
        const rU = await db.query(
          'SELECT id, nombre, email, rut, password_hash as "passwordHash" FROM usuarios WHERE id::text = $1 OR rut = $2 OR email = $3 LIMIT 1;',
          [String(idMedico), req.usuario ? req.usuario.rut || '' : '', req.usuario ? req.usuario.email || '' : '']
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
    } catch (eDb) {
    }
  }

  if (!medico) {
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
  const integrar = (item) => {
    if (!item || !item.rutPaciente) return;
    const key = String(item.rutPaciente).replace(/[^0-9kK]/g, '').toUpperCase();
    if (!key || key.length < 7) return;
    const prev = mapa.get(key);
    if (!prev) {
      mapa.set(key, {
        rutPaciente: key,
        rutFormateado: item.rutFormateado || formatearRut(key),
        nombrePaciente: (item.nombrePaciente || 'Paciente DentalSis').trim(),
        ultimaFecha: item.ultimaFecha || '',
        totalCitas: Number(item.totalCitas) || 0,
        atendido: Boolean(item.atendido)
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
    }
  };

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rPac = await db.query(`
        SELECT p.rut,
               TRIM(CONCAT(COALESCE(p.nombre, ''), ' ', COALESCE(p.apellido, ''))) as "nombrePaciente",
               COUNT(DISTINCT c.id) as "totalCitas",
               MAX(TO_CHAR(c.fecha, 'YYYY-MM-DD')) as "ultimaFecha",
               (COUNT(DISTINCT fc.id) > 0 OR COALESCE(BOOL_OR(c.estado = 'ATENDIDA'), false)) as atendido
        FROM pacientes p
        LEFT JOIN citas c ON c.paciente_id = p.id
        LEFT JOIN fichas_clinicas fc ON fc.paciente_id = p.id
        GROUP BY p.id, p.rut, p.nombre, p.apellido
        ORDER BY atendido DESC, "totalCitas" DESC, "ultimaFecha" DESC NULLS LAST, p.nombre ASC
        LIMIT 100;
      `);
      if (rPac.rows && rPac.rows.length > 0) {
        rPac.rows.forEach(r => {
          const rutLimpio = (r.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
          integrar({
            rutPaciente: rutLimpio,
            rutFormateado: r.rut || formatearRut(rutLimpio),
            nombrePaciente: r.nombrePaciente || 'Paciente',
            ultimaFecha: r.ultimaFecha || '',
            totalCitas: parseInt(r.totalCitas, 10) || 0,
            atendido: Boolean(r.atendido)
          });
        });
      }
    }
  } catch (eDb) {
  }

  listarPacientesSistema().forEach(integrar);

  let lista = Array.from(mapa.values());

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
  buscarPacientes
};
