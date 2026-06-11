// สร้าง "login session" สำหรับเว็บที่ต้อง login (เช่น YouTube/Google, WeTV)
// รันบนเครื่อง local ที่มีจอ (ห้ามรันบน Render) แล้วทำตามคำแนะนำในหน้าจอ
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

const OUT_FILE = path.join(__dirname, 'storageState.json');
const B64_FILE = path.join(__dirname, 'storageState.b64.txt');

(async () => {
  // ใช้ Chrome ตัวเต็ม (ไม่ใช่ Chromium) + ปิด flag ที่บอก Google ว่าเป็น automation
  // เพราะ Google มักขึ้น "This browser or app may not be secure" แล้วบล็อก login
  // ถ้าไม่ได้ติดตั้ง Chrome ไว้ จะ fallback ไปใช้ Chromium แทน
  let browser;
  const launchArgs = {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  };
  try {
    browser = await chromium.launch({ ...launchArgs, channel: 'chrome' });
  } catch (e) {
    console.log('ไม่พบ Google Chrome ในเครื่อง ใช้ Chromium แทน (อาจ login บางเว็บไม่ได้)');
    browser = await chromium.launch(launchArgs);
  }
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  await page.goto('https://www.youtube.com');

  console.log('');
  console.log('1. หน้าต่างเบราว์เซอร์เปิดขึ้นมาแล้ว');
  console.log('2. Login เข้าบัญชีที่ต้องการให้ระบบใช้ (เช่น Google/YouTube, WeTV ฯลฯ)');
  console.log('   - เปิดแท็บใหม่เพื่อ login เว็บอื่นๆ ได้ในหน้าต่างเดียวกัน');
  console.log('3. เมื่อ login ครบทุกเว็บแล้ว กลับมาที่หน้าต่างนี้แล้วกด Enter');
  console.log('');

  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('กด Enter เมื่อ login เสร็จแล้ว...', () => { rl.close(); resolve(); });
  });

  await context.storageState({ path: OUT_FILE });
  await browser.close();

  const b64 = fs.readFileSync(OUT_FILE).toString('base64');
  fs.writeFileSync(B64_FILE, b64);

  console.log('');
  console.log('บันทึก session แล้วที่:', OUT_FILE);
  console.log('แปลงเป็น base64 ไว้ที่:', B64_FILE);
  console.log('');
  console.log('ขั้นตอนถัดไป:');
  console.log('1. เปิดไฟล์ storageState.b64.txt แล้วคัดลอกข้อความทั้งหมด');
  console.log('2. ไปที่ Render → service ads-capture → Environment');
  console.log('3. เพิ่ม Environment Variable ชื่อ BROWSER_STORAGE_STATE_B64 แล้ววางค่าที่คัดลอกมา');
  console.log('4. กด Save Changes (Render จะ redeploy ให้อัตโนมัติ)');
  console.log('');
  console.log('⚠️ ห้าม commit ไฟล์ storageState.json / storageState.b64.txt ขึ้น git เด็ดขาด (.gitignore กันไว้ให้แล้ว)');
})();
