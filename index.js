const express = require('express')
const path = require('path')
const axios = require('axios')
const cheerio = require('cheerio')
const https = require('https')

const BASE_URL = 'https://otakudesu.blog'
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.104 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
]

let uaIndex = 0

class CookieJar {
  constructor() {
    this.cookies = {}
  }

  update(headers) {
    const setCookie = headers['set-cookie']
    if (!setCookie) return
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
    for (const cookieStr of cookies) {
      const parts = cookieStr.split(';')[0].split('=')
      if (parts.length >= 2) {
        const key = parts[0].trim()
        const value = parts.slice(1).join('=').trim()
        this.cookies[key] = value
      }
    }
  }

  getString() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  }

  clear() {
    this.cookies = {}
  }
}

function randomDelay(min = 300, max = 800) {
  return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min))
}

function safeUrl(base, href) {
  if (!href) return null
  return href.startsWith('http') ? href : base + href
}

function getHeaders(ref = BASE_URL, cookie = '') {
  const ua = USER_AGENTS[uaIndex % USER_AGENTS.length]
  uaIndex++
  const isMobile = ua.includes('Mobile') || ua.includes('iPhone') || ua.includes('Android')
  const platform = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : 'Linux'
  const headers = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': ref || BASE_URL,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'DNT': '1',
    'Sec-Ch-Ua': `"${ua.includes('Chrome') ? 'Google Chrome' : 'Chromium'}"`,
    'Sec-Ch-Ua-Mobile': isMobile ? '?1' : '?0',
    'Sec-Ch-Ua-Platform': `"${platform}"`,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive'
  }
  if (cookie) headers['Cookie'] = cookie
  return headers
}

async function request(method, url, data = null, headers = {}, retries = 3) {
  let lastError
  for (let i = 0; i < retries; i++) {
    try {
      await randomDelay(150, 400)
      const config = {
        method,
        url,
        headers,
        timeout: 15000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true }),
        maxRedirects: 5,
        decompress: true,
        validateStatus: status => status >= 200 && status < 400
      }
      if (data && (method === 'POST' || method === 'PUT')) {
        config.data = data
      }
      return await axios(config)
    } catch (e) {
      lastError = e
      if (i < retries - 1) await randomDelay(600, 1200)
    }
  }
  throw lastError
}

class OtakudesuScraper {
  constructor() {
    this.base = BASE_URL
    this.creator = 'rynaqrtz'
    this.cookieJar = new CookieJar()
  }

  async _fetchHTML(url, retries = 3) {
    const headers = getHeaders(url, this.cookieJar.getString())
    const res = await request('GET', url, null, headers, retries)
    this.cookieJar.update(res.headers)
    return res.data
  }

  async _postAjax(payload, retries = 3) {
    const params = new URLSearchParams(payload)
    const url = `${this.base}/wp-admin/admin-ajax.php`
    const headers = {
      ...getHeaders(this.base, this.cookieJar.getString()),
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    }
    const res = await request('POST', url, params.toString(), headers, retries)
    this.cookieJar.update(res.headers)
    return res.data
  }

  _clean(obj) {
    if (obj === null || obj === undefined) return undefined
    if (Array.isArray(obj)) return obj.map(i => this._clean(i))
    if (typeof obj === 'object') {
      const result = {}
      for (const key of Object.keys(obj)) {
        const val = this._clean(obj[key])
        if (val !== undefined) result[key] = val
      }
      return Object.keys(result).length ? result : undefined
    }
    return obj
  }

  _buildResponse(page, url, data) {
    return this._clean({ creator: this.creator, page, url, data })
  }

  _parsePagination($) {
    const result = { current: 1, next: null, hasNext: false, total: null }
    const pageLinks = []
    $('.pagination a, .pagination span, .page-numbers, .pagenavix a, .pagenavix span').each((i, el) => {
      const href = $(el).attr('href')
      const text = $(el).text().trim()
      if (href) pageLinks.push({ text, href })
    })
    const numbers = pageLinks.filter(l => /^\d+$/.test(l.text)).map(l => parseInt(l.text))
    if (numbers.length) result.total = Math.max(...numbers)
    const current = $('.pagination .page-numbers.current, .pagenavix .page-numbers.current').first()
    if (current.length) {
      const t = current.text().trim()
      if (/^\d+$/.test(t)) result.current = parseInt(t)
    }
    if (result.total && result.current < result.total) {
      result.hasNext = true
      const nextLink = pageLinks.find(l => l.text === 'Next' || l.text === '»' || l.text.toLowerCase().includes('next'))
      if (nextLink) result.next = safeUrl(this.base, nextLink.href)
    }
    return result
  }

  _parseCardDetpost($, element) {
    const $el = $(element)
    const link = $el.find('.thumb a').attr('href')
    const title = $el.find('.jdlflm').text().trim()
    const poster = $el.find('.thumbz img').attr('src') || null
    const episode = $el.find('.epz').text().trim() || null
    const day = $el.find('.epztipe').text().trim() || null
    const date = $el.find('.newnime').text().trim() || null
    if (!link || !title) return null
    return { title, url: safeUrl(this.base, link), poster, episode, day, date }
  }

  _parseCardColAnime($, element) {
    const $el = $(element)
    const link = $el.find('.col-anime-title a').attr('href')
    const title = $el.find('.col-anime-title a').text().trim()
    const studio = $el.find('.col-anime-studio').text().trim() || null
    const eps = $el.find('.col-anime-eps').text().trim() || null
    const rating = $el.find('.col-anime-rating').text().trim() || null
    const genres = $el.find('.col-anime-genre a').map((_, a) => $(a).text()).get() || []
    const poster = $el.find('.col-anime-cover img').attr('src') || null
    const synopsis = $el.find('.col-synopsis p').text().trim() || null
    const season = $el.find('.col-anime-date').text().trim() || null
    if (!link || !title) return null
    return { title, url: safeUrl(this.base, link), studio, episodes: eps, rating, genres, poster, synopsis, season }
  }

  _parseGenreList($) {
    const genres = []
    $('.genres li a').each((i, el) => {
      const $el = $(el)
      const name = $el.text().trim()
      const link = $el.attr('href')
      if (name && link) {
        const slug = link.replace(/\/genres\/([^\/]+)\/?/, '$1')
        genres.push({ name, slug, url: safeUrl(this.base, link) })
      }
    })
    return genres
  }

  _parseSchedule($) {
    const schedule = {}
    $('.kglist321').each((i, el) => {
      const $el = $(el)
      const day = $el.find('h2').text().trim()
      const items = []
      $el.find('ul li a').each((j, a) => {
        const $a = $(a)
        const href = $a.attr('href')
        const title = $a.text().trim()
        if (href && title) items.push({ title, url: safeUrl(this.base, href) })
      })
      if (day && items.length) schedule[day] = items
    })
    return schedule
  }

  _parseEpisodeList($) {
    const episodes = []
    $('.episodelist ul li').each((i, el) => {
      const $el = $(el)
      const $a = $el.find('a')
      const title = $a.text().trim()
      const href = $a.attr('href')
      const date = $el.find('.zeebr').text().trim() || null
      if (href && title) {
        const match = href.match(/\/episode\/([^\/]+)\/?$/)
        episodes.push({
          title,
          episodeId: match ? match[1] : null,
          url: safeUrl(this.base, href),
          releaseDate: date
        })
      }
    })
    return episodes
  }

  _extractPostId($) {
    const ids = new Set()
    $('[data-content]').each((i, el) => {
      const content = $(el).attr('data-content')
      if (content) {
        try {
          const decoded = Buffer.from(content, 'base64').toString('utf-8')
          const parsed = JSON.parse(decoded)
          if (parsed.id) ids.add(parsed.id)
        } catch (e) {}
      }
    })
    $('[id^="post-"]').each((i, el) => {
      const id = $(el).attr('id')
      const match = id.match(/post-(\d+)/)
      if (match) ids.add(parseInt(match[1]))
    })
    const html = $.html()
    const scriptMatches = html.match(/post[_\s]*id[_\s]*[:=]\s*["']?(\d+)["']?/gi)
    if (scriptMatches) {
      scriptMatches.forEach(m => {
        const num = m.match(/\d+/)
        if (num) ids.add(parseInt(num[0]))
      })
    }
    return ids.size > 0 ? [...ids][0] : null
  }

  async _getNonce() {
    try {
      const res = await this._postAjax({ action: 'aa1208d27f29ca340c92c66d1926f13f' })
      return res && res.data ? res.data : null
    } catch (e) {
      return null
    }
  }

  async _getStreamUrl(postId, index, quality, nonce) {
    const payload = { action: '2a3505c93b0035d3f455df82bf976b84', id: postId, i: index, q: quality, nonce }
    try {
      const res = await this._postAjax(payload)
      if (!res || !res.data) return null
      const html = Buffer.from(res.data, 'base64').toString('utf-8')
      const $ = cheerio.load(html)
      return $('iframe').attr('src') || null
    } catch (e) {
      return null
    }
  }

  async _extractStreams(html) {
    const $ = cheerio.load(html)
    const postId = this._extractPostId($)
    if (!postId) return {}
    const nonce = await this._getNonce()
    if (!nonce) return {}
    const streams = {}
    $('.mirrorstream ul').each((i, ul) => {
      const $ul = $(ul)
      $ul.find('a').each((j, a) => {
        const $a = $(a)
        const dataContent = $a.attr('data-content')
        if (dataContent) {
          try {
            const decoded = Buffer.from(dataContent, 'base64').toString('utf-8')
            const parsed = JSON.parse(decoded)
            if (parsed.id === postId) {
              const key = `${parsed.q}_${$a.text().trim()}`
              streams[key] = { postId, i: parsed.i, q: parsed.q, nonce }
            }
          } catch (e) {}
        }
      })
    })
    const result = {}
    for (const [key, params] of Object.entries(streams)) {
      const url = await this._getStreamUrl(params.postId, params.i, params.q, params.nonce)
      if (url) result[key] = url
    }
    return result
  }

  _parseDownloads($) {
    const downloads = []
    $('.download ul').each((i, ul) => {
      const $ul = $(ul)
      const group = $ul.prev('h4').text().trim() || $ul.prev('strong').text().trim() || 'Download'
      const items = []
      $ul.find('li').each((j, li) => {
        const $li = $(li)
        const resolution = $li.find('strong').text().trim() || null
        const size = $li.find('i').text().trim() || null
        const links = []
        $li.find('a').each((k, a) => {
          const $a = $(a)
          const href = $a.attr('href')
          if (href) links.push({ host: $a.text().trim(), url: href })
        })
        if (links.length) items.push({ resolution, size, links })
      })
      if (items.length) downloads.push({ group, items })
    })
    return downloads
  }

  _parseNav($) {
    const findLink = keywords => {
      let found = null
      $('.prevnext .flir a').each((i, el) => {
        const text = $(el).text().trim().toLowerCase()
        if (!found && keywords.some(k => text.includes(k))) found = $(el).attr('href') || null
      })
      return found
    }
    return {
      prev: findLink(['sebelumnya', 'prev']),
      all: findLink(['semua episode', 'see all', 'all episode']),
      next: findLink(['selanjutnya', 'next'])
    }
  }

  async home() {
    const url = this.base + '/'
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const items = []
    $('.detpost:has(.epz:contains("Episode"))').each((i, el) => {
      const card = this._parseCardDetpost($, el)
      if (card) items.push(card)
    })
    return this._buildResponse('home', url, { items })
  }

  async ongoing(page = 1) {
    const url = page === 1 ? this.base + '/ongoing-anime/' : this.base + `/ongoing-anime/page/${page}/`
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const items = []
    $('.detpost').each((i, el) => {
      const card = this._parseCardDetpost($, el)
      if (card) items.push(card)
    })
    const pagination = this._parsePagination($)
    return this._buildResponse('ongoing', url, { pagination, items })
  }

  async complete(page = 1) {
    const url = page === 1 ? this.base + '/complete-anime/' : this.base + `/complete-anime/page/${page}/`
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const items = []
    $('.detpost').each((i, el) => {
      const card = this._parseCardDetpost($, el)
      if (card) items.push(card)
    })
    const pagination = this._parsePagination($)
    return this._buildResponse('complete', url, { pagination, items })
  }

  async genreList() {
    const url = this.base + '/genre-list/'
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const genres = this._parseGenreList($)
    return this._buildResponse('genreList', url, { genres })
  }

  async genre(slug, page = 1) {
    const safeSlug = encodeURIComponent(slug)
    const url = page === 1 ? this.base + `/genres/${safeSlug}/` : this.base + `/genres/${safeSlug}/page/${page}/`
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const items = []
    $('.col-anime-con').each((i, el) => {
      const card = this._parseCardColAnime($, el)
      if (card) items.push(card)
    })
    const pagination = this._parsePagination($)
    return this._buildResponse('genre', url, { slug, pagination, items })
  }

  async jadwalRilis() {
    const url = this.base + '/jadwal-rilis/'
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const schedule = this._parseSchedule($)
    return this._buildResponse('jadwalRilis', url, { schedule })
  }

  async search(query) {
    const url = `${this.base}/?s=${encodeURIComponent(query)}&post_type=anime`
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const items = []
    $('.chivsrc li').each((i, el) => {
      const $el = $(el)
      const link = $el.find('h2 a').attr('href')
      const title = $el.find('h2 a').text().trim()
      const poster = $el.find('img').attr('src') || null
      const genres = $el.find('.set:first-child a').map((_, a) => $(a).text()).get() || []
      const status = $el.find('.set:nth-child(2)').text().replace('Status :', '').trim() || null
      const ratingEl = $el.find('.set:contains("Rating")')
      const rating = ratingEl.length ? ratingEl.text().replace('Rating :', '').trim() : null
      if (link && title) {
        items.push({ title, url: safeUrl(this.base, link), poster, genres, status, rating })
      }
    })
    return this._buildResponse('search', url, { query, items })
  }

  async detail(slug) {
    const url = this.base + `/anime/${encodeURIComponent(slug)}/`
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const title = $('.jdlrx h1').text().trim() || $('title').text().trim()
    const poster = $('.fotoanime img').attr('src') || null
    const sinopsis = $('.sinopc p').text().trim() || null
    const info = {}
    $('.infozin .infozingle p').each((i, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      if (text.includes('Genre')) {
        const genreLinks = $el.find('a').map((_, a) => $(a).text()).get()
        info.genre = genreLinks.length ? genreLinks.join(', ') : null
        return
      }
      const parts = text.split(':')
      if (parts.length >= 2) {
        const key = parts[0].replace(/\s/g, '_').toLowerCase()
        const value = parts.slice(1).join(':').trim()
        if (key) info[key] = value
      }
    })
    const episodes = this._parseEpisodeList($)
    const recommendations = []
    $('.isi-recommend-anime-series .isi-konten').each((i, el) => {
      const $el = $(el)
      const link = $el.find('.judul-anime a').attr('href')
      const titleRec = $el.find('.judul-anime a').text().trim()
      const posterRec = $el.find('.gambar-konten img').attr('src') || null
      if (link && titleRec) {
        recommendations.push({ title: titleRec, url: safeUrl(this.base, link), poster: posterRec })
      }
    })
    return this._buildResponse('detail', url, { title, poster, sinopsis, info, episodes, recommendations })
  }

  async episode(slug) {
    const url = this.base + `/episode/${encodeURIComponent(slug)}/`
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const title = $('h1.posttl').text().trim() || $('title').text().trim()
    const streams = await this._extractStreams(html)
    const downloads = this._parseDownloads($)
    const nav = this._parseNav($)
    const otherEpisodes = this._parseEpisodeList($)
    const data = { title, streams, downloads, nav }
    if (otherEpisodes.length) data.otherEpisodes = otherEpisodes
    return this._buildResponse('episode', url, data)
  }

  async batch(slug) {
    const url = this.base + `/lengkap/${encodeURIComponent(slug)}/`
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const title = $('.jdlrx h1').text().trim() || $('title').text().trim()
    const downloads = this._parseDownloads($)
    return this._buildResponse('batch', url, { title, downloads })
  }

  async watch(slug) {
    const url = this.base + `/episode/${encodeURIComponent(slug)}/`
    const html = await this._fetchHTML(url)
    const $ = cheerio.load(html)
    const title = $('h1.posttl').text().trim() || $('title').text().trim()
    const streams = await this._extractStreams(html)
    const downloads = this._parseDownloads($)
    const nav = this._parseNav($)
    return this._buildResponse('watch', url, { title, streams, downloads, nav })
  }

  resetCookie() {
    this.cookieJar.clear()
  }
}

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

function sortDays(days) {
  return days.sort((a, b) => {
    const ia = DAY_ORDER.indexOf(a)
    const ib = DAY_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
}

function buildScheduleFromRaw(rawSchedule) {
  const schedule = []
  const days = sortDays(Object.keys(rawSchedule || {}))
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

class Wibukon {
  constructor() {
    this.scraper = new OtakudesuScraper()
  }

  async fetchHomeData() {
    const results = await Promise.allSettled([
      this.scraper.ongoing(1),
      this.scraper.complete(1),
      this.scraper.jadwalRilis()
    ])

    const [ongoingResult, completeResult, jadwalResult] = results
    const failures = results.filter(r => r.status === 'rejected')

    if (failures.length === results.length) {
      throw failures[0].reason
    }

    const ongoing = ongoingResult.status === 'fulfilled'
      ? ongoingResult.value.data.items.map(c => normalizeCard(c, 'Ongoing'))
      : []
    const recommend = completeResult.status === 'fulfilled'
      ? completeResult.value.data.items.map(c => normalizeCard(c, 'Completed'))
      : []
    const schedule = jadwalResult.status === 'fulfilled'
      ? buildScheduleFromRaw(jadwalResult.value.data.schedule)
      : []

    return { ongoing, recommend, schedule }
  }

  async fetchSchedule() {
    const jadwalRes = await this.scraper.jadwalRilis()
    return buildScheduleFromRaw(jadwalRes.data.schedule)
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
      year: extractYear(info.tanggal_rilis || ''),
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
    console.error('[GET /] gagal memuat beranda:', error.message)
    res.status(502).render('error', {
      error: `Gagal memuat data beranda dari Otakudesu (${error.message}). Situs sumber mungkin sedang memblokir permintaan, berganti domain, atau strukturnya berubah.`
    })
  }
})

app.get('/schedule', async (req, res) => {
  try {
    const schedule = await wibukon.fetchSchedule()
    res.render('schedule', { schedule, active: 'schedule' })
  } catch (error) {
    console.error('[GET /schedule] gagal memuat jadwal:', error.message)
    res.status(502).render('error', { error: `Gagal memuat jadwal rilis (${error.message}).` })
  }
})

app.get('/search', async (req, res) => {
  const query = (req.query.q || '').trim()
  if (!query) return res.redirect('/')

  try {
    const results = await wibukon.search(query)
    res.render('search', { data: results, active: 'search', query })
  } catch (error) {
    console.error('[GET /search] gagal mencari:', error.message)
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
    console.error(`[GET /anime/${req.params.slug}] gagal memuat detail:`, error.message)
    res.status(404).render('error', { error: `Anime tidak ditemukan atau sedang tidak dapat diakses (${error.message}).` })
  }
})

app.get('/watch/:animeSlug/:epsSlug', async (req, res) => {
  const { animeSlug, epsSlug } = req.params
  let anime
  try {
    anime = await wibukon.detail(animeSlug)
  } catch (error) {
    console.error(`[GET /watch] gagal memuat anime ${animeSlug}:`, error.message)
    return res.status(404).render('error', { error: `Anime tidak ditemukan atau sedang tidak dapat diakses (${error.message}).` })
  }

  let streamUrl = null
  try {
    streamUrl = await wibukon.stream(epsSlug)
  } catch (error) {
    console.error(`[GET /watch] gagal memuat stream ${epsSlug}:`, error.message)
    streamUrl = null
  }

  res.render('watch', { url: streamUrl, anime, currentEps: epsSlug, active: 'home' })
})

app.use((req, res) => {
  res.status(404).render('404', { active: '' })
})

app.use((err, req, res, next) => {
  console.error('[unhandled error]', err)
  res.status(500).render('error', { error: 'Terjadi kesalahan pada server.' })
})

if (require.main === module) {
  app.listen(port, () => {
    console.log(`WibuKon berjalan di http://localhost:${port}`)
  })
}

module.exports = app
