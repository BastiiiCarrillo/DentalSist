const crypto = require('crypto');
const logs = [];
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registrarEvento(tipo, detalle, ip, usuarioId = null, nivel = 'INFO') {
  const timestamp = new Date().toISOString();
  const entrada = {
    id: logs.length + 1,
    timestamp,
    tipo,
    detalle,
    ip: ip || '127.0.0.1',
    usuarioId,
    nivel
  };
  logs.push(Object.freeze(entrada));

  try {
    const db = require('../models/db');
    if (db && typeof db.obtenerPool === 'function' && db.obtenerPool()) {
      const uidUuid = (usuarioId && REGEX_UUID.test(String(usuarioId))) ? String(usuarioId) : null;
      const detalleJson = JSON.stringify({ mensaje: String(detalle || ''), usuarioRef: usuarioId || null });
      const hashInmutable = crypto
        .createHash('sha256')
        .update(`${tipo}|${timestamp}|${entrada.ip}|${detalleJson}`)
        .digest('hex');

      db.query(
        'INSERT INTO auditoria_seguridad (evento, usuario_id, ip_origen, severidad, detalle, hash_inmutable) VALUES ($1, $2, $3, $4, $5::jsonb, $6);',
        [String(tipo).slice(0, 80), uidUuid, String(entrada.ip).slice(0, 45), String(nivel).slice(0, 20), detalleJson, hashInmutable]
      ).catch(() => {});
    }
  } catch (eDb) {}

  return entrada;
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
  limpiarLogsParaPruebas
};
