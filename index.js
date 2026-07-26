const express = require('express')
const path = require('path')
const OtakudesuScraper = require('./lib/otakudesu')

const DAY_ORDER = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const FALLBACK_IMG = '/wibukon.jpg'

function extractSlug(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : ''
  } catch (e) {
    return ''
  }
}

function extractNumber(text) {
  if (!text) return '?'
  const match = String(text).match(/\d+/)
  return match ? match[0] : '?'
}

function extractYear(text) {
  if (!text) return ''
  const match = String(text).match(/\d{4}/)
  return match ? match[0] : ''
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDesc(text) {
  if (!text) return 'Sinopsis tidak tersedia.'
  return escapeHtml(text).replace(/\n+/g, '<br><br>')
}

function normalizeCard(card, statusHint) {
  return {
    id: extractSlug(card.url),
    title: card.title,
    img: card.poster || FALLBACK_IMG,
    eps: extractNumber(card.episode || card.episodes),
    rating: card.rating || '-',
    year: extractYear(card.date || card.season),
    status: statusHint
  }
}

class Wibukon {
  constructor() {
    this.scraper = new OtakudesuScraper()
  }

  async fetchHomeData() {
    const [ongoingRes, completeRes, jadwalRes] = await Promise.all([
      this.scraper.ongoing(1),
      this.scraper.complete(1),
      this.scraper.jadwalRilis()
    ])

    const ongoing = ongoingRes.data.items.map(c => normalizeCard(c, 'Ongoing'))
    const recommend = completeRes.data.items.map(c => normalizeCard(c, 'Completed'))

    const schedule = []
    const rawSchedule = jadwalRes.data.schedule || {}
    const days = Object.keys(rawSchedule).sort((a, b) => {
      const ia = DAY_ORDER.indexOf(a)
      const ib = DAY_ORDER.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    days.forEach(day => {
      schedule.push({
        day,
        list: rawSchedule[day].map(item => ({
          id: extractSlug(item.url),
          title: item.title,
          img: FALLBACK_IMG
        }))
      })
    })

    return { ongoing, recommend, schedule }
  }

  async fetchSchedule() {
    const jadwalRes = await this.scraper.jadwalRilis()
    const rawSchedule = jadwalRes.data.schedule || {}
    const schedule = []
    const days = Object.keys(rawSchedule).sort((a, b) => {
      const ia = DAY_ORDER.indexOf(a)
      const ib = DAY_ORDER.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    days.forEach(day => {
      schedule.push({
        day,
        list: rawSchedule[day].map(item => ({
          id: extractSlug(item.url),
          title: item.title,
          img: FALLBACK_IMG
        }))
      })
    })
    return schedule
  }

  async search(query) {
    const res = await this.scraper.search(query)
    return res.data.items.map(item => ({
      id: extractSlug(item.url),
      title: item.title,
      img: item.poster || FALLBACK_IMG,
      eps: '-',
      rating: item.rating || '-',
      year: '',
      status: item.status || '-'
    }))
  }

  async detail(slug) {
    const res = await this.scraper.detail(slug)
    const d = res.data
    const info = d.info || {}

    const genreNames = info.genre ? info.genre.split(',').map(g => g.trim()).filter(Boolean) : []
    const genres = genreNames.map(name => ({ title: name }))

    const episodes = (d.episodes || [])
      .filter(e => e.episodeId)
      .map(e => ({ id: e.episodeId, title: e.title, number: parseInt(extractNumber(e.title), 10) || 0 }))
      .sort((a, b) => a.number - b.number)

    return {
      id: slug,
      title: d.title,
      img: d.poster || FALLBACK_IMG,
      desc: formatDesc(d.sinopsis),
      rating: info.skor || info.rating || '-',
      year: extractYear(info.tanggal_rilis || info.tanggal_rilis_ || ''),
      status: info.status || '-',
      genres,
      episodes
    }
  }

  async stream(epsSlug) {
    const res = await this.scraper.episode(epsSlug)
    const streams = res.data.streams || {}
    const entries = Object.entries(streams)
    if (!entries.length) return null

    const qualityRank = q => {
      const n = parseInt(String(q).match(/\d+/), 10)
      return isNaN(n) ? 0 : n
    }
    entries.sort((a, b) => qualityRank(b[0]) - qualityRank(a[0]))
    return entries[0][1]
  }
}

const app = express()
const port = process.env.PORT || 3000
const wibukon = new Wibukon()

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.use(express.static(path.join(__dirname, 'public')))
app.use(express.urlencoded({ extended: true }))

app.get('/', async (req, res) => {
  try {
    const homeData = await wibukon.fetchHomeData()
    res.render('index', { data: homeData, active: 'home', query: null })
  } catch (error) {
    res.status(502).render('error', { error: 'Gagal memuat data beranda. Coba lagi beberapa saat.' })
  }
})

app.get('/schedule', async (req, res) => {
  try {
    const schedule = await wibukon.fetchSchedule()
    res.render('schedule', { schedule, active: 'schedule' })
  } catch (error) {
    res.status(502).render('error', { error: 'Gagal memuat jadwal rilis. Coba lagi beberapa saat.' })
  }
})

app.get('/search', async (req, res) => {
  const query = (req.query.q || '').trim()
  if (!query) return res.redirect('/')

  try {
    const results = await wibukon.search(query)
    res.render('search', { data: results, active: 'search', query })
  } catch (error) {
    res.render('search', { data: [], active: 'search', query })
  }
})

app.get('/about', (req, res) => {
  res.render('about', { active: 'about' })
})

app.get('/anime/:slug', async (req, res) => {
  try {
    const anime = await wibukon.detail(req.params.slug)
    res.render('detail', { anime, active: 'home' })
  } catch (error) {
    res.status(404).render('error', { error: 'Anime tidak ditemukan atau sedang tidak dapat diakses.' })
  }
})

app.get('/watch/:animeSlug/:epsSlug', async (req, res) => {
  const { animeSlug, epsSlug } = req.params
  let anime
  try {
    anime = await wibukon.detail(animeSlug)
  } catch (error) {
    return res.status(404).render('error', { error: 'Anime tidak ditemukan atau sedang tidak dapat diakses.' })
  }

  let streamUrl = null
  try {
    streamUrl = await wibukon.stream(epsSlug)
  } catch (error) {
    streamUrl = null
  }

  res.render('watch', { url: streamUrl, anime, currentEps: epsSlug, active: 'home' })
})

app.use((req, res) => {
  res.status(404).render('404', { active: '' })
})

app.use((err, req, res, next) => {
  res.status(500).render('error', { error: 'Terjadi kesalahan pada server.' })
})

app.listen(port, () => {
  console.log(`WibuKon berjalan di http://localhost:${port}`)
})
