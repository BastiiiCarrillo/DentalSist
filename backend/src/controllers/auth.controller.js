const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
  buscarMedicoPorEmail,
  buscarMedicoPorRut,
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

async function login(req, res) {
  const ip = obtenerIpCliente(req);
  const { identificador, password, rol } = req.body;

  if (!identificador || !password) {
    registrarFalloLogin(ip, identificador || 'desconocido');
    return res.status(400).json({ error: 'Credenciales incompletas. Identificador y contrasena requeridos.' });
  }

  let usuarioEncontrado = null;
  const tipoUsuario = (rol || '').toLowerCase();

  if (tipoUsuario === 'especialista' || tipoUsuario === 'medico' || tipoUsuario === 'odontologo') {
    if (identificador.includes('@')) {
      usuarioEncontrado = buscarMedicoPorEmail(identificador);
    } else {
      usuarioEncontrado = buscarMedicoPorRut(identificador);
    }
    if (!usuarioEncontrado) {
      const uMem = identificador.includes('@') ? buscarUsuarioPorEmail(identificador) : buscarUsuarioPorRut(identificador);
      if (uMem && (uMem.rol === 'SUPERADMIN' || uMem.rol === 'ADMIN' || uMem.rol === 'ODONTOLOGO')) {
        usuarioEncontrado = uMem;
      }
    }
    if (!usuarioEncontrado) {
      try {
        const db = require('../models/db');
        if (db.obtenerPool()) {
          const idLimpio = identificador.trim().toLowerCase();
          const rutLimpio = identificador.replace(/[^0-9kK]/g, '').toUpperCase();
          const cuerpoLimpio = rutLimpio.length > 1 ? rutLimpio.slice(0, -1) : rutLimpio;
          const rEsp = await db.query(
            'SELECT e.id, e.nombre, e.email, e.rut, es.nombre as especialidad, e.password_hash as "passwordHash", e.sillon_habitual as sillon, e.registro_sis as "registroSis", e.registro_colegio as "registroColegio" FROM especialistas e LEFT JOIN especialidades es ON e.especialidad_id = es.id WHERE LOWER(e.email) = $1 OR REPLACE(REPLACE(e.rut, $2, $3), $4, $5) = $6 OR SUBSTRING(REPLACE(REPLACE(e.rut, $2, $3), $4, $5) FROM 1 FOR 8) = $7 LIMIT 1;',
            [idLimpio, '.', '', '-', '', rutLimpio, cuerpoLimpio]
          );
          if (rEsp.rows && rEsp.rows.length > 0) {
            const rowEsp = rEsp.rows[0];
            const sillonFmt = typeof rowEsp.sillon === 'number' || /^\d+$/.test(String(rowEsp.sillon || '')) ? `Box ${rowEsp.sillon}` : (rowEsp.sillon || 'Box 1');
            usuarioEncontrado = { ...rowEsp, sillon: sillonFmt, rol: 'Odontologo' };
          } else {
            const rDb = await db.query(
              'SELECT u.id, u.nombre, u.email, u.rut, p.telefono, u.password_hash as "passwordHash", u.rol, u.estado FROM usuarios u LEFT JOIN pacientes p ON REPLACE(REPLACE(p.rut, $2, $3), $4, $5) = REPLACE(REPLACE(u.rut, $2, $3), $4, $5) WHERE (LOWER(u.email) = $1 OR REPLACE(REPLACE(u.rut, $2, $3), $4, $5) = $6) AND (UPPER(u.rol) = $7 OR UPPER(u.rol) = $8) LIMIT 1;',
              [idLimpio, '.', '', '-', '', rutLimpio, 'ODONTOLOGO', 'SUPERADMIN']
            );
            if (rDb.rows && rDb.rows.length > 0) {
              usuarioEncontrado = rDb.rows[0];
            }
          }
        }
      } catch (eDb) {
      }
    }
    if (!usuarioEncontrado) {
      registrarFalloLogin(ip, identificador);
      return res.status(401).json({ error: 'No se encontro una cuenta de especialista con estas credenciales.' });
    }
  } else {
    if (identificador.includes('@')) {
      usuarioEncontrado = buscarUsuarioPorEmail(identificador);
      if (!usuarioEncontrado) {
        usuarioEncontrado = buscarMedicoPorEmail(identificador);
      }
    } else {
      usuarioEncontrado = buscarUsuarioPorRut(identificador);
      if (!usuarioEncontrado) {
        usuarioEncontrado = buscarMedicoPorRut(identificador);
      }
    }
    if (!usuarioEncontrado) {
      try {
        const db = require('../models/db');
        if (db.obtenerPool()) {
          const idLimpio = identificador.trim().toLowerCase();
          const rutLimpio = identificador.replace(/[^0-9kK]/g, '').toUpperCase();
          const cuerpoLimpio = rutLimpio.length > 1 ? rutLimpio.slice(0, -1) : rutLimpio;
          const rDb = await db.query(
            'SELECT u.id, u.nombre, u.email, u.rut, p.telefono, u.password_hash as "passwordHash", u.rol, u.estado FROM usuarios u LEFT JOIN pacientes p ON REPLACE(REPLACE(p.rut, $2, $3), $4, $5) = REPLACE(REPLACE(u.rut, $2, $3), $4, $5) WHERE LOWER(u.email) = $1 OR REPLACE(REPLACE(u.rut, $2, $3), $4, $5) = $6 LIMIT 1;',
            [idLimpio, '.', '', '-', '', rutLimpio]
          );
          if (rDb.rows && rDb.rows.length > 0) {
            usuarioEncontrado = rDb.rows[0];
          } else {
            const rEsp = await db.query(
              'SELECT e.id, e.nombre, e.email, e.rut, es.nombre as especialidad, e.password_hash as "passwordHash", e.sillon_habitual as sillon, e.registro_sis as "registroSis", e.registro_colegio as "registroColegio" FROM especialistas e LEFT JOIN especialidades es ON e.especialidad_id = es.id WHERE LOWER(e.email) = $1 OR REPLACE(REPLACE(e.rut, $2, $3), $4, $5) = $6 OR SUBSTRING(REPLACE(REPLACE(e.rut, $2, $3), $4, $5) FROM 1 FOR 8) = $7 LIMIT 1;',
              [idLimpio, '.', '', '-', '', rutLimpio, cuerpoLimpio]
            );
            if (rEsp.rows && rEsp.rows.length > 0) {
              const rowEsp = rEsp.rows[0];
              const sillonFmt = typeof rowEsp.sillon === 'number' || /^\d+$/.test(String(rowEsp.sillon || '')) ? `Box ${rowEsp.sillon}` : (rowEsp.sillon || 'Box 1');
              usuarioEncontrado = { ...rowEsp, sillon: sillonFmt, rol: 'Odontologo' };
            }
          }
        }
      } catch (eDb) {
      }
    }
    if (!usuarioEncontrado) {
      registrarFalloLogin(ip, identificador);
      return res.status(401).json({ error: 'Credenciales de acceso invalidas.' });
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

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '4h' });

  registrarEvento('LOGIN_EXITOSO', `Autenticacion correcta para ${identificador}`, ip, usuarioEncontrado.id, 'INFO', {
    usuarioNombre: usuarioEncontrado.nombre,
    usuarioRol: rolAsignado
  });

  const { passwordHash, ...perfilSeguro } = usuarioEncontrado;
  perfilSeguro.rol = rolAsignado;

  return res.status(200).json({
    mensaje: 'Autenticacion exitosa.',
    token,
    usuario: perfilSeguro
  });
}

function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso no autorizado: Token no proporcionado.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decodificado = jwt.verify(token, JWT_SECRET);
    req.usuario = decodificado;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token invalido o expirado.' });
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
          'UPDATE usuarios SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($2) OR REPLACE(REPLACE(rut, \'.\', \'\'), \'-\', \'\') = $3;',
          [nuevoHash, identificador.trim(), rutClean]
        ).catch(() => {});
        db.query(
          'UPDATE especialistas SET password_hash = $1 WHERE LOWER(email) = LOWER($2) OR REPLACE(REPLACE(rut, \'.\', \'\'), \'-\', \'\') = $3;',
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
  registro,
  actualizarPassword,
  verificarToken,
  verificarRol
};
