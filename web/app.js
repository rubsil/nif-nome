const API_BASE = window.NIF_NOME_API || 'http://127.0.0.1:8000';

const form = document.querySelector('#searchForm');
const input = document.querySelector('#nif');
const result = document.querySelector('#result');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function confidenceInfo(score) {
  const value = Number(score) || 0;
  if (value >= 0.85) return { label: 'Confiança elevada', className: 'high' };
  if (value >= 0.60) return { label: 'Correspondência provável', className: 'medium' };
  if (value >= 0.35) return { label: 'Confiança baixa', className: 'low' };
  return { label: 'Ainda por confirmar', className: 'low' };
}

function sourceTypeLabel(type) {
  return ({ government: 'Governo', official: 'Oficial', directory: 'Diretório', web: 'Website', community: 'Comunidade', other: 'Outra' })[type] || 'Fonte';
}

function renderPublicName(name) {
  const sources = name.sources ?? [];
  const confidence = Number(name.confidence) || 0;
  const info = confidenceInfo(confidence);
  const sourceHtml = sources.length
    ? `<ul class="source-list">${sources.map(source => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a><span>${escapeHtml(sourceTypeLabel(source.source_type))}</span></li>`).join('')}</ul>`
    : '<p class="muted">Ainda sem fontes públicas associadas.</p>';
  return `<article class="public-name-card"><div class="public-name">${escapeHtml(name.name)}</div><div class="name-type">${escapeHtml(name.type || 'nome público')}</div><div class="confidence-row"><span class="confidence ${info.className}">✓ ${info.label}</span><strong>${Math.round(confidence * 100)}%</strong></div><div class="sources"><strong>Fontes e evidências</strong>${sourceHtml}</div></article>`;
}

function renderCompany(data) {
  const names = data.publicNames ?? [];
  const primary = names[0];
  return `<div class="company-profile">
    <header class="company-header">
      <div class="eyebrow">Empresa identificada</div>
      <h2>${escapeHtml(primary?.name ?? 'Sem nome público conhecido')}</h2>
      <p class="legal">${escapeHtml(data.legalName || 'Denominação legal ainda não identificada')}</p>
    </header>
    <div class="company-meta"><div><span>NIF</span><strong>${escapeHtml(data.nif)}</strong></div><div><span>Localização</span><strong>${escapeHtml(data.location || '—')}</strong></div></div>
    <section><h3>Nomes conhecidos</h3>${names.length ? names.map(renderPublicName).join('') : '<div class="empty">Ainda não temos um nome público confirmado para esta empresa.</div>'}</section>
    <div class="profile-note">A denominação social e o nome pelo qual o estabelecimento é conhecido podem ser diferentes. As associações são apresentadas com as fontes disponíveis.</div>
  </div>`;
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
  result.innerHTML = `<div class="result-summary">${results.length} resultado(s)</div>${results.map(renderCompany).join('')}`;
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
