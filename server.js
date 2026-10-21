const express = require('express');
const cors = require('cors');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",   // builder.config.js inline scripts
                    'cdn.jsdelivr.net',
                    'cdnjs.cloudflare.com',
                    'unpkg.com',
                    'twemoji.maxcdn.com',
                ],
                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    'cdn.jsdelivr.net',
                    'cdnjs.cloudflare.com',
                ],
                imgSrc: ["'self'", 'data:', 'https:'],
                connectSrc: ["'self'"],
                fontSrc: ["'self'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'],
                scriptSrcAttr: ["'unsafe-inline'"],  // img onload= handlers in generated embed HTML
            },
        },
    })
);

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors());

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again in a minute.' },
});

const webhookSendLimiter = rateLimit({
    windowMs: 10 * 1000,  // 10 seconds
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Please wait before sending another webhook message.' },
});

app.use(globalLimiter);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// ── Static assets ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Helpers ───────────────────────────────────────────────────────────────────
const DISCORD_WEBHOOK_RE = /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

function isValidWebhookUrl(url) {
    if (typeof url !== 'string') return false;
    return DISCORD_WEBHOOK_RE.test(url.split('?')[0]);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Home
app.get('/', (req, res, next) => {
    try {
        res.render('index', { imgbbKey: process.env.IMGBB_API_KEY || '' });
    } catch (err) {
        next(err);
    }
});

// GET /api/webhook-info — fetch webhook metadata (name, avatar) for the preview
app.get('/api/webhook-info', async (req, res, next) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'Webhook URL is required.' });
        }
        if (!isValidWebhookUrl(url)) {
            return res.status(400).json({ error: 'Invalid Discord webhook URL.' });
        }

        const response = await axios.get(url, { timeout: 5000 });

        if (!response.data) {
            return res.status(400).json({ error: 'Invalid webhook response.' });
        }

        const { id, name, avatar, channel_id, guild_id } = response.data;
        res.json({
            name,
            avatar_url: avatar
                ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            channel_id,
            guild_id,
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/send-webhook — send an embed to a Discord webhook
app.post('/api/send-webhook', webhookSendLimiter, async (req, res, next) => {
    try {
        const { url, embedData } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'Webhook URL is required.' });
        }
        if (!isValidWebhookUrl(url)) {
            return res.status(400).json({ error: 'Invalid Discord webhook URL.' });
        }
        if (!embedData || typeof embedData !== 'object') {
            return res.status(400).json({ error: 'embedData must be an object.' });
        }

        await axios.post(url, embedData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
        });

        res.json({ success: true });
    } catch (err) {
        if (err.response) {
            // Discord returned an error
            return res.status(err.response.status).json({
                error: err.response.data?.message || 'Discord rejected the webhook.',
            });
        }
        next(err);
    }
});

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use((err, req, res, next) => {  // eslint-disable-line no-unused-vars
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Discord Embed Builder running at http://localhost:${PORT}`);
});
