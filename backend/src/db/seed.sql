-- =====================================================================
--  src/db/seed.sql · Datos FICTICIOS para desarrollo y pruebas
--
--  Requiere schema.sql + migraciones aplicadas (`npm run db:migrate`).
--  Se ejecuta con `npm run db:seed`, que se niega a correr con
--  NODE_ENV=production. Nunca sobre la BD del piloto.
--
--  Es idempotente: se puede correr varias veces sin duplicar filas.
--  No inserta mediciones ni síntomas: esos van cifrados con ENCRYPTION_KEY
--  y solo se crean desde la app.
-- =====================================================================

-- Catálogo de enfermedades (también lo crea la migración 003)
INSERT INTO enfermedades (id, codigo, nombre) VALUES
  ('11111111-1111-4111-8111-111111111111', 'DIABETES_TIPO_2', 'Diabetes tipo 2'),
  ('22222222-2222-4222-8222-222222222222', 'HIPERTENSION',    'Hipertensión arterial'),
  ('33333333-3333-4333-8333-333333333333', 'ASMA',            'Asma')
ON CONFLICT (codigo) DO NOTHING;

-- Paciente ficticio de demo (chat id inventado)
INSERT INTO pacientes (telegram_chat_id, alias, anio_nacimiento)
VALUES (123456789, 'Paciente demo', 1970)
ON CONFLICT (telegram_chat_id) DO NOTHING;

INSERT INTO registros_consentimiento (paciente_id, aceptado, version_privacidad)
SELECT p.id, TRUE, 'v1.0'
  FROM pacientes p
 WHERE p.telegram_chat_id = 123456789
   AND NOT EXISTS (SELECT 1 FROM registros_consentimiento rc WHERE rc.paciente_id = p.id);

INSERT INTO paciente_enfermedades (paciente_id, enfermedad_id)
SELECT p.id, '11111111-1111-4111-8111-111111111111'
  FROM pacientes p
 WHERE p.telegram_chat_id = 123456789
ON CONFLICT DO NOTHING;

INSERT INTO medicamentos (paciente_id, nombre, dosis, frecuencia, fecha_inicio)
SELECT p.id, v.nombre, v.dosis, v.frecuencia, CURRENT_DATE
  FROM pacientes p
 CROSS JOIN (VALUES ('Metformina', '850 mg', 'Cada 12 horas'),
                    ('Losartán',   '50 mg',  'Cada 24 horas')) AS v(nombre, dosis, frecuencia)
 WHERE p.telegram_chat_id = 123456789
   AND NOT EXISTS (SELECT 1 FROM medicamentos m WHERE m.paciente_id = p.id AND m.nombre = v.nombre);

INSERT INTO horarios_medicamento (medicamento_id, hora_programada)
SELECT m.id, h.hora::TIME
  FROM medicamentos m
  JOIN pacientes p ON p.id = m.paciente_id AND p.telegram_chat_id = 123456789
 CROSS JOIN (VALUES ('08:00'), ('20:00')) AS h(hora)
 WHERE m.nombre = 'Metformina'
   AND NOT EXISTS (SELECT 1 FROM horarios_medicamento x
                    WHERE x.medicamento_id = m.id AND x.hora_programada = h.hora::TIME);
