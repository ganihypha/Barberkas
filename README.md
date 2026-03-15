# BarberKas v1.0

## Sistem Kas & Antrian Barbershop via WhatsApp

BarberKas adalah micro-SaaS yang membantu barbershop Indonesia mengelola transaksi harian, komisi barber, dan antrian customer — semuanya lewat WhatsApp.

## URLs

- **Production**: https://barberkas.pages.dev
- **Dashboard**: https://barberkas.pages.dev/
- **API Health**: https://barberkas.pages.dev/api/health
- **Webhook Fonnte**: https://barberkas.pages.dev/api/webhook/fonnte
- **GitHub**: https://github.com/ganihypha/Barberkas

## Fitur yang Sudah Jadi

### WhatsApp Bot (via Fonnte)
- **POTONG [harga] [layanan]** — Catat transaksi potong rambut
  - Contoh: `POTONG 30000`, `POTONG 50000 FADE`, `POTONG 35000 POMADE`
- **TOTAL** — Lihat laporan revenue hari ini (per barber + total)
- **KOMISI** — Lihat komisi pribadi barber hari ini
- **ANTRI** — Cek estimasi antrian (sepi/agak rame/rame)
- **HELP** — Tampilkan menu perintah

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
| `/api/webhook/fonnte` | POST | Webhook receiver dari Fonnte |

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

## Cara Setup (Untuk Barbershop Baru)

### 1. Setup Fonnte
1. Login ke [fonnte.com](https://fonnte.com)
2. Tambah device baru → Scan QR code dengan WhatsApp
3. Buka Settings → Paste webhook URL: `https://barberkas.pages.dev/api/webhook/fonnte`
4. Matikan Autoreply (supaya bot yang handle)
5. Save

### 2. Daftarkan Barber
1. Buka dashboard: https://barberkas.pages.dev
2. Klik "Tambah Barber" → Isi nama dan nomor WA (format: 628xxx)
3. Ulangi untuk setiap barber

### 3. Test
1. Kirim WA dari HP barber ke nomor Fonnte: `POTONG 30000`
2. Harusnya dapat reply: "Tercatat! Barber: [nama]..."
3. Cek dashboard — transaksi harus muncul

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

## Deployment

- **Platform**: Cloudflare Pages
- **Status**: Active
- **Last Updated**: 15 Maret 2026
