const db = require('../models/db');
const dataStore = require('../models/dataStore');
const {
  obtenerMedicos,
  obtenerTodasLasCitas,
  obtenerTodasLasRecetas,
  listarPacientesSistema,
  validarRutChileno,
  formatearRut,
  limpiarRut
} = dataStore;
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
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11': 'DOC-11',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb12': 'DOC-12'
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
               c.estado, c.sillon_numero as sillon, COALESCE(c.es_invitado, false) as "esInvitado",
               c.motivo_cancelacion as "motivoCancelacion",
               c.cancelada_por as "canceladaPor", c.cancelada_en as "canceladaEn",
               c.especialista_id as "especialistaUuid",
               p.nombre || ' ' || p.apellido as "nombrePaciente",
               REPLACE(REPLACE(p.rut, '.', ''), '-', '') as "rutLimpio",
               p.rut as "rutFormateado", p.telefono as "telefonoPaciente", p.email as "emailPaciente",
               EXISTS (
                 SELECT 1 FROM usuarios u
                 WHERE REPLACE(REPLACE(u.rut, '.', ''), '-', '') = REPLACE(REPLACE(p.rut, '.', ''), '-', '')
                   AND UPPER(u.rol) = 'PACIENTE'
               ) as "tieneCuentaPaciente",
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
            esInvitado: Boolean(row.esInvitado || !row.tieneCuentaPaciente),
            motivoCancelacion: row.motivoCancelacion || null,
            canceladaPor: row.canceladaPor || null,
            canceladaEn: row.canceladaEn || null,
            canceladaEnChile,
            nombrePaciente: (row.nombrePaciente || 'Paciente').trim(),
            rutPaciente: limpiarRut(row.rutLimpio || row.rutFormateado || ''),
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
        esInvitado: Boolean(cm.esInvitado),
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

async function construirListadoPacientesAdmin(citas, recetas) {
  const mapa = new Map();
  const rutsConCuenta = new Set();

  const integrar = (item) => {
    const key = limpiarRut(item.rutPaciente || item.rutFormateado || '');
    if (!key || key.length < 7) return;
    if (item.tieneCuenta) rutsConCuenta.add(key);
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
      tieneCuenta: false,
      esInvitado: false,
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
    if (item.esInvitado) prev.esInvitado = true;
    mapa.set(key, prev);
  };

  try {
    const dbMod = require('../models/db');
    if (dbMod.obtenerPool()) {
      const [rPac, rUsr] = await Promise.all([
        dbMod.query(`
          SELECT p.rut, TRIM(CONCAT(COALESCE(p.nombre, ''), ' ', COALESCE(p.apellido, ''))) as "nombrePaciente",
                 p.email, p.telefono, COUNT(DISTINCT fc.id) as "fichasCount"
          FROM pacientes p
          LEFT JOIN fichas_clinicas fc ON fc.paciente_id = p.id
          GROUP BY p.id, p.rut, p.nombre, p.apellido, p.email, p.telefono;
        `),
        dbMod.query(`SELECT rut, nombre, email FROM usuarios WHERE UPPER(rol) = 'PACIENTE';`)
      ]);
      if (rUsr && rUsr.rows) {
        rUsr.rows.forEach(u => integrar({
          rutPaciente: u.rut,
          rutFormateado: u.rut,
          nombrePaciente: u.nombre,
          email: u.email,
          tieneCuenta: true
        }));
      }
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
      ultimaFecha: c.fecha,
      esInvitado: Boolean(c.esInvitado)
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

  const pacientes = Array.from(mapa.values()).map(p => {
    const tieneCuenta = rutsConCuenta.has(p.rutPaciente);
    return {
      ...p,
      tieneCuenta,
      esInvitado: !tieneCuenta || p.citas.some(c => Boolean(c.esInvitado))
    };
  });

  pacientes.sort((a, b) => {
    if (b.enAtencion !== a.enAtencion) return b.enAtencion - a.enAtencion;
    if (b.totalCitas !== a.totalCitas) return b.totalCitas - a.totalCitas;
    return (a.nombrePaciente || '').localeCompare(b.nombrePaciente || '');
  });

  return pacientes;
}

async function obtenerResumenAdmin(req, res) {
  const hoyChile = resolverFechaChileHoy();
  const [medicos, citas, recetas, logs] = await Promise.all([
    obtenerMedicosBaseAdmin(),
    obtenerCitasCompletasAdmin(),
    obtenerRecetasCompletasAdmin(),
    obtenerLogsAuditoria()
  ]);

  const pacientes = await construirListadoPacientesAdmin(citas, recetas);
  const citasHoy = citas.filter(c => c.fecha === hoyChile);
  const alertasCriticas = logs.filter(l => l.nivel === 'ALERTA' || l.nivel === 'PELIGRO').length;

  return res.status(200).json({
    fechaHoyChile: formatearFechaDDMMAAAA(hoyChile),
    resumen: {
      totalMedicos: medicos.length,
      totalPacientes: pacientes.length,
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
    const citasLimpias = citasMedico.map(({ emailPaciente, telefonoPaciente, especialistaUuid, ...restoCita }) => restoCita);
    return {
      id: m.id,
      nombre: m.nombre,
      rut: formatearRut(limpiarRut(m.rut || '')) || m.rut,
      especialidad: m.especialidad,
      sillon: m.sillon,
      registroSis: m.registroSis,
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
      citas: citasLimpias
    };
  });

  const citasRespuesta = citas.map(({ emailPaciente, telefonoPaciente, especialistaUuid, ...resto }) => resto);

  return res.status(200).json({
    fechaHoyChile: formatearFechaDDMMAAAA(hoyChile),
    totalMedicos: medicos.length,
    medicos,
    citas: citasRespuesta
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

  let pacientes = await construirListadoPacientesAdmin(citas, recetas);
  if (qNorm) {
    pacientes = pacientes.filter(p => {
      const nom = (p.nombrePaciente || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const correo = (p.email || '').toLowerCase();
      return nom.includes(qNorm) || correo.includes(qNorm) || (qRut && p.rutPaciente.includes(qRut));
    });
  }

  return res.status(200).json({
    total: pacientes.length,
    pacientes
  });
}

async function obtenerDetallePacienteAdmin(req, res) {
  const rut = req.params.rut || (req.body && req.body.rut);
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

function generarPasswordTemporalSegura() {
  const crypto = require('crypto');
  const mayus = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const minus = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const esps = '!@#$%*?';
  const todos = mayus + minus + nums + esps;
  const pick = (charset) => charset[crypto.randomInt(0, charset.length)];

  for (let intento = 0; intento < 10; intento++) {
    const chars = [
      pick(mayus), pick(mayus),
      pick(minus), pick(minus), pick(minus),
      pick(nums), pick(nums), pick(nums),
      pick(esps), pick(esps),
      pick(todos), pick(todos)
    ];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      const tmp = chars[i];
      chars[i] = chars[j];
      chars[j] = tmp;
    }
    const candidata = chars.join('');
    if (!dataStore.validarPasswordSegura(candidata)) {
      return candidata;
    }
  }
  return 'Tmp94!Dental#26';
}

async function verificarPasswordAdminActual(usuarioReq, passwordAdmin) {
  const bcrypt = require('bcrypt');
  const idAdmin = String((usuarioReq && usuarioReq.id) || '');
  const emailAdmin = String((usuarioReq && usuarioReq.email) || '').trim().toLowerCase();
  const rutAdmin = String((usuarioReq && usuarioReq.rut) || '').trim();

  if (db.obtenerPool()) {
    try {
      const rAdmin = await db.query(
        'SELECT id, nombre, email, rut, rol, password_hash as "passwordHash" FROM usuarios WHERE id::text = $1 OR LOWER(email) = $2 LIMIT 1;',
        [idAdmin, emailAdmin]
      );
      if (rAdmin.rows && rAdmin.rows.length > 0) {
        const row = rAdmin.rows[0];
        const ok = Boolean(row.passwordHash && bcrypt.compareSync(String(passwordAdmin), row.passwordHash));
        return { encontrado: true, valida: ok, admin: row };
      }
    } catch (eDb) {}
  }

  const local = dataStore.buscarUsuarioPorId(idAdmin)
    || (emailAdmin ? dataStore.buscarUsuarioPorEmail(emailAdmin) : null)
    || (rutAdmin ? dataStore.buscarUsuarioPorRut(rutAdmin) : null);

  if (!local) {
    return { encontrado: false, valida: false, admin: null };
  }
  return {
    encontrado: true,
    valida: Boolean(local.passwordHash && bcrypt.compareSync(String(passwordAdmin), local.passwordHash)),
    admin: local
  };
}

async function obtenerUsuariosResetAdmin(req, res) {
  try {
    let usuarios = [];

    if (db.obtenerPool()) {
      try {
        const mapa = new Map();
        const [rEsp, rUsr] = await Promise.all([
          db.query(
            'SELECT e.id, e.nombre, e.rut, e.email, COALESCE(es.nombre, $1) as especialidad, COALESCE(e.debe_cambiar_password, false) as "debeCambiarPassword" FROM especialistas e LEFT JOIN especialidades es ON e.especialidad_id = es.id ORDER BY e.nombre ASC;',
            ['Odontologia']
          ),
          db.query(
            'SELECT id, nombre, rut, email, rol, COALESCE(debe_cambiar_password, false) as "debeCambiarPassword" FROM usuarios ORDER BY nombre ASC;'
          )
        ]);

        for (const e of (rEsp.rows || [])) {
          const clave = String(e.email || dataStore.limpiarRut(e.rut || '')).toLowerCase();
          const rutFmt = dataStore.formatearRut(dataStore.limpiarRut(e.rut || ''));
          mapa.set(clave, {
            id: String(e.id),
            tipo: 'especialista',
            nombre: e.nombre,
            rutFormateado: rutFmt,
            email: e.email,
            rol: 'Odontologo',
            especialidad: e.especialidad || '',
            debeCambiarPassword: Boolean(e.debeCambiarPassword)
          });
        }

        for (const u of (rUsr.rows || [])) {
          const rolUp = String(u.rol || '').toUpperCase();
          if (rolUp === 'SUPERADMIN' || u.id === 'USR-ADMIN-1' || String(u.email || '').toLowerCase() === 'admin@dentalsis.cl') continue;
          const clave = String(u.email || dataStore.limpiarRut(u.rut || '')).toLowerCase();
          if (mapa.has(clave)) continue;
          const rolNorm = rolUp === 'RECEPCIONISTA'
            ? 'Recepcionista'
            : rolUp === 'ADMIN'
              ? 'Admin'
              : rolUp === 'ODONTOLOGO'
                ? 'Odontologo'
                : 'Paciente';
          const rutFmt = dataStore.formatearRut(dataStore.limpiarRut(u.rut || ''));
          mapa.set(clave, {
            id: String(u.id),
            tipo: 'usuario',
            nombre: u.nombre,
            rutFormateado: rutFmt,
            email: u.email,
            rol: rolNorm,
            especialidad: '',
            debeCambiarPassword: Boolean(u.debeCambiarPassword)
          });
        }

        usuarios = Array.from(mapa.values());
      } catch (eDb) {
        usuarios = [];
      }
    }
    if (usuarios.length === 0) {
      usuarios = dataStore.listarUsuariosResetSistema();
    }

    const emailProp = String((req.usuario && req.usuario.email) || '').toLowerCase();
    const idProp = String((req.usuario && req.usuario.id) || '');
    usuarios = usuarios.filter(u =>
      String(u.rol || '').toUpperCase() !== 'SUPERADMIN'
      && String(u.id || '') !== idProp
      && (!emailProp || String(u.email || '').toLowerCase() !== emailProp)
    );

    const ordenRol = { Odontologo: 1, Recepcionista: 2, Admin: 3, Paciente: 4 };
    usuarios.sort((a, b) => {
      const pa = ordenRol[a.rol] || 9;
      const pb = ordenRol[b.rol] || 9;
      if (pa !== pb) return pa - pb;
      return String(a.nombre || '').localeCompare(String(b.nombre || ''));
    });

    return res.status(200).json({
      total: usuarios.length,
      usuarios
    });
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo obtener la lista de usuarios.' });
  }
}

async function restablecerPasswordUsuarioAdmin(req, res) {
  const bcrypt = require('bcrypt');
  const ip = obtenerIpCliente(req);
  const tipoSolicitado = String(req.body?.tipo || 'usuario').trim().toLowerCase() === 'especialista' ? 'especialista' : 'usuario';
  const idUsuario = req.body?.idUsuario !== undefined ? String(req.body.idUsuario).trim() : '';
  const identificador = req.body?.identificador !== undefined ? String(req.body.identificador).trim() : '';
  const passwordAdmin = String(req.body?.passwordAdmin || '');

  if (!passwordAdmin) {
    return res.status(400).json({ error: 'Debe ingresar su contrasena de administrador para autorizar el restablecimiento.' });
  }

  const claveBusqueda = idUsuario || identificador;
  if (!claveBusqueda) {
    return res.status(400).json({ error: 'Debe indicar el usuario cuya contrasena desea restablecer.' });
  }

  try {
    const verifAdmin = await verificarPasswordAdminActual(req.usuario, passwordAdmin);
    if (!verifAdmin.encontrado || !verifAdmin.valida) {
      registrarEvento(
        'ADMIN_RESET_PASSWORD_DENEGADO',
        `Intento fallido de restablecer clave para ${claveBusqueda}: contrasena de administrador incorrecta`,
        ip,
        req.usuario && req.usuario.id,
        'PELIGRO',
        {
          usuarioNombre: req.usuario && req.usuario.nombre,
          usuarioRol: req.usuario && req.usuario.rol,
          objetivoSolicitado: claveBusqueda
        }
      );
      return res.status(403).json({ error: 'Contrasena de administrador incorrecta. Autorizacion denegada.' });
    }

    const emailAdmin = String((req.usuario && req.usuario.email) || '').trim().toLowerCase();
    const idAdmin = String((req.usuario && req.usuario.id) || '').trim();
    const rutAdminClean = dataStore.limpiarRut((req.usuario && req.usuario.rut) || '');
    const rutBusquedaClean = dataStore.limpiarRut(claveBusqueda);
    if (
      claveBusqueda === idAdmin
      || (emailAdmin && claveBusqueda.toLowerCase() === emailAdmin)
      || (emailAdmin && identificador.toLowerCase() === emailAdmin)
      || (rutAdminClean && rutBusquedaClean && rutAdminClean === rutBusquedaClean)
    ) {
      return res.status(400).json({ error: 'Por seguridad no puede restablecer su propia cuenta desde este panel.' });
    }

    const passwordTemporal = generarPasswordTemporalSegura();
    const nuevoHash = bcrypt.hashSync(passwordTemporal, 10);
    const idEmailClean = identificador.toLowerCase();
    const claveEmailClean = claveBusqueda.toLowerCase();
    let objetivoFinal = null;
    let tipoFinal = tipoSolicitado;

    if (db.obtenerPool()) {
      try {
        const buscarEnEspecialistas = async () => {
          const qEsp = await db.query(
            'SELECT e.id, e.nombre, e.rut, e.email, COALESCE(es.nombre, $4) as especialidad FROM especialistas e LEFT JOIN especialidades es ON e.especialidad_id = es.id WHERE e.id::text = $1 OR LOWER(e.email) = $2 OR REPLACE(REPLACE(e.rut, $5, $6), $7, $8) = $3 LIMIT 1;',
            [claveBusqueda, idEmailClean || claveEmailClean, rutBusquedaClean, 'Odontologia', '.', '', '-', '']
          );
          return qEsp.rows && qEsp.rows[0] ? qEsp.rows[0] : null;
        };
        const buscarEnUsuarios = async () => {
          const qUsr = await db.query(
            'SELECT id, nombre, rut, email, rol FROM usuarios WHERE id::text = $1 OR LOWER(email) = $2 OR REPLACE(REPLACE(rut, $4, $5), $6, $7) = $3 LIMIT 1;',
            [claveBusqueda, idEmailClean || claveEmailClean, rutBusquedaClean, '.', '', '-', '']
          );
          return qUsr.rows && qUsr.rows[0] ? qUsr.rows[0] : null;
        };

        const rowEsp = tipoSolicitado === 'especialista' ? (await buscarEnEspecialistas()) : null;
        const rowUsr = tipoSolicitado === 'usuario' ? (await buscarEnUsuarios()) : await buscarEnUsuarios();
        const rowEspFallback = !rowEsp && !rowUsr ? (await buscarEnEspecialistas()) : rowEsp;
        const encontradoDb = rowEspFallback || rowUsr;

        if (encontradoDb && String(encontradoDb.rol || '').toUpperCase() === 'SUPERADMIN') {
          return res.status(403).json({ error: 'Por seguridad, no se puede restablecer la cuenta SuperAdmin desde este panel.' });
        }

        if (rowEspFallback) {
          tipoFinal = 'especialista';
          await db.query(
            'UPDATE especialistas SET password_hash = $1, debe_cambiar_password = TRUE WHERE id::text = $2;',
            [nuevoHash, String(rowEspFallback.id)]
          );
          const rutEspClean = dataStore.limpiarRut(rowEspFallback.rut || '');
          await db.query(
            'UPDATE usuarios SET password_hash = $1, debe_cambiar_password = TRUE, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($2) OR REPLACE(REPLACE(rut, $4, $5), $6, $7) = $3;',
            [nuevoHash, rowEspFallback.email || '', rutEspClean, '.', '', '-', '']
          );
          objetivoFinal = {
            id: String(rowEspFallback.id),
            tipo: 'especialista',
            nombre: rowEspFallback.nombre,
            email: rowEspFallback.email,
            rut: rowEspFallback.rut,
            rol: 'Odontologo',
            especialidad: rowEspFallback.especialidad || '',
            debeCambiarPassword: true
          };
        } else if (rowUsr) {
          tipoFinal = 'usuario';
          await db.query(
            'UPDATE usuarios SET password_hash = $1, debe_cambiar_password = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2;',
            [nuevoHash, String(rowUsr.id)]
          );
          objetivoFinal = {
            id: String(rowUsr.id),
            tipo: 'usuario',
            nombre: rowUsr.nombre,
            email: rowUsr.email,
            rut: rowUsr.rut,
            rol: rowUsr.rol || 'Paciente',
            especialidad: '',
            debeCambiarPassword: true
          };
        }
      } catch (eDb) {}
    }

    const resLocal = dataStore.establecerPasswordTemporalUsuario(tipoFinal, claveBusqueda, passwordTemporal)
      || dataStore.establecerPasswordTemporalUsuario(tipoFinal === 'especialista' ? 'usuario' : 'especialista', claveBusqueda, passwordTemporal)
      || (identificador ? dataStore.establecerPasswordTemporalUsuario(tipoFinal, identificador, passwordTemporal) : null);

    if (resLocal && String(resLocal.rol || '').toUpperCase() === 'SUPERADMIN') {
      return res.status(403).json({ error: 'Por seguridad, no se puede restablecer la cuenta SuperAdmin desde este panel.' });
    }

    if (!objetivoFinal && resLocal) {
      tipoFinal = resLocal.especialidad ? 'especialista' : (tipoSolicitado === 'especialista' ? 'especialista' : 'usuario');
      objetivoFinal = {
        id: String(resLocal.id),
        tipo: tipoFinal,
        nombre: resLocal.nombre,
        email: resLocal.email,
        rut: resLocal.rut,
        rol: resLocal.rol || (tipoFinal === 'especialista' ? 'Odontologo' : 'Paciente'),
        especialidad: resLocal.especialidad || '',
        debeCambiarPassword: true
      };
    }

    if (!objetivoFinal) {
      return res.status(404).json({ error: 'Usuario no encontrado en el sistema.' });
    }

    registrarEvento(
      'ADMIN_RESET_PASSWORD',
      `Administrador ${req.usuario.nombre || req.usuario.email} genero contrasena temporal para ${objetivoFinal.nombre} (${objetivoFinal.email || objetivoFinal.rut})`,
      ip,
      req.usuario.id,
      'ALERTA',
      {
        usuarioNombre: req.usuario.nombre,
        usuarioRol: req.usuario.rol,
        objetivoId: objetivoFinal.id,
        objetivoNombre: objetivoFinal.nombre,
        objetivoRol: objetivoFinal.rol,
        requiereCambioPassword: true
      }
    );

    return res.status(200).json({
      mensaje: 'Contrasena temporal generada correctamente. El usuario debera cambiarla al iniciar sesion.',
      passwordTemporal,
      usuario: objetivoFinal
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al restablecer la contrasena del usuario.' });
  }
}

module.exports = {
  obtenerResumenAdmin,
  obtenerMedicosAdmin,
  obtenerPacientesAdmin,
  obtenerDetallePacienteAdmin,
  obtenerRecetasAdmin,
  obtenerLogsAdmin,
  obtenerUsuariosResetAdmin,
  restablecerPasswordUsuarioAdmin
};
