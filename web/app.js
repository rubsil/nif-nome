const API_BASE = window.NIF_NOME_API || 'http://127.0.0.1:8000';

const form = document.querySelector('#searchForm');
const input = document.querySelector('#nif');
const result = document.querySelector('#result');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function renderCompany(data) {
  const primary = data.publicNames?.[0];
  const sources = primary?.sources ?? [];
  const sourceHtml = sources.map(source =>
    `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a></li>`
  ).join('');
  const confidence = primary?.confidence ?? 0;
  const confidenceLabel = confidence >= 0.9 ? 'Correspondência forte' : confidence >= 0.7 ? 'Correspondência provável' : 'Correspondência a confirmar';
  return `<div class="result"><div class="public-name">${escapeHtml(primary?.name ?? 'Sem nome público conhecido')}</div><div class="legal">${escapeHtml(data.legalName)}</div><dl><dt>NIF</dt><dd>${escapeHtml(data.nif)}</dd><dt>Local</dt><dd>${escapeHtml(data.location || '—')}</dd></dl>${primary ? `<span class="confidence">✓ ${confidenceLabel}</span>` : ''}${sourceHtml ? `<div class="sources"><strong>Fontes</strong><ul>${sourceHtml}</ul></div>` : ''}</div>`;
}

function renderNotFound(nif) {
  result.innerHTML = `<div class="empty"><strong>NIF ${escapeHtml(nif)} ainda não está na nossa base.</strong><button type="button" id="suggestButton">Conheço o nome desta empresa</button></div>`;
  document.querySelector('#suggestButton').addEventListener('click', () => showSuggestionForm(nif));
}

function showSuggestionForm(nif) {
  result.innerHTML = `<div class="suggestion"><strong>Ajuda-nos a identificar esta empresa</strong><p>Não precisas de criar conta. Indica o nome que conheces e, se possível, uma fonte pública.</p><label>Nome público<input id="suggestName" maxlength="200" placeholder="Ex.: Café Central"></label><label>Fonte (opcional)<input id="suggestSource" type="url" maxlength="1000" placeholder="https://..."></label><button type="button" id="sendSuggestion">Enviar sugestão</button><div id="suggestStatus"></div></div>`;
  document.querySelector('#sendSuggestion').addEventListener('click', () => submitSuggestion(nif));
}

async function submitSuggestion(nif) {
  const name = document.querySelector('#suggestName').value.trim();
  const source_url = document.querySelector('#suggestSource').value.trim();
  const status = document.querySelector('#suggestStatus');
  if (!name) { status.textContent = 'Indica o nome público.'; return; }
  status.textContent = 'A enviar…';
  try {
    const response = await fetch(`${API_BASE}/api/suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nif, name, source_url }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível enviar.');
    status.textContent = '✓ Obrigado! A sugestão ficou registada para revisão.';
  } catch (error) { status.textContent = error.message; }
}

function renderSearchResults(payload) {
  const results = payload.results || [];
  if (!results.length) {
    result.innerHTML = `<div class="empty"><strong>Não encontrámos correspondências.</strong>Se souberes qual é o nome público desta empresa, podes ajudar a completar a base.</div>`;
    return;
  }
  result.innerHTML = `<div class="result"><strong>${results.length} resultado(s)</strong>${results.map(renderCompany).join('')}</div>`;
}

async function search(query) {
  result.innerHTML = '<div class="empty">A pesquisar…</div>';
  if (/^\d{9}$/.test(query)) {
    const response = await fetch(`${API_BASE}/api/company/${encodeURIComponent(query)}`);
    if (response.status === 404) { renderNotFound(query); return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erro na pesquisa.');
    result.innerHTML = renderCompany(data);
    return;
  }
  const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Erro na pesquisa.');
  renderSearchResults(data);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const query = input.value.trim();
  if (query.length < 2) {
    result.innerHTML = '<div class="empty">Introduz um NIF de 9 dígitos ou pelo menos 2 caracteres.</div>';
    return;
  }
  try { await search(query); }
  catch (error) { result.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
});
