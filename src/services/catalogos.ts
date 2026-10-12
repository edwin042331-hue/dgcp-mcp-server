// src/services/catalogos.ts
//
// Catalogos de referencia que cambian poco y se cachean por horas:
//  - Unidades de compra (765 instituciones): permite filtrar en el servidor por codigo
//    en vez de comparar nombres sobre muestras parciales.
//  - Proveedores inhabilitados / suspendidos (CSV oficial de /tablas/proveedores).
import { dgcpGet, dgcpGetTexto, dgcpListar } from "./dgcpClient.js";
import { CACHE_CATALOGOS_TTL_MS, LIMITE_API } from "../constants.js";
import { normalizar, soloDigitos } from "../utils/texto.js";
import type { UnidadCompra, ProveedorInhabilitado, ProveedorReal, ContratoReal, OfertaReal } from "../types.js";

// ============================================================================
// UNIDADES DE COMPRA
// ============================================================================
export async function unidadesDeCompra(): Promise<UnidadCompra[]> {
  const r = await dgcpListar<UnidadCompra>("unidades_compra", {}, { maxPaginas: 3, ttlMs: CACHE_CATALOGOS_TTL_MS });
  return r.items;
}

/**
 * Resuelve un nombre, acronimo o codigo de institucion a sus unidades de compra.
 * Orden: codigo exacto > acronimo exacto > nombre exacto > todas las palabras contenidas.
 */
export async function resolverInstitucion(consulta: string): Promise<UnidadCompra[]> {
  const q = normalizar(consulta);
  if (!q) return [];
  const unidades = await unidadesDeCompra();

  if (/^\d+$/.test(q)) {
    const cod = Number(q);
    return unidades.filter((u) => u.codigo_unidad_compra === cod);
  }

  const porAcronimo = unidades.filter((u) => normalizar(u.acronimo) === q);
  if (porAcronimo.length > 0) return porAcronimo;

  const porNombre = unidades.filter((u) => normalizar(u.unidad_compra) === q);
  if (porNombre.length > 0) return porNombre;

  const palabras = q.split(" ").filter((p) => p.length > 1);
  return unidades.filter((u) => {
    const texto = `${normalizar(u.unidad_compra)} ${normalizar(u.acronimo)}`;
    return palabras.every((p) => texto.includes(p));
  });
}

// ============================================================================
// PROVEEDORES INHABILITADOS
// ============================================================================

/** Parser CSV RFC 4180 minimo (comillas dobles, comillas escapadas y saltos de linea en campos). */
export function parsearCSV(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else entreComillas = false;
      } else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo.replace(/\r$/, "")); filas.push(fila); fila = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || fila.length > 0) { fila.push(campo.replace(/\r$/, "")); filas.push(fila); }
  return filas;
}

const RE_VOLUNTARIA = /(a solicitud|a requerimiento|a peticion) del (propio )?proveedor/i;

export function interpretarInhabilitados(csv: string): Map<string, ProveedorInhabilitado[]> {
  const filas = parsearCSV(csv);
  const mapa = new Map<string, ProveedorInhabilitado[]>();
  if (filas.length < 2) return mapa;
  const cab = filas[0].map((c) => normalizar(c).replace(/ /g, "_"));
  const idx = (n: string) => cab.indexOf(n);
  const iRpe = idx("rpe"), iMot = idx("motivo_inhabilitacion"), iIn = idx("fecha_inhabilitacion"),
    iHab = idx("fecha_habilitacion"), iUrl = idx("url_certificacion_rpe");
  if (iRpe < 0 || iMot < 0) return mapa;
  for (const f of filas.slice(1)) {
    const rpe = soloDigitos(f[iRpe]);
    if (!rpe) continue;
    const motivo = (f[iMot] ?? "").trim();
    const reg: ProveedorInhabilitado = {
      rpe,
      motivo,
      fecha_inhabilitacion: (f[iIn] ?? "").trim(),
      fecha_habilitacion: iHab >= 0 ? (f[iHab] ?? "").trim() : "",
      url: iUrl >= 0 ? (f[iUrl] ?? "").trim() : "",
      es_sancion: !RE_VOLUNTARIA.test(motivo),
    };
    const lista = mapa.get(rpe) ?? [];
    lista.push(reg);
    mapa.set(rpe, lista);
  }
  return mapa;
}

let inhabilitadosMemo: { csv: string; mapa: Map<string, ProveedorInhabilitado[]> } | null = null;

export async function proveedoresInhabilitados(): Promise<Map<string, ProveedorInhabilitado[]>> {
  const csv = await dgcpGetTexto("tablas/proveedores", { inhabilitados: true, Type: "csv" }, CACHE_CATALOGOS_TTL_MS);
  if (inhabilitadosMemo?.csv !== csv) inhabilitadosMemo = { csv, mapa: interpretarInhabilitados(csv) };
  return inhabilitadosMemo.mapa;
}

/** Registros de inhabilitacion vigentes (sin fecha de habilitacion posterior) para un RPE. */
export async function inhabilitacionesVigentes(rpe: unknown): Promise<ProveedorInhabilitado[]> {
  const clave = soloDigitos(rpe);
  if (!clave) return [];
  try {
    const mapa = await proveedoresInhabilitados();
    return (mapa.get(clave) ?? []).filter((r) => !r.fecha_habilitacion);
  } catch {
    return [];
  }
}

// ============================================================================
// PROVEEDORES
// ============================================================================
export async function proveedorPorRpe(rpe: unknown): Promise<ProveedorReal | null> {
  const n = soloDigitos(rpe);
  if (!n) return null;
  const r = await dgcpListar<ProveedorReal>("proveedores", { rpe: Number(n) }, { maxPaginas: 1, limite: 5 });
  return r.items[0] ?? null;
}

export async function proveedorPorDocumento(documento: unknown): Promise<ProveedorReal | null> {
  const d = soloDigitos(documento);
  if (!d) return null;
  const r = await dgcpListar<ProveedorReal>("proveedores", { numero_documento: d }, { maxPaginas: 1, limite: 5 });
  return r.items[0] ?? null;
}

export interface ProveedorResuelto {
  proveedor: ProveedorReal | null;
  /** Como se identifico: rpe, rnc/cedula, o nombre via actividad reciente. */
  via: "rpe" | "documento" | "nombre" | "no_encontrado";
  /** Otras razones sociales parecidas cuando la busqueda es por nombre. */
  alternativas: Array<{ rpe: string; razon_social: string }>;
}

/**
 * Identifica un proveedor a partir de RPE, RNC/cedula o nombre.
 * La API no busca por nombre en /proveedores; para nombres se usan los contratos y ofertas
 * recientes (que traen razon_social y RPE) y luego se consulta la ficha exacta por RPE.
 */
export async function resolverProveedor(termino: string): Promise<ProveedorResuelto> {
  const crudo = termino.trim();
  const digitos = soloDigitos(crudo);
  const soloNumero = digitos.length > 0 && digitos.length >= crudo.replace(/[\s-]/g, "").length;

  if (soloNumero) {
    // RNC: 9 digitos; cedula: 11 digitos. Cualquier otro largo se trata como RPE.
    if (digitos.length === 9 || digitos.length === 11) {
      const p = await proveedorPorDocumento(digitos);
      if (p) return { proveedor: p, via: "documento", alternativas: [] };
    }
    const p = await proveedorPorRpe(digitos);
    return p ? { proveedor: p, via: "rpe", alternativas: [] } : { proveedor: null, via: "no_encontrado", alternativas: [] };
  }

  const q = normalizar(crudo);
  const [contratos, ofertas] = await Promise.all([
    dgcpListar<ContratoReal>("contratos", {}, { maxPaginas: 3, limite: LIMITE_API }),
    dgcpListar<OfertaReal>("ofertas", {}, { maxPaginas: 3, limite: LIMITE_API }),
  ]);
  const candidatos = new Map<string, string>();
  for (const r of [...contratos.items, ...ofertas.items]) {
    const rpe = soloDigitos(r.rpe);
    if (rpe && normalizar(r.razon_social).includes(q) && !candidatos.has(rpe)) candidatos.set(rpe, String(r.razon_social ?? ""));
  }
  const lista = [...candidatos.entries()].map(([rpe, razon_social]) => ({ rpe, razon_social }));
  // Preferir la coincidencia exacta del nombre; si no, la mas corta (la mas especifica).
  lista.sort((a, b) =>
    Number(normalizar(b.razon_social) === q) - Number(normalizar(a.razon_social) === q) ||
    a.razon_social.length - b.razon_social.length);
  if (lista.length === 0) return { proveedor: null, via: "no_encontrado", alternativas: [] };
  const p = await proveedorPorRpe(lista[0].rpe);
  return { proveedor: p, via: p ? "nombre" : "no_encontrado", alternativas: lista.slice(1, 6) };
}

/** Utilidad para consultas que solo necesitan el primer registro de un endpoint. */
export async function primero<T>(endpoint: string, filtros: Record<string, string | number | boolean>): Promise<T | null> {
  const raw = await dgcpGet<{ payload?: { content?: T[] | null } }>(endpoint, { ...filtros, page: 1, limit: 5 });
  return raw?.payload?.content?.[0] ?? null;
}
