// SkinMirror — single-page skin-analysis app backed by the YouCam S2S API.
// Node.js standard library only (no npm install needed).
// The YouCam API key is read ONLY from the YOUCAM_API_KEY environment
// variable, server-side. It is never sent to the browser, never logged,
// and never written to disk. Uploaded selfies are kept in memory only
// for the duration of one request and are never stored.
//
// Verified against the YouCam API documentation (docs.perfectcorp.com /
// yce.perfectcorp.com/document): file -> pre-signed PUT -> task -> poll.
//   POST /s2s/v2.0/file/skin-analysis   { files: [{content_type,file_name,file_size}] }
//   PUT  <requests[0].url>              (binary image)
//   POST /s2s/v2.0/task/skin-analysis   { src_file_id, dst_actions, miniserver_args, format }
//   GET  /s2s/v2.0/task/skin-analysis/<task_id>  -> data.results.output[],
//        each { type, ui_score, raw_score, mask_urls[] }, data.task_status
//   POST /s2s/v2.0/file/makeup-vto  +  POST /s2s/v2.0/task/makeup-vto
//        { src_file_id, effects, version: "1.0" }  -> task_id, poll for results url.
//   GET  /s2s/v1.0/client/credit (per the design doc; see README if the
//        console reports a different credit path for this account).

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE = 'https://yce-api-01.makeupar.com';
const KEY = process.env.YOUCAM_API_KEY || '';

// SD (standard-definition) concern set: 7 actions, never mixed with HD
// actions in one request (the API rejects mixed SD/HD sets).
const DST_ACTIONS = ['acne', 'wrinkle', 'texture', 'moisture', 'oiliness', 'pore', 'redness'];

function youcam(pathname, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(BASE + pathname, {
      method,
      headers: {
        Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 500) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function putBinary(url, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'Content-Length': buffer.length },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 300) }));
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

async function registerFile(feature, buffer, contentType, fileName) {
  const r = await youcam(`/s2s/v2.0/file/${feature}`, 'POST', {
    files: [{ content_type: contentType, file_name: fileName, file_size: buffer.length }],
  });
  if (r.status !== 200 || !r.json || !r.json.data) {
    throw new Error(`file/${feature} failed (HTTP ${r.status}): ${(r.json && (r.json.error || r.json.error_code)) || r.raw}`);
  }
  const f = r.json.data.files[0];
  if (!f || !f.file_id || !f.requests || !f.requests[0] || !f.requests[0].url) {
    throw new Error(`file/${feature} returned no upload URL`);
  }
  const up = await putBinary(f.requests[0].url, buffer, contentType);
  if (up.status < 200 || up.status >= 300) {
    throw new Error(`S3 upload failed (HTTP ${up.status})`);
  }
  return f.file_id;
}

async function pollTask(feature, taskId, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const r = await youcam(`/s2s/v2.0/task/${feature}/${encodeURIComponent(taskId)}`, 'GET');
    if (r.status === 200 && r.json && r.json.data) {
      const d = r.json.data;
      const st = d.task_status || d.status;
      if (st === 'success') return d;
      if (st === 'error') {
        throw new Error(`task ${feature} failed: ${d.error || d.error_message || d.failure_reason || 'unknown engine error'}`);
      }
    } else if (r.status === 404) {
      throw new Error(`task ${feature} not found (task may have expired)`);
    }
    await new Promise((r2) => setTimeout(r2, 2500));
  }
  throw new Error(`task ${feature} timed out after ${Math.round(timeoutMs / 1000)}s`);
}

function normalizeSkinResult(data) {
  const out = (data.results && data.results.output) || [];
  const concerns = out.map((o) => ({
    type: o.type,
    ui_score: o.ui_score,
    raw_score: o.raw_score,
    mask_url: (o.mask_urls && o.mask_urls[0]) || null,
  }));
  const overall = concerns.length
    ? Math.round(concerns.reduce((s, c) => s + (c.ui_score || 0), 0) / concerns.length)
    : null;
  return { source: 'youcam', overall, concerns };
}

function parseImage(body) {
  if (!body || typeof body.image !== 'string') throw new Error('missing image (data URL)');
  const m = body.image.match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/);
  if (!m) throw new Error('image must be a PNG/JPEG data URL under 10MB');
  const buffer = Buffer.from(m[3], 'base64');
  if (buffer.length > 10 * 1024 * 1024) throw new Error('image exceeds 10MB');
  const ext = m[2] === 'jpeg' || m[2] === 'jpg' ? 'jpg' : 'png';
  return { buffer, contentType: m[2] === 'png' ? 'image/png' : 'image/jpeg', fileName: `skinmirror.${ext}` };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 14 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve(null); } });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'sample-result.json'), 'utf8'));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/sample-result.json') {
      return send(res, 200, SAMPLE);
    }
    if (req.method === 'GET' && url.pathname === '/api/credit') {
      if (!KEY) return send(res, 200, { configured: false });
      const r = await youcam('/s2s/v1.0/client/credit', 'GET');
      return send(res, 200, { configured: true, status: r.status, data: r.json || null });
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const body = await readBody(req);
      if (body && body.sample) return send(res, 200, SAMPLE);
      if (!KEY) return send(res, 200, { ...SAMPLE, note: 'YOUCAM_API_KEY not set — showing sample result. Set the key and re-analyze for a live YouCam result.' });
      const img = parseImage(body);
      const fileId = await registerFile('skin-analysis', img.buffer, img.contentType, img.fileName);
      const task = await youcam('/s2s/v2.0/task/skin-analysis', 'POST', {
        src_file_id: fileId,
        dst_actions: DST_ACTIONS,
        miniserver_args: { enable_mask_overlay: true },
        format: 'json',
      });
      if (task.status !== 200 || !task.json || !task.json.data || !task.json.data.task_id) {
        throw new Error(`task/skin-analysis failed (HTTP ${task.status}): ${(task.json && (task.json.error || task.json.error_code)) || task.raw}`);
      }
      const done = await pollTask('skin-analysis', task.json.data.task_id);
      return send(res, 200, normalizeSkinResult(done));
    }
    if (req.method === 'POST' && url.pathname === '/api/vto') {
      const body = await readBody(req);
      if (!KEY) return send(res, 400, { error: 'YOUCAM_API_KEY not set — VTO needs a live key (sample mode has no VTO render).' });
      const img = parseImage(body);
      const fileId = await registerFile('makeup-vto', img.buffer, img.contentType, img.fileName);
      const preset = (body && body.preset) || 'natural';
      const lip = preset === 'bold' ? '#A93226' : '#C0392B';
      const task = await youcam('/s2s/v2.0/task/makeup-vto', 'POST', {
        src_file_id: fileId,
        effects: [
          { category: 'lip_color', shape: { name: 'original' }, palettes: [{ color: lip, texture: 'matte', colorIntensity: 60 }], style: { type: 'full' } },
          { category: 'blush', pattern: { name: '1color1' }, palettes: [{ color: '#E88A8A', texture: 'matte', colorIntensity: 45 }] },
        ],
        version: '1.0',
      });
      if (task.status !== 200 || !task.json || !task.json.data || !task.json.data.task_id) {
        throw new Error(`task/makeup-vto failed (HTTP ${task.status}): ${(task.json && (task.json.error || task.json.error_code)) || task.raw}`);
      }
      const done = await pollTask('makeup-vto', task.json.data.task_id);
      const results = done.results || {};
      const urlOut = results.url || (Array.isArray(results) && results[0] && results[0].download_url) || null;
      if (!urlOut) throw new Error('makeup-vto finished without a result URL');
      return send(res, 200, { source: 'youcam', vto_url: urlOut });
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`SkinMirror listening on http://localhost:${PORT} (YouCam key ${KEY ? 'configured' : 'NOT set — sample mode only'})`);
});
