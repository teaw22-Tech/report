const express = require('express');
const { chromium } = require('playwright');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let browser = null;
let browserReady = false;
let queue = 0;
const MAX_QUEUE = 3;

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
    ],
  });
  browserReady = true;
  browser.on('disconnected', () => {
    browser = null;
    browserReady = false;
  });
  return browser;
}

async function safeGetBrowser() {
  try { return await getBrowser(); }
  catch { browser = null; browserReady = false; return await getBrowser(); }
}

app.post('/capture', async (req, res) => {
  const { url } = req.body;

  if (!url || !isYouTubeUrl(url)) {
    return res.status(400).json({ error: 'กรุณาใส่ YouTube URL ที่ถูกต้อง' });
  }
  if (queue >= MAX_QUEUE) {
    return res.status(429).json({ error: `ระบบกำลังประมวลผล ${queue} คำขออยู่ กรุณารอสักครู่` });
  }

  queue++;
  let page;
  try {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('ไม่พบ Video ID จาก URL นี้');

    const b = await safeGetBrowser();

    // Use persistent context to allow autoplay
    page = await b.newPage();

    // Spoof real browser headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
    });
    await page.setViewportSize({ width: 1280, height: 720 });

    // Hide automation fingerprints
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // Go to embed URL — more reliable for autoplay than watch page
    const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&start=5&mute=1&controls=0&modestbranding=1`;
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Try clicking play button in case autoplay is blocked
    try {
      await page.click('button.ytp-large-play-button', { timeout: 3000 });
    } catch { /* no play button visible, autoplay likely worked */ }

    // Wait for video frame to render (not black)
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video && video.readyState >= 2 && !video.paused;
    }, { timeout: 15000 }).catch(() => {});

    // Seek to exactly second 5
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) v.currentTime = 5;
    });

    // Brief wait for frame to render after seek
    await page.waitForTimeout(1500);

    const screenshot = await page.screenshot({ type: 'png' });

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'inline; filename="youtube-capture.png"');
    res.send(screenshot);
  } catch (err) {
    console.error('Capture error:', err.message);
    if (browser) { await browser.close().catch(() => {}); browser = null; browserReady = false; }
    res.status(500).json({ error: 'ไม่สามารถแคปเจอร์ได้: ' + err.message });
  } finally {
    if (page) await page.close().catch(() => {});
    queue--;
  }
});

app.get('/status', (req, res) => {
  res.json({ status: 'ok', browserReady, queue, maxQueue: MAX_QUEUE });
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
