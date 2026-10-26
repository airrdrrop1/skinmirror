# SkinMirror 🪞

**Satu selfie → analisis kulit YouCam Skin AI → rutinitas pagi & malam yang personal → preview makeup try-on.**

Entri untuk **YouCam API Skin AI & eCommerce VTO Hackathon** (Devpost, Perfect Corp).
Deadline submisi: **2 November 2026, 23.45 WIB**.

## Demo (1–3 menit, wajib)

Lihat draf teks submisi di `SUBMISSION.md` (di paket submisi) untuk link video demo.
Video menunjukkan alur end-to-end: upload selfie → skor YouCam → rutinitas AM/PM → preview VTO.

## Cara menjalankan

```bash
# Tanpa kunci: mode contoh saja (tidak memakai unit YouCam)
node server.js
# buka http://localhost:3000

# Dengan kunci YouCam (server-side saja, tidak pernah ke browser):
YOUCAM_API_KEY=sk-... node server.js
```

Tidak ada dependensi npm — hanya Node.js ≥ 18 (standard library saja).
Port bisa diubah lewat `PORT`.

## YouCam API yang dipakai (terverifikasi dari docs.perfectcorp.com)

| Langkah | Endpoint |
|---|---|
| Daftarkan file | `POST https://yce-api-01.makeupar.com/s2s/v2.0/file/skin-analysis` |
| Upload biner | `PUT <pre-signed URL dari respons file>` |
| Buat task analisis | `POST /s2s/v2.0/task/skin-analysis` — `dst_actions`: acne, wrinkle, texture, moisture, oiliness, pore, redness (7 aksi SD; SD dan HD tidak boleh dicampur dalam satu request) |
| Poll hasil | `GET /s2s/v2.0/task/skin-analysis/<task_id>` → `results.output[]` berisi `type`, `ui_score`, `raw_score`, `mask_urls[]` |
| Makeup VTO | `POST /s2s/v2.0/file/makeup-vto` → `POST /s2s/v2.0/task/makeup-vto` (`effects`: lip_color + blush, `version: "1.0"`) → poll → URL hasil |
| Cek kredit | `GET /s2s/v1.0/client/credit` (lewat `GET /api/credit` di app ini) |

Server mengekspos: `POST /api/analyze`, `POST /api/vto`, `GET /api/credit`,
`GET /sample-result.json`. Semua panggilan YouCam terjadi server-side; kunci
tidak pernah dikirim ke browser, tidak ditulis ke log, dan tidak ditulis ke disk.

## Alur pengguna

1. **Upload selfie** (JPG/PNG ≤ 10 MB; cahaya rata, wajah menghadap kamera).
   Atau tombol **"Coba wajah contoh"** — hasil pra-hitung yang diberi label
   jelas, supaya juri bisa menjelajahi seluruh app tanpa menghabiskan unit.
2. **Dashboard kulit**: skor keseluruhan (rata-rata skor UI per concern) +
   kartu per concern dengan skor UI & mentah; klik kartu untuk menumpuk
   mask deteksi YouCam di atas foto (bila tersedia).
3. **Rutinitas personal**: rule engine deterministik (bukan karangan LLM)
   memetakan 3 concern terendah → langkah AM/PM, masing-masing menyebut
   skor yang mendasarinya. Bisa disalin sebagai teks.
4. **Preview hasil (VTO)**: lipstik + blush dirender YouCam Makeup VTO di
   selfie yang sama, dengan slider sebelum/sesudah.

## Privasi

- Selfie hanya ditahan di memori server selama satu request; tidak pernah
  ditulis ke disk atau log.
- File yang diunggah ke YouCam mengikuti retensi YouCam (hasil ±24 jam).
- Hasil analisis bukan diagnosis medis.

## Struktur

```
server.js                 # server Node stdlib + proxy YouCam (kunci via env)
public/index.html         # satu halaman: upload → dashboard → rutinitas → VTO
public/sample-result.json # fixture mode contoh (diberi label jelas)
```

## Lisensi

Kode contoh hackathon — bebas dipakai untuk keperluan evaluasi juri.
