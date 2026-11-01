const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// 🛡️ LỚP 1: Kích hoạt Plugin Stealth
puppeteer.use(StealthPlugin());

const COOKIE_PATH = path.join(__dirname, 'cookies.json');
const STORAGE_DIR = path.join(__dirname, 'storage', 'videos');

if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const app = express();
app.use(express.json());
app.use(cors());

// Phục vụ giao diện web thương hiệu riêng
app.use(express.static(__dirname));

// Phục vụ file video nội bộ
app.use('/media', express.static(STORAGE_DIR));

// Chế độ Headless
const IS_HEADLESS = process.env.HEADLESS === 'true';

// Tự động nhận diện đường dẫn Chrome trên Windows hoặc VPS Linux
const CHROME_PATH = process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : (process.env.CHROME_PATH || '/usr/bin/google-chrome' || '/usr/bin/chromium-browser');

// Bộ nhớ lưu trạng thái Jobs
const jobsStore = new Map();

// Helper tạo độ trễ ngẫu nhiên
const sleepRandom = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

// --- HỆ THỐNG HÀNG ĐỢI XỬ LÝ VIDEO MDuongProCutePhoMaiQue ---
class MDuongBatchQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.browser = null;
        this.mainPage = null;
        this.isInitializing = false;
    }

    async initBrowser() {
        if (this.browser && this.browser.connected && this.mainPage && !this.mainPage.isClosed()) {
            return;
        }

        if (this.isInitializing) {
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            return;
        }

        this.isInitializing = true;
        try {
            console.log('🧀 [MDuong Studio] Khởi động trình duyệt Google Chrome...');
            
            this.browser = await puppeteer.launch({
                headless: IS_HEADLESS,
                defaultViewport: null,
                executablePath: CHROME_PATH,
                ignoreDefaultArgs: ['--enable-automation'],
                args: [
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--start-maximized',
                    '--lang=vi-VN,vi,en-US,en'
                ]
            });

            // Sử dụng tab mặc định đầu tiên của Chrome
            const pages = await this.browser.pages();
            this.mainPage = pages[0] || (await this.browser.newPage());

            // Thiết lập độ phân giải Full HD & User-Agent thật
            await this.mainPage.setViewport({ width: 1920, height: 1080 });
            await this.mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');

            // Xóa sạch cờ tự động hóa
            await this.mainPage.evaluateOnNewDocument(() => {
                delete Object.getPrototypeOf(navigator).webdriver;
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
                Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
                window.chrome = { runtime: {} };
            });

            // Tự động đóng dialog cảnh báo
            this.mainPage.on('dialog', async dialog => {
                await dialog.accept().catch(() => {});
            });

            // Nạp cookies nếu có
            if (fs.existsSync(COOKIE_PATH)) {
                try {
                    const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf8'));
                    if (Array.isArray(cookies) && cookies.length > 0) {
                        console.log('🔑 [MDuong Studio] Nạp phiên đăng nhập từ cookies.json...');
                        await this.mainPage.setCookie(...cookies);
                    }
                } catch (err) {}
            } else {
                console.log('⚠️ Chưa có cookies.json, mở tab để xác thực đăng nhập...');
                await this.mainPage.goto('https://muse.ai/thread/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
                console.log('👉 Vui lòng đăng nhập tài khoản trên Chrome (bạn có 45 giây)...');
                await new Promise(resolve => setTimeout(resolve, 45000));
                const cookies = await this.mainPage.cookies();
                fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
                console.log('💾 Đã lưu phiên đăng nhập thành công!');
            }

            console.log('✨ [MDuong Studio] Trình duyệt đã kết nối và sẵn sàng!');
        } finally {
            this.isInitializing = false;
        }
    }

    addJobs(prompts) {
        const createdJobs = [];
        for (const promptText of prompts) {
            const jobId = Date.now().toString().slice(-6) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
            const jobData = {
                jobId,
                prompt: promptText,
                status: 'queued',
                videoUrl: null,
                createdAt: new Date(),
                completedAt: null,
                error: null
            };

            jobsStore.set(jobId, jobData);
            this.queue.push(jobData);
            createdJobs.push(jobData);
        }

        console.log(`📥 [Hàng Đợi] Đã nhận ${prompts.length} prompt. Đang có ${this.queue.length} lệnh chờ.`);
        this.processNext();
        return createdJobs;
    }

    async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const job = this.queue.shift();
        job.status = 'processing';
        jobsStore.set(job.jobId, job);

        try {
            await this.initBrowser();
            console.log(`\n======================================================`);
            console.log(`▶️ [Job #${job.jobId}] Đang xử lý: "${job.prompt}"`);

            // Mở trang tạo video mới
            console.log(`🌐 [Job #${job.jobId}] Mở trang tạo mới (https://muse.ai/thread/new)...`);
            await this.mainPage.goto('https://muse.ai/thread/new', { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Đợi khung prompt xuất hiện
            console.log(`⌨️ [Job #${job.jobId}] Đang chờ khung nhập prompt sẵn sàng...`);
            await this.mainPage.waitForFunction(() => {
                const el = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
                return el && el.offsetParent !== null;
            }, { timeout: 35000 });

            await sleepRandom(1000, 2000);

            // Focus vào khung nhập
            await this.mainPage.evaluate(() => {
                const el = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
                if (el) {
                    el.scrollIntoView({ block: 'center' });
                    el.focus();
                    if (el.tagName === 'TEXTAREA') el.value = '';
                }
            });

            // Gõ nội dung prompt
            console.log(`✍️ [Job #${job.jobId}] Đang gõ nội dung prompt: "${job.prompt}"...`);
            await this.humanType(this.mainPage, job.prompt);

            // Kích hoạt sự kiện input
            await this.mainPage.evaluate(() => {
                const el = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
                if (el) {
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });

            await sleepRandom(800, 1500);

            // Bấm nút gửi lệnh
            console.log(`📤 [Job #${job.jobId}] Bấm nút gửi lệnh...`);
            const clicked = await this.mainPage.evaluate(() => {
                const pathEl = document.querySelector('path[d^="M11.45"]');
                if (pathEl) {
                    const btn = pathEl.closest('button') || pathEl.closest('span') || pathEl;
                    btn.click();
                    return true;
                }
                const sendBtn = Array.from(document.querySelectorAll('button')).find(b => b.querySelector('svg path[d^="M11.45"]'));
                if (sendBtn) {
                    sendBtn.click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                console.log(`⚠️ [Job #${job.jobId}] Nhấn Enter để gửi prompt...`);
                await this.mainPage.keyboard.press('Enter');
            }

            console.log(`⏳ [Job #${job.jobId}] Lệnh đã gửi! Đang theo dõi khung chat để bắt video thành phẩm...`);

            // Quét định kỳ để bắt video thành phẩm trong khung chat
            let rawVideoSrc = null;
            const startTime = Date.now();
            const maxWaitTime = 240000; // Tối đa 4 phút
            let elapsedSec = 0;

            while (Date.now() - startTime < maxWaitTime) {
                const found = await this.mainPage.evaluate(() => {
                    const allVideos = Array.from(document.querySelectorAll('video'));
                    
                    for (const v of allVideos) {
                        const rect = v.getBoundingClientRect();
                        
                        // ĐIỀU KIỆN NHẬN DIỆN VIDEO THÀNH PHẨM:
                        // 1. Video thành phẩm trong khung chat luôn có kích thước lớn: width >= 200px
                        // 2. Avatar chỉ là icon nhỏ (width < 120px) 
                        if (rect.width < 180 || rect.height < 100) {
                            continue; // Bỏ qua icon avatar
                        }

                        // 3. Bỏ qua nếu có class avatar
                        if (v.closest('[class*="avatar"]') || (typeof v.className === 'string' && v.className.includes('avatar'))) {
                            continue;
                        }

                        const src = v.currentSrc || v.src || v.querySelector('source')?.src;
                        if (src && (src.startsWith('http') || src.startsWith('blob'))) {
                            return {
                                src,
                                width: Math.round(rect.width),
                                height: Math.round(rect.height)
                            };
                        }
                    }

                    return null;
                });

                if (found && found.src) {
                    console.log(`🎯 [Job #${job.jobId}] ĐÃ BẮT TRÚNG VIDEO THÀNH PHẨM (${found.width}x${found.height})!`);
                    rawVideoSrc = found.src;
                    break;
                }

                await sleepRandom(3000, 4000);
                elapsedSec = Math.floor((Date.now() - startTime) / 1000);
                if (elapsedSec % 12 === 0) {
                    console.log(`⏳ [Job #${job.jobId}] Đang đợi Muse AI render... (${elapsedSec}s)`);
                }
            }

            // Tải video ngầm về server cục bộ
            const fileName = `MDuong_${job.jobId}.mp4`;
            const localFilePath = path.join(STORAGE_DIR, fileName);
            let maskedUrl = `/media/${fileName}`;

            if (rawVideoSrc) {
                console.log(`📦 [Job #${job.jobId}] Đang tải video thành phẩm về máy chủ...`);
                try {
                    // Cách 1: Tải qua Base64 trong context của tab
                    const base64Data = await this.mainPage.evaluate(async (srcUrl) => {
                        const response = await fetch(srcUrl);
                        const blob = await response.blob();
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result.split(',')[1]);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                    }, rawVideoSrc);

                    if (base64Data) {
                        fs.writeFileSync(localFilePath, Buffer.from(base64Data, 'base64'));
                    }
                } catch (dlErr) {
                    console.log(`⚠️ Thử tải trực tiếp bằng Node.js:`, dlErr.message);
                }

                // Cách 2: Dự phòng nếu base64 không ghi được
                if ((!fs.existsSync(localFilePath) || fs.statSync(localFilePath).size === 0) && rawVideoSrc.startsWith('http')) {
                    try {
                        const buffer = await fetch(rawVideoSrc).then(r => r.arrayBuffer());
                        fs.writeFileSync(localFilePath, Buffer.from(buffer));
                    } catch (e) {}
                }

                if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).size > 0) {
                    console.log(`🎉 [Job #${job.jobId}] Đã lưu video thành công: ${fileName} (${fs.statSync(localFilePath).size} bytes)`);
                }
            }

            if (!fs.existsSync(localFilePath) || fs.statSync(localFilePath).size === 0) {
                throw new Error(`Muse AI chưa hoàn thành video sau ${elapsedSec} giây.`);
            }

            job.status = 'completed';
            job.videoUrl = maskedUrl;
            job.completedAt = new Date();
            jobsStore.set(job.jobId, job);
            console.log(`✅ [Job #${job.jobId}] Hoàn thành xuất sắc! Link: ${maskedUrl}`);
            console.log(`======================================================\n`);

        } catch (error) {
            console.error(`❌ [Job #${job.jobId}] Gặp lỗi:`, error.message || error);
            job.status = 'failed';
            job.error = error.message || error;
            job.completedAt = new Date();
            jobsStore.set(job.jobId, job);
        } finally {
            // Nghỉ ngơi ngẫu nhiên chống quét bot trước khi nhận job tiếp theo
            if (this.queue.length > 0) {
                const coolDownSeconds = Math.floor(Math.random() * 8) + 6;
                console.log(`🛡️ [Anti-Bot Shield] Tạm nghỉ ${coolDownSeconds} giây trước khi chuyển sang prompt tiếp theo...`);
                await new Promise(r => setTimeout(r, coolDownSeconds * 1000));
            }

            this.isProcessing = false;
            // Xử lý job tiếp theo trong hàng đợi
            this.processNext();
        }
    }

    async humanType(page, text) {
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            await page.keyboard.type(char, { delay: Math.floor(Math.random() * 50) + 25 });
            if (['.', ',', '!', '?', ';'].includes(char)) {
                await sleepRandom(180, 350);
            } else if (char === ' ' && Math.random() > 0.4) {
                await sleepRandom(60, 140);
            }
        }
    }
}

const batchQueue = new MDuongBatchQueue();

// --- API ENDPOINTS ---

app.post('/api/generate-batch', (req, res) => {
    let { prompts } = req.body;

    if (!prompts) {
        return res.status(400).json({ error: 'Vui lòng cung cấp danh sách prompts!' });
    }

    if (typeof prompts === 'string') {
        prompts = prompts.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    }

    if (!Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({ error: 'Không tìm thấy nội dung prompt hợp lệ!' });
    }

    console.log(`\n🧀 Nhận danh sách BATCH với ${prompts.length} prompt.`);
    const createdJobs = batchQueue.addJobs(prompts);

    res.json({
        success: true,
        totalSubmitted: prompts.length,
        jobs: createdJobs
    });
});

app.post('/api/generate', (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Vui lòng cung cấp prompt!' });
    }

    const createdJobs = batchQueue.addJobs([prompt.trim()]);
    res.json({
        success: true,
        jobId: createdJobs[0].jobId,
        message: 'Đã đưa prompt vào hàng đợi xử lý'
    });
});

app.get('/api/jobs', (req, res) => {
    const allJobs = Array.from(jobsStore.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({
        total: allJobs.length,
        inQueue: batchQueue.queue.length,
        isProcessing: batchQueue.isProcessing,
        jobs: allJobs
    });
});

app.get('/api/job/:id', (req, res) => {
    const job = jobsStore.get(req.params.id);
    if (!job) {
        return res.status(404).json({ error: 'Không tìm thấy Job!' });
    }
    res.json(job);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n===============================================================`);
    console.log(`🧀 MDuongProCutePhoMaiQue AI Studio`);
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`🎯 Đã tối ưu hóa bắt chính xác 100% video thành phẩm trong chat`);
    console.log(`===============================================================\n`);
});
