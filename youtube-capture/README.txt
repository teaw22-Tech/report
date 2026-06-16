====================================
 YouTube Capture — คู่มือการใช้งาน
====================================

สิ่งที่ต้องมี (ติดตั้งครั้งเดียว):
  → Docker Desktop: https://www.docker.com/products/docker-desktop/

------------------------------------
 วิธีเริ่มใช้งาน
------------------------------------

Windows:
  1. เปิด Docker Desktop
  2. ดับเบิลคลิก start.bat
  3. รอจนขึ้น "เปิด browser แล้วไปที่: http://localhost:3000"
  4. เปิด browser → http://localhost:3000

Mac / Linux:
  1. เปิด Docker Desktop
  2. เปิด Terminal ในโฟลเดอร์นี้แล้วพิมพ์:
       chmod +x start.sh && ./start.sh
  3. เปิด browser → http://localhost:3000

------------------------------------
 วิธีใช้งาน
------------------------------------

1. อัปโหลด cookies.txt จาก YouTube (ดูวิธี export ด้านล่าง)
2. กรอก URL ของ YouTube Ad หรืออัปโหลดไฟล์ Excel
3. กด "Preview ทั้งหมด" เพื่อดูตัวอย่าง
4. กด "ส่งออก PowerPoint" เพื่อดาวน์โหลดไฟล์ .pptx

------------------------------------
 วิธี Export cookies.txt จาก Chrome
------------------------------------

1. ติดตั้ง Extension: "Get cookies.txt LOCALLY"
   https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc

2. เปิด YouTube และ Login เข้าบัญชี Google

3. คลิก icon extension → Export "youtube.com"

4. บันทึกเป็นไฟล์ .txt แล้วอัปโหลดในระบบ

⚠️ อย่าแชร์ไฟล์ cookies.txt กับผู้อื่น
   เพราะสามารถใช้ login เข้าบัญชีของคุณได้

------------------------------------
 หยุดระบบ
------------------------------------

กด Ctrl+C ใน Terminal / Command Prompt

====================================
