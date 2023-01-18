import { launch } from 'puppeteer'
import express from 'express'
import fs from 'fs'
import https from 'https'
import { WebSocketServer } from 'ws'

const vars = JSON.parse(fs.readFileSync('vars.json'))

var prio_queue = []
var prio_c = []

var wss = new Map()
const maxcx = 5
var cx = 0

const browser = await launch({ args: ['--no-sandbox'] })
let page = await browser.newPage()
await page.goto(vars.izly_url)
await page.click('.mat-raised-button[name="privacy_pref"]')
await page.close()

// set up websocket server
const server = https.createServer({
    key: fs.readFileSync(vars.ssl_key),
    cert: fs.readFileSync(vars.ssl_cert)
})
const wserv = new WebSocketServer({ server })
wserv.on('connection', (ws, req) => {
    let url = new URL(req.url, 'http://a')
    let tk = url.searchParams.get('tk')
    console.log(tk)
    if (wss.get(tk) == null) {
        wss.set(tk, ws)
    }
    else ws.close()
})
server.listen(vars.websocket_port)

// set up http server
var app = express()
app.get('/', async function (req, res) {
    // get parameters
    let username = req.query.username
    let password = req.query.password
    let p = req.query.p

    // check prio
    let prio = vars.prio_codes.includes(p)

    // generate token for websocket and filling html page
    let tk = Math.random().toString(36).substring(2, 15)
    let html = fs.readFileSync('page.html', 'utf8')
        .replace('{ $url }', vars.websocket_url + 'tk=' + tk)
        .replace('{ $bus }', prio.toString())
    wss.set(tk, null)

    // send response
    res.send(html)

    // connect to websocket
    var t = 0
    var ws = null
    while (ws == null) {
        ws = wss.get(tk)
        t++
        if (t > vars.max_websocket_tries) {
            console.log("connection to websocket timed out")
            return
        }
        await new Promise(r => setTimeout(r, 100));
    }

    // check numbers of connections and queue
    let process = true
    if (cx >= maxcx || prio_queue.length > 0) {
        if (prio) {
            ws.send(JSON.stringify({
                msg: 'feu',
                data: 'r'
            }))
            prio_queue.push(tk)
            while (cx >= maxcx || prio_queue.indexOf(tk) > 0) {
                await new Promise(r => setTimeout(r, 100));
            }
            removeItemOnce(prio_queue, tk)
            prio_c.push(tk)
            var rmprioc = true
        } else {
            process = false
            if (prio_queue.length > 0 && prio_c.length == 0) {
                ws.send(JSON.stringify({
                    msg: 'feu',
                    data: 'o'
                }))
                while (prio_c.length == 0) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }
            ws.send(JSON.stringify({
                msg: 'feu',
                data: 'r'
            }))
        }
    }

    // get qr code
    if (process) {
        cx++
        ws.send(JSON.stringify({
            msg: 'feu',
            data: 'g'
        }))
        let r = await getQRCode(username, password)
        ws.send(JSON.stringify({
            msg: 'qr',
            data: r ?? "null"
        }))
        if (rmprioc) {
            removeItemOnce(prio_c, tk)
        }
        cx--
    }

    // close websocket
    ws.close()
    wss.delete(tk)
    console.log(tk + ' deleted')
})
console.log('listenning on port ' + vars.server_port)
app.listen(vars.server_port)

// util functions :

async function getQRCode(username, password) {
    try {
        // open webpage and set timeout
        let page = await browser.newPage()
        page.setDefaultTimeout(vars.browser_timeout);
        await page.goto(vars.izly_url)

        // login
        await page.focus('input[name=Username]')
        await page.keyboard.type(username)
        for (let c of password) {
            await page.click('.digit[data-id="' + c + '"]')
        }
        await page.click('button[type="submit"]')
        await page.waitForSelector('.nav-link[title="Payer"]')

        // get balance
        let thune = await page.$eval('#balance', el => el.textContent.trim())

        // get user name
        await page.$eval('.my-3', el => el.click())
        await page.waitForSelector('.header')
        let name = await page.$eval('.header', el => el.children[0].textContent)

        // get qr code
        await page.$eval('.nav-link[title="Payer"]', el => el.click())
        await page.waitForSelector('.generateOneQrCode[title="Générer 1 QR Code"]')
        await page.click('.generateOneQrCode[title="Générer 1 QR Code"]')
        await page.waitForSelector('.img-fluid')
        let d = await page.$eval('.img-fluid', img => img.getAttribute("src"))

        // close webpage
        page.close()
        return {
            name: name,
            thune: thune,
            qr: d
        }
    } catch (e) {
        console.log(e)
        return null
    }
}

function removeItemOnce(arr, value) {
    var index = arr.indexOf(value);
    if (index > -1) {
        arr.splice(index, 1);
    }
    return arr;
}