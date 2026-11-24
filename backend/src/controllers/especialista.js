const bcrypt = require('bcrypt');
const {
  buscarMedicoPorId,
  obtenerCitasPorMedico,
  obtenerCitasPorPaciente,
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

async function obtenerAgenda(req, res) {
  const { idMedico } = req.params;
  const { fecha } = req.query;

  const medico = buscarMedicoPorId(idMedico);
  if (!medico) {
    return res.status(404).json({ error: 'Medico especialista no encontrado.' });
  }

  let citas = obtenerCitasPorMedico(idMedico, fecha);

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      let espUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
      if (idMedico === 'DOC-2' || (medico.especialidad && medico.especialidad.includes('General'))) {
        espUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
      } else if (idMedico === 'DOC-3' || (medico.especialidad && medico.especialidad.includes('Endodoncia'))) {
        espUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
      } else if (idMedico === 'DOC-4' || (medico.especialidad && medico.especialidad.includes('Ortodoncia'))) {
        espUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
      }

      let sql = `
        SELECT c.id, c.fecha, c.hora_inicio as hora, c.tipo_consulta as especialidad, c.estado, c.sillon_numero as sillon,
               p.nombre || ' ' || p.apellido as "nombrePaciente", p.rut as "rutPaciente", p.telefono as "telefonoPaciente"
        FROM citas c
        JOIN pacientes p ON c.paciente_id = p.id
        WHERE (c.especialista_id = $1 OR c.especialista_id::text = $2)
      `;
      const params = [espUuid, idMedico];
      if (fecha) {
        sql += ' AND c.fecha = $3';
        params.push(fecha);
      }
      sql += ' ORDER BY c.fecha ASC, c.hora_inicio ASC;';

      const resDb = await db.query(sql, params);
      if (resDb.rows && resDb.rows.length > 0) {
        citas = resDb.rows.map(r => ({
          id: r.id,
          idMedico,
          nombreMedico: medico.nombre,
          fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : String(r.fecha).substring(0, 10),
          hora: String(r.hora).substring(0, 5),
          especialidad: r.especialidad,
          estado: r.estado,
          sillon: 'Sillón ' + r.sillon,
          nombrePaciente: r.nombrePaciente,
          rutPaciente: r.rutPaciente,
          rutFormateado: r.rutPaciente,
          telefonoPaciente: r.telefonoPaciente
        }));
      }
    }
  } catch (eDb) {
  }

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

    try {
      const db = require('../models/db');
      if (db.obtenerPool()) {
        db.query('UPDATE citas SET estado = $1 WHERE id::text = $2;', [nuevoEstado, idCita]).catch(() => {});
      }
    } catch (eDb) {
    }

    registrarEvento('ESTADO_CITA_ACTUALIZADO', `Cita ${idCita} cambio a ${nuevoEstado}`, ip, citaActualizada.idMedico, 'INFO');
    return res.status(200).json({
      mensaje: 'Estado de cita actualizado exitosamente.',
      cita: citaActualizada
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

async function obtenerFichaPaciente(req, res) {
  const { rut } = req.params;

  if (!rut || !validarRutChileno(rut)) {
    return res.status(400).json({ error: 'RUT chileno invalido.' });
  }

  const rutLimpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  let ficha = obtenerFichaClinica(rut);

  let nombrePaciente = 'Paciente';
  let telefono = '+56 9 8765 4321';
  let email = '';
  let alergias = 'Sin alergias conocidas';
  let antecedentes = 'Sin antecedentes sistémicos de riesgo';

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rPac = await db.query(
        'SELECT nombre, apellido, telefono, email, alergias_cifradas, antecedentes_cifrados FROM pacientes WHERE REPLACE(REPLACE(rut, $1, $2), $3, $4) = $5 LIMIT 1;',
        ['.', '', '-', '', rutLimpio]
      );
      if (rPac.rows.length > 0) {
        nombrePaciente = `${rPac.rows[0].nombre} ${rPac.rows[0].apellido}`.trim();
        telefono = rPac.rows[0].telefono || telefono;
        email = rPac.rows[0].email || '';
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
  }

  let citasPrevias = obtenerCitasPorPaciente(rut);
  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rCitas = await db.query(
        'SELECT c.id, c.fecha, c.hora_inicio as hora, c.tipo_consulta as especialidad, c.estado, c.sillon_numero as sillon, e.nombre as "nombreMedico" FROM citas c JOIN pacientes p ON c.paciente_id = p.id LEFT JOIN especialistas e ON c.especialista_id = e.id WHERE REPLACE(REPLACE(p.rut, $1, $2), $3, $4) = $5 ORDER BY c.fecha DESC, c.hora_inicio DESC;',
        ['.', '', '-', '', rutLimpio]
      );
      if (rCitas.rows && rCitas.rows.length > 0) {
        citasPrevias = rCitas.rows.map(r => ({
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

  ficha.citasPrevias = citasPrevias;

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

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      db.query(
        'INSERT INTO fichas_clinicas (paciente_id, especialista_id, tipo_consulta, diagnostico_cifrado, tratamiento_realizado, observaciones) VALUES ((SELECT id FROM pacientes WHERE rut = $1 LIMIT 1), (SELECT id FROM especialistas WHERE nombre ILIKE $2 LIMIT 1), $3, $4, $5, $6);',
        [rut, `%${medico.nombre}%`, tipoAtencion, diagnostico, tratamiento, observaciones || '']
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

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      db.query(
        'INSERT INTO recetas (folio, paciente_id, especialista_id, indicaciones_generales, firma_hmac) VALUES ($1, (SELECT id FROM pacientes WHERE rut = $2 LIMIT 1), (SELECT id FROM especialistas WHERE nombre ILIKE $3 LIMIT 1), $4, $5) RETURNING id;',
        [recetaFirmada.id, rutPaciente, `%${medico.nombre}%`, recetaFirmada.indicaciones, recetaFirmada.firmaHMAC]
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

module.exports = {
  obtenerAgenda,
  cambiarEstado,
  obtenerFichaPaciente,
  actualizarFichaConReautenticacion,
  emitirReceta,
  verificarRecetaPublica,
  ingresarTurno
};
