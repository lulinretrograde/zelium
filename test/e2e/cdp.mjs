// Minimal Chrome DevTools Protocol client (no dependencies; Node ≥ 22 has WebSocket).

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

export function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  async function send(method, params = {}) {
    await ready;
    const id = ++nextId;
    ws.send(JSON.stringify({ id, method, params }));
    const msg = await new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(`${method} timed out`))), 15000);
    });
    if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
    return msg.result;
  }

  function on(method, fn) {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  }

  async function evaluate(expression, contextId) {
    const r = await send('Runtime.evaluate', {
      expression,
      contextId,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  }

  return { send, on, evaluate, close: () => ws.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 8000, interval = 100, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${message}${last instanceof Error ? `: ${last.message}` : ''}`);
}

const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Tab: { code: 'Tab', keyCode: 9 },
};

export async function press(conn, key, modifiers = 0) {
  const k = KEYS[key];
  await conn.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code: k.code,
    windowsVirtualKeyCode: k.keyCode,
    modifiers,
  });
  if (k.text && !modifiers) await conn.send('Input.dispatchKeyEvent', { type: 'char', key, text: k.text });
  await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.keyCode, modifiers });
}
