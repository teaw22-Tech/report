const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { mkdtemp, readFile, rm, writeFile } = require('fs/promises');
const path = require('path');
const os = require('os');
const multer = require('multer');
const XLSX = require('xlsx');
const PptxGenJS = require('pptxgenjs');

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;

// Cookies stored in memory (survives until server restarts)
let cookiesContent = null;
const COOKIES_PATH = path.join(os.tmpdir(), 'yt_cookies.txt');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
let isProcessing = false;

// Upload YouTube cookies.txt
app.post('/upload-cookies', upload.single('cookies'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
  const text = req.file.buffer.toString('utf8');
  if (!text.includes('youtube.com')) return res.status(400).json({ error: 'ไม่ใช่ไฟล์ cookies ของ YouTube' });
  cookiesContent = text;
  await writeFile(COOKIES_PATH, text, 'utf8');
  res.json({ ok: true, message: 'อัปโหลด cookies สำเร็จ' });
});

app.get('/cookies-status', (req, res) => {
  res.json({ hasCookies: !!cookiesContent });
});

// Download Excel template
app.get('/template', (req, res) => {
  const wb = XLSX.utils.book_new();
  const data = [
    ['#', 'Name', 'YouTube URL'],
    [1, '', ''],
    [2, '', ''],
    [3, '', ''],
    [4, '', ''],
    [5, '', ''],
    [6, '', ''],
    [7, '', ''],
    [8, '', ''],
    [9, '', ''],
    [10, '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);

  ws['!cols'] = [{ wch: 4 }, { wch: 30 }, { wch: 55 }];
  ws['A1'].v = '#';
  ws['B1'].v = 'Name';
  ws['C1'].v = 'YouTube URL';

  XLSX.utils.book_append_sheet(wb, ws, 'YouTube URLs');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="youtube-capture-template.xlsx"');
  res.send(buf);
});

// Upload Excel → parse URLs
app.post('/parse-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Skip header row: col B = Name (index 1), col C = URL (index 2)
    const items = rows.slice(1)
      .map(r => ({ name: String(r[1] || '').trim(), url: String(r[2] || '').trim() }))
      .filter(r => r.url && isYouTubeUrl(r.url))
      .slice(0, 10);

    if (items.length === 0) return res.status(400).json({ error: 'ไม่พบ YouTube URL ในไฟล์ (คอลัมน์ C)' });

    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: 'อ่านไฟล์ไม่ได้: ' + err.message });
  }
});

// Capture a single frame at second 5 using yt-dlp + ffmpeg
async function captureFrame(rawUrl) {
  // Strip all extra params — keep only ?v=VIDEO_ID (handles force_ad_encrypted etc.)
  const cleanUrl = cleanYouTubeUrl(rawUrl);
  console.log(`Capturing: ${rawUrl} → cleaned: ${cleanUrl}`);

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ytcap-'));
  const videoPath = path.join(tmpDir, 'clip.%(ext)s');
  const outPath = path.join(tmpDir, 'frame.png');
  try {
    if (cookiesContent) {
      await writeFile(COOKIES_PATH, cookiesContent, 'utf8');
    }

    const clients = ['ios', 'android,web', 'tv_embedded', 'web'];
    let downloaded = false;
    let lastError = '';

    for (const client of clients) {
      try {
        const args = [
          '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
          '--no-playlist',
          '--extractor-args', `youtube:player_client=${client}`,
          '--download-sections', '*4-9',
          '--force-keyframes-at-cuts',
          '-o', videoPath,
          '--no-warnings',
          '--no-part',
        ];
        if (cookiesContent) args.push('--cookies', COOKIES_PATH);
        args.push(cleanUrl);

        const { stderr } = await execFileAsync('yt-dlp', args, {
          timeout: 90000,
          encoding: 'utf8',
        }).catch(e => { throw new Error(e.stderr || e.message); });

        downloaded = true;
        console.log(`Success with client: ${client}`);
        break;
      } catch (e) {
        lastError = e.message;
        console.log(`Client ${client} failed: ${e.message.slice(0, 200)}`);
      }
    }

    if (!downloaded) {
      // Show meaningful error
      const msg = lastError.includes('Sign in') || lastError.includes('bot')
        ? 'YouTube ต้องการ login — cookies อาจหมดอายุ กรุณาอัปโหลด cookies.txt ใหม่'
        : lastError.includes('not available') || lastError.includes('private')
        ? 'วิดีโอนี้ไม่สามารถดาวน์โหลดได้ (private/ถูกลบ)'
        : `yt-dlp error: ${lastError.slice(0, 300)}`;
      throw new Error(msg);
    }

    // Find the downloaded file (extension may vary)
    const { readdir } = require('fs/promises');
    const files = await readdir(tmpDir);
    const videoFile = files.find(f => f.startsWith('clip.') && f !== 'frame.png');
    if (!videoFile) throw new Error('ไม่พบไฟล์วิดีโอที่ดาวน์โหลด');

    // Extract frame at 1s into clip (= ~second 5 of original)
    await execFileAsync('ffmpeg', [
      '-i', path.join(tmpDir, videoFile),
      '-ss', '1',
      '-vframes', '1',
      '-vf', 'scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:black',
      '-y', outPath,
    ], { timeout: 30000 });

    const data = await readFile(outPath);
    return { success: true, data };
  } catch (err) {
    console.error('captureFrame error:', err.message);
    return { success: false, error: err.message };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// Clean YouTube URL — strip all params except v=
function cleanYouTubeUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return `https://youtu.be${u.pathname}`;
    }
    const v = u.searchParams.get('v');
    if (v) return `https://www.youtube.com/watch?v=${v}`;
    return url;
  } catch { return url; }
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
      const { url, name, image, error } = items[i];
      const label = name ? `${i + 1}. ${name}` : `${i + 1}. ${url}`;
      const slide = pptx.addSlide();
      slide.background = { color: '000000' };

      if (image) {
        slide.addImage({ data: `image/png;base64,${image}`, x: 0, y: 0, w: '100%', h: '100%' });
        // Name label top-left
        if (name) {
          slide.addText(name, {
            x: 0.15, y: 0.12, w: 9, h: 0.4,
            fontSize: 13, bold: true, color: 'ffffff',
            shadow: { type: 'outer', blur: 4, offset: 1, color: '000000' },
          });
        }
        // URL label bottom
        slide.addText(label, {
          x: 0.1, y: 6.75, w: 9.8, h: 0.3,
          fontSize: 8, color: 'ffffff', transparency: 45,
        });
      } else {
        slide.addText(`❌ Slide ${i + 1}${name ? ' — ' + name : ''}\n${error || 'capture failed'}\n\n${url}`, {
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
