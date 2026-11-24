const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
  buscarMedicoPorEmail,
  buscarMedicoPorRut,
  buscarUsuarioPorRut,
  buscarUsuarioPorEmail,
  crearUsuario,
  cambiarPassword,
  limpiarRut
} = require('../models/dataStore');
const { registrarFalloLogin, limpiarFallosLogin } = require('../middleware/seguridad');
const { registrarEvento } = require('../services/logger');

const { ROLES } = require('../auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dentalsis_super_secret_jwt_2026_key';

function login(req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
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
    if (!usuarioEncontrado && identificador.includes('@')) {
      usuarioEncontrado = buscarUsuarioPorEmail(identificador);
    } else if (!usuarioEncontrado) {
      usuarioEncontrado = buscarUsuarioPorRut(identificador);
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
      registrarFalloLogin(ip, identificador);
      return res.status(401).json({ error: 'Credenciales de acceso invalidas.' });
    }
  }

  const claveCorrecta = bcrypt.compareSync(password, usuarioEncontrado.passwordHash);
  if (!claveCorrecta) {
    registrarFalloLogin(ip, identificador);
    return res.status(401).json({ error: 'Credenciales de acceso invalidas.' });
  }

  limpiarFallosLogin(ip, identificador);

  let rolAsignado = 'Paciente';
  const rolUpper = (usuarioEncontrado.rol || '').toUpperCase();
  if (rolUpper === 'ADMIN' || rolUpper === 'SUPERADMIN' || usuarioEncontrado.rol === 'SuperAdmin') {
    rolAsignado = ROLES.SUPER_ADMIN;
  } else if (rolUpper === 'ODONTOLOGO' || tipoUsuario === 'especialista' || usuarioEncontrado.especialidad) {
    rolAsignado = ROLES.ODONTOLOGO;
  } else if (rolUpper === 'RECEPCIONISTA') {
    rolAsignado = ROLES.RECEPCIONISTA;
  } else if (rolUpper === 'ADMINFINANCIERO' || rolUpper === 'ADMIN_FINANCIERO') {
    rolAsignado = ROLES.ADMIN_FINANCIERO;
  }

  const payload = {
    id: usuarioEncontrado.id,
    nombre: usuarioEncontrado.nombre,
    email: usuarioEncontrado.email,
    rut: usuarioEncontrado.rut,
    rol: rolAsignado
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '4h' });

  registrarEvento('LOGIN_EXITOSO', `Autenticacion correcta para ${identificador}`, ip, usuarioEncontrado.id, 'INFO');

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

function registro(req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
  const { rut, nombre, email, telefono, password } = req.body;

  try {
    const nuevoUsuario = crearUsuario({ rut, nombre, email, telefono, password });

    try {
      const db = require('../models/db');
      if (db.obtenerPool()) {
        const hash = bcrypt.hashSync(password, 10);
        db.query(
          'INSERT INTO usuarios (rut, nombre, email, password_hash, rol, estado) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, nombre = EXCLUDED.nombre, rut = EXCLUDED.rut;',
          [nuevoUsuario.rutFormateado, nuevoUsuario.nombre, nuevoUsuario.email, hash, 'PACIENTE', 'ACTIVO']
        ).catch(() => {});
        const partes = nuevoUsuario.nombre.trim().split(' ');
        const nomP = partes[0] || 'Paciente';
        const apeP = partes.slice(1).join(' ') || 'Registrado';
        db.query(
          'INSERT INTO pacientes (rut, nombre, apellido, fecha_nacimiento, telefono, email) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (rut) DO UPDATE SET telefono = EXCLUDED.telefono, email = EXCLUDED.email;',
          [nuevoUsuario.rutFormateado, nomP, apeP, '2000-01-01', nuevoUsuario.telefono, nuevoUsuario.email]
        ).catch(() => {});
      }
    } catch (eDb) {
    }

    registrarEvento('REGISTRO_USUARIO_EXITOSO', `Nuevo usuario registrado: ${nuevoUsuario.email} (RUT: ${nuevoUsuario.rut})`, ip, nuevoUsuario.id, 'INFO');

    const token = jwt.sign(
      { id: nuevoUsuario.id, nombre: nuevoUsuario.nombre, email: nuevoUsuario.email, rol: 'Paciente' },
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
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
  const { identificador, passwordActual, nuevaPassword } = req.body;

  if (!passwordActual) {
    return res.status(400).json({ error: 'Debe ingresar la contrasena actual para cambiar su clave.' });
  }

  if (!nuevaPassword || nuevaPassword.length < 8) {
    return res.status(400).json({ error: 'La nueva contrasena debe tener al menos 8 caracteres.' });
  }

  try {
    cambiarPassword(identificador, passwordActual, nuevaPassword);

    try {
      const db = require('../models/db');
      if (db.obtenerPool()) {
        const nuevoHash = bcrypt.hashSync(nuevaPassword, 10);
        db.query(
          'UPDATE usuarios SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($2) OR rut = $2;',
          [nuevoHash, identificador.trim()]
        ).catch(() => {});
        db.query(
          'UPDATE especialistas SET password_hash = $1 WHERE LOWER(email) = LOWER($2) OR rut = $2;',
          [nuevoHash, identificador.trim()]
        ).catch(() => {});
      }
    } catch (eDb) {
    }

    registrarEvento('CAMBIO_PASSWORD_EXITOSO', `Actualizacion de clave exitosa para ${identificador}`, ip, null, 'INFO');
    return res.status(200).json({ mensaje: 'Contrasena actualizada exitosamente y hasheada con Bcrypt.' });
  } catch (error) {
    registrarEvento('CAMBIO_PASSWORD_FALLIDO', `Intento de cambio de clave fallido para ${identificador}: ${error.message}`, ip, null, 'ALERTA');
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
