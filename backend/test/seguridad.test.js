'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  rechazarPayloadsXml,
  sanitizarCadena,
  registrarFalloLogin,
  verificarBloqueoEscalonado,
  limpiarFallosLogin
} = require('../src/middleware/seguridad');
const {
  registrarEvento,
  obtenerLogs,
  limpiarLogsParaPruebas
} = require('../src/services/logger');

describe('Modulo de Seguridad Defensiva y OWASP', () => {

  beforeEach(() => {
    limpiarLogsParaPruebas();
    limpiarFallosLogin('127.0.0.1', 'test@correo.cl');
  });

  test('Rechazo de payloads XML con HTTP 415 para proteccion contra XXE', () => {
    let statusCapturado = null;
    let jsonCapturado = null;
    let siguienteLlamado = false;

    const reqXml = {
      headers: { 'content-type': 'application/xml' },
      ip: '127.0.0.1'
    };

    const res = {
      status: (codigo) => {
        statusCapturado = codigo;
        return {
          json: (datos) => {
            jsonCapturado = datos;
          }
        };
      }
    };

    const next = () => { siguienteLlamado = true; };

    rechazarPayloadsXml(reqXml, res, next);

    assert.strictEqual(statusCapturado, 415);
    assert.strictEqual(siguienteLlamado, false);
    assert.ok(jsonCapturado.error.includes('application/json'));
  });

  test('Permite paso normal para Content-Type application/json', () => {
    let siguienteLlamado = false;
    const reqJson = {
      headers: { 'content-type': 'application/json' },
      ip: '127.0.0.1'
    };
    const res = {};
    const next = () => { siguienteLlamado = true; };

    rechazarPayloadsXml(reqJson, res, next);
    assert.strictEqual(siguienteLlamado, true);
  });

  test('Sanitizacion de cadenas contra ataques Cross-Site Scripting (XSS)', () => {
    const inputPeligroso = '<script>alert("xss")</script>';
    const resultado = sanitizarCadena(inputPeligroso);

    assert.strictEqual(resultado.includes('<script>'), false);
    assert.strictEqual(resultado.includes('&lt;script&gt;'), true);
  });

  test('Bloqueo escalonado de fuerza bruta progresivo tras intentos fallidos', () => {
    const ip = '127.0.0.1';
    const identificador = 'test@correo.cl';

    registrarFalloLogin(ip, identificador);
    registrarFalloLogin(ip, identificador);
    registrarFalloLogin(ip, identificador);

    let statusCapturado = null;
    let jsonCapturado = null;
    let siguienteLlamado = false;

    const req = {
      ip,
      body: { email: identificador }
    };
    const res = {
      setHeader: () => {},
      status: (codigo) => {
        statusCapturado = codigo;
        return {
          json: (datos) => {
            jsonCapturado = datos;
          }
        };
      }
    };
    const next = () => { siguienteLlamado = true; };

    verificarBloqueoEscalonado(req, res, next);

    assert.strictEqual(statusCapturado, 429);
    assert.strictEqual(siguienteLlamado, false);
    assert.ok(jsonCapturado.error.includes('Demasiados intentos fallidos'));
  });

  test('Inmutabilidad del registro de auditoria', () => {
    const evento = registrarEvento('PRUEBA_INTEGRIDAD', 'Detalle de prueba', '127.0.0.1', null, 'INFO');

    assert.strictEqual(Object.isFrozen(evento), true);
    assert.throws(() => {
      evento.detalle = 'Alteracion fraudulenta';
    }, TypeError);

    const listaLogs = obtenerLogs();
    assert.strictEqual(listaLogs.length, 1);
    assert.strictEqual(listaLogs[0].tipo, 'PRUEBA_INTEGRIDAD');
  });

});
