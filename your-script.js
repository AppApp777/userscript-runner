const puppeteer = require('puppeteer');

// —— 从环境变量读取 —— 
const CUC_USERNAME = process.env.CUC_USERNAME;
const CUC_PASSWORD = process.env.CUC_PASSWORD;
if (!CUC_USERNAME || !CUC_PASSWORD) {
  console.error('❌ 请先设置环境变量 CUC_USERNAME 和 CUC_PASSWORD');
  process.exit(1);
}

// 判断是否在 GitHub Actions CI 环境
const isCI = process.env.CI === 'true';

// 简易等待函数
const wait = ms => new Promise(res => setTimeout(res, ms));

;(async () => {
  // 启动浏览器：本地可视（headful），CI 无头
  const launchOptions = {
    headless: isCI,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  if (!isCI && process.platform === 'win32') {
    // 本地 Windows 指定 Chrome 路径
    launchOptions.executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  // —— 登录流程 —— 
  await page.goto('https://rc.cuc.edu.cn/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', CUC_USERNAME, { delay: 100 });
  await page.type('#password', CUC_PASSWORD, { delay: 100 });
  await page.waitForSelector('#login_submit', { visible: true });
  await page.click('#login_submit');

  // —— 等待真正的导航到首页 —— 
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

  // —— 点击“我知道了” —— 
  try {
    await page.waitForSelector('div.closeNotice', { visible: true, timeout: 5000 });
    await page.click('div.closeNotice');
    await wait(2000);
  } catch {
    console.warn('⚠️ “我知道了” 按钮未出现，可能已自动关闭');
  }

  // —— 确保主界面加载完成 —— 
  await page.waitForSelector('div.selected-item-wrap', { visible: true, timeout: 30000 });

  // —— 下面是预约流程 —— 

  // 1. 选场馆 &rarr; 梆子井宿舍区
  await page.click('div.selected-item-wrap:nth-child(1) input');
  await wait(2000);
  for (const item of await page.$$('li.el-select-dropdown__item')) {
    if ((await page.evaluate(el => el.textContent.trim(), item)) === '梆子井宿舍区') {
      await item.click();
      await wait(2000);
      break;
    }
  }

  // 2. 选今天+2天
  const d = new Date();
  d.setDate(d.getDate() + 2);
  const targetDay = String(d.getDate());
  await page.$$eval('div.el-calendar-day', (els, day) => {
    const avail = els.filter(div => !div.classList.contains('el-calendar-day-disable'));
    const target = avail.find(div => div.textContent.trim() === day);
    if (target) target.click();
  }, targetDay);
  await wait(2000);

  // 3. 翻页到第10页
  while (true) {
    const active = await page.$eval('ul.el-pager li.number.active', el => Number(el.textContent.trim()));
    if (active >= 10) break;
    await page.click('div.el-pagination.is-background button.btn-next');
    await wait(1000);
  }
  await wait(1000);

  // 4. 点击“梆子井自习室358”
  await page.$$eval('div.room-name.bold', els => {
    const room = els.find(el => el.textContent.includes('梆子井自习室358'));
    if (room) room.click();
  });
  await wait(2000);

  // 5. 选开始时间&rarr;07:00
  await page.click('.custom-time > div:nth-child(1) input');
  await wait(2000);
  await page.$$eval('li.el-select-dropdown__item', els => {
    const opt = els.find(li => li.textContent.trim() === '07:00');
    if (opt) opt.click();
  });
  await wait(2000);

  // 6. 选结束时间&rarr;23:00
  await page.click('div.el-select:nth-child(3) > div:nth-child(1)');
  await wait(2000);
  await page.$$eval('li.el-select-dropdown__item', els => {
    const opt = els.find(li => li.textContent.trim() === '23:00');
    if (opt) opt.click();
  });
  await wait(2000);

  // 7. 填主题和联系电话
  await page.type('input.el-input__inner[placeholder="请输入主题"]', '自习使用', { delay: 100 });
  await wait(2000);
  await page.type('input.el-input__inner[placeholder="请输入联系电话"]', '18626675046', { delay: 100 });
  await wait(2000);

  // 8. 点击“确定预约”
  await page.click('div.submit-buttons-wrap .button-wrap.regular:nth-child(2)');
  console.log('✅ 已点击初次确认');
  await wait(2000);

  // 9. 点击最终确认
  const finalBtn = await page.$('div.cancel-order-btn-wrap .btn-wrap.confirm');
  if (finalBtn) {
    await finalBtn.click();
    console.log('✅ 已点击最终确认');
  } else {
    console.warn('⚠️ 未找到最终确认按钮');
  }

  await browser.close();
})();