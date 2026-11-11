/** Press-and-hold timer per key: reports progress while held and fires once when the hold completes. */
export class HoldTracker {
	private readonly t0 = new Map<string, number>();
	private readonly timers = new Map<string, ReturnType<typeof setInterval>>();

	constructor(
		private readonly holdMs: number,
		private readonly tickMs = 100,
	) {}

	start(id: string, onTick: () => void, onDone: () => void): void {
		this.cancel(id);
		this.t0.set(id, Date.now());
		this.timers.set(
			id,
			setInterval(() => {
				if (this.frac(id) >= 1) {
					this.cancel(id);
					onDone();
				} else onTick();
			}, this.tickMs),
		);
	}

	/** 0 when not held, up to 1 when the hold is complete. */
	frac(id: string): number {
		const t = this.t0.get(id);
		return t === undefined ? 0 : Math.min(1, (Date.now() - t) / this.holdMs);
	}

	cancel(id: string): void {
		const t = this.timers.get(id);
		if (t) clearInterval(t);
		this.timers.delete(id);
		this.t0.delete(id);
	}
}
