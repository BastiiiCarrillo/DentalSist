const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  validarRutChileno,
  crearCita,
  obtenerCitasPorPaciente,
  reiniciarEstadoParaPruebas
} = require('../src/models/dataStore');
const { validarDatosReserva } = require('../src/controllers/paciente');

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
    const cuerpoValido = {
      rut: '18.234.901-1',
      nombre: 'Camilo Vega',
      email: 'camilo@correo.cl',
      telefono: '+56912345678',
      idMedico: 'DOC-1',
      fecha: '2026-11-24',
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

});
