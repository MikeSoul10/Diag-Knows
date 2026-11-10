#!/usr/bin/env node
// Hook PreToolUse de Claude Code para Diag-Knows.
// Bloquea (exit 2) acciones que expondrían secretos:
//  - escribir/editar archivos .env (excepto .env.example)
//  - leer o mostrar .env desde la terminal (cat, type, more, etc.)
//  - escribir llaves de Anthropic, tokens de Telegram o 'clave_demo' en el código
// El mensaje de stderr le llega a Claude para que corrija el rumbo.

let entrada = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (entrada += c));
process.stdin.on('end', () => {
  let datos;
  try {
    datos = JSON.parse(entrada || '{}');
  } catch {
    process.exit(0); // si no se puede leer, no bloquear
  }

  const herramienta = datos.tool_name || '';
  const t = datos.tool_input || {};

  const bloquear = (motivo) => {
    process.stderr.write(`Bloqueado por .claude/hooks/proteger-secretos.js: ${motivo}\n`);
    process.exit(2);
  };

  const esEnvReal = (ruta = '') => {
    const nombre = ruta.replace(/\\/g, '/').split('/').pop();
    return /^\.env(\..+)?$/.test(nombre) && nombre !== '.env.example';
  };

  // 1) Archivos .env reales
  if (['Write', 'Edit', 'MultiEdit'].includes(herramienta) && esEnvReal(t.file_path)) {
    bloquear('no se editan archivos .env. Agrega la variable a backend/.env.example y pide al equipo que la configure.');
  }

  // 2) Leer/mostrar .env desde Bash
  if (herramienta === 'Bash') {
    const cmd = t.command || '';
    const tokens = cmd.match(/[^\s"'|;&<>]+/g) || [];
    const tocaEnv = tokens.some(esEnvReal);
    if (tocaEnv && /\b(cat|type|more|less|head|tail|grep|sed|awk|cp|mv|source|echo)\b|>/.test(cmd)) {
      bloquear('no se lee ni modifica .env desde la terminal; contiene secretos.');
    }
    if (/git\s+add\b[^\n]*(\s|\/)\.env(\s|$)/.test(cmd) || /git\s+add\s+(-f|--force)\b/.test(cmd)) {
      bloquear('no se agregan archivos .env ni se fuerza git add sobre archivos ignorados.');
    }
    process.exit(0);
  }

  // 3) Secretos dentro del contenido escrito
  const ruta = (t.file_path || '').replace(/\\/g, '/');
  const textos = [t.content, t.new_string, ...(Array.isArray(t.edits) ? t.edits.map((e) => e.new_string) : [])]
    .filter((x) => typeof x === 'string')
    .join('\n');

  if (/sk-ant-[A-Za-z0-9_-]{20,}/.test(textos)) {
    bloquear('parece una llave de Anthropic escrita en el código. Usa process.env.ANTHROPIC_API_KEY.');
  }
  if (/\b\d{8,10}:[A-Za-z0-9_-]{30,}/.test(textos)) {
    bloquear('parece un token de bot de Telegram escrito en el código. Usa process.env.TELEGRAM_BOT_TOKEN.');
  }
  if (/clave_demo/.test(textos) && !ruta.endsWith('.sql') && !ruta.endsWith('.md')) {
    bloquear("'clave_demo' solo existe en el script SQL de ejemplo. Usa process.env.ENCRYPTION_KEY.");
  }

  process.exit(0);
});
