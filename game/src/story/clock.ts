/** Game-time scheduler so story scripts can `await` time and conditions. */
export class Clock {
  time = 0;
  private waiters: { until?: number; pred?: () => boolean; resolve: () => void }[] = [];

  tick(dt: number) {
    this.time += dt;
    const ready = this.waiters.filter((w) => (w.until !== undefined ? this.time >= w.until : w.pred!()));
    if (!ready.length) return;
    this.waiters = this.waiters.filter((w) => !ready.includes(w));
    ready.forEach((w) => w.resolve());
  }

  sleep(seconds: number) {
    return new Promise<void>((resolve) => this.waiters.push({ until: this.time + seconds, resolve }));
  }

  until(pred: () => boolean) {
    return new Promise<void>((resolve) => this.waiters.push({ pred, resolve }));
  }

  /** Animate 0..1 over `seconds`, calling fn each frame. */
  async tween(seconds: number, fn: (k: number) => void) {
    const start = this.time;
    fn(0);
    await this.until(() => {
      const k = Math.min(1, (this.time - start) / seconds);
      fn(k);
      return k >= 1;
    });
  }
}
