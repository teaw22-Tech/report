====================================
  YouTube Capture — คู่มือ Windows
====================================

สิ่งที่ต้องเตรียม (ติดตั้งครั้งเดียว):
  ✅ Docker Desktop for Windows
  ✅ ไฟล์โฟลเดอร์ youtube-capture (โฟลเดอร์นี้)

========================================
 ขั้นตอนที่ 1 — ติดตั้ง Docker Desktop
========================================

1. เปิด browser ไปที่:
   https://www.docker.com/products/docker-desktop/

2. คลิก "Download for Windows"

3. ดับเบิลคลิกไฟล์ที่โหลดมา (Docker Desktop Installer.exe)

4. ทำตามขั้นตอนติดตั้ง → คลิก OK / Next จนเสร็จ

5. Restart เครื่อง (ถ้าระบบขอ)

6. เปิด Docker Desktop จาก Start Menu
   รอจนไอคอน Docker (ปลาวาฬ) ที่ Taskbar ด้านล่างขวา
   แสดงสถานะ "Engine running" (ไม่หมุนแล้ว)

   ⚠️ ต้องให้ Docker Desktop เปิดอยู่ตลอดเวลาที่ใช้งาน

========================================
 ขั้นตอนที่ 2 — เริ่มต้นใช้งานครั้งแรก
========================================

1. แตกไฟล์ zip ไปไว้ในโฟลเดอร์ที่ต้องการ เช่น:
   C:\Tools\youtube-capture\

2. เข้าไปในโฟลเดอร์ youtube-capture

3. ดับเบิลคลิกไฟล์ start.bat

4. หน้าต่าง Command Prompt จะเปิดขึ้น
   ระบบจะ Build Docker image อัตโนมัติ

   ⏳ ครั้งแรกใช้เวลา 5-10 นาที
   (ดาวน์โหลด Node.js + Chromium)

5. เมื่อเห็นข้อความ:
   ✅ เปิด browser แล้วไปที่: http://localhost:3000

6. เปิด Chrome/Edge แล้วพิมพ์:
   http://localhost:3000

   ระบบพร้อมใช้งานแล้ว!

========================================
 ขั้นตอนที่ 3 — Export cookies จาก Chrome
========================================

(ทำครั้งแรก และทำใหม่เมื่อ cookies หมดอายุ)

1. เปิด Chrome แล้ว Login YouTube ด้วยบัญชีที่ต้องการ

2. ติดตั้ง Extension นี้:
   ชื่อ: "Get cookies.txt LOCALLY"
   ค้นหาใน Chrome Web Store หรือไปที่:
   https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc

3. ไปที่ www.youtube.com (ต้องเห็นว่า Login อยู่)

4. คลิกไอคอน Extension (รูปปริศนา 🧩) ที่มุมบนขวา Chrome
   แล้วคลิก "Get cookies.txt LOCALLY"

5. เลือก "Current Site" หรือ "youtube.com"
   แล้วคลิก "Export" หรือ "Download"

6. บันทึกเป็นไฟล์ .txt ไว้ที่ใดก็ได้

⚠️  ข้อควรระวัง:
    อย่าส่งไฟล์ cookies.txt ให้ผู้อื่น
    เพราะสามารถใช้ Login YouTube บัญชีของคุณได้

========================================
 ขั้นตอนที่ 4 — วิธีใช้งานระบบ
========================================

--- อัปโหลด Cookies ---

1. ที่หน้า http://localhost:3000
   มองหาส่วน "YouTube Cookies" ด้านบน

2. คลิกปุ่ม "อัปโหลด cookies.txt"

3. เลือกไฟล์ cookies.txt ที่ Export มา

4. รอจนเห็น badge เปลี่ยนเป็น ✅ พร้อมใช้งาน

--- กรอก URL แบบพิมพ์เอง ---

1. ในช่อง "Name" พิมพ์ชื่อโฆษณา เช่น
   Toyota Hilux Mar25

2. ในช่องด้านล่าง วาง YouTube URL เช่น
   https://www.youtube.com/watch?v=xxx&force_ad_encrypted=...

3. คลิก "+ เพิ่ม URL" เพื่อเพิ่มรายการ (สูงสุด 10 รายการ)

--- กรอก URL แบบ Excel (แนะนำ สำหรับหลาย URL) ---

1. คลิก "ดาวน์โหลด Template" เพื่อได้ไฟล์ Excel

2. เปิดไฟล์ Excel กรอกข้อมูล:
   - คอลัมน์ Name: ชื่อโฆษณา
   - คอลัมน์ YouTube URL: ลิงก์ YouTube

3. บันทึกไฟล์ Excel

4. คลิก "อัปโหลด Excel" แล้วเลือกไฟล์ที่กรอกแล้ว

5. ระบบจะนำเข้า URL ทั้งหมดอัตโนมัติ

--- Preview และ Export ---

1. คลิกปุ่ม "🔍 Preview ทั้งหมด"
   ระบบจะ capture Screenshot ทีละรายการ
   (ประมาณ 5-15 วินาทีต่อรายการ)

2. ตรวจสอบภาพ Preview ที่แสดงด้านล่าง
   - ✅ = capture สำเร็จ
   - ❌ = มีปัญหา (คลิก "↺ ลองใหม่")

3. คลิกปุ่ม "⬇ ส่งออก PowerPoint"

4. ไฟล์ youtube-captures.pptx จะดาวน์โหลดอัตโนมัติ

========================================
 ขั้นตอนที่ 5 — ปิดระบบ
========================================

1. กลับไปที่หน้าต่าง Command Prompt (start.bat)
2. กด Ctrl + C
3. ระบบจะหยุดทำงาน

ครั้งถัดไปที่ต้องการใช้:
  → ดับเบิลคลิก start.bat อีกครั้ง
  (Build เร็วมากเพราะ cache ไว้แล้ว)

========================================
 คำถามที่พบบ่อย
========================================

Q: start.bat ขึ้น "Docker Desktop ยังไม่ได้เปิด"
A: เปิด Docker Desktop จาก Start Menu แล้วรอ
   ให้ไอคอนหยุดหมุนก่อน แล้วลอง start.bat ใหม่

Q: Port 3000 is already in use
A: เปิด Command Prompt แล้วพิมพ์:
   docker ps
   docker stop [ชื่อ container ที่เห็น]
   แล้วรัน start.bat ใหม่

Q: capture ขึ้น error ทุกรายการ
A: cookies อาจหมดอายุ → Export cookies ใหม่แล้วอัปโหลดใหม่

Q: ภาพที่ได้เป็นหน้าขาว/ดำ
A: วิดีโออาจ private หรือถูกลบ → ตรวจสอบ URL ก่อน

Q: ใช้งานได้แค่ไหนก่อนต้อง Export cookies ใหม่
A: ปกติ cookies YouTube มีอายุ 1-2 ปี
   แต่ถ้า logout หรือเปลี่ยนรหัสผ่านต้อง Export ใหม่

====================================
