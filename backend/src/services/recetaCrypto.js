const crypto = require('crypto');

const LLAVE_SECRETA_RECETAS = process.env.RECETA_SECRET_KEY || process.env.SECRET_HMAC_RECETAS || 'dentalsis_receta_secreta_segura_2026_hmac_key';

function serializarDatosReceta(datos) {
  const campos = [
    datos.id || '',
    datos.rutPaciente || '',
    datos.idMedico || '',
    JSON.stringify(datos.medicamentos || []),
    datos.fechaEmision || '',
    datos.indicaciones || ''
  ];
  return campos.join('|');
}

function firmarReceta(datosReceta) {
  const cargaCanonizada = serializarDatosReceta(datosReceta);
  const hmac = crypto.createHmac('sha256', LLAVE_SECRETA_RECETAS);
  hmac.update(cargaCanonizada);
  const firma = hmac.digest('hex');
  return {
    ...datosReceta,
    firmaCriptografica: firma,
    algoritmo: 'HMAC-SHA256'
  };
}

function verificarFirmaReceta(recetaFirmada) {
  if (!recetaFirmada || !recetaFirmada.firmaCriptografica) {
    return false;
  }

  const { firmaCriptografica, algoritmo, ...datosOriginales } = recetaFirmada;
  const cargaCanonizada = serializarDatosReceta(datosOriginales);
  const hmac = crypto.createHmac('sha256', LLAVE_SECRETA_RECETAS);
  hmac.update(cargaCanonizada);
  const firmaEsperada = hmac.digest('hex');

  const bufferFirma = Buffer.from(firmaCriptografica, 'hex');
  const bufferEsperado = Buffer.from(firmaEsperada, 'hex');

  if (bufferFirma.length !== bufferEsperado.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferFirma, bufferEsperado);
}

module.exports = {
  firmarReceta,
  verificarFirmaReceta,
  serializarDatosReceta
};
