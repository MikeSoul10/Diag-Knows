-- 005 · Zona horaria por paciente (recordatorios de DK-302)
ALTER TABLE pacientes
  ADD COLUMN zona_horaria VARCHAR(50) NOT NULL DEFAULT 'America/Mexico_City';
