const crypto = require('crypto');
const { normalizarIp } = require('./ipClient');
const logs = [];
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatearFechaHoraChile(isoORDate) {
  const d = isoORDate ? new Date(isoORDate) : new Date();
  const fechaObj = isNaN(d.getTime()) ? new Date() : d;
  const fechaChile = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(fechaObj).replace(/\//g, '-');
  const horaChile = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(fechaObj).replace(/^24:/, '00:');
  return { fechaChile, horaChile };
}

function resolverActorSistema(usuarioId, extra = {}) {
  if (extra && extra.usuarioNombre) {
    return {
      usuarioNombre: extra.usuarioNombre,
      usuarioRol: extra.usuarioRol || 'Usuario'
    };
  }
  if (!usuarioId) {
    return { usuarioNombre: 'Sistema / Visitante', usuarioRol: 'Sistema' };
  }
  const ref = String(usuarioId).trim();
  try {
    const ds = require('../models/dataStore');
    const med = (typeof ds.buscarMedicoPorId === 'function' ? ds.buscarMedicoPorId(ref) : null)
      || (ref.includes('@') && typeof ds.buscarMedicoPorEmail === 'function' ? ds.buscarMedicoPorEmail(ref) : null)
      || (typeof ds.buscarMedicoPorRut === 'function' ? ds.buscarMedicoPorRut(ref) : null);
    if (med) {
      return { usuarioNombre: med.nombre, usuarioRol: 'Especialista' };
    }
    const usr = (typeof ds.buscarUsuarioPorId === 'function' ? ds.buscarUsuarioPorId(ref) : null)
      || (ref.includes('@') && typeof ds.buscarUsuarioPorEmail === 'function' ? ds.buscarUsuarioPorEmail(ref) : null)
      || (typeof ds.buscarUsuarioPorRut === 'function' ? ds.buscarUsuarioPorRut(ref) : null);
    if (usr) {
      return { usuarioNombre: usr.nombre, usuarioRol: usr.rol || 'Usuario' };
    }
    if (typeof ds.limpiarRut === 'function' && typeof ds.formatearRut === 'function') {
      const rutClean = ds.limpiarRut(ref);
      if (rutClean.length >= 7 && rutClean.length <= 9) {
        return { usuarioNombre: `Paciente (${ds.formatearRut(rutClean)})`, usuarioRol: 'Paciente' };
      }
    }
  } catch (e) {}
  return { usuarioNombre: ref, usuarioRol: 'Usuario' };
}

function registrarEvento(tipo, detalle, ip, usuarioId = null, nivel = 'INFO', extra = {}) {
  const timestamp = new Date().toISOString();
  const { fechaChile, horaChile } = formatearFechaHoraChile(timestamp);
  const ipLimpia = normalizarIp(ip) || '127.0.0.1';
  const actor = resolverActorSistema(usuarioId, extra);

  const entrada = {
    id: logs.length + 1,
    timestamp,
    fechaChile,
    horaChile,
    tipo,
    detalle,
    ip: ipLimpia,
    usuarioId,
    usuarioNombre: actor.usuarioNombre,
    usuarioRol: actor.usuarioRol,
    nivel
  };
  logs.push(Object.freeze(entrada));

  try {
    const db = require('../models/db');
    if (db && typeof db.obtenerPool === 'function' && db.obtenerPool()) {
      const uidUuid = (usuarioId && REGEX_UUID.test(String(usuarioId))) ? String(usuarioId) : null;
      const detalleJson = JSON.stringify({
        mensaje: String(detalle || ''),
        usuarioRef: usuarioId || null,
        usuarioNombre: actor.usuarioNombre,
        usuarioRol: actor.usuarioRol
      });
      const hashInmutable = crypto
        .createHash('sha256')
        .update(`${tipo}|${timestamp}|${ipLimpia}|${detalleJson}`)
        .digest('hex');

      db.query(
        'INSERT INTO auditoria_seguridad (evento, usuario_id, ip_origen, severidad, detalle, hash_inmutable) VALUES ($1, $2, $3, $4, $5::jsonb, $6);',
        [String(tipo).slice(0, 80), uidUuid, String(ipLimpia).slice(0, 45), String(nivel).slice(0, 20), detalleJson, hashInmutable]
      ).catch(() => {});
    }
  } catch (eDb) {}

  return entrada;
}

function formatearDetalleDb(detalleRaw) {
  if (!detalleRaw) return { mensaje: '' };
  if (typeof detalleRaw === 'string') {
    try {
      return formatearDetalleDb(JSON.parse(detalleRaw));
    } catch (e) {
      return { mensaje: detalleRaw };
    }
  }
  if (detalleRaw.mensaje) return detalleRaw;
  if (detalleRaw.tabla) {
    return {
      mensaje: `Operación ${detalleRaw.operacion || 'DB'} en tabla ${detalleRaw.tabla} (${detalleRaw.id || ''})`,
      usuarioNombre: 'Trigger BD PostgreSQL',
      usuarioRol: 'Base de Datos'
    };
  }
  return { mensaje: JSON.stringify(detalleRaw) };
}

async function obtenerLogsAuditoria() {
  const resultado = [];
  const clavesVistas = new Set();

  try {
    const db = require('../models/db');
    if (db && typeof db.obtenerPool === 'function' && db.obtenerPool()) {
      const r = await db.query(`
        SELECT a.id, a.evento, a.usuario_id as "usuarioId", a.ip_origen as ip, a.severidad, a.detalle,
               a.hash_inmutable as "hashInmutable", a.created_at as "createdAt",
               COALESCE(u.nombre, e.nombre) as "actorDbNombre",
               COALESCE(u.rol, CASE WHEN e.id IS NOT NULL THEN 'Odontologo' ELSE NULL END) as "actorDbRol"
        FROM auditoria_seguridad a
        LEFT JOIN usuarios u ON a.usuario_id = u.id
        LEFT JOIN especialistas e ON a.usuario_id = e.id
        ORDER BY a.created_at DESC
        LIMIT 300;
      `);
      if (r && r.rows) {
        r.rows.forEach(row => {
          const det = formatearDetalleDb(row.detalle);
          const refUsuario = det.usuarioRef || row.usuarioId;
          const actorResuelto = resolverActorSistema(refUsuario, {
            usuarioNombre: row.actorDbNombre || det.usuarioNombre,
            usuarioRol: row.actorDbRol || det.usuarioRol
          });
          const iso = row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt || Date.now()).toISOString();
          const { fechaChile, horaChile } = formatearFechaHoraChile(iso);
          const item = {
            id: row.id,
            timestamp: iso,
            fechaChile,
            horaChile,
            tipo: row.evento,
            detalle: det.mensaje || '',
            ip: normalizarIp(row.ip) || row.ip || '127.0.0.1',
            usuarioId: refUsuario || null,
            usuarioNombre: actorResuelto.usuarioNombre,
            usuarioRol: actorResuelto.usuarioRol,
            nivel: row.severidad || 'INFO',
            hashInmutable: row.hashInmutable || ''
          };
          const clave = row.hashInmutable || `${row.evento}|${iso.slice(0, 19)}|${item.detalle}`;
          clavesVistas.add(clave);
          resultado.push(item);
        });
      }
    }
  } catch (eDb) {}

  obtenerLogs().forEach(l => {
    const clave = `${l.tipo}|${String(l.timestamp || '').slice(0, 19)}|${l.detalle}`;
    if (!clavesVistas.has(clave)) {
      clavesVistas.add(clave);
      const { fechaChile, horaChile } = formatearFechaHoraChile(l.timestamp);
      resultado.push({
        ...l,
        fechaChile: l.fechaChile || fechaChile,
        horaChile: l.horaChile || horaChile
      });
    }
  });

  resultado.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return resultado;
}

function obtenerLogs() {
  return [...logs].reverse();
}

function limpiarLogsParaPruebas() {
  logs.length = 0;
}

module.exports = {
  registrarEvento,
  obtenerLogs,
  obtenerLogsAuditoria,
  limpiarLogsParaPruebas,
  formatearFechaHoraChile
};
