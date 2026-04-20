// netlify/functions/avisos.js — Bot 100% botones para Patricia

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PROGRAMAS_BASE = [
  { nombre: 'La Mañana Alegre',       inicio: '09:00', fin: '13:00', dias: 'Lunes a Viernes' },
  { nombre: 'Haciendo la Hora',       inicio: '15:00', fin: '17:00', dias: 'Lunes a Viernes' },
  { nombre: 'Actualizando la Tarde',  inicio: '17:00', fin: '19:00', dias: 'Lunes a Viernes' },
];

async function getStore() {
  const { getStore } = require('@netlify/blobs');
  return getStore('avisos');
}
async function getAvisos() {
  try { const s = await getStore(); const r = await s.get('lista',{type:'text'}); return r ? JSON.parse(r) : []; } catch(e) { return []; }
}
async function setAvisos(a) { const s = await getStore(); await s.set('lista', JSON.stringify(a)); }
async function getProgramas() {
  try { const s = await getStore(); const r = await s.get('programas',{type:'text'}); return r ? JSON.parse(r) : PROGRAMAS_BASE; } catch(e) { return PROGRAMAS_BASE; }
}
async function setProgramas(p) { const s = await getStore(); await s.set('programas', JSON.stringify(p)); }
async function getEstado(chatId) {
  try { const s = await getStore(); const r = await s.get(`est_${chatId}`,{type:'text'}); return r ? JSON.parse(r) : null; } catch(e) { return null; }
}
async function setEstado(chatId, estado) { const s = await getStore(); await s.set(`est_${chatId}`, JSON.stringify(estado)); }
async function limpiarEstado(chatId) { try { const s = await getStore(); await s.delete(`est_${chatId}`); } catch(e) {} }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

  if (event.httpMethod === 'GET') {
    try {
      const avisos = await getAvisos();
      const programas = await getProgramas();
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ avisos, programas }) };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: 'Bad JSON' }; }
    if (body.update_id !== undefined) return await manejarTelegram(body);
    return { statusCode: 400, headers: CORS, body: 'Unknown' };
  }

  return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
};

async function manejarTelegram(update) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_PATRICIA = process.env.TELEGRAM_CHAT_ID;

  const msg = update.message || update.edited_message;
  const callback = update.callback_query;
  const chatId = msg ? String(msg.chat.id) : String(callback.message.chat.id);
  const texto = msg ? msg.text?.trim() : callback?.data;

  if (CHAT_PATRICIA && chatId !== CHAT_PATRICIA) {
    await tgSend(TOKEN, chatId, '⛔ No tienes acceso a este bot.');
    return { statusCode: 200, body: 'ok' };
  }

  if (callback) await tgAnswer(TOKEN, callback.id);

  let avisos = await getAvisos();
  let programas = await getProgramas();
  let estado = await getEstado(chatId);

  // Si hay flujo activo y es texto libre
  if (estado && msg && texto && !texto.startsWith('/') && texto !== 'menu') {
    return await manejarFlujo(TOKEN, chatId, texto, estado, avisos, programas);
  }

  // MENÚ PRINCIPAL
  if (!texto || texto === '/start' || texto === 'menu') {
    await limpiarEstado(chatId);
    await mostrarMenu(TOKEN, chatId, avisos);
    return { statusCode: 200, body: 'ok' };
  }

  // VER LISTA
  if (texto === 'ver_lista') {
    if (avisos.length === 0) {
      await tgButtons(TOKEN, chatId, '📋 No hay avisos programados.',
        [[{ text: '➕ Agregar aviso', callback_data: 'nuevo_aviso' }],
         [{ text: '🏠 Menú', callback_data: 'menu' }]]);
    } else {
      let txt = `📋 *Avisos activos (${avisos.length}):*\n\n`;
      avisos.forEach((a, i) => {
        txt += `${a.urgente ? '🔴' : '📢'} *${i+1}. ${a.marca}*\n   📻 ${a.programa}\n   ⏰ ${a.horario}\n   _${a.copy}_\n\n`;
      });
      const btns = avisos.map((a, i) => [{ text: `🗑️ Eliminar: ${a.marca}`, callback_data: `del_${i}` }]);
      btns.push([{ text: '🧹 Limpiar todos', callback_data: 'limpiar_todo' }]);
      btns.push([{ text: '🏠 Menú', callback_data: 'menu' }]);
      await tgButtons(TOKEN, chatId, txt, btns, 'Markdown');
    }
    return { statusCode: 200, body: 'ok' };
  }

  // NUEVO AVISO — elegir programa
  if (texto === 'nuevo_aviso' || texto === 'nuevo_urgente') {
    const esUrgente = texto === 'nuevo_urgente';
    await setEstado(chatId, { flujo: 'nuevo_aviso', paso: 'programa', urgente: esUrgente });
    const btns = programas.map(p => [{ text: `📻 ${p.nombre}  ${p.inicio}-${p.fin}`, callback_data: `prog_${p.nombre}` }]);
    btns.push([{ text: '🏠 Cancelar', callback_data: 'menu' }]);
    await tgButtons(TOKEN, chatId, `${esUrgente ? '🔴' : '➕'} *${esUrgente ? 'Aviso URGENTE' : 'Nuevo aviso'}*\n\n¿En qué programa va?`, btns, 'Markdown');
    return { statusCode: 200, body: 'ok' };
  }

  // ELEGIR PROGRAMA
  if (texto.startsWith('prog_')) {
    const nombreProg = texto.replace('prog_', '');
    const prog = programas.find(p => p.nombre === nombreProg);
    const est = await getEstado(chatId) || { flujo: 'nuevo_aviso', urgente: false };
    await setEstado(chatId, { ...est, paso: 'horario', programa: nombreProg });
    const h1 = prog?.inicio || '09:00', h2 = prog?.fin || '13:00';
    await tgButtons(TOKEN, chatId, `📻 *${nombreProg}*\n\n¿En qué horario?`,
      [[{ text: `⏰ Todo el programa (${h1}-${h2})`, callback_data: `hor_${h1}-${h2}` }],
       [{ text: `⏰ Primera mitad`, callback_data: `hor_${h1}-${mitad(h1,h2)}` }],
       [{ text: `⏰ Segunda mitad`, callback_data: `hor_${mitad(h1,h2)}-${h2}` }],
       [{ text: '✏️ Escribir horario', callback_data: 'hor_manual' }],
       [{ text: '🔙 Volver', callback_data: est.urgente ? 'nuevo_urgente' : 'nuevo_aviso' }]], 'Markdown');
    return { statusCode: 200, body: 'ok' };
  }

  // ELEGIR HORARIO
  if (texto.startsWith('hor_')) {
    const est = await getEstado(chatId);
    if (!est) { await mostrarMenu(TOKEN, chatId, avisos); return { statusCode: 200, body: 'ok' }; }
    if (texto === 'hor_manual') {
      await setEstado(chatId, { ...est, paso: 'horario_manual' });
      await tgButtons(TOKEN, chatId, '✏️ Escribe el horario (ej: *10:30-12:00*)', [[{ text: '🔙 Volver', callback_data: `prog_${est.programa}` }]], 'Markdown');
    } else {
      const horario = texto.replace('hor_', '');
      await setEstado(chatId, { ...est, paso: 'marca', horario });
      await tgButtons(TOKEN, chatId, `⏰ *${horario}*\n\n¿Cuál es el nombre del cliente?`, [[{ text: '❌ Cancelar', callback_data: 'menu' }]], 'Markdown');
    }
    return { statusCode: 200, body: 'ok' };
  }

  // ELIMINAR AVISO
  if (texto.startsWith('del_')) {
    const idx = parseInt(texto.replace('del_', ''));
    if (!isNaN(idx) && idx >= 0 && idx < avisos.length) {
      const nombre = avisos[idx].marca;
      avisos.splice(idx, 1);
      await setAvisos(avisos);
      await tgButtons(TOKEN, chatId, `🗑️ Eliminado: *${nombre}*\nQuedan ${avisos.length} aviso(s).`,
        [[{ text: '📋 Ver lista', callback_data: 'ver_lista' }],
         [{ text: '🏠 Menú', callback_data: 'menu' }]], 'Markdown');
    }
    return { statusCode: 200, body: 'ok' };
  }

  // LIMPIAR
  if (texto === 'limpiar_todo') {
    await tgButtons(TOKEN, chatId, '⚠️ ¿Eliminar *todos* los avisos?',
      [[{ text: '✅ Sí, limpiar', callback_data: 'ok_limpiar' }],
       [{ text: '❌ Cancelar', callback_data: 'ver_lista' }]], 'Markdown');
    return { statusCode: 200, body: 'ok' };
  }
  if (texto === 'ok_limpiar') {
    const n = avisos.length; await setAvisos([]);
    await tgButtons(TOKEN, chatId, `🧹 Se eliminaron ${n} aviso(s).`, [[{ text: '🏠 Menú', callback_data: 'menu' }]]);
    return { statusCode: 200, body: 'ok' };
  }

  // PROGRAMAS
  if (texto === 'ver_programas') {
    let txt = `📻 *Programas (${programas.length}):*\n\n`;
    programas.forEach((p, i) => { txt += `${i+1}. *${p.nombre}*  ${p.inicio}-${p.fin}  _${p.dias}_\n`; });
    await tgButtons(TOKEN, chatId, txt,
      [[{ text: '➕ Agregar programa', callback_data: 'add_prog' }],
       [{ text: '🗑️ Eliminar programa', callback_data: 'del_prog_lista' }],
       [{ text: '🏠 Menú', callback_data: 'menu' }]], 'Markdown');
    return { statusCode: 200, body: 'ok' };
  }

  if (texto === 'add_prog') {
    await setEstado(chatId, { flujo: 'nuevo_programa', paso: 'nombre' });
    await tgButtons(TOKEN, chatId, '➕ *Nuevo programa*\n\n¿Cómo se llama el programa?\nEscribe el nombre:', [[{ text: '❌ Cancelar', callback_data: 'ver_programas' }]], 'Markdown');
    return { statusCode: 200, body: 'ok' };
  }

  if (texto === 'del_prog_lista') {
    const btns = programas.map((p, i) => [{ text: `🗑️ ${p.nombre}`, callback_data: `delprog_${i}` }]);
    btns.push([{ text: '🔙 Volver', callback_data: 'ver_programas' }]);
    await tgButtons(TOKEN, chatId, '¿Cuál programa eliminar?', btns);
    return { statusCode: 200, body: 'ok' };
  }

  if (texto.startsWith('delprog_')) {
    const idx = parseInt(texto.replace('delprog_', ''));
    if (!isNaN(idx) && idx < programas.length) {
      const nombre = programas[idx].nombre;
      programas.splice(idx, 1);
      await setProgramas(programas);
      await tgButtons(TOKEN, chatId, `🗑️ Eliminado: *${nombre}*`,
        [[{ text: '📻 Ver programas', callback_data: 'ver_programas' }],
         [{ text: '🏠 Menú', callback_data: 'menu' }]], 'Markdown');
    }
    return { statusCode: 200, body: 'ok' };
  }

  // Horas para nuevo programa
  if (texto.startsWith('pi_')) {
    const hora = texto.replace('pi_', '');
    const est = await getEstado(chatId);
    await setEstado(chatId, { ...est, paso: 'fin', inicio: hora });
    const horas = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00','00:00'];
    const btns = [];
    for (let i = 0; i < horas.length; i += 3) btns.push(horas.slice(i,i+3).map(h => ({ text: h, callback_data: `pf_${h}` })));
    btns.push([{ text: '❌ Cancelar', callback_data: 'ver_programas' }]);
    await tgButtons(TOKEN, chatId, `📻 *${est.nombre}*\nComienza: *${hora}*\n\n¿A qué hora termina?`, btns, 'Markdown');
    return { statusCode: 200, body: 'ok' };
  }

  if (texto.startsWith('pf_')) {
    const hora = texto.replace('pf_', '');
    const est = await getEstado(chatId);
    await setEstado(chatId, { ...est, paso: 'dias', fin: hora });
    await tgButtons(TOKEN, chatId, `📻 *${est.nombre}*\n${est.inicio} – ${hora}\n\n¿Qué días?`,
      [[{ text: 'Lunes a Viernes', callback_data: 'pd_Lunes a Viernes' }],
       [{ text: 'Lunes a Domingo', callback_data: 'pd_Lunes a Domingo' }],
       [{ text: 'Sábado y Domingo', callback_data: 'pd_Sábado y Domingo' }],
       [{ text: 'Solo Sábado', callback_data: 'pd_Solo Sábado' }],
       [{ text: 'Solo Domingo', callback_data: 'pd_Solo Domingo' }],
       [{ text: '❌ Cancelar', callback_data: 'ver_programas' }]], 'Markdown');
    return { statusCode: 200, body: 'ok' };
  }

  if (texto.startsWith('pd_')) {
    const dias = texto.replace('pd_', '');
    const est = await getEstado(chatId);
    const nuevoProg = { nombre: est.nombre, inicio: est.inicio, fin: est.fin, dias };
    programas.push(nuevoProg);
    await setProgramas(programas);
    await limpiarEstado(chatId);
    await tgButtons(TOKEN, chatId, `✅ *Programa agregado*\n\n📻 *${nuevoProg.nombre}*\n⏰ ${nuevoProg.inicio} – ${nuevoProg.fin}\n📅 ${dias}`,
      [[{ text: '📻 Ver programas', callback_data: 'ver_programas' }],
       [{ text: '🏠 Menú', callback_data: 'menu' }]], 'Markdown');
    return { statusCode: 200, body: 'ok' };
  }

  // Cualquier otro → menú
  await limpiarEstado(chatId);
  await mostrarMenu(TOKEN, chatId, avisos);
  return { statusCode: 200, body: 'ok' };
}

// FLUJO CONVERSACIONAL
async function manejarFlujo(TOKEN, chatId, texto, estado, avisos, programas) {
  if (estado.flujo === 'nuevo_aviso') {
    if (estado.paso === 'horario_manual') {
      await setEstado(chatId, { ...estado, paso: 'marca', horario: texto });
      await tgButtons(TOKEN, chatId, `⏰ *${texto}*\n\n¿Nombre del cliente?`, [[{ text: '❌ Cancelar', callback_data: 'menu' }]], 'Markdown');
      return { statusCode: 200, body: 'ok' };
    }
    if (estado.paso === 'marca') {
      await setEstado(chatId, { ...estado, paso: 'texto', marca: texto });
      await tgButtons(TOKEN, chatId, `📢 *${texto}*\n\nEscribe el texto del aviso tal como se leerá al aire:`, [[{ text: '❌ Cancelar', callback_data: 'menu' }]], 'Markdown');
      return { statusCode: 200, body: 'ok' };
    }
    if (estado.paso === 'texto') {
      const nuevo = { id: Date.now().toString(), marca: estado.marca, copy: texto, programa: estado.programa, horario: estado.horario, urgente: estado.urgente || false, creadoEn: new Date().toISOString() };
      avisos.push(nuevo);
      avisos.sort((a, b) => a.horario.localeCompare(b.horario));
      await setAvisos(avisos);
      await limpiarEstado(chatId);
      await tgButtons(TOKEN, chatId,
        `${nuevo.urgente ? '🔴' : '✅'} *¡Aviso guardado!*\n\n📢 *${nuevo.marca}*\n📻 ${nuevo.programa}\n⏰ ${nuevo.horario}\n_${nuevo.copy}_\n\nYa aparece en el panel.`,
        [[{ text: '➕ Agregar otro', callback_data: 'nuevo_aviso' }],
         [{ text: '📋 Ver todos', callback_data: 'ver_lista' }],
         [{ text: '🏠 Menú', callback_data: 'menu' }]], 'Markdown');
      return { statusCode: 200, body: 'ok' };
    }
  }

  if (estado.flujo === 'nuevo_programa' && estado.paso === 'nombre') {
    await setEstado(chatId, { ...estado, paso: 'inicio', nombre: texto });
    const horas = ['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'];
    const btns = [];
    for (let i = 0; i < horas.length; i += 3) btns.push(horas.slice(i,i+3).map(h => ({ text: h, callback_data: `pi_${h}` })));
    btns.push([{ text: '❌ Cancelar', callback_data: 'ver_programas' }]);
    await tgButtons(TOKEN, chatId, `📻 *${texto}*\n\n¿A qué hora comienza?`, btns, 'Markdown');
    return { statusCode: 200, body: 'ok' };
  }

  await limpiarEstado(chatId);
  await mostrarMenu(TOKEN, chatId, avisos);
  return { statusCode: 200, body: 'ok' };
}

async function mostrarMenu(TOKEN, chatId, avisos) {
  const n = avisos.length;
  const u = avisos.filter(a => a.urgente).length;
  let txt = `🎙️ *Radio Mila FM 88.7*\nHola Patricia 👋\n\n`;
  txt += n === 0 ? '📭 Sin avisos programados' : `📋 *${n} aviso(s)*${u > 0 ? ` · 🔴 ${u} urgente(s)` : ''}`;
  await tgButtons(TOKEN, chatId, txt, [
    [{ text: '➕ Agregar aviso',       callback_data: 'nuevo_aviso'    }],
    [{ text: '🔴 Aviso URGENTE',       callback_data: 'nuevo_urgente'  }],
    [{ text: `📋 Ver avisos (${n})`,   callback_data: 'ver_lista'      }],
    [{ text: '📻 Gestionar programas', callback_data: 'ver_programas'  }],
  ], 'Markdown');
}

function mitad(h1, h2) {
  const [a,b] = [h1,h2].map(h => { const [hh,mm] = h.split(':').map(Number); return hh*60+mm; });
  const m = Math.round((a+b)/2);
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
}

async function tgSend(token, chatId, text, parseMode = '') {
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
}
async function tgButtons(token, chatId, text, buttons, parseMode = '') {
  const body = { chat_id: chatId, text, reply_markup: { inline_keyboard: buttons } };
  if (parseMode) body.parse_mode = parseMode;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
}
async function tgAnswer(token, id) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ callback_query_id: id }) });
}
