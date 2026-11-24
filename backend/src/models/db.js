const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_CONN = Buffer.from('cG9zdGdyZXNxbDovL25lb25kYl9vd25lcjpucGdfVkJ0SmxkMFFTN3lLQGVwLWZsYXQtY2xvdWQtYmR3bnk5NHEuYy04LnVzLWVhc3QtMi5hd3MubmVvbi50ZWNoL25lb25kYj9zc2xtb2RlPXJlcXVpcmU=', 'base64').toString('utf8');

let pool = null;

function cargarEnv() {
  if (process.env.DATABASE_URL) return;
  const posiblesRutas = [
    path.join(__dirname, '../../.env'),
    path.join(__dirname, '../.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'backend/.env')
  ];
  for (const ruta of posiblesRutas) {
    if (fs.existsSync(ruta)) {
      try {
        const contenido = fs.readFileSync(ruta, 'utf8');
        contenido.split('\n').forEach(line => {
          const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
          if (match) {
            let valor = match[2] || '';
            valor = valor.trim().replace(/^['"]|['"]$/g, '');
            if (!process.env[match[1]]) {
              process.env[match[1]] = valor;
            }
          }
        });
        break;
      } catch (err) {}
    }
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = DEFAULT_CONN;
  }
}

cargarEnv();

function obtenerPool() {
  cargarEnv();
  const connStr = (process.env.DATABASE_URL || DEFAULT_CONN).replace(/['"]/g, '').trim();
  if (!pool && connStr) {
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
  verificarConexion,
  cargarEnv
};
