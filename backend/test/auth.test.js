const assert = require('node:assert');
const { describe, test } = require('node:test');
const {
  ROLES,
  validarRol,
  puedeVerFichaClinica,
  puedeModificarOdontograma,
  puedeVerFinanzas,
  puedeGestionarAgenda,
  puedeVerAuditoria
} = require('../src/auth');
const { login, registro, verificarToken } = require('../src/controllers/auth.controller');

describe('Modulo de autenticacion y roles', () => {

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

});

test('Flujo de autenticacion exitosa y generacion de token JWT', () => {
  let statusCapturado = null;
  let jsonCapturado = null;

  const resMock = {
    status: (code) => {
      statusCapturado = code;
      return {
        json: (data) => {
          jsonCapturado = data;
        }
      };
    }
  };

  const reqEspecialista = {
    body: {
      identificador: 'alvaro.soto@dentalsis.cl',
      password: 'SotoCirugia2026!Clinica',
      rol: 'especialista'
    }
  };

  login(reqEspecialista, resMock);
  assert.strictEqual(statusCapturado, 200);
  assert.ok(jsonCapturado.token);
  assert.strictEqual(jsonCapturado.usuario.email, 'alvaro.soto@dentalsis.cl');
  assert.strictEqual(jsonCapturado.usuario.passwordHash, undefined);

  let siguienteLlamado = false;
  const reqVerificar = {
    headers: {
      authorization: `Bearer ${jsonCapturado.token}`
    }
  };
  const nextMock = () => { siguienteLlamado = true; };

  verificarToken(reqVerificar, resMock, nextMock);
  assert.strictEqual(siguienteLlamado, true);
  assert.strictEqual(reqVerificar.usuario.id, 'DOC-1');
});

test('Rechazo de login ante credenciales erroneas', () => {
  let statusCapturado = null;
  let jsonCapturado = null;

  const resMock = {
    status: (code) => {
      statusCapturado = code;
      return {
        json: (data) => {
          jsonCapturado = data;
        }
      };
    }
  };

  const reqErroneo = {
    body: {
      identificador: 'alvaro.soto@dentalsis.cl',
      password: 'ClaveTotalmenteEquivocada',
      rol: 'especialista'
    }
  };

  login(reqErroneo, resMock);
  assert.strictEqual(statusCapturado, 401);
  assert.ok(jsonCapturado.error.includes('invalidas'));
});

test('Registro de nuevo usuario con validacion de RUT y hashing de clave', () => {
  let statusCapturado = null;
  let jsonCapturado = null;

  const resMock = {
    status: (code) => {
      statusCapturado = code;
      return {
        json: (data) => {
          jsonCapturado = data;
        }
      };
    }
  };

  const reqRegistroValido = {
    body: {
      rut: '19.876.543-0',
      nombre: 'Francisca Morales',
      email: 'francisca.morales@correo.cl',
      telefono: '+56 9 1122 3344',
      password: 'FranciscaSegura2026!'
    }
  };

  registro(reqRegistroValido, resMock);
  assert.strictEqual(statusCapturado, 201);
  assert.ok(jsonCapturado.token);
  assert.strictEqual(jsonCapturado.usuario.rut, '198765430');
  assert.strictEqual(jsonCapturado.usuario.email, 'francisca.morales@correo.cl');
  assert.strictEqual(jsonCapturado.usuario.passwordHash, undefined);

  let statusFallo = null;
  let jsonFallo = null;
  const resFalloMock = {
    status: (code) => {
      statusFallo = code;
      return {
        json: (data) => {
          jsonFallo = data;
        }
      };
    }
  };

  const reqRutMalo = {
    body: {
      rut: '11.111.111-9',
      nombre: 'Test Invalido',
      email: 'malo@correo.cl',
      password: 'Password123!'
    }
  };

  registro(reqRutMalo, resFalloMock);
  assert.strictEqual(statusFallo, 400);
  assert.ok(jsonFallo.error.includes('invalido'));
});

test('Autenticacion exitosa de Super Admin con clave segura actualizada', () => {
  let statusCapturado = null;
  let jsonCapturado = null;

  const resMock = {
    status: (code) => {
      statusCapturado = code;
      return {
        json: (data) => {
          jsonCapturado = data;
        }
      };
    }
  };

  const reqAdmin = {
    body: {
      identificador: 'admin@dentalsis.cl',
      password: '86244212351532Aa_',
      rol: 'admin'
    }
  };

  login(reqAdmin, resMock);
  assert.strictEqual(statusCapturado, 200);
  assert.ok(jsonCapturado.token);
  assert.strictEqual(jsonCapturado.usuario.email, 'admin@dentalsis.cl');
});
