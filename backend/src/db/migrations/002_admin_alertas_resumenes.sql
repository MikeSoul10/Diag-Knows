-- 002 · Administradores, alertas orientativas y resúmenes semanales
-- Completa las 11 tablas del documento (Actividad #13). El estado PENDIENTE
-- de registros_dosis se agrega en la migración 004 junto con la dosis suelta.

CREATE TABLE administradores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id  BIGINT NOT NULL UNIQUE,
  nombre            VARCHAR(150) NOT NULL,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE medicamentos
  ADD COLUMN creado_por UUID REFERENCES administradores(id) ON DELETE SET NULL;

-- Alertas orientativas: solo se disparan cuando los umbrales estén validados
-- por un profesional de la salud (src/config/thresholds.js).
CREATE TABLE alertas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id  UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  medicion_id  UUID REFERENCES mediciones(id) ON DELETE SET NULL,
  tipo         VARCHAR(20) NOT NULL CHECK (tipo IN ('UMBRAL_CRITICO', 'DOSIS_OMITIDA')),
  severidad    VARCHAR(10) NOT NULL CHECK (severidad IN ('BAJA', 'MEDIA', 'ALTA')),
  enviada_en   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atendida     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_alertas_paciente ON alertas(paciente_id, enviada_en);

-- Resúmenes semanales: el texto va cifrado con pgp_sym_encrypt (AES-256).
CREATE TABLE resumenes_semanales (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id           UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  semana_inicio         DATE NOT NULL,
  porcentaje_adherencia NUMERIC(5,2),
  texto_cifrado         BYTEA NOT NULL,
  enviado_en            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (paciente_id, semana_inicio)
);
