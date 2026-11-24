const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const app = require('../src/server');
const { obtenerIpCliente, normalizarIp } = require('../src/services/ipClient');
const {
  crearCita,
  actualizarEstadoCita,
  guardarReceta,
  reiniciarEstadoParaPruebas
} = require('../src/models/dataStore');
const { limpiarLogsParaPruebas, registrarEvento, obtenerLogsAuditoria } = require('../src/services/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'dentalsis_super_secret_jwt_2026_key';

function peticionJson(puerto, ruta, metodo = 'GET', token = null, headersExtra = {}, bodyObj = null) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = {
      ...headersExtra
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: puerto,
      path: ruta,
      method: metodo,
      headers
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let data = {};
        try { data = JSON.parse(raw); } catch (e) { data = { raw }; }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Modulo de Administracion, IP Real y Logs Enriquecidos', () => {
  let server;
  let puerto;
  let tokenAdmin;
  let tokenOdontologo;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        puerto = server.address().port;
        resolve();
      });
    });

    tokenAdmin = jwt.sign(
      { id: 'USR-ADMIN-1', nombre: 'Ing. Admin DentalSis', email: 'admin@dentalsis.cl', rut: '15.432.890-K', rol: 'SuperAdmin' },
      JWT_SECRET
    );
    tokenOdontologo = jwt.sign(
      { id: 'DOC-1', nombre: 'Dr. Álvaro Soto M.', email: 'alvaro.soto@dentalsis.cl', rut: '14.892.341-2', rol: 'Odontologo' },
      JWT_SECRET
    );
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  beforeEach(() => {
    reiniciarEstadoParaPruebas();
    limpiarLogsParaPruebas();
  });

  test('Extraccion de IP real desde encabezados de proxy y normalizacion IPv6', () => {
    assert.strictEqual(obtenerIpCliente({ headers: { 'x-forwarded-for': '190.45.12.34, 10.0.0.5' } }), '190.45.12.34');
    assert.strictEqual(obtenerIpCliente({ headers: { 'cf-connecting-ip': '200.14.88.10', 'x-forwarded-for': '10.1.2.3' } }), '200.14.88.10');
    assert.strictEqual(obtenerIpCliente({ headers: { 'x-real-ip': '::ffff:186.10.20.30' } }), '186.10.20.30');
    assert.strictEqual(obtenerIpCliente({ socket: { remoteAddress: '::1' } }), '127.0.0.1');
    assert.strictEqual(normalizarIp('::ffff:192.168.1.50:443'), '192.168.1.50');
  });

  test('Control de acceso: Admin no puede emitir recetas y especialistas no acceden a /api/admin', async () => {
    const resRecetaAdmin = await peticionJson(puerto, '/api/especialistas/recetas', 'POST', tokenAdmin, {}, {
      rutPaciente: '18.234.901-1',
      medicamentos: [{ nombre: 'Ibuprofeno' }],
      passwordConfirmacion: '86244212351532Aa_'
    });
    assert.strictEqual(resRecetaAdmin.status, 403);

    const resAdminParaMedico = await peticionJson(puerto, '/api/admin/logs', 'GET', tokenOdontologo);
    assert.strictEqual(resAdminParaMedico.status, 403);

    const resMedicosParaAdmin = await peticionJson(puerto, '/api/admin/medicos', 'GET', tokenAdmin);
    assert.strictEqual(resMedicosParaAdmin.status, 200);
    assert.ok(Array.isArray(resMedicosParaAdmin.data.medicos));
  });

  test('Panel Admin lista medicos con citas asignadas, estado En Atencion, cancelaciones con motivo, pacientes y recetas con hora chilena', async () => {
    const citaAtencion = crearCita({
      rutPaciente: '19.876.543-0',
      nombrePaciente: 'Francisca Morales',
      emailPaciente: 'francisca@correo.cl',
      telefonoPaciente: '+56911223344',
      idMedico: 'DOC-1',
      fecha: '2026-11-24',
      hora: '10:00',
      especialidad: 'Cirugía Bucal',
      esInvitado: false
    });
    actualizarEstadoCita(citaAtencion.id, 'EN_ATENCION');

    const citaCancelada = crearCita({
      rutPaciente: '18.234.901-1',
      nombrePaciente: 'Camilo Vega Ortiz',
      emailPaciente: 'camilo@correo.cl',
      telefonoPaciente: '+56987654321',
      idMedico: 'DOC-2',
      fecha: '2026-11-25',
      hora: '15:00',
      especialidad: 'Odontología General',
      esInvitado: false
    });
    actualizarEstadoCita(citaCancelada.id, 'CANCELADA', {
      motivoCancelacion: 'Reprogramacion solicitada por paciente',
      canceladaPor: 'PACIENTE'
    });

    guardarReceta({
      id: 'REC-ADMIN-TEST-1',
      folio: 'REC-ADMIN-TEST-1',
      rutPaciente: '198765430',
      nombrePaciente: 'Francisca Morales',
      idMedico: 'DOC-1',
      nombreMedico: 'Dr. Álvaro Soto M.',
      especialidad: 'Cirugía Bucal',
      registroSis: 'MED-SIS-2026-081',
      registroColegio: 'COL-ODONT-4491',
      medicamentos: [{ nombre: 'Amoxicilina', dosis: '500mg', presentacion: 'Cápsulas', posologia: 'Tomar 1 cápsula cada 8 horas por 7 días', totalUnidades: 21 }],
      indicaciones: 'Completar esquema antibiótico',
      fechaEmision: '2026-11-24T19:30:00.000Z',
      firmaHMAC: 'abcdef1234567890'
    });

    const [resMed, resPac, resRec] = await Promise.all([
      peticionJson(puerto, '/api/admin/medicos', 'GET', tokenAdmin),
      peticionJson(puerto, '/api/admin/pacientes', 'GET', tokenAdmin),
      peticionJson(puerto, '/api/admin/recetas', 'GET', tokenAdmin)
    ]);

    assert.strictEqual(resMed.status, 200);
    const doc1 = resMed.data.medicos.find(m => m.id === 'DOC-1');
    const doc2 = resMed.data.medicos.find(m => m.id === 'DOC-2');
    assert.strictEqual(doc1.enAtencion, true);
    assert.strictEqual(doc1.pacienteEnAtencion.nombrePaciente, 'Francisca Morales');
    assert.ok(doc2.citas.some(c => c.estado === 'CANCELADA' && c.motivoCancelacion === 'Reprogramacion solicitada por paciente'));

    assert.strictEqual(resPac.status, 200);
    const pacFrancisca = resPac.data.pacientes.find(p => p.rutPaciente === '198765430');
    assert.ok(pacFrancisca);
    assert.strictEqual(pacFrancisca.enAtencion, 1);
    assert.strictEqual(pacFrancisca.recetasCount, 1);

    assert.strictEqual(resRec.status, 200);
    assert.strictEqual(resRec.data.soloLectura, true);
    const rec = resRec.data.recetas.find(r => r.folio === 'REC-ADMIN-TEST-1');
    assert.ok(rec);
    assert.strictEqual(rec.fechaEmisionChile, '24-11-2026');
    assert.strictEqual(rec.horaEmisionChile, '16:30:00');
    assert.strictEqual(rec.nombreMedico, 'Dr. Álvaro Soto M.');
    assert.strictEqual(rec.nombrePaciente, 'Francisca Morales');
  });

  test('Logs de auditoria conservan IP reenviada real, nombre de actor y hora chilena', async () => {
    const resLogin = await peticionJson(
      puerto,
      '/api/auth/login',
      'POST',
      null,
      { 'X-Forwarded-For': '190.100.50.25, 10.0.0.1' },
      { identificador: 'admin@dentalsis.cl', password: '86244212351532Aa_', rol: 'admin' }
    );
    assert.strictEqual(resLogin.status, 200);

    registrarEvento('TEST_ACTOR_MEDICO', 'Accion de prueba medico', '200.55.12.9', 'DOC-1', 'INFO');

    const resLogs = await peticionJson(puerto, '/api/admin/logs', 'GET', resLogin.data.token);
    assert.strictEqual(resLogs.status, 200);

    const logLogin = resLogs.data.logs.find(l => l.tipo === 'LOGIN_EXITOSO');
    assert.ok(logLogin);
    assert.strictEqual(logLogin.ip, '190.100.50.25');
    assert.strictEqual(logLogin.usuarioNombre, 'Ing. Admin DentalSis');
    assert.match(logLogin.fechaChile, /^\d{2}-\d{2}-\d{4}$/);
    assert.match(logLogin.horaChile, /^\d{2}:\d{2}:\d{2}$/);

    const logMedico = resLogs.data.logs.find(l => l.tipo === 'TEST_ACTOR_MEDICO');
    assert.ok(logMedico);
    assert.strictEqual(logMedico.usuarioNombre, 'Dr. Álvaro Soto M.');
    assert.strictEqual(logMedico.ip, '200.55.12.9');
  });

  test('Evita duplicados cuando registrarEvento guarda hashInmutable en memoria y DB', async () => {
    const entrada = registrarEvento('LOGIN_EXITOSO', 'Autenticacion correcta para admin@dentalsis.cl', '190.5.49.8', 'USR-ADMIN-1', 'INFO');
    assert.ok(entrada.hashInmutable);
    assert.strictEqual(entrada.hashInmutable.length, 64);

    const logsAudit = await obtenerLogsAuditoria();
    const ocurrencias = logsAudit.filter(l => l.tipo === 'LOGIN_EXITOSO' && l.detalle === 'Autenticacion correcta para admin@dentalsis.cl');
    assert.strictEqual(ocurrencias.length, 1);
    assert.strictEqual(ocurrencias[0].hashInmutable, entrada.hashInmutable);
  });
});
