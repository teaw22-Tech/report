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

app.use(express.json({ limit: '50mb' }));
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
  const { expired, expiredNames } = checkCookiesExpiry(parsedCookies);
  res.json({ ok: true, count: parsedCookies.length, expired, expiredNames });
});

app.get('/cookies-status', (req, res) => {
  if (parsedCookies.length === 0) return res.json({ hasCookies: false });
  const { expired, expiredNames, soonNames } = checkCookiesExpiry(parsedCookies);
  res.json({ hasCookies: true, expired, expiredNames, soonNames });
});

// Check if key session cookies are expired
function checkCookiesExpiry(cookies) {
  const now = Math.floor(Date.now() / 1000);
  const KEY_COOKIES = ['SAPISID', 'SSID', 'SID', 'HSID', '__Secure-3PSID', '__Secure-1PSID'];
  const expiredNames = [];
  const soonNames = []; // expire within 7 days
  for (const c of cookies) {
    if (c.expires && c.expires > 0) {
      if (c.expires < now) {
        if (KEY_COOKIES.includes(c.name)) expiredNames.push(c.name);
      } else if (c.expires < now + 7 * 86400) {
        if (KEY_COOKIES.includes(c.name)) soonNames.push(c.name);
      }
    }
  }
  return { expired: expiredNames.length > 0, expiredNames, soonNames };
}

// Parse Netscape cookies.txt → Playwright cookie objects
function parseNetscapeCookies(text) {
  const cookies = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const p = l.split('\t');
    if (p.length < 7) continue;
    const domain = p[0].trim();
    if (!domain.includes('youtube.com') && !domain.includes('google.com')) continue;
    const expires = parseInt(p[4]);
    cookies.push({
      domain,
      path: p[2] || '/',
      secure: p[3] === 'TRUE',
      expires: isNaN(expires) ? -1 : expires,
      name: p[5].trim(),
      value: p[6].trim(),
      httpOnly: false,
      sameSite: 'None',
    });
  }
  console.log(`Parsed ${cookies.length} cookies`);
  return cookies;
}

// ── Browser pool ──────────────────────────────────────────────
let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = null;
  browser = await chromium.launch({
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // Use SwiftShader software GPU so video can decode without real GPU
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-blink-features=AutomationControlled',
      '--autoplay-policy=no-user-gesture-required',
      // Fix ALSA/audio errors on headless server
      '--use-fake-audio-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--disable-audio-output',
      '--disable-features=IsolateOrigins,site-per-process,AudioServiceOutOfProcess',
      '--mute-audio',
      // Stability
      '--no-first-run',
      '--no-zygote',
    ],
  });
  browser.on('disconnected', () => { browser = null; });
  return browser;
}

// ── Capture frame ─────────────────────────────────────────────
async function captureFrame(url) {
  let b;
  try { b = await getBrowser(); }
  catch (e) { return { success: false, error: 'Browser launch failed: ' + e.message }; }

  const ctx = await b.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    extraHTTPHeaders: {
      'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  // Inject cookies BEFORE opening page
  if (parsedCookies.length > 0) {
    try {
      await ctx.addCookies(parsedCookies);
      console.log(`Injected ${parsedCookies.length} cookies`);
    } catch (e) {
      console.error('Cookie inject error:', e.message);
    }
  } else {
    console.warn('No cookies available — bot detection likely');
  }

  const page = await ctx.newPage();

  try {
    // Deep anti-detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['th-TH', 'th', 'en-US'] });
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (p) =>
        p.name === 'notifications' ? Promise.resolve({ state: 'denied' }) : origQuery(p);
    });

    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Dismiss consent popup quickly
    try { await page.click('button[aria-label="Reject all"]', { timeout: 2000 }); } catch {}

    // Let page render for 2 seconds max then try video
    await page.waitForTimeout(2000);

    // Check video state immediately
    const videoState = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return { found: false, readyState: 0, videoWidth: 0 };
      v.muted = true; v.volume = 0;
      v.play().catch(() => {});
      return { found: true, readyState: v.readyState, videoWidth: v.videoWidth, networkState: v.networkState };
    });
    console.log('Video state after 2s:', JSON.stringify(videoState));

    let frameBase64 = null;

    if (videoState.found && videoState.videoWidth > 0) {
      // Video already has frame data — seek to second 5 and capture
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v) { v.muted = true; v.currentTime = 5; }
      });
      await page.waitForTimeout(800);
      const videoEl = await page.$('video');
      if (videoEl) {
        const buf = await videoEl.screenshot({ type: 'png' });
        frameBase64 = buf.toString('base64');
        console.log('Captured video frame directly');
      }
    } else if (videoState.found && videoState.readyState < 2) {
      // Video element exists but loading — wait up to 8s more for data
      await page.waitForFunction(() => {
        const v = document.querySelector('video');
        return v && v.readyState >= 2 && v.videoWidth > 0;
      }, { timeout: 8000 }).catch(() => {});
      const hasFrame = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v && v.videoWidth > 0;
      });
      if (hasFrame) {
        await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.currentTime = 5; } });
        await page.waitForTimeout(800);
        const videoEl = await page.$('video');
        if (videoEl) {
          const buf = await videoEl.screenshot({ type: 'png' });
          frameBase64 = buf.toString('base64');
          console.log('Captured video frame after wait');
        }
      }
    }

    // Fallback: full page screenshot (shows bot page, sign-in, or whatever YouTube is displaying)
    if (!frameBase64) {
      console.log('Fallback: page screenshot (video not available)');
      const buf = await page.screenshot({ type: 'png' });
      frameBase64 = buf.toString('base64');
    }

    if (!frameBase64) throw new Error('ไม่สามารถดึง frame จากวิดีโอได้ — วิดีโออาจไม่โหลด หรือ cookies หมดอายุ');

    return { success: true, data: Buffer.from(frameBase64, 'base64') };
  } catch (err) {
    console.error('captureFrame error:', err.message);
    // Kill browser on error so next request gets fresh one
    if (browser) { await browser.close().catch(() => {}); browser = null; }
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
  } catch (err) {
    console.error('capture-single error:', err.message);
    // Always return JSON even on unexpected crash
    if (!res.headersSent) res.status(500).json({ error: err.message });
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
    pptx.layout = 'LAYOUT_16x9'; // 10" × 5.625"

    const W = 10, H = 5.625;
    const now = new Date().toLocaleDateString('th-TH', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    // ── Cover slide ──────────────────────────────────────────
    const cover = pptx.addSlide();
    cover.background = { color: '0A0A1E' };

    // Decorative top bar
    cover.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: W, h: 0.06, fill: { color: '4682E6' },
    });

    // Title
    cover.addText('AD CAPTURE REPORT', {
      x: 0.5, y: 1.6, w: W - 1, h: 0.9,
      fontSize: 36, bold: true, color: '4682E6', align: 'center',
    });

    // Divider line
    cover.addShape(pptx.ShapeType.rect, {
      x: 2.5, y: 2.65, w: 5, h: 0.03, fill: { color: '4682E6' }, line: { color: '4682E6' },
    });

    // Subtitle
    cover.addText(`Total Ads Captured: ${items.length}`, {
      x: 0.5, y: 2.85, w: W - 1, h: 0.45,
      fontSize: 18, color: 'B4C8FF', align: 'center',
    });

    // Date
    cover.addText(`Generated: ${now}`, {
      x: 0.5, y: 3.45, w: W - 1, h: 0.35,
      fontSize: 12, color: '788CB4', align: 'center',
    });

    // Footer
    cover.addText('YouTube Ad Capture System  •  Confidential', {
      x: 0, y: H - 0.3, w: W, h: 0.28,
      fontSize: 8, color: '2A3450', align: 'center',
    });

    // ── Content slides ────────────────────────────────────────
    // Layout (10" × 5.625"):
    // Header bar: full width, h=0.6"
    // Left image area: x=0.2, y=0.72, w=6.4, h=4.3
    // Right panel: x=6.8, y=0.72, w=3.0, h=4.3
    // Footer: y=5.3

    const HDR_H = 0.6;
    const IMG_X = 0.2, IMG_Y = 0.72, IMG_W = 6.4, IMG_H = 4.28;
    const RX = 6.8, RY = 0.72, RW = 3.0;

    for (let i = 0; i < items.length; i++) {
      const { url, name, image, error } = items[i];
      const slide = pptx.addSlide();
      slide.background = { color: '080819' };

      // ── Header bar ──
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: W, h: HDR_H,
        fill: { color: '14285A' },
        line: { color: '4682E6', pt: 1.5 },
      });

      // Slide number badge
      slide.addText(`#${String(i + 1).padStart(2, '0')}`, {
        x: 0.1, y: 0.05, w: 0.9, h: HDR_H - 0.1,
        fontSize: 20, bold: true, color: '4682E6', valign: 'middle', align: 'center',
      });

      // Ad name in header
      slide.addText(name || `Ad ${i + 1}`, {
        x: 1.1, y: 0.08, w: W - 1.3, h: HDR_H - 0.16,
        fontSize: 14, bold: true, color: 'DCEBFF', valign: 'middle',
      });

      // ── Screenshot box ──
      // Outer frame
      slide.addShape(pptx.ShapeType.rect, {
        x: IMG_X - 0.04, y: IMG_Y - 0.04,
        w: IMG_W + 0.08, h: IMG_H + 0.08,
        fill: { color: '14285A' },
        line: { color: '4682E6', pt: 1.5 },
      });

      if (image) {
        slide.addImage({
          data: `image/png;base64,${image}`,
          x: IMG_X, y: IMG_Y, w: IMG_W, h: IMG_H,
          sizing: { type: 'contain', x: IMG_X, y: IMG_Y, w: IMG_W, h: IMG_H },
        });
      } else {
        slide.addText(`❌\n${error || 'capture failed'}`, {
          x: IMG_X, y: IMG_Y, w: IMG_W, h: IMG_H,
          fontSize: 12, color: 'f87171', align: 'center', valign: 'middle', breakLine: true,
        });
      }

      // ── Right panel ──
      // Section divider
      slide.addShape(pptx.ShapeType.rect, {
        x: RX - 0.04, y: IMG_Y - 0.04,
        w: RW + 0.04, h: IMG_H + 0.08,
        fill: { color: '0D1530' },
        line: { color: '1E3060', pt: 1 },
      });

      // "● AD NAME" label
      slide.addText('● AD NAME', {
        x: RX + 0.12, y: RY + 0.1, w: RW - 0.2, h: 0.28,
        fontSize: 8, bold: true, color: 'C85032',
      });
      slide.addText(name || '—', {
        x: RX + 0.12, y: RY + 0.38, w: RW - 0.2, h: 0.5,
        fontSize: 11, bold: true, color: 'FFFFFF',
        wrap: true,
      });

      // Divider
      slide.addShape(pptx.ShapeType.rect, {
        x: RX + 0.1, y: RY + 1.0, w: RW - 0.2, h: 0.02,
        fill: { color: '1E3060' }, line: { color: '1E3060' },
      });

      // "AD URL" label
      slide.addText('● AD URL', {
        x: RX + 0.12, y: RY + 1.1, w: RW - 0.2, h: 0.28,
        fontSize: 8, bold: true, color: '648CDC',
      });
      slide.addText(url, {
        x: RX + 0.12, y: RY + 1.38, w: RW - 0.2, h: 1.5,
        fontSize: 5, color: '96B4E6',
        wrap: true, hyperlink: { url },
      });

      // Divider
      slide.addShape(pptx.ShapeType.rect, {
        x: RX + 0.1, y: RY + 3.0, w: RW - 0.2, h: 0.02,
        fill: { color: '1E3060' }, line: { color: '1E3060' },
      });

      // "Ad X of Y" counter
      slide.addText(`Ad ${i + 1} of ${items.length}`, {
        x: RX + 0.12, y: RY + 3.1, w: RW - 0.2, h: 0.35,
        fontSize: 10, color: '50648C',
      });

      // Footer
      slide.addText('YouTube Ad Capture System  •  Confidential', {
        x: 0, y: H - 0.3, w: W, h: 0.28,
        fontSize: 7, color: '323C5A', align: 'center',
      });
    }

    const buf = await pptx.write({ outputType: 'nodebuffer' });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.set('Content-Disposition', 'attachment; filename="youtube-captures.pptx"');
    res.send(buf);
  } catch (err) {
    console.error('build-pptx error:', err.message);
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
