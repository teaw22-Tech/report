# Ads Capture DV360 → PowerPoint

ระบบแคปภาพโฆษณาจากลิงก์ (DV360 / YouTube / OTT ต่างๆ) อัตโนมัติ แล้วรวมเป็นไฟล์
PowerPoint — ใช้งานผ่านหน้าเว็บ ไม่ต้องเขียนโค้ด

มี 2 วิธีใช้งาน:
- **แบบ Cloud** (แนะนำสำหรับออฟฟิศที่ห้ามติดตั้ง/รันโปรแกรม) — เปิดผ่าน browser อย่างเดียว
- **แบบ Local** — รันบนเครื่องตัวเอง (ต้องติดตั้ง Node.js)

---

## วิธีใช้งานแบบ Cloud (ไม่ต้องติดตั้งอะไรในเครื่องออฟฟิศ)

Deploy ขึ้น [Render.com](https://render.com) (มี free tier, สมัครด้วยอีเมล/บัญชี GitHub ได้เลย)

1. สมัคร/ล็อกอิน Render.com ด้วยบัญชี GitHub ของคุณ
2. กด **New +** → **Blueprint**
3. เลือก repository นี้ (`teaw22-tech/report`) — Render จะอ่านไฟล์ `render.yaml` ที่ root อัตโนมัติ
4. กด **Apply** แล้วรอ build เสร็จ (ใช้เวลาประมาณ 5-10 นาที ครั้งแรก)
5. จะได้ลิงก์เว็บ เช่น `https://ads-capture-xxxx.onrender.com` — แชร์ลิงก์นี้ให้ทีมเปิดผ่าน browser ได้เลย

**หมายเหตุ free tier**: ถ้าไม่มีคนใช้นานๆ service จะ sleep ไปก่อน เปิดครั้งถัดไปอาจรอ ~1 นาทีให้ตื่นขึ้นมา

---

## วิธีใช้งานแบบ Local (รันบนเครื่องตัวเอง)

### ติดตั้ง (ทำครั้งแรกครั้งเดียว)
1. ติดตั้ง [Node.js](https://nodejs.org) (เลือกเวอร์ชัน LTS)
2. ดาวน์โหลด/clone โฟลเดอร์นี้มาไว้ในเครื่อง

### ใช้งาน (ทุกครั้ง)

**Windows**: ดับเบิลคลิกไฟล์ **`start.bat`**

**Mac / Linux**: ดับเบิลคลิกไฟล์ **`start.sh`** (หรือเปิด terminal แล้วพิมพ์ `./start.sh`)

ครั้งแรกจะใช้เวลาสักครู่เพื่อติดตั้งโปรแกรม/เบราว์เซอร์ที่ใช้แคปภาพ
จากนั้นเบราว์เซอร์จะเปิดหน้า **http://localhost:3000** ขึ้นมาอัตโนมัติ

---

## วิธีใช้งานในหน้าเว็บ (ทั้งสองแบบเหมือนกัน)

1. เตรียมไฟล์ Excel ตาม template (`input/ads.template.xlsx`)
   - คอลัมน์ที่ต้องมี: `NAME` (ชื่อ ads, ไม่บังคับ), `TYPE`, `URL`
2. กดเลือกไฟล์ Excel ในหน้าเว็บ
3. กด "เริ่มแคปภาพและสร้าง PowerPoint" (ระบบจะตรวจสอบเองว่าโฆษณาเริ่มเล่นหรือยังก่อนแคปภาพ)
4. รอดูสถานะแต่ละรายการแบบ real-time
5. เมื่อเสร็จ กดปุ่มดาวน์โหลดไฟล์ PowerPoint

## ใช้แบบ command line (สำหรับผู้ที่ถนัด)

```
npm install
npm run setup      # ติดตั้งเบราว์เซอร์ ครั้งแรกครั้งเดียว
# วางไฟล์ Excel ที่ input/ads.xlsx
npm run cli        # ได้ไฟล์ผลลัพธ์ใน output/
```

## ตั้งรหัสผ่านเข้าหน้าเว็บ (แนะนำ)

ป้องกันคนนอกเข้ามาใช้งานเว็บนี้โดยไม่ได้รับอนุญาต ทำได้โดยตั้ง Environment
Variable บน Render:

1. ไปที่ Render → service `ads-capture` → แท็บ **Environment**
2. เพิ่ม `APP_USERNAME` (เช่น `team`) และ `APP_PASSWORD` (ตั้งรหัสผ่านเอง)
3. กด **Save Changes** → Render redeploy อัตโนมัติ

จากนั้นเมื่อเปิดเว็บ จะมี popup ให้กรอก username/password ก่อนถึงจะใช้งานได้
(ถ้าไม่ตั้งค่าทั้งสองตัวนี้ เว็บจะเปิดใช้งานได้แบบสาธารณะเหมือนเดิม)

## ลิงก์ที่ต้อง login (YouTube/WeTV ขึ้น "Sign in" / "Please login")

ถ้าลิงก์ไหนต้อง login เข้าบัญชีก่อนถึงจะดูได้ ระบบสามารถ "แอบอ้าง" session
ที่ login ไว้แล้วได้ โดยทำตามขั้นตอนนี้ (ทำครั้งเดียว)

### วิธีที่ 1: ทำบนเครื่องที่มี Node.js

1. ติดตั้ง Node.js + รัน `npm install` และ `npm run setup` ในโฟลเดอร์ `ad-capture` (ครั้งแรกครั้งเดียว)
2. รันคำสั่ง `npm run login` — จะมีหน้าต่างเบราว์เซอร์เปิดขึ้นมา
3. Login เข้าบัญชีที่ต้องการ (เช่น Google/YouTube, WeTV) ในหน้าต่างนั้นให้ครบ
4. กลับมาที่ terminal แล้วกด Enter — ระบบจะสร้างไฟล์ `storageState.b64.txt`
5. เปิดไฟล์นั้น คัดลอกข้อความทั้งหมด

### วิธีที่ 2: ทำผ่าน GitHub Codespaces (ไม่ต้องติดตั้งอะไรในเครื่อง — ใช้ browser ล้วนๆ)

ใช้ตอนที่เครื่องที่มีถูกบล็อกไม่ให้ติดตั้ง/รันโปรแกรม

1. เปิด `https://github.com/teaw22-tech/report` (ต้อง login GitHub ก่อน)
2. กดปุ่มสีเขียว **Code** → แท็บ **Codespaces** → **Create codespace on main**
3. รอ 2-5 นาที ให้ Codespace เตรียมตัวเอง (ติดตั้ง Node.js + Playwright ให้อัตโนมัติ)
   เมื่อพร้อม จะเปิดเป็นหน้า VS Code ใน browser
4. ไปที่แท็บ **PORTS** ด้านล่าง (อยู่แถวเดียวกับ Terminal) — จะเห็น port `6080`
   พร้อมป้ายชื่อ "เปิดที่นี่เพื่อ login" → คลิกไอคอนลูกโลก (Open in Browser)
   จะเปิดแท็บใหม่เป็นหน้าจอ Desktop (noVNC) — ถ้าถามรหัสผ่าน ให้ใส่ `vscode`
5. กลับไปที่แท็บ VS Code → เปิด **Terminal** (เมนู Terminal → New Terminal)
   แล้วพิมพ์:
   ```
   cd ad-capture
   npm run login
   ```

   > ⚠️ ถ้า login Google/YouTube ไม่ได้ (ขึ้น "This browser or app may not be
   > secure") ให้รันคำสั่งนี้ก่อน 1 ครั้ง แล้วค่อยรัน `npm run login` ใหม่:
   > ```
   > npx playwright install --with-deps chrome
   > ```
6. สลับไปที่แท็บ Desktop (noVNC) จากข้อ 4 — จะเห็นหน้าต่างเบราว์เซอร์ Chromium เปิดขึ้นมา
   → Login เข้าบัญชี Google/YouTube และ WeTV ให้เรียบร้อยในหน้าต่างนี้
7. กลับไปที่แท็บ Terminal (VS Code) → กด **Enter** ตามที่ขึ้นข้อความ
   → จะได้ไฟล์ `storageState.b64.txt` ในโฟลเดอร์ `ad-capture`
8. ปิด Codespace ได้เลย (ไม่จำเป็นต้องเก็บไว้)

### นำ session ไปใช้บน Render (ทำต่อจากวิธีไหนก็ได้)

**วิธีที่แนะนำ: Secret File** (ไฟล์ `storageState.json` มักมีขนาดใหญ่
วางเป็นค่า Environment Variable อาจถูกตัด/ไม่ครบทำให้ใช้งานไม่ได้)

1. ในโฟลเดอร์ `ad-capture` ของ Codespace → คลิกขวาไฟล์ **`storageState.json`**
   (ไม่ใช่ .b64.txt) → **Download**
2. ไปที่ Render → service `ads-capture` → แท็บ **Environment** → เลื่อนลงไปหา
   ส่วน **Secret Files** → กด **Add file**
3. ช่อง filename ใส่ `storageState.json` → อัปโหลด/วางเนื้อหาไฟล์ที่ดาวน์โหลดมา
   → **Save Changes** (Render จะ redeploy ให้อัตโนมัติ)

**วิธีสำรอง: Environment Variable** (ถ้า Secret File ใช้ไม่ได้)

1. คลิกขวาไฟล์ `storageState.b64.txt` ใน sidebar ซ้าย → **Download**
   เปิดไฟล์ที่ดาวน์โหลดมา → คัดลอกข้อความทั้งหมด (ระวังอย่าให้ตัด/ขาดบางส่วน)
2. ไปที่ Render → service `ads-capture` → แท็บ **Environment** →
   เพิ่มตัวแปรชื่อ `BROWSER_STORAGE_STATE_B64` แล้ววางค่าที่คัดลอกมา → Save

จากนั้นทุกลิงก์ที่ระบบเปิด จะ "เห็น" เหมือนผู้ใช้ที่ login บัญชีนั้นอยู่แล้ว

⚠️ **ข้อควรระวัง**: ค่านี้เทียบเท่ารหัสผ่าน ห้ามแชร์/commit ขึ้น git เด็ดขาด
เก็บไว้ใน Render Environment Variable / Secret File เท่านั้น ถ้า session
หมดอายุ (เช่น ผ่านไปหลายเดือน) ให้ทำซ้ำขั้นตอนข้างบนเพื่ออัปเดตค่าใหม่

(วิธีนี้ปลอดภัยกว่าการเก็บ email/password ไว้ในระบบโดยตรง เพราะ Google/WeTV
มักบล็อกการ login อัตโนมัติด้วย email/password และอาจมี 2FA ที่ทำอัตโนมัติไม่ได้)

## ข้อจำกัด

- ลิงก์ที่ต้อง **login** ก่อนถึงจะดูได้ ถ้ายังไม่ได้ตั้งค่า session ตามด้านบน จะแคปไม่ได้ (จะได้หน้า login แทน)
- โฆษณาวิดีโอบางแพลตฟอร์มต้องกด Play เอง — ระบบพยายามกดปุ่ม Play ให้อัตโนมัติ
  แต่ถ้าปุ่มไม่ตรงกับรูปแบบที่รู้จัก อาจต้องปรับ selector ใน `lib/adcapture.js`
- ระบบพยายามกดให้วิดีโอเริ่มเล่น (สูงสุด 15 วิ) แล้วแคปภาพภายใน ~3 วิแรกของ
  โฆษณา preroll — ปรับได้ที่ค่าคงที่ `START_PLAYBACK_TIMEOUT_MS` /
  `CAPTURE_AFTER_PLAY_MS` ใน `lib/adcapture.js`
- ถ้าโฆษณาไม่ขึ้น (เช่น ติด frequency cap/geo targeting หรือ session ที่ login
  ไม่มีสิทธิ์เข้าถึงแคมเปญนั้น) ระบบจะแคปภาพหน้าคอนเทนต์ปกติแทน

## โฆษณาไม่ขึ้นเพราะ geo targeting (server อยู่ต่างประเทศ)

Render free tier อยู่ที่ Singapore — ถ้าแคมเปญยิงเฉพาะประเทศไทย Google
อาจไม่ serve โฆษณาให้ IP สิงคโปร์ วิธีแก้คือให้เบราว์เซอร์วิ่งผ่าน proxy
ที่มี IP ประเทศไทย:

1. สมัครบริการ proxy ที่มี IP ไทย (แนะนำแบบ residential เช่น Webshare,
   IPRoyal, Bright Data ฯลฯ — มักมีแพ็กเกจเล็กราคาไม่แพง) แล้วเอาค่า
   host:port + username/password มา
2. ไปที่ Render → service `ads-capture` → **Environment** → เพิ่มตัวแปร:
   - `PROXY_SERVER` เช่น `http://proxy.example.com:8080`
   - `PROXY_USERNAME` / `PROXY_PASSWORD` (ถ้า proxy ต้องยืนยันตัวตน)
3. Save → รอ redeploy แล้วทดสอบใหม่

วิธีเช็คว่าติด geo จริงไหม: เปิดลิงก์เดียวกันใน Chrome ของ GitHub Codespace
(ผ่านหน้าจอ noVNC ซึ่งเป็น IP ต่างประเทศเหมือนกัน) — ถ้าใน Codespace ก็ไม่เห็น
โฆษณาเหมือนกัน แสดงว่าติด geo ให้ตั้ง proxy ตามด้านบน

## เกี่ยวกับ Render free tier (512MB RAM)

ระบบถูกปรับให้ประหยัดหน่วยความจำที่สุดสำหรับ free tier แล้ว:
- เปิดเบราว์เซอร์ใหม่และปิดทันทีหลังแคปแต่ละรายการ (ไม่สะสม memory)
- ใช้ Chromium แบบ single-process พร้อมปิดฟีเจอร์ที่ไม่จำเป็น (GPU, extensions, sync ฯลฯ)
- บันทึกภาพแคปเป็น JPEG (เล็กกว่า PNG มาก)
- จำกัด heap ของ Chromium และของ Node เอง พร้อมสั่งคืนหน่วยความจำ (GC) ระหว่างรายการ

ถ้ายังเจอ "exceeded its memory limit" อยู่บ่อยๆ (โดยเฉพาะกับไฟล์ที่มีหลายสิบ ads
หรือเว็บโฆษณาที่หนักมาก) แนะนำให้:
1. แบ่งไฟล์ Excel เป็นชุดย่อย (เช่น ครั้งละ 10-15 รายการ) แล้วรันหลายรอบ — ลด
   โอกาสที่ของเก่าจะค้างในหน่วยความจำนานเกินไป
2. หากต้องการรันทีเดียวจำนวนมากบ่อยๆ ควรอัปเกรด Render เป็น plan ที่มี RAM
   มากกว่า 512MB (เช่น Starter) เพราะ Chromium + หน้าโฆษณาวิดีโอใช้
   หน่วยความจำค่อนข้างมากต่อ 1 รายการ
