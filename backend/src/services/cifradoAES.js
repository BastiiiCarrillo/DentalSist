const crypto = require('crypto');

const ALGORITMO = 'aes-256-gcm';
const CLAVE_SECRETA = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || process.env.AES_SECRET_KEY || 'DentalSisClaveMaestraClinica2026!').digest();

function cifrarDatoSensible(textoPlano) {
  if (!textoPlano) return textoPlano;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITMO, CLAVE_SECRETA, iv);
  let cifrado = cipher.update(String(textoPlano), 'utf8', 'hex');
  cifrado += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${cifrado}`;
}

function descifrarDatoSensible(cadenaCifrada) {
  if (!cadenaCifrada || typeof cadenaCifrada !== 'string' || !cadenaCifrada.includes(':')) {
    return cadenaCifrada;
  }
  const partes = cadenaCifrada.split(':');
  if (partes.length !== 3) return cadenaCifrada;
  try {
    const [ivHex, tagHex, contenidoHex] = partes;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITMO, CLAVE_SECRETA, iv);
    decipher.setAuthTag(tag);
    let descifrado = decipher.update(contenidoHex, 'hex', 'utf8');
    descifrado += decipher.final('utf8');
    return descifrado;
  } catch (error) {
    return null;
  }
}

module.exports = {
  cifrarDatoSensible,
  descifrarDatoSensible
};
