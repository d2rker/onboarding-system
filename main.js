const http = require('http');
const path = require('path');
const fs = require('fs').promises;

const port = process.env.PORT || 3000;
const onboardingFile = path.join(__dirname, 'data', 'onboarding_list.json');
const dispatchedFile = path.join(__dirname, 'data', 'ob_kit_dispatched.json');
const orderFile = path.join(__dirname, 'data', 'order_status.json');
const onboardingPendingFile = path.join(__dirname, 'data', 'onboarding_pending.json');

// Helpers for reading/writing JSON files
async function readJsonFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        if (!data || !data.trim()) return [];
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

async function writeJsonFile(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}



const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/g, '') || '/';

    // helper to send JSON responses
    const sendJSON = (statusCode, payload) => {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
    };

    try {
        // --- GET: Onboarding List (Approved/Ready for kit) ---
        if (pathname === '/api/onboarding' && req.method === 'GET') {
            const data = await readJsonFile(onboardingFile);
            return sendJSON(200, data);
        }

        // --- GET: All onboarding records (pending + approved) for QC view ---
        if (pathname === '/api/onboarding-all' && req.method === 'GET') {
            const pending = await readJsonFile(onboardingPendingFile);
            const approved = await readJsonFile(onboardingFile);
            // Merge, giving precedence to approved entries when fe_id conflicts
            const map = new Map();
            (pending || []).forEach(it => map.set(it.fe_id, it));
            (approved || []).forEach(it => map.set(it.fe_id, it));
            return sendJSON(200, Array.from(map.values()));
        }

        // --- GET: Onboarding Pending (QC / initial submissions) ---
        if (pathname === '/api/onboarding-pending' && req.method === 'GET') {
            const data = await readJsonFile(onboardingPendingFile);
            return sendJSON(200, data);
        }

        // --- GET: Dispatched Kits ---
        if (pathname === '/api/dispatched' && req.method === 'GET') {
            const data = await readJsonFile(dispatchedFile);
            return sendJSON(200, data);
        }

        // --- GET: Orders Tracking ---
        if (pathname === '/api/order' && req.method === 'GET') {
            const data = await readJsonFile(orderFile);
            return sendJSON(200, data);
        }

        // --- Serve UI ---
        if ((pathname === '/' || pathname === '/index.html') && req.method === 'GET') {
            try {
                const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end(html);
                return;
            } catch (e) {
                return sendJSON(500, { error: 'Failed to load UI', message: e.message });
            }
        }

        // --- POST: Dispatch Kit (Moves from Onboarding -> Dispatched & Tracking Created) ---
        if (pathname === '/api/dispatch' && req.method === 'POST') {
            let body = '';
            for await (const chunk of req) { body += chunk; }
            
            let payload;
            try { payload = JSON.parse(body); } catch { return sendJSON(400, { error: 'Invalid JSON body' }); }

            const feId = payload?.fe_id;
            if (!feId) return sendJSON(400, { error: 'Missing fe_id' });

            const onboardingData = await readJsonFile(onboardingFile);
            const index = onboardingData.findIndex(item => item.fe_id === feId);
            if (index === -1) return sendJSON(404, { error: 'FE record not found' });

            const [record] = onboardingData.splice(index, 1);
            
            // Read dependent files
            const dispatchedData = await readJsonFile(dispatchedFile);
            const orderData = await readJsonFile(orderFile);

            const order = {
                order_id: 'ORD' + Date.now(),
                fe_id: record.fe_id,
                tracking_id: 'TRK' + Math.floor(Math.random() * 1000000),
                tracking_status: 'Dispatched',
                last_updated: new Date().toISOString().slice(0, 10)
            };

            dispatchedData.push(record);
            orderData.push(order);

            await writeJsonFile(dispatchedFile, dispatchedData);
            await writeJsonFile(orderFile, orderData);
return sendJSON(200, { success: true, order });
        }

        // Route fallback
        return sendJSON(404, { error: 'Not Found' });

    } catch (err) {
        return sendJSON(500, { error: 'Internal Server Error', message: err.message });
    }
});

server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});