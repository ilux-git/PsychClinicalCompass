// Local Vite fixture only. The production entry does not import this module.
// Real role components and ordinary web auth; no Telegram data or tokens are fabricated.
import axe from 'axe-core';

const root = document.documentElement;
const theme = document.getElementById('contrast-theme');
const result = document.getElementById('contrast-result');
const status = document.getElementById('contrast-status');
const run = document.getElementById('contrast-run');
const tools = document.getElementById('contrast-tools');

theme.addEventListener('change', () => {
  root.classList.toggle('telegram-app', theme.value !== 'web');
  if (theme.value === 'web') delete root.dataset.telegramTheme;
  else root.dataset.telegramTheme = theme.value;
  status.textContent = 'Тема изменена. Запустите проверку.';
});

run.addEventListener('click', async () => {
  run.disabled = true;
  status.textContent = 'Проверяем контраст…';
  try {
    // Avoid measuring intermediate colors while the theme/route transition is running.
    await Promise.race([
      Promise.allSettled(document.getAnimations().filter(animation => animation.playState === 'running' &&
        Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished)),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
    let settled = 0;
    const deadline = performance.now() + 5000;
    while (settled < 3 && performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      const app = document.getElementById('root');
      const fading = [...app.querySelectorAll('[style]')].some(element => {
        const opacity = Number(getComputedStyle(element).opacity);
        return opacity > 0 && opacity < 1 && !element.closest('[aria-hidden="true"]');
      });
      settled = fading || app.querySelector('.loading,.route-loading') ? 0 : settled + 1;
    }
    if (settled < 3) throw new Error('UnsettledApplication');
    // The fixture toolbar must not obscure app text while axe samples backgrounds.
    tools.hidden = true;
    const audit = await axe.run(document.getElementById('root'), {
      runOnly: {type: 'rule', values: ['color-contrast']},
    });
    const report = {
      checked_at: new Date().toISOString(),
      theme: theme.value,
      route: location.pathname + location.search,
      viewport: {width: innerWidth, height: innerHeight},
      axe_version: axe.version,
      violations: audit.violations,
      incomplete: audit.incomplete,
      passed_nodes: audit.passes.reduce((count, rule) => count + rule.nodes.length, 0),
    };
    result.textContent = JSON.stringify(report, null, 2);
    status.textContent = `Нарушений: ${audit.violations.reduce((count, rule) => count + rule.nodes.length, 0)}; требуют ручной проверки: ${audit.incomplete.reduce((count, rule) => count + rule.nodes.length, 0)}; проверено: ${report.passed_nodes}.`;
  } catch (error) {
    status.textContent = `Проверка не завершена: ${error.name}`;
    result.textContent = '';
  } finally {
    tools.hidden = false;
    run.disabled = false;
  }
});
