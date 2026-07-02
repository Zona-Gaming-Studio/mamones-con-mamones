// Utilidades CSV mínimas pero correctas (comillas, comas y saltos de línea
// dentro de campos). Sin dependencias.

// Parsea texto CSV a una matriz de filas (array de arrays de strings).
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  let started = false; // ¿hay algo en la fila/campo actual?

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
      started = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      started = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++; // CRLF
      if (started || field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
      }
      field = "";
      row = [];
      started = false;
    } else {
      field += c;
      started = true;
    }
  }
  if (started || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Escapa un valor para CSV.
function esc(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Convierte una matriz de filas (array de arrays) a texto CSV.
export function toCsv(rows) {
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

// Dispara la descarga de un texto como archivo.
export function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿" + text], { type: mime }); // BOM para Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
