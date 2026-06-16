// Core logic: อ่าน Excel, แคปภาพ, สร้าง PowerPoint
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const pptxgen = require('pptxgenjs');
const { chromium } = require('playwright');

// ─── Constants ──────────────────────────────────────────────────────────────

const LAUNCH_TIMEOUT_MS = 30_000;
const PER_AD_TIMEOUT_MS = 60_000;
const MAX_WAIT_FOR_VIDEO_MS = 15_000;
const FALLBACK_WAIT_MS = 6_000;
const POLL_INTERVAL_MS = 1_000;
const EXTRA_WAIT_AFTER_PLAY_MS = 2_000;

const PLAY_BUTTON_SELECTORS = [
  '.ytp-large-play-button',
  '.vjs-big-play-button',
  'button[aria-label*="Play"]',
  'button[aria-label*="เล่น"]',
  '.video-play-button',
  '[class*="play-btn"]',
  '[class*="playBtn"]',
];

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

const LOGIN_WALL_PATTERNS = [
  /sign in to confirm/i,
  /ลงชื่อเข้าใช้เพื่อยืนยัน/,
  /please (create or )?login/i,
  /กรุณาเข้าสู่ระบบ/,
  /create or login/i,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

function withTimeoutOrThrow(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// ─── Excel ───────────────────────────────────────────────────────────────────

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

// ─── Session / Login ─────────────────────────────────────────────────────────

function loadStorageState() {
  const b64 = process.env.BROWSER_STORAGE_STATE_B64;
  if (!b64) return null;

  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    const filePath = path.join(require('os').tmpdir(), 'storageState.json');
    fs.writeFileSync(filePath, json);
    return filePath;
  } catch (err) {
    console.error('โหลด BROWSER_STORAGE_STATE_B64 ไม่สำเร็จ:', err.message);
    return null;
  }
}

// ─── Bot-detection evasion init script ───────────────────────────────────────

const ANTI_BOT_SCRIPT = () => {
  // 1. ซ่อน webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2. จำลอง window.chrome ให้ครบ
  if (!window.chrome) {
    window.chrome = {
      app: { isInstalled: false, InstallState: {}, RunningState: {} },
      runtime: {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      },
    };
  }

  // 3. จำลอง plugins ให้ไม่ว่างเปล่า (headless มักมี plugins = 0)
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const makePlugin = (name, filename, desc, mimeType) => {
        const plugin = Object.create(Plugin.prototype);
        Object.defineProperty(plugin, 'name', { get: () => name });
        Object.defineProperty(plugin, 'filename', { get: () => filename });
        Object.defineProperty(plugin, 'description', { get: () => desc });
        Object.defineProperty(plugin, 'length', { get: () => 1 });
        const mime = Object.create(MimeType.prototype);
        Object.defineProperty(mime, 'type', { get: () => mimeType });
        plugin[0] = mime;
        return plugin;
      };
      const arr = [
        makePlugin('Chrome PDF Plugin', 'internal-pdf-viewer', 'Portable Document Format', 'application/x-google-chrome-pdf'),
        makePlugin('Chrome PDF Viewer', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', '', 'application/pdf'),
        makePlugin('Native Client', 'internal-nacl-plugin', '', 'application/x-nacl'),
      ];
      Object.defineProperty(arr, 'namedItem', { value: (n) => arr.find(p => p.name === n) || null });
      Object.defineProperty(arr, 'refresh', { value: () => {} });
      return arr;
    },
  });

  // 4. languages ไม่ว่าง
  Object.defineProperty(navigator, 'languages', { get: () => ['th-TH', 'th', 'en-US', 'en'] });

  // 5. ซ่อน automation ใน permissions API
  const origQuery = window.navigator.permissions && window.navigator.permissions.query.bind(navigator.permissions);
  if (origQuery) {
    navigator.permissions.query = (params) => {
      if (params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return origQuery(params);
    };
  }
};

// ─── Page helpers ─────────────────────────────────────────────────────────────

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

// ─── Capture one ad ───────────────────────────────────────────────────────────

async function captureOne(browser, ad, index, shotsDir, controller, onTick, storageStatePath) {
  const tick = (step) => { if (onTick) onTick(step); };

  const fileName = `${String(index + 1).padStart(3, '0')}_${ad.type}.jpg`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(shotsDir, fileName);

  let context;
  let page;
  let loginWall = false;

  const run = async () => {
    tick('กำลังเปิดเบราว์เซอร์...');
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'th-TH',
      timezoneId: 'Asia/Bangkok',
      storageState: storageStatePath || undefined,
    });
    page = await context.newPage();
    await page.addInitScript(ANTI_BOT_SCRIPT);

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
    await page.screenshot({ path: filePath, type: 'jpeg', quality: 80, timeout: 25000 });

    loginWall = await detectLoginWall(page);
  };

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

// ─── Run all captures ─────────────────────────────────────────────────────────

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
      '--window-size=1280,720',
      '--disable-ipc-flooding-protection',
      '--password-store=basic',
      '--use-mock-keychain',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  };
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }

  const storageStatePath = loadStorageState();

  const results = [];
  for (let i = 0; i < ads.length; i++) {
    if (controller && controller.cancelled) break;

    const ad = ads[i];
    if (onProgress) onProgress({ index: i, total: ads.length, name: ad.name, status: 'running' });

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

// ─── Build PPTX ───────────────────────────────────────────────────────────────
//
// Layout (13.33" × 7.5" WIDE):
//
//  Cover slide:
//    - "Ads Capture Report" centered ~y=2.8
//    - วันที่ + จำนวนรายการ ~y=4.2
//
//  Section divider slide (1 slide ต่อ 1 type/platform):
//    - ชื่อ platform (เช่น "YouTube") ตัวใหญ่ 60pt กลางหน้า
//
//  Ad slide:
//    y=0.00  ชื่อโฆษณา (20pt bold, full width)
//    y=0.45  Type: xxx  (12pt, full width)
//    y=0.72  Screenshot (13.33" × 6.0")    <── ตรงกับตัวอย่าง
//    y=6.72  ⚠ warning (ถ้ามี, 9pt)
//    y=6.97  URL (7pt, hyperlink)

async function buildPptx(results, outFile) {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  // ── Cover ──
  const cover = pptx.addSlide();
  cover.addText('Ads Capture Report', {
    x: 0.5, y: 2.8, w: 12.33, h: 1,
    fontSize: 36, bold: true, color: '1D9E75', align: 'center',
  });
  cover.addText(
    `สร้างเมื่อ: ${new Date().toLocaleString('th-TH')}\nจำนวนรายการ: ${results.length}`,
    { x: 0.5, y: 4.2, w: 12.33, h: 1, fontSize: 16, color: '666666', align: 'center' },
  );

  // ── จัดกลุ่มตาม type รักษาลำดับ ──
  const groups = [];
  const seenTypes = new Map();
  for (const r of results) {
    const key = (r.type || r.sheet || 'Other').trim();
    if (!seenTypes.has(key)) {
      seenTypes.set(key, groups.length);
      groups.push({ type: key, items: [] });
    }
    groups[seenTypes.get(key)].items.push(r);
  }

  for (const group of groups) {
    // ── Section divider ──
    const section = pptx.addSlide();
    section.addText(group.type, {
      x: 0, y: 2.5, w: 13.33, h: 2.5,
      fontSize: 60, bold: true, color: '222222',
      align: 'center', valign: 'middle',
    });

    // ── Ad slides ──
    for (const r of group.items) {
      const slide = pptx.addSlide();

      // ชื่อโฆษณา — full width, ชิดบน
      slide.addText(r.name, {
        x: 0, y: 0, w: 13.33, h: 0.6,
        fontSize: 20, bold: true, color: '222222', valign: 'middle',
      });

      // Type bar
      slide.addText(`Type: ${r.type}`, {
        x: 0, y: 0.45, w: 13.33, h: 0.27,
        fontSize: 12, color: '888888', valign: 'middle',
      });

      // Screenshot — เต็มความกว้าง ตรงกับตัวอย่าง (y=0.72, h=6.0)
      if (r.status === 'ok' && r.screenshot && fs.existsSync(r.screenshot)) {
        slide.addImage({ path: r.screenshot, x: 0, y: 0.72, w: 13.33, h: 6.0 });
      } else {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0, y: 0.72, w: 13.33, h: 6.0,
          fill: { color: 'F5F5F5' }, line: { color: 'DDDDDD', width: 1 },
        });
        slide.addText(`แคปไม่สำเร็จ\n${r.error || 'ไม่ทราบสาเหตุ'}`, {
          x: 0, y: 2.8, w: 13.33, h: 1.5,
          fontSize: 14, color: 'CC0000', align: 'center', valign: 'middle',
        });
      }

      // Warning (ถ้ามี)
      if (r.warning) {
        slide.addText(`⚠ ${r.warning}`, {
          x: 0, y: 6.72, w: 13.33, h: 0.25,
          fontSize: 9, color: 'CC8800',
        });
      }

      // URL — ล่างสุด
      slide.addText(r.url, {
        x: 0, y: 6.97, w: 13.33, h: 0.28,
        fontSize: 7, color: '4A90D9',
        hyperlink: { url: r.url },
      });
    }
  }

  await pptx.writeFile({ fileName: outFile });
  return outFile;
}

module.exports = { readAdsFromExcel, runCapture, buildPptx };
