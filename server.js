require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const DAILY_LIMIT = parseFloat(process.env.DAILY_LIMIT || 25);
const WEEKLY_LIMIT = DAILY_LIMIT * 7;

// Cache to avoid rate limits
let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 60_000; // 1 minute

async function getTransactions() {
    if (Date.now() - cache.fetchedAt < CACHE_TTL && cache.data) {
        return cache.data;
    }

    const timestamp = Date.now().toString();
    const body = JSON.stringify({ type: 'SIDE_QUERY_AUTH' });
    const sig = crypto
        .createHmac('sha256', process.env.API_SECRET)
        .update(timestamp + process.env.API_KEY + '5000' + body)
        .digest('hex');
    const res = await axios.post(
        'https://api.bybit.com/v5/card/transaction/query-asset-records?limit=100&page=1',
        { type: 'SIDE_QUERY_AUTH' },
        {
            headers: {
                'X-BAPI-API-KEY': process.env.API_KEY,
                'X-BAPI-SIGN': sig,
                'X-BAPI-TIMESTAMP': timestamp,
                'X-BAPI-RECV-WINDOW': '5000',
                'Content-Type': 'application/json',
            },
        }
    );

    const data = res.data.result?.data || [];
    cache = { data, fetchedAt: Date.now() };
    return data;
}

function getMondayStart() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon ...
    const daysFromMonday = (day === 0 ? 6 : day - 1);
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    return monday;
}

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function sumSpent(records, from, to) {
    return parseFloat(
        records
            .filter((t) => Number(t.txnCreate) >= from && Number(t.txnCreate) < to)
            .reduce((s, t) => s + parseFloat(t.basicAmount || 0), 0)
            .toFixed(2)
    );
}

app.get('/budget', async (req, res) => {
    try {
        const records = await getTransactions();

        const now = new Date();
        const todayStart = startOfDay(now).getTime();
        const tomorrowStart = todayStart + 86_400_000;
        const mondayStart = getMondayStart().getTime();

        const dailySpent = sumSpent(records, todayStart, tomorrowStart);
        const weeklySpent = sumSpent(records, mondayStart, Date.now() + 1);

        // Days of current week (Mon–today)
        const days = [];
        const monday = getMondayStart();
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            if (d > now) break;
            const from = startOfDay(d).getTime();
            const to = from + 86_400_000;
            const spent = sumSpent(records, from, to);
            const diff = parseFloat((DAILY_LIMIT - spent).toFixed(2));
            days.push({
                date: d.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' }),
                spent,
                saved: diff > 0 ? diff : 0,
                overspent: diff < 0 ? parseFloat((-diff).toFixed(2)) : 0,
            });
        }

        const dailyRemaining = parseFloat((DAILY_LIMIT - dailySpent).toFixed(2));
        const weeklyRemaining = parseFloat((WEEKLY_LIMIT - weeklySpent).toFixed(2));

        res.json({ budget: `$${dailyRemaining}/$${weeklyRemaining}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
