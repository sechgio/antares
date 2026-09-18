// Single-slot timer + attempt counter shared by the canvas sync layers'
// debounce/retry policies. At most one pending fire; callers own the delay
// policy and the work callback.
export class TimerScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  attempts = 0;

  constructor(private readonly run: () => void) {}

  get pending(): boolean {
    return this.timer !== null;
  }

  schedule(delayMs: number): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run();
    }, delayMs);
  }

  reset(): void {
    this.attempts = 0;
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.attempts = 0;
  }
}
