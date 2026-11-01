-- 004 · Toma suelta desde el chat (DK-204) y estado PENDIENTE para recordatorios (DK-302)
--
-- Una toma reportada en el chat ("me tomé la metformina") no tiene horario y
-- puede no corresponder a un medicamento del catálogo ("la pastilla"). Por eso
-- registros_dosis guarda directamente al paciente, y horario/medicamento son
-- opcionales.

ALTER TABLE registros_dosis
  ADD COLUMN paciente_id UUID REFERENCES pacientes(id) ON DELETE CASCADE;

UPDATE registros_dosis rd
   SET paciente_id = m.paciente_id
  FROM horarios_medicamento h
  JOIN medicamentos m ON m.id = h.medicamento_id
 WHERE h.id = rd.horario_id;

ALTER TABLE registros_dosis ALTER COLUMN paciente_id SET NOT NULL;

ALTER TABLE registros_dosis ALTER COLUMN horario_id DROP NOT NULL;
ALTER TABLE registros_dosis
  ADD COLUMN medicamento_id UUID REFERENCES medicamentos(id) ON DELETE SET NULL;
ALTER TABLE registros_dosis ADD COLUMN nombre_reportado VARCHAR(150);

ALTER TABLE registros_dosis DROP CONSTRAINT IF EXISTS registros_dosis_estado_check;
ALTER TABLE registros_dosis ADD CONSTRAINT registros_dosis_estado_check
  CHECK (estado IN ('PENDIENTE', 'TOMADA', 'OMITIDA', 'SALTADA'));

-- Un solo recordatorio por horario y momento; las tomas sueltas (sin horario) no chocan.
CREATE UNIQUE INDEX uq_dosis_horario_momento
  ON registros_dosis(horario_id, programada_en)
  WHERE horario_id IS NOT NULL;

CREATE INDEX idx_dosis_paciente    ON registros_dosis(paciente_id, programada_en);
CREATE INDEX idx_dosis_medicamento ON registros_dosis(medicamento_id);
