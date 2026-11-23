CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut VARCHAR(12) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(25) NOT NULL CHECK (rol IN ('ADMIN', 'RECEPCIONISTA', 'PACIENTE')),
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS especialidades (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS especialistas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut VARCHAR(12) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  especialidad_id INT NOT NULL REFERENCES especialidades(id),
  registro_sis VARCHAR(30) NOT NULL UNIQUE,
  registro_colegio VARCHAR(30) NOT NULL UNIQUE,
  sillon_habitual INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pacientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut VARCHAR(12) NOT NULL UNIQUE,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  telefono VARCHAR(20),
  email VARCHAR(150),
  alergias_cifradas TEXT,
  antecedentes_cifrados TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS citas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id UUID NOT NULL REFERENCES pacientes(id),
  especialista_id UUID NOT NULL REFERENCES especialistas(id),
  sillon_numero INT NOT NULL,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  tipo_consulta VARCHAR(80) NOT NULL,
  estado VARCHAR(25) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'CONFIRMADA', 'EN_ATENCION', 'ATENDIDA', 'CANCELADA')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_sillon_horario UNIQUE (sillon_numero, fecha, hora_inicio),
  CONSTRAINT uq_especialista_horario UNIQUE (especialista_id, fecha, hora_inicio)
);

CREATE TABLE IF NOT EXISTS turnos_especialistas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  especialista_id UUID NOT NULL REFERENCES especialistas(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  sillon_numero INT NOT NULL DEFAULT 1,
  estado VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_turno_especialista UNIQUE (especialista_id, fecha, hora_inicio)
);

CREATE TABLE IF NOT EXISTS fichas_clinicas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id UUID NOT NULL REFERENCES pacientes(id),
  especialista_id UUID NOT NULL REFERENCES especialistas(id),
  cita_id UUID REFERENCES citas(id),
  tipo_consulta VARCHAR(80) NOT NULL,
  diagnostico_cifrado TEXT NOT NULL,
  tratamiento_realizado TEXT NOT NULL,
  observaciones TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recetas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio VARCHAR(40) NOT NULL UNIQUE,
  paciente_id UUID NOT NULL REFERENCES pacientes(id),
  especialista_id UUID NOT NULL REFERENCES especialistas(id),
  cita_id UUID REFERENCES citas(id),
  indicaciones_generales TEXT NOT NULL,
  firma_hmac VARCHAR(64) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receta_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_id UUID NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  medicamento_id VARCHAR(30) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  dosis VARCHAR(60) NOT NULL,
  presentacion VARCHAR(80) NOT NULL,
  cantidad VARCHAR(40) NOT NULL,
  frecuencia VARCHAR(60) NOT NULL,
  dias VARCHAR(40) NOT NULL,
  posologia TEXT NOT NULL,
  total_unidades INT NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria_seguridad (
  id BIGSERIAL PRIMARY KEY,
  evento VARCHAR(80) NOT NULL,
  usuario_id UUID,
  ip_origen VARCHAR(45) NOT NULL,
  severidad VARCHAR(20) NOT NULL,
  detalle JSONB NOT NULL,
  hash_inmutable VARCHAR(64) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE especialidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE especialistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE citas ENABLE ROW LEVEL SECURITY;
ALTER TABLE turnos_especialistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fichas_clinicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE recetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE receta_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_seguridad ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION funcion_auditar_cambio_inmutable()
RETURNS TRIGGER AS $$
DECLARE
  v_payload TEXT;
  v_hash VARCHAR(64);
BEGIN
  v_payload := CONCAT(TG_TABLE_NAME, '|', TG_OP, '|', CURRENT_TIMESTAMP, '|', COALESCE(NEW.id::TEXT, OLD.id::TEXT));
  v_hash := encode(digest(v_payload, 'sha256'), 'hex');
  
  INSERT INTO auditoria_seguridad (evento, ip_origen, severidad, detalle, hash_inmutable)
  VALUES (
    CONCAT('AUDIT_', TG_TABLE_NAME, '_', TG_OP),
    '127.0.0.1',
    'INFO',
    json_build_object('tabla', TG_TABLE_NAME, 'operacion', TG_OP, 'id', COALESCE(NEW.id::TEXT, OLD.id::TEXT)),
    v_hash
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trg_audit_fichas
AFTER INSERT OR UPDATE OR DELETE ON fichas_clinicas
FOR EACH ROW EXECUTE FUNCTION funcion_auditar_cambio_inmutable();

CREATE OR REPLACE TRIGGER trg_audit_recetas
AFTER INSERT OR UPDATE OR DELETE ON recetas
FOR EACH ROW EXECUTE FUNCTION funcion_auditar_cambio_inmutable();

INSERT INTO especialidades (id, nombre, descripcion) VALUES
  (1, 'Cirugía Bucal', 'Especialidad quirúrgica bucomaxilofacial y extracciones complejas'),
  (2, 'Odontología General', 'Atención integral preventiva, operatoria y profilaxis'),
  (3, 'Endodoncia', 'Tratamiento de conductos radiculares y patología pulpar'),
  (4, 'Ortodoncia', 'Corrección de anomalías dentomaxilares y alineación'),
  (5, 'Periodoncia', 'Diagnóstico y tratamiento de patologías periodontales y encías'),
  (6, 'Odontopediatría', 'Atención odontológica integral especializada en niños')
ON CONFLICT (id) DO NOTHING;

INSERT INTO usuarios (id, rut, nombre, email, password_hash, rol, estado) VALUES
  ('11111111-1111-1111-1111-111111111111', '15.432.890-K', 'Ing. Admin DentalSis', 'admin@dentalsis.cl', '$2b$10$xOoBM3N7FKtCxET2Vxc7R.Ae8sTwea13ecHhOJqZD0X4eh2IMlFH.', 'ADMIN', 'ACTIVO'),
  ('33333333-3333-3333-3333-333333333333', '17.452.809-6', 'Valeria Muñoz (Recepción)', 'recepcion@dentalsis.cl', '$2b$10$Z5fhlJsSkhmpepSK6VSSYulHXTTlM.iJeD4RbqYvPuXdFYdIGbpma', 'RECEPCIONISTA', 'ACTIVO'),
  ('44444444-4444-4444-4444-444444444441', '18.234.901-1', 'Camilo Vega Ortiz', 'camilo.vega@correo.cl', '$2b$10$IOOc/VBzysdLY6oX.4V/n.HFJ8YJRg1vGL3EC9QGyhFebtfYa60Pi', 'PACIENTE', 'ACTIVO')
ON CONFLICT (email) DO NOTHING;

INSERT INTO especialistas (id, rut, nombre, email, password_hash, especialidad_id, registro_sis, registro_colegio, sillon_habitual) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '14.892.341-2', 'Dr. Álvaro Soto M.', 'alvaro.soto@dentalsis.cl', '$2b$10$jI3qdM1G/OXKyjHSvxzc1ue6jk5cVrwt.S8gTYXBA.9SafAEEhLEW', 1, 'MED-SIS-2026-081', 'COL-ODONT-4491', 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '16.781.423-5', 'Dra. Fernanda Ríos', 'fernanda.rios@dentalsis.cl', '$2b$10$cJpv4cuV.Fqavv0d0yCSI.bIM1k5GmTuCi3qVxmGgj9SbIjPbij6y', 2, 'MED-SIS-2026-104', 'COL-ODONT-5102', 2),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '15.932.114-8', 'Dr. Matías Silva', 'matias.silva@dentalsis.cl', '$2b$10$RQbH2e77uL5C6lufb5719ubVxZbTdN1hZc8Is3IlctrZqc6SgkKD2', 3, 'MED-SIS-2026-192', 'COL-ODONT-6391', 3),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', '16.204.912-3', 'Dra. Marcela Lagos', 'marcela.lagos@dentalsis.cl', '$2b$10$nr/c9qxwGQFQtnH70Bz6XemZjN4JtjjBAB0fNJax34QAsJNf0jkIu', 4, 'MED-SIS-2026-215', 'COL-ODONT-7801', 4)
ON CONFLICT (email) DO NOTHING;

INSERT INTO pacientes (id, rut, nombre, apellido, fecha_nacimiento, telefono, email, alergias_cifradas, antecedentes_cifrados) VALUES
  ('55555555-5555-5555-5555-555555555551', '18.234.901-1', 'Camilo', 'Vega Ortiz', '1995-06-14', '+56 9 8765 4321', 'camilo.vega@correo.cl', 'AES256GCM:a7b8c9d0:PENICILINA_SHOCK_ANAFILACTICO', 'AES256GCM:1a2b3c4d:HIPERTENSION_CONTROLADA')
ON CONFLICT (rut) DO NOTHING;

INSERT INTO citas (id, paciente_id, especialista_id, sillon_numero, fecha, hora_inicio, hora_fin, tipo_consulta, estado) VALUES
  ('66666666-6666-6666-6666-666666666661', '55555555-5555-5555-5555-555555555551', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 1, CURRENT_DATE, '11:00:00', '11:45:00', 'Evaluación Quirúrgica Tercer Molar', 'CONFIRMADA')
ON CONFLICT DO NOTHING;

INSERT INTO fichas_clinicas (id, paciente_id, especialista_id, tipo_consulta, diagnostico_cifrado, tratamiento_realizado, observaciones) VALUES
  ('77777777-7777-7777-7777-777777777771', '55555555-5555-5555-5555-555555555551', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'Limpieza y Profilaxis', 'AES256GCM:99ee11aa:Gingivitis marginal tratada', 'Destartraje supragingival y pulido coronario', 'Encías sanas sin caries activas')
ON CONFLICT DO NOTHING;
