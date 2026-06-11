const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { readAdsFromExcel, runCapture, buildPptx } = require('./lib/adcapture');

const PORT = process.env.PORT || 3000;
const WORK_DIR = path.join(__dirname, 'output', 'jobs');
fs.mkdirSync(WORK_DIR, { recursive: true });

const upload = multer({ dest: path.join(__dirname, 'output', 'uploads') });
const app = express();

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

  const waitSeconds = parseInt(req.body.waitSeconds || '8', 10);
  const jobDir = path.join(WORK_DIR, jobId);
  const shotsDir = path.join(jobDir, 'screenshots');

  try {
    const ads = readAdsFromExcel(req.file.path);
    sendEvent(job, { type: 'start', total: ads.length });

    const results = await runCapture(ads, shotsDir, waitSeconds, (p) => {
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

app.listen(PORT, () => {
  console.log(`Ads Capture UI: http://localhost:${PORT}`);
});
