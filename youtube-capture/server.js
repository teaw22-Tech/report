const express = require('express');
const { chromium } = require('playwright');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Browser pool (single shared instance for free tier RAM) ---
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
      '--single-process',       // saves ~80MB on free tier
      '--disable-extensions',
    ],
  });
  browserReady = true;
  browser.on('disconnected', () => {
    browser = null;
    browserReady = false;
  });
  return browser;
}

// Gracefully restart browser if it crashes
async function safeGetBrowser() {
  try {
    return await getBrowser();
  } catch {
    browser = null;
    browserReady = false;
    return await getBrowser();
  }
}

// --- Routes ---
app.post('/capture', async (req, res) => {
  const { url } = req.body;

  if (!url || !isYouTubeUrl(url)) {
    return res.status(400).json({ error: 'กรุณาใส่ YouTube URL ที่ถูกต้อง' });
  }

  if (queue >= MAX_QUEUE) {
    return res.status(429).json({ error: `ระบบกำลังประมวลผล ${queue} คำขออยู่ กรุณารอสักครู่แล้วลองใหม่` });
  }

  queue++;
  let page;
  try {
    const embedUrl = toEmbedUrl(url);
    const b = await safeGetBrowser();
    page = await b.newPage();

    await page.setViewportSize({ width: 1280, height: 720 });

    // Block unnecessary resources to save bandwidth & speed up load
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['font', 'stylesheet'].includes(type)) return route.abort();
      route.continue();
    });

    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Wait for video to reach second 5 (embed starts at t=5, give buffer)
    await page.waitForTimeout(6500);

    const screenshot = await page.screenshot({ type: 'png' });

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'inline; filename="youtube-capture.png"');
    res.send(screenshot);
  } catch (err) {
    console.error('Capture error:', err.message);
    // Kill browser on error so next request gets a fresh one
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      browserReady = false;
    }
    res.status(500).json({ error: 'ไม่สามารถแคปเจอร์ได้: ' + err.message });
  } finally {
    if (page) await page.close().catch(() => {});
    queue--;
  }
});

// Health check + current queue status
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    browserReady,
    queue,
    maxQueue: MAX_QUEUE,
  });
});

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return ['www.youtube.com', 'youtube.com', 'youtu.be'].includes(u.hostname);
  } catch {
    return false;
  }
}

function toEmbedUrl(url) {
  let videoId;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      videoId = u.pathname.slice(1).split('?')[0];
    } else {
      videoId = u.searchParams.get('v');
    }
  } catch {
    throw new Error('URL ไม่ถูกต้อง');
  }
  if (!videoId) throw new Error('ไม่พบ Video ID จาก URL นี้');
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&start=5&mute=1`;
}

app.listen(PORT, () => {
  console.log(`YouTube Capture running on port ${PORT}`);
  // Warm up browser on start
  safeGetBrowser().then(() => console.log('Browser ready')).catch(console.error);
});
