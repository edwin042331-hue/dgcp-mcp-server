// src/services/cache.ts
//
// Cache LRU con TTL y tope por tamano aproximado. Una pagina de 1000 registros pesa ~1.5 MB,
// por lo que limitar solo por cantidad de entradas no protege la memoria del proceso.

interface Entrada<V> {
  valor: V;
  expira: number;
  bytes: number;
}

export class CacheLRU<V> {
  private readonly mapa = new Map<string, Entrada<V>>();
  private bytesTotales = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  get(clave: string): V | undefined {
    const e = this.mapa.get(clave);
    if (!e) return undefined;
    if (e.expira <= this.ahora()) {
      this.borrar(clave);
      return undefined;
    }
    // Re-insertar la mueve al final: la mas recientemente usada.
    this.mapa.delete(clave);
    this.mapa.set(clave, e);
    return e.valor;
  }

  set(clave: string, valor: V, ttlMs: number, bytes: number): void {
    if (ttlMs <= 0 || bytes > this.maxBytes) return;
    this.borrar(clave);
    this.mapa.set(clave, { valor, expira: this.ahora() + ttlMs, bytes });
    this.bytesTotales += bytes;
    while (this.bytesTotales > this.maxBytes) {
      const masVieja = this.mapa.keys().next().value;
      if (masVieja === undefined) break;
      this.borrar(masVieja);
    }
  }

  borrar(clave: string): void {
    const e = this.mapa.get(clave);
    if (!e) return;
    this.bytesTotales -= e.bytes;
    this.mapa.delete(clave);
  }

  limpiar(): void {
    this.mapa.clear();
    this.bytesTotales = 0;
  }

  get tamano(): number {
    return this.mapa.size;
  }

  get bytes(): number {
    return this.bytesTotales;
  }
}
