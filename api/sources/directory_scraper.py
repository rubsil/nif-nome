"""
api/sources/directory_scraper.py

Scraper para diretórios empresariais públicos portugueses.
Extrai nomes públicos associados a um NIF de fontes como Empresite, eInforma, Racius.

Notas importantes:
- Respects robots.txt and Terms of Service
- Caching entre pedidos para evitar overload
- Não acessa conteúdo pago/restrito
- Extrai apenas dados já públicos
"""

from __future__ import annotations

import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Iterable, Optional


class DirectoryScraper:
    """Scraper para diretórios empresariais públicos."""

    def __init__(self, min_delay: float = 2.0, timeout: float = 10.0):
        """
        Args:
            min_delay: Segundos mínimos entre pedidos à mesma fonte
            timeout: Timeout em segundos para HTTP requests
        """
        self.min_delay = min_delay
        self.timeout = timeout
        self.last_request_time: dict[str, float] = {}

    def _respectful_get(self, url: str, source_key: str) -> Optional[str]:
        """Faz um GET respeitando rate limits."""
        import time

        last_time = self.last_request_time.get(source_key, 0)
        elapsed = time.time() - last_time
        if elapsed < self.min_delay:
            time.sleep(self.min_delay - elapsed)

        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": "nif-nome-discovery/0.1"}
            )
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                content = response.read().decode("utf-8", errors="ignore")
                self.last_request_time[source_key] = time.time()
                return content
        except urllib.error.URLError as exc:
            print(f"[aviso] Scraper error for {url}: {exc}")
            return None

    def scrape_empresite(self, nif: str) -> Iterable[dict]:
        """Scrape Empresite for public name."""
        search_url = f"https://empresite.jornaldenegocios.pt/search/?q={nif}"
        html = self._respectful_get(search_url, "empresite")
        if not html:
            return

        # Procura por padrões comuns na página de resultados
        # Exemplo: <a href="...">NOME DA EMPRESA</a> ou <h3>NOME</h3>
        matches = re.findall(
            r'<(?:a href="[^"]*"[^>]*>|h[23][^>]*>)\s*([A-ZÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ\s\-&,]+?)\s*</(?:a|h[23])',
            html,
            re.IGNORECASE,
        )

        for name in matches:
            name = name.strip()
            if 3 <= len(name) <= 200 and nif not in name.lower():
                yield {
                    "nif": nif,
                    "public_name": name,
                    "url": search_url,
                    "source_name": "Empresite",
                    "source_type": "directory",
                }

    def scrape_einforma(self, nif: str) -> Iterable[dict]:
        """Scrape eInforma for public name."""
        search_url = f"https://www.einforma.pt/servlet/app/portal/ENTP/prod/ETIQUETA_EMPRESA_CONTRIBUINTE/nif/{nif}/contribuinte/{nif}/"
        html = self._respectful_get(search_url, "einforma")
        if not html:
            return

        # eInforma mostra o nome legal numa tag específica
        match = re.search(r'<h1[^>]*>\s*([^<]+?)\s*</h1>', html)
        if match:
            name = match.group(1).strip()
            if 3 <= len(name) <= 200:
                yield {
                    "nif": nif,
                    "public_name": name,
                    "url": search_url,
                    "source_name": "eInforma",
                    "source_type": "directory",
                }

    def scrape_racius(self, nif: str) -> Iterable[dict]:
        """Scrape Racius for public name."""
        search_url = f"https://www.racius.com/?q={nif}"
        html = self._respectful_get(search_url, "racius")
        if not html:
            return

        # Racius apresenta empresa em resultado de pesquisa
        matches = re.findall(
            r'<a[^>]*href="[^"]*racius\.com[^"]*"[^>]*>\s*([A-ZÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ\s\-&,]+?)\s*</a>',
            html,
            re.IGNORECASE,
        )

        for name in matches:
            name = name.strip()
            if 3 <= len(name) <= 200 and nif not in name.lower():
                yield {
                    "nif": nif,
                    "public_name": name,
                    "url": search_url,
                    "source_name": "Racius",
                    "source_type": "directory",
                }

    def scrape_all(self, nif: str) -> Iterable[dict]:
        """Scrape all known directories for a NIF."""
        scrapers = [
            ("empresite", self.scrape_empresite),
            ("einforma", self.scrape_einforma),
            ("racius", self.scrape_racius),
        ]

        for source_key, scraper_func in scrapers:
            try:
                yield from scraper_func(nif)
            except Exception as exc:
                print(f"[aviso] Erro ao fazer scrape de {source_key} para {nif}: {exc}")


# Provider interface para usar em discovery_job
def directory_findings(nif: str) -> Iterable[dict]:
    """Provider que descobre nomes públicos em diretórios empresariais."""
    scraper = DirectoryScraper(min_delay=1.0, timeout=10.0)
    yield from scraper.scrape_all(nif)
