-- =====================================================================
--  Asistente de seguimiento de enfermedades crónicas (bot de Telegram)
--  Administración de Bases de Datos - UdeG, CUCEI
--  Motor: PostgreSQL 13+
-- =====================================================================

-- Base de datos (ejecutar por separado si se crea desde cero)
-- CREATE DATABASE asistente_cronicas;
-- \c asistente_cronicas

-- Extensión para gen_random_uuid() y cifrado AES-256 (pgp_sym_encrypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Limpieza (orden inverso a las dependencias)
DROP TABLE IF EXISTS registros_dosis           CASCADE;
DROP TABLE IF EXISTS horarios_medicamento      CASCADE;
DROP TABLE IF EXISTS medicamentos              CASCADE;
DROP TABLE IF EXISTS mediciones                CASCADE;
DROP TABLE IF EXISTS sintomas                  CASCADE;
DROP TABLE IF EXISTS citas                     CASCADE;
DROP TABLE IF EXISTS registros_consentimiento  CASCADE;
DROP TABLE IF EXISTS pacientes                 CASCADE;

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

-- =====================================================================
-- DATOS DE PRUEBA (opcional)
--  La clave de cifrado debe venir de una variable de entorno del bot,
--  aquí se usa 'clave_demo' solo como ejemplo.
-- =====================================================================
INSERT INTO pacientes (telegram_chat_id, telefono_hash)
VALUES (123456789, encode(digest('3312345678', 'sha256'), 'hex'));

INSERT INTO registros_consentimiento (paciente_id, aceptado, version_privacidad)
SELECT id, TRUE, 'v1.0' FROM pacientes WHERE telegram_chat_id = 123456789;

INSERT INTO medicamentos (paciente_id, nombre, dosis, frecuencia, fecha_inicio)
SELECT id, 'Metformina', '850 mg', 'Cada 12 horas', CURRENT_DATE
FROM pacientes WHERE telegram_chat_id = 123456789;

INSERT INTO horarios_medicamento (medicamento_id, hora_programada)
SELECT id, h::TIME FROM medicamentos, (VALUES ('08:00'), ('20:00')) AS t(h)
WHERE nombre = 'Metformina';

INSERT INTO registros_dosis (horario_id, programada_en, tomada_en, estado)
SELECT id, CURRENT_DATE + hora_programada, CURRENT_DATE + hora_programada, 'TOMADA'
FROM horarios_medicamento WHERE hora_programada = '08:00';

INSERT INTO mediciones (paciente_id, tipo_medicion, valor_cifrado, unidad, es_critica)
SELECT id, 'GLUCOSA', pgp_sym_encrypt('145', 'clave_demo', 'cipher-algo=aes256'), 'mg/dL', FALSE
FROM pacientes WHERE telegram_chat_id = 123456789;

INSERT INTO sintomas (paciente_id, descripcion_cifrada, nivel_gravedad)
SELECT id, pgp_sym_encrypt('Mareo leve por la mañana', 'clave_demo', 'cipher-algo=aes256'), 'LEVE'
FROM pacientes WHERE telegram_chat_id = 123456789;

INSERT INTO citas (paciente_id, fecha_cita, nombre_medico)
SELECT id, CURRENT_TIMESTAMP + INTERVAL '7 days', 'Dra. López'
FROM pacientes WHERE telegram_chat_id = 123456789;

-- Ejemplo de lectura descifrando el valor:
-- SELECT tipo_medicion,
--        pgp_sym_decrypt(valor_cifrado, 'clave_demo') AS valor,
--        unidad, registrada_en
-- FROM mediciones;
