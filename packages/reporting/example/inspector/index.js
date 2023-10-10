const browser = globalThis.browser || globalThis.chrome;
const $container = document.querySelector('#page-store');
const $filter = document.querySelector('#filter');

$filter.value = localStorage.filter || '';
$filter.addEventListener('input', () => {
  localStorage.filter = $filter.value;
});

async function render() {
  let { tabs } = await browser.runtime.sendMessage({ action: 'debug' });

  if (localStorage.filter) {
    const matchById = tabs.find(
      (tab) => tab.id === Number(localStorage.filter),
    );

    tabs = matchById
      ? [matchById]
      : tabs.filter((tab) => tab.url.includes(localStorage.filter));
  }
  $container.innerHTML = JSON.stringify(tabs, null, 2);
}

await render();

setInterval(render, 500);
