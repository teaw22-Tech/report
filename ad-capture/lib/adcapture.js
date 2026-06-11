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

// ปุ่มยอมรับ cookie/popup ที่มักบังหน้าจอก่อนแคปภาพ
const COOKIE_CONSENT_SELECTORS = [
  'button[aria-label*="Accept"]',
  'button[aria-label*="ยอมรับ"]',
  '#onetrust-accept-btn-handler',
  '.onetrust-close-btn-handler',
  '[class*="cookie"] button',
  '[class*="consent"] button',
  'text=Accept',
  'text=ยอมรับ',
  'text=Got it',
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

// คล้าย withTimeout แต่ throw error ออกมาแทนที่จะคืนค่า false (ใช้กับขั้นตอนที่ห้ามค้าง)
function withTimeoutOrThrow(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

const LAUNCH_TIMEOUT_MS = 30000;

// โหลด session ที่ login ไว้แล้ว (ถ้ามี)
// วิธีที่ 1 (แนะนำ): อัปโหลด storageState.json เป็น Render Secret File
//   จะอ่านได้จาก /etc/secrets/storageState.json โดยตรง (ไม่ต้องแปลงเป็น base64)
// วิธีที่ 2: env var BROWSER_STORAGE_STATE_B64 (base64 ของไฟล์ storageState.json)
//   สร้างได้ด้วย `node login-session.js`
function loadStorageState() {
  const SECRET_FILE_PATH = '/etc/secrets/storageState.json';
  if (fs.existsSync(SECRET_FILE_PATH)) {
    try {
      JSON.parse(fs.readFileSync(SECRET_FILE_PATH, 'utf-8'));
      return SECRET_FILE_PATH;
    } catch (err) {
      console.error(`อ่าน ${SECRET_FILE_PATH} ไม่สำเร็จ (ไม่ใช่ JSON ที่ถูกต้อง):`, err.message);
    }
  }

  const b64 = process.env.BROWSER_STORAGE_STATE_B64;
  if (!b64) return null;

  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    JSON.parse(json); // ตรวจสอบว่า decode แล้วได้ JSON ที่ถูกต้องก่อนเขียนไฟล์
    const filePath = path.join(require('os').tmpdir(), 'storageState.json');
    fs.writeFileSync(filePath, json);
    return filePath;
  } catch (err) {
    console.error('โหลด BROWSER_STORAGE_STATE_B64 ไม่สำเร็จ (ค่าที่วางอาจไม่ครบ/ไม่ถูกต้อง):', err.message);
    return null;
  }
}

// ข้อความที่มักขึ้นเมื่อหน้าเว็บต้อง login ก่อนถึงจะดูโฆษณาได้
const LOGIN_WALL_PATTERNS = [
  /sign in to confirm/i,
  /ลงชื่อเข้าใช้เพื่อยืนยัน/,
  /please (create or )?login/i,
  /กรุณาเข้าสู่ระบบ/,
  /create or login/i,
];

async function detectLoginWall(page) {
  try {
    const text = await withTimeout(page.evaluate(() => document.body.innerText.slice(0, 3000)), 2000);
    if (!text) return false;
    return LOGIN_WALL_PATTERNS.some((re) => re.test(text));
  } catch (_) {
    return false;
  }
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

async function captureOne(browser, ad, index, shotsDir, controller, onTick, storageStatePath) {
  const tick = (step) => { if (onTick) onTick(step); };

  const fileName = `${String(index + 1).padStart(3, '0')}_${ad.type}.jpg`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(shotsDir, fileName);

  let context;
  let page;

  const run = async () => {
    tick('กำลังเปิดเบราว์เซอร์...');
    context = await browser.newContext({
      viewport: { width: 1024, height: 576 },
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'th-TH',
      timezoneId: 'Asia/Bangkok',
      storageState: storageStatePath || undefined,
    });
    page = await context.newPage();

    // ลด signal ที่ทำให้ YouTube ตรวจจับว่าเป็น headless browser แล้วขึ้น "Sign in to confirm you're not a bot"
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    if (controller) controller.currentPage = page;

    tick('กำลังเปิดหน้าเว็บ...');
    await page.goto(ad.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    tick('กำลังปิด popup/cookie...');
    for (const sel of COOKIE_CONSENT_SELECTORS) {
      try {
        const btn = await page.$(sel);
        if (btn) await btn.click({ timeout: 1500 });
      } catch (_) {}
    }

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

    loginWall = await detectLoginWall(page);
  };

  let loginWall = false;

  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('รายการนี้ใช้เวลานานเกินไป (timeout)')), PER_AD_TIMEOUT_MS)),
    ]);
    await context.close();
    const result = { ...ad, screenshot: filePath, status: 'ok' };
    if (loginWall) {
      result.warning = storageStatePath
        ? 'ลิงก์นี้ต้อง login — session ปัจจุบันอาจหมดอายุหรือไม่ครอบคลุมเว็บนี้ (ดู README: npm run login)'
        : 'ลิงก์นี้ต้อง login ก่อนถึงจะเห็นโฆษณา — ตั้งค่า login session (ดู README: npm run login)';
    }
    return result;
  } catch (err) {
    if (context) await context.close().catch(() => {});
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
      '--disable-blink-features=AutomationControlled',
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

  // session ที่ login ไว้แล้ว (เช่น YouTube/WeTV) เก็บเป็น base64 ของไฟล์ storageState.json
  const storageStatePath = loadStorageState();

  const results = [];
  for (let i = 0; i < ads.length; i++) {
    if (controller && controller.cancelled) break;

    const ad = ads[i];
    if (onProgress) onProgress({ index: i, total: ads.length, name: ad.name, status: 'running' });

    // เปิด/ปิด browser ใหม่ทุกรายการ เพื่อไม่ให้ memory สะสมจากรายการก่อนหน้า
    let result;
    try {
      const browser = await withTimeoutOrThrow(chromium.launch(launchOptions), LAUNCH_TIMEOUT_MS, 'เปิดเบราว์เซอร์ไม่สำเร็จ (timeout)');
      result = await captureOne(browser, ad, i, shotsDir, controller, (step) => {
        if (onProgress) onProgress({ index: i, total: ads.length, name: ad.name, status: 'tick', step });
      }, storageStatePath);
      await browser.close().catch(() => {});
    } catch (err) {
      result = { ...ad, screenshot: null, status: 'error', error: err.message };
    }

    results.push(result);
    if (onProgress) onProgress({ index: i, total: ads.length, name: ad.name, status: result.status, error: result.error, warning: result.warning });

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

    if (r.warning) {
      slide.addText(`⚠ ${r.warning}`, {
        x: 0.4, y: 6.2, w: 12.5, h: 0.35, fontSize: 11, color: 'CC8800',
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
