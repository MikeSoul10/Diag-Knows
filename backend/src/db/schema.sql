-- =====================================================================
--  src/db/schema.sql · Esquema base de Diag-Knows
--
--  Copia del entregable ../base_datos_enfermedades_cronicas.sql SIN la
--  sección "Limpieza" (DROP TABLE ... CASCADE) ni los datos de prueba, para
--  que nunca se pueda borrar una BD real por accidente. Los datos ficticios
--  viven en seed.sql y los cambios al esquema en migrations/.
--
--  Lo aplica `npm run db:migrate` solo si la tabla `pacientes` no existe.
-- =====================================================================

-- Extensión para gen_random_uuid() y cifrado AES-256 (pgp_sym_encrypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. PACIENTES
-- ---------------------------------------------------------------------
CREATE TABLE pacientes (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_chat_id  BIGINT       NOT NULL UNIQUE,
    telefono_hash     VARCHAR(255),
    estado            VARCHAR(20)  NOT NULL DEFAULT 'ACTIVO'
                      CHECK (estado IN ('ACTIVO', 'INACTIVO', 'BLOQUEADO')),
    creado_en         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 2. REGISTROS_CONSENTIMIENTO  (paciente "firma" consentimiento)
-- ---------------------------------------------------------------------
CREATE TABLE registros_consentimiento (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id         UUID         NOT NULL
                        REFERENCES pacientes(id) ON DELETE CASCADE,
    aceptado            BOOLEAN      NOT NULL,
    version_privacidad  VARCHAR(20)  NOT NULL,
    aceptado_en         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 3. MEDICAMENTOS  (paciente "tiene recetados")
-- ---------------------------------------------------------------------
CREATE TABLE medicamentos (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id   UUID          NOT NULL
                  REFERENCES pacientes(id) ON DELETE CASCADE,
    nombre        VARCHAR(150)  NOT NULL,
    dosis         VARCHAR(100)  NOT NULL,
    frecuencia    VARCHAR(100)  NOT NULL,
    fecha_inicio  DATE          NOT NULL,
    fecha_fin     DATE,
    CONSTRAINT chk_medicamentos_fechas
        CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);

-- ---------------------------------------------------------------------
-- 4. HORARIOS_MEDICAMENTO  (medicamento "tiene" horarios)
-- ---------------------------------------------------------------------
CREATE TABLE horarios_medicamento (
    id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    medicamento_id   UUID     NOT NULL
                     REFERENCES medicamentos(id) ON DELETE CASCADE,
    hora_programada  TIME     NOT NULL,
    activo           BOOLEAN  NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- 5. REGISTROS_DOSIS  (horario "da seguimiento" a dosis)
-- ---------------------------------------------------------------------
CREATE TABLE registros_dosis (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    horario_id     UUID         NOT NULL
                   REFERENCES horarios_medicamento(id) ON DELETE CASCADE,
    programada_en  TIMESTAMP    NOT NULL,
    tomada_en      TIMESTAMP,
    estado         VARCHAR(10)  NOT NULL
                   CHECK (estado IN ('TOMADA', 'OMITIDA', 'SALTADA'))
);

-- ---------------------------------------------------------------------
-- 6. MEDICIONES  (paciente "registra" mediciones) - valor cifrado AES-256
-- ---------------------------------------------------------------------
CREATE TABLE mediciones (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id    UUID         NOT NULL
                   REFERENCES pacientes(id) ON DELETE CASCADE,
    tipo_medicion  VARCHAR(20)  NOT NULL
                   CHECK (tipo_medicion IN ('GLUCOSA', 'PRESION_ARTERIAL', 'PESO')),
    valor_cifrado  BYTEA        NOT NULL,
    unidad         VARCHAR(20)  NOT NULL,
    es_critica     BOOLEAN      NOT NULL DEFAULT FALSE,
    registrada_en  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 7. SINTOMAS  (paciente "reporta" síntomas) - descripción cifrada AES-256
-- ---------------------------------------------------------------------
CREATE TABLE sintomas (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id          UUID         NOT NULL
                         REFERENCES pacientes(id) ON DELETE CASCADE,
    descripcion_cifrada  BYTEA        NOT NULL,
    nivel_gravedad       VARCHAR(10)  NOT NULL
                         CHECK (nivel_gravedad IN ('LEVE', 'MODERADO', 'GRAVE')),
    registrado_en        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 8. CITAS  (paciente "agenda" citas)
-- ---------------------------------------------------------------------
CREATE TABLE citas (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id           UUID          NOT NULL
                          REFERENCES pacientes(id) ON DELETE CASCADE,
    fecha_cita            TIMESTAMP     NOT NULL,
    nombre_medico         VARCHAR(150),
    recordatorio_enviado  BOOLEAN       NOT NULL DEFAULT FALSE
);

-- =====================================================================
-- ÍNDICES sobre llaves foráneas y consultas frecuentes
-- =====================================================================
CREATE INDEX idx_consentimiento_paciente ON registros_consentimiento(paciente_id);
CREATE INDEX idx_medicamentos_paciente   ON medicamentos(paciente_id);
CREATE INDEX idx_horarios_medicamento    ON horarios_medicamento(medicamento_id);
CREATE INDEX idx_dosis_horario           ON registros_dosis(horario_id);
CREATE INDEX idx_dosis_programada        ON registros_dosis(programada_en);
CREATE INDEX idx_mediciones_paciente     ON mediciones(paciente_id, registrada_en);
CREATE INDEX idx_sintomas_paciente       ON sintomas(paciente_id, registrado_en);
CREATE INDEX idx_citas_paciente          ON citas(paciente_id);
CREATE INDEX idx_citas_pendientes        ON citas(fecha_cita) WHERE recordatorio_enviado = FALSE;

-- =====================================================================
-- TRIGGER: actualiza pacientes.actualizado_en en cada UPDATE
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_actualizar_fecha()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pacientes_actualizado
BEFORE UPDATE ON pacientes
FOR EACH ROW EXECUTE FUNCTION fn_actualizar_fecha();

