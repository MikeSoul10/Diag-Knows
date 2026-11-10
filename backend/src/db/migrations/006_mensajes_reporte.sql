-- 006 · Trazabilidad: mensaje que originó cada registro (Sprint 2, tarea técnica)
--
-- Cuando el paciente confirma un reporte, se guarda el texto de sus mensajes
-- (YA ANONIMIZADO: sin nombres, teléfonos ni correos) cifrado con AES-256, y
-- cada medición, síntoma y toma apunta a él con `mensaje_id`.
--
-- Retención: cada mensaje tiene `expira_en` (90 días por defecto,
-- MENSAJES_RETENCION_DIAS). Un job diario borra los vencidos; los registros
-- se conservan y su `mensaje_id` queda en NULL (ON DELETE SET NULL).
-- Al borrar al paciente (/borrar_datos) se van por ON DELETE CASCADE.
--
-- Después de aplicarla, volver a correr src/db/roles.sql para que `diag_app`
-- tenga permisos sobre la tabla nueva.

CREATE TABLE mensajes_reporte (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id    UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  texto_cifrado  BYTEA NOT NULL,
  recibido_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en      TIMESTAMP NOT NULL,
  CHECK (expira_en > recibido_en)
);

CREATE INDEX idx_mensajes_reporte_paciente ON mensajes_reporte(paciente_id);
CREATE INDEX idx_mensajes_reporte_expira   ON mensajes_reporte(expira_en);

ALTER TABLE mediciones
  ADD COLUMN mensaje_id UUID REFERENCES mensajes_reporte(id) ON DELETE SET NULL;
ALTER TABLE sintomas
  ADD COLUMN mensaje_id UUID REFERENCES mensajes_reporte(id) ON DELETE SET NULL;
ALTER TABLE registros_dosis
  ADD COLUMN mensaje_id UUID REFERENCES mensajes_reporte(id) ON DELETE SET NULL;

CREATE INDEX idx_mediciones_mensaje ON mediciones(mensaje_id);
CREATE INDEX idx_sintomas_mensaje   ON sintomas(mensaje_id);
CREATE INDEX idx_dosis_mensaje      ON registros_dosis(mensaje_id);
