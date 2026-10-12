// src/tools/forenseTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dgcpListar } from "../services/dgcpClient.js";
import { proveedorPorRpe, inhabilitacionesVigentes } from "../services/catalogos.js";
import { formatMonto, formatPct, fixEncoding, normalizar, soloDigitos } from "../utils/texto.js";
import { parseFechaDGCP, soloFecha } from "../utils/fechas.js";
import { AVISO_LEGAL } from "../normativa.js";
import { texto, seguro, pie, SOLO_LECTURA } from "./comun.js";
import type { OfertaReal, ProveedorReal, ProcesoReal, ContratoReal, ProveedorInhabilitado } from "../types.js";

const DOMINIOS_GENERICOS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.es", "live.com", "icloud.com",
  "msn.com", "hotmail.es", "outlook.es", "aol.com", "protonmail.com", "claro.net.do", "codetel.net.do",
]);

export interface Oferente {
  rpe: string;
  nombre: string;
  ofertas: OfertaReal[];
  ficha: ProveedorReal | null;
  inhabilitaciones: ProveedorInhabilitado[];
}

export interface Hallazgo {
  gravedad: "alta" | "media" | "info";
  tipo: string;
  detalle: string;
}

/** Telefono normalizado a sus ultimos 10 digitos (809/829/849 + numero). */
function telefono(v: unknown): string {
  const d = soloDigitos(v);
  return d.length >= 7 ? d.slice(-10) : "";
}

function agrupar(oferentes: Oferente[], clave: (o: Oferente) => string[]): Map<string, Oferente[]> {
  const m = new Map<string, Oferente[]>();
  for (const o of oferentes) {
    for (const k of new Set(clave(o).filter(Boolean))) {
      const l = m.get(k) ?? [];
      l.push(o);
      m.set(k, l);
    }
  }
  for (const [k, l] of m) if (l.length < 2) m.delete(k);
  return m;
}

const nombres = (l: Oferente[]) => l.map((o) => `${o.nombre} (RPE ${o.rpe})`).join(", ");

/**
 * Detecta vinculos entre oferentes de un mismo proceso a partir de sus fichas RPE y sus ofertas.
 * Funcion pura: recibe los datos ya descargados (probada en tests).
 */
export function detectarVinculos(oferentes: Oferente[], fechaProceso?: unknown): Hallazgo[] {
  const h: Hallazgo[] = [];
  const conFicha = oferentes.filter((o) => o.ficha);

  for (const [tel, l] of agrupar(conFicha, (o) => [o.ficha!.telefono_comercial, o.ficha!.celular_comercial, o.ficha!.telefono_contacto, o.ficha!.celular_contacto].map(telefono))) {
    h.push({ gravedad: "alta", tipo: "Telefono compartido", detalle: `${nombres(l)} registran el mismo telefono (${tel}) en el RPE.` });
  }
  for (const [mail, l] of agrupar(conFicha, (o) => [o.ficha!.correo_comercial, o.ficha!.correo_contacto].map((c) => normalizar(c)).filter((c) => c.includes("@")))) {
    h.push({ gravedad: "alta", tipo: "Correo compartido", detalle: `${nombres(l)} registran el mismo correo (${mail}).` });
  }
  for (const [dom, l] of agrupar(conFicha, (o) => [o.ficha!.correo_comercial, o.ficha!.correo_contacto]
    .map((c) => normalizar(c).split("@")[1] ?? "").filter((d) => d && !DOMINIOS_GENERICOS.has(d)))) {
    h.push({ gravedad: "media", tipo: "Dominio de correo corporativo compartido", detalle: `${nombres(l)} usan el dominio @${dom}.` });
  }
  for (const [, l] of agrupar(conFicha, (o) => {
    const d = normalizar(o.ficha!.direccion).replace(/[^a-z0-9 ]/g, "").trim();
    return d.length >= 12 ? [d] : [];
  })) {
    h.push({ gravedad: "alta", tipo: "Domicilio compartido", detalle: `${nombres(l)} registran la misma direccion: "${fixEncoding(l[0].ficha!.direccion).trim()}".` });
  }
  for (const [persona, l] of agrupar(conFicha, (o) => {
    const c = normalizar(o.ficha!.contacto);
    return c.split(" ").length >= 2 ? [c] : [];
  })) {
    h.push({ gravedad: "alta", tipo: "Misma persona de contacto", detalle: `${nombres(l)} tienen como contacto a "${persona.toUpperCase()}".` });
  }

  // Precios: ofertas identicas o casi identicas entre empresas distintas.
  const precios = oferentes.flatMap((o) => o.ofertas.filter((x) => typeof x.valor_oferta === "number" && x.valor_oferta > 0).map((x) => ({ o, v: x.valor_oferta! })));
  const vistos = new Set<string>();
  for (let i = 0; i < precios.length; i++) {
    for (let j = i + 1; j < precios.length; j++) {
      const a = precios[i], b = precios[j];
      if (a.o.rpe === b.o.rpe) continue;
      const dif = Math.abs(a.v - b.v) / Math.max(a.v, b.v);
      const k = [a.o.rpe, b.o.rpe].sort().join("-");
      if (dif <= 0.005 && !vistos.has(k)) {
        vistos.add(k);
        h.push({
          gravedad: dif === 0 ? "alta" : "media",
          tipo: dif === 0 ? "Ofertas identicas" : "Ofertas casi identicas",
          detalle: `${a.o.nombre} (${formatMonto(a.v)}) y ${b.o.nombre} (${formatMonto(b.v)}) difieren ${formatPct(dif * 100, 2)}.`,
        });
      }
    }
  }

  // Empresas creadas poco antes del proceso.
  const tProc = parseFechaDGCP(fechaProceso);
  if (tProc !== null) {
    for (const o of conFicha) {
      const creada = parseFechaDGCP(o.ficha!.fecha_creacion_empresa) ?? parseFechaDGCP(o.ficha!.fecha_registro_rpe);
      if (creada !== null && tProc - creada < 180 * 86_400_000 && tProc >= creada) {
        h.push({ gravedad: "info", tipo: "Empresa de reciente creacion", detalle: `${o.nombre} fue creada/registrada el ${soloFecha(o.ficha!.fecha_creacion_empresa ?? o.ficha!.fecha_registro_rpe)}, menos de 6 meses antes del proceso.` });
      }
    }
  }

  for (const o of oferentes) {
    for (const i of o.inhabilitaciones.filter((x) => x.es_sancion)) {
      h.push({ gravedad: "alta", tipo: "Oferente inhabilitado o suspendido", detalle: `${o.nombre} (RPE ${o.rpe}) figura en la lista oficial desde ${i.fecha_inhabilitacion.slice(0, 10)}: ${i.motivo}` });
    }
    if (o.ficha && !/activo/i.test(String(o.ficha.estado))) {
      h.push({ gravedad: "media", tipo: "RPE no activo", detalle: `${o.nombre} tiene estado RPE "${o.ficha.estado}".` });
    }
    const ofertasValidas = o.ofertas.filter((x) => !/cancel/i.test(String(x.estado_oferta)));
    if (ofertasValidas.length > 1) {
      h.push({ gravedad: "info", tipo: "Varias ofertas del mismo oferente", detalle: `${o.nombre} presento ${ofertasValidas.length} ofertas. Es normal si el proceso es por lotes; si no, revisar el Art. 36 Ley 47-25 (multiplicidad de participacion).` });
    }
  }

  const orden = { alta: 0, media: 1, info: 2 } as const;
  return h.sort((a, b) => orden[a.gravedad] - orden[b.gravedad]);
}

const ForenseSchema = z.object({
  codigo_proceso: z.string().min(3).describe("Codigo oficial del proceso a auditar."),
}).strict();

const MAX_OFERENTES = 30;

export function registerForenseTools(server: McpServer): void {
  server.registerTool("dgcp_auditoria_colusion", {
    title: "Auditoria forense de colusion entre oferentes (DGCP)",
    description: `Audita TODAS las ofertas de un proceso y cruza a cada oferente con su ficha oficial del RPE (consulta exacta por RPE) y con la lista de inhabilitados de la DGCP.
Banderas: telefonos, correos, dominios, domicilios o personas de contacto compartidos; ofertas identicas o casi identicas (<=0.5%); empresas creadas poco antes del proceso; oferentes inhabilitados o con RPE no activo; multiples ofertas de un mismo oferente.
Base legal: Art. 116 Ley 47-25 (exclusion por practicas colusorias) y Art. 36 (multiplicidad de participacion). Son indicios para verificar, no prueba.`,
    inputSchema: ForenseSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error en la auditoria forense", async ({ codigo_proceso }: z.infer<typeof ForenseSchema>) => {
    const cod = codigo_proceso.trim();
    const [proc, ofertas, contratos] = await Promise.all([
      dgcpListar<ProcesoReal>("procesos", { proceso: cod }, { maxPaginas: 1, limite: 5 }),
      dgcpListar<OfertaReal>("ofertas", { proceso: cod }, { maxPaginas: 3 }),
      dgcpListar<ContratoReal>("contratos", { proceso: cod }, { maxPaginas: 1 }),
    ]);
    const p = proc.items[0];
    const out = [
      `# Auditoria forense de colusion`,
      `**Proceso:** ${cod}${p ? ` | ${fixEncoding(p.titulo ?? "").trim()}` : ""}`,
      p ? `**Institucion:** ${fixEncoding(p.unidad_compra ?? "N/D")} | **Monto estimado:** ${formatMonto(p.monto_estimado)} | **Modalidad:** ${fixEncoding(p.modalidad ?? "N/D")}` : "_El proceso no aparece en /procesos; se auditan sus ofertas igualmente._",
    ];
    if (ofertas.items.length === 0) {
      out.push("", "No hay ofertas registradas para este proceso (plazo aun abierto, proceso sin ofertas o codigo incorrecto). La auditoria requiere ofertas publicadas.");
      return texto(out.join("\n") + pie());
    }

    const porRpe = new Map<string, OfertaReal[]>();
    for (const o of ofertas.items) {
      const k = soloDigitos(o.rpe) || `sin-rpe-${normalizar(o.razon_social)}`;
      porRpe.set(k, [...(porRpe.get(k) ?? []), o]);
    }
    const claves = [...porRpe.keys()].slice(0, MAX_OFERENTES);
    const oferentes: Oferente[] = await Promise.all(claves.map(async (rpe) => {
      const lista = porRpe.get(rpe)!;
      const esRpe = /^\d+$/.test(rpe);
      const [ficha, inh] = await Promise.all([
        esRpe ? proveedorPorRpe(rpe).catch(() => null) : Promise.resolve(null),
        esRpe ? inhabilitacionesVigentes(rpe) : Promise.resolve([]),
      ]);
      return { rpe, nombre: fixEncoding(lista[0].razon_social ?? ficha?.razon_social ?? "N/D"), ofertas: lista, ficha, inhabilitaciones: inh };
    }));

    const ganadores = new Set(contratos.items.map((c) => soloDigitos(c.rpe)));
    out.push("", `## Oferentes (${porRpe.size}${porRpe.size > MAX_OFERENTES ? `, se auditan los primeros ${MAX_OFERENTES}` : ""})`);
    [...oferentes].sort((a, b) => Math.min(...a.ofertas.map((x) => x.valor_oferta ?? Infinity)) - Math.min(...b.ofertas.map((x) => x.valor_oferta ?? Infinity)))
      .forEach((o, i) => {
        const montos = o.ofertas.map((x) => formatMonto(x.valor_oferta)).join(" / ");
        out.push(`${i + 1}. ${o.nombre} (RPE ${o.rpe})${ganadores.has(o.rpe) ? " **ADJUDICATARIO**" : ""}: ${montos}` +
          (o.ficha ? ` | RPE ${fixEncoding(o.ficha.estado ?? "")}, ${fixEncoding(o.ficha.provincia ?? "")}, tel ${o.ficha.telefono_comercial ?? "N/D"}` : " | ficha RPE no disponible"));
      });

    const hallazgos = detectarVinculos(oferentes, p?.fecha_publicacion);
    const graves = hallazgos.filter((x) => x.gravedad !== "info");
    out.push("", "## Resultado");
    if (graves.length === 0) {
      out.push(`Sin vinculos directos detectados entre ${oferentes.filter((o) => o.ficha).length} fichas RPE cotejadas (telefonos, correos, dominios, domicilios, contactos y precios).`);
    } else {
      out.push(`**${graves.length} indicio(s) de vinculacion o irregularidad:**`);
    }
    hallazgos.forEach((x) => out.push(`- [${x.gravedad.toUpperCase()}] ${x.tipo}: ${x.detalle}`));
    if (graves.length > 0) {
      out.push("", "### Que hacer",
        "- Solicitar al Comite de Contrataciones la verificacion de oficio de practicas colusorias (Art. 116.3 Ley 47-25) y, si aplica, la exclusion de los oferentes vinculados.",
        "- Si ya hay adjudicacion: recurso de reconsideracion ante la institucion en 10 dias habiles (Arts. 204-205) y luego jerarquico impropio ante la DGCP (Arts. 207-208). Usa dgcp_generador_recurso_impugnacion.",
        "- Las practicas colusorias tambien pueden denunciarse ante ProCompetencia (Ley 42-08).");
    }
    out.push("", `_${AVISO_LEGAL} Los vinculos son indicios a verificar y no desvirtuan la presuncion de inocencia._`);
    return texto(out.join("\n") + pie());
  }));
}
