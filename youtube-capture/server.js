const express = require('express');
const { chromium } = require('playwright');
const PptxGenJS = require('pptxgenjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let browser = null;
let browserReady = false;
let isProcessing = false;

async function getBrowser() {
  if (browser && browserReady) return browser;
  browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-blink-features=AutomationControlled',
      '--autoplay-policy=no-user-gesture-required',
      '--lang=th-TH',
    ],
  });
  browserReady = true;
  browser.on('disconnected', () => { browser = null; browserReady = false; });
  return browser;
}

async function safeGetBrowser() {
  try { return await getBrowser(); }
  catch { browser = null; browserReady = false; return await getBrowser(); }
}

async function captureOne(videoId) {
  const b = await safeGetBrowser();
  const page = await b.newPage();
  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['th-TH', 'th', 'en-US', 'en'] });
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    });

    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });

    // Dismiss consent popup
    try {
      const btn = await page.waitForSelector(
        'button[aria-label="Reject all"], .eom-button-row button:first-child',
        { timeout: 3000 }
      );
      if (btn) { await btn.click(); await page.waitForTimeout(600); }
    } catch { /* no popup */ }

    // Click play
    try {
      await page.click('button.ytp-large-play-button', { timeout: 4000 });
    } catch { /* autoplay */ }

    // Wait for video ready
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 2;
    }, { timeout: 15000 }).catch(() => {});

    // Seek to second 5
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { v.currentTime = 5; v.play().catch(() => {}); }
    });
    await page.waitForTimeout(1500);

    const screenshot = await page.screenshot({ type: 'png' });
    return { success: true, data: screenshot };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await page.close().catch(() => {});
  }
}

// --- Capture multiple + export PowerPoint ---
app.post('/capture-batch', async (req, res) => {
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'กรุณาใส่ URL อย่างน้อย 1 รายการ' });
  }
  if (urls.length > 10) {
    return res.status(400).json({ error: 'ใส่ได้สูงสุด 10 URL' });
  }

  const invalid = urls.filter(u => !isYouTubeUrl(u));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `URL ไม่ถูกต้อง: ${invalid[0]}` });
  }

  if (isProcessing) {
    return res.status(429).json({ error: 'ระบบกำลังประมวลผลอยู่ กรุณารอสักครู่' });
  }

  isProcessing = true;
  try {
    const results = [];
    for (const url of urls) {
      const videoId = extractVideoId(url);
      if (!videoId) { results.push({ url, success: false, error: 'ไม่พบ Video ID' }); continue; }
      const result = await captureOne(videoId);
      results.push({ url, videoId, ...result });
    }

    // Build PowerPoint — 16:9 slide per screenshot
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const slide = pptx.addSlide();
      slide.background = { color: '000000' };

      if (r.success && r.data) {
        const b64 = r.data.toString('base64');
        slide.addImage({
          data: `image/png;base64,${b64}`,
          x: 0, y: 0, w: '100%', h: '100%',
        });
        // Small label bottom-left
        slide.addText(`${i + 1}. youtu.be/${r.videoId}`, {
          x: 0.1, y: 6.8, w: 9, h: 0.3,
          fontSize: 9, color: 'ffffff', transparency: 40,
        });
      } else {
        slide.addText(`❌ Slide ${i + 1}: ${r.error || 'capture failed'}\n${r.url}`, {
          x: 0.5, y: 2.5, w: 9, h: 2,
          fontSize: 14, color: 'ff6b6b', align: 'center',
        });
      }
    }

    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.set('Content-Disposition', 'attachment; filename="youtube-captures.pptx"');
    res.send(pptxBuffer);
  } catch (err) {
    console.error('Batch error:', err.message);
    if (browser) { await browser.close().catch(() => {}); browser = null; browserReady = false; }
    res.status(500).json({ error: err.message });
  } finally {
    isProcessing = false;
  }
});

// Single capture (keep for compatibility)
app.post('/capture', async (req, res) => {
  const { url } = req.body;
  if (!url || !isYouTubeUrl(url)) return res.status(400).json({ error: 'กรุณาใส่ YouTube URL ที่ถูกต้อง' });
  if (isProcessing) return res.status(429).json({ error: 'ระบบกำลังประมวลผลอยู่' });

  isProcessing = true;
  try {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('ไม่พบ Video ID');
    const result = await captureOne(videoId);
    if (!result.success) throw new Error(result.error);
    res.set('Content-Type', 'image/png');
    res.send(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    isProcessing = false;
  }
});

app.get('/status', (req, res) => {
  res.json({ status: 'ok', browserReady, isProcessing });
});

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return ['www.youtube.com', 'youtube.com', 'youtu.be'].includes(u.hostname);
  } catch { return false; }
}

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    return u.searchParams.get('v');
  } catch { return null; }
}

app.listen(PORT, () => {
  console.log(`YouTube Capture running on port ${PORT}`);
  safeGetBrowser().then(() => console.log('Browser ready')).catch(console.error);
});
