const { Pool } = require('pg');

let pool = null;

function obtenerPool() {
  if (!pool && process.env.DATABASE_URL) {
    const connStr = process.env.DATABASE_URL.replace(/['"]/g, '').trim();
    pool = new Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
  }
  return pool;
}

async function query(texto, parametros) {
  const p = obtenerPool();
  if (!p) {
    return { rows: [] };
  }
  return await p.query(texto, parametros);
}

async function verificarConexion() {
  const p = obtenerPool();
  if (!p) return false;
  try {
    const res = await p.query('SELECT 1 AS conectado;');
    return res.rows.length > 0;
  } catch (err) {
    return false;
  }
}

module.exports = {
  obtenerPool,
  query,
  verificarConexion
};
