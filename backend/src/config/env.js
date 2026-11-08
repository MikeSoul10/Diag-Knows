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

export function puertoHttp() {
  const puerto = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) {
    throw new Error('PORT debe ser un número de puerto válido.');
  }
  return puerto;
}

/**
 * Datos del webhook (solo TELEGRAM_MODE=webhook). Telegram exige HTTPS y un
 * secret_token de 1 a 256 caracteres [A-Za-z0-9_-].
 */
export function configuracionWebhook() {
  const dominio = (process.env.WEBHOOK_DOMAIN || '').trim().replace(/\/+$/, '');
  const secreto = (process.env.WEBHOOK_SECRET || '').trim();

  if (!/^https:\/\/[^/\s]+$/.test(dominio)) {
    throw new Error('WEBHOOK_DOMAIN debe ser https://tu-dominio (sin ruta) en modo webhook.');
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secreto)) {
    throw new Error(
      'WEBHOOK_SECRET debe tener de 32 a 256 caracteres [A-Za-z0-9_-]. Genera uno con: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return { dominio, secreto };
}
