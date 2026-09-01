import { writeFile } from "node:fs/promises";

const debugPort = Number(process.argv[2]);
const pageUrl = process.argv[3];
const screenshotPath = process.argv[4] || "";
const viewportWidth = Number(process.argv[5]) || 1440;
const viewportHeight = Number(process.argv[6]) || 1000;
const deadline = Date.now() + 15000;

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchTargets() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((candidate) => candidate.type === "page");
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      // Chromium has not opened its debugging socket yet.
    }
    await pause(100);
  }
  throw new Error("Chromium did not expose a page target within 15 seconds");
}

const target = await fetchTargets();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const eventWaiters = new Map();
const exceptions = [];
let commandId = 0;

function failPending(error) {
  pending.forEach(({ reject }) => reject(error));
  pending.clear();
}

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.text || "Uncaught browser exception");
  }
  const waiters = eventWaiters.get(message.method);
  if (waiters) {
    eventWaiters.delete(message.method);
    waiters.forEach((resolve) => resolve(message.params));
  }
});
socket.addEventListener("close", () => failPending(new Error("Chromium debugging socket closed")));
socket.addEventListener("error", () => failPending(new Error("Chromium debugging socket failed")));

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Chromium WebSocket connection timed out")), 5000);
  socket.addEventListener("open", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
  socket.addEventListener("error", () => {
    clearTimeout(timer);
    reject(new Error("Could not connect to Chromium WebSocket"));
  }, { once: true });
});

function send(method, params = {}) {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function waitForEvent(method, milliseconds = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const current = eventWaiters.get(method) || [];
      eventWaiters.set(method, current.filter((waiter) => waiter !== wrapped));
      reject(new Error(`${method} did not arrive within ${milliseconds}ms`));
    }, milliseconds);
    function wrapped(params) {
      clearTimeout(timer);
      resolve(params);
    }
    const current = eventWaiters.get(method) || [];
    current.push(wrapped);
    eventWaiters.set(method, current);
  });
}

async function evaluate(expression, { userGesture = false } = {}) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Runtime evaluation failed");
  }
  return response.result.value;
}

async function poll(expression, label) {
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await pause(75);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: viewportWidth <= 760
  });
  const loaded = waitForEvent("Page.loadEventFired");
  await send("Page.navigate", { url: pageUrl });
  await loaded;
  await poll(
    "document.querySelector('#instrument')?.dataset.appReady === 'true'",
    "the dynamic app-ready marker"
  );

  const bootState = await evaluate(`(() => ({
    ready: document.querySelector('#instrument')?.dataset.appReady,
    marker: Boolean(document.querySelector('#tb03-app-ready')),
    steps: document.querySelectorAll('.step-button').length,
    slots: document.querySelectorAll('.slot-button').length,
    notes: document.querySelectorAll('.note-button').length,
    controls: document.querySelectorAll('[data-setting]').length
  }))()`);
  if (bootState.ready !== "true" || !bootState.marker || bootState.steps !== 16 ||
      bootState.slots !== 8 || bootState.notes !== 12 || bootState.controls !== 12) {
    throw new Error(`Unexpected boot state: ${JSON.stringify(bootState)}`);
  }

  const editState = await evaluate(`(() => {
    const length = document.querySelector('#pattern-length');
    length.value = '8';
    length.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-note="C"]').click();
    return {
      length: document.querySelector('#length-readout').textContent,
      outside: document.querySelectorAll('.step-button.is-outside').length,
      selected: document.querySelector('.step-button.is-selected')?.dataset.index,
      saved: Boolean(localStorage.getItem('tb03-lab-state-v1'))
    };
  })()`, { userGesture: true });
  if (editState.length !== "8" || editState.outside !== 8 || editState.selected !== "1" || !editState.saved) {
    throw new Error(`Editing did not update the live app: ${JSON.stringify(editState)}`);
  }

  const summaryIgnored = await evaluate(`(() => {
    const summary = document.querySelector('.keyboard-guide summary');
    summary.focus();
    return summary.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true
    }));
  })()`);
  if (!summaryIgnored) {
    throw new Error("The transport shortcut hijacked Space from the focused disclosure control");
  }

  await evaluate("document.querySelector('#start-transport').click()", { userGesture: true });
  await poll(
    "document.querySelector('#instrument').classList.contains('is-running') || document.querySelector('#audio-state').textContent === 'UNAVAILABLE'",
    "transport startup"
  );
  const audioState = await evaluate("document.querySelector('#audio-state').textContent");
  if (audioState === "UNAVAILABLE") {
    throw new Error("Web Audio was unavailable after a user-gesture start");
  }
  const switched = await evaluate(`(() => {
    document.querySelector('[data-slot="1"]').click();
    return {
      pattern: document.querySelector('#pattern-readout').textContent,
      running: document.querySelector('#instrument').classList.contains('is-running')
    };
  })()`, { userGesture: true });
  if (switched.pattern !== "P2" || !switched.running) {
    throw new Error(`Live pattern switching failed: ${JSON.stringify(switched)}`);
  }
  await evaluate("document.querySelector('#stop-transport').click()", { userGesture: true });
  await poll(
    "!document.querySelector('#instrument').classList.contains('is-running')",
    "transport stop"
  );

  if (screenshotPath) {
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true
    });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  }
  if (exceptions.length) {
    throw new Error(`Uncaught browser exception: ${exceptions.join("; ")}`);
  }
} finally {
  socket.close();
}
