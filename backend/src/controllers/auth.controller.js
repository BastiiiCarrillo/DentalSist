const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
  buscarMedicoPorId,
  buscarMedicoPorEmail,
  buscarMedicoPorRut,
  buscarUsuarioPorId,
  buscarUsuarioPorRut,
  buscarUsuarioPorEmail,
  crearUsuario,
  cambiarPassword,
  validarPasswordSegura,
  limpiarRut
} = require('../models/dataStore');
const { registrarFalloLogin, limpiarFallosLogin } = require('../middleware/seguridad');
const { registrarEvento } = require('../services/logger');
const { obtenerIpCliente } = require('../services/ipClient');

const { ROLES } = require('../auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dentalsis_super_secret_jwt_2026_key';
const COOKIE_SESION = 'dentalsis_sesion';
const COOKIE_TEMP_PWD = 'dentalsis_temp_pwd';

function parsearCookies(req) {
  const header = req && req.headers && req.headers.cookie;
  const mapa = {};
  if (!header || typeof header !== 'string') return mapa;
  header.split(';').forEach(par => {
    const idx = par.indexOf('=');
    if (idx <= 0) return;
    const clave = par.slice(0, idx).trim();
    const valor = par.slice(idx + 1).trim();
    if (!clave) return;
    try {
      mapa[clave] = decodeURIComponent(valor);
    } catch (e) {
      mapa[clave] = valor;
    }
  });
  return mapa;
}

function esConexionSegura(req) {
  if (!req) return false;
  if (req.secure) return true;
  const proto = req.headers && req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https';
}

function opcionesCookieBase(req, maxAgeMs) {
  const opts = {
    httpOnly: true,
    sameSite: 'lax',
    secure: esConexionSegura(req),
    path: '/'
  };
  if (typeof maxAgeMs === 'number') {
    opts.maxAge = maxAgeMs;
  }
  return opts;
}

function establecerCookieHttpOnly(res, req, nombre, valor, maxAgeMs) {
  if (!res || typeof res.cookie !== 'function') return;
  res.cookie(nombre, valor, opcionesCookieBase(req, maxAgeMs));
}

function limpiarCookieHttpOnly(res, req, nombre) {
  if (!res || typeof res.clearCookie !== 'function') return;
  res.clearCookie(nombre, opcionesCookieBase(req));
}

function limpiarCookiesSesion(res, req) {
  limpiarCookieHttpOnly(res, req, COOKIE_SESION);
  limpiarCookieHttpOnly(res, req, COOKIE_TEMP_PWD);
}

function extraerTokenRequest(req, nombreCookie = COOKIE_SESION) {
  const authHeader = req && req.headers && req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && token !== 'null' && token !== 'undefined') return token;
  }
  const cookies = parsearCookies(req);
  const cookieVal = cookies[nombreCookie];
  return cookieVal ? String(cookieVal).trim() : null;
}

function verificarJwtSesionRequest(req) {
  const token = extraerTokenRequest(req, COOKIE_SESION);
  if (!token) return null;
  try {
    const decodificado = jwt.verify(token, JWT_SECRET);
    if (!decodificado || decodificado.soloCambioPassword) return null;
    return decodificado;
  } catch (e) {
    return null;
  }
}

function esPeticionWebCookie(req) {
  return Boolean(req && req.headers && String(req.headers['x-auth-cookie'] || '').trim() === '1');
}

function resolverRutaInicioRol(rol) {
  const r = String(rol || '').trim().toUpperCase();
  if (r === 'SUPERADMIN' || r === 'ADMIN') return '/admin';
  if (r === 'ODONTOLOGO' || r === 'ESPECIALISTA') return '/especialista';
  if (r === 'PACIENTE') return '/paciente';
  return '/login';
}

const MAPA_UUID_DOC_AUTH = {
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

async function buscarUsuarioLoginDb(identificador, soloEspecialistas) {
  try {
    const db = require('../models/db');
    if (!db.obtenerPool()) return null;
    const idLimpio = identificador.trim().toLowerCase();
    const rutLimpio = identificador.replace(/[^0-9kK]/g, '').toUpperCase();
    const cuerpoLimpio = rutLimpio.length > 1 ? rutLimpio.slice(0, -1) : rutLimpio;

    const consultarEsp = async () => {
      const rEsp = await db.query(
        'SELECT e.id, e.nombre, e.email, e.rut, es.nombre as especialidad, e.password_hash as "passwordHash", e.sillon_habitual as sillon, e.registro_sis as "registroSis", e.registro_colegio as "registroColegio", COALESCE(e.debe_cambiar_password, false) as "debeCambiarPassword" FROM especialistas e LEFT JOIN especialidades es ON e.especialidad_id = es.id WHERE LOWER(e.email) = $1 OR REPLACE(REPLACE(e.rut, $2, $3), $4, $5) = $6 OR SUBSTRING(REPLACE(REPLACE(e.rut, $2, $3), $4, $5) FROM 1 FOR 8) = $7 LIMIT 1;',
        [idLimpio, '.', '', '-', '', rutLimpio, cuerpoLimpio]
      );
      if (rEsp.rows && rEsp.rows.length > 0) {
        const rowEsp = rEsp.rows[0];
        const sillonFmt = typeof rowEsp.sillon === 'number' || /^\d+$/.test(String(rowEsp.sillon || '')) ? `Box ${rowEsp.sillon}` : (rowEsp.sillon || 'Box 1');
        const idNorm = MAPA_UUID_DOC_AUTH[String(rowEsp.id)] || String(rowEsp.id);
        return { ...rowEsp, id: idNorm, uuid: String(rowEsp.id), sillon: sillonFmt, rol: 'Odontologo' };
      }
      return null;
    };

    const consultarUsr = async (filtrarEsp) => {
      const sql = filtrarEsp
        ? 'SELECT u.id, u.nombre, u.email, u.rut, p.telefono, u.password_hash as "passwordHash", u.rol, u.estado, COALESCE(u.debe_cambiar_password, false) as "debeCambiarPassword" FROM usuarios u LEFT JOIN pacientes p ON REPLACE(REPLACE(p.rut, $2, $3), $4, $5) = REPLACE(REPLACE(u.rut, $2, $3), $4, $5) WHERE (LOWER(u.email) = $1 OR REPLACE(REPLACE(u.rut, $2, $3), $4, $5) = $6) AND (UPPER(u.rol) = $7 OR UPPER(u.rol) = $8) LIMIT 1;'
        : 'SELECT u.id, u.nombre, u.email, u.rut, p.telefono, u.password_hash as "passwordHash", u.rol, u.estado, COALESCE(u.debe_cambiar_password, false) as "debeCambiarPassword" FROM usuarios u LEFT JOIN pacientes p ON REPLACE(REPLACE(p.rut, $2, $3), $4, $5) = REPLACE(REPLACE(u.rut, $2, $3), $4, $5) WHERE LOWER(u.email) = $1 OR REPLACE(REPLACE(u.rut, $2, $3), $4, $5) = $6 LIMIT 1;';
      const params = filtrarEsp
        ? [idLimpio, '.', '', '-', '', rutLimpio, 'ODONTOLOGO', 'SUPERADMIN']
        : [idLimpio, '.', '', '-', '', rutLimpio];
      const rDb = await db.query(sql, params);
      return (rDb.rows && rDb.rows.length > 0) ? rDb.rows[0] : null;
    };

    if (soloEspecialistas) {
      return (await consultarEsp()) || (await consultarUsr(true));
    }
    return (await consultarUsr(false)) || (await consultarEsp());
  } catch (eDb) {
    return null;
  }
}

async function login(req, res) {
  const ip = obtenerIpCliente(req);
  const { identificador, password, rol } = req.body;

  if (!identificador || !password) {
    registrarFalloLogin(ip, identificador || 'desconocido');
    return res.status(400).json({ error: 'Credenciales incompletas. Identificador y contrasena requeridos.' });
  }

  let usuarioEncontrado = null;
  const tipoUsuario = (rol || '').toLowerCase();
  const esLoginEspecialista = tipoUsuario === 'especialista' || tipoUsuario === 'medico' || tipoUsuario === 'odontologo';

  usuarioEncontrado = await buscarUsuarioLoginDb(identificador, esLoginEspecialista);

  if (!usuarioEncontrado) {
    if (esLoginEspecialista) {
      usuarioEncontrado = identificador.includes('@')
        ? buscarMedicoPorEmail(identificador)
        : buscarMedicoPorRut(identificador);
      if (!usuarioEncontrado) {
        const uMem = identificador.includes('@') ? buscarUsuarioPorEmail(identificador) : buscarUsuarioPorRut(identificador);
        if (uMem && (uMem.rol === 'SUPERADMIN' || uMem.rol === 'ADMIN' || uMem.rol === 'ODONTOLOGO')) {
          usuarioEncontrado = uMem;
        }
      }
      if (!usuarioEncontrado) {
        registrarFalloLogin(ip, identificador);
        return res.status(401).json({ error: 'No se encontro una cuenta de especialista con estas credenciales.' });
      }
    } else {
      if (identificador.includes('@')) {
        usuarioEncontrado = buscarUsuarioPorEmail(identificador) || buscarMedicoPorEmail(identificador);
      } else {
        usuarioEncontrado = buscarUsuarioPorRut(identificador) || buscarMedicoPorRut(identificador);
      }
      if (!usuarioEncontrado) {
        registrarFalloLogin(ip, identificador);
        return res.status(401).json({ error: 'Credenciales de acceso invalidas.' });
      }
    }
  }

  let claveCorrecta = false;
  if (usuarioEncontrado.passwordHash) {
    try {
      claveCorrecta = bcrypt.compareSync(password, usuarioEncontrado.passwordHash);
    } catch (e) {}
  }
  if (!claveCorrecta) {
    registrarFalloLogin(ip, identificador);
    return res.status(401).json({ error: 'Credenciales de acceso invalidas.' });
  }

  if (usuarioEncontrado.estado && String(usuarioEncontrado.estado).toUpperCase() !== 'ACTIVO') {
    registrarEvento('LOGIN_CUENTA_INACTIVA', `Intento de acceso con cuenta deshabilitada: ${identificador}`, ip, usuarioEncontrado.id, 'ALERTA');
    return res.status(403).json({ error: 'Esta cuenta se encuentra deshabilitada. Contacte al administrador.' });
  }

  limpiarFallosLogin(ip, identificador);

  let rolAsignado = 'Paciente';
  const rolUpper = (usuarioEncontrado.rol || '').toUpperCase();
  if (rolUpper === 'ADMIN' || rolUpper === 'SUPERADMIN' || usuarioEncontrado.rol === 'SuperAdmin') {
    rolAsignado = ROLES.SUPER_ADMIN;
  } else if (rolUpper === 'ODONTOLOGO' || usuarioEncontrado.especialidad) {
    rolAsignado = ROLES.ODONTOLOGO;
  } else if (rolUpper === 'RECEPCIONISTA') {
    rolAsignado = ROLES.RECEPCIONISTA;
  } else if (rolUpper === 'ADMINFINANCIERO' || rolUpper === 'ADMIN_FINANCIERO') {
    rolAsignado = ROLES.ADMIN_FINANCIERO;
  }

  if ((tipoUsuario === 'especialista' || tipoUsuario === 'medico' || tipoUsuario === 'odontologo') && rolAsignado !== ROLES.ODONTOLOGO && rolAsignado !== ROLES.SUPER_ADMIN) {
    registrarFalloLogin(ip, identificador);
    return res.status(403).json({ error: 'Acceso denegado: Esta cuenta no posee permisos de especialista dental.' });
  }

  const payload = {
    id: usuarioEncontrado.id,
    nombre: usuarioEncontrado.nombre,
    email: usuarioEncontrado.email,
    rut: usuarioEncontrado.rut,
    rol: rolAsignado
  };

  const requiereCambioPassword = Boolean(usuarioEncontrado.debeCambiarPassword || usuarioEncontrado.debe_cambiar_password);

  if (requiereCambioPassword) {
    const tempToken = jwt.sign(
      {
        ...payload,
        soloCambioPassword: true
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    registrarEvento('LOGIN_CON_PASSWORD_TEMPORAL', `Usuario ${identificador} ingreso con contrasena temporal y debe definir una nueva clave`, ip, usuarioEncontrado.id, 'ALERTA', {
      usuarioNombre: usuarioEncontrado.nombre,
      usuarioRol: rolAsignado
    });

    limpiarCookieHttpOnly(res, req, COOKIE_SESION);
    establecerCookieHttpOnly(res, req, COOKIE_TEMP_PWD, tempToken, 15 * 60 * 1000);

    if (esPeticionWebCookie(req)) {
      return res.status(200).json({
        requiereCambioPassword: true,
        mensaje: 'Ingresaste con una contrasena temporal. Por favor introduce una nueva contrasena para continuar.',
        usuario: {
          nombre: usuarioEncontrado.nombre,
          rol: rolAsignado
        }
      });
    }

    return res.status(200).json({
      requiereCambioPassword: true,
      tempToken,
      mensaje: 'Ingresaste con una contrasena temporal. Por favor introduce una nueva contrasena para continuar.',
      usuario: {
        id: usuarioEncontrado.id,
        nombre: usuarioEncontrado.nombre,
        email: usuarioEncontrado.email,
        rut: usuarioEncontrado.rut,
        rol: rolAsignado
      }
    });
  }

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '4h' });

  registrarEvento('LOGIN_EXITOSO', `Autenticacion correcta para ${identificador}`, ip, usuarioEncontrado.id, 'INFO', {
    usuarioNombre: usuarioEncontrado.nombre,
    usuarioRol: rolAsignado
  });

  limpiarCookieHttpOnly(res, req, COOKIE_TEMP_PWD);
  establecerCookieHttpOnly(res, req, COOKIE_SESION, token, 4 * 60 * 60 * 1000);

  if (esPeticionWebCookie(req)) {
    return res.status(200).json({
      mensaje: 'Autenticacion exitosa.',
      redireccion: resolverRutaInicioRol(rolAsignado),
      usuario: {
        nombre: usuarioEncontrado.nombre,
        rol: rolAsignado
      }
    });
  }

  const { passwordHash, ...perfilSeguro } = usuarioEncontrado;
  perfilSeguro.rol = rolAsignado;

  return res.status(200).json({
    mensaje: 'Autenticacion exitosa.',
    token,
    usuario: perfilSeguro
  });
}

function verificarToken(req, res, next) {
  const token = extraerTokenRequest(req, COOKIE_SESION);
  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado: Token no proporcionado.' });
  }
  try {
    const decodificado = jwt.verify(token, JWT_SECRET);
    if (decodificado.soloCambioPassword) {
      return res.status(403).json({
        error: 'Debe cambiar su contrasena temporal antes de acceder al portal.',
        requiereCambioPassword: true
      });
    }
    req.usuario = decodificado;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token invalido o expirado.' });
  }
}

function verificarTokenCambioTemporal(req, res, next) {
  const token = extraerTokenRequest(req, COOKIE_TEMP_PWD);
  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado: Token temporal no proporcionado.' });
  }
  try {
    const decodificado = jwt.verify(token, JWT_SECRET);
    if (!decodificado.soloCambioPassword) {
      return res.status(403).json({ error: 'Token invalido para cambio de contrasena temporal.' });
    }
    req.usuario = decodificado;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'El token temporal expiro o es invalido. Vuelve a iniciar sesion.' });
  }
}

async function registro(req, res) {
  const ip = obtenerIpCliente(req);
  const { rut, nombre, email, telefono, password } = req.body;

  try {
    const nuevoUsuario = crearUsuario({ rut, nombre, email, telefono, password });

    try {
      const db = require('../models/db');
      if (db.obtenerPool()) {
        const hash = bcrypt.hashSync(password, 10);
        const rCheck = await db.query('SELECT id FROM usuarios WHERE email = $1 OR rut = $2;', [nuevoUsuario.email, nuevoUsuario.rutFormateado]);
        if (rCheck.rows && rCheck.rows.length > 0) {
          await db.query(
            'UPDATE usuarios SET password_hash = $1, nombre = $2, rut = $3, email = $4 WHERE id = $5;',
            [hash, nuevoUsuario.nombre, nuevoUsuario.rutFormateado, nuevoUsuario.email, rCheck.rows[0].id]
          );
        } else {
          await db.query(
            'INSERT INTO usuarios (rut, nombre, email, password_hash, rol, estado) VALUES ($1, $2, $3, $4, $5, $6);',
            [nuevoUsuario.rutFormateado, nuevoUsuario.nombre, nuevoUsuario.email, hash, 'PACIENTE', 'ACTIVO']
          );
        }

        const partes = nuevoUsuario.nombre.trim().split(' ');
        const nomP = partes[0] || 'Paciente';
        const apeP = partes.slice(1).join(' ') || 'Registrado';
        const rPacCheck = await db.query('SELECT id FROM pacientes WHERE rut = $1 OR email = $2;', [nuevoUsuario.rutFormateado, nuevoUsuario.email]);
        if (rPacCheck.rows && rPacCheck.rows.length > 0) {
          await db.query(
            'UPDATE pacientes SET nombre = $1, apellido = $2, telefono = $3, email = $4, rut = $5 WHERE id = $6;',
            [nomP, apeP, nuevoUsuario.telefono, nuevoUsuario.email, nuevoUsuario.rutFormateado, rPacCheck.rows[0].id]
          );
        } else {
          await db.query(
            'INSERT INTO pacientes (rut, nombre, apellido, fecha_nacimiento, telefono, email) VALUES ($1, $2, $3, $4, $5, $6);',
            [nuevoUsuario.rutFormateado, nomP, apeP, '2000-01-01', nuevoUsuario.telefono, nuevoUsuario.email]
          );
        }
      }
    } catch (eDb) {
    }

    registrarEvento('REGISTRO_USUARIO_EXITOSO', `Nuevo usuario registrado: ${nuevoUsuario.email} (RUT: ${nuevoUsuario.rut})`, ip, nuevoUsuario.id, 'INFO', {
      usuarioNombre: nuevoUsuario.nombre,
      usuarioRol: 'Paciente'
    });

    const token = jwt.sign(
      { id: nuevoUsuario.id, nombre: nuevoUsuario.nombre, email: nuevoUsuario.email, rut: nuevoUsuario.rutFormateado, rol: 'Paciente' },
      JWT_SECRET,
      { expiresIn: '4h' }
    );

    limpiarCookieHttpOnly(res, req, COOKIE_TEMP_PWD);
    establecerCookieHttpOnly(res, req, COOKIE_SESION, token, 4 * 60 * 60 * 1000);

    if (esPeticionWebCookie(req)) {
      return res.status(201).json({
        mensaje: 'Usuario registrado exitosamente en DentalSis.',
        redireccion: '/paciente',
        usuario: {
          nombre: nuevoUsuario.nombre,
          rol: 'Paciente'
        }
      });
    }

    return res.status(201).json({
      mensaje: 'Usuario registrado exitosamente en DentalSis.',
      usuario: nuevoUsuario,
      token
    });
  } catch (error) {
    registrarEvento('REGISTRO_USUARIO_RECHAZADO', `Fallo al registrar usuario: ${error.message}`, ip, null, 'ALERTA');
    return res.status(400).json({ error: error.message });
  }
}

function actualizarPassword(req, res) {
  const ip = obtenerIpCliente(req);
  const { identificador, passwordActual, nuevaPassword } = req.body;

  if (!identificador || !passwordActual) {
    return res.status(400).json({ error: 'Debe ingresar identificador y contrasena actual para cambiar su clave.' });
  }

  if (req.usuario) {
    const rolTok = (req.usuario.rol || '').toUpperCase();
    const esAdminTok = rolTok === 'SUPERADMIN' || rolTok === 'ADMIN';
    if (!esAdminTok) {
      const idStr = String(identificador).trim().toLowerCase();
      const emailTok = String(req.usuario.email || '').trim().toLowerCase();
      const rutId = limpiarRut(identificador);
      const rutTok = limpiarRut(req.usuario.rut || '');
      const coincideEmail = emailTok && idStr === emailTok;
      const coincideRut = rutTok && rutId && rutTok === rutId;
      if (!coincideEmail && !coincideRut) {
        registrarEvento('CAMBIO_PASSWORD_NO_AUTORIZADO', `Intento de cambiar clave de ${identificador} desde otra cuenta`, ip, req.usuario.id, 'PELIGRO');
        return res.status(403).json({ error: 'No tiene autorizacion para modificar la contrasena de otra cuenta.' });
      }
    }
  }

  const errComplejidad = validarPasswordSegura(nuevaPassword);
  if (errComplejidad) {
    return res.status(400).json({ error: errComplejidad });
  }

  try {
    cambiarPassword(identificador, passwordActual, nuevaPassword);

    try {
      const db = require('../models/db');
      if (db.obtenerPool()) {
        const nuevoHash = bcrypt.hashSync(nuevaPassword, 10);
        const rutClean = limpiarRut(identificador);
        db.query(
          'UPDATE usuarios SET password_hash = $1, debe_cambiar_password = FALSE, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($2) OR REPLACE(REPLACE(rut, \'.\', \'\'), \'-\', \'\') = $3;',
          [nuevoHash, identificador.trim(), rutClean]
        ).catch(() => {});
        db.query(
          'UPDATE especialistas SET password_hash = $1, debe_cambiar_password = FALSE WHERE LOWER(email) = LOWER($2) OR REPLACE(REPLACE(rut, \'.\', \'\'), \'-\', \'\') = $3;',
          [nuevoHash, identificador.trim(), rutClean]
        ).catch(() => {});
      }
    } catch (eDb) {
    }

    registrarEvento('CAMBIO_PASSWORD_EXITOSO', `Actualizacion de clave exitosa para ${identificador}`, ip, (req.usuario && req.usuario.id) || null, 'INFO');
    return res.status(200).json({ mensaje: 'Contrasena actualizada exitosamente y hasheada con Bcrypt.' });
  } catch (error) {
    registrarEvento('CAMBIO_PASSWORD_FALLIDO', `Intento de cambio de clave fallido para ${identificador}: ${error.message}`, ip, (req.usuario && req.usuario.id) || null, 'ALERTA');
    return res.status(400).json({ error: error.message });
  }
}

async function completarPasswordTemporal(req, res) {
  const { obtenerIpCliente } = require('../services/ipClient');
  const dataStore = require('../models/dataStore');
  const db = require('../models/db');
  const ip = obtenerIpCliente(req);
  const passwordNueva = String(req.body?.passwordNueva || req.body?.nuevaPassword || '');
  const confirmarPassword = req.body?.confirmarPassword !== undefined ? String(req.body.confirmarPassword) : undefined;

  if (!passwordNueva) {
    return res.status(400).json({ error: 'Debe ingresar la nueva contrasena.' });
  }
  if (confirmarPassword !== undefined && passwordNueva !== confirmarPassword) {
    return res.status(400).json({ error: 'Las contrasenas nuevas no coinciden.' });
  }

  const errComplejidad = validarPasswordSegura(passwordNueva);
  if (errComplejidad) {
    return res.status(400).json({ error: errComplejidad });
  }

  const usuarioToken = req.usuario || {};
  const idUsuario = String(usuarioToken.id || '');
  const emailUsuario = String(usuarioToken.email || '').trim().toLowerCase();
  const rutUsuario = String(usuarioToken.rut || '');
  const rutClean = limpiarRut(rutUsuario);
  const cuerpoRut = rutClean.length >= 8 ? rutClean.slice(0, 8) : rutClean;
  const nuevoHash = bcrypt.hashSync(passwordNueva, 10);

  let perfilActualizado = null;

  let dbConectada = false;
  try {
    if (db.obtenerPool()) {
      let rowDb = null;
      const rUser = await db.query(
        'SELECT u.id, u.nombre, u.email, u.rut, p.telefono, u.password_hash as "passwordHash", u.rol, u.estado FROM usuarios u LEFT JOIN pacientes p ON REPLACE(REPLACE(p.rut, $4, $5), $6, $7) = REPLACE(REPLACE(u.rut, $4, $5), $6, $7) WHERE u.id::text = $1 OR ($2 <> \'\' AND LOWER(u.email) = $2) OR ($3 <> \'\' AND REPLACE(REPLACE(u.rut, $4, $5), $6, $7) = $3) LIMIT 1;',
        [idUsuario, emailUsuario, rutClean, '.', '', '-', '']
      );
      if (rUser.rows && rUser.rows.length > 0) {
        rowDb = { tabla: 'usuarios', row: rUser.rows[0] };
      } else {
        const rEsp = await db.query(
          'SELECT e.id, e.nombre, e.email, e.rut, es.nombre as especialidad, e.password_hash as "passwordHash", e.sillon_habitual as sillon, e.registro_sis as "registroSis", e.registro_colegio as "registroColegio" FROM especialistas e LEFT JOIN especialidades es ON e.especialidad_id = es.id WHERE e.id::text = $1 OR ($2 <> \'\' AND LOWER(e.email) = $2) OR ($3 <> \'\' AND REPLACE(REPLACE(e.rut, $5, $6), $7, $8) = $3) OR ($4 <> \'\' AND SUBSTRING(REPLACE(REPLACE(e.rut, $5, $6), $7, $8) FROM 1 FOR 8) = $4) LIMIT 1;',
          [idUsuario, emailUsuario, rutClean, cuerpoRut, '.', '', '-', '']
        );
        if (rEsp.rows && rEsp.rows.length > 0) {
          rowDb = { tabla: 'especialistas', row: rEsp.rows[0] };
        }
      }

      if (rowDb) {
        dbConectada = true;
        if (rowDb.row.passwordHash && bcrypt.compareSync(passwordNueva, rowDb.row.passwordHash)) {
          return res.status(400).json({ error: 'La nueva contrasena debe ser distinta a la contrasena temporal.' });
        }
        if (rowDb.tabla === 'usuarios') {
          await db.query(
            'UPDATE usuarios SET password_hash = $1, debe_cambiar_password = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2 OR LOWER(email) = $3 OR REPLACE(REPLACE(rut, $5, $6), $7, $8) = $4;',
            [nuevoHash, idUsuario, emailUsuario, rutClean, '.', '', '-', '']
          );
          perfilActualizado = { ...rowDb.row, rol: usuarioToken.rol || rowDb.row.rol };
        } else {
          await db.query(
            'UPDATE especialistas SET password_hash = $1, debe_cambiar_password = FALSE WHERE id::text = $2 OR LOWER(email) = $3 OR REPLACE(REPLACE(rut, $4, $5), $6, $7) = $8;',
            [nuevoHash, idUsuario, emailUsuario, '.', '', '-', '', rutClean]
          );
          const rowEsp = rowDb.row;
          const sillonFmt = typeof rowEsp.sillon === 'number' || /^\d+$/.test(String(rowEsp.sillon || '')) ? `Box ${rowEsp.sillon}` : (rowEsp.sillon || 'Box 1');
          perfilActualizado = { ...rowEsp, sillon: sillonFmt, rol: 'Odontologo' };
        }
      }
    }
  } catch (eDb) {
    dbConectada = false;
  }

  try {
    const resLocal = dataStore.completarPasswordTemporalUsuario(
      idUsuario,
      emailUsuario || rutUsuario,
      usuarioToken.rol,
      passwordNueva,
      !dbConectada
    );
    if (!perfilActualizado && resLocal) {
      perfilActualizado = resLocal;
    }

    if (!perfilActualizado) {
      return res.status(404).json({ error: 'Usuario no encontrado para actualizar su contrasena.' });
    }

    const rolBruto = String(usuarioToken.rol || perfilActualizado.rol || 'Paciente').trim().toUpperCase();
    const rolFinal = rolBruto === 'ODONTOLOGO'
      ? 'Odontologo'
      : rolBruto === 'SUPERADMIN'
        ? 'SuperAdmin'
        : rolBruto === 'ADMIN'
          ? 'Admin'
          : rolBruto === 'RECEPCIONISTA'
            ? 'Recepcionista'
            : 'Paciente';
    const payloadSesion = {
      id: perfilActualizado.id,
      nombre: perfilActualizado.nombre,
      email: perfilActualizado.email,
      rut: perfilActualizado.rut,
      rol: rolFinal
    };

    const token = jwt.sign(payloadSesion, JWT_SECRET, { expiresIn: '4h' });
    const { passwordHash, debeCambiarPassword, debe_cambiar_password, ...perfilSeguro } = perfilActualizado;
    perfilSeguro.rol = rolFinal;
    perfilSeguro.debeCambiarPassword = false;

    registrarEvento('PASSWORD_TEMPORAL_ACTUALIZADA', `Usuario ${perfilSeguro.email || perfilSeguro.rut} definio su nueva contrasena definitiva`, ip, perfilSeguro.id, 'INFO', {
      usuarioNombre: perfilSeguro.nombre,
      usuarioRol: rolFinal
    });

    limpiarCookieHttpOnly(res, req, COOKIE_TEMP_PWD);
    establecerCookieHttpOnly(res, req, COOKIE_SESION, token, 4 * 60 * 60 * 1000);

    if (esPeticionWebCookie(req)) {
      return res.status(200).json({
        mensaje: 'Contrasena actualizada exitosamente.',
        redireccion: resolverRutaInicioRol(rolFinal),
        usuario: {
          nombre: perfilSeguro.nombre,
          rol: rolFinal
        }
      });
    }

    return res.status(200).json({
      mensaje: 'Contrasena actualizada exitosamente.',
      token,
      usuario: perfilSeguro
    });
  } catch (error) {
    registrarEvento('CAMBIO_PASSWORD_FALLIDO', `Error al completar cambio de contrasena temporal para ${emailUsuario || rutUsuario}: ${error.message}`, ip, idUsuario || null, 'ALERTA');
    return res.status(400).json({ error: error.message || 'No se pudo actualizar la contrasena temporal.' });
  }
}

function logout(req, res) {
  const sesion = verificarJwtSesionRequest(req);
  if (sesion) {
    registrarEvento('LOGOUT_USUARIO', `Cierre de sesion para ${sesion.email || sesion.id}`, obtenerIpCliente(req), sesion.id, 'INFO', {
      usuarioNombre: sesion.nombre,
      usuarioRol: sesion.rol
    });
  }
  limpiarCookiesSesion(res, req);
  if (res && typeof res.set === 'function') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  return res.status(200).json({ mensaje: 'Sesion cerrada correctamente.' });
}

async function obtenerSesionActual(req, res) {
  if (res && typeof res.set === 'function') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
  }

  const sesion = verificarJwtSesionRequest(req);
  if (!sesion) {
    return res.status(200).json({ autenticado: false, usuario: null });
  }

  let perfilBase = null;
  const rolUp = String(sesion.rol || '').trim().toUpperCase();
  const esEsp = rolUp === 'ODONTOLOGO' || rolUp === 'ESPECIALISTA';

  if (esEsp) {
    perfilBase = buscarMedicoPorId(sesion.id)
      || (sesion.email ? buscarMedicoPorEmail(sesion.email) : null)
      || (sesion.rut ? buscarMedicoPorRut(sesion.rut) : null);
  } else {
    perfilBase = buscarUsuarioPorId(sesion.id)
      || (sesion.rut ? buscarUsuarioPorRut(sesion.rut) : null)
      || (sesion.email ? buscarUsuarioPorEmail(sesion.email) : null);
  }

  try {
    const db = require('../models/db');
    if (db.obtenerPool()) {
      const rutClean = limpiarRut(sesion.rut || '');
      const emailClean = String(sesion.email || '').trim().toLowerCase();
      const idStr = String(sesion.id || '');
      if (esEsp) {
        const rEsp = await db.query(
          'SELECT e.id, e.nombre, e.email, e.rut, es.nombre as especialidad, e.sillon_habitual as sillon, e.registro_sis as "registroSis", e.registro_colegio as "registroColegio", COALESCE(e.debe_cambiar_password, false) as "debeCambiarPassword" FROM especialistas e LEFT JOIN especialidades es ON e.especialidad_id = es.id WHERE e.id::text = $1 OR ($2 <> \'\' AND LOWER(e.email) = $2) OR ($3 <> \'\' AND REPLACE(REPLACE(e.rut, $4, $5), $6, $7) = $3) LIMIT 1;',
          [idStr, emailClean, rutClean, '.', '', '-', '']
        );
        if (rEsp.rows && rEsp.rows.length > 0) {
          const rowEsp = rEsp.rows[0];
          const sillonFmt = typeof rowEsp.sillon === 'number' || /^\d+$/.test(String(rowEsp.sillon || '')) ? `Box ${rowEsp.sillon}` : (rowEsp.sillon || 'Box 1');
          const idNorm = MAPA_UUID_DOC_AUTH[String(rowEsp.id)] || String(rowEsp.id);
          perfilBase = { ...(perfilBase || {}), ...rowEsp, id: idNorm, uuid: String(rowEsp.id), sillon: sillonFmt };
        }
      }
      const rUsr = await db.query(
        'SELECT u.id, u.nombre, u.email, u.rut, p.telefono, u.rol, u.estado, COALESCE(u.debe_cambiar_password, false) as "debeCambiarPassword" FROM usuarios u LEFT JOIN pacientes p ON REPLACE(REPLACE(p.rut, $4, $5), $6, $7) = REPLACE(REPLACE(u.rut, $4, $5), $6, $7) WHERE u.id::text = $1 OR ($2 <> \'\' AND LOWER(u.email) = $2) OR ($3 <> \'\' AND REPLACE(REPLACE(u.rut, $4, $5), $6, $7) = $3) LIMIT 1;',
        [idStr, emailClean, rutClean, '.', '', '-', '']
      );
      if (rUsr.rows && rUsr.rows.length > 0) {
        const uDb = rUsr.rows[0];
        if (!esEsp) {
          perfilBase = { ...(perfilBase || {}), ...uDb };
        } else if (perfilBase) {
          perfilBase.estado = uDb.estado;
          perfilBase.debeCambiarPassword = Boolean(perfilBase.debeCambiarPassword || uDb.debeCambiarPassword);
        } else {
          perfilBase = uDb;
        }
      }
    }
  } catch (eDb) {
  }

  if (perfilBase) {
    if (perfilBase.estado && String(perfilBase.estado).trim().toUpperCase() !== 'ACTIVO') {
      limpiarCookiesSesion(res, req);
      return res.status(200).json({ autenticado: false, usuario: null });
    }
    if (perfilBase.debeCambiarPassword || perfilBase.debe_cambiar_password) {
      limpiarCookiesSesion(res, req);
      return res.status(200).json({ autenticado: false, usuario: null });
    }
  }

  const usuarioRespuesta = {
    id: (perfilBase && perfilBase.id) || sesion.id,
    nombre: (perfilBase && perfilBase.nombre) || sesion.nombre,
    email: (perfilBase && perfilBase.email) || sesion.email,
    rut: (perfilBase && (perfilBase.rutFormateado || perfilBase.rut)) || sesion.rut,
    rol: sesion.rol
  };

  if (perfilBase && perfilBase.telefono) {
    usuarioRespuesta.telefono = perfilBase.telefono;
  }
  if (esEsp && perfilBase) {
    if (perfilBase.especialidad) usuarioRespuesta.especialidad = perfilBase.especialidad;
    if (perfilBase.sillon) usuarioRespuesta.sillon = perfilBase.sillon;
    if (perfilBase.registroSis) usuarioRespuesta.registroSis = perfilBase.registroSis;
    if (perfilBase.registroColegio) usuarioRespuesta.registroColegio = perfilBase.registroColegio;
  }

  return res.status(200).json({
    autenticado: true,
    usuario: usuarioRespuesta
  });
}

function verificarRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'Acceso no autorizado: Sesion no iniciada.' });
    }
    const rolActual = (req.usuario.rol || '').toUpperCase();
    const permitidos = rolesPermitidos.map(r => r.toUpperCase());
    if (!permitidos.includes(rolActual) && !permitidos.includes('ALL')) {
      return res.status(403).json({ error: 'Acceso denegado: No posee los permisos requeridos para esta accion.' });
    }
    next();
  };
}

module.exports = {
  login,
  logout,
  obtenerSesionActual,
  registro,
  actualizarPassword,
  completarPasswordTemporal,
  verificarToken,
  verificarTokenCambioTemporal,
  verificarRol,
  verificarJwtSesionRequest,
  resolverRutaInicioRol,
  COOKIE_SESION,
  COOKIE_TEMP_PWD
};
