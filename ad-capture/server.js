const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const basicAuth = require('express-basic-auth');
const xlsx = require('xlsx');
const { readAdsFromExcel, runCapture, buildPptx } = require('./lib/adcapture');

const PORT = process.env.PORT || 3000;
const WORK_DIR = path.join(__dirname, 'output', 'jobs');
fs.mkdirSync(WORK_DIR, { recursive: true });

const upload = multer({ dest: path.join(__dirname, 'output', 'uploads') });
const app = express();

// ตั้ง APP_USERNAME / APP_PASSWORD บน Render เพื่อล็อกหน้าเว็บนี้ด้วย username/password
if (process.env.APP_USERNAME && process.env.APP_PASSWORD) {
  app.use(basicAuth({
    users: { [process.env.APP_USERNAME]: process.env.APP_PASSWORD },
    challenge: true,
  }));
}

app.use(express.static(path.join(__dirname, 'public')));

// jobId -> { clients: Set<res>, log: [], done: bool, file: string|null, error: string|null }
const jobs = new Map();

function sendEvent(job, data) {
  job.log.push(data);
  for (const res of job.clients) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

app.post('/api/generate', upload.single('excel'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });

  const jobId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = { cancelled: false, currentPage: null };
  const job = { clients: new Set(), log: [], done: false, file: null, error: null, controller };
  jobs.set(jobId, job);
  res.json({ jobId });

  const jobDir = path.join(WORK_DIR, jobId);
  const shotsDir = path.join(jobDir, 'screenshots');

  try {
    const ads = readAdsFromExcel(req.file.path);
    sendEvent(job, { type: 'start', total: ads.length });

    const results = await runCapture(ads, shotsDir, (p) => {
      sendEvent(job, { type: 'progress', ...p });
    }, controller);

    const outFile = path.join(jobDir, 'Ads_Capture.pptx');
    await buildPptx(results, outFile);

    job.file = outFile;
    if (controller.cancelled) {
      sendEvent(job, { type: 'cancelled', downloadUrl: `/api/download/${jobId}` });
    } else {
      sendEvent(job, { type: 'done', downloadUrl: `/api/download/${jobId}` });
    }
  } catch (err) {
    job.error = err.message;
    sendEvent(job, { type: 'error', error: err.message });
  } finally {
    job.done = true;
    fs.unlink(req.file.path, () => {});
  }
});

app.post('/api/cancel/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  job.controller.cancelled = true;
  if (job.controller.currentPage) {
    job.controller.currentPage.close().catch(() => {});
  }
  res.json({ ok: true });
});

app.get('/api/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // ส่ง log ที่เกิดไปแล้วก่อน เผื่อ client เชื่อมต่อช้า
  for (const data of job.log) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  job.clients.add(res);
  req.on('close', () => job.clients.delete(res));
});

app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.file) return res.status(404).send('ไม่พบไฟล์');
  res.download(job.file, 'Ads_Capture.pptx');
});

// ── Client-side capture endpoints ──────────────────────────────────────────

// ── Capture session store (pass config via URL instead of localStorage) ─────
const captureSessions = new Map();

app.post('/api/capture-session', express.json({ limit: '5mb' }), (req, res) => {
  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  captureSessions.set(sessionId, req.body);
  setTimeout(() => captureSessions.delete(sessionId), 600000); // 10 min TTL
  res.json({ sessionId });
});

app.get('/api/capture-session/:id', (req, res) => {
  const data = captureSessions.get(req.params.id);
  if (!data) return res.status(404).json({ error: 'session not found or expired' });
  res.json(data); // ไม่ลบ เผื่อ retry
});

// รับ Excel → คืนรายการ {name, type, url} ให้ browser ทำ capture เอง
app.post('/api/parse-excel', upload.single('excel'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
  try {
    const ads = readAdsFromExcel(req.file.path);
    res.json({ ads });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// รับ screenshot base64 จาก browser → สร้าง PPTX → คืน download URL
app.post('/api/build-from-screenshots', express.json({ limit: '200mb' }), async (req, res) => {
  const { ads } = req.body;
  if (!Array.isArray(ads) || ads.length === 0) {
    return res.status(400).json({ error: 'ไม่พบข้อมูล ads' });
  }

  const jobId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const jobDir = path.join(WORK_DIR, jobId);
  const shotsDir = path.join(jobDir, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  try {
    const results = ads.map((ad, i) => {
      if (ad.screenshotB64) {
        const filePath = path.join(shotsDir,
          `${String(i + 1).padStart(3, '0')}_${ad.type}.jpg`.replace(/[^a-zA-Z0-9._-]/g, '_'));
        const data = ad.screenshotB64.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
        return { ...ad, screenshot: filePath, status: 'ok' };
      }
      return { ...ad, screenshot: null, status: 'error', error: ad.error || 'ไม่ได้รับภาพ' };
    });

    const outFile = path.join(jobDir, 'Ads_Capture.pptx');
    await buildPptx(results, outFile);
    jobs.set(jobId, { done: true, file: outFile, clients: new Set(), log: [] });
    res.json({ downloadUrl: `/api/download/${jobId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Excel template download ─────────────────────────────────────────────────
app.get('/api/template', (req, res) => {
  const rows = [
    { NAME: 'ตัวอย่าง Toyota Hilux', URL: 'https://www.youtube.com/watch?v=XXXXX01', TYPE: 'YouTube' },
    { NAME: 'ตัวอย่าง Honda Civic',  URL: 'https://www.youtube.com/watch?v=XXXXX02', TYPE: 'YouTube' },
    { NAME: '', URL: '', TYPE: 'YouTube' },
    { NAME: '', URL: '', TYPE: 'YouTube' },
    { NAME: '', URL: '', TYPE: 'YouTube' },
    { NAME: '', URL: '', TYPE: 'YouTube' },
    { NAME: '', URL: '', TYPE: 'YouTube' },
    { NAME: '', URL: '', TYPE: 'YouTube' },
    { NAME: '', URL: '', TYPE: 'YouTube' },
    { NAME: '', URL: '', TYPE: 'YouTube' },
  ];
  const ws = xlsx.utils.json_to_sheet(rows, { header: ['NAME', 'URL', 'TYPE'] });
  ws['!cols'] = [{ wch: 30 }, { wch: 80 }, { wch: 15 }];
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'YouTube Ads');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="Ads_Capture_Template.xlsx"',
  });
  res.send(buf);
});

app.listen(PORT, () => {
  console.log(`Ads Capture UI: http://localhost:${PORT}`);
});
