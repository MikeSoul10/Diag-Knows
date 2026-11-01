import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AVISO_PRIVACIDAD, escaparHtml, tecladoEnfermedades } from '../src/channel/format.js';
import { catalogoEnfermedades } from '../src/services/registration.service.js';

test('escaparHtml neutraliza los caracteres que rompen el parseo de Telegram', () => {
  assert.equal(escaparHtml('Ana & <b>López</b>'), 'Ana &amp; &lt;b&gt;López&lt;/b&gt;');
  assert.equal(escaparHtml(null), '');
});

test('el aviso de privacidad menciona el cifrado de Telegram y la no sustitución del médico', () => {
  assert.match(AVISO_PRIVACIDAD, /no tienen cifrado de extremo a extremo/);
  assert.match(AVISO_PRIVACIDAD, /No sustituyo a tu médico/);
});

test('cada callback_data de enfermedad cabe en los 64 bytes de Telegram', async () => {
  const opciones = await catalogoEnfermedades();
  const keyboard = tecladoEnfermedades(opciones);

  const botones = keyboard.reply_markup.inline_keyboard.flat();
  assert.equal(botones.length, opciones.length);

  for (const boton of botones) {
    assert.ok(
      Buffer.byteLength(boton.callback_data, 'utf8') <= 64,
      `callback_data demasiado largo: ${boton.callback_data}`
    );
  }
});
