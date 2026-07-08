const express = require('express')
const axios = require('axios')
const path = require('path')

class Mobinime {
    constructor() {
        this.inst = axios.create({
            baseURL: 'https://air.vunime.my.id/mobinime',
            headers: {
                'accept-encoding': 'gzip',
                'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
                host: 'air.vunime.my.id',
                'user-agent': 'Dart/3.3 (dart:io)',
                'x-api-key': 'ThWmZq4t7w!z%C*F-JaNdRgUkXn2r5u8'
            }
        })
    }

    normalizeAnimeData(item) {
        return {
            id: item.id,
            title: item.title,
            img: item.image_cover || item.imageCover || item.image_video || '',
            eps: item.episode || item.total_episode || '?',
            rating: item.rating || '-',
            year: item.tahun || '',
            status: item.status_tayang === '1' ? 'Ongoing' : 'Completed'
        }
    }

    fetchHomeData = async function () {
        try {
            const { data } = await this.inst.get('/pages/homepage')
            
            const result = {
                recommend: data.recommend.map(this.normalizeAnimeData),
                ongoing: data.ongoing.map(this.normalizeAnimeData),
                schedule: []
            }

            if (data.schedule) {
                Object.keys(data.schedule).forEach(day => {
                    const dayName = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
                    result.schedule.push({
                        day: dayName[parseInt(day) - 1] || 'Lainnya',
                        list: data.schedule[day].map(this.normalizeAnimeData)
                    })
                })
            }

            return result
        } catch (error) {
            throw new Error(error.message)
        }
    }

    search = async function (query, { page = '0', count = '25' } = {}) {
        try {
            const { data } = await this.inst.post('/anime/search', {
                perpage: count.toString(),
                startpage: page.toString(),
                q: query
            })
            return data.map(this.normalizeAnimeData)
        } catch (error) {
            return []
        }
    }

    detail = async function (id) {
        try {
            const { data } = await this.inst.post('/anime/detail', { id: id.toString() })
            
            return {
                id: data.id,
                title: data.title,
                img: data.image_cover || data.image_video,
                desc: data.content, 
                rating: data.rating,
                year: data.tahun,
                status: data.status_tayang === '1' ? 'Ongoing' : 'Completed',
                genres: data.categories || [],
                episodes: data.episodes ? data.episodes.map(e => ({
                    id: e.id,
                    title: `Episode ${e.episode}`
                })) : []
            }
        } catch (error) {
            throw new Error(error.message)
        }
    }

    stream = async function (id, epsid, { quality = 'HD' } = {}) {
        try {
            const { data: srv } = await this.inst.post('/anime/get-server-list', {
                id: epsid.toString(),
                animeId: id.toString(),
                jenisAnime: '1',
                userId: ''
            })

            const { data } = await this.inst.post('/anime/get-url-video', {
                url: srv.serverurl,
                quality: quality,
                position: '0'
            })

            if (!data?.url) throw new Error('Stream url unavailable')
            return data.url
        } catch (error) {
            throw new Error(error.message)
        }
    }
}

const app = express()
const port = 3000
const mobinime = new Mobinime()

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.use(express.static('public'))
app.use(express.urlencoded({ extended: true }))

app.get('/', async (req, res) => {
    try {
        const homeData = await mobinime.fetchHomeData()
        res.render('index', { 
            data: homeData, 
            active: 'home',
            query: null 
        })
    } catch (error) {
        res.render('error', { error: error.message })
    }
})

app.get('/schedule', async (req, res) => {
    try {
        const homeData = await mobinime.fetchHomeData()
        res.render('schedule', {
            schedule: homeData.schedule,
            active: 'schedule'
        })
    } catch (error) {
        res.render('error', { error: error.message })
    }
})

app.get('/search', async (req, res) => {
    try {
        const query = req.query.q
        if (!query) return res.redirect('/')
        
        const searchResults = await mobinime.search(query)
        res.render('search', { 
            data: searchResults, 
            active: 'search',
            query: query 
        })
    } catch (error) {
        res.render('search', { 
            data: [], 
            active: 'search',
            query: req.query.q 
        })
    }
})

app.get('/about', async (req, res) => {
    try {
        res.render('about', { 
            active: 'about' 
        })
    } catch (error) {
        res.render('error', { error: error.message })
    }
})

app.get('/anime/:id', async (req, res) => {
    try {
        const detailData = await mobinime.detail(req.params.id)
        res.render('detail', { anime: detailData, active: 'home' })
    } catch (error) {
        res.render('error', { error: error.message })
    }
})

app.get('/watch/:animeId/:epsId', async (req, res) => {
    try {
        const { animeId, epsId } = req.params
        const streamUrl = await mobinime.stream(animeId, epsId)
        const detailData = await mobinime.detail(animeId)
        
        res.render('watch', { 
            url: streamUrl, 
            anime: detailData, 
            currentEps: epsId,
            active: 'home'
        })
    } catch (error) {
        res.render('error', { error: error.message })
    }
})

app.use((req, res) => {
    res.status(404).render('404', { active: '' })
})

app.listen(port, () => {
    console.log(`WibuKon running at http://localhost:${port}`)
})
