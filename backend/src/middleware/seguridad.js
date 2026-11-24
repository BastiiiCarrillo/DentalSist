const rateLimit = require('express-rate-limit');
const { registrarEvento } = require('../services/logger');
const { obtenerIpCliente } = require('../services/ipClient');

const intentosFallidos = new Map();

function obtenerClaveIntento(ip, identificador) {
  const idLimpio = (identificador || 'anonimo').toLowerCase().trim();
  return `${ip}_${idLimpio}`;
}

function verificarBloqueoEscalonado(req, res, next) {
  const ip = obtenerIpCliente(req);
  const identificador = req.body.identificador || req.body.email || req.body.rut || 'anonimo';
  const clave = obtenerClaveIntento(ip, identificador);
  const registro = intentosFallidos.get(clave);

  if (registro && registro.bloqueadoHasta && Date.now() < registro.bloqueadoHasta) {
    const segundosRestantes = Math.ceil((registro.bloqueadoHasta - Date.now()) / 1000);
    res.setHeader('Retry-After', segundosRestantes);
    registrarEvento('ACCESO_BLOQUEADO', `Bloqueo activo para ${identificador}. Restan ${segundosRestantes}s`, ip, null, 'ALERTA');
    return res.status(429).json({
      error: 'Demasiados intentos fallidos. Intente nuevamente mas tarde.',
      segundosEspera: segundosRestantes
    });
  }

  next();
}

function registrarFalloLogin(ip, identificador) {
  const clave = obtenerClaveIntento(ip, identificador);
  const actual = intentosFallidos.get(clave) || { intentos: 0, totalFallos: 0, bloqueadoHasta: null };

  actual.intentos += 1;
  actual.totalFallos += 1;

  if (actual.totalFallos >= 5) {
    actual.bloqueadoHasta = Date.now() + 60 * 60 * 1000;
    actual.intentos = 0;
    registrarEvento('BLOQUEO_CRITICO', `Bloqueo de 1 hora aplicado a ${identificador}`, ip, null, 'PELIGRO');
  } else if (actual.intentos >= 3) {
    actual.bloqueadoHasta = Date.now() + 10 * 60 * 1000;
    actual.intentos = 0;
    registrarEvento('BLOQUEO_TEMPORAL', `Bloqueo de 10 minutos aplicado a ${identificador}`, ip, null, 'ALERTA');
  } else {
    registrarEvento('LOGIN_FALLIDO', `Intento fallido #${actual.intentos} para ${identificador}`, ip, null, 'INFO');
  }

  intentosFallidos.set(clave, actual);
}

function limpiarFallosLogin(ip, identificador) {
  const clave = obtenerClaveIntento(ip, identificador);
  intentosFallidos.delete(clave);
}

function rechazarPayloadsXml(req, res, next) {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('xml')) {
    const ip = obtenerIpCliente(req);
    registrarEvento('ATAQUE_XML_DETECTADO', 'Peticion XML rechazada para prevencion XXE', ip, null, 'PELIGRO');
    return res.status(415).json({
      error: 'Formato de contenido no soportado. Solo se admite application/json.'
    });
  }
  next();
}

function sanitizarCadena(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/javascript:/gi, '');
}

const CLAVES_PASSWORD_SIN_ESCAPAR = new Set([
  'password',
  'passwordActual',
  'nuevaPassword',
  'confirmPass',
  'passwordConfirmacion',
  'clave',
  'passwordAdmin',
  'passwordNueva',
  'confirmarPassword',
  'passwordTemporal'
]);

function sanitizarObjeto(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const clave of Object.keys(obj)) {
    if (!Object.prototype.hasOwnProperty.call(obj, clave)) {
      continue;
    }
    if (clave === '__proto__' || clave === 'constructor' || clave === 'prototype') {
      continue;
    }
    if (CLAVES_PASSWORD_SIN_ESCAPAR.has(clave)) {
      continue;
    }
    if (typeof obj[clave] === 'string') {
      obj[clave] = sanitizarCadena(obj[clave]);
    } else if (typeof obj[clave] === 'object' && obj[clave] !== null) {
      sanitizarObjeto(obj[clave]);
    }
  }
  return obj;
}

function sanitizarEntradas(req, res, next) {
  if (req.body) sanitizarObjeto(req.body);
  if (req.query) sanitizarObjeto(req.query);
  if (req.params) sanitizarObjeto(req.params);
  next();
}

const limiteOperacionesSensibles = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => obtenerIpCliente(req),
  validate: { trustProxy: false, xForwardedForHeader: false, keyGeneratorIpFallback: false },
  message: {
    error: 'Limite de operaciones excedido para esta direccion IP. Intente mas tarde.'
  }
});

const limiteGlobal = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => obtenerIpCliente(req),
  validate: { trustProxy: false, xForwardedForHeader: false, keyGeneratorIpFallback: false },
  skip: (req) => {
    const u = req.originalUrl || req.url || '';
    if (!u.startsWith('/api')) return true;
    return u.includes('/disponibilidad') || u.includes('/salud');
  },
  message: {
    error: 'Limite global de peticiones excedido.'
  }
});

module.exports = {
  verificarBloqueoEscalonado,
  registrarFalloLogin,
  limpiarFallosLogin,
  rechazarPayloadsXml,
  sanitizarEntradas,
  sanitizarCadena,
  limiteOperacionesSensibles,
  limiteGlobal
};
