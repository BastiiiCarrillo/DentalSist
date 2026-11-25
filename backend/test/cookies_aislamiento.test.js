const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const app = require('../src/server');
const db = require('../src/models/db');
const {
  reiniciarEstadoParaPruebas,
  establecerPasswordTemporalUsuario
} = require('../src/models/dataStore');
const { limpiarLogsParaPruebas, obtenerLogs } = require('../src/services/logger');
const { COOKIE_SESION, COOKIE_TEMP_PWD } = require('../src/controllers/auth.controller');

const JWT_SECRET = process.env.JWT_SECRET || 'dentalsis_super_secret_jwt_2026_key';

function peticionHttp(puerto, ruta, metodo = 'GET', headersExtra = {}, bodyObj = null) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = { ...headersExtra };
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
        resolve({ status: res.statusCode, headers: res.headers, data, raw });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extraerCookie(setCookieHeader, nombre) {
  const lista = Array.isArray(setCookieHeader) ? setCookieHeader : (setCookieHeader ? [setCookieHeader] : []);
  return lista.find(c => c.startsWith(`${nombre}=`)) || null;
}

describe('Cookies HttpOnly, Ocultamiento de Tokens y Aislamiento de Portales HTML', () => {
  let server;
  let puerto;
  let origObtenerPool;

  before(async () => {
    origObtenerPool = db.obtenerPool;
    db.obtenerPool = () => null;
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        puerto = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    db.obtenerPool = origObtenerPool;
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  beforeEach(() => {
    reiniciarEstadoParaPruebas();
    limpiarLogsParaPruebas();
  });

  test('Login navegador con X-Auth-Cookie emite cookie HttpOnly y oculta JWT del cuerpo JSON', async () => {
    const resLogin = await peticionHttp(puerto, '/api/auth/login', 'POST', {
      'X-Auth-Cookie': '1'
    }, {
      identificador: 'alvaro.soto@dentalsis.cl',
      password: 'SotoCirugia2026!Clinica',
      rol: 'especialista'
    });

    assert.strictEqual(resLogin.status, 200);
    assert.strictEqual(resLogin.data.token, undefined);
    assert.strictEqual(resLogin.data.redireccion, '/especialista');
    assert.strictEqual(resLogin.data.usuario.rol, 'Odontologo');

    const cookieSesion = extraerCookie(resLogin.headers['set-cookie'], COOKIE_SESION);
    assert.ok(cookieSesion);
    assert.ok(cookieSesion.includes('HttpOnly'));
    assert.ok(/SameSite=Lax/i.test(cookieSesion));

    const parCookie = cookieSesion.split(';')[0];

    const resSesion = await peticionHttp(puerto, '/api/auth/sesion', 'GET', {
      'Cookie': parCookie
    });
    assert.strictEqual(resSesion.status, 200);
    assert.strictEqual(resSesion.data.autenticado, true);
    assert.strictEqual(resSesion.data.usuario.nombre, 'Dr. Álvaro Soto M.');
    assert.strictEqual(resSesion.data.usuario.email, undefined);
    assert.strictEqual(resSesion.data.usuario.rut, undefined);
    assert.strictEqual(resSesion.data.usuario.passwordHash, undefined);
    assert.strictEqual(resSesion.data.token, undefined);

    const resLogout = await peticionHttp(puerto, '/api/auth/logout', 'POST', {
      'Cookie': parCookie
    });
    assert.strictEqual(resLogout.status, 200);
    const cookieClear = extraerCookie(resLogout.headers['set-cookie'], COOKIE_SESION);
    assert.ok(cookieClear);
    assert.ok(cookieClear.includes(`${COOKIE_SESION}=;`));

    const resSinSesion = await peticionHttp(puerto, '/api/auth/sesion', 'GET');
    assert.strictEqual(resSinSesion.status, 200);
    assert.strictEqual(resSinSesion.data.autenticado, false);
    assert.strictEqual(resSinSesion.data.usuario, null);
  });

  test('Cambio de clave temporal web usa cookie HttpOnly temporal sin exponer tempToken ni token final', async () => {
    establecerPasswordTemporalUsuario('paciente', 'USR-PAC-1', 'TempClave2026!');

    const resTemp = await peticionHttp(puerto, '/api/auth/login', 'POST', {
      'X-Auth-Cookie': '1'
    }, {
      identificador: 'camilo.vega@correo.cl',
      password: 'TempClave2026!',
      rol: 'paciente'
    });

    assert.strictEqual(resTemp.status, 200);
    assert.strictEqual(resTemp.data.requiereCambioPassword, true);
    assert.strictEqual(resTemp.data.tempToken, undefined);
    assert.strictEqual(resTemp.data.token, undefined);

    const cookieTemp = extraerCookie(resTemp.headers['set-cookie'], COOKIE_TEMP_PWD);
    assert.ok(cookieTemp);
    assert.ok(cookieTemp.includes('HttpOnly'));

    const parTemp = cookieTemp.split(';')[0];
    const resCompletar = await peticionHttp(puerto, '/api/auth/completar-password-temporal', 'POST', {
      'Cookie': parTemp,
      'X-Auth-Cookie': '1'
    }, {
      passwordNueva: 'NuevaClaveSegura2026!',
      confirmarPassword: 'NuevaClaveSegura2026!'
    });

    assert.strictEqual(resCompletar.status, 200);
    assert.strictEqual(resCompletar.data.token, undefined);
    assert.strictEqual(resCompletar.data.redireccion, '/paciente');

    const cookieDef = extraerCookie(resCompletar.headers['set-cookie'], COOKIE_SESION);
    assert.ok(cookieDef);
    assert.ok(cookieDef.includes('HttpOnly'));
  });

  test('Aislamiento estricto de rutas HTML por rol y bloqueo de bypass por .html', async () => {
    const resAnonAdmin = await peticionHttp(puerto, '/admin');
    assert.strictEqual(resAnonAdmin.status, 302);
    assert.strictEqual(resAnonAdmin.headers.location, '/login');

    const resAnonEsp = await peticionHttp(puerto, '/especialista');
    assert.strictEqual(resAnonEsp.status, 302);
    assert.strictEqual(resAnonEsp.headers.location, '/login');

    const resAdminHtml = await peticionHttp(puerto, '/admin.html');
    assert.strictEqual(resAdminHtml.status, 301);
    assert.strictEqual(resAdminHtml.headers.location, '/admin');
    assert.ok(!resAdminHtml.raw.includes('Panel Administrador DentalSis'));

    const resAnonPac = await peticionHttp(puerto, '/paciente');
    assert.strictEqual(resAnonPac.status, 200);
    assert.ok(!resAnonPac.raw.includes('sessionStorage.setItem'));

    const tokPaciente = jwt.sign(
      { id: 'USR-PAC-1', nombre: 'Paciente Test', email: 'camilo.vega@correo.cl', rut: '18.234.901-1', rol: 'Paciente' },
      JWT_SECRET
    );
    const cookiePac = `${COOKIE_SESION}=${tokPaciente}`;

    const resPacAdmin = await peticionHttp(puerto, '/admin', 'GET', { 'Cookie': cookiePac });
    assert.strictEqual(resPacAdmin.status, 302);
    assert.strictEqual(resPacAdmin.headers.location, '/paciente');

    const resPacEsp = await peticionHttp(puerto, '/especialista', 'GET', { 'Cookie': cookiePac });
    assert.strictEqual(resPacEsp.status, 302);
    assert.strictEqual(resPacEsp.headers.location, '/paciente');

    const logsTrasBypass = obtenerLogs();
    assert.ok(logsTrasBypass.some(l => l.tipo === 'ACCESO_PANEL_ADMIN_DENEGADO' && l.nivel === 'PELIGRO'));
    assert.ok(logsTrasBypass.some(l => l.tipo === 'ACCESO_PANEL_ESPECIALISTA_DENEGADO' && l.nivel === 'PELIGRO'));

    const tokEsp = jwt.sign(
      { id: 'DOC-1', nombre: 'Dr. Alvaro Soto', email: 'alvaro.soto@dentalsis.cl', rut: '14.892.341-2', rol: 'Odontologo' },
      JWT_SECRET
    );
    const cookieEsp = `${COOKIE_SESION}=${tokEsp}`;

    assert.strictEqual((await peticionHttp(puerto, '/admin', 'GET', { 'Cookie': cookieEsp })).headers.location, '/especialista');
    assert.strictEqual((await peticionHttp(puerto, '/paciente', 'GET', { 'Cookie': cookieEsp })).headers.location, '/especialista');
    assert.strictEqual((await peticionHttp(puerto, '/especialista', 'GET', { 'Cookie': cookieEsp })).status, 200);

    const tokAdmin = jwt.sign(
      { id: 'USR-ADMIN-1', nombre: 'Ing. Admin', email: 'admin@dentalsis.cl', rut: '15.432.890-K', rol: 'SuperAdmin' },
      JWT_SECRET
    );
    const cookieAdmin = `${COOKIE_SESION}=${tokAdmin}`;

    assert.strictEqual((await peticionHttp(puerto, '/especialista', 'GET', { 'Cookie': cookieAdmin })).headers.location, '/admin');
    assert.strictEqual((await peticionHttp(puerto, '/paciente', 'GET', { 'Cookie': cookieAdmin })).headers.location, '/admin');
    assert.strictEqual((await peticionHttp(puerto, '/admin', 'GET', { 'Cookie': cookieAdmin })).status, 200);
  });

  test('Disponibilidad publica oculta RUT/email de medicos y ficha clinica exige firma previa', async () => {
    const resDisp = await peticionHttp(puerto, '/api/pacientes/disponibilidad?fecha=2026-12-01&hora=10:00&especialidad=Cirug%C3%ADa%20Bucal');
    assert.strictEqual(resDisp.status, 200);
    assert.ok(Array.isArray(resDisp.data.disponibles));
    assert.ok(resDisp.data.disponibles.length > 0);
    resDisp.data.disponibles.forEach(m => {
      assert.strictEqual(m.rut, undefined);
      assert.strictEqual(m.email, undefined);
      assert.strictEqual(m.passwordHash, undefined);
      assert.strictEqual(m.rol, undefined);
    });

    const tokEsp = jwt.sign(
      { id: 'DOC-1', nombre: 'Dr. Alvaro Soto', email: 'alvaro.soto@dentalsis.cl', rut: '14.892.341-2', rol: 'Odontologo' },
      JWT_SECRET
    );
    const cookieEsp = `${COOKIE_SESION}=${tokEsp}`;

    const resSinFirma = await peticionHttp(puerto, '/api/especialistas/ficha/18.234.901-1', 'GET', {
      'Cookie': cookieEsp
    });
    assert.strictEqual(resSinFirma.status, 403);

    const resFirmar = await peticionHttp(puerto, '/api/especialistas/acceso-historial', 'POST', {
      'Cookie': cookieEsp
    }, {
      rutPaciente: '18.234.901-1',
      passwordConfirmacion: 'SotoCirugia2026!Clinica'
    });
    assert.strictEqual(resFirmar.status, 200);

    const resConFirma = await peticionHttp(puerto, '/api/especialistas/ficha/18.234.901-1', 'GET', {
      'Cookie': cookieEsp
    });
    assert.strictEqual(resConFirma.status, 200);
    assert.ok(resConFirma.data.ficha);

    const resConFirmaPost = await peticionHttp(puerto, '/api/especialistas/ficha-consulta', 'POST', {
      'Cookie': cookieEsp
    }, { rut: '18.234.901-1' });
    assert.strictEqual(resConFirmaPost.status, 200);
    assert.ok(resConFirmaPost.data.ficha);
  });

  test('Cabeceras CSP, Permissions-Policy, CORS estricto y ausencia de doble guion en RUTs de usuarios', async () => {
    const resSalud = await peticionHttp(puerto, '/api/salud');
    assert.strictEqual(resSalud.status, 200);
    assert.strictEqual(resSalud.headers['access-control-allow-origin'], undefined);
    assert.ok(resSalud.headers['content-security-policy']);
    assert.ok(resSalud.headers['content-security-policy'].includes("frame-ancestors 'none'"));
    assert.strictEqual(resSalud.headers['x-frame-options'], 'DENY');
    assert.ok(resSalud.headers['permissions-policy']);

    const resCorsMalo = await peticionHttp(puerto, '/api/salud', 'GET', {
      'Origin': 'https://atacante.externo.example'
    });
    assert.strictEqual(resCorsMalo.headers['access-control-allow-origin'], undefined);

    const resPreflightMalo = await peticionHttp(puerto, '/api/admin/resumen', 'OPTIONS', {
      'Origin': 'https://atacante.externo.example'
    });
    assert.strictEqual(resPreflightMalo.status, 403);

    const tokPaciente = jwt.sign(
      { id: 'USR-PAC-1', nombre: 'Paciente Test', email: 'camilo.vega@correo.cl', rut: '18.234.901-1', rol: 'Paciente' },
      JWT_SECRET
    );
    const resMisCitas = await peticionHttp(puerto, '/api/pacientes/mis-citas', 'GET', {
      'Cookie': `${COOKIE_SESION}=${tokPaciente}`
    });
    assert.strictEqual(resMisCitas.status, 200);
    assert.ok(Array.isArray(resMisCitas.data.citas));

    const tokAdmin = jwt.sign(
      { id: 'USR-ADMIN-1', nombre: 'Ing. Admin', email: 'admin@dentalsis.cl', rut: '15.432.890-K', rol: 'SuperAdmin' },
      JWT_SECRET
    );
    const resUsuarios = await peticionHttp(puerto, '/api/admin/usuarios', 'GET', {
      'Cookie': `${COOKIE_SESION}=${tokAdmin}`
    });
    assert.strictEqual(resUsuarios.status, 200);
    resUsuarios.data.usuarios.forEach(u => {
      assert.ok(!String(u.rutFormateado || '').includes('--'));
    });

    const resSesionAdm = await peticionHttp(puerto, '/api/auth/sesion', 'GET', {
      'Cookie': `${COOKIE_SESION}=${tokAdmin}`
    });
    assert.strictEqual(resSesionAdm.status, 200);
    assert.strictEqual(resSesionAdm.data.usuario.email, undefined);
    assert.strictEqual(resSesionAdm.data.usuario.rut, undefined);
  });
});
