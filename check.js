const puppeteer = require('puppeteer');

async function testRun() {
    console.log('Đang thử mở trình duyệt...');
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto('https://google.com');
    console.log('Mở thành công Google!');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await browser.close();
}

testRun();