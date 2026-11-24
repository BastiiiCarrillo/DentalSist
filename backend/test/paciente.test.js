const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  validarRutChileno,
  crearCita,
  crearUsuario,
  obtenerCitasPorPaciente,
  reiniciarEstadoParaPruebas
} = require('../src/models/dataStore');
const { validarDatosReserva, cancelarCitaPaciente } = require('../src/controllers/paciente');

describe('Modulo de Pacientes y Agendamiento', () => {

  beforeEach(() => {
    reiniciarEstadoParaPruebas();
  });

  test('Validacion de algoritmo Modulo 11 de RUT chileno', () => {
    assert.strictEqual(validarRutChileno('18.234.901-1'), true);
    assert.strictEqual(validarRutChileno('182349011'), true);
    assert.strictEqual(validarRutChileno('11.111.111-1'), true);
    assert.strictEqual(validarRutChileno('18.234.901-9'), false);
    assert.strictEqual(validarRutChileno(''), false);
    assert.strictEqual(validarRutChileno('invalido'), false);
  });

  test('Validacion de payload de reserva de cita', () => {
    const dFutura = new Date(Date.now() + 86400000 * 2);
    const fechaFuturaStr = dFutura.getFullYear() + '-' + String(dFutura.getMonth() + 1).padStart(2, '0') + '-' + String(dFutura.getDate()).padStart(2, '0');
    const cuerpoValido = {
      rut: '18.234.901-1',
      nombre: 'Camilo Vega',
      email: 'camilo@correo.cl',
      telefono: '+56912345678',
      idMedico: 'DOC-1',
      fecha: fechaFuturaStr,
      hora: '10:00'
    };
    assert.strictEqual(validarDatosReserva(cuerpoValido), null);

    const cuerpoRutMalo = { ...cuerpoValido, rut: '18.234.901-9' };
    assert.ok(validarDatosReserva(cuerpoRutMalo).includes('Modulo 11'));

    const cuerpoEmailMalo = { ...cuerpoValido, email: 'correo-sin-arroba' };
    assert.ok(validarDatosReserva(cuerpoEmailMalo).includes('correo'));

    const dHoy = new Date();
    const fechaHoyStr = dHoy.getFullYear() + '-' + String(dHoy.getMonth() + 1).padStart(2, '0') + '-' + String(dHoy.getDate()).padStart(2, '0');
    const cuerpoHoraPasada = { ...cuerpoValido, fecha: fechaHoyStr, hora: '08:00' };
    if (dHoy.getHours() >= 8) {
      assert.ok(validarDatosReserva(cuerpoHoraPasada).includes('horarios pasados'));
    }

    const cuerpoFechaPasada = { ...cuerpoValido, fecha: '2020-01-01', hora: '10:00' };
    assert.ok(validarDatosReserva(cuerpoFechaPasada).includes('fechas pasadas'));
  });

  test('Agendamiento exitoso de cita para paciente invitado', () => {
    const cita = crearCita({
      rutPaciente: '18.234.901-1',
      nombrePaciente: 'Camilo Vega',
      emailPaciente: 'camilo@correo.cl',
      telefonoPaciente: '+56987654321',
      idMedico: 'DOC-1',
      fecha: '2026-11-24',
      hora: '10:00',
      especialidad: 'Cirugía Bucal',
      esInvitado: true
    });

    assert.ok(cita.id);
    assert.strictEqual(cita.rutPaciente, '182349011');
    assert.strictEqual(cita.sillon, 'Box 1');
    assert.strictEqual(cita.estado, 'PENDIENTE');
    assert.strictEqual(cita.esInvitado, true);

    const citasRegistradas = obtenerCitasPorPaciente('18.234.901-1');
    assert.strictEqual(citasRegistradas.length, 1);
  });

  test('Prevencion estricta de colision y doble reserva', () => {
    crearCita({
      rutPaciente: '18.234.901-1',
      nombrePaciente: 'Camilo Vega',
      emailPaciente: 'camilo@correo.cl',
      telefonoPaciente: '+56987654321',
      idMedico: 'DOC-1',
      fecha: '2026-11-24',
      hora: '10:00',
      especialidad: 'Cirugía Bucal',
      esInvitado: true
    });

    assert.throws(() => {
      crearCita({
        rutPaciente: '19.876.543-0',
        nombrePaciente: 'Otro Paciente',
        emailPaciente: 'otro@correo.cl',
        telefonoPaciente: '+56911223344',
        idMedico: 'DOC-1',
        fecha: '2026-11-24',
        hora: '10:00',
        especialidad: 'Cirugía Bucal',
        esInvitado: true
      });
    }, /ya no estan disponibles/);
  });

  test('Prevencion de colision simultanea para el mismo paciente en distintas especialidades', () => {
    crearCita({
      rutPaciente: '18.234.901-1',
      nombrePaciente: 'Camilo Vega',
      emailPaciente: 'camilo@correo.cl',
      telefonoPaciente: '+56987654321',
      idMedico: 'DOC-1',
      fecha: '2026-11-25',
      hora: '15:00',
      especialidad: 'Cirugía Bucal',
      esInvitado: true
    });

    assert.throws(() => {
      crearCita({
        rutPaciente: '18.234.901-1',
        nombrePaciente: 'Camilo Vega',
        emailPaciente: 'camilo@correo.cl',
        telefonoPaciente: '+56987654321',
        idMedico: 'DOC-2',
        fecha: '2026-11-25',
        hora: '15:00',
        especialidad: 'Odontología General',
        esInvitado: true
      });
    }, /Ya cuentas con una cita médica agendada en este mismo horario/);
  });

  test('Cancelacion de cita por paciente exige motivo y re-autenticacion con contrasena', async () => {
    crearUsuario({
      rut: '19.876.543-0',
      nombre: 'Francisca Morales',
      email: 'francisca.cancel@correo.cl',
      telefono: '+56911223344',
      password: 'PacienteCancel2026!'
    });

    const cita = crearCita({
      rutPaciente: '19.876.543-0',
      nombrePaciente: 'Francisca Morales',
      emailPaciente: 'francisca.cancel@correo.cl',
      telefonoPaciente: '+56911223344',
      idMedico: 'DOC-1',
      fecha: '2026-11-28',
      hora: '10:00',
      especialidad: 'Cirugía Bucal',
      esInvitado: false
    });

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

    const usuarioToken = { id: 'USR-TEST', rut: '19876543-0', email: 'francisca.cancel@correo.cl', rol: 'Paciente' };

    await cancelarCitaPaciente({
      params: { idCita: cita.id },
      usuario: usuarioToken,
      body: { motivo: 'abc', password: 'PacienteCancel2026!' }
    }, resMock);
    assert.strictEqual(statusCapturado, 400);
    assert.ok(jsonCapturado.error.includes('motivo'));

    await cancelarCitaPaciente({
      params: { idCita: cita.id },
      usuario: usuarioToken,
      body: { motivo: 'No puedo asistir por trabajo', password: 'ClaveIncorrecta999' }
    }, resMock);
    assert.strictEqual(statusCapturado, 403);

    await cancelarCitaPaciente({
      params: { idCita: cita.id },
      usuario: usuarioToken,
      body: { motivo: 'No puedo asistir por trabajo', password: 'PacienteCancel2026!' }
    }, resMock);
    assert.strictEqual(statusCapturado, 200);
    assert.strictEqual(jsonCapturado.cita.estado, 'CANCELADA');
    assert.strictEqual(jsonCapturado.cita.motivoCancelacion, 'No puedo asistir por trabajo');
  });

});
