const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { mkdtemp, readFile, rm } = require('fs/promises');
const path = require('path');
const os = require('os');
const PptxGenJS = require('pptxgenjs');

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let isProcessing = false;

// Capture a single frame at second 5 using yt-dlp + ffmpeg
async function captureFrame(url) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ytcap-'));
  const outPath = path.join(tmpDir, 'frame.png');
  try {
    // Step 1: get direct video stream URL from yt-dlp
    const { stdout } = await execFileAsync('yt-dlp', [
      '--get-url',
      '-f', 'best[ext=mp4]/best',
      '--no-playlist',
      url,
    ], { timeout: 30000 });

    const streamUrl = stdout.trim().split('\n')[0];
    if (!streamUrl) throw new Error('yt-dlp ไม่สามารถดึง stream URL ได้');

    // Step 2: use ffmpeg to extract frame at second 5
    await execFileAsync('ffmpeg', [
      '-ss', '5',
      '-i', streamUrl,
      '-vframes', '1',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
      '-y',
      outPath,
    ], { timeout: 60000 });

    const data = await readFile(outPath);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// Batch capture → PowerPoint
app.post('/capture-batch', async (req, res) => {
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0)
    return res.status(400).json({ error: 'กรุณาใส่ URL อย่างน้อย 1 รายการ' });
  if (urls.length > 10)
    return res.status(400).json({ error: 'ใส่ได้สูงสุด 10 URL' });

  const invalid = urls.filter(u => !isYouTubeUrl(u));
  if (invalid.length > 0)
    return res.status(400).json({ error: `URL ไม่ถูกต้อง: ${invalid[0]}` });

  if (isProcessing)
    return res.status(429).json({ error: 'ระบบกำลังประมวลผลอยู่ กรุณารอสักครู่' });

  isProcessing = true;
  try {
    const results = [];
    for (const url of urls) {
      console.log('Capturing:', url);
      const result = await captureFrame(url);
      results.push({ url, ...result });
    }

    // Build PowerPoint
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const slide = pptx.addSlide();
      slide.background = { color: '000000' };

      if (r.success && r.data) {
        slide.addImage({
          data: `image/png;base64,${r.data.toString('base64')}`,
          x: 0, y: 0, w: '100%', h: '100%',
        });
        slide.addText(`${i + 1}. ${r.url}`, {
          x: 0.1, y: 6.8, w: 9.8, h: 0.3,
          fontSize: 8, color: 'ffffff', transparency: 50,
        });
      } else {
        slide.addText(`❌ Slide ${i + 1}\n${r.error || 'capture failed'}\n\n${r.url}`, {
          x: 0.5, y: 2.2, w: 9, h: 2.5,
          fontSize: 13, color: 'ff6b6b', align: 'center', breakLine: true,
        });
      }
    }

    const buf = await pptx.write({ outputType: 'nodebuffer' });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.set('Content-Disposition', 'attachment; filename="youtube-captures.pptx"');
    res.send(buf);
  } catch (err) {
    console.error('Batch error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    isProcessing = false;
  }
});

// Single capture → base64 JSON (for preview)
app.post('/capture-single', async (req, res) => {
  const { url } = req.body;
  if (!url || !isYouTubeUrl(url))
    return res.status(400).json({ error: 'URL ไม่ถูกต้อง' });
  if (isProcessing)
    return res.status(429).json({ error: 'ระบบกำลังประมวลผลอยู่ กรุณารอ' });

  isProcessing = true;
  try {
    const result = await captureFrame(url);
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json({ image: result.data.toString('base64') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    isProcessing = false;
  }
});

// Build PPTX from pre-captured base64 images (no re-capture)
app.post('/build-pptx', async (req, res) => {
  const { items } = req.body; // [{ url, image: base64|null, error }]
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'ไม่มีข้อมูลสำหรับสร้าง PowerPoint' });

  try {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';

    for (let i = 0; i < items.length; i++) {
      const { url, image, error } = items[i];
      const slide = pptx.addSlide();
      slide.background = { color: '000000' };

      if (image) {
        slide.addImage({ data: `image/png;base64,${image}`, x: 0, y: 0, w: '100%', h: '100%' });
        slide.addText(`${i + 1}. ${url}`, {
          x: 0.1, y: 6.8, w: 9.8, h: 0.3,
          fontSize: 8, color: 'ffffff', transparency: 50,
        });
      } else {
        slide.addText(`❌ Slide ${i + 1}\n${error || 'capture failed'}\n\n${url}`, {
          x: 0.5, y: 2.2, w: 9, h: 2.5,
          fontSize: 13, color: 'ff6b6b', align: 'center', breakLine: true,
        });
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

app.get('/status', (req, res) => {
  res.json({ status: 'ok', isProcessing });
});

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return ['www.youtube.com', 'youtube.com', 'youtu.be'].includes(u.hostname);
  } catch { return false; }
}

app.listen(PORT, () => console.log(`YouTube Capture running on port ${PORT}`));
