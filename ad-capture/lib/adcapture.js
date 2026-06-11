// Core logic: อ่าน Excel, แคปภาพ, สร้าง PowerPoint
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const pptxgen = require('pptxgenjs');
const { chromium } = require('playwright');

const PLAY_BUTTON_SELECTORS = [
  '.ytp-large-play-button',
  '.vjs-big-play-button',
  'button[aria-label*="Play"]',
  'button[aria-label*="เล่น"]',
  '.video-play-button',
  '[class*="play-btn"]',
  '[class*="playBtn"]',
];

function readAdsFromExcel(filePath) {
  const wb = xlsx.readFile(filePath);
  const ads = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    rows.forEach((row, idx) => {
      const url = (row.URL || row.url || '').toString().trim();
      if (!url) return;

      const name = (row.NAME || row.Name || row.name || '').toString().trim();
      const type = (row.TYPE || row.Type || row.type || sheetName).toString().trim();

      ads.push({
        name: name || `${type} #${idx + 1}`,
        type,
        url,
        sheet: sheetName,
      });
    });
  }

  return ads;
}

// เช็คว่ามีวิดีโอกำลังเล่นอยู่ในหน้าไหม (รวมถึงใน iframe)
// ใส่ timeout กันเฟรมที่ค้าง/ตอบสนองช้าทำให้ loop ทั้งหมดหยุด
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

async function isVideoPlaying(page) {
  const check = async (frame) => {
    try {
      return await withTimeout(frame.evaluate(() => {
        const videos = document.querySelectorAll('video');
        for (const v of videos) {
          if (!v.paused && v.currentTime > 0 && !v.ended) return true;
        }
        return false;
      }), 2000);
    } catch (_) {
      return false;
    }
  };
  for (const frame of page.frames()) {
    if (await check(frame)) return true;
  }
  return false;
}

const MAX_WAIT_FOR_VIDEO_MS = 15000;
const FALLBACK_WAIT_MS = 6000;
const POLL_INTERVAL_MS = 1000;
const EXTRA_WAIT_AFTER_PLAY_MS = 2000;

const PER_AD_TIMEOUT_MS = 60000;

async function captureOne(browser, ad, index, shotsDir, controller, onTick) {
  const tick = (step) => { if (onTick) onTick(step); };

  const page = await browser.newPage({
    viewport: { width: 1024, height: 576 },
    ignoreHTTPSErrors: true,
  });

  if (controller) controller.currentPage = page;

  const fileName = `${String(index + 1).padStart(3, '0')}_${ad.type}.jpg`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(shotsDir, fileName);

  const run = async () => {
    tick('กำลังเปิดหน้าเว็บ...');
    await page.goto(ad.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    tick('กำลังหาปุ่มเล่นวิดีโอ...');
    for (const sel of PLAY_BUTTON_SELECTORS) {
      const btn = await page.$(sel);
      if (btn) {
        try { await btn.click({ timeout: 2000 }); } catch (_) {}
        break;
      }
    }

    // รอจนวิดีโอเริ่มเล่น (สูงสุด MAX_WAIT_FOR_VIDEO_MS) ถ้าไม่เจอเลยใช้เวลารอ fallback
    let playing = false;
    let waited = 0;
    while (waited < MAX_WAIT_FOR_VIDEO_MS) {
      tick(`กำลังตรวจสอบว่าโฆษณาเล่นหรือยัง... (${Math.round(waited / 1000)}s)`);
      if (await isVideoPlaying(page)) { playing = true; break; }
      await page.waitForTimeout(POLL_INTERVAL_MS);
      waited += POLL_INTERVAL_MS;
    }

    if (playing) {
      tick('โฆษณาเริ่มเล่นแล้ว กำลังรอให้นิ่ง...');
      await page.waitForTimeout(EXTRA_WAIT_AFTER_PLAY_MS);
    } else {
      tick('ไม่พบวิดีโอ กำลังรอเพิ่มเติม...');
      await page.waitForTimeout(FALLBACK_WAIT_MS);
    }

    tick('กำลังแคปภาพหน้าจอ...');
    await page.screenshot({ path: filePath, type: 'jpeg', quality: 70, timeout: 25000 });
  };

  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('รายการนี้ใช้เวลานานเกินไป (timeout)')), PER_AD_TIMEOUT_MS)),
    ]);
    await page.close();
    return { ...ad, screenshot: filePath, status: 'ok' };
  } catch (err) {
    await page.close().catch(() => {});
    return { ...ad, screenshot: null, status: 'error', error: err.message };
  }
}

async function runCapture(ads, shotsDir, onProgress, controller) {
  fs.mkdirSync(shotsDir, { recursive: true });

  const launchOptions = {
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--single-process',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--mute-audio',
      '--js-flags=--max-old-space-size=192',
    ],
  };
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }

  const results = [];
  for (let i = 0; i < ads.length; i++) {
    if (controller && controller.cancelled) break;

    const ad = ads[i];
    if (onProgress) onProgress({ index: i, total: ads.length, name: ad.name, status: 'running' });

    // เปิด/ปิด browser ใหม่ทุกรายการ เพื่อไม่ให้ memory สะสมจากรายการก่อนหน้า
    const browser = await chromium.launch(launchOptions);
    const result = await captureOne(browser, ad, i, shotsDir, controller, (step) => {
      if (onProgress) onProgress({ index: i, total: ads.length, name: ad.name, status: 'tick', step });
    });
    await browser.close().catch(() => {});

    results.push(result);
    if (onProgress) onProgress({ index: i, total: ads.length, name: ad.name, status: result.status, error: result.error });

    // คืนหน่วยความจำให้ node ก่อนเริ่มรายการถัดไป (ต้องรันด้วย --expose-gc)
    if (global.gc) global.gc();
  }

  return results;
}

async function buildPptx(results, outFile) {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  const cover = pptx.addSlide();
  cover.addText('Ads Capture Report', {
    x: 0.5, y: 2.8, w: 12, h: 1, fontSize: 36, bold: true, color: '1D9E75',
  });
  cover.addText(`สร้างเมื่อ: ${new Date().toLocaleString('th-TH')}\nจำนวนรายการ: ${results.length}`, {
    x: 0.5, y: 4, w: 12, h: 1, fontSize: 16, color: '666666',
  });

  for (const r of results) {
    const slide = pptx.addSlide();
    slide.addText(r.name, {
      x: 0.4, y: 0.25, w: 12.5, h: 0.6, fontSize: 20, bold: true, color: '222222',
    });
    slide.addText(`Type: ${r.type}`, {
      x: 0.4, y: 0.8, w: 12.5, h: 0.35, fontSize: 12, color: '888888',
    });

    if (r.status === 'ok' && r.screenshot && fs.existsSync(r.screenshot)) {
      slide.addImage({ path: r.screenshot, x: 0.6, y: 1.3, w: 9, h: 5.06 });
    } else {
      slide.addText(`แคปไม่สำเร็จ: ${r.error || 'ไม่ทราบสาเหตุ'}`, {
        x: 0.6, y: 2.5, w: 9, h: 1, fontSize: 14, color: 'CC0000',
      });
    }

    slide.addText(r.url, {
      x: 0.4, y: 6.6, w: 12.5, h: 0.6, fontSize: 9, color: '4A90D9',
      hyperlink: { url: r.url },
    });
  }

  await pptx.writeFile({ fileName: outFile });
  return outFile;
}

module.exports = { readAdsFromExcel, runCapture, buildPptx };
