const API_BASE = window.NIF_NOME_API || 'https://nif-nome.ruben-silva-92.workers.dev';
let STATIC_COMPANIES = null;
const form = document.querySelector('#searchForm');
const input = document.querySelector('#nif');
const result = document.querySelector('#result');
function escapeHtml(value) { return String(value ?? '').replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function confidenceInfo(score) { const value = Number(score) || 0; if (value >= 0.85) return { label: 'Confiança elevada', className: 'high' }; if (value >= 0.60) return { label: 'Correspondência provável', className: 'medium' }; if (value >= 0.35) return { label: 'Confiança baixa', className: 'low' }; return { label: 'Ainda por confirmar', className: 'low' }; }
function sourceTypeLabel(type) { return ({ government: 'Governo', official: 'Oficial', directory: 'Diretório', web: 'Website', community: 'Comunidade', other: 'Outra' })[type] || 'Fonte'; }
function renderPublicName(name) {
  const sources = name.sources ?? []; const confidence = Number(name.confidence) || 0; const info = confidenceInfo(confidence);
  const sourceHtml = sources.length ? `<ul class="source-list">${sources.map(source => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a><span>${escapeHtml(sourceTypeLabel(source.source_type))}</span></li>`).join('')}</ul>` : '<p class="muted">Ainda sem fontes públicas associadas.</p>';
  return `<article class="public-name-card"><div class="public-name">${escapeHtml(name.name)}</div><div class="name-type">${escapeHtml(name.type || 'nome público')}</div><div class="confidence-row"><span class="confidence ${info.className}">✓ ${info.label}</span><strong>${Math.round(confidence * 100)}%</strong></div><div class="sources"><strong>Fontes e evidências</strong>${sourceHtml}</div></article>`;
}
function normalizeMapsText(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\bCódigo Postal\s*:\s*/gi, '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractPostalCode(value) { const match = String(value || '').match(/\b\d{4}-\d{3}\b/); return match ? match[0] : ''; }
function mapsAddress(data) {
  const raw = data.address || data.location || '';
  const normalized = normalizeMapsText(raw);
  const postalCode = data.postalCode || extractPostalCode(raw) || extractPostalCode(data.location);
  let address = normalized.replace(/\s*,?\s*Portugal\s*$/i, '').trim();
  if (postalCode && !address.includes(postalCode)) address = `${address}, ${postalCode}`;
  return `${address}, Portugal`.replace(/,\s*,/g, ',');
}
function mapsSearchUrl(query) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`; }
function mapsUrl(data) {
  // Do not include a guessed public name. The registered address is the reliable clue;
  // an incorrect candidate can send Maps to a completely different establishment.
  return mapsSearchUrl(mapsAddress(data));
}
function nearbyMapsUrl(data, category = '') {
  const address = mapsAddress(data);
  const type = category || (/(restaurante|pizzaria|bar|cafe|caf[eé]|bebidas|561|562|563)/i.test(String(data.activity || '')) ? 'restaurantes' : 'estabelecimentos');
  return mapsSearchUrl(`${type} perto de ${address}`);
}
function renderCompany(data) {
  const names = data.publicNames ?? []; const primary = names[0]; const address = data.address || data.location;
  const displayName = primary?.name || data.legalName || 'Empresa identificada';
  const addressHtml = address ? `<div><span>Morada registada</span><strong>${escapeHtml(address)}</strong><div class="map-actions"><a class="map-link" href="${mapsUrl(data)}" target="_blank" rel="noopener noreferrer">📍 Ver esta morada no Google Maps</a><a class="map-link secondary" href="${nearbyMapsUrl(data)}" target="_blank" rel="noopener noreferrer">🔎 Ver estabelecimentos perto daqui</a></div></div>` : `<div><span>Localização</span><strong>${escapeHtml(data.location || '—')}</strong></div>`;
  return `<div class="company-profile"><header class="company-header"><div class="eyebrow">Empresa identificada</div><h2>${escapeHtml(displayName)}</h2>${primary && data.legalName ? `<p class="legal">${escapeHtml(data.legalName)}</p>` : ''}</header><div class="company-meta"><div><span>NIF</span><strong>${escapeHtml(data.nif)}</strong></div>${addressHtml}</div><section><h3>Nomes conhecidos</h3>${names.length ? names.map(renderPublicName).join('') : `<div class="empty"><strong>${escapeHtml(data.legalName || 'Denominação legal identificada')}</strong><p>Ainda não temos um nome público/comercial confirmado para esta empresa.</p></div>`}</section><div class="profile-note">A denominação social e o nome pelo qual o estabelecimento é conhecido podem ser diferentes. As associações são apresentadas com as fontes disponíveis. Se não houver nome comercial confirmado, a morada pode ajudar a reconhecer o estabelecimento no Google Maps.</div></div>`;
}
function renderNotFound(nif) { result.innerHTML = `<div class="empty"><strong>NIF ${escapeHtml(nif)} não foi identificado automaticamente.</strong><p>Consultámos as fontes disponíveis. Se souberes o nome, podes ajudar a completar a base.</p><button type="button" id="suggestButton">Conheço o nome desta empresa</button></div>`; document.querySelector('#suggestButton').addEventListener('click', () => showSuggestionForm(nif)); }
function showSuggestionForm(nif) { result.innerHTML = `<div class="suggestion"><strong>Ajuda-nos a identificar esta empresa</strong><p>A tua sugestão ficará registada para revisão.</p><label>Nome público<input id="suggestName" maxlength="200" placeholder="Ex.: Café Central"></label><label>Fonte (opcional)<input id="suggestSource" type="url" maxlength="1000" placeholder="https://..."></label><button type="button" id="sendSuggestion">Guardar sugestão</button><div id="suggestStatus"></div></div>`; document.querySelector('#sendSuggestion').addEventListener('click', () => submitSuggestion(nif)); }
async function loadStaticCompanies() { if (!STATIC_COMPANIES) { const response = await fetch('./data/companies.json', { cache: 'no-store' }); if (!response.ok) throw new Error('Não foi possível carregar a base de demonstração.'); STATIC_COMPANIES = await response.json(); } return STATIC_COMPANIES; }
async function submitSuggestion(nif) { const name = document.querySelector('#suggestName').value.trim(); const source_url = document.querySelector('#suggestSource').value.trim(); const status = document.querySelector('#suggestStatus'); if (!name) { status.textContent = 'Indica o nome público.'; return; } if (API_BASE) { status.textContent = 'A enviar…'; try { const response = await fetch(`${API_BASE}/api/suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nif, name, source_url }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível enviar.'); status.textContent = '✓ Obrigado! A sugestão ficou registada para revisão.'; return; } catch (error) { status.textContent = error.message; return; } } const suggestions = JSON.parse(localStorage.getItem('nifNomeSuggestions') || '[]'); suggestions.push({ nif, name, source_url, created_at: new Date().toISOString() }); localStorage.setItem('nifNomeSuggestions', JSON.stringify(suggestions)); status.textContent = '✓ Guardada neste dispositivo.'; }
function renderSearchResults(payload) { const results = payload.results || []; if (!results.length) { result.innerHTML = `<div class="empty"><strong>Não encontrámos correspondências.</strong></div>`; return; } result.innerHTML = `<div class="result-summary">${results.length} resultado(s)</div>${results.map(renderCompany).join('')}`; }
function localSearch(companies, query) { const normalized = query.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); return Object.values(companies).filter(company => { const values = [company.nif, company.legalName, company.location, ...(company.publicNames || []).map(name => name.name)]; return values.some(value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalized)); }); }
async function search(query) {
  result.innerHTML = '<div class="empty">A pesquisar e a consultar fontes públicas…</div>';
  if (API_BASE) {
    if (/^\d{9}$/.test(query)) {
      const response = await fetch(`${API_BASE}/api/discover?nif=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const data = await response.json();
      if (response.ok && data.found) { result.innerHTML = renderCompany(data.company); return; }
      renderNotFound(query); return;
    }
    const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Erro na pesquisa.'); renderSearchResults(data); return;
  }
  const companies = await loadStaticCompanies(); const results = localSearch(companies, query); if (/^\d{9}$/.test(query) && !results.length) { renderNotFound(query); return; } renderSearchResults({ results });
}
form.addEventListener('submit', async event => { event.preventDefault(); const query = input.value.trim(); if (query.length < 2) { result.innerHTML = '<div class="empty">Introduz um NIF de 9 dígitos ou pelo menos 2 caracteres.</div>'; return; } try { await search(query); } catch (error) { result.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; } });
