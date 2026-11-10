import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { crearAppHttp, RUTA_WEBHOOK, secretoValido } from '../src/channel/http.js';
import { estadoSalud } from '../src/services/salud.service.js';
import { configuracionWebhook } from '../src/config/env.js';

process.env.USE_MOCK_REPOS = 'true';

const SECRETO = 'a'.repeat(64);

async function levantar(app) {
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = servidor.address();
  return { url: `http://127.0.0.1:${port}`, cerrar: () => new Promise((r) => servidor.close(r)) };
}

describe('GET /health', () => {
  test('200 con la BD en modo mock', async () => {
    const { url, cerrar } = await levantar(crearAppHttp({ estadoSalud: () => estadoSalud() }));
    try {
      const res = await fetch(`${url}/health`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: 'ok', db: 'mock' });
      assert.equal(res.headers.get('x-powered-by'), null);
    } finally {
      await cerrar();
    }
  });

  test('503 sin detalles internos si la BD no responde', async () => {
    process.env.USE_MOCK_REPOS = 'false';
    const anterior = process.env.DATABASE_URL;
    // Puerto cerrado: la conexión falla rápido y nunca sale de la máquina.
    process.env.DATABASE_URL = 'postgres://nadie:secreto@127.0.0.1:1/nada';
    const errores = [];
    const { url, cerrar } = await levantar(
      crearAppHttp({ estadoSalud: () => estadoSalud({ registrarError: (e) => errores.push(e) }) })
    );
    try {
      const res = await fetch(`${url}/health`);
      assert.equal(res.status, 503);
      const texto = await res.text();
      assert.deepEqual(JSON.parse(texto), { status: 'error', db: 'error' });
      assert.ok(!texto.includes('secreto'));
      assert.equal(errores.length, 1);
    } finally {
      await cerrar();
      const { cerrarPool } = await import('../src/db/pool.js');
      await cerrarPool();
      process.env.USE_MOCK_REPOS = 'true';
      if (anterior === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = anterior;
    }
  });
});

describe('webhook de Telegram', () => {
  let servidor;
  let recibidos;

  before(async () => {
    servidor = await levantar(
      crearAppHttp({
        estadoSalud: () => estadoSalud(),
        webhook: {
          secreto: SECRETO,
          manejador: (req, res) => {
            recibidos.push(req.body);
            res.sendStatus(200);
          },
        },
      })
    );
  });
  beforeEach(() => {
    recibidos = [];
  });
  after(() => servidor.cerrar());

  const enviar = (cabeceras) =>
    fetch(`${servidor.url}${RUTA_WEBHOOK}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabeceras },
      body: JSON.stringify({ update_id: 1 }),
    });

  test('rechaza sin secreto o con secreto incorrecto', async () => {
    assert.equal((await enviar({})).status, 401);
    assert.equal((await enviar({ 'X-Telegram-Bot-Api-Secret-Token': 'b'.repeat(64) })).status, 401);
    assert.equal((await enviar({ 'X-Telegram-Bot-Api-Secret-Token': 'corto' })).status, 401);
    assert.deepEqual(recibidos, []);
  });

  test('con el secreto correcto entrega el update al bot', async () => {
    const res = await enviar({ 'X-Telegram-Bot-Api-Secret-Token': SECRETO });
    assert.equal(res.status, 200);
    assert.deepEqual(recibidos, [{ update_id: 1 }]);
  });

  test('otras rutas responden 404', async () => {
    assert.equal((await fetch(`${servidor.url}/otra`)).status, 404);
  });
});

describe('secretoValido y configuracionWebhook', () => {
  test('secretoValido no acepta vacíos ni tipos raros', () => {
    assert.equal(secretoValido(undefined, SECRETO), false);
    assert.equal(secretoValido(SECRETO, ''), false);
    assert.equal(secretoValido(SECRETO, SECRETO), true);
  });

  test('exige https y un secreto robusto', () => {
    const previo = { d: process.env.WEBHOOK_DOMAIN, s: process.env.WEBHOOK_SECRET };
    try {
      process.env.WEBHOOK_DOMAIN = 'http://inseguro.example';
      process.env.WEBHOOK_SECRET = SECRETO;
      assert.throws(() => configuracionWebhook(), /https/);

      process.env.WEBHOOK_DOMAIN = 'https://diag.example/';
      process.env.WEBHOOK_SECRET = 'corto';
      assert.throws(() => configuracionWebhook(), /WEBHOOK_SECRET/);

      process.env.WEBHOOK_SECRET = SECRETO;
      assert.deepEqual(configuracionWebhook(), {
        dominio: 'https://diag.example',
        secreto: SECRETO,
      });
    } finally {
      for (const [k, v] of [
        ['WEBHOOK_DOMAIN', previo.d],
        ['WEBHOOK_SECRET', previo.s],
      ]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
