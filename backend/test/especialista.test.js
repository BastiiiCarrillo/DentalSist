const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  crearCita,
  actualizarEstadoCita,
  obtenerFichaClinica,
  registrarAtencionEnFicha,
  reiniciarEstadoParaPruebas
} = require('../src/models/dataStore');
const { firmarReceta, verificarFirmaReceta } = require('../src/services/recetaCrypto');
const {
  actualizarFichaConReautenticacion,
  autorizarAccesoHistorial,
  emitirReceta,
  verificarRecetaPublica
} = require('../src/controllers/especialista');

describe('Modulo de Especialista, Fichas Clinicas y Recetas', () => {

  beforeEach(() => {
    reiniciarEstadoParaPruebas();
  });

  test('Transicion y actualizacion de estados de cita', () => {
    const cita = crearCita({
      rutPaciente: '18.234.901-1',
      nombrePaciente: 'Camilo Vega',
      emailPaciente: 'camilo@correo.cl',
      telefonoPaciente: '+56987654321',
      idMedico: 'DOC-1',
      fecha: '2026-11-24',
      hora: '11:00',
      especialidad: 'Cirugía Bucal',
      esInvitado: false
    });

    const enAtencion = actualizarEstadoCita(cita.id, 'EN_ATENCION');
    assert.strictEqual(enAtencion.estado, 'EN_ATENCION');

    const atendida = actualizarEstadoCita(cita.id, 'ATENDIDA');
    assert.strictEqual(atendida.estado, 'ATENDIDA');

    assert.throws(() => {
      actualizarEstadoCita(cita.id, 'ESTADO_INEXISTENTE');
    }, /invalido/);
  });

  test('Registro de atencion en ficha clinica del paciente', () => {
    const registro = registrarAtencionEnFicha('18.234.901-1', {
      tipoAtencion: 'EXTRACCION',
      medicoId: 'DOC-1',
      nombreMedico: 'Dr. Álvaro Soto M.',
      diagnostico: 'Tercer molar retenido con pericoronaritis aguda',
      tratamiento: 'Exodoncia quirurgica con sutura reabsorbible',
      observaciones: 'Reposo relativo por 48 horas y hielo local'
    });

    assert.ok(registro.id);
    assert.strictEqual(registro.tipoAtencion, 'EXTRACCION');

    const ficha = obtenerFichaClinica('18.234.901-1');
    assert.strictEqual(ficha.historialConsultas.length, 2);
    assert.strictEqual(ficha.historialConsultas[0].tipoAtencion, 'EXTRACCION');
  });

  test('Re-autenticacion obligatoria para modificar ficha clinica', () => {
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

    const reqSinPass = {
      params: { rut: '18.234.901-1' },
      body: {
        idMedico: 'DOC-1',
        tipoAtencion: 'LIMPIEZA',
        diagnostico: 'Gingivitis leve',
        tratamiento: 'Destartraje'
      }
    };

    actualizarFichaConReautenticacion(reqSinPass, resMock);
    assert.strictEqual(statusCapturado, 401);
    assert.ok(jsonCapturado.error.includes('Re-autenticacion obligatoria'));

    const reqPassMala = {
      params: { rut: '18.234.901-1' },
      body: {
        idMedico: 'DOC-1',
        passwordConfirmacion: 'ClaveIncorrecta999',
        tipoAtencion: 'LIMPIEZA',
        diagnostico: 'Gingivitis leve',
        tratamiento: 'Destartraje'
      }
    };

    actualizarFichaConReautenticacion(reqPassMala, resMock);
    assert.strictEqual(statusCapturado, 403);
    assert.ok(jsonCapturado.error.includes('fallida'));

    const reqPassBuena = {
      params: { rut: '18.234.901-1' },
      body: {
        idMedico: 'DOC-1',
        passwordConfirmacion: 'SotoCirugia2026!Clinica',
        tipoAtencion: 'LIMPIEZA',
        diagnostico: 'Gingivitis marginal tratada',
        tratamiento: 'Destartraje y aplicacion de fluor',
        observaciones: 'Control en 6 meses'
      }
    };

    actualizarFichaConReautenticacion(reqPassBuena, resMock);
    assert.strictEqual(statusCapturado, 200);
    assert.ok(jsonCapturado.registro.id);
  });

  test('Firma electronica obligatoria de especialista para consultar historial clinico', async () => {
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

    const reqSinClave = {
      body: {
        rutPaciente: '18.234.901-1',
        idMedico: 'DOC-1'
      }
    };

    await autorizarAccesoHistorial(reqSinClave, resMock);
    assert.strictEqual(statusCapturado, 401);
    assert.ok(jsonCapturado.error.includes('Firma electronica obligatoria'));

    const reqClaveErronea = {
      body: {
        rutPaciente: '18.234.901-1',
        idMedico: 'DOC-1',
        passwordConfirmacion: 'ClaveIncorrecta999'
      }
    };

    await autorizarAccesoHistorial(reqClaveErronea, resMock);
    assert.strictEqual(statusCapturado, 403);
    assert.ok(jsonCapturado.error.includes('rechazada'));

    const reqClaveCorrecta = {
      usuario: { id: 'DOC-1', rol: 'Odontologo' },
      body: {
        rutPaciente: '18.234.901-1',
        passwordConfirmacion: 'SotoCirugia2026!Clinica'
      }
    };

    await autorizarAccesoHistorial(reqClaveCorrecta, resMock);
    assert.strictEqual(statusCapturado, 200);
    assert.strictEqual(jsonCapturado.ok, true);
    assert.ok(jsonCapturado.firma);
    assert.strictEqual(jsonCapturado.firma.especialista, 'Dr. Álvaro Soto M.');
    assert.ok(jsonCapturado.ficha);
  });

  test('Emision y firma criptografica HMAC-SHA256 de receta medica', () => {
    const datosReceta = {
      id: 'REC-2026-9901',
      rutPaciente: '18.234.901-1',
      idMedico: 'DOC-1',
      medicamentos: [
        { nombre: 'Amoxicilina', dosis: '875mg', frecuencia: 'Cada 12 horas por 7 dias' },
        { nombre: 'Ketorolaco', dosis: '10mg', frecuencia: 'Cada 8 horas por 3 dias' }
      ],
      fechaEmision: '2026-11-24T10:30:00.000Z',
      indicaciones: 'Ingerir medicamentos con abundante agua tras las comidas.'
    };

    const recetaFirmada = firmarReceta(datosReceta);
    assert.ok(recetaFirmada.firmaCriptografica);
    assert.strictEqual(recetaFirmada.algoritmo, 'HMAC-SHA256');

    const esValida = verificarFirmaReceta(recetaFirmada);
    assert.strictEqual(esValida, true);
  });

  test('Deteccion de adulteracion y rechazo de receta falsa', () => {
    const datosReceta = {
      id: 'REC-2026-9902',
      rutPaciente: '18.234.901-1',
      idMedico: 'DOC-1',
      medicamentos: [
        { nombre: 'Ibuprofeno', dosis: '600mg', frecuencia: 'Cada 8 horas' }
      ],
      fechaEmision: '2026-11-24T12:00:00.000Z',
      indicaciones: 'Indicaciones estandar'
    };

    const recetaFirmada = firmarReceta(datosReceta);

    const recetaAdulterada = {
      ...recetaFirmada,
      medicamentos: [
        { nombre: 'Morfina', dosis: '50mg', frecuencia: 'Uso no autorizado' }
      ]
    };

    const esValida = verificarFirmaReceta(recetaAdulterada);
    assert.strictEqual(esValida, false);
  });

  test('Flujo de emision y verificacion de receta a traves de controladores', () => {
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

    const reqEmitir = {
      body: {
        rutPaciente: '18.234.901-1',
        idMedico: 'DOC-1',
        passwordConfirmacion: 'SotoCirugia2026!Clinica',
        medicamentos: [{ nombre: 'Paracetamol', dosis: '500mg', frecuencia: 'Cada 8 horas' }],
        indicaciones: 'Tomar tras comer'
      }
    };

    emitirReceta(reqEmitir, resMock);
    assert.strictEqual(statusCapturado, 201);
    assert.ok(jsonCapturado.receta.firmaCriptografica);

    const recetaEmitida = jsonCapturado.receta;

    const reqVerificarValida = {
      body: { receta: recetaEmitida }
    };

    verificarRecetaPublica(reqVerificarValida, resMock);
    assert.strictEqual(statusCapturado, 200);
    assert.strictEqual(jsonCapturado.valida, true);

    const reqVerificarFalsa = {
      body: {
        receta: {
          ...recetaEmitida,
          medicamentos: [{ nombre: 'Medicamento no autorizado', dosis: '100mg', frecuencia: 'Sin orden' }]
        }
      }
    };

    verificarRecetaPublica(reqVerificarFalsa, resMock);
    assert.strictEqual(statusCapturado, 400);
    assert.strictEqual(jsonCapturado.valida, false);
  });

});
