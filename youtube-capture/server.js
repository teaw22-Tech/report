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
      '--disable-web-security',
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
    page = await b.newPage();

    // Spoof real Chrome browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Upgrade-Insecure-Requests': '1',
    });

    await page.setViewportSize({ width: 1280, height: 720 });

    // Deep spoof — remove all automation fingerprints
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['th-TH', 'th', 'en-US', 'en'] });
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
      const origQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    });

    // Use clean URL — no extra params
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Dismiss consent/cookie popup
    try {
      const consentBtn = await page.waitForSelector(
        'button[aria-label="Reject all"], tp-yt-paper-button#button[aria-label="Reject all"], .eom-button-row button:first-child',
        { timeout: 3000 }
      );
      if (consentBtn) { await consentBtn.click(); await page.waitForTimeout(800); }
    } catch { /* no popup */ }

    // Click play if needed
    try {
      await page.click('button.ytp-large-play-button', { timeout: 4000 });
    } catch { /* autoplay or already playing */ }

    // Wait for video element to be ready
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
