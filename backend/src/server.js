const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');

const { cargarEnv, verificarConexion } = require('./models/db');
cargarEnv();

const {
  rechazarPayloadsXml,
  sanitizarEntradas,
  limiteGlobal
} = require('./middleware/seguridad');
const { obtenerLogsAuditoria, registrarEvento } = require('./services/logger');
const { obtenerIpCliente } = require('./services/ipClient');

const authRutas = require('./routes/auth.routes');
const pacienteRutas = require('./routes/paciente.routes');
const especialistaRutas = require('./routes/especialista.routes');
const medicamentosRutas = require('./routes/medicamentos.routes');
const adminRutas = require('./routes/admin.routes');
const {
  verificarToken,
  verificarRol,
  verificarJwtSesionRequest,
  resolverRutaInicioRol
} = require('./controllers/auth.controller');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(helmet({
  hsts: false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));

const origenesCorsExtra = new Set(
  String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  const proto = req.headers['x-forwarded-proto'];
  const esHttps = req.secure || (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https');
  if (esHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const reqOrigin = req.headers.origin;
  const hostHeader = req.get('host');
  const esMismoOrigen = Boolean(
    reqOrigin && hostHeader && (
      reqOrigin === `https://${hostHeader}`
      || reqOrigin === `http://${hostHeader}`
    )
  );
  if (reqOrigin) {
    res.setHeader('Vary', 'Origin');
    if (!esMismoOrigen && !origenesCorsExtra.has(reqOrigin)) {
      if (req.method === 'OPTIONS') {
        return res.status(403).json({ error: 'Origen CORS no autorizado.' });
      }
      return next();
    }
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Cookie, X-Paciente-Rut');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  }
  next();
});

app.use(limiteGlobal);
app.use(rechazarPayloadsXml);
app.use(express.json({ limit: '10kb' }));
app.use(sanitizarEntradas);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

const rutaPublica = fs.existsSync(path.join(__dirname, '../../public'))
  ? path.join(__dirname, '../../public')
  : path.join(__dirname, '../public');

function servirHtmlSinCache(res, archivo) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.sendFile(path.join(rutaPublica, archivo));
}

app.use((req, res, next) => {
  if (req.method === 'GET' && req.path.endsWith('.html')) {
    const base = req.path.slice(0, -5);
    const destino = (base === '/index' || base === '') ? '/' : base;
    return res.redirect(301, destino);
  }
  next();
});

app.get(['/', '/index'], (req, res) => {
  const sesion = verificarJwtSesionRequest(req);
  if (sesion && sesion.rol) {
    return res.redirect(302, resolverRutaInicioRol(sesion.rol));
  }
  return servirHtmlSinCache(res, 'index.html');
});

app.get('/login', (req, res) => {
  const sesion = verificarJwtSesionRequest(req);
  if (sesion && sesion.rol) {
    return res.redirect(302, resolverRutaInicioRol(sesion.rol));
  }
  return servirHtmlSinCache(res, 'login.html');
});

app.get('/paciente', (req, res) => {
  const sesion = verificarJwtSesionRequest(req);
  if (sesion && sesion.rol) {
    const rolUp = String(sesion.rol).trim().toUpperCase();
    if (rolUp !== 'PACIENTE') {
      return res.redirect(302, resolverRutaInicioRol(sesion.rol));
    }
  }
  return servirHtmlSinCache(res, 'paciente.html');
});

app.get('/especialista', (req, res) => {
  const sesion = verificarJwtSesionRequest(req);
  if (!sesion || !sesion.rol) {
    return res.redirect(302, '/login');
  }
  const rolUp = String(sesion.rol).trim().toUpperCase();
  if (rolUp !== 'ODONTOLOGO' && rolUp !== 'ESPECIALISTA') {
    registrarEvento(
      'ACCESO_PANEL_ESPECIALISTA_DENEGADO',
      `Usuario ${sesion.email || sesion.id} (${sesion.rol}) intento acceder al portal de especialista sin autorizacion`,
      obtenerIpCliente(req),
      sesion.id,
      'PELIGRO',
      { usuarioNombre: sesion.nombre, usuarioRol: sesion.rol }
    );
    return res.redirect(302, resolverRutaInicioRol(sesion.rol));
  }
  return servirHtmlSinCache(res, 'especialista.html');
});

app.get('/admin', (req, res) => {
  const sesion = verificarJwtSesionRequest(req);
  if (!sesion || !sesion.rol) {
    return res.redirect(302, '/login');
  }
  const rolUp = String(sesion.rol).trim().toUpperCase();
  if (rolUp !== 'SUPERADMIN' && rolUp !== 'ADMIN') {
    registrarEvento(
      'ACCESO_PANEL_ADMIN_DENEGADO',
      `Usuario ${sesion.email || sesion.id} (${sesion.rol}) intento acceder al panel administrador sin autorizacion`,
      obtenerIpCliente(req),
      sesion.id,
      'PELIGRO',
      { usuarioNombre: sesion.nombre, usuarioRol: sesion.rol }
    );
    return res.redirect(302, resolverRutaInicioRol(sesion.rol));
  }
  return servirHtmlSinCache(res, 'admin.html');
});

app.use(express.static(rutaPublica, { index: false }));

app.use('/api/auth', authRutas);
app.use('/api/pacientes', pacienteRutas);
app.use('/api/especialistas', especialistaRutas);
app.use('/api/medicamentos', medicamentosRutas);
app.use('/api/admin', adminRutas);

app.get('/api/auditoria', verificarToken, verificarRol('SuperAdmin', 'Admin'), async (req, res) => {
  const logs = await obtenerLogsAuditoria();
  res.status(200).json({
    total: logs.length,
    logs
  });
});

app.get('/api/salud', (req, res) => {
  res.status(200).json({ estado: 'OPERATIVO', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload demasiado grande. Limite de 10kb excedido.' });
  }
  if (err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Cuerpo de peticion JSON invalido.' });
  }
  return res.status(500).json({ error: 'Error interno de seguridad en el servidor.' });
});

const PUERTO = process.env.PORT || 3000;

if (require.main === module) {
  verificarConexion().then(conectado => {
    console.log(`Conexion a Neon PostgreSQL: ${conectado ? 'EXITOSA' : 'MODO LOCAL'}`);
  });
  app.listen(PUERTO, () => {
    console.log(`Servidor DentalSis ejecutandose en el puerto ${PUERTO}`);
  });
}

module.exports = app;
