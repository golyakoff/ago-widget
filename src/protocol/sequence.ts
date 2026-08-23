/**
 * realtime.md's Client protocol: "Server assigns `sequence`; clients order by it and never by
 * arrival time or client clock." Monotonic on purpose - a duplicate or a stray out-of-order push
 * (the fan-out redelivery `dedup.ts` already filters most of, or simply a message replayed by a
 * reconnect's delta) must never move the remembered "last known sequence" backward, or the next
 * resume request would ask the server for messages it has already rendered.
 */
export class SequenceTracker {
  private last: number | null;

  constructor(initial: number | null = null) {
    this.last = initial;
  }

  get lastKnownSequence(): number | null {
    return this.last;
  }

  /** Advances the tracked sequence if `sequence` is newer than what was already known. Returns
   * whether it advanced, so a caller only persists a write that actually changed something. */
  observe(sequence: number): boolean {
    if (this.last === null || sequence > this.last) {
      this.last = sequence;
      return true;
    }

    return false;
  }
}
