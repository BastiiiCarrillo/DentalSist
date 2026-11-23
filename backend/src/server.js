const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { cargarEnv, verificarConexion } = require('./models/db');
cargarEnv();

const {
  rechazarPayloadsXml,
  sanitizarEntradas,
  limiteGlobal
} = require('./middleware/seguridad');
const { obtenerLogs } = require('./services/logger');

const authRutas = require('./routes/auth.routes');
const pacienteRutas = require('./routes/paciente.routes');
const especialistaRutas = require('./routes/especialista.routes');
const medicamentosRutas = require('./routes/medicamentos.routes');
const { verificarToken, verificarRol } = require('./controllers/auth.controller');

const app = express();

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(limiteGlobal);
app.use(rechazarPayloadsXml);
app.use(express.json({ limit: '10kb' }));
app.use(sanitizarEntradas);

const rutaPublica = fs.existsSync(path.join(__dirname, '../../public'))
  ? path.join(__dirname, '../../public')
  : path.join(__dirname, '../public');

app.use(express.static(rutaPublica));

app.use('/api/auth', authRutas);
app.use('/api/pacientes', pacienteRutas);
app.use('/api/especialistas', especialistaRutas);
app.use('/api/medicamentos', medicamentosRutas);

app.get('/api/auditoria', verificarToken, verificarRol('SuperAdmin', 'Admin'), (req, res) => {
  res.status(200).json({
    total: obtenerLogs().length,
    logs: obtenerLogs()
  });
});

app.get('/api/salud', (req, res) => {
  res.status(200).json({ estado: 'OPERATIVO', timestamp: new Date().toISOString() });
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(rutaPublica, 'login.html'));
});

app.get('/paciente', (req, res) => {
  res.sendFile(path.join(rutaPublica, 'paciente.html'));
});

app.get('/especialista', (req, res) => {
  res.sendFile(path.join(rutaPublica, 'especialista.html'));
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
