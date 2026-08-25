const DATA_URL = './data/companies.json';

const form = document.querySelector('#searchForm');
const input = document.querySelector('#nif');
const result = document.querySelector('#result');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function render(data, nif) {
  if (!data) {
    result.innerHTML = `
      <div class="empty">
        <strong>Ainda não conhecemos este NIF.</strong>
        Se souberes qual é o nome pelo qual esta empresa é conhecida,
        futuramente poderás sugeri-lo e indicar uma fonte.
      </div>`;
    return;
  }

  const primary = data.publicNames?.[0];
  const sources = primary?.sources ?? [];
  const sourceHtml = sources.map(source =>
    `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a></li>`
  ).join('');

  const confidence = primary?.confidence ?? 0;
  const confidenceLabel = confidence >= 0.9 ? 'Correspondência forte'
    : confidence >= 0.7 ? 'Correspondência provável'
    : 'Correspondência a confirmar';

  result.innerHTML = `
    <div class="result">
      <div class="public-name">${escapeHtml(primary?.name ?? 'Sem nome público conhecido')}</div>
      <div class="legal">${escapeHtml(data.legalName)}</div>
      <dl>
        <dt>NIF</dt><dd>${escapeHtml(nif)}</dd>
        <dt>Local</dt><dd>${escapeHtml(data.location || '—')}</dd>
      </dl>
      ${primary ? `<span class="confidence">✓ ${confidenceLabel}</span>` : ''}
      ${sourceHtml ? `<div class="sources"><strong>Fontes</strong><ul>${sourceHtml}</ul></div>` : ''}
    </div>`;
}

async function search(nif) {
  result.innerHTML = '<div class="empty">A pesquisar…</div>';
  const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível carregar a base de dados.');
  const data = await response.json();
  render(data[nif], nif);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const nif = input.value.replace(/\D/g, '');
  if (nif.length !== 9) {
    result.innerHTML = '<div class="empty">Introduz um NIF/NIPC válido com 9 dígitos.</div>';
    return;
  }
  try {
    await search(nif);
  } catch (error) {
    result.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
});
