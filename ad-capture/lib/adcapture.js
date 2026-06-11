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

async function captureOne(browser, ad, index, shotsDir, waitSeconds, controller) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });

  if (controller) controller.currentPage = page;

  const fileName = `${String(index + 1).padStart(3, '0')}_${ad.type}.png`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(shotsDir, fileName);

  try {
    await page.goto(ad.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    for (const sel of PLAY_BUTTON_SELECTORS) {
      const btn = await page.$(sel);
      if (btn) {
        try { await btn.click({ timeout: 2000 }); } catch (_) {}
        break;
      }
    }

    await page.waitForTimeout(waitSeconds * 1000);

    await page.screenshot({ path: filePath, timeout: 90000 });
    await page.close();
    return { ...ad, screenshot: filePath, status: 'ok' };
  } catch (err) {
    await page.close();
    return { ...ad, screenshot: null, status: 'error', error: err.message };
  }
}

async function runCapture(ads, shotsDir, waitSeconds, onProgress, controller) {
  fs.mkdirSync(shotsDir, { recursive: true });

  const launchOptions = { args: ['--no-sandbox'] };
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  const browser = await chromium.launch(launchOptions);

  const results = [];
  for (let i = 0; i < ads.length; i++) {
    if (controller && controller.cancelled) break;

    const ad = ads[i];
    if (onProgress) onProgress({ index: i, total: ads.length, name: ad.name, status: 'running' });
    const result = await captureOne(browser, ad, i, shotsDir, waitSeconds, controller);
    results.push(result);
    if (onProgress) onProgress({ index: i, total: ads.length, name: ad.name, status: result.status, error: result.error });
  }

  await browser.close();
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
