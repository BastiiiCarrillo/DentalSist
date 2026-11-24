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

async function sincronizarEspecialistasEnDb(p) {
  if (!p) return;
  try {
    await p.query(`
      INSERT INTO especialidades (id, nombre, descripcion) VALUES
        (1, 'Cirugía Bucal y Maxilofacial', 'Procedimientos quirúrgicos orales, extracciones complejas y biopsias'),
        (2, 'Odontología General', 'Atención integral preventiva, restauradora y diagnóstica para adultos'),
        (3, 'Endodoncia', 'Tratamiento de conductos, patologías pulpares y preservación dental'),
        (4, 'Ortodoncia y Ortopedia Dentomaxilofacial', 'Corrección de maloclusiones y alineación maxilar'),
        (5, 'Periodoncia', 'Diagnóstico y tratamiento de patologías periodontales y encías'),
        (6, 'Odontopediatría', 'Atención odontológica integral especializada en niños')
      ON CONFLICT (id) DO NOTHING;
    `);

    const especialistasDatos = [
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '14.892.341-2', 'Dr. Álvaro Soto M.', 'alvaro.soto@dentalsis.cl', '$2b$10$vheBClgiy6WOhwrWcCV0bObmfR1iJA6TxjPf6.sKWzDgguwgPm1y2', 1, 'MED-SIS-2026-081', 'COL-ODONT-4491', 1],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '16.781.423-5', 'Dra. Fernanda Ríos', 'fernanda.rios@dentalsis.cl', '$2b$10$1rhZEXDHJyu2PaaqVrLZAehn/9TFlR0Vg1gVOk5q1gT.A5NamzfKu', 2, 'MED-SIS-2026-104', 'COL-ODONT-5102', 1],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '15.932.114-8', 'Dr. Matías Silva', 'matias.silva@dentalsis.cl', '$2b$10$teQnfaxi6KAhHf8OhBS/iuJEEoCDDcPBAjCckihu4KCHrMGOw9r2y', 3, 'MED-SIS-2026-192', 'COL-ODONT-6391', 3],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', '16.204.912-3', 'Dra. Marcela Lagos', 'marcela.lagos@dentalsis.cl', '$2b$10$maHrpElhS5RF/xH4d8M84uctySjyGFNJ9DP97GwGH29rsqVVBUHIK', 4, 'MED-SIS-2026-215', 'COL-ODONT-7801', 4],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', '15.612.394-1', 'Dr. Ignacio Valenzuela R.', 'ignacio.valenzuela@dentalsis.cl', '$2b$10$OX.uWl.WgD/gT655mPfQK.gJyvjE8JH608P17b1nTy0pOM66QfZTu', 1, 'MED-SIS-2026-301', 'COL-ODONT-8210', 2],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6', '17.204.819-3', 'Dr. Camilo Morales P.', 'camilo.morales@dentalsis.cl', '$2b$10$i9pg37dsLCoKHzx7V9S7FOm22S8jyb18dHTGETv5rYEui9D9Kx7VK', 2, 'MED-SIS-2026-302', 'COL-ODONT-8211', 2],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb7', '18.012.443-8', 'Dra. Valentina Castro T.', 'valentina.castro@dentalsis.cl', '$2b$10$sDYq7r5.GooGgYIK0QGyZOv1PQTHQ1pw0zXOSgQXVOjtFFWKq6Jba', 2, 'MED-SIS-2026-303', 'COL-ODONT-8212', 3],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8', '16.483.210-9', 'Dr. Felipe Bravo M.', 'felipe.bravo@dentalsis.cl', '$2b$10$nl/vq/ZGIag04IukLAEdEeZ9fjOlZl.v5axCNi2WKSi3H8XOI7KUm', 4, 'MED-SIS-2026-304', 'COL-ODONT-8213', 1],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9', '17.519.203-K', 'Dra. Constanza Herrera S.', 'constanza.herrera@dentalsis.cl', '$2b$10$glX1C6Y51khURsyfzivi8.Yq2/TpJbtH0T4dCABr6OA3zrtfqO9IW', 3, 'MED-SIS-2026-305', 'COL-ODONT-8214', 2],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10', '15.340.892-4', 'Dr. Rodrigo Fuentes L.', 'rodrigo.fuentes@dentalsis.cl', '$2b$10$fzXclstmtK.i0ymUz2Nv9eoY7Q0Bq9K6pM74MgQxfK9dDVeeHJ5eK', 5, 'MED-SIS-2026-306', 'COL-ODONT-8215', 3],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11', '18.391.029-7', 'Dra. Camila Paz Aedo', 'camila.aedo@dentalsis.cl', '$2b$10$UJK/QBILd3tr4FcwNW8xKexV9avbCd.CCsW75t4VSTdK3ymrA1mM6', 6, 'MED-SIS-2026-307', 'COL-ODONT-8216', 4]
    ];

    for (const esp of especialistasDatos) {
      await p.query(`
        INSERT INTO especialistas (id, rut, nombre, email, password_hash, especialidad_id, registro_sis, registro_colegio, sillon_habitual)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          nombre = EXCLUDED.nombre,
          especialidad_id = EXCLUDED.especialidad_id,
          sillon_habitual = EXCLUDED.sillon_habitual;
      `, esp);
    }

    await p.query(`ALTER TABLE citas ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT;`).catch(() => {});
    await p.query(`ALTER TABLE citas ADD COLUMN IF NOT EXISTS cancelada_por VARCHAR(30);`).catch(() => {});
    await p.query(`ALTER TABLE citas ADD COLUMN IF NOT EXISTS cancelada_en TIMESTAMP WITH TIME ZONE;`).catch(() => {});
    await p.query(`ALTER TABLE citas DROP CONSTRAINT IF EXISTS citas_estado_check;`).catch(() => {});
    await p.query(`ALTER TABLE citas ADD CONSTRAINT citas_estado_check CHECK (estado IN ('PENDIENTE', 'CONFIRMADA', 'EN_ATENCION', 'ATENDIDA', 'CANCELADA', 'NO_ASISTIO'));`).catch(() => {});
    await p.query(`ALTER TABLE citas DROP CONSTRAINT IF EXISTS uq_sillon_horario;`).catch(() => {});
    await p.query(`ALTER TABLE citas DROP CONSTRAINT IF EXISTS uq_especialista_horario;`).catch(() => {});
    await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sillon_horario_activo ON citas (sillon_numero, fecha, hora_inicio) WHERE estado != 'CANCELADA';`).catch(() => {});
    await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_especialista_horario_activo ON citas (especialista_id, fecha, hora_inicio) WHERE estado != 'CANCELADA';`).catch(() => {});
  } catch (errSync) {}
}

async function verificarConexion() {
  const p = obtenerPool();
  if (!p) return false;
  try {
    const res = await p.query('SELECT 1 AS conectado;');
    if (res.rows.length > 0) {
      await sincronizarEspecialistasEnDb(p);
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

module.exports = {
  obtenerPool,
  query,
  verificarConexion,
  sincronizarEspecialistasEnDb,
  cargarEnv
};
