// Server-Sent Events hub: one stream for the canvas UI (status, logs, reports, setup steps).
const clients = new Set();
const recent = []; // small replay buffer for late subscribers

export function emit(type, data) {
  const msg = { type, data, t: Date.now() };
  if (type !== 'log') {
    recent.push(msg);
    if (recent.length > 200) recent.shift();
  }
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

export function sseHandler(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': easel\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function recentEvents() {
  return recent.slice();
}
