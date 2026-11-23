const logs = [];

function registrarEvento(tipo, detalle, ip, usuarioId = null, nivel = 'INFO') {
  const entrada = {
    id: logs.length + 1,
    timestamp: new Date().toISOString(),
    tipo,
    detalle,
    ip: ip || '127.0.0.1',
    usuarioId,
    nivel
  };
  logs.push(Object.freeze(entrada));
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
