-- 003 · Perfil mínimo del paciente y catálogo de enfermedades (DK-105)
-- Recolección mínima: alias (no nombre completo) y año de nacimiento.

ALTER TABLE pacientes ADD COLUMN alias VARCHAR(100);
ALTER TABLE pacientes ADD COLUMN anio_nacimiento SMALLINT
  CHECK (anio_nacimiento BETWEEN 1900 AND 2100);

CREATE TABLE enfermedades (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo  VARCHAR(50)  NOT NULL UNIQUE,
  nombre  VARCHAR(100) NOT NULL
);

CREATE TABLE paciente_enfermedades (
  paciente_id       UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  enfermedad_id     UUID NOT NULL REFERENCES enfermedades(id) ON DELETE RESTRICT,
  diagnosticada_en  DATE,
  PRIMARY KEY (paciente_id, enfermedad_id)
);

-- Catálogo fijo del alcance. Los UUID son los mismos que usa el mock para que
-- los callback_data de Telegram sean idénticos con mock y con PostgreSQL.
INSERT INTO enfermedades (id, codigo, nombre) VALUES
  ('11111111-1111-4111-8111-111111111111', 'DIABETES_TIPO_2', 'Diabetes tipo 2'),
  ('22222222-2222-4222-8222-222222222222', 'HIPERTENSION',    'Hipertensión arterial'),
  ('33333333-3333-4333-8333-333333333333', 'ASMA',            'Asma')
ON CONFLICT (codigo) DO NOTHING;
