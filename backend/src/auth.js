const ROLES = {
  SUPER_ADMIN: 'SuperAdmin',
  ODONTOLOGO: 'Odontologo',
  RECEPCIONISTA: 'Recepcionista',
  ADMIN_FINANCIERO: 'AdminFinanciero'
};

function validarRol(rol) {
  return Object.values(ROLES).includes(rol);
}

function puedeVerFichaClinica(rol) {
  return rol === ROLES.SUPER_ADMIN || rol === ROLES.ODONTOLOGO;
}

function puedeModificarOdontograma(rol) {
  return rol === ROLES.ODONTOLOGO;
}

function puedeVerFinanzas(rol) {
  return rol === ROLES.SUPER_ADMIN || rol === ROLES.ADMIN_FINANCIERO;
}

function puedeGestionarAgenda(rol) {
  return rol === ROLES.SUPER_ADMIN || rol === ROLES.RECEPCIONISTA;
}

function puedeVerAuditoria(rol) {
  return rol === ROLES.SUPER_ADMIN;
}

module.exports = {
  ROLES,
  validarRol,
  puedeVerFichaClinica,
  puedeModificarOdontograma,
  puedeVerFinanzas,
  puedeGestionarAgenda,
  puedeVerAuditoria
};
