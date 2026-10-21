const assert = require('node:assert');
const { describe, test } = require('node:test');
const {
  calcularSaldoPendiente,
  registrarAbono,
  determinarEstadoPago
} = require('../src/finanzas');

describe('Modulo de control financiero', () => {

  test('Calculo de saldo pendiente de tratamiento', () => {
    const saldo = calcularSaldoPendiente(150000, 50000);
    assert.strictEqual(saldo, 100000);
  });

  test('Registro de abono descuenta el saldo correctamente', () => {
    const nuevoSaldo = registrarAbono(100000, 40000);
    assert.strictEqual(nuevoSaldo, 60000);
  });

  test('Estado de pago segun saldo pendiente', () => {
    assert.strictEqual(determinarEstadoPago(0), 'PAGADO');
    assert.strictEqual(determinarEstadoPago(50000), 'PENDIENTE');
  });

});
