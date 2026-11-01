const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

// Kích hoạt plugin stealth để ẩn danh hoàn toàn dấu vết bot
puppeteer.use(StealthPlugin());

const COOKIE_PATH = path.join(__dirname, 'cookies.json');

async function runStealthAutomation() {
    console.log('🚀 Đang khởi động trình duyệt ẩn danh (Stealth Mode)...');
    
    // Cấu hình tương thích Windows để không bị lỗi crash Code 2147483651
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Dùng Chrome thật của máy
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--start-maximized'
        ]
    });

    const page = await browser.newPage();

    // Nạp lại cookies nếu có để giữ phiên đăng nhập
    if (fs.existsSync(COOKIE_PATH)) {
        try {
            console.log('🔄 Đang nạp lại phiên đăng nhập đã lưu từ cookies.json...');
            const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf8'));
            if (Array.isArray(cookies) && cookies.length > 0) {
                await page.setCookie(...cookies);
            }
        } catch (err) {
            console.log('⚠️ Không thể đọc file cookies:', err.message);
        }
    }

    try {
        console.log('🌐 Đang truy cập Muse AI (https://muse.ai/thread/new)...');
        await page.goto('https://muse.ai/thread/new', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Kiểm tra hoặc chờ đăng nhập thủ công lần đầu
        try {
            await page.waitForFunction(() => {
                const el = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
                return el && el.offsetParent !== null;
            }, { timeout: 8000 });
            console.log('✅ Đã nhận diện trạng thái đăng nhập!');
        } catch (e) {
            console.log('⚠️ Vui lòng đăng nhập tay trên trình duyệt (bạn có 45 giây)...');
            await new Promise(resolve => setTimeout(resolve, 45000));
            
            // Lưu lại cookies sau khi đăng nhập xong
            const cookies = await page.cookies();
            fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
            console.log('💾 Đã lưu lại cookies vào file cookies.json!');
        }

        console.log('⌨️ Đang tìm và kích hoạt khung nhập prompt...');
        
        // Đợi textarea xuất hiện
        await page.waitForFunction(() => {
            const el = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
            return el !== null;
        }, { timeout: 20000 });

        // Focus trực tiếp bằng JS DOM (tránh tuyệt đối lỗi "Node is either not clickable or not an Element")
        const focused = await page.evaluate(() => {
            const el = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
            if (el) {
                el.scrollIntoView({ block: 'center' });
                el.focus();
                return true;
            }
            return false;
        });

        if (!focused) {
            throw new Error('Không thể focus vào khung nhập prompt.');
        }

        const testPrompt = 'A funny cinematic video of two cute puppies playing around, high quality';
        console.log(`✍️ Đang gõ prompt với tốc độ tự nhiên: "${testPrompt}"`);
        
        // Gõ phím với độ trễ ngẫu nhiên mô phỏng người thật
        for (const char of testPrompt) {
            await page.keyboard.type(char, { delay: Math.floor(Math.random() * 50) + 20 });
        }

        // Kích hoạt sự kiện input để React cập nhật nút gửi
        await page.evaluate(() => {
            const el = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
            if (el) {
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log('📤 Đang bấm nút gửi...');

        // Trỏ chính xác vào icon SVG mũi tên gửi bạn vừa cung cấp (path d bắt đầu bằng M11.45)
        const clicked = await page.evaluate(() => {
            const pathEl = document.querySelector('path[d^="M11.45"]');
            if (pathEl) {
                const btn = pathEl.closest('button') || pathEl.closest('span') || pathEl;
                btn.click();
                return 'CLICKED_SVG_BUTTON';
            }

            const buttons = Array.from(document.querySelectorAll('button'));
            const sendBtn = buttons.find(b => b.querySelector('svg path[d^="M11.45"]'));
            if (sendBtn) {
                sendBtn.click();
                return 'CLICKED_BUTTON_CONTAINER';
            }

            return null;
        });

        if (clicked) {
            console.log(`🎯 Đã bấm trúng nút gửi (${clicked})!`);
        } else {
            console.log('⚠️ Không tìm thấy nút qua SVG, thực hiện nhấn Enter để gửi...');
            await page.keyboard.press('Enter');
        }

        console.log('✅ Đã gửi lệnh thành công an toàn!');
        console.log('💡 Giữ trình duyệt mở để bạn xem kết quả render của Muse AI...');

    } catch (error) {
        console.error('❌ Lỗi:', error.message || error);
    } finally {
        console.log('Hoàn thành script.');
        // KHÔNG gọi browser.close() để tránh việc trình duyệt bị tắt phụt đi mất
    }
}

runStealthAutomation();
