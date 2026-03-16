import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Types
type Bindings = {
  FONNTE_TOKEN: string
  FONNTE_ACCOUNT_TOKEN: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  BARBERSHOP_NAME: string
  OWNER_PHONE: string
  KOMISI_PERSEN: string
}

type Transaction = {
  id?: number
  barber_name: string
  barber_phone: string
  service: string
  price: number
  customer_phone?: string
  created_at?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ============================================
// WEBHOOK DEBUG & TEST ENDPOINTS
// ============================================

// GET handler for webhook URL verification (Fonnte may ping this)
app.get('/api/webhook/fonnte', (c) => {
  return c.json({
    status: 'ok',
    message: 'BarberKas Webhook is active',
    info: 'Send POST requests to this URL from Fonnte',
    timestamp: new Date().toISOString()
  })
})

// Debug endpoint to test webhook without Fonnte
app.post('/api/webhook/test', async (c) => {
  const env = c.env
  try {
    const contentType = c.req.header('content-type') || ''
    let rawBody = ''
    let parsedData: any = {}
    
    if (contentType.includes('application/json')) {
      parsedData = await c.req.json()
      rawBody = JSON.stringify(parsedData)
    } else {
      parsedData = await c.req.parseBody()
      rawBody = JSON.stringify(parsedData)
    }
    
    return c.json({
      status: 'ok',
      received: {
        contentType,
        headers: Object.fromEntries(c.req.raw.headers.entries()),
        body: parsedData,
        rawBody
      },
      webhook_would_process: {
        message: parsedData.message || parsedData.pesan || '',
        sender: parsedData.sender || parsedData.pengirim || '',
        device: parsedData.device || ''
      },
      timestamp: new Date().toISOString()
    })
  } catch (e: any) {
    return c.json({ status: 'error', error: e.message }, 500)
  }
})

// Webhook activity log (last 20 events, in-memory for debugging)
const webhookLogs: any[] = []

app.get('/api/webhook/logs', (c) => {
  return c.json({
    total: webhookLogs.length,
    logs: webhookLogs.slice(-20).reverse()
  })
})

// ============================================
// SUPABASE HELPERS
// ============================================
async function supabaseQuery(env: Bindings, table: string, method: string, body?: any, query?: string) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`
  const headers: Record<string, string> = {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  }
  
  const options: RequestInit = { method, headers }
  if (body) options.body = JSON.stringify(body)
  
  const res = await fetch(url, options)
  if (!res.ok) {
    const err = await res.text()
    console.error(`Supabase error: ${res.status} ${err}`)
    return null
  }
  
  const text = await res.text()
  if (!text) return []
  try { return JSON.parse(text) } catch { return text }
}

// ============================================
// FONNTE HELPERS
// ============================================
async function sendWhatsApp(env: Bindings, target: string, message: string) {
  try {
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        'Authorization': env.FONNTE_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        target: target,
        message: message,
        typing: false
      })
    })
    const data = await res.json() as any
    console.log('Fonnte response:', JSON.stringify(data))
    return data
  } catch (e) {
    console.error('Fonnte error:', e)
    return null
  }
}

// ============================================
// UTILITY HELPERS
// ============================================
function formatRupiah(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function getTodayJakarta(): string {
  const now = new Date()
  const jakartaOffset = 7 * 60
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000)
  const jakartaDate = new Date(utcMs + (jakartaOffset * 60000))
  return jakartaDate.toISOString().split('T')[0]
}

function getNowJakarta(): Date {
  const now = new Date()
  const jakartaOffset = 7 * 60
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000)
  return new Date(utcMs + (jakartaOffset * 60000))
}

function formatDateIndo(dateStr: string): string {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
  const d = new Date(dateStr + 'T00:00:00+07:00')
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

// ============================================
// WEBHOOK - Fonnte WhatsApp Incoming
// ============================================
app.post('/api/webhook/fonnte', async (c) => {
  const env = c.env
  try {
    // Fonnte can send as form-data OR JSON depending on config
    const contentType = c.req.header('content-type') || ''
    let body: any = {}
    
    if (contentType.includes('application/json')) {
      body = await c.req.json()
    } else {
      body = await c.req.parseBody()
    }
    
    // Fonnte field names (support both old and new API formats)
    const message = (body.message || body.pesan || body.text || '').toString().trim()
    const sender = (body.sender || body.pengirim || body.from || '').toString().replace(/[^0-9]/g, '')
    const device = (body.device || body.perangkat || '').toString()
    const name = (body.name || body.nama || '').toString()
    
    // Log for debugging
    const logEntry = {
      timestamp: new Date().toISOString(),
      contentType,
      sender,
      senderName: name,
      message,
      device,
      rawKeys: Object.keys(body),
      processed: true
    }
    webhookLogs.push(logEntry)
    if (webhookLogs.length > 50) webhookLogs.shift()
    
    console.log(`[WEBHOOK] sender=${sender}, name="${name}", message="${message}", device=${device}, contentType=${contentType}`)
    console.log(`[WEBHOOK] Raw body keys: ${Object.keys(body).join(', ')}`)
    
    if (!message || !sender) {
      return c.json({ status: 'ignored', reason: 'empty message or sender' })
    }
    
    const upperMsg = message.toUpperCase().trim()
    
    // FLOW: POTONG / CATAT TRANSAKSI
    if (upperMsg.startsWith('POTONG') || upperMsg.startsWith('P ')) {
      const result = await handlePotong(env, upperMsg, sender)
      return c.json({ status: 'ok', action: 'potong', result })
    }
    
    // FLOW: TOTAL / LAPORAN
    if (upperMsg === 'TOTAL' || upperMsg === 'LAPORAN' || upperMsg === 'LAP') {
      const result = await handleLaporan(env, sender)
      return c.json({ status: 'ok', action: 'laporan', result })
    }
    
    // FLOW: ANTRI / ANTRIAN
    if (upperMsg === 'ANTRI' || upperMsg === 'ANTRIAN') {
      const result = await handleAntrian(env, sender)
      return c.json({ status: 'ok', action: 'antrian', result })
    }
    
    // FLOW: KOMISI
    if (upperMsg === 'KOMISI') {
      const result = await handleKomisi(env, sender)
      return c.json({ status: 'ok', action: 'komisi', result })
    }
    
    // FLOW: HELP
    if (upperMsg === 'HELP' || upperMsg === 'MENU' || upperMsg === 'BANTUAN') {
      const helpMsg = `💈 *BarberKas* — ${env.BARBERSHOP_NAME || 'Barbershop'}\n\n` +
        `Perintah yang tersedia:\n\n` +
        `✂️ *POTONG [harga] [layanan]*\n   Catat transaksi potong\n   Contoh: POTONG 30000 FADE\n\n` +
        `📊 *TOTAL*\n   Lihat laporan hari ini\n\n` +
        `💰 *KOMISI*\n   Lihat komisi kamu hari ini\n\n` +
        `📋 *ANTRI*\n   Cek estimasi antrian\n\n` +
        `❓ *HELP*\n   Tampilkan menu ini`
      
      await sendWhatsApp(env, sender, helpMsg)
      return c.json({ status: 'ok', action: 'help' })
    }
    
    // Default response
    await sendWhatsApp(env, sender, 
      `Halo! Saya *BarberKas Bot* 💈\n\nKetik *HELP* untuk lihat menu perintah.`)
    
    return c.json({ status: 'ok', action: 'default' })
    
  } catch (e: any) {
    console.error('Webhook error:', e)
    return c.json({ status: 'error', message: e.message }, 500)
  }
})

// ============================================
// HANDLER: POTONG (Record Transaction)
// ============================================
async function handlePotong(env: Bindings, message: string, sender: string) {
  const parts = message.split(/\s+/)
  let price = 0
  let service = 'Potong'
  
  if (parts.length >= 2) price = parseInt(parts[1]) || 0
  if (parts.length >= 3) service = parts.slice(2).join(' ')
  
  if (price <= 0) {
    await sendWhatsApp(env, sender,
      `❌ Format salah!\n\nContoh:\n• POTONG 30000\n• POTONG 30000 FADE\n• POTONG 50000 POMADE`)
    return 'invalid_format'
  }
  
  // Get barber name from phone
  const barberName = await getBarberName(env, sender)
  const today = getTodayJakarta()
  
  // Insert transaction
  const tx = await supabaseQuery(env, 'transactions', 'POST', {
    barber_name: barberName,
    barber_phone: sender,
    service: service,
    price: price,
    tx_date: today
  })
  
  // Get today's totals for this barber
  const todayTxs = await supabaseQuery(env, 'transactions', 'GET', null,
    `select=price&barber_phone=eq.${sender}&tx_date=eq.${today}`)
  
  const totalHariIni = (todayTxs || []).reduce((s: number, t: any) => s + (t.price || 0), 0)
  const jumlahPotong = (todayTxs || []).length
  const komisiPersen = parseInt(env.KOMISI_PERSEN || '50')
  const komisi = Math.round(totalHariIni * komisiPersen / 100)
  
  const reply = `✅ *Tercatat!*\n\n` +
    `👤 Barber: ${barberName}\n` +
    `✂️ Layanan: ${service}\n` +
    `💰 Harga: Rp ${formatRupiah(price)}\n\n` +
    `📊 *Total kamu hari ini:*\n` +
    `   ${jumlahPotong} potong\n` +
    `   Revenue: Rp ${formatRupiah(totalHariIni)}\n` +
    `   Komisi (${komisiPersen}%): Rp ${formatRupiah(komisi)}`
  
  await sendWhatsApp(env, sender, reply)
  return 'recorded'
}

// ============================================
// HANDLER: LAPORAN (Daily Report)
// ============================================
async function handleLaporan(env: Bindings, sender: string) {
  const today = getTodayJakarta()
  const shopName = env.BARBERSHOP_NAME || 'Barbershop'
  
  const txs = await supabaseQuery(env, 'transactions', 'GET', null,
    `select=*&tx_date=eq.${today}&order=created_at.asc`)
  
  if (!txs || txs.length === 0) {
    await sendWhatsApp(env, sender,
      `📊 *LAPORAN HARI INI*\n${shopName}\n📅 ${formatDateIndo(today)}\n\n_Belum ada transaksi hari ini._`)
    return 'empty'
  }
  
  let totalRevenue = 0
  const barberData: Record<string, { potong: number; revenue: number }> = {}
  
  for (const tx of txs) {
    const price = tx.price || 0
    totalRevenue += price
    
    const name = tx.barber_name || 'Unknown'
    if (!barberData[name]) barberData[name] = { potong: 0, revenue: 0 }
    barberData[name].potong++
    barberData[name].revenue += price
  }
  
  const komisiPersen = parseInt(env.KOMISI_PERSEN || '50')
  const totalKomisi = Math.round(totalRevenue * komisiPersen / 100)
  const profit = totalRevenue - totalKomisi
  
  let laporan = `📊 *LAPORAN HARI INI*\n` +
    `💈 ${shopName}\n` +
    `📅 ${formatDateIndo(today)}\n\n` +
    `✂️ Total potong: *${txs.length}*\n` +
    `💰 Total revenue: *Rp ${formatRupiah(totalRevenue)}*\n\n`
  
  // Per barber
  for (const [name, data] of Object.entries(barberData)) {
    const barberKomisi = Math.round(data.revenue * komisiPersen / 100)
    laporan += `👤 *${name}*: ${data.potong} potong - Rp ${formatRupiah(data.revenue)} (komisi: Rp ${formatRupiah(barberKomisi)})\n`
  }
  
  laporan += `\n💵 Komisi total (${komisiPersen}%): Rp ${formatRupiah(totalKomisi)}\n` +
    `🏦 Profit owner: *Rp ${formatRupiah(profit)}*`
  
  await sendWhatsApp(env, sender, laporan)
  return 'sent'
}

// ============================================
// HANDLER: ANTRIAN
// ============================================
async function handleAntrian(env: Bindings, sender: string) {
  const today = getTodayJakarta()
  const shopName = env.BARBERSHOP_NAME || 'Barbershop'
  
  // Count transactions in last 2 hours as proxy for busyness
  const txs = await supabaseQuery(env, 'transactions', 'GET', null,
    `select=created_at&tx_date=eq.${today}&order=created_at.desc`)
  
  const now = getNowJakarta()
  let recentCount = 0
  
  for (const tx of (txs || [])) {
    const txTime = new Date(tx.created_at)
    const diffMin = (now.getTime() - txTime.getTime()) / 60000
    if (diffMin <= 120) recentCount++
  }
  
  const estimasiMenit = recentCount * 20
  let status = ''
  
  if (recentCount <= 1) {
    status = '🟢 *Sepi* — Langsung datang aja!'
  } else if (recentCount <= 3) {
    status = `🟡 *Agak rame* — Estimasi tunggu ~${estimasiMenit} menit`
  } else {
    status = `🔴 *Rame* — Estimasi tunggu ~${estimasiMenit} menit`
  }
  
  const reply = `💈 *${shopName}*\n\n` +
    `Status: ${status}\n\n` +
    `Potong terakhir 2 jam: ${recentCount}\n\n` +
    `Mau datang? Langsung aja! 😊`
  
  await sendWhatsApp(env, sender, reply)
  return 'sent'
}

// ============================================
// HANDLER: KOMISI
// ============================================
async function handleKomisi(env: Bindings, sender: string) {
  const today = getTodayJakarta()
  const barberName = await getBarberName(env, sender)
  const komisiPersen = parseInt(env.KOMISI_PERSEN || '50')
  
  const txs = await supabaseQuery(env, 'transactions', 'GET', null,
    `select=price,service&barber_phone=eq.${sender}&tx_date=eq.${today}`)
  
  if (!txs || txs.length === 0) {
    await sendWhatsApp(env, sender,
      `💰 *KOMISI HARI INI*\n\n👤 ${barberName}\n\n_Belum ada transaksi hari ini._`)
    return 'empty'
  }
  
  const totalRevenue = txs.reduce((s: number, t: any) => s + (t.price || 0), 0)
  const komisi = Math.round(totalRevenue * komisiPersen / 100)
  
  let detail = ''
  txs.forEach((tx: any, i: number) => {
    detail += `   ${i + 1}. ${tx.service} — Rp ${formatRupiah(tx.price)}\n`
  })
  
  const reply = `💰 *KOMISI HARI INI*\n\n` +
    `👤 ${barberName}\n` +
    `📅 ${formatDateIndo(today)}\n\n` +
    `Detail:\n${detail}\n` +
    `✂️ Total potong: ${txs.length}\n` +
    `💰 Total revenue: Rp ${formatRupiah(totalRevenue)}\n` +
    `💵 Komisi kamu (${komisiPersen}%): *Rp ${formatRupiah(komisi)}*`
  
  await sendWhatsApp(env, sender, reply)
  return 'sent'
}

// ============================================
// HELPER: Get Barber Name
// ============================================
async function getBarberName(env: Bindings, phone: string): Promise<string> {
  const barbers = await supabaseQuery(env, 'barbers', 'GET', null,
    `select=name&phone=eq.${phone}&limit=1`)
  
  if (barbers && barbers.length > 0) return barbers[0].name
  return 'Barber-' + phone.slice(-4)
}

// ============================================
// API ROUTES - Dashboard
// ============================================

// Get today's transactions
app.get('/api/transactions', async (c) => {
  const env = c.env
  const date = c.req.query('date') || getTodayJakarta()
  
  const txs = await supabaseQuery(env, 'transactions', 'GET', null,
    `select=*&tx_date=eq.${date}&order=created_at.desc`)
  
  return c.json({ transactions: txs || [], date })
})

// Get summary/report
app.get('/api/report', async (c) => {
  const env = c.env
  const date = c.req.query('date') || getTodayJakarta()
  const komisiPersen = parseInt(env.KOMISI_PERSEN || '50')
  
  const txs = await supabaseQuery(env, 'transactions', 'GET', null,
    `select=*&tx_date=eq.${date}&order=created_at.asc`)
  
  let totalRevenue = 0
  let totalPotong = 0
  const barberData: Record<string, { potong: number; revenue: number; komisi: number }> = {}
  
  for (const tx of (txs || [])) {
    const price = tx.price || 0
    totalRevenue += price
    totalPotong++
    
    const name = tx.barber_name || 'Unknown'
    if (!barberData[name]) barberData[name] = { potong: 0, revenue: 0, komisi: 0 }
    barberData[name].potong++
    barberData[name].revenue += price
    barberData[name].komisi = Math.round(barberData[name].revenue * komisiPersen / 100)
  }
  
  return c.json({
    date,
    dateFormatted: formatDateIndo(date),
    shopName: env.BARBERSHOP_NAME || 'Barbershop',
    totalPotong,
    totalRevenue,
    komisiPersen,
    totalKomisi: Math.round(totalRevenue * komisiPersen / 100),
    profit: totalRevenue - Math.round(totalRevenue * komisiPersen / 100),
    barbers: barberData,
    transactions: txs || []
  })
})

// Add transaction manually (from dashboard)
app.post('/api/transactions', async (c) => {
  const env = c.env
  const body = await c.req.json() as any
  const today = getTodayJakarta()
  
  const tx = await supabaseQuery(env, 'transactions', 'POST', {
    barber_name: body.barber_name || 'Manual',
    barber_phone: body.barber_phone || '',
    service: body.service || 'Potong',
    price: body.price || 0,
    tx_date: body.date || today
  })
  
  return c.json({ success: true, transaction: tx })
})

// Delete transaction
app.delete('/api/transactions/:id', async (c) => {
  const env = c.env
  const id = c.req.param('id')
  
  await supabaseQuery(env, 'transactions', 'DELETE', null, `id=eq.${id}`)
  return c.json({ success: true })
})

// Get barbers
app.get('/api/barbers', async (c) => {
  const env = c.env
  const barbers = await supabaseQuery(env, 'barbers', 'GET', null,
    'select=*&order=name.asc')
  return c.json({ barbers: barbers || [] })
})

// Add barber
app.post('/api/barbers', async (c) => {
  const env = c.env
  const body = await c.req.json() as any
  
  const barber = await supabaseQuery(env, 'barbers', 'POST', {
    name: body.name,
    phone: body.phone?.replace(/[^0-9]/g, '') || ''
  })
  
  return c.json({ success: true, barber })
})

// Delete barber
app.delete('/api/barbers/:id', async (c) => {
  const env = c.env
  const id = c.req.param('id')
  
  await supabaseQuery(env, 'barbers', 'DELETE', null, `id=eq.${id}`)
  return c.json({ success: true })
})

// Get weekly summary
app.get('/api/report/weekly', async (c) => {
  const env = c.env
  const komisiPersen = parseInt(env.KOMISI_PERSEN || '50')
  
  // Get last 7 days
  const days: any[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    
    const txs = await supabaseQuery(env, 'transactions', 'GET', null,
      `select=price&tx_date=eq.${dateStr}`)
    
    const revenue = (txs || []).reduce((s: number, t: any) => s + (t.price || 0), 0)
    const potong = (txs || []).length
    
    days.push({
      date: dateStr,
      dateFormatted: formatDateIndo(dateStr),
      revenue,
      potong,
      komisi: Math.round(revenue * komisiPersen / 100),
      profit: revenue - Math.round(revenue * komisiPersen / 100)
    })
  }
  
  return c.json({
    days,
    totalRevenue: days.reduce((s, d) => s + d.revenue, 0),
    totalPotong: days.reduce((s, d) => s + d.potong, 0),
    totalProfit: days.reduce((s, d) => s + d.profit, 0)
  })
})

// Send daily report via WA
app.post('/api/send-report', async (c) => {
  const env = c.env
  const ownerPhone = env.OWNER_PHONE || ''
  
  if (!ownerPhone) return c.json({ error: 'Owner phone not set' }, 400)
  
  // Trigger the report handler to owner
  await handleLaporan(env, ownerPhone)
  return c.json({ success: true, sentTo: ownerPhone })
})

// Config
app.get('/api/config', async (c) => {
  const env = c.env
  return c.json({
    shopName: env.BARBERSHOP_NAME || 'Barbershop',
    ownerPhone: env.OWNER_PHONE || '',
    komisiPersen: parseInt(env.KOMISI_PERSEN || '50'),
    webhookUrl: new URL('/api/webhook/fonnte', c.req.url).toString()
  })
})

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString(), app: 'BarberKas' })
})

// ============================================
// FRONTEND - Dashboard UI
// ============================================
app.get('/', (c) => {
  return c.html(getDashboardHTML())
})

// ============================================
// WEBHOOK TESTER PAGE
// ============================================
app.get('/webhook-test', (c) => {
  return c.html(getWebhookTestHTML())
})

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BarberKas — Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .glass { background: rgba(255,255,255,0.9); backdrop-filter: blur(20px); }
    .gradient-bg { background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%); }
    .card-hover { transition: all 0.3s; }
    .card-hover:hover { transform: translateY(-2px); box-shadow: 0 20px 40px rgba(0,0,0,0.1); }
    .stat-gradient-1 { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); }
    .stat-gradient-2 { background: linear-gradient(135deg, #10b981 0%, #059669 100%); }
    .stat-gradient-3 { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
    .stat-gradient-4 { background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); }
    .pulse-dot { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .fade-in { animation: fadeIn 0.5s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body class="gradient-bg min-h-screen">
  
  <!-- Header -->
  <header class="px-4 py-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
          <i class="fas fa-cut text-white text-lg"></i>
        </div>
        <div>
          <h1 class="text-xl font-bold text-white">BarberKas</h1>
          <p class="text-xs text-slate-400" id="shopNameHeader">Loading...</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
          <span class="pulse-dot w-2 h-2 bg-emerald-400 rounded-full inline-block"></span>
          Live
        </div>
        <button onclick="sendDailyReport()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition">
          <i class="fas fa-paper-plane mr-1"></i> Kirim Laporan WA
        </button>
      </div>
    </div>
  </header>

  <!-- Date Selector -->
  <div class="px-4 sm:px-6 lg:px-8 mb-6">
    <div class="max-w-7xl mx-auto flex items-center gap-3">
      <button onclick="changeDate(-1)" class="p-2 text-slate-400 hover:text-white transition">
        <i class="fas fa-chevron-left"></i>
      </button>
      <input type="date" id="dateInput" class="px-4 py-2 bg-slate-800 text-white rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500 text-sm" onchange="loadData()">
      <button onclick="changeDate(1)" class="p-2 text-slate-400 hover:text-white transition">
        <i class="fas fa-chevron-right"></i>
      </button>
      <button onclick="setToday()" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition">
        Hari Ini
      </button>
    </div>
  </div>

  <!-- Stats Cards -->
  <div class="px-4 sm:px-6 lg:px-8 mb-6">
    <div class="max-w-7xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="stat-gradient-1 rounded-2xl p-5 card-hover">
        <div class="flex items-center justify-between mb-3">
          <span class="text-blue-200 text-sm font-medium">Total Potong</span>
          <i class="fas fa-cut text-blue-200 text-lg"></i>
        </div>
        <p class="text-3xl font-bold text-white" id="totalPotong">0</p>
      </div>
      <div class="stat-gradient-2 rounded-2xl p-5 card-hover">
        <div class="flex items-center justify-between mb-3">
          <span class="text-emerald-200 text-sm font-medium">Revenue</span>
          <i class="fas fa-money-bill-wave text-emerald-200 text-lg"></i>
        </div>
        <p class="text-2xl font-bold text-white" id="totalRevenue">Rp 0</p>
      </div>
      <div class="stat-gradient-3 rounded-2xl p-5 card-hover">
        <div class="flex items-center justify-between mb-3">
          <span class="text-amber-200 text-sm font-medium">Total Komisi</span>
          <i class="fas fa-hand-holding-dollar text-amber-200 text-lg"></i>
        </div>
        <p class="text-2xl font-bold text-white" id="totalKomisi">Rp 0</p>
      </div>
      <div class="stat-gradient-4 rounded-2xl p-5 card-hover">
        <div class="flex items-center justify-between mb-3">
          <span class="text-purple-200 text-sm font-medium">Profit Owner</span>
          <i class="fas fa-vault text-purple-200 text-lg"></i>
        </div>
        <p class="text-2xl font-bold text-white" id="totalProfit">Rp 0</p>
      </div>
    </div>
  </div>

  <!-- Main Content Grid -->
  <div class="px-4 sm:px-6 lg:px-8 mb-8">
    <div class="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      <!-- Barber Performance -->
      <div class="glass rounded-2xl p-6 card-hover">
        <h2 class="text-lg font-bold text-slate-800 mb-4">
          <i class="fas fa-users mr-2 text-blue-600"></i>Performa Barber
        </h2>
        <div id="barberList" class="space-y-3">
          <p class="text-slate-500 text-sm italic">Memuat data...</p>
        </div>
      </div>

      <!-- Recent Transactions -->
      <div class="glass rounded-2xl p-6 card-hover lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold text-slate-800">
            <i class="fas fa-list mr-2 text-blue-600"></i>Transaksi Hari Ini
          </h2>
          <button onclick="showAddModal()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition">
            <i class="fas fa-plus mr-1"></i> Tambah
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-slate-200">
                <th class="text-left py-3 px-2 text-slate-500 font-medium">Waktu</th>
                <th class="text-left py-3 px-2 text-slate-500 font-medium">Barber</th>
                <th class="text-left py-3 px-2 text-slate-500 font-medium">Layanan</th>
                <th class="text-right py-3 px-2 text-slate-500 font-medium">Harga</th>
                <th class="text-center py-3 px-2 text-slate-500 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody id="txTable">
              <tr><td colspan="5" class="py-8 text-center text-slate-400 italic">Memuat data...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- Barber Management -->
  <div class="px-4 sm:px-6 lg:px-8 mb-8">
    <div class="max-w-7xl mx-auto">
      <div class="glass rounded-2xl p-6 card-hover">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold text-slate-800">
            <i class="fas fa-id-card mr-2 text-blue-600"></i>Daftar Barber
          </h2>
          <button onclick="showAddBarberModal()" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg transition">
            <i class="fas fa-user-plus mr-1"></i> Tambah Barber
          </button>
        </div>
        <div id="barberManagement" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <p class="text-slate-500 text-sm italic">Memuat data...</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Webhook Info -->
  <div class="px-4 sm:px-6 lg:px-8 mb-8">
    <div class="max-w-7xl mx-auto">
      <div class="glass rounded-2xl p-6 card-hover">
        <h2 class="text-lg font-bold text-slate-800 mb-4">
          <i class="fab fa-whatsapp mr-2 text-green-600"></i>Setup WhatsApp (Fonnte)
        </h2>
        <div class="bg-slate-50 rounded-xl p-4 space-y-3">
          <div>
            <p class="text-sm font-medium text-slate-700">Webhook URL (paste di Fonnte):</p>
            <div class="flex items-center gap-2 mt-1">
              <code id="webhookUrl" class="flex-1 px-3 py-2 bg-white rounded-lg text-xs text-slate-800 border border-slate-200 break-all">Loading...</code>
              <button onclick="copyWebhook()" class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg transition">
                <i class="fas fa-copy"></i>
              </button>
            </div>
          </div>
          <div class="text-xs text-slate-500 space-y-1">
            <p><strong>Cara setup:</strong></p>
            <p>1. Login ke <a href="https://fonnte.com" target="_blank" class="text-blue-600 underline">fonnte.com</a></p>
            <p>2. Buka Device Settings</p>
            <p>3. Paste Webhook URL di atas</p>
            <p>4. Pastikan device sudah Connected (scan QR)</p>
            <p>5. Kirim WA "HELP" ke nomor Fonnte untuk test</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Add Transaction Modal -->
  <div id="addModal" class="fixed inset-0 bg-black/50 backdrop-blur-sm hidden items-center justify-center z-50" onclick="closeAddModal(event)">
    <div class="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onclick="event.stopPropagation()">
      <h3 class="text-lg font-bold text-slate-800 mb-4">
        <i class="fas fa-plus-circle mr-2 text-blue-600"></i>Tambah Transaksi
      </h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Barber</label>
          <select id="addBarberName" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-blue-500">
            <option value="">Pilih barber...</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Layanan</label>
          <input type="text" id="addService" value="Potong" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-blue-500" placeholder="Contoh: Fade, Pomade, Potong">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Harga (Rp)</label>
          <input type="number" id="addPrice" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-blue-500" placeholder="30000">
        </div>
        <div class="flex gap-3">
          <button onclick="closeAddModal()" class="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-300 transition">Batal</button>
          <button onclick="addTransaction()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition">
            <i class="fas fa-check mr-1"></i>Simpan
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Add Barber Modal -->
  <div id="addBarberModal" class="fixed inset-0 bg-black/50 backdrop-blur-sm hidden items-center justify-center z-50" onclick="closeAddBarberModal(event)">
    <div class="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onclick="event.stopPropagation()">
      <h3 class="text-lg font-bold text-slate-800 mb-4">
        <i class="fas fa-user-plus mr-2 text-emerald-600"></i>Tambah Barber
      </h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Nama Barber</label>
          <input type="text" id="addBarberNameInput" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-blue-500" placeholder="Contoh: Andi">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Nomor WA (format: 628xxx)</label>
          <input type="text" id="addBarberPhone" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-blue-500" placeholder="628123456789">
        </div>
        <div class="flex gap-3">
          <button onclick="closeAddBarberModal()" class="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-300 transition">Batal</button>
          <button onclick="addBarber()" class="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 transition">
            <i class="fas fa-check mr-1"></i>Simpan
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div id="toast" class="fixed bottom-4 right-4 px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all transform translate-y-20 opacity-0 z-50"></div>

  <script>
    const API = '';
    let currentDate = new Date().toISOString().split('T')[0];
    let barbersData = [];

    // Init
    document.getElementById('dateInput').value = currentDate;
    loadData();
    loadConfig();
    loadBarbers();

    function changeDate(days) {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + days);
      currentDate = d.toISOString().split('T')[0];
      document.getElementById('dateInput').value = currentDate;
      loadData();
    }

    function setToday() {
      currentDate = new Date().toISOString().split('T')[0];
      document.getElementById('dateInput').value = currentDate;
      loadData();
    }

    async function loadData() {
      currentDate = document.getElementById('dateInput').value;
      try {
        const res = await fetch(API + '/api/report?date=' + currentDate);
        const data = await res.json();
        
        document.getElementById('totalPotong').textContent = data.totalPotong || 0;
        document.getElementById('totalRevenue').textContent = 'Rp ' + formatRp(data.totalRevenue || 0);
        document.getElementById('totalKomisi').textContent = 'Rp ' + formatRp(data.totalKomisi || 0);
        document.getElementById('totalProfit').textContent = 'Rp ' + formatRp(data.profit || 0);
        
        // Barber list
        const barberList = document.getElementById('barberList');
        const barbers = data.barbers || {};
        if (Object.keys(barbers).length === 0) {
          barberList.innerHTML = '<p class="text-slate-400 text-sm italic">Belum ada transaksi.</p>';
        } else {
          barberList.innerHTML = Object.entries(barbers).map(([name, d]) => {
            const pct = data.totalRevenue > 0 ? Math.round(d.revenue / data.totalRevenue * 100) : 0;
            return '<div class="bg-slate-50 rounded-xl p-3">' +
              '<div class="flex items-center justify-between mb-2">' +
              '<span class="font-semibold text-slate-800">' + name + '</span>' +
              '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">' + d.potong + ' potong</span>' +
              '</div>' +
              '<div class="w-full bg-slate-200 rounded-full h-2 mb-2">' +
              '<div class="bg-blue-600 h-2 rounded-full" style="width:' + pct + '%"></div>' +
              '</div>' +
              '<div class="flex justify-between text-xs text-slate-500">' +
              '<span>Revenue: Rp ' + formatRp(d.revenue) + '</span>' +
              '<span>Komisi: Rp ' + formatRp(d.komisi) + '</span>' +
              '</div></div>';
          }).join('');
        }
        
        // Transaction table
        const txTable = document.getElementById('txTable');
        const txs = data.transactions || [];
        if (txs.length === 0) {
          txTable.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-400 italic">Belum ada transaksi hari ini.</td></tr>';
        } else {
          txTable.innerHTML = txs.map(tx => {
            const time = tx.created_at ? new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
            return '<tr class="border-b border-slate-100 hover:bg-blue-50/50 fade-in">' +
              '<td class="py-3 px-2 text-slate-600">' + time + '</td>' +
              '<td class="py-3 px-2 font-medium text-slate-800">' + (tx.barber_name || '-') + '</td>' +
              '<td class="py-3 px-2 text-slate-600">' + (tx.service || '-') + '</td>' +
              '<td class="py-3 px-2 text-right font-semibold text-slate-800">Rp ' + formatRp(tx.price || 0) + '</td>' +
              '<td class="py-3 px-2 text-center"><button onclick="deleteTx(' + tx.id + ')" class="text-red-400 hover:text-red-600 transition"><i class="fas fa-trash-alt text-xs"></i></button></td>' +
              '</tr>';
          }).join('');
        }
      } catch (e) {
        console.error('Load error:', e);
        showToast('Gagal memuat data', 'error');
      }
    }

    async function loadConfig() {
      try {
        const res = await fetch(API + '/api/config');
        const data = await res.json();
        document.getElementById('shopNameHeader').textContent = data.shopName || 'Barbershop';
        document.getElementById('webhookUrl').textContent = data.webhookUrl || '-';
      } catch (e) { console.error(e); }
    }

    async function loadBarbers() {
      try {
        const res = await fetch(API + '/api/barbers');
        const data = await res.json();
        barbersData = data.barbers || [];
        
        // Update barber management section
        const mgmt = document.getElementById('barberManagement');
        if (barbersData.length === 0) {
          mgmt.innerHTML = '<p class="text-slate-400 text-sm italic">Belum ada barber terdaftar. Tambahkan barber terlebih dahulu.</p>';
        } else {
          mgmt.innerHTML = barbersData.map(b => 
            '<div class="flex items-center justify-between bg-slate-50 rounded-xl p-3">' +
            '<div><p class="font-semibold text-slate-800">' + b.name + '</p>' +
            '<p class="text-xs text-slate-500">' + (b.phone || 'No phone') + '</p></div>' +
            '<button onclick="deleteBarber(' + b.id + ')" class="text-red-400 hover:text-red-600 transition"><i class="fas fa-trash-alt"></i></button>' +
            '</div>'
          ).join('');
        }
        
        // Update dropdown in add transaction modal
        const select = document.getElementById('addBarberName');
        select.innerHTML = '<option value="">Pilih barber...</option>' + 
          barbersData.map(b => '<option value="' + b.name + '" data-phone="' + (b.phone || '') + '">' + b.name + '</option>').join('');
      } catch (e) { console.error(e); }
    }

    function showAddModal() {
      document.getElementById('addModal').classList.remove('hidden');
      document.getElementById('addModal').classList.add('flex');
    }

    function closeAddModal(e) {
      if (e && e.target !== document.getElementById('addModal')) return;
      document.getElementById('addModal').classList.add('hidden');
      document.getElementById('addModal').classList.remove('flex');
    }

    function showAddBarberModal() {
      document.getElementById('addBarberModal').classList.remove('hidden');
      document.getElementById('addBarberModal').classList.add('flex');
    }

    function closeAddBarberModal(e) {
      if (e && e.target !== document.getElementById('addBarberModal')) return;
      document.getElementById('addBarberModal').classList.add('hidden');
      document.getElementById('addBarberModal').classList.remove('flex');
    }

    async function addTransaction() {
      const select = document.getElementById('addBarberName');
      const name = select.value;
      const phone = select.selectedOptions[0]?.dataset?.phone || '';
      const service = document.getElementById('addService').value || 'Potong';
      const price = parseInt(document.getElementById('addPrice').value) || 0;
      
      if (!name || price <= 0) {
        showToast('Isi nama barber dan harga!', 'error');
        return;
      }
      
      try {
        await fetch(API + '/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barber_name: name, barber_phone: phone, service, price })
        });
        showToast('Transaksi berhasil ditambahkan!', 'success');
        closeAddModal();
        document.getElementById('addPrice').value = '';
        loadData();
      } catch (e) {
        showToast('Gagal menambah transaksi', 'error');
      }
    }

    async function addBarber() {
      const name = document.getElementById('addBarberNameInput').value.trim();
      const phone = document.getElementById('addBarberPhone').value.trim();
      
      if (!name) {
        showToast('Isi nama barber!', 'error');
        return;
      }
      
      try {
        await fetch(API + '/api/barbers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone })
        });
        showToast('Barber berhasil ditambahkan!', 'success');
        closeAddBarberModal();
        document.getElementById('addBarberNameInput').value = '';
        document.getElementById('addBarberPhone').value = '';
        loadBarbers();
      } catch (e) {
        showToast('Gagal menambah barber', 'error');
      }
    }

    async function deleteTx(id) {
      if (!confirm('Hapus transaksi ini?')) return;
      try {
        await fetch(API + '/api/transactions/' + id, { method: 'DELETE' });
        showToast('Transaksi dihapus', 'success');
        loadData();
      } catch (e) {
        showToast('Gagal menghapus', 'error');
      }
    }

    async function deleteBarber(id) {
      if (!confirm('Hapus barber ini?')) return;
      try {
        await fetch(API + '/api/barbers/' + id, { method: 'DELETE' });
        showToast('Barber dihapus', 'success');
        loadBarbers();
      } catch (e) {
        showToast('Gagal menghapus', 'error');
      }
    }

    async function sendDailyReport() {
      try {
        const res = await fetch(API + '/api/send-report', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Laporan dikirim ke WA owner!', 'success');
        } else {
          showToast(data.error || 'Gagal kirim laporan', 'error');
        }
      } catch (e) {
        showToast('Gagal kirim laporan', 'error');
      }
    }

    function copyWebhook() {
      const url = document.getElementById('webhookUrl').textContent;
      navigator.clipboard.writeText(url).then(() => showToast('Webhook URL tersalin!', 'success'));
    }

    function formatRp(n) {
      return n.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
    }

    function showToast(msg, type) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.className = 'fixed bottom-4 right-4 px-4 py-3 rounded-xl text-sm font-medium shadow-lg z-50 transition-all ' +
        (type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white');
      setTimeout(() => { toast.className += ' translate-y-20 opacity-0'; }, 3000);
    }
  </script>

  <!-- Footer -->
  <footer class="text-center py-6 text-slate-500 text-xs">
    <p>BarberKas v1.0 — Sistem Kas & Antrian Barbershop via WhatsApp</p>
    <p class="mt-1">Built with Hono + Supabase + Fonnte</p>
  </footer>

</body>
</html>`
}

export default app

function getWebhookTestHTML(): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BarberKas — Webhook Tester</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%); }
  </style>
</head>
<body class="gradient-bg min-h-screen text-white">
  <div class="max-w-4xl mx-auto p-4 sm:p-8">
    
    <div class="flex items-center gap-3 mb-8">
      <a href="/" class="text-slate-400 hover:text-white"><i class="fas fa-arrow-left"></i></a>
      <div class="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center">
        <i class="fab fa-whatsapp text-white text-lg"></i>
      </div>
      <div>
        <h1 class="text-xl font-bold">Webhook Tester</h1>
        <p class="text-xs text-slate-400">Test webhook tanpa perlu Fonnte</p>
      </div>
    </div>

    <!-- Quick Guide -->
    <div class="bg-slate-800/50 rounded-2xl p-6 mb-6 border border-slate-700">
      <h2 class="text-lg font-bold mb-4"><i class="fas fa-book mr-2 text-blue-400"></i>Panduan Setup Fonnte</h2>
      <div class="space-y-4 text-sm text-slate-300">
        <div class="flex gap-3">
          <span class="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">1</span>
          <div>
            <p class="font-semibold text-white">Login ke Fonnte</p>
            <p>Buka <a href="https://fonnte.com" target="_blank" class="text-blue-400 underline">fonnte.com</a> dan login ke akun kamu</p>
          </div>
        </div>
        <div class="flex gap-3">
          <span class="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">2</span>
          <div>
            <p class="font-semibold text-white">Tambah Device & Scan QR</p>
            <p>Klik <strong>Add Device</strong> > masukkan nomor HP > scan QR Code dari WA kamu</p>
            <p class="text-yellow-400 mt-1"><i class="fas fa-exclamation-triangle mr-1"></i>Device harus status <strong>Connected</strong> (hijau)</p>
          </div>
        </div>
        <div class="flex gap-3">
          <span class="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">3</span>
          <div>
            <p class="font-semibold text-white">Set Webhook URL</p>
            <p>Di halaman Device Settings, paste URL webhook ini:</p>
            <div class="flex items-center gap-2 mt-2">
              <code id="webhookUrlGuide" class="flex-1 px-3 py-2 bg-slate-900 rounded-lg text-xs text-green-400 border border-slate-600 break-all">Loading...</code>
              <button onclick="copyText(document.getElementById('webhookUrlGuide').textContent)" class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg"><i class="fas fa-copy"></i></button>
            </div>
          </div>
        </div>
        <div class="flex gap-3">
          <span class="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">4</span>
          <div>
            <p class="font-semibold text-white">Matikan Autoreply</p>
            <p>Di Fonnte Settings: <strong>Autoreply = OFF</strong> atau set <strong>Response Source = Webhook</strong></p>
          </div>
        </div>
        <div class="flex gap-3">
          <span class="flex-shrink-0 w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-xs font-bold">5</span>
          <div>
            <p class="font-semibold text-white">Test!</p>
            <p>Kirim WA ke nomor Fonnte: ketik <strong>HELP</strong> atau gunakan form di bawah</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Webhook Simulator -->
    <div class="bg-slate-800/50 rounded-2xl p-6 mb-6 border border-slate-700">
      <h2 class="text-lg font-bold mb-4"><i class="fas fa-flask mr-2 text-purple-400"></i>Simulasi Webhook</h2>
      <p class="text-sm text-slate-400 mb-4">Test perintah WA tanpa harus kirim dari HP:</p>
      
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1">Nomor Pengirim</label>
          <input type="text" id="testSender" value="6285712658316" class="w-full px-3 py-2 bg-slate-900 rounded-lg border border-slate-600 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="628xxx">
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1">Pesan</label>
          <input type="text" id="testMessage" value="HELP" class="w-full px-3 py-2 bg-slate-900 rounded-lg border border-slate-600 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="POTONG 30000 FADE">
        </div>
      </div>

      <!-- Quick Command Buttons -->
      <div class="flex flex-wrap gap-2 mb-4">
        <button onclick="setMsg('HELP')" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition">HELP</button>
        <button onclick="setMsg('POTONG 30000')" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition">POTONG 30000</button>
        <button onclick="setMsg('POTONG 50000 FADE')" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition">POTONG 50000 FADE</button>
        <button onclick="setMsg('TOTAL')" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition">TOTAL</button>
        <button onclick="setMsg('KOMISI')" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition">KOMISI</button>
        <button onclick="setMsg('ANTRI')" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition">ANTRI</button>
      </div>

      <div class="flex gap-3">
        <button onclick="simulateWebhook('form')" class="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-medium transition">
          <i class="fas fa-paper-plane mr-2"></i>Kirim (Form-Data)
        </button>
        <button onclick="simulateWebhook('json')" class="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition">
          <i class="fas fa-code mr-2"></i>Kirim (JSON)
        </button>
      </div>

      <!-- Response -->
      <div id="testResult" class="mt-4 hidden">
        <p class="text-xs font-medium text-slate-400 mb-1">Response:</p>
        <pre id="testResultContent" class="bg-slate-900 rounded-lg p-4 text-xs text-green-400 overflow-x-auto border border-slate-600 max-h-64 overflow-y-auto"></pre>
      </div>
    </div>

    <!-- Webhook Logs -->
    <div class="bg-slate-800/50 rounded-2xl p-6 mb-6 border border-slate-700">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold"><i class="fas fa-history mr-2 text-amber-400"></i>Log Webhook (Recent)</h2>
        <button onclick="loadLogs()" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition">
          <i class="fas fa-refresh mr-1"></i>Refresh
        </button>
      </div>
      <div id="logsList" class="space-y-2 text-sm">
        <p class="text-slate-500 italic">Klik Refresh untuk melihat log...</p>
      </div>
    </div>

    <!-- Connection Check -->
    <div class="bg-slate-800/50 rounded-2xl p-6 border border-slate-700">
      <h2 class="text-lg font-bold mb-4"><i class="fas fa-stethoscope mr-2 text-red-400"></i>Status Koneksi</h2>
      <div class="space-y-3" id="connectionStatus">
        <div class="flex items-center gap-3 text-sm">
          <span id="apiStatus" class="w-3 h-3 rounded-full bg-slate-600"></span>
          <span>API Server</span>
          <span id="apiStatusText" class="text-slate-500 ml-auto">Checking...</span>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <span id="supabaseStatus" class="w-3 h-3 rounded-full bg-slate-600"></span>
          <span>Supabase Database</span>
          <span id="supabaseStatusText" class="text-slate-500 ml-auto">Checking...</span>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <span id="webhookStatus" class="w-3 h-3 rounded-full bg-slate-600"></span>
          <span>Webhook Endpoint</span>
          <span id="webhookStatusText" class="text-slate-500 ml-auto">Checking...</span>
        </div>
      </div>
      <button onclick="runChecks()" class="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition w-full">
        <i class="fas fa-sync-alt mr-1"></i>Run All Checks
      </button>
    </div>

  </div>

  <script>
    const API = '';

    // Load webhook URL
    fetch(API + '/api/config').then(r => r.json()).then(data => {
      document.getElementById('webhookUrlGuide').textContent = data.webhookUrl || '-';
    });

    function setMsg(msg) {
      document.getElementById('testMessage').value = msg;
    }

    function copyText(text) {
      navigator.clipboard.writeText(text).then(() => alert('Tersalin!'));
    }

    async function simulateWebhook(type) {
      const sender = document.getElementById('testSender').value;
      const message = document.getElementById('testMessage').value;
      
      let res;
      if (type === 'json') {
        res = await fetch(API + '/api/webhook/fonnte', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender, message, device: 'test-simulator', name: 'Test User' })
        });
      } else {
        const formData = new FormData();
        formData.append('sender', sender);
        formData.append('message', message);
        formData.append('device', 'test-simulator');
        formData.append('name', 'Test User');
        res = await fetch(API + '/api/webhook/fonnte', {
          method: 'POST',
          body: formData
        });
      }
      
      const data = await res.json();
      document.getElementById('testResult').classList.remove('hidden');
      document.getElementById('testResultContent').textContent = JSON.stringify(data, null, 2);
    }

    async function loadLogs() {
      try {
        const res = await fetch(API + '/api/webhook/logs');
        const data = await res.json();
        const container = document.getElementById('logsList');
        
        if (!data.logs || data.logs.length === 0) {
          container.innerHTML = '<p class="text-slate-500 italic">Belum ada log. Coba kirim pesan dulu.</p>';
          return;
        }
        
        container.innerHTML = data.logs.map(log => {
          const time = new Date(log.timestamp).toLocaleTimeString('id-ID');
          const bgColor = log.processed ? 'bg-green-900/30 border-green-800' : 'bg-red-900/30 border-red-800';
          return '<div class="' + bgColor + ' border rounded-lg p-3">' +
            '<div class="flex items-center justify-between mb-1">' +
            '<span class="text-xs text-slate-400">' + time + '</span>' +
            '<span class="text-xs px-2 py-0.5 rounded-full ' + (log.processed ? 'bg-green-800 text-green-300' : 'bg-red-800 text-red-300') + '">' + (log.processed ? 'OK' : 'ERROR') + '</span>' +
            '</div>' +
            '<p class="text-sm"><strong>' + (log.senderName || log.sender || 'unknown') + '</strong> (' + (log.sender || '-') + ')</p>' +
            '<p class="text-xs text-slate-400 mt-1">Pesan: <strong class="text-white">' + (log.message || '-') + '</strong></p>' +
            '<p class="text-xs text-slate-500 mt-1">Content-Type: ' + (log.contentType || '-') + ' | Keys: ' + (log.rawKeys || []).join(', ') + '</p>' +
            '</div>';
        }).join('');
      } catch (e) {
        document.getElementById('logsList').innerHTML = '<p class="text-red-400">Error: ' + e.message + '</p>';
      }
    }

    async function runChecks() {
      // API check
      try {
        const r = await fetch(API + '/api/health');
        const d = await r.json();
        document.getElementById('apiStatus').className = 'w-3 h-3 rounded-full bg-green-500';
        document.getElementById('apiStatusText').textContent = 'OK - ' + d.timestamp;
        document.getElementById('apiStatusText').className = 'text-green-400 ml-auto text-xs';
      } catch (e) {
        document.getElementById('apiStatus').className = 'w-3 h-3 rounded-full bg-red-500';
        document.getElementById('apiStatusText').textContent = 'FAILED';
        document.getElementById('apiStatusText').className = 'text-red-400 ml-auto text-xs';
      }

      // Supabase check (via transactions API)
      try {
        const r = await fetch(API + '/api/barbers');
        const d = await r.json();
        document.getElementById('supabaseStatus').className = 'w-3 h-3 rounded-full bg-green-500';
        document.getElementById('supabaseStatusText').textContent = 'OK - ' + (d.barbers || []).length + ' barbers';
        document.getElementById('supabaseStatusText').className = 'text-green-400 ml-auto text-xs';
      } catch (e) {
        document.getElementById('supabaseStatus').className = 'w-3 h-3 rounded-full bg-red-500';
        document.getElementById('supabaseStatusText').textContent = 'FAILED';
        document.getElementById('supabaseStatusText').className = 'text-red-400 ml-auto text-xs';
      }

      // Webhook check
      try {
        const r = await fetch(API + '/api/webhook/fonnte');
        const d = await r.json();
        document.getElementById('webhookStatus').className = 'w-3 h-3 rounded-full bg-green-500';
        document.getElementById('webhookStatusText').textContent = 'OK - Webhook Active';
        document.getElementById('webhookStatusText').className = 'text-green-400 ml-auto text-xs';
      } catch (e) {
        document.getElementById('webhookStatus').className = 'w-3 h-3 rounded-full bg-red-500';
        document.getElementById('webhookStatusText').textContent = 'FAILED';
        document.getElementById('webhookStatusText').className = 'text-red-400 ml-auto text-xs';
      }
    }

    // Auto-run checks
    runChecks();
  </script>
</body>
</html>`
}
