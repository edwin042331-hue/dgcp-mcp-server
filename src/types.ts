// src/types.ts

/** Campos verificados contra la API real (endpoint /procesos). */
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
  [k: string]: unknown;
}

/** Campos verificados contra la API real (endpoint /contratos). */
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

/** Campos verificados contra la API real (endpoint /ofertas). */
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
  estado_evaluacion?: string;
  tipo_oferta?: string;
  fecha_creacion?: string;
  fecha_entrega_oferta?: string;
  fecha_evaluacion?: string | null;
  [k: string]: unknown;
}

/** Campos verificados contra la API real (endpoint /proveedores). */
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

export type RegistroGenerico = Record<string, unknown>;

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
