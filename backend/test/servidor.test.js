const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const app = require('../src/server');

describe('Pruebas de Integracion del Servidor Express', () => {
  let server;
  let puerto;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        puerto = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('Endpoint de salud responde 200 OPERATIVO', async () => {
    const respuesta = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${puerto}/api/salud`, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(raw) }));
      }).on('error', reject);
    });

    assert.strictEqual(respuesta.status, 200);
    assert.strictEqual(respuesta.data.estado, 'OPERATIVO');
  });

  test('Endpoint de auditoria retorna lista de eventos inmutables', async () => {
    const respuesta = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${puerto}/api/auditoria`, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(raw) }));
      }).on('error', reject);
    });

    assert.strictEqual(respuesta.status, 200);
    assert.ok(Array.isArray(respuesta.data.logs));
  });

  test('Rechazo directo de peticiones con payload XML', async () => {
    const opciones = {
      hostname: '127.0.0.1',
      port: puerto,
      path: '/api/pacientes/reservar',
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml'
      }
    };

    const statusCode = await new Promise((resolve, reject) => {
      const req = http.request(opciones, (res) => {
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.write('<reserva><rut>18234901-1</rut></reserva>');
      req.end();
    });

    assert.strictEqual(statusCode, 415);
  });
});
