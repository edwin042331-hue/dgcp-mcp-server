// src/types.ts
// Campos verificados contra la API real (datosabiertos.dgcp.gob.do/api-dgcp/v1).
// Todas las fechas vienen en hora de Republica Dominicana aunque traigan sufijo "Z"
// (ver utils/fechas.ts).

/** /procesos */
export interface ProcesoReal {
  codigo_proceso?: string;
  codigo_unidad_compra?: number;
  unidad_compra?: string;
  modalidad?: string;
  tipo_excepcion?: string;
  titulo?: string;
  descripcion?: string;
  estado_proceso?: string;
  divisa?: string;
  monto_estimado?: number;
  fecha_publicacion?: string;
  fecha_enmienda?: string;
  fecha_fin_recepcion_ofertas?: string;
  fecha_apertura_ofertas?: string;
  fecha_estimada_adjudicacion?: string;
  fecha_suscripcion?: string;
  fecha_habilitacion_oferente?: string;
  dirigido_mipymes?: string;
  dirigido_mipymes_mujeres?: string;
  proceso_lotificado?: string;
  es_snip?: string;
  codigo_snip?: string;
  objeto_proceso?: string;
  subobjeto_proceso?: string;
  area_requiriente?: string;
  numero_proveedores_notificados?: string;
  duracion_contrato?: string;
  url?: string;
  adquisicion_planeada?: string;
  compra_verde?: string;
  compra_conjunta?: string;
  [k: string]: unknown;
}

/** /contratos */
export interface ContratoReal {
  codigo_contrato?: string;
  codigo_proceso?: string;
  estado_contrato?: string;
  estado_adjudicacion?: string;
  fecha_adjudicacion?: string;
  divisa?: string;
  valor_contratado?: number;
  metodo_pago?: string;
  plazo_pago_factura?: string;
  descripcion?: string;
  fecha_creacion_contrato?: string;
  url_contrato?: string;
  unidad_compra?: string;
  codigo_unidad_compra?: string | number;
  rpe?: string | number;
  razon_social?: string;
  [k: string]: unknown;
}

/** /ofertas */
export interface OfertaReal {
  id_oferta?: string;
  codigo_proceso?: string;
  codigo_unidad_compra?: number;
  unidad_compra?: string;
  rpe?: string | number;
  razon_social?: string;
  nombre_oferta?: string;
  valor_oferta?: number;
  estado_oferta?: string;
  estado_evaluacion?: string | null;
  tipo_oferta?: string;
  fecha_creacion?: string;
  fecha_entrega_oferta?: string;
  fecha_evaluacion?: string | null;
  [k: string]: unknown;
}

/** /proveedores */
export interface ProveedorReal {
  rpe?: number | string;
  razon_social?: string;
  tipo_documento?: string;
  numero_documento?: string;
  estado?: string;
  genero?: string;
  tipo_persona?: string;
  forma_juridica?: string;
  fecha_creacion_empresa?: string;
  fecha_registro_rpe?: string;
  numero_registro_mercantil?: string;
  fecha_registro_mercantil?: string;
  es_mipyme?: string;
  certificacion_micm?: string;
  fecha_vencimiento_certificacion_micm?: string | null;
  clasificacion?: string;
  productor_nacional?: string;
  clasificacion_empresarial?: string;
  clasificacion_empresarial_2?: string;
  telefono_comercial?: string;
  celular_comercial?: string | null;
  correo_comercial?: string;
  direccion?: string;
  provee?: string;
  contacto?: string;
  posicion_contacto?: string;
  telefono_contacto?: string;
  celular_contacto?: string | null;
  correo_contacto?: string;
  url_certificacion?: string;
  pais?: string;
  region?: string;
  provincia?: string;
  municipio?: string;
  distrito_municipal?: string | null;
  [k: string]: unknown;
}

/** /proveedores/rubro */
export interface RubroProveedor {
  rpe?: number;
  razon_social?: string;
  familia_unspsc?: string;
  descripcion?: string;
}

/** /procesos/articulos */
export interface ArticuloProceso {
  codigo_proceso?: string;
  fecha_publicacion?: string;
  familia_unspsc?: string;
  clase_unspsc?: string;
  subclase_unspsc?: string;
  descripcion_articulo?: string;
  cuenta_presupuestaria?: string;
  descripcion_usuario?: string;
  cantidad?: number;
  unidad_medida?: string;
  precio_unitario_estimado?: number;
  precio_total_estimado?: number;
}

/** /contratos/articulos */
export interface ArticuloContrato {
  codigo_contrato?: string;
  codigo_proceso?: string;
  familia?: string;
  clase?: string;
  subclase?: string;
  cuenta_presupuestaria?: string;
  descripcion_articulo?: string;
  descripcion_usuario?: string;
  unidad_medida?: string;
  cantidad?: number;
  precio_unitario?: number;
  itbis?: number;
  otros_impuestos?: number;
  descuentos?: number;
  costo_total?: number;
  fecha_creacion_contrato?: string;
}

/** /procesos/documentos */
export interface DocumentoProceso {
  nombre_documento?: string;
  codigo_proceso?: string;
  tipo_documento?: string;
  fecha_carga_archivo?: string;
  url_documento?: string;
}

/** /unidades_compra */
export interface UnidadCompra {
  codigo_unidad_compra: number;
  unidad_compra?: string;
  acronimo?: string;
  tipo?: string;
  estado?: string;
  direccion?: string;
  telefono?: string;
  correo?: string;
  [k: string]: unknown;
}

/** /procesos/mipymes/cuota_institucion */
export interface CuotaMipyme {
  monto_adjudicado?: number;
  adjudicado_mipymes?: number;
  porcentaje_mipymes?: number;
  adjudicado_mipymes_mujeres?: number;
  porcentaje_mipymes_mujeres?: number;
  año?: number;
  codigo_unidad_compra?: number;
  unidad_compra?: string;
}

/** /pacc/adquisiciones */
export interface AdquisicionPacc {
  id_adquisicion?: string;
  uid_pacc?: string;
  codigo_unidad_compra?: number;
  unidad_compra?: string;
  descripcion?: string;
  finalidad?: string;
  fecha_inicio_proceso_compra?: string;
  objeto_adquisicion?: string;
  valor_presupuestado?: number;
  dirigido_mipymes?: string;
  dirigido_mipymes_mujeres?: string;
  modalidad_adquisicion?: string;
  [k: string]: unknown;
}

/** Fila de /tablas/proveedores?inhabilitados=true (CSV). */
export interface ProveedorInhabilitado {
  rpe: string;
  motivo: string;
  fecha_inhabilitacion: string;
  fecha_habilitacion: string;
  url: string;
  /** false cuando el motivo es una cancelacion voluntaria a solicitud del propio proveedor. */
  es_sancion: boolean;
}

export interface QueryParams {
  [key: string]: string | number | boolean | undefined;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
  total_pages: number;
}
