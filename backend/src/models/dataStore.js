const bcrypt = require('bcrypt');

const medicosSemilla = [
  {
    id: 'DOC-1',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    rut: '14.892.341-2',
    nombre: 'Dr. Álvaro Soto M.',
    especialidad: 'Cirugía Bucal',
    sillon: 'Box 1',
    email: 'alvaro.soto@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('SotoCirugia2026!Clinica', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '14:30', '15:00', '16:00', '17:00', '17:30']
  },
  {
    id: 'DOC-5',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5',
    rut: '15.612.394-1',
    nombre: 'Dr. Ignacio Valenzuela R.',
    especialidad: 'Cirugía Bucal',
    sillon: 'Box 2',
    email: 'ignacio.valenzuela@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('Valenzuela2026!Dental', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00']
  },
  {
    id: 'DOC-2',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    rut: '16.781.423-5',
    nombre: 'Dra. Fernanda Ríos',
    especialidad: 'Odontología General',
    sillon: 'Box 1',
    email: 'fernanda.rios@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('RiosOdonto2026!Clinica', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '14:30', '15:00', '16:00', '17:00', '17:30']
  },
  {
    id: 'DOC-6',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6',
    rut: '17.204.819-3',
    nombre: 'Dr. Camilo Morales P.',
    especialidad: 'Odontología General',
    sillon: 'Box 2',
    email: 'camilo.morales@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('Morales2026!Dental', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00']
  },
  {
    id: 'DOC-7',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb7',
    rut: '18.012.443-8',
    nombre: 'Dra. Valentina Castro T.',
    especialidad: 'Odontología General',
    sillon: 'Box 3',
    email: 'valentina.castro@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('Castro2026!Dental', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00']
  },
  {
    id: 'DOC-4',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4',
    rut: '16.204.912-3',
    nombre: 'Dra. Marcela Lagos',
    especialidad: 'Ortodoncia',
    sillon: 'Box 4',
    email: 'marcela.lagos@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('LagosOdonto2026!Dental', 10),
    horariosBase: ['09:00', '10:00', '11:00', '11:30', '12:00', '15:00', '16:00', '16:30', '17:00']
  },
  {
    id: 'DOC-8',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8',
    rut: '16.483.210-9',
    nombre: 'Dr. Felipe Bravo M.',
    especialidad: 'Ortodoncia',
    sillon: 'Box 1',
    email: 'felipe.bravo@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('Bravo2026!Dental', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00']
  },
  {
    id: 'DOC-3',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',
    rut: '15.932.114-8',
    nombre: 'Dr. Matías Silva',
    especialidad: 'Endodoncia',
    sillon: 'Box 3',
    email: 'matias.silva@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('SilvaEndo2026!Clinica', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '14:30', '15:00', '16:00', '17:00']
  },
  {
    id: 'DOC-9',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9',
    rut: '17.519.203-K',
    nombre: 'Dra. Constanza Herrera S.',
    especialidad: 'Endodoncia',
    sillon: 'Box 2',
    email: 'constanza.herrera@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('Herrera2026!Dental', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00']
  },
  {
    id: 'DOC-10',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10',
    rut: '15.340.892-4',
    nombre: 'Dr. Rodrigo Fuentes L.',
    especialidad: 'Periodoncia',
    sillon: 'Box 3',
    email: 'rodrigo.fuentes@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('Fuentes2026!Dental', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00']
  },
  {
    id: 'DOC-11',
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11',
    rut: '18.391.029-7',
    nombre: 'Dra. Camila Paz Aedo',
    especialidad: 'Odontopediatría',
    sillon: 'Box 4',
    email: 'camila.aedo@dentalsis.cl',
    rol: 'ODONTOLOGO',
    passwordHash: bcrypt.hashSync('Aedo2026!Dental', 10),
    horariosBase: ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00']
  }
];

const usuariosSemilla = [
  {
    id: 'USR-ADMIN-1',
    rut: '15432890-K',
    rutFormateado: '15.432.890-K',
    nombre: 'Ing. Admin DentalSis',
    email: 'admin@dentalsis.cl',
    telefono: '+56 2 2987 6543',
    rol: 'ADMIN',
    passwordHash: bcrypt.hashSync('86244212351532Aa_', 10)
  },
  {
    id: 'USR-RECEP-1',
    rut: '17452809-6',
    rutFormateado: '17.452.809-6',
    nombre: 'Valeria Muñoz (Recepción)',
    email: 'recepcion@dentalsis.cl',
    telefono: '+56 9 7654 3210',
    rol: 'RECEPCIONISTA',
    passwordHash: bcrypt.hashSync('RecepDental2026!Turno', 10)
  },
  {
    id: 'USR-PAC-1',
    rut: '18234901-1',
    rutFormateado: '18.234.901-1',
    nombre: 'Camilo Vega Ortiz',
    email: 'camilo.vega@correo.cl',
    telefono: '+56 9 8765 4321',
    rol: 'PACIENTE',
    passwordHash: bcrypt.hashSync('CamiloVega2026!Dental', 10)
  }
];

let medicos = [...medicosSemilla];
let usuarios = [...usuariosSemilla];
let citas = [];
let fichasClinicas = [
  {
    id: 'FICHA-182349011',
    rutPaciente: '182349011',
    nombrePaciente: 'Camilo Vega Ortiz',
    historialConsultas: [
      {
        fecha: '2026-10-15',
        tipoAtencion: 'LIMPIEZA',
        medicoId: 'DOC-2',
        diagnostico: 'Profilaxis preventiva dental semestral',
        tratamiento: 'Destartraje supragingival y pulido coronario',
        observaciones: 'Encías sanas, sin presencia de caries activas'
      }
    ]
  }
];
let recetas = [];

function limpiarRut(rut) {
  if (typeof rut !== 'string') return '';
  return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

function formatearRut(rutLimpio) {
  if (!rutLimpio || rutLimpio.length < 2) return rutLimpio;
  const cuerpo = rutLimpio.slice(0, -1);
  const dv = rutLimpio.slice(-1);
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

function validarRutChileno(rutCompleto) {
  if (typeof rutCompleto !== 'string') return false;
  const limpio = limpiarRut(rutCompleto);
  if (limpio.length < 7 || limpio.length > 9) return false;

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);

  if (!/^\d+$/.test(cuerpo)) return false;

  let suma = 0;
  let multiplicador = 2;

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo.charAt(i), 10) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }

  const resto = suma % 11;
  const dvCalculadoNum = 11 - resto;
  let dvEsperado = '';

  if (dvCalculadoNum === 11) {
    dvEsperado = '0';
  } else if (dvCalculadoNum === 10) {
    dvEsperado = 'K';
  } else {
    dvEsperado = dvCalculadoNum.toString();
  }

  return dv === dvEsperado;
}

function obtenerMedicos() {
  return medicos.map(m => {
    const { passwordHash, ...datosPublicos } = m;
    return datosPublicos;
  });
}

function buscarMedicoPorId(idMedico) {
  if (!idMedico) return null;
  const MAPA_UUID = {
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1': 'DOC-1',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2': 'DOC-2',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3': 'DOC-3',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4': 'DOC-4',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5': 'DOC-5',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6': 'DOC-6',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb7': 'DOC-7',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8': 'DOC-8',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9': 'DOC-9',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10': 'DOC-10',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11': 'DOC-11'
  };
  const targetId = MAPA_UUID[idMedico] || idMedico;
  return medicos.find(m => m.id === targetId || m.uuid === idMedico) || null;
}

function buscarMedicoPorEmail(email) {
  if (!email) return null;
  const clean = email.toLowerCase().trim();
  return medicos.find(m => m.email.toLowerCase() === clean) || null;
}

function buscarMedicoPorRut(rut) {
  if (!rut) return null;
  const rutLimpio = limpiarRut(rut);
  const cuerpo = rutLimpio.length > 1 ? rutLimpio.slice(0, -1) : rutLimpio;
  return medicos.find(m => {
    if (!m.rut) return false;
    const mRut = limpiarRut(m.rut);
    return mRut === rutLimpio || (cuerpo.length >= 7 && mRut.slice(0, -1) === cuerpo);
  }) || null;
}

function buscarUsuarioPorRut(rut) {
  const rutLimpio = limpiarRut(rut);
  return usuarios.find(u => limpiarRut(u.rut) === rutLimpio) || null;
}

function buscarUsuarioPorEmail(email) {
  if (!email) return null;
  const clean = email.toLowerCase().trim();
  return usuarios.find(u => u.email.toLowerCase() === clean) || null;
}

function validarPasswordSegura(password) {
  if (!password || typeof password !== 'string' || password.length < 8) {
    return 'La contrasena debe tener al menos 8 caracteres.';
  }
  if (/\s/.test(password)) {
    return 'La contrasena no debe contener espacios en blanco.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'La contrasena debe incluir al menos una letra mayuscula.';
  }
  if (!/[a-z]/.test(password)) {
    return 'La contrasena debe incluir al menos una letra minuscula.';
  }
  if (!/[0-9]/.test(password)) {
    return 'La contrasena debe incluir al menos un numero.';
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return 'La contrasena debe incluir al menos un caracter especial.';
  }
  return null;
}

function crearUsuario(datos) {
  const { rut, nombre, email, telefono, password } = datos;

  if (!rut || !validarRutChileno(rut)) {
    throw new Error('RUT chileno invalido.');
  }

  if (!nombre || typeof nombre !== 'string' || nombre.trim().length < 3 || /\d/.test(nombre) || !/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/.test(nombre.trim())) {
    throw new Error('El nombre ingresado es invalido. Solo debe contener letras y espacios.');
  }

  if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
    throw new Error('Correo electronico invalido.');
  }

  if (!telefono || typeof telefono !== 'string' || telefono.replace(/\D/g, '').length < 8) {
    throw new Error('El telefono es obligatorio y debe contener al menos 8 digitos.');
  }

  const errPass = validarPasswordSegura(password);
  if (errPass) {
    throw new Error(errPass);
  }

  const rutLimpio = limpiarRut(rut);
  const rutExistente = buscarUsuarioPorRut(rutLimpio);
  if (rutExistente) {
    throw new Error('El RUT ingresado ya se encuentra registrado.');
  }

  const emailExistente = buscarUsuarioPorEmail(email);
  if (emailExistente) {
    throw new Error('El correo electronico ya se encuentra registrado.');
  }

  const nuevoUsuario = {
    id: `USR-PAC-${Date.now()}`,
    rut: rutLimpio,
    rutFormateado: formatearRut(rutLimpio),
    nombre: nombre.trim(),
    email: email.trim().toLowerCase(),
    telefono: telefono ? telefono.trim() : '+56 9 0000 0000',
    rol: 'PACIENTE',
    passwordHash: bcrypt.hashSync(password, 10),
    creadoEn: new Date().toISOString()
  };

  usuarios.push(nuevoUsuario);

  const { passwordHash, ...usuarioPublico } = nuevoUsuario;
  return usuarioPublico;
}

function cambiarPassword(identificador, passwordActual, nuevaPassword) {
  if (!identificador || !nuevaPassword) {
    throw new Error('Identificador y nueva contrasena requeridos.');
  }

  if (nuevaPassword.length < 8) {
    throw new Error('La nueva contrasena debe tener al menos 8 caracteres.');
  }

  let usuario = null;
  if (identificador.includes('@')) {
    usuario = buscarUsuarioPorEmail(identificador) || buscarMedicoPorEmail(identificador);
  } else {
    usuario = buscarUsuarioPorRut(identificador);
  }

  if (!usuario) {
    throw new Error('Usuario no encontrado.');
  }

  if (!passwordActual) {
    throw new Error('Debe ingresar la contrasena actual.');
  }

  const valida = bcrypt.compareSync(passwordActual, usuario.passwordHash);
  if (!valida) {
    throw new Error('La contrasena actual es incorrecta.');
  }

  usuario.passwordHash = bcrypt.hashSync(nuevaPassword, 10);
  usuario.actualizadoEn = new Date().toISOString();
  return true;
}

function verificarColisionCita(idMedico, sillon, fecha, hora, rutPaciente) {
  const rutLimpio = rutPaciente ? limpiarRut(rutPaciente) : null;
  return citas.some(c => {
    if (c.estado === 'CANCELADA') return false;
    if (c.fecha !== fecha || c.hora !== hora) return false;
    if (rutLimpio && c.rutPaciente === rutLimpio) return true;
    return c.idMedico === idMedico || c.sillon === sillon;
  });
}

function obtenerMedicosDisponibles(especialidad, fecha, hora) {
  return medicos.filter(medico => {
    if (especialidad && medico.especialidad.toLowerCase() !== especialidad.toLowerCase()) {
      return false;
    }
    if (!medico.horariosBase.includes(hora)) {
      return false;
    }
    const ocupado = verificarColisionCita(medico.id, medico.sillon, fecha, hora);
    return !ocupado;
  }).map(m => {
    const { passwordHash, ...datosPublicos } = m;
    return datosPublicos;
  });
}

function crearCita(datos) {
  const {
    rutPaciente,
    nombrePaciente,
    emailPaciente,
    telefonoPaciente,
    idMedico,
    fecha,
    hora,
    especialidad,
    esInvitado
  } = datos;

  const medico = buscarMedicoPorId(idMedico);
  if (!medico) {
    throw new Error('El medico especialista seleccionado no existe.');
  }

  const rutLimpio = limpiarRut(rutPaciente);
  const colisionMismoPaciente = citas.some(c => {
    if (c.estado === 'CANCELADA') return false;
    if (c.fecha !== fecha || c.hora !== hora) return false;
    return c.rutPaciente === rutLimpio;
  });
  if (colisionMismoPaciente) {
    throw new Error('Ya cuentas con una cita médica agendada en este mismo horario. No es posible agendar dos citas simultáneas.');
  }

  const colision = verificarColisionCita(idMedico, medico.sillon, fecha, hora, rutPaciente);
  if (colision) {
    throw new Error('El horario y box seleccionados ya no estan disponibles.');
  }

  const idCita = `CITA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const nuevaCita = {
    id: idCita,
    rutPaciente: rutLimpio,
    rutFormateado: formatearRut(rutLimpio),
    nombrePaciente,
    emailPaciente,
    telefonoPaciente,
    idMedico: medico.id,
    nombreMedico: medico.nombre,
    sillon: medico.sillon,
    especialidad: especialidad || medico.especialidad,
    fecha,
    hora,
    estado: datos.estado || 'PENDIENTE',
    esInvitado: Boolean(esInvitado),
    creadoEn: new Date().toISOString()
  };

  citas.push(nuevaCita);
  return nuevaCita;
}

function obtenerCitasPorMedico(idMedico, fecha = null) {
  const MAPA_UUID = {
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1': 'DOC-1',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2': 'DOC-2',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3': 'DOC-3',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4': 'DOC-4',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5': 'DOC-5',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6': 'DOC-6',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb7': 'DOC-7',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8': 'DOC-8',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9': 'DOC-9',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10': 'DOC-10',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11': 'DOC-11'
  };
  const targetId = MAPA_UUID[idMedico] || idMedico;
  return citas.filter(c => {
    if (c.idMedico !== targetId && c.idMedico !== idMedico) return false;
    if (fecha && c.fecha !== fecha) return false;
    return true;
  });
}

function obtenerCitasPorPaciente(rutPaciente) {
  const rutLimpio = limpiarRut(rutPaciente);
  return citas.filter(c => c.rutPaciente === rutLimpio);
}

const TRANSICIONES_VALIDAS = {
  PENDIENTE: ['CONFIRMADA', 'EN_ATENCION', 'CANCELADA'],
  CONFIRMADA: ['EN_ATENCION', 'CANCELADA'],
  EN_ATENCION: ['ATENDIDA', 'CANCELADA'],
  ATENDIDA: [],
  CANCELADA: []
};

function actualizarEstadoCita(idCita, nuevoEstado) {
  const estadosValidos = ['PENDIENTE', 'CONFIRMADA', 'EN_ATENCION', 'ATENDIDA', 'CANCELADA'];
  if (!estadosValidos.includes(nuevoEstado)) {
    throw new Error('Estado de cita invalido.');
  }

  const cita = citas.find(c => c.id === idCita);
  if (!cita) {
    throw new Error('Cita no encontrada.');
  }

  const permitidos = TRANSICIONES_VALIDAS[cita.estado] || [];
  if (!permitidos.includes(nuevoEstado) && cita.estado !== nuevoEstado) {
    throw new Error(`Transicion de estado no permitida desde ${cita.estado} a ${nuevoEstado}.`);
  }

  cita.estado = nuevoEstado;
  cita.actualizadoEn = new Date().toISOString();
  return cita;
}

function obtenerFichaClinica(rutPaciente) {
  const rutLimpio = limpiarRut(rutPaciente);
  return fichasClinicas.find(f => f.rutPaciente === rutLimpio) || null;
}

function registrarAtencionEnFicha(rutPaciente, datosAtencion) {
  const rutLimpio = limpiarRut(rutPaciente);
  let ficha = fichasClinicas.find(f => f.rutPaciente === rutLimpio);

  if (!ficha) {
    ficha = {
      id: `FICHA-${rutLimpio}`,
      rutPaciente: rutLimpio,
      nombrePaciente: datosAtencion.nombrePaciente || 'Paciente',
      historialConsultas: []
    };
    fichasClinicas.push(ficha);
  }

  const registroConsulta = {
    id: `CONS-${Date.now()}`,
    fecha: datosAtencion.fecha || new Date().toISOString().split('T')[0],
    tipoAtencion: datosAtencion.tipoAtencion,
    medicoId: datosAtencion.medicoId,
    nombreMedico: datosAtencion.nombreMedico,
    diagnostico: datosAtencion.diagnostico,
    tratamiento: datosAtencion.tratamiento,
    observaciones: datosAtencion.observaciones || '',
    registradoEn: new Date().toISOString()
  };

  ficha.historialConsultas.unshift(registroConsulta);
  return registroConsulta;
}

function guardarReceta(recetaFirmada) {
  recetas.push(recetaFirmada);
  return recetaFirmada;
}

function obtenerRecetaPorId(idReceta) {
  return recetas.find(r => r.id === idReceta) || null;
}

function obtenerRecetasPorPaciente(rutPaciente) {
  const rutLimpio = limpiarRut(rutPaciente);
  return recetas.filter(r => r.rutPaciente === rutLimpio);
}

let turnosMedicos = [];

function guardarTurnoMedico(datos) {
  const { idMedico, fecha, horaInicio, horaFin, sillon } = datos;
  const medico = buscarMedicoPorId(idMedico);
  if (!medico) {
    throw new Error('Medico especialista no encontrado.');
  }
  if (!fecha || !horaInicio || !horaFin) {
    throw new Error('Fecha, hora de inicio y fin son obligatorias.');
  }

  const yaExiste = turnosMedicos.some(t => t.idMedico === idMedico && t.fecha === fecha && t.horaInicio === horaInicio);
  if (yaExiste) {
    throw new Error('Ya existe un turno registrado para ese especialista en dicho horario.');
  }

  const nuevoTurno = {
    id: `TURNO-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    idMedico,
    nombreMedico: medico.nombre,
    especialidad: medico.especialidad,
    sillon: sillon || medico.sillon,
    fecha,
    horaInicio,
    horaFin,
    estado: 'DISPONIBLE',
    creadoEn: new Date().toISOString()
  };

  turnosMedicos.push(nuevoTurno);
  if (!medico.horariosBase.includes(horaInicio)) {
    medico.horariosBase.push(horaInicio);
    medico.horariosBase.sort();
  }

  return nuevoTurno;
}

function obtenerTurnosPorMedico(idMedico, fecha = null) {
  return turnosMedicos.filter(t => {
    if (t.idMedico !== idMedico) return false;
    if (fecha && t.fecha !== fecha) return false;
    return true;
  });
}

function reiniciarEstadoParaPruebas() {
  medicos = [...medicosSemilla];
  usuarios = [...usuariosSemilla];
  citas = [];
  turnosMedicos = [];
  fichasClinicas = [
    {
      id: 'FICHA-182349011',
      rutPaciente: '182349011',
      nombrePaciente: 'Camilo Vega Ortiz',
      historialConsultas: [
        {
          fecha: '2026-10-15',
          tipoAtencion: 'LIMPIEZA',
          medicoId: 'DOC-2',
          diagnostico: 'Profilaxis preventiva dental semestral',
          tratamiento: 'Destartraje supragingival y pulido coronario',
          observaciones: 'Encías sanas, sin presencia de caries activas'
        }
      ]
    }
  ];
  recetas = [];
}

function obtenerTodasLasCitas() {
  return citas;
}

module.exports = {
  get citas() {
    return citas;
  },
  obtenerTodasLasCitas,
  limpiarRut,
  formatearRut,
  validarRutChileno,
  obtenerMedicos,
  buscarMedicoPorId,
  buscarMedicoPorEmail,
  buscarMedicoPorRut,
  buscarUsuarioPorRut,
  buscarUsuarioPorEmail,
  crearUsuario,
  cambiarPassword,
  verificarColisionCita,
  obtenerMedicosDisponibles,
  crearCita,
  obtenerCitasPorMedico,
  obtenerCitasPorPaciente,
  actualizarEstadoCita,
  obtenerFichaClinica,
  registrarAtencionEnFicha,
  guardarReceta,
  obtenerRecetaPorId,
  obtenerRecetasPorPaciente,
  guardarTurnoMedico,
  obtenerTurnosPorMedico,
  reiniciarEstadoParaPruebas
};
