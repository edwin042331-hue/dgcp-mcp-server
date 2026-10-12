// src/services/limitador.ts
//
// Limitador de tasa de ventana deslizante + semaforo de concurrencia.
// La API DGCP corta en 60 peticiones/minuto; sin esto, una sola herramienta que escaneaba
// 30+ paginas agotaba el cupo y las consultas siguientes quedaban esperando o fallaban con 429.

export interface Reloj {
  ahora(): number;
  dormir(ms: number): Promise<void>;
}

export const relojReal: Reloj = {
  ahora: () => Date.now(),
  dormir: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class LimitadorTasa {
  private readonly marcas: number[] = [];
  private cola: Promise<void> = Promise.resolve();
  private pausadoHasta = 0;
  private enVuelo = 0;
  private readonly esperandoCupo: Array<() => void> = [];

  constructor(
    private readonly maxPorVentana: number,
    private readonly ventanaMs: number,
    private readonly maxConcurrentes: number,
    private readonly reloj: Reloj = relojReal,
  ) {}

  /** Bloquea nuevas salidas hasta `epochMs` (p. ej. tras un 429 con Retry-After). */
  pausarHasta(epochMs: number): void {
    this.pausadoHasta = Math.max(this.pausadoHasta, epochMs);
  }

  /** Ejecuta `tarea` respetando la tasa y la concurrencia. */
  async ejecutar<T>(tarea: () => Promise<T>): Promise<T> {
    await this.adquirirConcurrencia();
    try {
      await this.turno();
      return await tarea();
    } finally {
      this.liberarConcurrencia();
    }
  }

  private turno(): Promise<void> {
    // La cola serializa la toma de turnos (FIFO); la tarea en si corre en paralelo.
    const siguiente = this.cola.then(() => this.esperarHueco());
    this.cola = siguiente.catch(() => undefined);
    return siguiente;
  }

  private async esperarHueco(): Promise<void> {
    for (;;) {
      const ahora = this.reloj.ahora();
      if (ahora < this.pausadoHasta) {
        await this.reloj.dormir(this.pausadoHasta - ahora);
        continue;
      }
      while (this.marcas.length > 0 && this.marcas[0] <= ahora - this.ventanaMs) this.marcas.shift();
      if (this.marcas.length < this.maxPorVentana) {
        this.marcas.push(ahora);
        return;
      }
      await this.reloj.dormir(this.marcas[0] + this.ventanaMs - ahora);
    }
  }

  private adquirirConcurrencia(): Promise<void> {
    if (this.enVuelo < this.maxConcurrentes) {
      this.enVuelo++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.esperandoCupo.push(() => { this.enVuelo++; resolve(); }));
  }

  private liberarConcurrencia(): void {
    this.enVuelo--;
    const siguiente = this.esperandoCupo.shift();
    if (siguiente) siguiente();
  }
}
