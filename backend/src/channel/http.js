/**
 * Servidor HTTP (DK-102): GET /health y, en producción, el webhook de Telegram.
 *
 * Es parte del adaptador de canal: no contiene lógica de negocio. /health
 * pregunta al servicio de salud; el webhook entrega el update a Telegraf.
 */

import { timingSafeEqual } from 'node:crypto';

import express from 'express';

export const RUTA_WEBHOOK = '/telegram/webhook';
const CABECERA_SECRETO = 'x-telegram-bot-api-secret-token';

/** Compara en tiempo constante para no filtrar el secreto por tiempos de respuesta. */
export function secretoValido(recibido, esperado) {
  if (typeof recibido !== 'string' || !esperado) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {object} opciones
 * @param {() => Promise<{codigoHttp:number, cuerpo:object}>} opciones.estadoSalud
 * @param {{ secreto: string, manejador: import('express').RequestHandler }} [opciones.webhook]
 */
export function crearAppHttp({ estadoSalud, webhook } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', async (_req, res) => {
    const { codigoHttp, cuerpo } = await estadoSalud();
    res.status(codigoHttp).set('Cache-Control', 'no-store').json(cuerpo);
  });

  if (webhook) {
    app.post(
      RUTA_WEBHOOK,
      (req, res, next) => {
        if (!secretoValido(req.get(CABECERA_SECRETO), webhook.secreto)) {
          return res.sendStatus(401);
        }
        return next();
      },
      express.json({ limit: '1mb' }),
      webhook.manejador
    );
  }

  app.use((_req, res) => res.sendStatus(404));

  // Sin detalles del error hacia afuera; tampoco se imprime el cuerpo (texto del paciente).
  app.use((err, _req, res, _next) => {
    console.error('Error HTTP:', err?.name ?? 'Error');
    res.sendStatus(500);
  });

  return app;
}
