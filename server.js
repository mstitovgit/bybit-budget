require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const DAILY_LIMIT = 160;

async function fetchCardTransactions(type) {
    const timestamp = Date.now().toString();
    const body = JSON.stringify({ type });
    const sig = crypto
        .createHmac('sha256', process.env.API_SECRET)
        .update(timestamp + process.env.API_KEY + '5000' + body)
        .digest('hex');
    const res = await axios.post(
        'https://api.bybit.com/v5/card/transaction/query-asset-records?limit=100&page=1',
        { type },
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
    return res.data.result?.data || [];
}

app.get('/budget', async (req, res) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const records = await fetchCardTransactions('SIDE_QUERY_AUTH');

        const todayRecords = records.filter(
            (t) => Number(t.txnCreate) >= todayStart.getTime()
        );

        const spent = todayRecords.reduce(
            (sum, t) => sum + parseFloat(t.basicAmount || 0),
            0
        );

        res.json({
            limit: DAILY_LIMIT,
            spent: parseFloat(spent.toFixed(2)),
            remaining: parseFloat((DAILY_LIMIT - spent).toFixed(2)),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`GET http://localhost:${PORT}/budget`);
});
