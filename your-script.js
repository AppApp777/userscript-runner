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
  // —— 启动浏览器 —— 
  const launchOptions = {
    headless: isCI,  // CI 环境无头，本地可视
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-ipv6',         // 强制走 IPv4
      '--dns-prefetch-disable'  // 关闭 DNS 预取
    ]
  };
  if (!isCI && process.platform === 'win32') {
    // 本地 Windows 指定 Chrome 安装路径
    launchOptions.executablePath =
      'C:/Program Files/Google/Chrome/Application/chrome.exe';
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  // —— 可选：设置固定 viewport，保证所有元素在可视区域 —— 
  await page.setViewport({ width: 1280, height: 800 });

  // 强制 Chromium 以北京时间 (Asia/Shanghai) 运行
  await page.emulateTimezone('Asia/Shanghai');

  // —— 登录流程 —— 
  await page.goto('https://rc.cuc.edu.cn/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#username', { visible: true, timeout: 30000 });
  await page.type('#username', CUC_USERNAME, { delay: 100 });
  await page.type('#password', CUC_PASSWORD, { delay: 100 });

  await page.waitForSelector('#login_submit', { visible: true, timeout: 30000 });
  await page.click('#login_submit');

  // —— 等待 SPA 路由到 /main/home —— 
  await page.waitForFunction(
    () => window.location.hash.includes('/main/home'),
    { timeout: 60000 }
  );
  await wait(2000);

  // —— 点击“我知道了”弹窗（如果出现） —— 
  try {
    await page.waitForSelector('div.closeNotice', { visible: true, timeout: 5000 });
    await page.click('div.closeNotice');
    await wait(1000);
  } catch {
    console.warn('⚠️ “我知道了” 按钮未出现，可能已自动关闭');
  }

  // —— 等待主界面加载完成 —— 
  await page.waitForSelector('div.selected-item-wrap', { visible: true, timeout: 30000 });

  // —— 以下为预约流程 —— 

  // 1. 选场馆 &rarr; “梆子井宿舍区”
  await page.click('div.selected-item-wrap:nth-child(1) input');
  await wait(2000);
  for (const item of await page.$$('li.el-select-dropdown__item')) {
    const txt = await page.evaluate(el => el.textContent.trim(), item);
    if (txt === '梆子井宿舍区') {
      await item.click();
      await wait(2000);
      break;
    }
  }

  // —— 2. 基于“北京时间”算今天+2天的日期 —— 
  // 1) Date.now() + 8h &rarr; 得到“当前北京时间”的时间戳
  const nowBeijing = new Date(Date.now() + 8 * 3600 * 1000);
  // 2) 在北京时间基础上再加 2 天
  nowBeijing.setDate(nowBeijing.getDate() + 2);
  // 3) 取出“日”作为目标预约日
  const targetDay = String(nowBeijing.getDate());
  // 4) （可选）打印日志确认
  console.log('🔍 目标预约日（北京时间）=', targetDay);
  
  await page.$$eval('div.el-calendar-day', (els, day) => {
    const avail = els.filter(div => !div.classList.contains('el-calendar-day-disable'));
    const target = avail.find(div => div.textContent.trim() === day);
    if (target) target.click();
  }, targetDay);
  await wait(2000);

  // 3. 翻页到第 10 页
  while (true) {
    const active = await page.$eval('ul.el-pager li.number.active', el =>
      Number(el.textContent.trim())
    );
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

  // 5. 选开始时间 &rarr; 07:00
  await page.click('.custom-time > div:nth-child(1) input');
  await wait(2000);
  await page.$$eval('li.el-select-dropdown__item', els => {
    const opt = els.find(li => li.textContent.trim() === '07:00');
    if (opt) opt.click();
  });
  await wait(2000);

  // 6. 选结束时间 &rarr; 23:00
  await page.click('div.el-select:nth-child(3) > div:nth-child(1)');
  await wait(2000);
  await page.$$eval('li.el-select-dropdown__item', els => {
    const opt = els.find(li => li.textContent.trim() === '23:00');
    if (opt) opt.click();
  });
  await wait(2000);

  // 7. 填“主题”和“联系电话”
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