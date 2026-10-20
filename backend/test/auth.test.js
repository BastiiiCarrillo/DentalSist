const assert = require('node:assert');
const test = require('node:test');
const {
  ROLES,
  validarRol,
  puedeVerFichaClinica,
  puedeModificarOdontograma,
  puedeVerFinanzas,
  puedeGestionarAgenda,
  puedeVerAuditoria
} = require('../src/auth');

test('Validar existencia de roles de DentalSis', () => {
  assert.strictEqual(validarRol(ROLES.ODONTOLOGO), true);
  assert.strictEqual(validarRol(ROLES.RECEPCIONISTA), true);
  assert.strictEqual(validarRol(ROLES.ADMIN_FINANCIERO), true);
  assert.strictEqual(validarRol(ROLES.SUPER_ADMIN), true);
  assert.strictEqual(validarRol('Invitado'), false);
});

test('Segregacion: Acceso a ficha clinica restringido a odontologo y admin', () => {
  assert.strictEqual(puedeVerFichaClinica(ROLES.ODONTOLOGO), true);
  assert.strictEqual(puedeVerFichaClinica(ROLES.SUPER_ADMIN), true);
  assert.strictEqual(puedeVerFichaClinica(ROLES.RECEPCIONISTA), false);
  assert.strictEqual(puedeVerFichaClinica(ROLES.ADMIN_FINANCIERO), false);
});

test('Segregacion: Modificacion de odontograma solo por odontologo', () => {
  assert.strictEqual(puedeModificarOdontograma(ROLES.ODONTOLOGO), true);
  assert.strictEqual(puedeModificarOdontograma(ROLES.RECEPCIONISTA), false);
  assert.strictEqual(puedeModificarOdontograma(ROLES.ADMIN_FINANCIERO), false);
});

test('Segregacion: Acceso a finanzas reservado a administracion y finanzas', () => {
  assert.strictEqual(puedeVerFinanzas(ROLES.ADMIN_FINANCIERO), true);
  assert.strictEqual(puedeVerFinanzas(ROLES.SUPER_ADMIN), true);
  assert.strictEqual(puedeVerFinanzas(ROLES.ODONTOLOGO), false);
  assert.strictEqual(puedeVerFinanzas(ROLES.RECEPCIONISTA), false);
});

test('Segregacion: Recepcion gestiona agenda sin acceso a auditoria', () => {
  assert.strictEqual(puedeGestionarAgenda(ROLES.RECEPCIONISTA), true);
  assert.strictEqual(puedeVerAuditoria(ROLES.RECEPCIONISTA), false);
  assert.strictEqual(puedeVerAuditoria(ROLES.SUPER_ADMIN), true);
});
