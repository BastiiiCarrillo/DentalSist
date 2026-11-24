const {
  obtenerMedicos,
  obtenerTodasLasCitas,
  obtenerTodasLasRecetas,
  listarPacientesSistema,
  validarRutChileno,
  formatearRut,
  limpiarRut
} = require('../models/dataStore');
const { cargarFichaCompleta } = require('./especialista');
const {
  registrarEvento,
  obtenerLogsAuditoria,
  formatearFechaHoraChile
} = require('../services/logger');
const { obtenerIpCliente } = require('../services/ipClient');

const MAPA_UUID_DOC = {
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1': 'DOC-1',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2': 'DOC-2',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3': 'DOC-3',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4': 'DOC-4',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5': 'DOC-5',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6': 'DOC-6',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb7': 'DOC-7',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8': 'DOC-8',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9': 'DOC-9',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10': 'DOC-10',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11': 'DOC-11'
};

function resolverFechaChileHoy() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function formatearFechaDDMMAAAA(fechaISO) {
  if (!fechaISO || !/^\d{4}-\d{2}-\d{2}/.test(String(fechaISO))) return fechaISO || '';
  const p = String(fechaISO).substring(0, 10).split('-');
  return `${p[2]}-${p[1]}-${p[0]}`;
}

async function obtenerMedicosBaseAdmin() {
  const locales = obtenerMedicos().map(m => ({ ...m }));
  const mapa = new Map();
  locales.forEach(m => mapa.set(m.id, m));

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const r = await db.query(`
        SELECT e.id as uuid, e.rut, e.nombre, e.email, es.nombre as especialidad,
               e.registro_sis as "registroSis", e.registro_colegio as "registroColegio", e.sillon_habitual as sillon
        FROM especialistas e
        LEFT JOIN especialidades es ON e.especialidad_id = es.id
        ORDER BY e.nombre ASC;
      `);
      if (r && r.rows) {
        r.rows.forEach(row => {
          const docId = MAPA_UUID_DOC[row.uuid] || String(row.uuid);
          const sillonFmt = typeof row.sillon === 'number' || /^\d+$/.test(String(row.sillon || ''))
            ? `Box ${row.sillon}`
            : (row.sillon || 'Box 1');
          const previo = mapa.get(docId) || {};
          mapa.set(docId, {
            ...previo,
            id: docId,
            uuid: row.uuid,
            rut: row.rut || previo.rut || '',
            nombre: row.nombre || previo.nombre || 'Especialista',
            email: row.email || previo.email || '',
            especialidad: row.especialidad || previo.especialidad || 'Odontología',
            registroSis: row.registroSis || previo.registroSis || '',
            registroColegio: row.registroColegio || previo.registroColegio || '',
            sillon: sillonFmt
          });
        });
      }
    }
  } catch (eDb) {}

  return Array.from(mapa.values());
}

async function obtenerCitasCompletasAdmin() {
  const citasDb = [];
  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const r = await db.query(`
        SELECT c.id, TO_CHAR(c.fecha, 'YYYY-MM-DD') as fecha, c.hora_inicio as hora, c.tipo_consulta as especialidad,
               c.estado, c.sillon_numero as sillon, c.motivo_cancelacion as "motivoCancelacion",
               c.cancelada_por as "canceladaPor", c.cancelada_en as "canceladaEn",
               c.especialista_id as "especialistaUuid",
               p.nombre || ' ' || p.apellido as "nombrePaciente",
               REPLACE(REPLACE(p.rut, '.', ''), '-', '') as "rutLimpio",
               p.rut as "rutFormateado", p.telefono as "telefonoPaciente", p.email as "emailPaciente",
               e.nombre as "nombreMedico", es.nombre as "especialidadMedico"
        FROM citas c
        JOIN pacientes p ON c.paciente_id = p.id
        LEFT JOIN especialistas e ON c.especialista_id = e.id
        LEFT JOIN especialidades es ON e.especialidad_id = es.id
        ORDER BY c.fecha DESC, c.hora_inicio DESC;
      `);
      if (r && r.rows) {
        r.rows.forEach(row => {
          const fechaIso = String(row.fecha || '').substring(0, 10);
          const idMedico = MAPA_UUID_DOC[row.especialistaUuid] || String(row.especialistaUuid || '');
          let canceladaEnChile = null;
          if (row.canceladaEn) {
            const fh = formatearFechaHoraChile(row.canceladaEn);
            canceladaEnChile = `${fh.fechaChile} ${fh.horaChile}`;
          }
          citasDb.push({
            id: String(row.id),
            idMedico,
            especialistaUuid: row.especialistaUuid ? String(row.especialistaUuid) : null,
            nombreMedico: row.nombreMedico || 'Especialista Dental',
            especialidad: row.especialidad || row.especialidadMedico || 'Consulta Odontológica',
            fecha: fechaIso,
            fechaDDMMAAAA: formatearFechaDDMMAAAA(fechaIso),
            hora: String(row.hora || '').substring(0, 5),
            sillon: `Box ${row.sillon || 1}`,
            estado: row.estado || 'PENDIENTE',
            motivoCancelacion: row.motivoCancelacion || null,
            canceladaPor: row.canceladaPor || null,
            canceladaEn: row.canceladaEn || null,
            canceladaEnChile,
            nombrePaciente: (row.nombrePaciente || 'Paciente').trim(),
            rutPaciente: row.rutLimpio || limpiarRut(row.rutFormateado || ''),
            rutFormateado: row.rutFormateado || formatearRut(row.rutLimpio || ''),
            telefonoPaciente: row.telefonoPaciente || '',
            emailPaciente: row.emailPaciente || ''
          });
        });
      }
    }
  } catch (eDb) {}

  const combinadas = [...citasDb];
  obtenerTodasLasCitas().forEach(cm => {
    const rutMem = limpiarRut(cm.rutPaciente || '');
    const idMedico = MAPA_UUID_DOC[cm.idMedico] || cm.idMedico;
    const existe = combinadas.some(cd =>
      cd.id === cm.id || (cd.fecha === cm.fecha && cd.hora === cm.hora && cd.rutPaciente === rutMem && cd.idMedico === idMedico)
    );
    if (!existe) {
      let canceladaEnChile = null;
      if (cm.canceladaEn) {
        const fh = formatearFechaHoraChile(cm.canceladaEn);
        canceladaEnChile = `${fh.fechaChile} ${fh.horaChile}`;
      }
      combinadas.push({
        id: cm.id,
        idMedico,
        especialistaUuid: null,
        nombreMedico: cm.nombreMedico || 'Especialista Dental',
        especialidad: cm.especialidad || 'Consulta Odontológica',
        fecha: cm.fecha,
        fechaDDMMAAAA: formatearFechaDDMMAAAA(cm.fecha),
        hora: String(cm.hora || '').substring(0, 5),
        sillon: cm.sillon || 'Box 1',
        estado: cm.estado || 'PENDIENTE',
        motivoCancelacion: cm.motivoCancelacion || null,
        canceladaPor: cm.canceladaPor || null,
        canceladaEn: cm.canceladaEn || null,
        canceladaEnChile,
        nombrePaciente: cm.nombrePaciente || 'Paciente',
        rutPaciente: rutMem,
        rutFormateado: cm.rutFormateado || formatearRut(rutMem),
        telefonoPaciente: cm.telefonoPaciente || '',
        emailPaciente: cm.emailPaciente || ''
      });
    }
  });

  combinadas.sort((a, b) => {
    const cmpFecha = (b.fecha || '').localeCompare(a.fecha || '');
    if (cmpFecha !== 0) return cmpFecha;
    return (b.hora || '').localeCompare(a.hora || '');
  });

  return combinadas;
}

async function obtenerRecetasCompletasAdmin() {
  const recetasDb = [];
  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const r = await db.query(`
        SELECT r.id, r.folio, r.indicaciones_generales as indicaciones, r.firma_hmac as "firmaHMAC", r.created_at as "fechaEmision",
               REPLACE(REPLACE(p.rut, '.', ''), '-', '') as "rutLimpio",
               p.rut as "rutFormateado",
               TRIM(CONCAT(COALESCE(p.nombre, ''), ' ', COALESCE(p.apellido, ''))) as "nombrePaciente",
               e.id as "especialistaUuid", e.nombre as "nombreMedico", es.nombre as "especialidadMedico",
               e.registro_sis as "registroSis", e.registro_colegio as "registroColegio"
        FROM recetas r
        LEFT JOIN pacientes p ON r.paciente_id = p.id
        LEFT JOIN especialistas e ON r.especialista_id = e.id
        LEFT JOIN especialidades es ON e.especialidad_id = es.id
        ORDER BY r.created_at DESC
        LIMIT 250;
      `);

      if (r && r.rows && r.rows.length > 0) {
        const ids = r.rows.map(row => row.id);
        const itemsPorReceta = new Map();
        try {
          const rItems = await db.query(
            'SELECT receta_id as "recetaId", medicamento_id as "medicamentoId", nombre, dosis, presentacion, cantidad, frecuencia, dias, posologia, total_unidades as "totalUnidades" FROM receta_items WHERE receta_id = ANY($1::uuid[]);',
            [ids]
          );
          if (rItems && rItems.rows) {
            rItems.rows.forEach(it => {
              const key = String(it.recetaId);
              if (!itemsPorReceta.has(key)) itemsPorReceta.set(key, []);
              itemsPorReceta.get(key).push(it);
            });
          }
        } catch (eItems) {}

        r.rows.forEach(row => {
          const iso = row.fechaEmision instanceof Date ? row.fechaEmision.toISOString() : new Date(row.fechaEmision || Date.now()).toISOString();
          const fh = formatearFechaHoraChile(iso);
          const idMedico = MAPA_UUID_DOC[row.especialistaUuid] || String(row.especialistaUuid || '');
          recetasDb.push({
            id: String(row.id),
            folio: row.folio || String(row.id),
            fechaEmision: iso,
            fechaEmisionChile: fh.fechaChile,
            horaEmisionChile: fh.horaChile,
            rutPaciente: row.rutLimpio || '',
            rutFormateado: row.rutFormateado || formatearRut(row.rutLimpio || ''),
            nombrePaciente: row.nombrePaciente || 'Paciente Registrado',
            idMedico,
            nombreMedico: row.nombreMedico || 'Especialista Dental',
            especialidadMedico: row.especialidadMedico || 'Odontología',
            registroSis: row.registroSis || 'MED-SIS-2026',
            registroColegio: row.registroColegio || 'COL-ODONT',
            indicaciones: row.indicaciones || 'Seguir indicaciones médicas.',
            firmaHMAC: row.firmaHMAC || '',
            medicamentos: itemsPorReceta.get(String(row.id)) || []
          });
        });
      }
    }
  } catch (eDb) {}

  const combinadas = [...recetasDb];
  obtenerTodasLasRecetas().forEach(rm => {
    const folioMem = rm.folio || rm.id;
    const existe = combinadas.some(rd => rd.folio === folioMem || rd.id === rm.id);
    if (!existe) {
      const iso = rm.fechaEmision || new Date().toISOString();
      const fh = formatearFechaHoraChile(iso);
      const rutClean = limpiarRut(rm.rutPaciente || '');
      combinadas.push({
        id: rm.id,
        folio: folioMem,
        fechaEmision: iso,
        fechaEmisionChile: fh.fechaChile,
        horaEmisionChile: fh.horaChile,
        rutPaciente: rutClean,
        rutFormateado: formatearRut(rutClean),
        nombrePaciente: rm.nombrePaciente || 'Paciente Registrado',
        idMedico: rm.idMedico || '',
        nombreMedico: rm.nombreMedico || 'Especialista Dental',
        especialidadMedico: rm.especialidad || 'Odontología',
        registroSis: rm.registroSis || 'MED-SIS-2026',
        registroColegio: rm.registroColegio || 'COL-ODONT',
        indicaciones: rm.indicaciones || 'Seguir indicaciones médicas.',
        firmaHMAC: rm.firmaHMAC || rm.firmaCriptografica || '',
        medicamentos: Array.isArray(rm.medicamentos) ? rm.medicamentos : []
      });
    }
  });

  combinadas.sort((a, b) => new Date(b.fechaEmision).getTime() - new Date(a.fechaEmision).getTime());
  return combinadas;
}

async function obtenerResumenAdmin(req, res) {
  const hoyChile = resolverFechaChileHoy();
  const [medicos, citas, recetas, logs] = await Promise.all([
    obtenerMedicosBaseAdmin(),
    obtenerCitasCompletasAdmin(),
    obtenerRecetasCompletasAdmin(),
    obtenerLogsAuditoria()
  ]);

  const pacientesSet = new Set();
  listarPacientesSistema().forEach(p => pacientesSet.add(p.rutPaciente));
  citas.forEach(c => { if (c.rutPaciente) pacientesSet.add(c.rutPaciente); });

  const citasHoy = citas.filter(c => c.fecha === hoyChile);
  const alertasCriticas = logs.filter(l => l.nivel === 'ALERTA' || l.nivel === 'PELIGRO').length;

  return res.status(200).json({
    fechaHoyChile: formatearFechaDDMMAAAA(hoyChile),
    resumen: {
      totalMedicos: medicos.length,
      totalPacientes: pacientesSet.size,
      totalCitas: citas.length,
      citasHoy: citasHoy.length,
      enAtencion: citas.filter(c => c.estado === 'EN_ATENCION').length,
      canceladas: citas.filter(c => c.estado === 'CANCELADA').length,
      noAsistio: citas.filter(c => c.estado === 'NO_ASISTIO').length,
      atendidas: citas.filter(c => c.estado === 'ATENDIDA').length,
      pendientesOConfirmadas: citas.filter(c => c.estado === 'PENDIENTE' || c.estado === 'CONFIRMADA').length,
      totalRecetas: recetas.length,
      totalLogs: logs.length,
      alertasSeguridad: alertasCriticas
    }
  });
}

async function obtenerMedicosAdmin(req, res) {
  const hoyChile = resolverFechaChileHoy();
  const [medicosBase, citas] = await Promise.all([
    obtenerMedicosBaseAdmin(),
    obtenerCitasCompletasAdmin()
  ]);

  const medicos = medicosBase.map(m => {
    const citasMedico = citas.filter(c =>
      c.idMedico === m.id || (m.uuid && c.especialistaUuid === String(m.uuid))
    );
    const citaEnAtencion = citasMedico.find(c => c.estado === 'EN_ATENCION') || null;
    const citasHoy = citasMedico.filter(c => c.fecha === hoyChile);
    return {
      ...m,
      enAtencion: Boolean(citaEnAtencion),
      pacienteEnAtencion: citaEnAtencion ? {
        nombrePaciente: citaEnAtencion.nombrePaciente,
        rutFormateado: citaEnAtencion.rutFormateado,
        hora: citaEnAtencion.hora,
        sillon: citaEnAtencion.sillon
      } : null,
      resumen: {
        total: citasMedico.length,
        hoy: citasHoy.length,
        enAtencion: citasMedico.filter(c => c.estado === 'EN_ATENCION').length,
        activas: citasMedico.filter(c => c.estado === 'PENDIENTE' || c.estado === 'CONFIRMADA').length,
        atendidas: citasMedico.filter(c => c.estado === 'ATENDIDA').length,
        noAsistio: citasMedico.filter(c => c.estado === 'NO_ASISTIO').length,
        canceladas: citasMedico.filter(c => c.estado === 'CANCELADA').length
      },
      citas: citasMedico
    };
  });

  return res.status(200).json({
    fechaHoyChile: formatearFechaDDMMAAAA(hoyChile),
    totalMedicos: medicos.length,
    medicos,
    citas
  });
}

async function obtenerPacientesAdmin(req, res) {
  const q = (req.query.q || '').trim().toLowerCase();
  const qNorm = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const qRut = limpiarRut(q);

  const [citas, recetas] = await Promise.all([
    obtenerCitasCompletasAdmin(),
    obtenerRecetasCompletasAdmin()
  ]);

  const mapa = new Map();
  const integrar = (item) => {
    const key = limpiarRut(item.rutPaciente || item.rutFormateado || '');
    if (!key || key.length < 7) return;
    const prev = mapa.get(key) || {
      rutPaciente: key,
      rutFormateado: item.rutFormateado || formatearRut(key),
      nombrePaciente: 'Paciente DentalSis',
      email: '',
      telefono: '',
      ultimaFecha: '',
      ultimaFechaFmt: '',
      fichasCount: 0,
      recetasCount: 0,
      totalCitas: 0,
      enAtencion: 0,
      activas: 0,
      atendidas: 0,
      noAsistio: 0,
      canceladas: 0,
      citas: []
    };
    if (item.nombrePaciente && (prev.nombrePaciente === 'Paciente DentalSis' || prev.nombrePaciente === 'Paciente')) {
      prev.nombrePaciente = item.nombrePaciente.trim();
    }
    if (item.email && !prev.email) prev.email = item.email;
    if (item.telefono && !prev.telefono) prev.telefono = item.telefono;
    if (item.ultimaFecha && (!prev.ultimaFecha || item.ultimaFecha > prev.ultimaFecha)) {
      prev.ultimaFecha = item.ultimaFecha;
      prev.ultimaFechaFmt = formatearFechaDDMMAAAA(item.ultimaFecha);
    }
    if (typeof item.fichasCount === 'number') {
      prev.fichasCount = Math.max(prev.fichasCount, item.fichasCount);
    }
    mapa.set(key, prev);
  };

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rPac = await db.query(`
        SELECT p.rut, TRIM(CONCAT(COALESCE(p.nombre, ''), ' ', COALESCE(p.apellido, ''))) as "nombrePaciente",
               p.email, p.telefono, COUNT(DISTINCT fc.id) as "fichasCount"
        FROM pacientes p
        LEFT JOIN fichas_clinicas fc ON fc.paciente_id = p.id
        GROUP BY p.id, p.rut, p.nombre, p.apellido, p.email, p.telefono;
      `);
      if (rPac && rPac.rows) {
        rPac.rows.forEach(r => integrar({
          rutPaciente: r.rut,
          rutFormateado: r.rut,
          nombrePaciente: r.nombrePaciente,
          email: r.email,
          telefono: r.telefono,
          fichasCount: parseInt(r.fichasCount, 10) || 0
        }));
      }
    }
  } catch (eDb) {}

  listarPacientesSistema().forEach(p => integrar(p));

  citas.forEach(c => {
    integrar({
      rutPaciente: c.rutPaciente,
      rutFormateado: c.rutFormateado,
      nombrePaciente: c.nombrePaciente,
      email: c.emailPaciente,
      telefono: c.telefonoPaciente,
      ultimaFecha: c.fecha
    });
    const pac = mapa.get(c.rutPaciente);
    if (pac) {
      pac.citas.push(c);
      pac.totalCitas += 1;
      if (c.estado === 'EN_ATENCION') pac.enAtencion += 1;
      else if (c.estado === 'PENDIENTE' || c.estado === 'CONFIRMADA') pac.activas += 1;
      else if (c.estado === 'ATENDIDA') pac.atendidas += 1;
      else if (c.estado === 'NO_ASISTIO') pac.noAsistio += 1;
      else if (c.estado === 'CANCELADA') pac.canceladas += 1;
    }
  });

  recetas.forEach(r => {
    integrar({
      rutPaciente: r.rutPaciente,
      rutFormateado: r.rutFormateado,
      nombrePaciente: r.nombrePaciente
    });
    const pac = mapa.get(r.rutPaciente);
    if (pac) {
      pac.recetasCount += 1;
    }
  });

  let pacientes = Array.from(mapa.values());
  if (qNorm) {
    pacientes = pacientes.filter(p => {
      const nom = (p.nombrePaciente || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const correo = (p.email || '').toLowerCase();
      return nom.includes(qNorm) || correo.includes(qNorm) || (qRut && p.rutPaciente.includes(qRut));
    });
  }

  pacientes.sort((a, b) => {
    if (b.enAtencion !== a.enAtencion) return b.enAtencion - a.enAtencion;
    if (b.totalCitas !== a.totalCitas) return b.totalCitas - a.totalCitas;
    return (a.nombrePaciente || '').localeCompare(b.nombrePaciente || '');
  });

  return res.status(200).json({
    total: pacientes.length,
    pacientes
  });
}

async function obtenerDetallePacienteAdmin(req, res) {
  const { rut } = req.params;
  if (!rut || !validarRutChileno(rut)) {
    return res.status(400).json({ error: 'RUT chileno de paciente inválido.' });
  }

  const ip = obtenerIpCliente(req);
  const rutClean = limpiarRut(rut);

  registrarEvento(
    'ADMIN_CONSULTA_PACIENTE',
    `Administrador consultó resumen e historial del paciente ${formatearRut(rutClean)}`,
    ip,
    (req.usuario && req.usuario.id) || 'USR-ADMIN-1',
    'INFO',
    {
      usuarioNombre: (req.usuario && req.usuario.nombre) || 'Ing. Admin DentalSis',
      usuarioRol: (req.usuario && req.usuario.rol) || 'SuperAdmin'
    }
  );

  const [ficha, todasRecetas] = await Promise.all([
    cargarFichaCompleta(rut),
    obtenerRecetasCompletasAdmin()
  ]);

  const recetasPaciente = todasRecetas.filter(r => r.rutPaciente === rutClean);
  return res.status(200).json({
    soloLectura: true,
    ficha,
    recetas: recetasPaciente
  });
}

async function obtenerRecetasAdmin(req, res) {
  const q = (req.query.q || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let recetas = await obtenerRecetasCompletasAdmin();

  if (q) {
    recetas = recetas.filter(r => {
      const texto = `${r.folio} ${r.nombrePaciente} ${r.rutFormateado} ${r.nombreMedico} ${(r.medicamentos || []).map(m => m.nombre).join(' ')}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return texto.includes(q);
    });
  }

  return res.status(200).json({
    soloLectura: true,
    total: recetas.length,
    recetas
  });
}

async function obtenerLogsAdmin(req, res) {
  const logs = await obtenerLogsAuditoria();
  return res.status(200).json({
    total: logs.length,
    logs
  });
}

module.exports = {
  obtenerResumenAdmin,
  obtenerMedicosAdmin,
  obtenerPacientesAdmin,
  obtenerDetallePacienteAdmin,
  obtenerRecetasAdmin,
  obtenerLogsAdmin
};
