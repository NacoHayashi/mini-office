// Requests that expect an answer over the office WebSocket. Each one carries a
// request id, and the server's { t: "reply", rid } resolves the matching
// promise. Requests made while the socket is closed or reconnecting wait until
// it opens. A request already sent when the socket drops is answered with a
// failure instead of being sent twice.

const TIMEOUT_MS = 15000;

export function createRequests({ timeoutMs = TIMEOUT_MS } = {}) {
  let next = 0;
  let sender = null;
  const queued = [];
  const sent = new Map();

  function finish(entry, result) {
    clearTimeout(entry.timer);
    const at = queued.indexOf(entry);
    if (at >= 0) queued.splice(at, 1);
    sent.delete(entry.rid);
    entry.resolve(result);
  }

  // A sender that throws did not send: the socket is closing, so the request
  // waits for the next one.
  function deliver(entry) {
    try {
      sender({ t: entry.kind, rid: entry.rid, body: entry.body });
      sent.set(entry.rid, entry);
    } catch {
      sender = null;
      queued.push(entry);
    }
  }

  return {
    ask(kind, body = {}) {
      return new Promise((resolve) => {
        next += 1;
        const entry = { rid: `r${next}`, kind, body, resolve, timer: 0 };
        entry.timer = setTimeout(() => finish(entry, { ok: false, status: 0, error: "辦公室沒有回應" }), timeoutMs);
        if (sender) deliver(entry);
        else queued.push(entry);
      });
    },
    open(send) {
      sender = send;
      for (const entry of queued.splice(0)) {
        if (sender) deliver(entry);
        else queued.push(entry);
      }
    },
    close() {
      sender = null;
      for (const entry of [...sent.values()]) finish(entry, { ok: false, status: 0, error: "連線中斷" });
    },
    drop() {
      this.close();
      for (const entry of [...queued]) finish(entry, { ok: false, status: 0, error: "連線已結束" });
    },
    settle(message) {
      if (!message || message.t !== "reply") return false;
      const entry = sent.get(message.rid);
      if (!entry) return true;
      const result = { ...message };
      delete result.t;
      delete result.rid;
      finish(entry, result);
      return true;
    },
    get waiting() { return queued.length + sent.size; },
  };
}
