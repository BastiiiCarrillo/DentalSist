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
        resolve({ status: res.statusCode, headers: res.headers, data });
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

  test('Seguridad BOLA: pacientes no ven citas ajenas, medicos no ven ni modifican citas de otros colegas y API envia Cache-Control no-store', async () => {
    const resReg = await peticionJson(puerto, '/api/auth/registro', 'POST', null, {}, {
      rut: '19.876.543-0',
      nombre: 'Francisca Auditoria',
      email: 'francisca.bola@correo.cl',
      telefono: '+56 9 1122 3344',
      password: 'PasswordSegura2026!'
    });
    assert.strictEqual(resReg.status, 201);
    assert.strictEqual(resReg.headers['cache-control'], 'no-store');
    const tokenPacNuevo = resReg.data.token;

    const resPropio = await peticionJson(puerto, '/api/pacientes/citas/19.876.543-0', 'GET', tokenPacNuevo);
    assert.strictEqual(resPropio.status, 200);

    const resAjeno = await peticionJson(puerto, '/api/pacientes/citas/18.234.901-1', 'GET', tokenPacNuevo);
    assert.strictEqual(resAjeno.status, 403);

    const resCambioPassAjeno = await peticionJson(puerto, '/api/auth/cambiar-password', 'POST', tokenPacNuevo, {}, {
      identificador: 'alvaro.soto@dentalsis.cl',
      passwordActual: 'SotoCirugia2026!Clinica',
      nuevaPassword: 'OtraPassword2026!'
    });
    assert.strictEqual(resCambioPassAjeno.status, 403);

    const resAgendaAjena = await peticionJson(puerto, '/api/especialistas/agenda/DOC-1', 'GET', tokenOdontologo);
    assert.strictEqual(resAgendaAjena.status, 200);

    const tokenOtroMed = jwt.sign(
      { id: 'DOC-2', nombre: 'Dra. Fernanda Ríos', email: 'fernanda.rios@dentalsis.cl', rut: '16.781.423-5', rol: 'Odontologo' },
      JWT_SECRET
    );
    const resAgendaBloqueada = await peticionJson(puerto, '/api/especialistas/agenda/DOC-1', 'GET', tokenOtroMed);
    assert.strictEqual(resAgendaBloqueada.status, 403);

    const hoyChile = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
    const citaDoc1 = crearCita({
      rutPaciente: '18.234.901-1',
      nombrePaciente: 'Camilo Vega Ortiz',
      emailPaciente: 'camilo@correo.cl',
      telefonoPaciente: '+56987654321',
      idMedico: 'DOC-1',
      fecha: hoyChile,
      hora: '11:00',
      especialidad: 'Cirugía Bucal',
      esInvitado: false
    });
    const resEstadoAjeno = await peticionJson(puerto, `/api/especialistas/citas/${citaDoc1.id}/estado`, 'PATCH', tokenOtroMed, {}, {
      nuevoEstado: 'EN_ATENCION'
    });
    assert.strictEqual(resEstadoAjeno.status, 403);
  });

  test('Cuentas de auditoria (cliente y especialista) autentican correctamente via Bcrypt', async () => {
    const resLoginPac = await peticionJson(puerto, '/api/auth/login', 'POST', null, { 'X-Forwarded-For': '190.5.49.10' }, {
      identificador: '22.090.455-5',
      password: 'AudCli!v4U%$ku8T4',
      rol: 'paciente'
    });
    assert.strictEqual(resLoginPac.status, 200);
    assert.strictEqual(resLoginPac.data.usuario.email, 'audituser.cliente@dentalsis.cl');
    assert.strictEqual(resLoginPac.data.usuario.nombre, 'AuditUser Cliente');
    assert.strictEqual(resLoginPac.data.usuario.rol, 'Paciente');

    const resLoginMed = await peticionJson(puerto, '/api/auth/login', 'POST', null, { 'X-Forwarded-For': '190.5.49.11' }, {
      identificador: 'audituser.especialista@dentalsis.cl',
      password: 'AudEsp!sW222@a#rY',
      rol: 'especialista'
    });
    assert.strictEqual(resLoginMed.status, 200);
    assert.strictEqual(resLoginMed.data.usuario.id, 'DOC-12');
    assert.strictEqual(resLoginMed.data.usuario.rut, '17.749.622-7');
    assert.strictEqual(resLoginMed.data.usuario.nombre, 'Dr. AuditUser Especialista');
    assert.strictEqual(resLoginMed.data.usuario.rol, 'Odontologo');
  });

  test('Logs de triggers AUDIT DELETE y UPDATE se muestran como ALERTA mientras creaciones e historial quedan INFO', async () => {
    const fs = require('fs');
    const path = require('path');
    const db = require('../src/models/db');
    const origPool = db.obtenerPool;
    const origQuery = db.query;
    db.obtenerPool = () => null;
    db.query = async () => ({ rows: [] });

    try {
      registrarEvento('AUDIT_recetas_DELETE', 'Operacion DELETE en tabla recetas (id-1)', '127.0.0.1', null, 'INFO');
      registrarEvento('AUDIT_fichas_clinicas_UPDATE', 'Operacion UPDATE en tabla fichas_clinicas (id-2)', '127.0.0.1', null, 'INFO');
      registrarEvento('AUDIT_recetas_INSERT', 'Operacion INSERT en tabla recetas (id-3)', '127.0.0.1', null, 'INFO');
      registrarEvento('RECETA_FIRMADA_EMITIDA', 'Receta firmada normalmente por especialista', '198.51.100.20', 'DOC-1', 'INFO');

      const resLogs = await peticionJson(puerto, '/api/admin/logs', 'GET', tokenAdmin);
      assert.strictEqual(resLogs.status, 200);

      const logDel = resLogs.data.logs.find(l => l.tipo === 'AUDIT_recetas_DELETE');
      const logUpd = resLogs.data.logs.find(l => l.tipo === 'AUDIT_fichas_clinicas_UPDATE');
      const logIns = resLogs.data.logs.find(l => l.tipo === 'AUDIT_recetas_INSERT');
      const logRec = resLogs.data.logs.find(l => l.tipo === 'RECETA_FIRMADA_EMITIDA');

      assert.ok(logDel);
      assert.strictEqual(logDel.nivel, 'ALERTA');
      assert.ok(logUpd);
      assert.strictEqual(logUpd.nivel, 'ALERTA');
      assert.ok(logIns);
      assert.strictEqual(logIns.nivel, 'INFO');
      assert.ok(logRec);
      assert.strictEqual(logRec.nivel, 'INFO');

      const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'src', 'models', 'schema.sql'), 'utf8');
      const dbJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'models', 'db.js'), 'utf8');
      assert.match(schemaSql, /TG_OP IN \('DELETE', 'UPDATE'\) THEN 'ALERTA'/);
      assert.match(dbJs, /TG_OP IN \('DELETE', 'UPDATE'\) THEN 'ALERTA'/);
    } finally {
      db.obtenerPool = origPool;
      db.query = origQuery;
    }
  });

  test('Admin restablece contrasena con autorizacion y fuerza cambio temporal al iniciar sesion (paciente y especialista)', async () => {
    const db = require('../src/models/db');
    const origPool = db.obtenerPool;
    const origQuery = db.query;
    db.obtenerPool = () => null;
    db.query = async () => ({ rows: [] });

    try {
      const resNoAdminList = await peticionJson(puerto, '/api/admin/usuarios', 'GET', tokenOdontologo);
      assert.strictEqual(resNoAdminList.status, 403);

      const resLista = await peticionJson(puerto, '/api/admin/usuarios', 'GET', tokenAdmin);
      assert.strictEqual(resLista.status, 200);
      assert.ok(Array.isArray(resLista.data.usuarios));
      assert.ok(resLista.data.usuarios.length >= 2);
      assert.ok(!resLista.data.usuarios.some(u => u.rol === 'SuperAdmin'));
      assert.ok(!resLista.data.usuarios.some(u => Object.prototype.hasOwnProperty.call(u, 'passwordHash')));

      const resSinClave = await peticionJson(
        puerto,
        '/api/admin/usuarios/restablecer-password',
        'POST',
        tokenAdmin,
        { 'X-Forwarded-For': '198.51.100.31' },
        { tipo: 'usuario', identificador: 'audituser.cliente@dentalsis.cl' }
      );
      assert.strictEqual(resSinClave.status, 400);

      const resClaveMala = await peticionJson(
        puerto,
        '/api/admin/usuarios/restablecer-password',
        'POST',
        tokenAdmin,
        { 'X-Forwarded-For': '198.51.100.32' },
        { tipo: 'usuario', identificador: 'audituser.cliente@dentalsis.cl', passwordAdmin: 'Incorrecta99!' }
      );
      assert.strictEqual(resClaveMala.status, 403);

      const resResetPac = await peticionJson(
        puerto,
        '/api/admin/usuarios/restablecer-password',
        'POST',
        tokenAdmin,
        { 'X-Forwarded-For': '198.51.100.33' },
        { tipo: 'usuario', identificador: 'audituser.cliente@dentalsis.cl', passwordAdmin: '86244212351532Aa_' }
      );
      assert.strictEqual(resResetPac.status, 200);
      assert.ok(resResetPac.data.passwordTemporal);
      assert.strictEqual(resResetPac.data.usuario.debeCambiarPassword, true);

      const pwdTempPac = resResetPac.data.passwordTemporal;

      const logsTrasReset = await obtenerLogsAuditoria();
      const logReset = logsTrasReset.find(l => l.tipo === 'ADMIN_RESET_PASSWORD' && l.detalle.includes('audituser.cliente@dentalsis.cl'));
      assert.ok(logReset);
      assert.strictEqual(logReset.nivel, 'ALERTA');
      assert.ok(!logReset.detalle.includes(pwdTempPac));

      const resLoginTempPac = await peticionJson(
        puerto,
        '/api/auth/login',
        'POST',
        null,
        { 'X-Forwarded-For': '198.51.100.34' },
        { identificador: 'audituser.cliente@dentalsis.cl', password: pwdTempPac, rol: 'paciente' }
      );
      assert.strictEqual(resLoginTempPac.status, 200);
      assert.strictEqual(resLoginTempPac.data.requiereCambioPassword, true);
      assert.ok(resLoginTempPac.data.tempToken);

      const resPortalBloqueado = await peticionJson(
        puerto,
        '/api/pacientes/citas/22.090.455-5',
        'GET',
        resLoginTempPac.data.tempToken
      );
      assert.strictEqual(resPortalBloqueado.status, 403);
      assert.strictEqual(resPortalBloqueado.data.requiereCambioPassword, true);

      const resMismaClave = await peticionJson(
        puerto,
        '/api/auth/completar-password-temporal',
        'POST',
        resLoginTempPac.data.tempToken,
        { 'X-Forwarded-For': '198.51.100.35' },
        { passwordNueva: pwdTempPac, confirmarPassword: pwdTempPac }
      );
      assert.strictEqual(resMismaClave.status, 400);

      const resDebil = await peticionJson(
        puerto,
        '/api/auth/completar-password-temporal',
        'POST',
        resLoginTempPac.data.tempToken,
        { 'X-Forwarded-For': '198.51.100.36' },
        { passwordNueva: 'debil', confirmarPassword: 'debil' }
      );
      assert.strictEqual(resDebil.status, 400);

      const resCompletarPac = await peticionJson(
        puerto,
        '/api/auth/completar-password-temporal',
        'POST',
        resLoginTempPac.data.tempToken,
        { 'X-Forwarded-For': '198.51.100.37' },
        { passwordNueva: 'NuevaPac2026!Seguro', confirmarPassword: 'NuevaPac2026!Seguro' }
      );
      assert.strictEqual(resCompletarPac.status, 200);
      assert.ok(resCompletarPac.data.token);
      assert.strictEqual(resCompletarPac.data.usuario.debeCambiarPassword, false);

      const resLoginFinalPac = await peticionJson(
        puerto,
        '/api/auth/login',
        'POST',
        null,
        { 'X-Forwarded-For': '198.51.100.38' },
        { identificador: 'audituser.cliente@dentalsis.cl', password: 'NuevaPac2026!Seguro', rol: 'paciente' }
      );
      assert.strictEqual(resLoginFinalPac.status, 200);
      assert.ok(resLoginFinalPac.data.token);
      assert.ok(!resLoginFinalPac.data.requiereCambioPassword);

      const resResetMed = await peticionJson(
        puerto,
        '/api/admin/usuarios/restablecer-password',
        'POST',
        tokenAdmin,
        { 'X-Forwarded-For': '198.51.100.39' },
        { tipo: 'especialista', idUsuario: 'DOC-12', passwordAdmin: '86244212351532Aa_' }
      );
      assert.strictEqual(resResetMed.status, 200);
      const pwdTempMed = resResetMed.data.passwordTemporal;

      const resLoginTempMed = await peticionJson(
        puerto,
        '/api/auth/login',
        'POST',
        null,
        { 'X-Forwarded-For': '198.51.100.40' },
        { identificador: 'audituser.especialista@dentalsis.cl', password: pwdTempMed, rol: 'especialista' }
      );
      assert.strictEqual(resLoginTempMed.status, 200);
      assert.strictEqual(resLoginTempMed.data.requiereCambioPassword, true);

      const resAgendaBloqueada = await peticionJson(
        puerto,
        '/api/especialistas/agenda/DOC-12',
        'GET',
        resLoginTempMed.data.tempToken
      );
      assert.strictEqual(resAgendaBloqueada.status, 403);

      const resCompletarMed = await peticionJson(
        puerto,
        '/api/auth/completar-password-temporal',
        'POST',
        resLoginTempMed.data.tempToken,
        { 'X-Forwarded-For': '198.51.100.41' },
        { passwordNueva: 'NuevaMed2026!Clinica', confirmarPassword: 'NuevaMed2026!Clinica' }
      );
      assert.strictEqual(resCompletarMed.status, 200);
      assert.ok(resCompletarMed.data.token);
      assert.strictEqual(resCompletarMed.data.usuario.rol, 'Odontologo');
    } finally {
      db.obtenerPool = origPool;
      db.query = origQuery;
      reiniciarEstadoParaPruebas();
      limpiarLogsParaPruebas();
    }
  });

  test('Endurecimiento de seguridad: sin credenciales DB hardcoded, preservacion de claves especiales y bloqueo de cuentas inactivas', async () => {
    const fs = require('fs');
    const path = require('path');
    const db = require('../src/models/db');
    const { sanitizarEntradas } = require('../src/middleware/seguridad');
    const ds = require('../src/models/dataStore');
    const origPool = db.obtenerPool;
    const origQuery = db.query;
    db.obtenerPool = () => null;
    db.query = async () => ({ rows: [] });

    try {
      const dbCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'models', 'db.js'), 'utf8');
      assert.ok(!dbCode.includes('DEFAULT_CONN'));

      const reqMock = {
        body: {
          nombre: '<script>alert(1)</script>',
          passwordAdmin: 'Admin<2026>&"',
          passwordNueva: 'Nueva<Clave>&2026!',
          confirmarPassword: 'Nueva<Clave>&2026!'
        },
        query: {},
        params: {}
      };
      sanitizarEntradas(reqMock, {}, () => {});
      assert.strictEqual(reqMock.body.nombre, '&lt;script&gt;alert(1)&lt;/script&gt;');
      assert.strictEqual(reqMock.body.passwordAdmin, 'Admin<2026>&"');
      assert.strictEqual(reqMock.body.passwordNueva, 'Nueva<Clave>&2026!');
      assert.strictEqual(reqMock.body.confirmarPassword, 'Nueva<Clave>&2026!');

      const usr = ds.buscarUsuarioPorEmail('audituser.cliente@dentalsis.cl');
      usr.estado = 'INACTIVO';
      const resInactivo = await peticionJson(puerto, '/api/auth/login', 'POST', null, { 'X-Forwarded-For': '198.51.100.77' }, {
        identificador: 'audituser.cliente@dentalsis.cl',
        password: 'AudCli!v4U%$ku8T4',
        rol: 'paciente'
      });
      assert.strictEqual(resInactivo.status, 403);
      usr.estado = 'ACTIVO';
    } finally {
      db.obtenerPool = origPool;
      db.query = origQuery;
    }
  });

  test('Consistencia de conteo totalPacientes entre KPI resumen y pestana pacientes e identificacion de invitado', async () => {
    const db = require('../src/models/db');
    const origPool = db.obtenerPool;
    const origQuery = db.query;

    db.obtenerPool = () => ({ mocked: true });
    db.query = async (sql) => {
      if (sql.includes('FROM especialistas')) {
        return { rows: [] };
      }
      if (sql.includes('FROM pacientes p') && sql.includes('fichasCount')) {
        return {
          rows: [
            { rut: '18.234.901-1', nombrePaciente: 'Camilo Vega Ortiz', email: 'camilo.vega@correo.cl', telefono: '+56 9 8765 4321', fichasCount: '1' },
            { rut: '19.876.543-0', nombrePaciente: 'Francisca Morales', email: 'francisca@correo.cl', telefono: '+56 9 1122 3344', fichasCount: '0' },
            { rut: '22.090.455-5', nombrePaciente: 'AuditUser Cliente', email: 'audituser.cliente@dentalsis.cl', telefono: '+56 9 6482 1930', fichasCount: '0' }
          ]
        };
      }
      if (sql.includes('FROM usuarios') && sql.includes('PACIENTE')) {
        return {
          rows: [
            { rut: '18.234.901-1', nombre: 'Camilo Vega Ortiz', email: 'camilo.vega@correo.cl' },
            { rut: '22.090.455-5', nombre: 'AuditUser Cliente', email: 'audituser.cliente@dentalsis.cl' }
          ]
        };
      }
      return { rows: [] };
    };

    try {
      crearCita({
        rutPaciente: '12.541.563-6',
        nombrePaciente: 'Invitado Prueba',
        emailPaciente: 'invitado@correo.cl',
        telefonoPaciente: '+56 9 5555 6666',
        idMedico: 'DOC-1',
        fecha: '2026-11-24',
        hora: '12:00',
        especialidad: 'Cirugía Bucal',
        esInvitado: true
      });

      const [resResumen, resPacientes, resMedicos] = await Promise.all([
        peticionJson(puerto, '/api/admin/resumen', 'GET', tokenAdmin),
        peticionJson(puerto, '/api/admin/pacientes', 'GET', tokenAdmin),
        peticionJson(puerto, '/api/admin/medicos', 'GET', tokenAdmin)
      ]);

      assert.strictEqual(resResumen.status, 200);
      assert.strictEqual(resPacientes.status, 200);
      assert.strictEqual(resMedicos.status, 200);

      assert.strictEqual(resResumen.data.resumen.totalPacientes, resPacientes.data.total);
      assert.strictEqual(resPacientes.data.total, 4);

      const pacInv = resPacientes.data.pacientes.find(p => p.rutPaciente === '125415636');
      assert.ok(pacInv);
      assert.strictEqual(pacInv.esInvitado, true);
      assert.strictEqual(pacInv.tieneCuenta, false);

      const pacReg = resPacientes.data.pacientes.find(p => p.rutPaciente === '182349011');
      assert.ok(pacReg);
      assert.strictEqual(pacReg.tieneCuenta, true);
      assert.strictEqual(pacReg.esInvitado, false);

      const citaInv = resMedicos.data.citas.find(c => c.rutPaciente === '125415636');
      assert.ok(citaInv);
      assert.strictEqual(citaInv.esInvitado, true);
    } finally {
      db.obtenerPool = origPool;
      db.query = origQuery;
    }
  });
});
