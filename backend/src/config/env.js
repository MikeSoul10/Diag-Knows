/**
 * Lectura y validación de variables de entorno.
 *
 * Usa `process.loadEnvFile()` (Node 20.12+) en vez de `dotenv` para no agregar
 * una dependencia extra en esta etapa. Si el archivo `.env` no existe, no es un
 * error: en producción las variables llegan desde el panel del proveedor.
 */

let entornoCargado = false;

export function cargarEntorno() {
  if (entornoCargado) return;
  entornoCargado = true;

  try {
    process.loadEnvFile?.();
  } catch {
    // .env ausente o ilegible: seguimos con lo que ya esté en process.env
  }
}

export function obtenerTokenTelegram() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    throw new Error(
      'Falta TELEGRAM_BOT_TOKEN. Copia .env.example a .env y pega el token de @BotFather.'
    );
  }
  return token;
}

export function modoTelegram() {
  return (process.env.TELEGRAM_MODE || 'polling').trim().toLowerCase();
}

export function usarRepositoriosMock() {
  const forzado = (process.env.USE_MOCK_REPOS || '').trim().toLowerCase();
  if (forzado === 'true') return true;
  if (forzado === 'false') return false;
  // Sin DATABASE_URL no hay forma de hablar con PostgreSQL: caemos a memoria.
  return !(process.env.DATABASE_URL || '').trim();
}

export function usarIAMock() {
  const forzado = (process.env.USE_MOCK_AI || '').trim().toLowerCase();
  if (forzado === 'true') return true;
  if (forzado === 'false') return false;
  // Sin llave no hay forma de llamar a Claude: usamos el extractor por regex.
  return !(process.env.ANTHROPIC_API_KEY || '').trim();
}
