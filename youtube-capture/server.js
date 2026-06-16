const express = require('express');
const { chromium } = require('playwright');
const { mkdtemp, writeFile, rm } = require('fs/promises');
const path = require('path');
const os = require('os');
const multer = require('multer');
const XLSX = require('xlsx');
const PptxGenJS = require('pptxgenjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Cookies stored in memory
let cookiesContent = null;
let parsedCookies = [];
let isProcessing = false;

// ── Cookies upload ────────────────────────────────────────────
app.post('/upload-cookies', upload.single('cookies'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
  const text = req.file.buffer.toString('utf8');
  if (!text.includes('youtube.com')) return res.status(400).json({ error: 'ไม่ใช่ไฟล์ cookies ของ YouTube' });
  cookiesContent = text;
  parsedCookies = parseNetscapeCookies(text);
  res.json({ ok: true, count: parsedCookies.length });
});

app.get('/cookies-status', (req, res) => {
  res.json({ hasCookies: parsedCookies.length > 0 });
});

// Parse Netscape cookies.txt → Playwright cookie objects
function parseNetscapeCookies(text) {
  return text.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('youtube.com'))
    .map(l => {
      const p = l.split('\t');
      if (p.length < 7) return null;
      return {
        domain: p[0],
        path: p[2],
        secure: p[3] === 'TRUE',
        expires: parseInt(p[4]) || -1,
        name: p[5],
        value: p[6].trim(),
        httpOnly: false,
        sameSite: 'None',
      };
    })
    .filter(Boolean);
}

// ── Browser pool ──────────────────────────────────────────────
let browser = null;

async function getBrowser() {
  if (browser) return browser;
  browser = await chromium.launch({
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
      '--single-process',
      '--disable-blink-features=AutomationControlled',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  browser.on('disconnected', () => { browser = null; });
  return browser;
}

// ── Capture frame ─────────────────────────────────────────────
async function captureFrame(url) {
  const b = await getBrowser();

  // Create context with cookies injected
  const ctx = await b.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'th-TH',
    extraHTTPHeaders: { 'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8' },
  });

  if (parsedCookies.length > 0) {
    await ctx.addCookies(parsedCookies);
  }

  const page = await ctx.newPage();

  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Dismiss consent/cookie popup
    try {
      await page.click('button[aria-label="Reject all"]', { timeout: 3000 });
      await page.waitForTimeout(500);
    } catch {}

    // Click play button if present
    try {
      await page.click('button.ytp-large-play-button', { timeout: 5000 });
    } catch {}

    // Wait for video element
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 2;
    }, { timeout: 20000 }).catch(() => {});

    // Seek to second 5
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { v.muted = true; v.currentTime = 5; v.play().catch(() => {}); }
    });

    await page.waitForTimeout(1500);

    // Crop to video element only (removes YouTube UI chrome)
    const videoEl = await page.$('video');
    let screenshot;
    if (videoEl) {
      const box = await videoEl.boundingBox();
      if (box && box.width > 100 && box.height > 100) {
        screenshot = await page.screenshot({
          type: 'png',
          clip: { x: box.x, y: box.y, width: box.width, height: box.height },
        });
      }
    }
    if (!screenshot) screenshot = await page.screenshot({ type: 'png' });

    return { success: true, data: screenshot };
  } catch (err) {
    console.error('captureFrame error:', err.message);
    return { success: false, error: err.message };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// ── Routes ────────────────────────────────────────────────────
app.post('/capture-single', async (req, res) => {
  const { url } = req.body;
  if (!url || !isYouTubeUrl(url)) return res.status(400).json({ error: 'URL ไม่ถูกต้อง' });
  if (isProcessing) return res.status(429).json({ error: 'ระบบกำลังประมวลผลอยู่ กรุณารอ' });

  isProcessing = true;
  try {
    const result = await captureFrame(url);
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json({ image: result.data.toString('base64') });
  } finally {
    isProcessing = false;
  }
});

app.post('/build-pptx', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'ไม่มีข้อมูล' });

  try {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';

    for (let i = 0; i < items.length; i++) {
      const { url, name, image, error } = items[i];
      const slide = pptx.addSlide();
      slide.background = { color: '000000' };

      if (image) {
        slide.addImage({ data: `image/png;base64,${image}`, x: 0, y: 0, w: '100%', h: '100%' });
        if (name) {
          slide.addText(name, {
            x: 0.15, y: 0.12, w: 9, h: 0.4,
            fontSize: 13, bold: true, color: 'ffffff',
            shadow: { type: 'outer', blur: 4, offset: 1, color: '000000' },
          });
        }
        slide.addText(`${i + 1}. ${name || url}`, {
          x: 0.1, y: 6.75, w: 9.8, h: 0.3,
          fontSize: 8, color: 'ffffff', transparency: 45,
        });
      } else {
        slide.addText(
          `❌ Slide ${i + 1}${name ? ' — ' + name : ''}\n${error || 'capture failed'}\n\n${url}`,
          { x: 0.5, y: 2.2, w: 9, h: 2.5, fontSize: 13, color: 'ff6b6b', align: 'center', breakLine: true }
        );
      }
    }

    const buf = await pptx.write({ outputType: 'nodebuffer' });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.set('Content-Disposition', 'attachment; filename="youtube-captures.pptx"');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excel template
app.get('/template', (req, res) => {
  const wb = XLSX.utils.book_new();
  const data = [
    ['#', 'Name', 'YouTube URL'],
    ...[...Array(10)].map((_, i) => [i + 1, '', '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 4 }, { wch: 30 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, ws, 'YouTube URLs');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="youtube-capture-template.xlsx"');
  res.send(buf);
});

// Excel upload
app.post('/parse-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const items = rows.slice(1)
      .map(r => ({ name: String(r[1] || '').trim(), url: String(r[2] || '').trim() }))
      .filter(r => r.url && isYouTubeUrl(r.url))
      .slice(0, 10);
    if (!items.length) return res.status(400).json({ error: 'ไม่พบ YouTube URL (คอลัมน์ C)' });
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/status', (req, res) => res.json({ status: 'ok', isProcessing, hasCookies: parsedCookies.length > 0 }));

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return ['www.youtube.com', 'youtube.com', 'youtu.be'].includes(u.hostname);
  } catch { return false; }
}

app.listen(PORT, () => {
  console.log(`YouTube Capture running on port ${PORT}`);
  getBrowser().then(() => console.log('Browser ready')).catch(console.error);
});
