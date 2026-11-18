export class EventHub {
  constructor() {
    this.clients = new Set();
    this.seq = 0;
  }

  addClient(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 1500\n\n");
    this.clients.add(res);
    this.send(res, "hello", { now: Date.now() });
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {}
    }, 25000);
    if (typeof heartbeat.unref === "function") heartbeat.unref();
    req.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }

  send(res, event, data) {
    try {
      res.write("event: " + event + "\n");
      res.write("data: " + JSON.stringify(data) + "\n\n");
    } catch {}
  }

  emit(event, data) {
    this.seq += 1;
    const payload = { ...data, seq: this.seq, at: Date.now() };
    for (const res of this.clients) this.send(res, event, payload);
  }

  closeAll() {
    for (const res of this.clients) {
      try {
        res.end();
      } catch {}
    }
    this.clients.clear();
  }
}
