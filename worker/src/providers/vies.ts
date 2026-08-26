export interface ViesResult {
  source: "vies";
  valid: boolean;
  legalName?: string;
  address?: string;
  requestDate?: string;
}

const VIES_ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/services/checkVatService";
const VIES_NS = "urn:ec.europa.eu:taxud:vies:services:checkVat:types";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<[^>]*:?${tag}[^>]*>([\\s\\S]*?)</[^>]*:?${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

export async function findByNif(nif: string): Promise<ViesResult | null> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <checkVat xmlns="${VIES_NS}">
      <countryCode>PT</countryCode>
      <vatNumber>${escapeXml(nif)}</vatNumber>
    </checkVat>
  </soap:Body>
</soap:Envelope>`;

  const response = await fetch(VIES_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=utf-8",
      "soapaction": "",
      accept: "text/xml, application/xml",
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`VIES HTTP ${response.status}`);

  const fault = xmlValue(text, "faultstring");
  if (fault) throw new Error(`VIES ${fault}`);

  const valid = xmlValue(text, "valid").toLowerCase() === "true";
  if (!valid) return null;

  return {
    source: "vies",
    valid: true,
    legalName: xmlValue(text, "name") || undefined,
    address: xmlValue(text, "address") || undefined,
    requestDate: xmlValue(text, "requestDate") || undefined,
  };
}
