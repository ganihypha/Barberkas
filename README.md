# BarberKas v1.4

## Sistem Kas & Antrian Barbershop via WhatsApp

BarberKas adalah micro-SaaS yang membantu barbershop Indonesia mengelola transaksi harian, komisi barber, dan antrian customer — semuanya lewat WhatsApp.

## URLs

- **Production**: https://barberkas.pages.dev
- **Dashboard**: https://barberkas.pages.dev/
- **Webhook Tester**: https://barberkas.pages.dev/webhook-test
- **API Health**: https://barberkas.pages.dev/api/health
- **Webhook Fonnte**: https://barberkas.pages.dev/api/webhook/fonnte
- **Webhook Logs**: https://barberkas.pages.dev/api/webhook/logs
- **Webhook Stats**: https://barberkas.pages.dev/api/webhook/stats
- **GitHub**: https://github.com/ganihypha/Barberkas

## Fitur yang Sudah Jadi

### WhatsApp Bot (via Fonnte)
- **POTONG [harga] [layanan]** — Catat transaksi potong rambut
  - Contoh: `POTONG 30000`, `POTONG 50000 FADE`, `POTONG 35000 POMADE`
- **TOTAL** — Lihat laporan revenue hari ini (per barber + total)
- **KOMISI** — Lihat komisi pribadi barber hari ini
- **ANTRI** — Cek estimasi antrian (sepi/agak rame/rame)
- **HELP** — Tampilkan menu perintah

### Smart Message Filtering (v1.4)
- **Group messages** (sender `120xxx`) automatically skipped — no wasted Fonnte quota
- **Bot echo detection** — self-replies from device number are ignored
- **Non-text messages** (stickers, images, etc.) skipped gracefully
- **Long random messages** (>50 chars, not a command) don't trigger auto-reply
- **Short unknown messages** (<50 chars) get a friendly "ketik HELP" hint

### Web Dashboard
- Ringkasan harian (total potong, revenue, komisi, profit owner)
- Performa per barber (progress bar + detail)
- Tabel transaksi hari ini (tambah manual / hapus)
- Manajemen daftar barber (nama + nomor WA)
- Date picker untuk lihat data hari sebelumnya
- Kirim laporan harian ke WA owner (1 klik)
- Copy webhook URL untuk setup Fonnte

### Backend API
| Endpoint | Method | Deskripsi |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/config` | GET | Konfigurasi barbershop |
| `/api/transactions` | GET | Daftar transaksi (query: ?date=YYYY-MM-DD) |
| `/api/transactions` | POST | Tambah transaksi manual |
| `/api/transactions/:id` | DELETE | Hapus transaksi |
| `/api/report` | GET | Laporan harian lengkap (query: ?date=YYYY-MM-DD) |
| `/api/report/weekly` | GET | Summary 7 hari terakhir |
| `/api/barbers` | GET | Daftar barber |
| `/api/barbers` | POST | Tambah barber |
| `/api/barbers/:id` | DELETE | Hapus barber |
| `/api/send-report` | POST | Kirim laporan ke WA owner |
| `/api/webhook/fonnte` | GET | Webhook verification (returns status) |
| `/api/webhook/fonnte` | POST | Webhook receiver dari Fonnte |
| `/api/webhook/logs` | GET | Log webhook (query: ?limit=30&action=help) |
| `/api/webhook/stats` | GET | Stats breakdown (sent/failed/skipped) |
| `/api/test/fonnte-config` | GET | Check Fonnte token status |
| `/api/test/fonnte-send` | POST | Direct Fonnte Send API test |

## Tech Stack

- **Backend**: Hono (TypeScript) on Cloudflare Workers
- **Database**: Supabase (PostgreSQL)
- **WhatsApp API**: Fonnte.com
- **Frontend**: TailwindCSS + Chart.js + Vanilla JS
- **Hosting**: Cloudflare Pages (gratis!)
- **Total biaya**: Rp 50.000-100.000/bulan (hanya Fonnte)

## Data Architecture

### Tables (Supabase)
- **transactions**: id, barber_name, barber_phone, service, price, tx_date, customer_phone, created_at
- **barbers**: id, name, phone, created_at
- **webhook_logs**: id, sender, sender_name, message, device, content_type, raw_keys, action, reply_status, error, created_at

## Bug Fixes & Root Cause Analysis (v1.2 - v1.4)

### v1.4 — Critical Fonnte API Fixes (CURRENT)

**Root Cause of `send_failed:invalid/empty body value`:**

Through systematic API testing, discovered that **Fonnte Send API has strict JSON type requirements**:

| Payload | Result |
|---|---|
| `{"target":"628xxx","message":"test"}` | ✅ Success |
| `{"target":"628xxx","message":"test","inboxid":""}` | ❌ `invalid/empty body value` |
| `{"target":"628xxx","message":"test","inboxid":"12345"}` | ❌ `invalid/empty body value` |
| `{"target":"628xxx","message":"test","inboxid":12345}` | ✅ Works (number type) |
| `{"target":"628xxx","message":"test","typing":"false"}` | ❌ `invalid/empty body value` |
| `{"target":"120xxx","message":"test"}` | ❌ `target input invalid` |

**Fixes applied:**
1. **inboxid must be NUMBER type** — `parseInt(inboxid, 10)` instead of string; omit entirely if empty/invalid
2. **Removed `typing: false`** from payload — was string-coerced causing rejection
3. **Skip group messages** — sender `120xxx` cannot receive Fonnte Send (group JID format)
4. **Skip bot echoes** — detect when sender === device number (self-reply loop)
5. **Skip non-text messages** — "non-text message" from media/stickers
6. **Skip long random messages** — >50 chars non-command messages don't trigger auto-reply
7. **Full Fonnte API response logging** — every send captures raw response for debugging

### v1.3 — inboxid Empty String Fix
- Empty string `inboxid` causes Fonnte rejection; only include if numeric (`/^[1-9]\d*$/`)

### v1.2 — JSON Parsing & Supabase Logging
- Fixed JSON body parsing (Fonnte sends JSON, not form-data)
- Persistent webhook logs in Supabase (not in-memory)
- InboxID threading for proper reply context

## Cara Setup Fonnte (PENTING!)

### Settings di Edit Device (md.fonnte.com)
1. **Webhook URL**: `https://barberkas.pages.dev/api/webhook/fonnte`
2. **Autoread**: `ON` (WAJIB — tanpa ini webhook tidak trigger)
3. **Response Source**: `Autoreply` (BUKAN Flow!)
4. **Webhook Connect**: kosongkan
5. **Webhook Message Status**: kosongkan
6. **Webhook Chaining**: kosongkan
7. **Personal**: `ON`
8. **Group**: `ON` (bot akan skip otomatis, tapi tetap log)
9. **Silent Read**: `ON` (opsional)
10. **Inbox**: `ON` (opsional)

### Daftarkan Barber
1. Buka dashboard: https://barberkas.pages.dev
2. Klik "Tambah Barber" → Isi nama dan nomor WA (format: 628xxx)
3. Ulangi untuk setiap barber

### Test
1. Kirim WA dari HP lain ke nomor Fonnte: `HELP`
2. Harusnya dapat reply menu perintah
3. Coba: `POTONG 30000 FADE`
4. Cek log: https://barberkas.pages.dev/api/webhook/logs

## Perintah WhatsApp

| Perintah | Contoh | Fungsi |
|---|---|---|
| POTONG [harga] | POTONG 30000 | Catat potong rambut Rp 30.000 |
| POTONG [harga] [layanan] | POTONG 50000 FADE | Catat dengan nama layanan |
| TOTAL | TOTAL | Laporan hari ini |
| KOMISI | KOMISI | Komisi pribadi hari ini |
| ANTRI | ANTRI | Estimasi antrian |
| HELP | HELP | Menu bantuan |

## Environment Variables (Secrets)

| Variable | Deskripsi |
|---|---|
| FONNTE_TOKEN | Device token Fonnte |
| FONNTE_ACCOUNT_TOKEN | Account token Fonnte |
| SUPABASE_URL | URL project Supabase |
| SUPABASE_ANON_KEY | Supabase anon public key |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service role key |
| BARBERSHOP_NAME | Nama barbershop |
| OWNER_PHONE | Nomor WA owner (628xxx) |
| KOMISI_PERSEN | Persentase komisi barber (default: 50) |

## Monitoring

### Check webhook health:
```bash
# Stats breakdown
curl https://barberkas.pages.dev/api/webhook/stats

# Recent logs
curl https://barberkas.pages.dev/api/webhook/logs?limit=10

# Filter by action
curl https://barberkas.pages.dev/api/webhook/logs?action=help

# Test Fonnte token
curl https://barberkas.pages.dev/api/test/fonnte-config
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Local development
npm run preview

# Deploy ke Cloudflare
npm run deploy:prod
```

## Fitur Mendatang (Roadmap)

- [ ] Customer rebooking otomatis (reminder 3-4 minggu setelah potong)
- [ ] Multi-barbershop support (1 dashboard untuk beberapa cabang)
- [ ] Laporan mingguan & bulanan otomatis
- [ ] Integrasi pembayaran (QRIS)
- [ ] Customer loyalty program
- [ ] Manajemen inventory (pomade, wax, dll)
- [ ] Auto-reply data store (Supabase-backed keyword responses)
- [ ] Webhook Connect/Message Status/Chaining support

## Deployment

- **Platform**: Cloudflare Pages
- **Status**: ✅ Active
- **Project Name**: barberkas
- **Last Updated**: 16 Maret 2026
