// your-script.js

const puppeteer = require('puppeteer');

// —— 1. 从环境变量读取账号密码 —— 
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
  let browser;
  try {
    // —— 2. 启动浏览器 —— 
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

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // 固定 viewport，保证元素在可视区域
    await page.setViewport({ width: 1280, height: 800 });

    // 强制使用北京时间
    await page.emulateTimezone('Asia/Shanghai');

    // —— 3. 登录 —— 
    await page.goto('https://rc.cuc.edu.cn/', { waitUntil: 'networkidle2' });

    await page.waitForSelector('#username', { visible: true, timeout: 30000 });
    await page.type('#username', CUC_USERNAME, { delay: 100 });
    await page.type('#password', CUC_PASSWORD, { delay: 100 });

    await page.waitForSelector('#login_submit', { visible: true, timeout: 30000 });
    await page.click('#login_submit');

    // 等待路由跳到 /main/home
    await page.waitForFunction(
      () => window.location.hash.includes('/main/home'),
      { timeout: 60000 }
    );
    await wait(2000);

    // —— 4. 关闭“我知道了”弹窗（如果有） —— 
    try {
      await page.waitForSelector('div.closeNotice', { visible: true, timeout: 5000 });
      await page.click('div.closeNotice');
      await wait(1000);
    } catch {
      console.warn('⚠️ “我知道了” 按钮未出现，可能已自动关闭');
    }

    // 等待主界面加载完成
    await page.waitForSelector('div.selected-item-wrap', {
      visible: true,
      timeout: 30000
    });

    // —— 5. 选场馆 → “梆子井宿舍区” —— 
    // 第一个 selected-item-wrap 一般是场馆选择
    await page.click('div.selected-item-wrap:nth-child(1) input');
    await wait(2000);

    const venueItems = await page.$$('li.el-select-dropdown__item');
    for (const item of venueItems) {
      const txt = await page.evaluate(el => el.textContent.trim(), item);
      if (txt === '梆子井宿舍区') {
        await item.click();
        console.log('✅ 已选择场馆：梆子井宿舍区');
        await wait(2000);
        break;
      }
    }

    // —— 6. 选择日期：北京时间今天 + 2 天 —— 
    let nowBeijing;
    if (isCI) {
      // CI 一般是 UTC，这里手动 +8 小时得到北京时间
      nowBeijing = new Date(Date.now() + 8 * 60 * 60 * 1000);
    } else {
      // 本机已经是东八区的话，直接 new Date()
      nowBeijing = new Date();
    }
    nowBeijing.setHours(0, 0, 0, 0);
    nowBeijing.setDate(nowBeijing.getDate() + 2);

    const targetYear = nowBeijing.getFullYear();
    const targetMonth = nowBeijing.getMonth() + 1; // 1-12
    const targetDay = nowBeijing.getDate();

    const normalize = n => (n < 10 ? '0' + n : '' + n);
    const targetDateStr = `${targetYear}-${normalize(targetMonth)}-${normalize(targetDay)}`;
    console.log('🔍 目标预约日（北京时间）=', targetDateStr);

    // 在日历里根据 年-月-日 精确选中对应的格子
    const dateClickResult = await page.evaluate((targetDateStr) => {
      const header = document.querySelector('.el-calendar__header .el-calendar__title');
      if (!header) {
        return 'no-header';
      }
      const m = header.textContent.match(/(\d+)\s*年\s*(\d+)\s*月/);
      if (!m) {
        return 'bad-header';
      }
      let baseYear = parseInt(m[1], 10);
      let baseMonth = parseInt(m[2], 10); // 1-12

      const tds = Array.from(document.querySelectorAll('.el-calendar-table tbody td'));
      const normalizeInner = n => (n < 10 ? '0' + n : '' + n);

      for (const td of tds) {
        const dayDiv = td.querySelector('.el-calendar-day');
        if (!dayDiv) continue;
        const span = dayDiv.querySelector('span');
        if (!span) continue;
        const dayNum = parseInt(span.textContent.trim(), 10);
        if (!dayNum) continue;

        let year = baseYear;
        let month = baseMonth;

        if (td.classList.contains('prev')) {
          month -= 1;
          if (month === 0) {
            month = 12;
            year -= 1;
          }
        } else if (td.classList.contains('next')) {
          month += 1;
          if (month === 13) {
            month = 1;
            year += 1;
          }
        }

        const cellDateStr = `${year}-${normalizeInner(month)}-${normalizeInner(dayNum)}`;
        if (cellDateStr === targetDateStr) {
          if (dayDiv.classList.contains('el-calendar-day-disable')) {
            return 'target-disabled';
          }
          dayDiv.click();
          return 'clicked';
        }
      }

      return 'not-found';
    }, targetDateStr);

    if (dateClickResult === 'target-disabled') {
      throw new Error(`目标日期 ${targetDateStr} 在日历中存在但不可预约（被标记为禁用）`);
    }
    if (dateClickResult === 'not-found') {
      throw new Error(`在日历中找不到目标日期 ${targetDateStr}，可能 UI 改版或月份没切对`);
    }
    if (dateClickResult !== 'clicked') {
      console.warn('⚠️ 选择日期返回异常状态:', dateClickResult);
    } else {
      console.log('✅ 已选择预约日期:', targetDateStr);
    }

    await wait(2000);

    // —— 7. 在所有分页中查找“梆子井自习室358”，并点击它的图片(img-wrap) —— 
    const ROOM_NAME = '梆子井自习室358';

    while (true) {
      const clicked = await page.evaluate((roomName) => {
        // 每页的房间卡片
        const items = Array.from(document.querySelectorAll('.room-item-wrap'));
        for (const item of items) {
          const nameEl = item.querySelector('.room-name');
          if (!nameEl) continue;
          if (nameEl.textContent.includes(roomName)) {
            // 你提供的信息：点 .img-wrap 可以进去
            const imgWrap = item.querySelector('.img-wrap');
            if (imgWrap) {
              imgWrap.click();
            } else {
              // 兜底：如果没有 img-wrap，就点整行
              item.click();
            }
            return true;
          }
        }
        return false;
      }, ROOM_NAME);

      if (clicked) {
        console.log('✅ 已在当前页找到并点击“梆子井自习室358”的图片');
        break;
      }

      // 当前页没找到，尝试翻下一页
      const hasNext = await page.evaluate(() => {
        const nextBtn = document.querySelector('.el-pagination button.btn-next');
        if (!nextBtn) return false;
        return !nextBtn.disabled && !nextBtn.classList.contains('is-disabled');
      });

      if (!hasNext) {
        throw new Error('❌ 在所有分页中都没有找到“梆子井自习室358”，可能房间名称或筛选条件有变化');
      }

      console.log('ℹ️ 当前页未找到目标房间，点击下一页...');
      await page.click('.el-pagination button.btn-next');
      await wait(1500);
    }

    console.log('✅ 已点击目标自习室，等待时间选择控件...');
    // 适当多等一会儿，给页面打开时间选择模块的时间
    await wait(2000);

    // —— 8. 通过时间滑块选择 07:00 - 23:00 —— 
    await page.waitForSelector('.timer-content-mid-wrap', {
      visible: true,
      timeout: 20000  // 加长一点，避免网络慢时超时
    });
    console.log('✅ 预约时间滑块已显示');

    const timeSelectResult = await page.evaluate(() => {
      const topMarksRoot = document.querySelector('.timer-slider-top-wrap .timer-slider__marks-wrap');
      const bottomMarksRoot = document.querySelector('.timer-slider-bottom-wrap .timer-slider__marks-wrap');
      if (!topMarksRoot || !bottomMarksRoot) {
        return 'no-marks-root';
      }

      const findMark = (root, text) => {
        const items = Array.from(
          root.querySelectorAll('.timer-slider__marks-item .timer-slider__marks-text')
        );
        return items.find(el => el.textContent.trim() === text);
      };

      // 开始时间 07:00（上半段）
      const startMark = findMark(topMarksRoot, '07:00');
      // 结束时间 23:00（下半段）
      const endMark = findMark(bottomMarksRoot, '23:00');

      if (!startMark || !endMark) {
        return 'mark-not-found';
      }

      const clickTarget = el => {
        const item = el.closest('.timer-slider__marks-item') || el;
        item.click();
      };

      clickTarget(startMark);
      clickTarget(endMark);

      return 'clicked';
    });

    if (timeSelectResult !== 'clicked') {
      throw new Error('选择时间滑块失败，状态=' + timeSelectResult);
    }
    console.log('✅ 已通过滑块选择时间段 07:00 - 23:00');

    await wait(2000);

    // —— 9. 填“主题”和“联系电话” —— 
    await page.waitForSelector('input.el-input__inner[placeholder="请输入主题"]', {
      visible: true,
      timeout: 10000
    });
    await page.type('input.el-input__inner[placeholder="请输入主题"]', '自习使用', {
      delay: 100
    });
    await wait(1000);

    await page.waitForSelector('input.el-input__inner[placeholder="请输入联系电话"]', {
      visible: true,
      timeout: 10000
    });
    await page.type('input.el-input__inner[placeholder="请输入联系电话"]', '18626675046', {
      delay: 100
    });
    await wait(1000);

    // —— 10. 点击“确定预约” —— 
    await page.click('div.submit-buttons-wrap .button-wrap.regular:nth-child(2)');
    console.log('✅ 已点击初次确认');
    await wait(2000);

    // —— 11. 点击最终确认 —— 
    const finalBtn = await page.$('div.cancel-order-btn-wrap .btn-wrap.confirm');
    if (finalBtn) {
      await finalBtn.click();
      console.log('✅ 已点击最终确认');
    } else {
      console.warn('⚠️ 未找到最终确认按钮');
    }

  } catch (err) {
    console.error('❌ 脚本执行出错：', err);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();