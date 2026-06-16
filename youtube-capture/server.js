const express = require('express');
const { chromium } = require('playwright');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/capture', async (req, res) => {
  const { url } = req.body;

  if (!url || !isYouTubeUrl(url)) {
    return res.status(400).json({ error: 'กรุณาใส่ YouTube URL ที่ถูกต้อง' });
  }

  let browser;
  try {
    const embedUrl = toEmbedUrl(url);

    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });

    // Load embed with autoplay at t=5 and mute (required for autoplay)
    await page.goto(embedUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for video to reach ~5 seconds then screenshot
    await page.waitForTimeout(6000);

    const screenshot = await page.screenshot({ type: 'png' });
    await browser.close();

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'inline; filename="youtube-capture.png"');
    res.send(screenshot);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'ไม่สามารถแคปเจอร์ได้: ' + err.message });
  }
});

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'youtu.be';
  } catch {
    return false;
  }
}

function toEmbedUrl(url) {
  let videoId;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      videoId = u.pathname.slice(1);
    } else {
      videoId = u.searchParams.get('v');
    }
  } catch {
    return null;
  }
  if (!videoId) throw new Error('ไม่พบ Video ID จาก URL นี้');
  // autoplay=1, start=5, mute=1 required for autoplay in headless browser
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&start=5&mute=1`;
}

app.listen(PORT, () => {
  console.log(`YouTube Capture running on port ${PORT}`);
});
