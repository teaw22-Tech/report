// Ad Capture → PowerPoint (CLI)
// อ่านรายการ ads (ชื่อ + ลิงก์) จาก input/ads.xlsx แล้วสร้างไฟล์ PowerPoint ใน output/
const fs = require('fs');
const path = require('path');
const { readAdsFromExcel, runCapture, buildPptx } = require('./lib/adcapture');

const INPUT_FILE = process.env.INPUT_FILE || path.join(__dirname, 'input', 'ads.xlsx');
const OUTPUT_DIR = path.join(__dirname, 'output');
const SHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');

(async () => {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`ไม่พบไฟล์ Excel: ${INPUT_FILE}`);
    console.error('กรุณานำไฟล์ Excel (ตาม template) ไปวางที่ ad-capture/input/ads.xlsx');
    process.exit(1);
  }

  const ads = readAdsFromExcel(INPUT_FILE);
  console.log(`พบทั้งหมด ${ads.length} รายการ`);

  const results = await runCapture(ads, SHOTS_DIR, (p) => {
    if (p.status === 'running') {
      process.stdout.write(`(${p.index + 1}/${p.total}) กำลังแคป: ${p.name} ... `);
    } else {
      console.log(p.status === 'ok' ? 'สำเร็จ' : `ผิดพลาด (${p.error})`);
    }
  });

  console.log('กำลังสร้างไฟล์ PowerPoint...');
  const outFile = path.join(OUTPUT_DIR, `Ads_Capture_${Date.now()}.pptx`);
  await buildPptx(results, outFile);
  console.log(`เสร็จสิ้น! ไฟล์ผลลัพธ์: ${outFile}`);
})();
