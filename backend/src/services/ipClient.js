function normalizarIp(ipRaw) {
  if (!ipRaw || typeof ipRaw !== 'string') return '';
  let ip = ipRaw.trim();
  if (!ip || ip.toLowerCase() === 'unknown') return '';
  if (ip.startsWith('"') && ip.endsWith('"')) ip = ip.slice(1, -1).trim();
  if (/^::ffff:/i.test(ip)) {
    ip = ip.replace(/^::ffff:/i, '');
  }
  if (ip.startsWith('[') && ip.includes(']')) {
    ip = ip.slice(1, ip.indexOf(']'));
    if (/^::ffff:/i.test(ip)) {
      ip = ip.replace(/^::ffff:/i, '');
    }
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.split(':')[0];
  }
  if (ip === '::1') return '127.0.0.1';
  const limpia = ip.replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45);
  return limpia;
}

function esIpPrivadaOLocal(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1') return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  const m172 = ip.match(/^172\.(\d{1,3})\./);
  if (m172) {
    const oct = parseInt(m172[1], 10);
    if (oct >= 16 && oct <= 31) return true;
  }
  if (/^fc00:|^fd00:|^fe80:/i.test(ip)) return true;
  return false;
}

function extraerDesdeForwardedHeader(headerVal) {
  if (!headerVal || typeof headerVal !== 'string') return [];
  const ips = [];
  const matches = headerVal.matchAll(/for=([^;,\s]+)/gi);
  for (const m of matches) {
    const clean = normalizarIp(m[1]);
    if (clean) ips.push(clean);
  }
  return ips;
}

function obtenerIpCliente(req) {
  if (!req) return '127.0.0.1';
  const headers = req.headers || {};
  const candidatos = [];

  const encabezadosDirectos = [
    'cf-connecting-ip',
    'true-client-ip',
    'x-real-ip',
    'x-client-ip',
    'fly-client-ip',
    'fastly-client-ip'
  ];

  for (const clave of encabezadosDirectos) {
    const val = headers[clave];
    if (typeof val === 'string' && val.trim()) {
      const clean = normalizarIp(val.split(',')[0]);
      if (clean) candidatos.push(clean);
    }
  }

  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    xff.split(',').forEach(part => {
      const clean = normalizarIp(part);
      if (clean) candidatos.push(clean);
    });
  }

  if (typeof headers['forwarded'] === 'string') {
    extraerDesdeForwardedHeader(headers['forwarded']).forEach(ip => candidatos.push(ip));
  }

  const publico = candidatos.find(ip => !esIpPrivadaOLocal(ip));
  if (publico) return publico;
  if (candidatos.length > 0) return candidatos[0];

  const fallbacks = [
    req.ip,
    req.socket && req.socket.remoteAddress,
    req.connection && req.connection.remoteAddress
  ];

  for (const raw of fallbacks) {
    const clean = normalizarIp(raw);
    if (clean) return clean;
  }

  return '127.0.0.1';
}

module.exports = {
  obtenerIpCliente,
  normalizarIp
};
