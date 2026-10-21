function calcularSaldoPendiente(costoTotal, totalAbonado) {
  return costoTotal - totalAbonado;
}

function registrarAbono(saldoActual, montoAbono) {
  if (montoAbono <= 0) {
    throw new Error('El abono debe ser mayor a cero');
  }
  return saldoActual + montoAbono;
}

function determinarEstadoPago(saldoPendiente) {
  if (saldoPendiente === 0) {
    return 'PAGADO';
  }
  return 'PENDIENTE';
}

module.exports = {
  calcularSaldoPendiente,
  registrarAbono,
  determinarEstadoPago
};
