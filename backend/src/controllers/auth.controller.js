const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
  buscarMedicoPorEmail,
  buscarUsuarioPorRut,
  buscarUsuarioPorEmail,
  crearUsuario,
  cambiarPassword,
  limpiarRut
} = require('../models/dataStore');
const { registrarFalloLogin, limpiarFallosLogin } = require('../middleware/seguridad');
const { registrarEvento } = require('../services/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'dentalsis_super_secret_jwt_2026_key';

function login(req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
  const { identificador, password, rol } = req.body;

  if (!identificador || !password) {
    registrarFalloLogin(ip, identificador || 'desconocido');
    return res.status(400).json({ error: 'Credenciales incompletas. Identificador y contrasena requeridos.' });
  }

  let usuarioEncontrado = null;
  let tipoUsuario = rol || 'paciente';

  if (tipoUsuario === 'especialista') {
    usuarioEncontrado = buscarMedicoPorEmail(identificador);
  } else {
    if (identificador.includes('@')) {
      usuarioEncontrado = buscarUsuarioPorEmail(identificador);
    } else {
      usuarioEncontrado = buscarUsuarioPorRut(identificador);
    }
  }

  if (!usuarioEncontrado) {
    registrarFalloLogin(ip, identificador);
    return res.status(401).json({ error: 'Credenciales de acceso invalidas.' });
  }

  const claveCorrecta = bcrypt.compareSync(password, usuarioEncontrado.passwordHash);
  if (!claveCorrecta) {
    registrarFalloLogin(ip, identificador);
    return res.status(401).json({ error: 'Credenciales de acceso invalidas.' });
  }

  limpiarFallosLogin(ip, identificador);

  const payload = {
    id: usuarioEncontrado.id,
    nombre: usuarioEncontrado.nombre,
    email: usuarioEncontrado.email,
    rol: tipoUsuario === 'especialista' ? 'Odontologo' : 'Paciente'
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '4h' });

  registrarEvento('LOGIN_EXITOSO', `Autenticacion correcta para ${identificador}`, ip, usuarioEncontrado.id, 'INFO');

  const { passwordHash, ...perfilSeguro } = usuarioEncontrado;

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

  try {
    cambiarPassword(identificador, passwordActual, nuevaPassword);
    registrarEvento('CAMBIO_PASSWORD_EXITOSO', `Actualizacion de clave exitosa para ${identificador}`, ip, null, 'INFO');
    return res.status(200).json({ mensaje: 'Contrasena actualizada exitosamente y hasheada con Bcrypt.' });
  } catch (error) {
    registrarEvento('CAMBIO_PASSWORD_FALLIDO', `Intento de cambio de clave fallido para ${identificador}: ${error.message}`, ip, null, 'ALERTA');
    return res.status(400).json({ error: error.message });
  }
}

module.exports = {
  login,
  registro,
  actualizarPassword,
  verificarToken
};
