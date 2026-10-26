(() => {
  // node_modules/twinwire/dist/core/budget.js
  var TokenBucket = class {
    rate;
    capacity;
    tokens;
    at;
    constructor(rate, capacity, now) {
      this.rate = rate;
      this.capacity = capacity;
      if (!(rate > 0) || !Number.isFinite(rate) || !(capacity > 0) || !Number.isFinite(capacity))
        throw new RangeError("Invalid budget");
      this.tokens = capacity;
      this.at = now;
    }
    available(now) {
      this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.at) * this.rate / 1e3);
      this.at = Math.max(this.at, now);
      return this.tokens;
    }
    /** A message larger than the burst may go once the bucket is full; the debt then delays what follows. */
    take(bytes, now) {
      if (!Number.isFinite(bytes) || bytes < 0)
        throw new RangeError("Invalid byte count");
      if (this.available(now) < Math.min(bytes, this.capacity))
        return false;
      this.tokens -= bytes;
      return true;
    }
  };

  // node_modules/twinwire/dist/core/protocol.js
  var VERSION = 4;
  var HEADER_BYTES = 14;
  var MTU_STATE_BYTES = 1100 - HEADER_BYTES;
  var MAX_FRAME_BYTES = 256 * 1024;
  var MAX_STATE_BYTES = MAX_FRAME_BYTES - HEADER_BYTES;
  var DEFAULT_STATE_BYTES = 64 * 1024;
  var MAX_CONTROL_BYTES = 128 * 1024;
  var TIME_UNITS = 4;
  var MAX_TIME_SPAN_MS = 2147483647 / TIME_UNITS;
  var FrameKind = { state: 1, probe: 2, reply: 3, events: 4, sack: 5, stateAcked: 6 };
  var KINDS = new Set(Object.values(FrameKind));
  var isUint = (v, max = 4294967295) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
  var empty = (k) => k === FrameKind.probe || k === FrameKind.reply;
  var streamed = (k) => k === FrameKind.state || k === FrameKind.stateAcked;
  function encodeFrame(f, base = 0) {
    const rel = f.time - base;
    if (!KINDS.has(f.kind) || !isUint(f.epoch, 65535) || !f.epoch || !isUint(f.stream, 65535) || !isUint(f.seq) || !(Math.abs(rel) <= MAX_TIME_SPAN_MS) || f.payload.length > MAX_STATE_BYTES || empty(f.kind) && f.payload.length !== 0 || !streamed(f.kind) && f.stream !== 0)
      throw new RangeError("Invalid frame");
    const sb = f.stream < 128 ? 1 : f.stream < 16384 ? 2 : 3, at = 3 + sb;
    const b = new Uint8Array(at + 8 + f.payload.length), v = new DataView(b.buffer);
    b[0] = VERSION << 4 | f.kind;
    v.setUint16(1, f.epoch, true);
    for (let i = 3, s = f.stream; i < at; i++, s >>>= 7)
      b[i] = s & 127 | (i < at - 1 ? 128 : 0);
    v.setUint32(at, f.seq, true);
    v.setInt32(at + 4, Math.round(rel * TIME_UNITS), true);
    b.set(f.payload, at + 8);
    return b;
  }
  function decodeFrame(b, maxBytes = MAX_FRAME_BYTES, base = 0) {
    if (b.byteLength < 12 || b.byteLength > Math.min(maxBytes, MAX_FRAME_BYTES) || b[0] >> 4 !== VERSION)
      return null;
    const kind = b[0] & 15, v = new DataView(b.buffer, b.byteOffset, b.byteLength), epoch = v.getUint16(1, true);
    let at = 3, stream = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = b[at++];
      stream |= (byte & 127) << shift;
      if (!(byte & 128)) {
        if (at > 4 && !byte)
          return null;
        break;
      }
      if (at >= 6)
        return null;
    }
    if (!KINDS.has(kind) || !epoch || stream > 65535 || at + 8 > b.byteLength || empty(kind) && b.byteLength !== at + 8 || !streamed(kind) && stream !== 0)
      return null;
    return { kind, epoch, stream, seq: v.getUint32(at, true), time: base + v.getInt32(at + 4, true) / TIME_UNITS, payload: b.slice(at + 8) };
  }
  function newer(a, b) {
    return a !== b && a - b >>> 0 < 2147483648;
  }
  function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var utf8 = (s) => encoder.encode(s);
  var fromUtf8 = (b) => decoder.decode(b);
  function utf8Length(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 128)
        n += 1;
      else if (c < 2048)
        n += 2;
      else if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
        n += 4;
        i++;
      } else
        n += 3;
    }
    return n;
  }
  function readControl(raw, maxBytes = MAX_CONTROL_BYTES) {
    if (raw.length > maxBytes || utf8Length(raw) > maxBytes)
      return null;
    try {
      const m = JSON.parse(raw);
      return record(m) && typeof m.t === "string" ? m : null;
    } catch {
      return null;
    }
  }
  function stringify(value, maxBytes = MAX_CONTROL_BYTES) {
    const s = JSON.stringify(value);
    if (s === void 0)
      throw new TypeError("Value is not JSON");
    if (utf8Length(s) > maxBytes)
      throw new RangeError("Control frame too large");
    return s;
  }

  // node_modules/twinwire/dist/core/reliable.js
  var EventRejected = class extends Error {
    error;
    constructor(error) {
      super("Event handler threw: " + (error instanceof Error ? error.message : String(error)));
      this.error = error;
    }
  };
  var ReliableEvents = class {
    next = 1;
    received = 0;
    acknowledged = 0;
    highestSent = 0;
    bytes = 0;
    pending = /* @__PURE__ */ new Map();
    early = /* @__PURE__ */ new Map();
    earlyBytes = 0;
    maxEvents;
    maxBytes;
    maxEventBytes;
    maxEarly;
    maxEarlyBytes;
    constructor(opts = {}) {
      this.maxEvents = opts.maxEvents ?? 512;
      this.maxBytes = opts.maxBytes ?? 1024 * 1024;
      this.maxEventBytes = opts.maxEventBytes ?? 64 * 1024;
      this.maxEarly = opts.maxEarly ?? 256;
      this.maxEarlyBytes = opts.maxEarlyBytes ?? 256 * 1024;
      if (![this.maxEvents, this.maxBytes, this.maxEventBytes, this.maxEarly, this.maxEarlyBytes].every((v) => Number.isInteger(v) && v > 0))
        throw new RangeError("Invalid event limits");
    }
    push(data) {
      const text = stringify(data, this.maxEventBytes), bytes = utf8Length(text) + 64;
      if (bytes > this.maxEventBytes + 64)
        throw new RangeError("Event payload too large");
      if (this.pending.size >= this.maxEvents || this.bytes + bytes > this.maxBytes)
        throw new Error("Reliable outbox full");
      if (!Number.isSafeInteger(this.next + 1))
        throw new Error("Reliable sequence exhausted");
      const seq = this.next++;
      this.pending.set(seq, { seq, data: JSON.parse(text), bytes, text, datagramAt: -Infinity, datagramTries: 0 });
      this.bytes += bytes;
      return seq;
    }
    get size() {
      return this.pending.size;
    }
    get queuedBytes() {
      return this.bytes;
    }
    get sentThrough() {
      return this.highestSent;
    }
    entries() {
      return this.pending.values();
    }
    sent(seq) {
      this.highestSent = Math.max(this.highestSent, seq);
    }
    ack(seq) {
      if (!Number.isSafeInteger(seq) || seq < 0 || seq > this.highestSent)
        throw new Error("Invalid event acknowledgement");
      if (seq <= this.acknowledged)
        return false;
      this.acknowledged = seq;
      for (const [id, e] of this.pending) {
        if (id > seq)
          break;
        this.pending.delete(id);
        this.bytes -= e.bytes;
      }
      return true;
    }
    /** Returns how many events were delivered. Early events wait (bounded); duplicates are dropped. When `deliver`
     * throws, the event wasn't accepted: it is kept at the head and `drain` tries it again (EventRejected is thrown). */
    receive(seq, data, deliver) {
      if (!Number.isSafeInteger(seq) || seq < 1)
        throw new Error("Invalid event sequence");
      if (seq <= this.received)
        return 0;
      if (seq !== this.received + 1) {
        if (seq - this.received > this.maxEarly)
          throw new Error("Event sequence gap");
        if (!this.early.has(seq)) {
          const bytes = utf8Length(stringify(data, this.maxEventBytes));
          if (this.earlyBytes + bytes > this.maxEarlyBytes)
            throw new Error("Too many early event bytes");
          this.early.set(seq, { data, bytes });
          this.earlyBytes += bytes;
        }
        return 0;
      }
      if (this.early.has(seq))
        return this.drain(deliver);
      try {
        deliver(data, seq);
      } catch (error) {
        const bytes = utf8Length(stringify(data, this.maxEventBytes));
        this.early.set(seq, { data, bytes });
        this.earlyBytes += bytes;
        throw new EventRejected(error);
      }
      this.received = seq;
      return 1 + this.drain(deliver);
    }
    /** The next event in order is waiting (early copies caught up, or one the receiver rejected). */
    get waiting() {
      return this.early.has(this.received + 1);
    }
    /** Deliver what's waiting, in order. Throws EventRejected, keeping that event, when `deliver` throws. */
    drain(deliver) {
      let n = 0;
      for (let s = this.received + 1, e = this.early.get(s); e; s++, e = this.early.get(s)) {
        try {
          deliver(e.data, s);
        } catch (error) {
          throw new EventRejected(error);
        }
        this.early.delete(s);
        this.earlyBytes -= e.bytes;
        this.received = s;
        n++;
      }
      for (const [s, e] of this.early)
        if (s <= this.received) {
          this.early.delete(s);
          this.earlyBytes -= e.bytes;
        }
      return n;
    }
    checkpoint() {
      return {
        next: this.next,
        received: this.received,
        acknowledged: this.acknowledged,
        pending: Array.from(this.pending.values(), (e) => ({ seq: e.seq, data: structuredClone(e.data) }))
      };
    }
    restore(s) {
      if (this.next !== 1 || this.received || this.pending.size)
        throw new Error("Restore requires a fresh channel");
      if (![s.next, s.received, s.acknowledged].every((v) => Number.isSafeInteger(v) && v >= 0) || s.next < 1 || s.acknowledged >= s.next || !Array.isArray(s.pending) || s.pending.length > this.maxEvents)
        throw new Error("Invalid checkpoint");
      if (s.pending.length !== s.next - s.acknowledged - 1)
        throw new Error("Incomplete checkpoint");
      const saved = [];
      let total = 0, expected = s.acknowledged + 1;
      for (const e of s.pending) {
        if (e.seq !== expected++)
          throw new Error("Invalid checkpoint sequence");
        const text = stringify(e.data, this.maxEventBytes), bytes = utf8Length(text) + 64;
        saved.push({ seq: e.seq, data: JSON.parse(text), bytes, text, datagramAt: -Infinity, datagramTries: 0 });
        total += bytes;
      }
      if (total > this.maxBytes)
        throw new Error("Checkpoint exceeds outbox limit");
      this.next = s.next;
      this.received = s.received;
      this.acknowledged = s.acknowledged;
      this.highestSent = s.next - 1;
      this.pending = new Map(saved.map((e) => [e.seq, e]));
      this.bytes = total;
    }
  };

  // node_modules/twinwire/dist/core/endpoint.js
  var DATAGRAM_EVENT_BYTES = 960;
  var Endpoint = class {
    events;
    stats = {
      bytesSent: 0,
      bytesReceived: 0,
      statesSent: 0,
      statesReceived: 0,
      stale: 0,
      expired: 0,
      coalesced: 0,
      congested: 0,
      invalid: 0,
      fastTransitions: 0,
      datagramRttMs: 0,
      eventsViaDatagram: 0,
      datagramEventFrames: 0,
      stateAcksSent: 0,
      stateAcksReceived: 0,
      impairedDrops: 0,
      impairedStalls: 0,
      eventsRejected: 0,
      callbackErrors: 0
    };
    onState = () => {
    };
    /** A throw means "not accepted": the event is offered again (in order) shortly after, not dropped. */
    onEvent = () => {
    };
    /** An application callback threw (onEvent, onState, onStateAck). The connection carries on. */
    onCallbackError = () => {
    };
    eventRetryAt = 0;
    onFastDown = () => {
    };
    onFastChange = () => {
    };
    onEventAck = () => {
    };
    /** The peer has seen state `seq` on `stream` (only for states sent with `ack: true`). */
    onStateAck = () => {
    };
    reliable;
    datagram;
    epoch = 0;
    /** The connection's time base (from the welcome): frame times travel relative to it. */
    timeBase = 0;
    sequence = /* @__PURE__ */ new Map();
    received = /* @__PURE__ */ new Map();
    /** Per stream: bit i set = the state i+1 before the newest was seen (late delivery only). */
    seen = /* @__PURE__ */ new Map();
    deliverLate;
    queued = /* @__PURE__ */ new Map();
    acksOut = /* @__PURE__ */ new Map();
    acksIn = /* @__PURE__ */ new Map();
    lastAckSentAt = -Infinity;
    lastEventSent = 0;
    datagramAcked = 0;
    ackDue = false;
    lastProbe = -Infinity;
    proofAt = -Infinity;
    attachedAt = 0;
    probes = /* @__PURE__ */ new Map();
    probeSeq = 0;
    fast = false;
    now;
    budget;
    highWater;
    maxStreams;
    probeInterval;
    probeTimeout;
    maxStateBytes;
    datagramStateBytes;
    datagramEvents;
    stateAckInterval;
    impairment;
    constructor(o = {}) {
      this.now = o.now ?? (() => performance.now());
      const rate = o.bytesPerSecond ?? 32 * 1024;
      this.budget = new TokenBucket(rate, o.burstBytes ?? Math.max(rate / 2, 16 * 1024), this.now());
      this.highWater = o.maxBufferedBytes ?? 64 * 1024;
      this.maxStreams = o.maxStreams ?? 1024;
      this.probeInterval = o.probeIntervalMs ?? 250;
      this.probeTimeout = o.probeTimeoutMs ?? 1500;
      this.maxStateBytes = o.maxStateBytes ?? DEFAULT_STATE_BYTES;
      this.datagramStateBytes = o.datagramStateBytes ?? 8 * 1024;
      this.datagramEvents = o.datagramEvents ?? true;
      this.deliverLate = o.lateStates === "deliver";
      this.stateAckInterval = o.stateAckIntervalMs ?? 50;
      this.events = new ReliableEvents(o.events);
      if (!(this.highWater > 0) || !isUint(this.maxStreams, 65536) || this.maxStreams < 1 || !(this.probeInterval >= 10) || !(this.probeTimeout >= this.probeInterval * 2) || !isUint(this.maxStateBytes, MAX_STATE_BYTES) || this.maxStateBytes < 1 || !(this.datagramStateBytes >= MTU_STATE_BYTES) || !(this.stateAckInterval >= 0))
        throw new RangeError("Invalid endpoint limits");
      if (o.impair)
        this.setImpairment(o.impair);
    }
    get active() {
      return !!this.reliable?.open;
    }
    get fastActive() {
      return this.fast && !!this.datagram?.open && this.now() - this.proofAt <= this.probeTimeout;
    }
    get pendingStates() {
      return this.queued.size;
    }
    get connectionEpoch() {
      return this.epoch;
    }
    get maxFrameBytes() {
      return this.maxStateBytes + HEADER_BYTES;
    }
    /** Newest seq the peer reported for an acknowledged stream in this connection epoch. */
    stateAck(stream) {
      return this.acksIn.get(stream);
    }
    setImpairment(i) {
      if (!i) {
        this.impairment = void 0;
        return;
      }
      const { lagMs = 0, jitterMs = 0, loss = 0, duplicate = 0, stallMs = 0 } = i;
      if (![lagMs, jitterMs, stallMs].every((v) => Number.isFinite(v) && v >= 0 && v <= 1e4) || ![loss, duplicate].every((v) => Number.isFinite(v) && v >= 0 && v <= 1))
        throw new RangeError("Invalid impairment");
      this.impairment = lagMs || jitterMs || loss || duplicate ? { lagMs, jitterMs, loss, duplicate, stallMs } : void 0;
    }
    get impaired() {
      return this.impairment && { ...this.impairment };
    }
    attach(epoch, reliable, timeBase = 0) {
      if (!isUint(epoch, 65535) || !epoch || !Number.isFinite(timeBase))
        throw new Error("Invalid epoch");
      this.detach();
      this.epoch = epoch;
      this.timeBase = timeBase;
      this.reliable = this.impairReliable(reliable);
      this.ackDue = this.events.received > 0;
      this.lastEventSent = this.events.acknowledged;
      this.datagramAcked = 0;
      this.sequence.clear();
      this.received.clear();
      this.seen.clear();
      this.acksOut.clear();
      this.acksIn.clear();
      for (const e of this.events.entries()) {
        e.datagramAt = -Infinity;
        e.datagramTries = 0;
      }
    }
    detach() {
      this.dropDatagram(false);
      this.reliable = void 0;
      this.queued.clear();
    }
    attachDatagram(link) {
      this.dropDatagram(false);
      this.datagram = this.impairDatagram(link);
      this.attachedAt = this.now();
      this.lastProbe = -Infinity;
      this.proofAt = -Infinity;
      this.probes.clear();
    }
    dropDatagram(notify = true) {
      const d = this.datagram;
      this.datagram = void 0;
      this.proofAt = -Infinity;
      this.probes.clear();
      this.setFast(false);
      try {
        d?.close();
      } catch {
      }
      if (d && notify)
        this.onFastDown();
    }
    setFast(next) {
      if (next !== this.fast) {
        this.fast = next;
        this.stats.fastTransitions++;
        this.onFastChange(next);
      }
    }
    sendControl(m) {
      const data = stringify(m), ws = this.reliable;
      if (!ws?.open || ws.bufferedAmount > this.highWater)
        return false;
      try {
        if (!ws.send(data))
          return false;
      } catch {
        return false;
      }
      this.stats.bytesSent += utf8Length(data);
      return true;
    }
    sendEvent(data) {
      const seq = this.events.push(data);
      this.flush();
      return seq;
    }
    /** Retains only the newest unsent payload per stream. Returns the state's seq (0 when offline).
     * An accepted enqueue is not a delivery guarantee; use `ack: true` and onStateAck to learn what arrived. */
    sendState(stream, data, time, o = {}) {
      if (!this.active)
        return 0;
      if (!isUint(stream, 65535) || !(Math.abs(time - this.timeBase) <= MAX_TIME_SPAN_MS) || data.length > this.maxStateBytes || !(o.ttlMs === void 0 || Number.isFinite(o.ttlMs) && o.ttlMs > 0) || !(o.priority === void 0 || Number.isFinite(o.priority) && o.priority >= 0))
        throw new RangeError("Invalid state");
      if (!this.sequence.has(stream) && this.sequence.size >= this.maxStreams)
        throw new Error("State stream limit");
      const seq = (this.sequence.get(stream) ?? 0) + 1 >>> 0 || 1;
      this.sequence.set(stream, seq);
      const old = this.queued.get(stream);
      if (old)
        this.stats.coalesced++;
      const now = this.now();
      this.queued.set(stream, {
        frame: { kind: o.ack ? FrameKind.stateAcked : FrameKind.state, epoch: this.epoch, stream, seq, time, payload: data.slice() },
        first: old?.first ?? now,
        deadline: now + (o.ttlMs ?? 100),
        priority: o.priority ?? 1
      });
      return seq;
    }
    receiveControl(m) {
      if (m.e !== this.epoch || !this.active)
        return false;
      if (m.t === "event") {
        if (typeof m.s !== "number" || !("d" in m))
          throw new Error("Invalid event");
        try {
          this.events.receive(m.s, m.d, this.onEvent);
        } catch (e) {
          if (!(e instanceof EventRejected))
            throw e;
          this.rejected(e);
        }
        this.ackDue = !this.sendControl({ t: "ack", e: this.epoch, s: this.events.received });
        return true;
      }
      if (m.t === "ack") {
        if (typeof m.s !== "number")
          throw new Error("Invalid acknowledgement");
        if (this.events.ack(m.s))
          this.onEventAck(m.s);
        return true;
      }
      return false;
    }
    receiveBinary(bytes, via) {
      this.stats.bytesReceived += bytes.length;
      if (!this.active)
        return;
      const f = decodeFrame(bytes, this.maxFrameBytes, this.timeBase);
      if (!f) {
        this.stats.invalid++;
        return;
      }
      if (f.epoch !== this.epoch || via === "rtc" && !this.datagram) {
        this.stats.stale++;
        return;
      }
      switch (f.kind) {
        case FrameKind.probe:
          if (via === "rtc")
            this.sendFast(encodeFrame({ ...f, kind: FrameKind.reply }, this.timeBase));
          return;
        case FrameKind.reply: {
          if (via !== "rtc")
            return;
          const sent = this.probes.get(f.seq);
          if (sent === void 0)
            return;
          this.probes.delete(f.seq);
          const rtt = this.now() - sent;
          if (rtt < 0 || rtt > this.probeTimeout)
            return;
          this.proofAt = this.now();
          this.stats.datagramRttMs = rtt;
          this.setFast(true);
          return;
        }
        case FrameKind.events:
          return this.receiveDatagramEvents(f);
        case FrameKind.sack:
          return this.receiveStateAcks(f);
      }
      const prior = this.received.get(f.stream);
      let late = false;
      if (prior !== void 0 && !newer(f.seq, prior)) {
        const back = prior - f.seq >>> 0, mask = this.seen.get(f.stream) ?? 0, bit = back >= 1 && back <= 32 ? 1 << back - 1 >>> 0 : 0;
        if (!this.deliverLate || !bit || mask & bit) {
          this.stats.stale++;
          return;
        }
        this.seen.set(f.stream, (mask | bit) >>> 0);
        late = true;
      } else {
        if (prior === void 0 && this.received.size >= this.maxStreams) {
          this.stats.invalid++;
          return;
        }
        if (this.deliverLate) {
          const d = prior === void 0 ? 0 : f.seq - prior >>> 0, mask = this.seen.get(f.stream) ?? 0;
          this.seen.set(f.stream, !d || d > 32 ? 0 : ((d < 32 ? mask << d >>> 0 : 0) | 1 << d - 1) >>> 0);
        }
        this.received.set(f.stream, f.seq);
        if (f.kind === FrameKind.stateAcked)
          this.acksOut.set(f.stream, f.seq);
      }
      this.stats.statesReceived++;
      try {
        this.onState({ stream: f.stream, seq: f.seq, time: f.time, data: f.payload, via, late });
      } catch (e) {
        this.callbackError(e);
      }
    }
    callbackError(e) {
      this.stats.callbackErrors++;
      try {
        this.onCallbackError(e);
      } catch {
      }
    }
    rejected(e) {
      this.stats.eventsRejected++;
      this.eventRetryAt = this.now() + 100;
      this.callbackError(e.error);
    }
    receiveDatagramEvents(f) {
      if (f.seq <= this.events.sentThrough && this.events.ack(f.seq))
        this.onEventAck(f.seq);
      if (!f.payload.length)
        return;
      let list;
      try {
        list = JSON.parse(fromUtf8(f.payload));
      } catch {
        this.stats.invalid++;
        return;
      }
      if (!Array.isArray(list) || list.length > 64) {
        this.stats.invalid++;
        return;
      }
      const before = this.events.received;
      try {
        for (const item of list) {
          if (!Array.isArray(item) || item.length !== 2 || !Number.isSafeInteger(item[0])) {
            this.stats.invalid++;
            return;
          }
          try {
            this.events.receive(item[0], item[1], this.onEvent);
          } catch (e) {
            if (e instanceof EventRejected) {
              this.rejected(e);
              return;
            }
            this.stats.invalid++;
            return;
          }
        }
      } finally {
        const delivered = this.events.received - before;
        if (delivered > 0) {
          this.stats.eventsViaDatagram += delivered;
          this.ackDue = true;
        }
      }
    }
    receiveStateAcks(f) {
      const p = f.payload;
      if (p.length % 6) {
        this.stats.invalid++;
        return;
      }
      const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
      for (let at = 0; at < p.length; at += 6) {
        const stream = v.getUint16(at, true), seq = v.getUint32(at + 2, true), sent = this.sequence.get(stream);
        if (sent === void 0 || newer(seq, sent))
          continue;
        const prior = this.acksIn.get(stream);
        if (prior !== void 0 && !newer(seq, prior))
          continue;
        this.acksIn.set(stream, seq);
        this.stats.stateAcksReceived++;
        try {
          this.onStateAck(stream, seq);
        } catch (e) {
          this.callbackError(e);
        }
      }
    }
    sendFast(b) {
      const d = this.datagram;
      if (!d?.open || d.bufferedAmount > this.highWater)
        return false;
      try {
        if (!d.send(b))
          return false;
      } catch {
        return false;
      }
      this.stats.bytesSent += b.length;
      return true;
    }
    /** Binary on the datagram path when it is proven, else the WebSocket. */
    sendBinary(b, preferFast) {
      const ws = this.reliable;
      if (preferFast && this.fastActive && this.datagram && this.datagram.bufferedAmount <= this.highWater)
        return this.sendFast(b);
      if (!ws?.open || ws.bufferedAmount > this.highWater)
        return false;
      try {
        if (!ws.send(b))
          return false;
      } catch {
        return false;
      }
      this.stats.bytesSent += b.length;
      return true;
    }
    pump() {
      const now = this.now(), d = this.datagram;
      if (this.events.waiting && now >= this.eventRetryAt) {
        const before = this.events.received;
        try {
          this.events.drain(this.onEvent);
        } catch (e) {
          if (e instanceof EventRejected)
            this.rejected(e);
          else
            throw e;
        }
        if (this.events.received > before)
          this.ackDue = true;
      }
      if (d) {
        if (!d.open && now - this.attachedAt > this.probeTimeout || this.fast && now - this.proofAt > this.probeTimeout || !this.fast && now - this.attachedAt > this.probeTimeout * 2)
          this.dropDatagram();
        else if (d.open && now - this.lastProbe >= this.probeInterval) {
          this.lastProbe = now;
          const seq = this.probeSeq = this.probeSeq + 1 >>> 0;
          this.probes.set(seq, now);
          for (const [s, at] of this.probes)
            if (now - at > this.probeTimeout)
              this.probes.delete(s);
          this.sendFast(encodeFrame({ kind: FrameKind.probe, epoch: this.epoch, stream: 0, seq, time: this.timeBase, payload: new Uint8Array() }, this.timeBase));
        }
      }
      this.flush();
    }
    flush(maxPackets = 8) {
      const ws = this.reliable, now = this.now();
      if (!ws?.open)
        return;
      if (this.ackDue)
        this.ackDue = !this.sendControl({ t: "ack", e: this.epoch, s: this.events.received });
      for (const e of this.events.entries()) {
        if (e.seq <= this.lastEventSent)
          continue;
        const encoded = `{"t":"event","e":${this.epoch},"s":${e.seq},"d":${e.text}}`;
        const size = utf8Length(encoded);
        if (ws.bufferedAmount > this.highWater || !this.budget.take(size, now))
          break;
        try {
          if (!ws.send(encoded))
            break;
        } catch {
          break;
        }
        this.events.sent(e.seq);
        this.lastEventSent = e.seq;
        this.stats.bytesSent += size;
      }
      if (this.fastActive)
        this.flushDatagramEvents(now);
      if (this.acksOut.size && now - this.lastAckSentAt >= this.stateAckInterval)
        this.flushStateAcks(now);
      for (const [id, q] of this.queued)
        if (q.deadline <= now) {
          this.queued.delete(id);
          this.stats.expired++;
        }
      if (!this.queued.size)
        return;
      const queue = [...this.queued.values()].sort((a, b) => b.priority + (now - b.first) / 100 - (a.priority + (now - a.first) / 100));
      let count = 0;
      for (const q of queue) {
        if (count++ >= maxPackets)
          break;
        const b = encodeFrame(q.frame, this.timeBase);
        if (!this.budget.take(b.length, now))
          break;
        if (!this.sendBinary(b, q.frame.payload.length <= this.datagramStateBytes)) {
          this.stats.congested++;
          break;
        }
        this.stats.statesSent++;
        this.queued.delete(q.frame.stream);
      }
    }
    /** Copies of WebSocket-sent, unacknowledged events, retried on the datagram path for UDP-like latency. */
    flushDatagramEvents(now) {
      const retry = Math.max(40, Math.min(200, this.stats.datagramRttMs * 1.5 + 10));
      const items = [];
      let bytes = 2;
      if (this.datagramEvents)
        for (const e of this.events.entries()) {
          if (e.seq > this.lastEventSent)
            break;
          if (e.datagramTries >= 6 || now - e.datagramAt < retry || e.bytes - 64 > DATAGRAM_EVENT_BYTES)
            continue;
          const item = `[${e.seq},${e.text}]`, size = utf8Length(item) + 1;
          if (bytes + size > DATAGRAM_EVENT_BYTES || items.length >= 64)
            break;
          items.push(item);
          bytes += size;
          e.datagramAt = now;
          e.datagramTries++;
        }
      const ackChanged = this.events.received !== this.datagramAcked;
      if (!items.length && !ackChanged)
        return;
      const payload = utf8("[" + items.join(",") + "]");
      if (this.sendFast(encodeFrame({ kind: FrameKind.events, epoch: this.epoch, stream: 0, seq: this.events.received >>> 0, time: this.timeBase, payload }, this.timeBase))) {
        this.datagramAcked = this.events.received;
        this.stats.datagramEventFrames++;
      }
    }
    flushStateAcks(now) {
      const pairs = [...this.acksOut].slice(0, 150), p = new Uint8Array(pairs.length * 6), v = new DataView(p.buffer);
      pairs.forEach(([stream, seq], i) => {
        v.setUint16(i * 6, stream, true);
        v.setUint32(i * 6 + 2, seq, true);
      });
      if (this.sendBinary(encodeFrame({ kind: FrameKind.sack, epoch: this.epoch, stream: 0, seq: 0, time: this.timeBase, payload: p }, this.timeBase), true)) {
        for (const [stream, seq] of pairs)
          if (this.acksOut.get(stream) === seq)
            this.acksOut.delete(stream);
        this.lastAckSentAt = now;
        this.stats.stateAcksSent++;
      }
    }
    /** Delays a stream-like link without ever reordering it: one queue, one timer. */
    impairReliable(link) {
      let tail = 0, timer;
      const queue = [];
      const drain = () => {
        timer = void 0;
        const t = performance.now();
        while (queue.length && queue[0].at <= t + 1) {
          const { data } = queue.shift();
          if (link.open)
            try {
              link.send(data);
            } catch {
            }
        }
        if (queue.length)
          timer = setTimeout(drain, queue[0].at - t);
      };
      const self = this;
      return {
        get open() {
          return link.open;
        },
        get bufferedAmount() {
          return link.bufferedAmount;
        },
        close: () => {
          queue.length = 0;
          clearTimeout(timer);
          timer = void 0;
          link.close();
        },
        send(data) {
          const i = self.impairment;
          if (!i && !queue.length)
            return link.send(data);
          if (!link.open)
            return false;
          const stall = i?.stallMs && Math.random() < (i.loss ?? 0) ? i.stallMs : 0;
          if (stall)
            self.stats.impairedStalls++;
          const t = performance.now(), at = Math.max(tail, t + (i?.lagMs ?? 0) + Math.random() * (i?.jitterMs ?? 0) + stall);
          tail = at;
          queue.push({ at, data: typeof data === "string" ? data : data.slice() });
          if (!timer)
            timer = setTimeout(drain, at - t);
          return true;
        }
      };
    }
    impairDatagram(link) {
      const self = this;
      return {
        get open() {
          return link.open;
        },
        get bufferedAmount() {
          return link.bufferedAmount;
        },
        close: () => link.close(),
        send(data) {
          const i = self.impairment;
          if (!i)
            return link.send(data);
          if (!link.open)
            return false;
          const copies = Math.random() < i.loss ? 0 : Math.random() < i.duplicate ? 2 : 1;
          if (!copies)
            self.stats.impairedDrops++;
          for (let n = 0; n < copies; n++) {
            const copy = data.slice();
            setTimeout(() => {
              if (link.open)
                try {
                  link.send(copy);
                } catch {
                }
            }, i.lagMs + Math.random() * i.jitterMs);
          }
          return true;
        }
      };
    }
  };

  // node_modules/twinwire/dist/core/rtc.js
  function validSignal(m) {
    if (!m || typeof m !== "object")
      return false;
    const v = m;
    if (v.kind === "offer" || v.kind === "answer")
      return typeof v.sdp === "string" && v.sdp.length > 0 && v.sdp.length <= 12e3;
    return v.kind === "candidate" && typeof v.candidate === "string" && v.candidate.length <= 1500 && typeof v.mid === "string" && v.mid.length <= 128;
  }
  var ICE_URL = /^(stuns?|turns?):[^\s]{1,250}$/;
  function validIceServers(v) {
    return Array.isArray(v) && v.length <= 8 && v.every((s) => {
      if (!s || typeof s !== "object")
        return false;
      const o = s, urls = Array.isArray(o.urls) ? o.urls : [o.urls];
      return urls.length >= 1 && urls.length <= 8 && urls.every((u) => typeof u === "string" && ICE_URL.test(u)) && (o.username === void 0 || typeof o.username === "string" && o.username.length <= 256) && (o.credential === void 0 || typeof o.credential === "string" && o.credential.length <= 256);
    });
  }

  // node_modules/twinwire/dist/netcode/clock.js
  var NetworkClock = class {
    samples = [];
    offset = 0;
    target = 0;
    initialized = false;
    last = -Infinity;
    get synced() {
      return this.initialized;
    }
    /** Samples since the last reset (at most 16 are kept). */
    get sampleCount() {
      return this.samples.length;
    }
    /** Further than this from the estimate, advance() jumps instead of slewing (after a reconnect or a bad first sample). */
    jumpMs = 50;
    rttMs = 0;
    uncertaintyMs = Infinity;
    reset() {
      this.samples = [];
      this.offset = this.target = 0;
      this.initialized = false;
      this.last = -Infinity;
      this.uncertaintyMs = Infinity;
    }
    observe(sent, received, remoteTime) {
      const rtt = received - sent;
      if (![sent, received, remoteTime].every(Number.isFinite) || rtt < 0 || rtt > 15e3)
        return false;
      this.samples.push({ rtt, offset: remoteTime - (sent + received) / 2 });
      if (this.samples.length > 16)
        this.samples.shift();
      const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3);
      this.target = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
      this.rttMs = best[0].rtt;
      this.uncertaintyMs = Math.max(...best.map((s) => Math.abs(s.offset - this.target) + s.rtt / 2));
      if (!this.initialized) {
        this.offset = this.target;
        this.initialized = true;
      }
      return true;
    }
    advance(dtMs) {
      if (!Number.isFinite(dtMs) || dtMs < 0)
        throw new RangeError("Invalid time step");
      const off = this.target - this.offset;
      if (Math.abs(off) > this.jumpMs) {
        this.offset = this.target;
        return;
      }
      const max = dtMs * 0.05;
      this.offset += Math.max(-max, Math.min(max, off));
    }
    serverTime(localTime) {
      this.last = Math.max(this.last, localTime + this.offset);
      return this.last;
    }
  };

  // node_modules/twinwire/dist/client/rtc.js
  var BrowserRtcPeer = class {
    cb;
    pc;
    dc;
    alive = true;
    offered = false;
    remoteReady = false;
    localCandidates = [];
    remoteCandidates = [];
    chain = Promise.resolve();
    constructor(cb, config2 = { iceServers: [] }) {
      this.cb = cb;
      this.pc = new RTCPeerConnection(config2);
      this.dc = this.pc.createDataChannel("twinwire", { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
      const pc = this.pc, dc = this.dc;
      dc.binaryType = "arraybuffer";
      dc.onopen = () => {
        if (this.alive)
          cb.open({
            get open() {
              return dc.readyState === "open";
            },
            get bufferedAmount() {
              return dc.bufferedAmount;
            },
            send(bytes) {
              if (dc.readyState !== "open")
                return false;
              dc.send(bytes.slice().buffer);
              return true;
            },
            close: () => this.close()
          });
      };
      dc.onmessage = (e) => {
        if (this.alive && e.data instanceof ArrayBuffer)
          cb.data(new Uint8Array(e.data));
      };
      dc.onclose = () => {
        if (this.alive) {
          this.close();
          cb.closed();
        }
      };
      dc.onerror = () => {
        if (this.alive)
          cb.error(new Error("RTC data channel error"));
      };
      pc.onconnectionstatechange = () => {
        if (this.alive && pc.connectionState === "failed") {
          this.close();
          cb.closed();
        }
      };
      pc.onicecandidate = (e) => {
        if (!this.alive || !e.candidate?.candidate)
          return;
        const m = { kind: "candidate", candidate: e.candidate.candidate, mid: e.candidate.sdpMid ?? "0" };
        if (this.offered)
          cb.signal(m);
        else if (this.localCandidates.length < 64)
          this.localCandidates.push(m);
      };
    }
    async offer() {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      if (!this.alive)
        return;
      this.cb.signal({ kind: "offer", sdp: this.pc.localDescription.sdp });
      this.offered = true;
      for (const c of this.localCandidates)
        this.cb.signal(c);
      this.localCandidates = [];
    }
    signal(message) {
      this.chain = this.chain.then(async () => {
        if (!this.alive || !validSignal(message))
          return;
        if (message.kind === "answer") {
          await this.pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
          if (!this.alive)
            return;
          this.remoteReady = true;
          for (const c of this.remoteCandidates)
            await this.pc.addIceCandidate(c);
          this.remoteCandidates = [];
        } else if (message.kind === "candidate") {
          const c = { candidate: message.candidate, sdpMid: message.mid };
          if (this.remoteReady)
            await this.pc.addIceCandidate(c);
          else {
            if (this.remoteCandidates.length >= 64)
              throw new Error("Too many ICE candidates");
            this.remoteCandidates.push(c);
          }
        }
      }).catch((e) => {
        if (this.alive)
          this.cb.error(e instanceof Error ? e : new Error(String(e)));
      });
      return this.chain;
    }
    close() {
      if (!this.alive)
        return;
      this.alive = false;
      this.localCandidates = [];
      this.remoteCandidates = [];
      this.dc.onopen = this.dc.onmessage = this.dc.onclose = this.dc.onerror = null;
      this.pc.onicecandidate = this.pc.onconnectionstatechange = null;
      try {
        this.dc.close();
        this.pc.close();
      } catch {
      }
    }
  };

  // node_modules/twinwire/dist/client/state.js
  var StateReceiver = class {
    context;
    newest = -Infinity;
    waiting = true;
    resetOK = true;
    disposed = false;
    maxExtrapolation;
    options;
    constructor(context, options) {
      this.context = context;
      const { stream, resume = "reset", maxExtrapolationMs = 100, apply, reset, playback } = options;
      if (stream !== void 0 && (!Number.isInteger(stream) || stream < 0 || stream > 65535))
        throw new RangeError("Invalid snapshot stream");
      if (resume !== "reset" && resume !== "retain")
        throw new RangeError("Invalid resume policy");
      if (!Number.isFinite(maxExtrapolationMs) || maxExtrapolationMs < 0 || maxExtrapolationMs > 3e4)
        throw new RangeError("Invalid extrapolation limit");
      if (typeof apply !== "function" || reset !== void 0 && typeof reset !== "function")
        throw new TypeError("Invalid state callbacks");
      if (playback && (typeof playback.advance !== "function" || typeof playback.reset !== "function" || typeof playback.updateDelay !== "function"))
        throw new TypeError("Invalid playback");
      this.maxExtrapolation = maxExtrapolationMs;
      this.options = { ...options };
    }
    /** The session is online, its clock synced, and this connection has supplied a usable snapshot recent enough for
     * the playback delay/prediction cap. A retained clock, events, or unrelated state cannot satisfy this.
     * Freshness is checked continuously: online traffic with stale generation times holds playback too. */
    get ready() {
      if (this.disposed || !this.resetOK || !this.context.connected())
        return false;
      const now = this.context.now();
      if (now === null)
        return false;
      if (this.newest > now + this.context.tolerance() || this.newest + this.maxExtrapolation < now - (this.options.playback?.delayMs ?? 0)) {
        this.waiting = true;
        return false;
      }
      this.waiting = false;
      return true;
    }
    /** Return a safe render time, or null to keep the last rendered view while recovering. Outbound input and reliable
     * events are independent. Use this instead of calling the supplied playback.advance() directly. */
    advance(dtMs) {
      if (!this.options.playback)
        throw new Error("State receiver needs a playback to advance");
      if (!Number.isFinite(dtMs) || dtMs < 0)
        throw new RangeError("Invalid frame duration");
      if (this.disposed || !this.resetOK || !this.context.connected() || this.context.now() === null)
        return null;
      this.options.playback.updateDelay(dtMs);
      return this.ready ? this.options.playback.advance(this.context.now(), 0) : null;
    }
    /** Remove the receiver without closing the session. A disposed receiver never becomes ready again. */
    dispose() {
      if (this.disposed)
        return;
      this.disposed = true;
      this.disconnect();
      this.context.remove();
    }
    /** @internal */
    disconnect() {
      this.waiting = true;
      this.newest = -Infinity;
    }
    /** @internal Called before application session callbacks, even if disconnect/reconnect happened between render frames. */
    session(resumed) {
      this.disconnect();
      if (!resumed || this.options.resume !== "retain") {
        this.resetOK = false;
        this.options.playback?.reset();
        this.options.reset?.();
        this.resetOK = true;
      }
    }
    /** @internal Only the client's epoch-checked incoming path calls this, synchronously. */
    receive(state) {
      if (this.disposed || !this.resetOK || !this.context.connected() || this.options.stream !== void 0 && state.stream !== this.options.stream)
        return;
      const arrival = this.context.now();
      if (!Number.isFinite(state.time) || arrival !== null && state.time > arrival + this.context.tolerance())
        return;
      const generation = this.context.generation();
      if (this.options.apply(state) !== true || generation !== this.context.generation() || !this.context.connected())
        return;
      const now = this.context.now(), tolerance = this.context.tolerance();
      if (!Number.isFinite(state.time) || now !== null && state.time > now + tolerance)
        return;
      if (now !== null && this.newest > now + tolerance)
        this.newest = -Infinity;
      this.newest = Math.max(this.newest, state.time);
      const playback = this.options.playback;
      if (this.waiting && playback && now !== null && now - state.time <= playback.maxMs + this.maxExtrapolation)
        playback.observe(now, state.time);
    }
  };

  // node_modules/twinwire/dist/client/client.js
  var GameClient = class {
    options;
    endpoint;
    clock = new NetworkClock();
    status = "idle";
    id = null;
    /** ICE servers suggested by the room server (STUN/TURN), used unless options.rtc names its own. */
    iceServers = [];
    onStatus = () => {
    };
    onSession = () => {
    };
    onSessionLost = () => {
    };
    onState = () => {
    };
    onEvent = () => {
    };
    onStateAck = () => {
    };
    onTransport = () => {
    };
    onError = () => {
    };
    token = null;
    socket;
    checkpointed = false;
    burstLeft = 0;
    generation = 0;
    epoch = 0;
    peer;
    rtcAttempt = 0;
    rtcStartedAt = 0;
    rtcRetryAt = Infinity;
    rtcFailures = 0;
    reconnects = 0;
    retryTimer;
    pumpTimer;
    lastPump = 0;
    lastPing = -Infinity;
    lastMessage = 0;
    closingDeadline = Infinity;
    openedAt = 0;
    wakeDeadline = Infinity;
    pendingPings = /* @__PURE__ */ new Map();
    pingId = 0;
    stopped = true;
    serverRtc = false;
    lastTransport = "none";
    waiters = [];
    lifecycle;
    interceptors = [];
    stateReceivers = /* @__PURE__ */ new Map();
    listeners = { session: [], lost: [] };
    constructor(options) {
      this.options = options;
      const u = new URL(options.url);
      if (!["ws:", "wss:"].includes(u.protocol) || !/^[\w:.-]{1,64}$/.test(options.room))
        throw new Error("Invalid URL or room");
      this.endpoint = this.makeEndpoint();
      const cp = options.checkpoint;
      if (cp) {
        if (cp.url !== options.url || cp.room !== options.room || !/^[\w-]{20,128}$/.test(cp.token) || typeof cp.id !== "string")
          throw new Error("Checkpoint belongs to a different endpoint or is invalid");
        this.endpoint.events.restore(cp.events);
        this.token = cp.token;
        this.id = cp.id;
        this.checkpointed = true;
      }
    }
    makeEndpoint() {
      const e = new Endpoint({ ...this.options.endpoint, impair: this.options.impair ?? this.options.endpoint?.impair });
      e.onState = (s) => {
        const receiver = this.stateReceivers.get(s.stream);
        if (receiver)
          try {
            receiver.receive(s);
          } catch (error) {
            this.report(error);
          }
        const grouped = this.stateReceivers.get(void 0);
        if (grouped)
          try {
            grouped.receive(s);
          } catch (error) {
            this.report(error);
          }
        this.onState(s);
      };
      e.onEvent = (d, s) => {
        for (const f of this.interceptors)
          if (f(d, s))
            return;
        this.onEvent(d, s);
      };
      e.onStateAck = (stream, seq) => this.onStateAck(stream, seq);
      e.onCallbackError = (error) => this.report(error);
      e.onFastDown = () => this.stopRtc(true);
      e.onFastChange = () => this.noteTransport();
      return e;
    }
    /** Consume some events before onEvent sees them (return true to consume). Used by LobbyClient. Returns removal. */
    intercept(fn) {
      this.interceptors.push(fn);
      return () => {
        const i = this.interceptors.indexOf(fn);
        if (i >= 0)
          this.interceptors.splice(i, 1);
      };
    }
    /** Own recovery for an authoritative snapshot stream. Decode/apply only usable state; let the receiver hold
     * playback until fresh data arrives. One receiver per stream plus one filtered receiver for grouped streams,
     * bounded by endpoint.maxStreams (default 1024).
     * onState remains an observer of all incoming states. Dispose the receiver when its room/world is discarded. */
    receiveState(options) {
      const stream = options.stream;
      if (this.stateReceivers.has(stream))
        throw new Error("Snapshot stream already has a receiver");
      if (this.stateReceivers.size >= (this.options.endpoint?.maxStreams ?? 1024))
        throw new RangeError("Too many state receivers");
      const receiver = new StateReceiver({
        connected: () => this.status === "online" && this.endpoint.active,
        generation: () => this.generation,
        now: () => this.clock.synced ? this.clock.serverTime(performance.now()) : null,
        tolerance: () => Math.max(1, this.clock.uncertaintyMs),
        remove: () => {
          if (this.stateReceivers.get(stream) === receiver)
            this.stateReceivers.delete(stream);
        }
      }, options);
      this.stateReceivers.set(stream, receiver);
      if (this.status === "online")
        try {
          receiver.session(false);
        } catch (error) {
          this.report(error);
        }
      return receiver;
    }
    /** Extra listeners next to onSession/onSessionLost. Returns removal. */
    on(kind, fn) {
      const list = this.listeners[kind];
      list.push(fn);
      return () => {
        const i = list.indexOf(fn);
        if (i >= 0)
          list.splice(i, 1);
      };
    }
    lost(info) {
      for (const f of this.listeners.lost)
        try {
          f(info);
        } catch (e) {
          this.report(e);
        }
      this.onSessionLost(info);
    }
    /** Which path state messages take right now. */
    get transport() {
      return this.status !== "online" ? "none" : this.endpoint.fastActive ? "rtc" : "ws";
    }
    noteTransport() {
      const t = this.transport;
      if (t === "rtc")
        this.rtcFailures = 0;
      if (t !== this.lastTransport) {
        this.lastTransport = t;
        try {
          this.onTransport(t);
        } catch (e) {
          this.report(e);
        }
      }
    }
    report(error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
    setStatus(s) {
      if (s === this.status)
        return;
      if (s !== "online")
        for (const receiver of this.stateReceivers.values())
          receiver.disconnect();
      this.status = s;
      this.onStatus(s);
      this.noteTransport();
      if (s === "online")
        for (const w of this.waiters.splice(0))
          w.resolve();
      else if (s === "lost" || s === "closed")
        for (const w of this.waiters.splice(0))
          w.reject(new Error(`Session ${s}`));
    }
    /** Resolves when the session is online (at once if it already is); rejects if it is lost or closed first. */
    whenOnline() {
      if (this.status === "online")
        return Promise.resolve();
      if (this.status === "lost" || this.status === "closed")
        return Promise.reject(new Error(`Session ${this.status}`));
      return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }
    connect() {
      if (this.status === "online" || this.status === "connecting")
        return;
      if (this.status === "lost")
        throw new Error("Call newSession() after session expiry");
      this.stopped = false;
      this.setStatus("connecting");
      clearInterval(this.pumpTimer);
      this.lastPump = performance.now();
      this.pumpTimer = setInterval(() => this.pump(), 1e3 / (this.options.pumpHz ?? 60));
      this.open();
    }
    open() {
      if (this.stopped)
        return;
      clearTimeout(this.retryTimer);
      this.retryTimer = void 0;
      const generation = ++this.generation;
      const now = performance.now();
      this.openedAt = this.lastMessage = now;
      this.closingDeadline = Infinity;
      let ws;
      try {
        ws = (this.options.websocket ?? ((u) => new WebSocket(u)))(this.options.url);
      } catch (error) {
        this.report(error);
        this.retry();
        return;
      }
      this.socket = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        if (generation !== this.generation || this.stopped) {
          ws.close();
          return;
        }
        ws.send(stringify({
          t: "hello",
          v: VERSION,
          room: this.options.room,
          token: this.token,
          auth: this.options.auth ?? null,
          impair: this.options.impair ?? null
        }));
      };
      ws.onmessage = (ev) => {
        if (generation !== this.generation || this.stopped || ws.readyState !== 1)
          return;
        this.lastMessage = performance.now();
        this.wakeDeadline = Infinity;
        try {
          if (ev.data instanceof ArrayBuffer)
            this.endpoint.receiveBinary(new Uint8Array(ev.data), "ws");
          else if (typeof ev.data === "string")
            this.message(ev.data, ws);
        } catch (error) {
          this.report(error);
          ws.close(4004, "protocol");
        }
      };
      ws.onerror = () => {
      };
      ws.onclose = (ev) => {
        if (generation !== this.generation)
          return;
        this.socket = void 0;
        this.endpoint.detach();
        this.stopRtc(false);
        this.pendingPings.clear();
        if (!this.stopped) {
          if ([1002, 1008, 4001, 4002, 4004].includes(ev.code)) {
            this.stopped = true;
            clearInterval(this.pumpTimer);
            clearTimeout(this.retryTimer);
            this.setStatus("lost");
            this.lost({ pendingEvents: this.endpoint.events.size, reason: ev.reason || `connection rejected (${ev.code})` });
          } else {
            this.setStatus("connecting");
            this.retry();
          }
        }
      };
    }
    message(raw, ws) {
      this.endpoint.stats.bytesReceived += utf8Length(raw);
      const m = readControl(raw);
      if (!m)
        throw new Error("Invalid control message");
      if (m.t === "reset") {
        this.stopped = true;
        clearInterval(this.pumpTimer);
        clearTimeout(this.retryTimer);
        this.stopRtc(false);
        this.endpoint.detach();
        ws.close();
        this.setStatus("lost");
        this.lost({ pendingEvents: this.endpoint.events.size, reason: typeof m.reason === "string" ? m.reason : "expired" });
        return;
      }
      if (m.t === "welcome") {
        if (this.status !== "connecting" || !isUint(m.e, 65535) || !m.e || typeof m.b !== "number" || !Number.isFinite(m.b) || typeof m.id !== "string" || typeof m.token !== "string" || !/^[\w-]{20,128}$/.test(m.token) || typeof m.resumed !== "boolean" || m.v !== VERSION)
          throw new Error("Invalid welcome");
        const generation = this.generation;
        this.token = m.token;
        this.id = m.id;
        this.epoch = m.e;
        this.reconnects = 0;
        this.serverRtc = m.rtc === true;
        this.iceServers = validIceServers(m.ice) ? m.ice : [];
        this.endpoint.attach(this.epoch, {
          get open() {
            return ws.readyState === 1;
          },
          get bufferedAmount() {
            return ws.bufferedAmount;
          },
          send(data) {
            if (ws.readyState !== 1)
              return false;
            ws.send(typeof data === "string" ? data : data.slice().buffer);
            return true;
          },
          close() {
            ws.close();
          }
        }, m.b);
        if (!m.resumed)
          this.clock.reset();
        for (const receiver of this.stateReceivers.values())
          try {
            receiver.session(m.resumed);
          } catch (error) {
            this.report(error);
          }
        if (this.stopped || this.generation !== generation)
          return;
        this.lastPing = -Infinity;
        this.burstLeft = this.options.syncPings ?? 8;
        this.setStatus("online");
        const info = { id: this.id, resumed: m.resumed };
        for (const f of this.listeners.session)
          try {
            f(info);
          } catch (e) {
            this.report(e);
          }
        this.onSession(info);
        this.rtcFailures = 0;
        this.rtcRetryAt = performance.now();
        this.pump();
        return;
      }
      if (m.e !== this.epoch || this.status !== "online")
        return;
      if (this.endpoint.receiveControl(m))
        return;
      if (m.t === "pong" && isUint(m.n) && typeof m.s === "number" && Number.isFinite(m.s)) {
        const at = this.pendingPings.get(m.n);
        if (at === void 0)
          return;
        this.pendingPings.delete(m.n);
        this.clock.observe(at, performance.now(), m.s);
        return;
      }
      if (m.t === "signal" && m.a === this.rtcAttempt && validSignal(m.d)) {
        void this.peer?.signal(m.d);
        return;
      }
      if (m.t === "rtc-reset" && m.a === this.rtcAttempt && this.peer)
        this.stopRtc(false);
    }
    /** Retire locally before close(): browsers can wait indefinitely for an offline close handshake. */
    replaceSocket(reason) {
      const socket = this.socket, generation = ++this.generation;
      this.socket = void 0;
      this.endpoint.detach();
      this.stopRtc(false);
      this.pendingPings.clear();
      this.closingDeadline = this.wakeDeadline = Infinity;
      try {
        socket?.close(4e3, reason);
      } catch {
      }
      this.setStatus("connecting");
      if (generation === this.generation)
        this.retry();
    }
    retry() {
      if (this.stopped)
        return;
      clearTimeout(this.retryTimer);
      const cap = Math.min(this.options.reconnectMaxMs ?? 8e3, (this.options.reconnectBaseMs ?? 200) * 2 ** Math.min(this.reconnects++, 8));
      this.retryTimer = setTimeout(() => this.open(), cap * (0.5 + Math.random() / 2));
    }
    /** Testing: drop the connection as a network failure would (the session resumes by itself). */
    simulateDrop() {
      this.socket?.close(4e3, "simulated drop");
    }
    /** Skip the backoff wait (the network just came back, the page woke up). */
    reconnectNow() {
      if (this.stopped || this.status === "online")
        return;
      this.reconnects = 0;
      if (this.retryTimer !== void 0 || !this.socket)
        this.open();
    }
    rtcConfig() {
      const own = this.options.rtc || void 0;
      return own?.iceServers ? own : { ...own, iceServers: this.iceServers };
    }
    startRtc() {
      if (!this.serverRtc || this.peer || this.options.rtc === false || typeof RTCPeerConnection === "undefined" || this.status !== "online")
        return;
      const a = ++this.rtcAttempt, e = this.epoch;
      this.rtcStartedAt = performance.now();
      this.rtcRetryAt = Infinity;
      try {
        const peer = new BrowserRtcPeer({
          signal: (d) => {
            if (a === this.rtcAttempt && e === this.epoch)
              this.endpoint.sendControl({ t: "signal", e, a, d });
          },
          open: (link) => {
            if (a === this.rtcAttempt && e === this.epoch && !this.stopped)
              this.endpoint.attachDatagram(link);
            else
              link.close();
          },
          data: (data) => {
            if (a === this.rtcAttempt && e === this.epoch)
              this.endpoint.receiveBinary(data, "rtc");
          },
          closed: () => {
            if (a === this.rtcAttempt && e === this.epoch)
              this.stopRtc(true);
          },
          error: (error) => {
            if (a === this.rtcAttempt && e === this.epoch) {
              this.report(error);
              this.stopRtc(true);
            }
          }
        }, this.rtcConfig());
        this.peer = peer;
        void peer.offer().catch((error) => {
          if (this.peer === peer) {
            this.report(error);
            this.stopRtc(true);
          }
        });
      } catch (error) {
        this.report(error);
        this.stopRtc(true);
      }
    }
    stopRtc(notify) {
      const a = this.rtcAttempt, peer = this.peer;
      this.peer = void 0;
      if (notify && peer)
        this.endpoint.sendControl({ t: "rtc-reset", e: this.epoch, a });
      this.endpoint.dropDatagram(false);
      peer?.close();
      this.rtcRetryAt = performance.now() + Math.min(6e4, (this.options.rtcRetryMs ?? 3e3) * 2 ** Math.min(this.rtcFailures++, 4));
      this.noteTransport();
    }
    pump() {
      if (this.stopped)
        return;
      const now = performance.now();
      this.clock.advance(Math.max(0, now - this.lastPump));
      this.lastPump = now;
      if (this.status === "online") {
        if (now - this.lastMessage > (this.options.heartbeatTimeoutMs ?? 8e3) || now > this.wakeDeadline) {
          this.replaceSocket("heartbeat timeout");
          return;
        }
        if (this.socket && this.socket.readyState !== 1) {
          this.endpoint.detach();
          this.stopRtc(false);
          this.pendingPings.clear();
          this.closingDeadline = now + Math.min(1e3, this.options.heartbeatTimeoutMs ?? 8e3);
          this.setStatus("connecting");
          return;
        }
        const o = this.options, burst = this.burstLeft > 0 && this.pendingPings.size < 8;
        if (now - this.lastPing >= (burst ? o.syncPingMs ?? 250 : o.pingMs ?? 1e3)) {
          this.ping(now);
          if (burst)
            this.burstLeft--;
        }
        if (this.peer && now - this.rtcStartedAt > (this.options.rtcConnectTimeoutMs ?? 8e3) && !this.endpoint.fastActive)
          this.stopRtc(true);
        if (!this.peer && now >= this.rtcRetryAt)
          this.startRtc();
        this.endpoint.pump();
        this.noteTransport();
      } else if (this.socket && (now >= this.closingDeadline || now - this.openedAt > 1e4)) {
        this.replaceSocket("handshake timeout");
      }
    }
    ping(now) {
      const n = this.pingId = this.pingId + 1 >>> 0;
      if (this.endpoint.sendControl({ t: "ping", e: this.epoch, n })) {
        this.pendingPings.set(n, now);
        this.lastPing = now;
      }
      for (const [id, at] of this.pendingPings)
        if (now - at > 1e4)
          this.pendingPings.delete(id);
    }
    sendEvent(data) {
      return this.endpoint.sendEvent(data);
    }
    /** Queue the newest state for a stream. Returns its seq, or 0 before the session is online and the clock synced. */
    sendState(stream, data, options) {
      if (!this.clock.synced)
        return 0;
      return this.endpoint.sendState(stream, data, this.clock.serverTime(performance.now()), options);
    }
    flush() {
      this.endpoint.flush();
    }
    /** Stop the physical connection, retaining event counters and resume credentials in this instance. */
    pause() {
      this.stopped = true;
      ++this.generation;
      clearTimeout(this.retryTimer);
      clearInterval(this.pumpTimer);
      this.stopRtc(false);
      this.endpoint.detach();
      this.socket?.close(4003, "paused");
      this.socket = void 0;
      this.setStatus("paused");
    }
    resume() {
      if (this.status === "paused")
        this.connect();
    }
    /** Explicitly discard the old logical session after expiry. Pending actions are NOT replayed into a new session. */
    newSession() {
      this.pause();
      this.endpoint = this.makeEndpoint();
      this.token = this.id = null;
      this.epoch = 0;
      this.connect();
    }
    close() {
      if (this.status === "closed")
        return;
      try {
        this.endpoint.sendControl({ t: "leave", e: this.epoch });
      } catch {
      }
      this.pause();
      this.lifecycle?.();
      this.lifecycle = void 0;
      this.setStatus("closed");
    }
    checkpoint() {
      this.checkpointed = true;
      return this.token && this.id ? { url: this.options.url, room: this.options.room, token: this.token, id: this.id, events: this.endpoint.events.checkpoint() } : null;
    }
    /** Opt-in page lifecycle integration: pause when the page goes away or stays hidden, reconnect fast when it is back,
     * and replace a socket that died while the phone slept. Returns cleanup. */
    bindPageLifecycle(o = {}) {
      this.lifecycle?.();
      const hiddenPause = o.hiddenPauseMs ?? 2e4, wakeCheck = o.wakeCheckMs ?? 1500;
      let hideTimer;
      const pauseNow = () => {
        clearTimeout(hideTimer);
        if (this.status === "online" || this.status === "connecting")
          this.pause();
      };
      const back = () => {
        clearTimeout(hideTimer);
        if (this.status === "paused") {
          this.resume();
          return;
        }
        if (this.status === "online") {
          this.wakeDeadline = performance.now() + wakeCheck;
          this.ping(performance.now());
        } else
          this.reconnectNow();
      };
      const visible = () => {
        if (document.visibilityState === "visible")
          back();
        else {
          clearTimeout(hideTimer);
          hideTimer = setTimeout(pauseNow, hiddenPause);
        }
      };
      const unload = o.unload ?? "auto";
      const pagehide = (e) => {
        const keep = e.persisted || unload === "pause" || unload === "auto" && this.checkpointed;
        if (keep)
          pauseNow();
        else {
          clearTimeout(hideTimer);
          this.close();
        }
      };
      const pageshow = () => back(), online = () => this.reconnectNow();
      window.addEventListener("pagehide", pagehide);
      window.addEventListener("pageshow", pageshow);
      window.addEventListener("online", online);
      document.addEventListener("visibilitychange", visible);
      const off = () => {
        clearTimeout(hideTimer);
        window.removeEventListener("pagehide", pagehide);
        window.removeEventListener("pageshow", pageshow);
        window.removeEventListener("online", online);
        document.removeEventListener("visibilitychange", visible);
      };
      this.lifecycle = off;
      return off;
    }
  };

  // node_modules/twinwire/dist/core/channels.js
  var channelName = (name) => typeof name === "string" && /^[a-zA-Z0-9_][a-zA-Z0-9_.:-]{0,63}$/.test(name);
  function channelSchema(latest = {}) {
    const entries = Object.entries(latest);
    if (entries.length > 1024)
      throw new RangeError("Too many named state channels");
    const streams = /* @__PURE__ */ new Set();
    for (const [name, stream] of entries) {
      if (!channelName(name) || !Number.isInteger(stream) || stream < 1 || stream > 65535 || streams.has(stream))
        throw new TypeError("Named states need valid names and unique streams from 1 to 65535");
      streams.add(stream);
    }
    return new Map(entries);
  }
  var encoder2 = new TextEncoder();
  var decoder2 = new TextDecoder("utf-8", { fatal: true });
  function encodeChannel(data) {
    return encoder2.encode(JSON.stringify(data ?? null));
  }
  function decodeChannel(data) {
    try {
      return JSON.parse(decoder2.decode(data));
    } catch {
      return void 0;
    }
  }
  function namedEvent(data) {
    if (!data || typeof data !== "object" || Array.isArray(data) || !channelName(data.name) || !("data" in data))
      return null;
    return { name: data.name, data: data.data };
  }

  // node_modules/twinwire/dist/client/channel.js
  var EventClient = class {
    net;
    schema;
    handlers = /* @__PURE__ */ new Map();
    receivers = /* @__PURE__ */ new Map();
    connected = () => {
    };
    disconnected = () => {
    };
    onPause = () => {
    };
    onResume = () => {
    };
    onReset = () => {
    };
    constructor(options) {
      this.schema = channelSchema(options.latest);
      const age = options.stateMaxAgeMs ?? 100;
      if (!Number.isFinite(age) || age < 0 || age > 3e4)
        throw new RangeError("stateMaxAgeMs must be 0 to 30000");
      this.net = new GameClient(options);
      for (const [name, stream] of this.schema) {
        this.receivers.set(name, this.net.receiveState({
          stream,
          maxExtrapolationMs: age,
          reset: () => this.onReset(),
          apply: (state) => {
            const data = decodeChannel(state.data), handler = this.handlers.get(name);
            if (data === void 0 || !handler)
              return false;
            return handler(data) !== false;
          }
        }));
      }
      this.net.onEvent = (event) => {
        const message = namedEvent(event);
        if (message)
          this.handlers.get(message.name)?.(message.data);
      };
      let wasOnline = false;
      this.net.onStatus = (status) => {
        if (status === "online")
          wasOnline = true;
        else if (wasOnline && (status === "paused" || status === "connecting")) {
          wasOnline = false;
          this.onPause();
        }
        if (status === "lost" || status === "closed")
          this.disconnected();
      };
      this.net.onSession = (info) => {
        if (info.resumed)
          this.onResume();
        this.connected();
      };
    }
    get id() {
      return this.net.id ?? "";
    }
    get transport() {
      return this.net.transport;
    }
    on(name, handler) {
      if (!channelName(name))
        throw new TypeError("Invalid channel name");
      this.handlers.set(name, handler);
    }
    onConnect(handler) {
      this.connected = handler;
    }
    /** Called only when the session is closed/lost. Temporary interruptions use onPause and auto-resume. */
    onDisconnect(handler) {
      this.disconnected = handler;
    }
    ready(name) {
      return this.receivers.get(name)?.ready ?? false;
    }
    emit(name, data = null) {
      if (!channelName(name))
        throw new TypeError("Invalid channel name");
      const stream = this.schema.get(name);
      return stream === void 0 ? this.net.sendEvent({ name, data }) : this.net.sendState(stream, encodeChannel(data));
    }
    connect() {
      this.net.connect();
    }
    close() {
      this.net.close();
    }
  };
  function createEventClient(options) {
    const client = new EventClient(options);
    queueMicrotask(() => {
      if (client.net.status !== "closed")
        client.connect();
    });
    return client;
  }

  // shared/network.js
  var NAMESPACE = "tdbr-v1";
  var LATEST = { input: 1, state: 2 };

  // node_modules/rot-js/lib/rng.js
  var FRAC = 23283064365386963e-26;
  var RNG = class _RNG {
    constructor() {
      this._seed = 0;
      this._s0 = 0;
      this._s1 = 0;
      this._s2 = 0;
      this._c = 0;
    }
    getSeed() {
      return this._seed;
    }
    /**
     * Seed the number generator
     */
    setSeed(seed) {
      seed = seed < 1 ? 1 / seed : seed;
      this._seed = seed;
      this._s0 = (seed >>> 0) * FRAC;
      seed = seed * 69069 + 1 >>> 0;
      this._s1 = seed * FRAC;
      seed = seed * 69069 + 1 >>> 0;
      this._s2 = seed * FRAC;
      this._c = 1;
      return this;
    }
    /**
     * @returns Pseudorandom value [0,1), uniformly distributed
     */
    getUniform() {
      let t = 2091639 * this._s0 + this._c * FRAC;
      this._s0 = this._s1;
      this._s1 = this._s2;
      this._c = t | 0;
      this._s2 = t - this._c;
      return this._s2;
    }
    /**
     * @param lowerBound The lower end of the range to return a value from, inclusive
     * @param upperBound The upper end of the range to return a value from, inclusive
     * @returns Pseudorandom value [lowerBound, upperBound], using ROT.RNG.getUniform() to distribute the value
     */
    getUniformInt(lowerBound, upperBound) {
      let max = Math.max(lowerBound, upperBound);
      let min = Math.min(lowerBound, upperBound);
      return Math.floor(this.getUniform() * (max - min + 1)) + min;
    }
    /**
     * @param mean Mean value
     * @param stddev Standard deviation. ~95% of the absolute values will be lower than 2*stddev.
     * @returns A normally distributed pseudorandom value
     */
    getNormal(mean = 0, stddev = 1) {
      let u, v, r;
      do {
        u = 2 * this.getUniform() - 1;
        v = 2 * this.getUniform() - 1;
        r = u * u + v * v;
      } while (r > 1 || r == 0);
      let gauss = u * Math.sqrt(-2 * Math.log(r) / r);
      return mean + gauss * stddev;
    }
    /**
     * @returns Pseudorandom value [1,100] inclusive, uniformly distributed
     */
    getPercentage() {
      return 1 + Math.floor(this.getUniform() * 100);
    }
    /**
     * @returns Randomly picked item, null when length=0
     */
    getItem(array) {
      if (!array.length) {
        return null;
      }
      return array[Math.floor(this.getUniform() * array.length)];
    }
    /**
     * @returns New array with randomized items
     */
    shuffle(array) {
      let result = [];
      let clone = array.slice();
      while (clone.length) {
        let index = clone.indexOf(this.getItem(clone));
        result.push(clone.splice(index, 1)[0]);
      }
      return result;
    }
    /**
     * @param data key=whatever, value=weight (relative probability)
     * @returns whatever
     */
    getWeightedValue(data) {
      let total = 0;
      for (let id2 in data) {
        total += data[id2];
      }
      let random = this.getUniform() * total;
      let id, part = 0;
      for (id in data) {
        part += data[id];
        if (random < part) {
          return id;
        }
      }
      return id;
    }
    /**
     * Get RNG state. Useful for storing the state and re-setting it via setState.
     * @returns Internal state
     */
    getState() {
      return [this._s0, this._s1, this._s2, this._c];
    }
    /**
     * Set a previously retrieved state.
     */
    setState(state) {
      this._s0 = state[0];
      this._s1 = state[1];
      this._s2 = state[2];
      this._c = state[3];
      return this;
    }
    /**
     * Returns a cloned RNG
     */
    clone() {
      let clone = new _RNG();
      return clone.setState(this.getState());
    }
  };
  var rng_default = new RNG().setSeed(Date.now());

  // node_modules/rot-js/lib/display/backend.js
  var Backend = class {
    getContainer() {
      return null;
    }
    setOptions(options) {
      this._options = options;
    }
  };

  // node_modules/rot-js/lib/display/canvas.js
  var Canvas = class extends Backend {
    constructor() {
      super();
      this._ctx = document.createElement("canvas").getContext("2d");
    }
    schedule(cb) {
      requestAnimationFrame(cb);
    }
    getContainer() {
      return this._ctx.canvas;
    }
    setOptions(opts) {
      super.setOptions(opts);
      const style = opts.fontStyle ? `${opts.fontStyle} ` : ``;
      const font = `${style} ${opts.fontSize}px ${opts.fontFamily}`;
      this._ctx.font = font;
      this._updateSize();
      this._ctx.font = font;
      this._ctx.textAlign = "center";
      this._ctx.textBaseline = "middle";
    }
    clear() {
      const oldComposite = this._ctx.globalCompositeOperation;
      this._ctx.globalCompositeOperation = "copy";
      this._ctx.fillStyle = this._options.bg;
      this._ctx.fillRect(0, 0, this._ctx.canvas.width, this._ctx.canvas.height);
      this._ctx.globalCompositeOperation = oldComposite;
    }
    eventToPosition(x, y) {
      let canvas = this._ctx.canvas;
      let rect = canvas.getBoundingClientRect();
      x -= rect.left;
      y -= rect.top;
      x *= canvas.width / rect.width;
      y *= canvas.height / rect.height;
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
        return [-1, -1];
      }
      return this._normalizedEventToPosition(x, y);
    }
  };

  // node_modules/rot-js/lib/util.js
  function mod(x, n) {
    return (x % n + n) % n;
  }
  function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.substring(1);
  }
  function format(template, ...args) {
    let map = format.map;
    let replacer = function(match, group1, group2, index) {
      if (template.charAt(index - 1) == "%") {
        return match.substring(1);
      }
      if (!args.length) {
        return match;
      }
      let obj = args[0];
      let group = group1 || group2;
      let parts = group.split(",");
      let name = parts.shift() || "";
      let method = map[name.toLowerCase()];
      if (!method) {
        return match;
      }
      obj = args.shift();
      let replaced = obj[method].apply(obj, parts);
      let first = name.charAt(0);
      if (first != first.toLowerCase()) {
        replaced = capitalize(replaced);
      }
      return replaced;
    };
    return template.replace(/%(?:([a-z]+)|(?:{([^}]+)}))/gi, replacer);
  }
  format.map = {
    "s": "toString"
  };

  // node_modules/rot-js/lib/display/hex.js
  var Hex = class extends Canvas {
    constructor() {
      super();
      this._spacingX = 0;
      this._spacingY = 0;
      this._hexSize = 0;
    }
    draw(data, clearBefore) {
      let [x, y, ch, fg, bg] = data;
      let px = [
        (x + 1) * this._spacingX,
        y * this._spacingY + this._hexSize
      ];
      if (this._options.transpose) {
        px.reverse();
      }
      if (clearBefore) {
        this._ctx.fillStyle = bg;
        this._fill(px[0], px[1]);
      }
      if (!ch) {
        return;
      }
      this._ctx.fillStyle = fg;
      let chars = [].concat(ch);
      for (let i = 0; i < chars.length; i++) {
        this._ctx.fillText(chars[i], px[0], Math.ceil(px[1]));
      }
    }
    computeSize(availWidth, availHeight) {
      if (this._options.transpose) {
        availWidth += availHeight;
        availHeight = availWidth - availHeight;
        availWidth -= availHeight;
      }
      let width = Math.floor(availWidth / this._spacingX) - 1;
      let height = Math.floor((availHeight - 2 * this._hexSize) / this._spacingY + 1);
      return [width, height];
    }
    computeFontSize(availWidth, availHeight) {
      if (this._options.transpose) {
        availWidth += availHeight;
        availHeight = availWidth - availHeight;
        availWidth -= availHeight;
      }
      let hexSizeWidth = 2 * availWidth / ((this._options.width + 1) * Math.sqrt(3)) - 1;
      let hexSizeHeight = availHeight / (2 + 1.5 * (this._options.height - 1));
      let hexSize = Math.min(hexSizeWidth, hexSizeHeight);
      let oldFont = this._ctx.font;
      this._ctx.font = "100px " + this._options.fontFamily;
      let width = Math.ceil(this._ctx.measureText("W").width);
      this._ctx.font = oldFont;
      let ratio = width / 100;
      hexSize = Math.floor(hexSize) + 1;
      let fontSize = 2 * hexSize / (this._options.spacing * (1 + ratio / Math.sqrt(3)));
      return Math.ceil(fontSize) - 1;
    }
    _normalizedEventToPosition(x, y) {
      let nodeSize;
      if (this._options.transpose) {
        x += y;
        y = x - y;
        x -= y;
        nodeSize = this._ctx.canvas.width;
      } else {
        nodeSize = this._ctx.canvas.height;
      }
      let size = nodeSize / this._options.height;
      y = Math.floor(y / size);
      if (mod(y, 2)) {
        x -= this._spacingX;
        x = 1 + 2 * Math.floor(x / (2 * this._spacingX));
      } else {
        x = 2 * Math.floor(x / (2 * this._spacingX));
      }
      return [x, y];
    }
    /**
     * Arguments are pixel values. If "transposed" mode is enabled, then these two are already swapped.
     */
    _fill(cx, cy) {
      let a = this._hexSize;
      let b = this._options.border;
      const ctx = this._ctx;
      ctx.beginPath();
      if (this._options.transpose) {
        ctx.moveTo(cx - a + b, cy);
        ctx.lineTo(cx - a / 2 + b, cy + this._spacingX - b);
        ctx.lineTo(cx + a / 2 - b, cy + this._spacingX - b);
        ctx.lineTo(cx + a - b, cy);
        ctx.lineTo(cx + a / 2 - b, cy - this._spacingX + b);
        ctx.lineTo(cx - a / 2 + b, cy - this._spacingX + b);
        ctx.lineTo(cx - a + b, cy);
      } else {
        ctx.moveTo(cx, cy - a + b);
        ctx.lineTo(cx + this._spacingX - b, cy - a / 2 + b);
        ctx.lineTo(cx + this._spacingX - b, cy + a / 2 - b);
        ctx.lineTo(cx, cy + a - b);
        ctx.lineTo(cx - this._spacingX + b, cy + a / 2 - b);
        ctx.lineTo(cx - this._spacingX + b, cy - a / 2 + b);
        ctx.lineTo(cx, cy - a + b);
      }
      ctx.fill();
    }
    _updateSize() {
      const opts = this._options;
      const charWidth = Math.ceil(this._ctx.measureText("W").width);
      this._hexSize = Math.floor(opts.spacing * (opts.fontSize + charWidth / Math.sqrt(3)) / 2);
      this._spacingX = this._hexSize * Math.sqrt(3) / 2;
      this._spacingY = this._hexSize * 1.5;
      let xprop;
      let yprop;
      if (opts.transpose) {
        xprop = "height";
        yprop = "width";
      } else {
        xprop = "width";
        yprop = "height";
      }
      this._ctx.canvas[xprop] = Math.ceil((opts.width + 1) * this._spacingX);
      this._ctx.canvas[yprop] = Math.ceil((opts.height - 1) * this._spacingY + 2 * this._hexSize);
    }
  };

  // node_modules/rot-js/lib/display/rect.js
  var Rect = class _Rect extends Canvas {
    constructor() {
      super();
      this._spacingX = 0;
      this._spacingY = 0;
      this._canvasCache = {};
    }
    setOptions(options) {
      super.setOptions(options);
      this._canvasCache = {};
    }
    draw(data, clearBefore) {
      if (_Rect.cache) {
        this._drawWithCache(data);
      } else {
        this._drawNoCache(data, clearBefore);
      }
    }
    _drawWithCache(data) {
      let [x, y, ch, fg, bg] = data;
      let hash = "" + ch + fg + bg;
      let canvas;
      if (hash in this._canvasCache) {
        canvas = this._canvasCache[hash];
      } else {
        let b = this._options.border;
        canvas = document.createElement("canvas");
        let ctx = canvas.getContext("2d");
        canvas.width = this._spacingX;
        canvas.height = this._spacingY;
        ctx.fillStyle = bg;
        ctx.fillRect(b, b, canvas.width - b, canvas.height - b);
        if (ch) {
          ctx.fillStyle = fg;
          ctx.font = this._ctx.font;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          let chars = [].concat(ch);
          for (let i = 0; i < chars.length; i++) {
            ctx.fillText(chars[i], this._spacingX / 2, Math.ceil(this._spacingY / 2));
          }
        }
        this._canvasCache[hash] = canvas;
      }
      this._ctx.drawImage(canvas, x * this._spacingX, y * this._spacingY);
    }
    _drawNoCache(data, clearBefore) {
      let [x, y, ch, fg, bg] = data;
      if (clearBefore) {
        let b = this._options.border;
        this._ctx.fillStyle = bg;
        this._ctx.fillRect(x * this._spacingX + b, y * this._spacingY + b, this._spacingX - b, this._spacingY - b);
      }
      if (!ch) {
        return;
      }
      this._ctx.fillStyle = fg;
      let chars = [].concat(ch);
      for (let i = 0; i < chars.length; i++) {
        this._ctx.fillText(chars[i], (x + 0.5) * this._spacingX, Math.ceil((y + 0.5) * this._spacingY));
      }
    }
    computeSize(availWidth, availHeight) {
      let width = Math.floor(availWidth / this._spacingX);
      let height = Math.floor(availHeight / this._spacingY);
      return [width, height];
    }
    computeFontSize(availWidth, availHeight) {
      let boxWidth = Math.floor(availWidth / this._options.width);
      let boxHeight = Math.floor(availHeight / this._options.height);
      let oldFont = this._ctx.font;
      this._ctx.font = "100px " + this._options.fontFamily;
      let width = Math.ceil(this._ctx.measureText("W").width);
      this._ctx.font = oldFont;
      let ratio = width / 100;
      let widthFraction = ratio * boxHeight / boxWidth;
      if (widthFraction > 1) {
        boxHeight = Math.floor(boxHeight / widthFraction);
      }
      return Math.floor(boxHeight / this._options.spacing);
    }
    _normalizedEventToPosition(x, y) {
      return [Math.floor(x / this._spacingX), Math.floor(y / this._spacingY)];
    }
    _updateSize() {
      const opts = this._options;
      const charWidth = Math.ceil(this._ctx.measureText("W").width);
      this._spacingX = Math.ceil(opts.spacing * charWidth);
      this._spacingY = Math.ceil(opts.spacing * opts.fontSize);
      if (opts.forceSquareRatio) {
        this._spacingX = this._spacingY = Math.max(this._spacingX, this._spacingY);
      }
      this._ctx.canvas.width = opts.width * this._spacingX;
      this._ctx.canvas.height = opts.height * this._spacingY;
    }
  };
  Rect.cache = false;

  // node_modules/rot-js/lib/display/tile.js
  var Tile = class extends Canvas {
    constructor() {
      super();
      this._colorCanvas = document.createElement("canvas");
    }
    draw(data, clearBefore) {
      let [x, y, ch, fg, bg] = data;
      let tileWidth = this._options.tileWidth;
      let tileHeight = this._options.tileHeight;
      if (clearBefore) {
        if (this._options.tileColorize) {
          this._ctx.clearRect(x * tileWidth, y * tileHeight, tileWidth, tileHeight);
        } else {
          this._ctx.fillStyle = bg;
          this._ctx.fillRect(x * tileWidth, y * tileHeight, tileWidth, tileHeight);
        }
      }
      if (!ch) {
        return;
      }
      let chars = [].concat(ch);
      let fgs = [].concat(fg);
      let bgs = [].concat(bg);
      for (let i = 0; i < chars.length; i++) {
        let tile = this._options.tileMap[chars[i]];
        if (!tile) {
          throw new Error(`Char "${chars[i]}" not found in tileMap`);
        }
        if (this._options.tileColorize) {
          let canvas = this._colorCanvas;
          let context = canvas.getContext("2d");
          context.globalCompositeOperation = "source-over";
          context.clearRect(0, 0, tileWidth, tileHeight);
          let fg2 = fgs[i];
          let bg2 = bgs[i];
          context.drawImage(this._options.tileSet, tile[0], tile[1], tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
          if (fg2 != "transparent") {
            context.fillStyle = fg2;
            context.globalCompositeOperation = "source-atop";
            context.fillRect(0, 0, tileWidth, tileHeight);
          }
          if (bg2 != "transparent") {
            context.fillStyle = bg2;
            context.globalCompositeOperation = "destination-over";
            context.fillRect(0, 0, tileWidth, tileHeight);
          }
          this._ctx.drawImage(canvas, x * tileWidth, y * tileHeight, tileWidth, tileHeight);
        } else {
          this._ctx.drawImage(this._options.tileSet, tile[0], tile[1], tileWidth, tileHeight, x * tileWidth, y * tileHeight, tileWidth, tileHeight);
        }
      }
    }
    computeSize(availWidth, availHeight) {
      let width = Math.floor(availWidth / this._options.tileWidth);
      let height = Math.floor(availHeight / this._options.tileHeight);
      return [width, height];
    }
    computeFontSize() {
      throw new Error("Tile backend does not understand font size");
    }
    _normalizedEventToPosition(x, y) {
      return [Math.floor(x / this._options.tileWidth), Math.floor(y / this._options.tileHeight)];
    }
    _updateSize() {
      const opts = this._options;
      this._ctx.canvas.width = opts.width * opts.tileWidth;
      this._ctx.canvas.height = opts.height * opts.tileHeight;
      this._colorCanvas.width = opts.tileWidth;
      this._colorCanvas.height = opts.tileHeight;
    }
  };

  // node_modules/rot-js/lib/color.js
  function fromString(str) {
    let cached, r;
    if (str in CACHE) {
      cached = CACHE[str];
    } else {
      if (str.charAt(0) == "#") {
        let matched = str.match(/[0-9a-f]/gi) || [];
        let values = matched.map((x) => parseInt(x, 16));
        if (values.length == 3) {
          cached = values.map((x) => x * 17);
        } else {
          for (let i = 0; i < 3; i++) {
            values[i + 1] += 16 * values[i];
            values.splice(i, 1);
          }
          cached = values;
        }
      } else if (r = str.match(/rgb\(([0-9, ]+)\)/i)) {
        cached = r[1].split(/\s*,\s*/).map((x) => parseInt(x));
      } else {
        cached = [0, 0, 0];
      }
      CACHE[str] = cached;
    }
    return cached.slice();
  }
  var CACHE = {
    "black": [0, 0, 0],
    "navy": [0, 0, 128],
    "darkblue": [0, 0, 139],
    "mediumblue": [0, 0, 205],
    "blue": [0, 0, 255],
    "darkgreen": [0, 100, 0],
    "green": [0, 128, 0],
    "teal": [0, 128, 128],
    "darkcyan": [0, 139, 139],
    "deepskyblue": [0, 191, 255],
    "darkturquoise": [0, 206, 209],
    "mediumspringgreen": [0, 250, 154],
    "lime": [0, 255, 0],
    "springgreen": [0, 255, 127],
    "aqua": [0, 255, 255],
    "cyan": [0, 255, 255],
    "midnightblue": [25, 25, 112],
    "dodgerblue": [30, 144, 255],
    "forestgreen": [34, 139, 34],
    "seagreen": [46, 139, 87],
    "darkslategray": [47, 79, 79],
    "darkslategrey": [47, 79, 79],
    "limegreen": [50, 205, 50],
    "mediumseagreen": [60, 179, 113],
    "turquoise": [64, 224, 208],
    "royalblue": [65, 105, 225],
    "steelblue": [70, 130, 180],
    "darkslateblue": [72, 61, 139],
    "mediumturquoise": [72, 209, 204],
    "indigo": [75, 0, 130],
    "darkolivegreen": [85, 107, 47],
    "cadetblue": [95, 158, 160],
    "cornflowerblue": [100, 149, 237],
    "mediumaquamarine": [102, 205, 170],
    "dimgray": [105, 105, 105],
    "dimgrey": [105, 105, 105],
    "slateblue": [106, 90, 205],
    "olivedrab": [107, 142, 35],
    "slategray": [112, 128, 144],
    "slategrey": [112, 128, 144],
    "lightslategray": [119, 136, 153],
    "lightslategrey": [119, 136, 153],
    "mediumslateblue": [123, 104, 238],
    "lawngreen": [124, 252, 0],
    "chartreuse": [127, 255, 0],
    "aquamarine": [127, 255, 212],
    "maroon": [128, 0, 0],
    "purple": [128, 0, 128],
    "olive": [128, 128, 0],
    "gray": [128, 128, 128],
    "grey": [128, 128, 128],
    "skyblue": [135, 206, 235],
    "lightskyblue": [135, 206, 250],
    "blueviolet": [138, 43, 226],
    "darkred": [139, 0, 0],
    "darkmagenta": [139, 0, 139],
    "saddlebrown": [139, 69, 19],
    "darkseagreen": [143, 188, 143],
    "lightgreen": [144, 238, 144],
    "mediumpurple": [147, 112, 216],
    "darkviolet": [148, 0, 211],
    "palegreen": [152, 251, 152],
    "darkorchid": [153, 50, 204],
    "yellowgreen": [154, 205, 50],
    "sienna": [160, 82, 45],
    "brown": [165, 42, 42],
    "darkgray": [169, 169, 169],
    "darkgrey": [169, 169, 169],
    "lightblue": [173, 216, 230],
    "greenyellow": [173, 255, 47],
    "paleturquoise": [175, 238, 238],
    "lightsteelblue": [176, 196, 222],
    "powderblue": [176, 224, 230],
    "firebrick": [178, 34, 34],
    "darkgoldenrod": [184, 134, 11],
    "mediumorchid": [186, 85, 211],
    "rosybrown": [188, 143, 143],
    "darkkhaki": [189, 183, 107],
    "silver": [192, 192, 192],
    "mediumvioletred": [199, 21, 133],
    "indianred": [205, 92, 92],
    "peru": [205, 133, 63],
    "chocolate": [210, 105, 30],
    "tan": [210, 180, 140],
    "lightgray": [211, 211, 211],
    "lightgrey": [211, 211, 211],
    "palevioletred": [216, 112, 147],
    "thistle": [216, 191, 216],
    "orchid": [218, 112, 214],
    "goldenrod": [218, 165, 32],
    "crimson": [220, 20, 60],
    "gainsboro": [220, 220, 220],
    "plum": [221, 160, 221],
    "burlywood": [222, 184, 135],
    "lightcyan": [224, 255, 255],
    "lavender": [230, 230, 250],
    "darksalmon": [233, 150, 122],
    "violet": [238, 130, 238],
    "palegoldenrod": [238, 232, 170],
    "lightcoral": [240, 128, 128],
    "khaki": [240, 230, 140],
    "aliceblue": [240, 248, 255],
    "honeydew": [240, 255, 240],
    "azure": [240, 255, 255],
    "sandybrown": [244, 164, 96],
    "wheat": [245, 222, 179],
    "beige": [245, 245, 220],
    "whitesmoke": [245, 245, 245],
    "mintcream": [245, 255, 250],
    "ghostwhite": [248, 248, 255],
    "salmon": [250, 128, 114],
    "antiquewhite": [250, 235, 215],
    "linen": [250, 240, 230],
    "lightgoldenrodyellow": [250, 250, 210],
    "oldlace": [253, 245, 230],
    "red": [255, 0, 0],
    "fuchsia": [255, 0, 255],
    "magenta": [255, 0, 255],
    "deeppink": [255, 20, 147],
    "orangered": [255, 69, 0],
    "tomato": [255, 99, 71],
    "hotpink": [255, 105, 180],
    "coral": [255, 127, 80],
    "darkorange": [255, 140, 0],
    "lightsalmon": [255, 160, 122],
    "orange": [255, 165, 0],
    "lightpink": [255, 182, 193],
    "pink": [255, 192, 203],
    "gold": [255, 215, 0],
    "peachpuff": [255, 218, 185],
    "navajowhite": [255, 222, 173],
    "moccasin": [255, 228, 181],
    "bisque": [255, 228, 196],
    "mistyrose": [255, 228, 225],
    "blanchedalmond": [255, 235, 205],
    "papayawhip": [255, 239, 213],
    "lavenderblush": [255, 240, 245],
    "seashell": [255, 245, 238],
    "cornsilk": [255, 248, 220],
    "lemonchiffon": [255, 250, 205],
    "floralwhite": [255, 250, 240],
    "snow": [255, 250, 250],
    "yellow": [255, 255, 0],
    "lightyellow": [255, 255, 224],
    "ivory": [255, 255, 240],
    "white": [255, 255, 255]
  };

  // node_modules/rot-js/lib/display/tile-gl.js
  var TileGL = class extends Backend {
    constructor() {
      super();
      this._uniforms = {};
      try {
        this._gl = this._initWebGL();
      } catch (e) {
        if (typeof e === "string") {
          alert(e);
        } else if (e instanceof Error) {
          alert(e.message);
        }
      }
    }
    static isSupported() {
      return !!document.createElement("canvas").getContext("webgl2", { preserveDrawingBuffer: true });
    }
    schedule(cb) {
      requestAnimationFrame(cb);
    }
    getContainer() {
      return this._gl.canvas;
    }
    setOptions(opts) {
      super.setOptions(opts);
      this._updateSize();
      let tileSet = this._options.tileSet;
      if (tileSet && "complete" in tileSet && !tileSet.complete) {
        tileSet.addEventListener("load", () => this._updateTexture(tileSet));
      } else {
        this._updateTexture(tileSet);
      }
    }
    draw(data, clearBefore) {
      const gl = this._gl;
      const opts = this._options;
      let [x, y, ch, fg, bg] = data;
      let scissorY = gl.canvas.height - (y + 1) * opts.tileHeight;
      gl.scissor(x * opts.tileWidth, scissorY, opts.tileWidth, opts.tileHeight);
      if (clearBefore) {
        if (opts.tileColorize) {
          gl.clearColor(0, 0, 0, 0);
        } else {
          gl.clearColor(...parseColor(bg));
        }
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (!ch) {
        return;
      }
      let chars = [].concat(ch);
      let bgs = [].concat(bg);
      let fgs = [].concat(fg);
      gl.uniform2fv(this._uniforms["targetPosRel"], [x, y]);
      for (let i = 0; i < chars.length; i++) {
        let tile = this._options.tileMap[chars[i]];
        if (!tile) {
          throw new Error(`Char "${chars[i]}" not found in tileMap`);
        }
        gl.uniform1f(this._uniforms["colorize"], opts.tileColorize ? 1 : 0);
        gl.uniform2fv(this._uniforms["tilesetPosAbs"], tile);
        if (opts.tileColorize) {
          gl.uniform4fv(this._uniforms["tint"], parseColor(fgs[i]));
          gl.uniform4fv(this._uniforms["bg"], parseColor(bgs[i]));
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    clear() {
      const gl = this._gl;
      gl.clearColor(...parseColor(this._options.bg));
      gl.scissor(0, 0, gl.canvas.width, gl.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    computeSize(availWidth, availHeight) {
      let width = Math.floor(availWidth / this._options.tileWidth);
      let height = Math.floor(availHeight / this._options.tileHeight);
      return [width, height];
    }
    computeFontSize() {
      throw new Error("Tile backend does not understand font size");
    }
    eventToPosition(x, y) {
      let canvas = this._gl.canvas;
      let rect = canvas.getBoundingClientRect();
      x -= rect.left;
      y -= rect.top;
      x *= canvas.width / rect.width;
      y *= canvas.height / rect.height;
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
        return [-1, -1];
      }
      return this._normalizedEventToPosition(x, y);
    }
    _initWebGL() {
      let gl = document.createElement("canvas").getContext("webgl2", { preserveDrawingBuffer: true });
      window.gl = gl;
      let program = createProgram(gl, VS, FS);
      gl.useProgram(program);
      createQuad(gl);
      UNIFORMS.forEach((name) => this._uniforms[name] = gl.getUniformLocation(program, name));
      this._program = program;
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.SCISSOR_TEST);
      return gl;
    }
    _normalizedEventToPosition(x, y) {
      return [Math.floor(x / this._options.tileWidth), Math.floor(y / this._options.tileHeight)];
    }
    _updateSize() {
      const gl = this._gl;
      const opts = this._options;
      const canvasSize = [opts.width * opts.tileWidth, opts.height * opts.tileHeight];
      gl.canvas.width = canvasSize[0];
      gl.canvas.height = canvasSize[1];
      gl.viewport(0, 0, canvasSize[0], canvasSize[1]);
      gl.uniform2fv(this._uniforms["tileSize"], [opts.tileWidth, opts.tileHeight]);
      gl.uniform2fv(this._uniforms["targetSize"], canvasSize);
    }
    _updateTexture(tileSet) {
      createTexture(this._gl, tileSet);
    }
  };
  var UNIFORMS = ["targetPosRel", "tilesetPosAbs", "tileSize", "targetSize", "colorize", "bg", "tint"];
  var VS = `
#version 300 es

in vec2 tilePosRel;
out vec2 tilesetPosPx;

uniform vec2 tilesetPosAbs;
uniform vec2 tileSize;
uniform vec2 targetSize;
uniform vec2 targetPosRel;

void main() {
	vec2 targetPosPx = (targetPosRel + tilePosRel) * tileSize;
	vec2 targetPosNdc = ((targetPosPx / targetSize)-0.5)*2.0;
	targetPosNdc.y *= -1.0;

	gl_Position = vec4(targetPosNdc, 0.0, 1.0);
	tilesetPosPx = tilesetPosAbs + tilePosRel * tileSize;
}`.trim();
  var FS = `
#version 300 es
precision highp float;

in vec2 tilesetPosPx;
out vec4 fragColor;
uniform sampler2D image;
uniform bool colorize;
uniform vec4 bg;
uniform vec4 tint;

void main() {
	fragColor = vec4(0, 0, 0, 1);

	vec4 texel = texelFetch(image, ivec2(tilesetPosPx), 0);

	if (colorize) {
		texel.rgb = tint.a * tint.rgb + (1.0-tint.a) * texel.rgb;
		fragColor.rgb = texel.a*texel.rgb + (1.0-texel.a)*bg.rgb;
		fragColor.a = texel.a + (1.0-texel.a)*bg.a;
	} else {
		fragColor = texel;
	}
}`.trim();
  function createProgram(gl, vss, fss) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vss);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(vs) || "");
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fss);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(fs) || "");
    }
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || "");
    }
    return p;
  }
  function createQuad(gl) {
    const pos = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
  function createTexture(gl, data) {
    let t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return t;
  }
  var colorCache = {};
  function parseColor(color) {
    if (!(color in colorCache)) {
      let parsed;
      if (color == "transparent") {
        parsed = [0, 0, 0, 0];
      } else if (color.indexOf("rgba") > -1) {
        parsed = (color.match(/[\d.]+/g) || []).map(Number);
        for (let i = 0; i < 3; i++) {
          parsed[i] = parsed[i] / 255;
        }
      } else {
        parsed = fromString(color).map(($) => $ / 255);
        parsed.push(1);
      }
      colorCache[color] = parsed;
    }
    return colorCache[color];
  }

  // node_modules/rot-js/lib/display/term.js
  function clearToAnsi(bg) {
    return `\x1B[0;48;5;${termcolor(bg)}m\x1B[2J`;
  }
  function colorToAnsi(fg, bg) {
    return `\x1B[0;38;5;${termcolor(fg)};48;5;${termcolor(bg)}m`;
  }
  function positionToAnsi(x, y) {
    return `\x1B[${y + 1};${x + 1}H`;
  }
  function termcolor(color) {
    const SRC_COLORS = 256;
    const DST_COLORS = 6;
    const COLOR_RATIO = DST_COLORS / SRC_COLORS;
    let rgb = fromString(color);
    let r = Math.floor(rgb[0] * COLOR_RATIO);
    let g = Math.floor(rgb[1] * COLOR_RATIO);
    let b = Math.floor(rgb[2] * COLOR_RATIO);
    return r * 36 + g * 6 + b * 1 + 16;
  }
  var Term = class extends Backend {
    constructor() {
      super();
      this._offset = [0, 0];
      this._cursor = [-1, -1];
      this._lastColor = "";
    }
    schedule(cb) {
      setTimeout(cb, 1e3 / 60);
    }
    setOptions(options) {
      super.setOptions(options);
      let size = [options.width, options.height];
      let avail = this.computeSize();
      this._offset = avail.map((val, index) => Math.floor((val - size[index]) / 2));
    }
    clear() {
      process.stdout.write(clearToAnsi(this._options.bg));
    }
    draw(data, clearBefore) {
      let [x, y, ch, fg, bg] = data;
      let dx = this._offset[0] + x;
      let dy = this._offset[1] + y;
      let size = this.computeSize();
      if (dx < 0 || dx >= size[0]) {
        return;
      }
      if (dy < 0 || dy >= size[1]) {
        return;
      }
      if (dx !== this._cursor[0] || dy !== this._cursor[1]) {
        process.stdout.write(positionToAnsi(dx, dy));
        this._cursor[0] = dx;
        this._cursor[1] = dy;
      }
      if (clearBefore) {
        if (!ch) {
          ch = " ";
        }
      }
      if (!ch) {
        return;
      }
      let newColor = colorToAnsi(fg, bg);
      if (newColor !== this._lastColor) {
        process.stdout.write(newColor);
        this._lastColor = newColor;
      }
      if (ch != "	") {
        let chars = [].concat(ch);
        process.stdout.write(chars[0]);
      }
      this._cursor[0]++;
      if (this._cursor[0] >= size[0]) {
        this._cursor[0] = 0;
        this._cursor[1]++;
      }
    }
    computeFontSize() {
      throw new Error("Terminal backend has no notion of font size");
    }
    eventToPosition(x, y) {
      return [x, y];
    }
    computeSize() {
      return [process.stdout.columns, process.stdout.rows];
    }
  };

  // node_modules/rot-js/lib/text.js
  var RE_COLORS = /%([bc]){([^}]*)}/g;
  var TYPE_TEXT = 0;
  var TYPE_NEWLINE = 1;
  var TYPE_FG = 2;
  var TYPE_BG = 3;
  function tokenize(str, maxWidth) {
    let result = [];
    let offset = 0;
    str.replace(RE_COLORS, function(match, type, name, index) {
      let part2 = str.substring(offset, index);
      if (part2.length) {
        result.push({
          type: TYPE_TEXT,
          value: part2
        });
      }
      result.push({
        type: type == "c" ? TYPE_FG : TYPE_BG,
        value: name.trim()
      });
      offset = index + match.length;
      return "";
    });
    let part = str.substring(offset);
    if (part.length) {
      result.push({
        type: TYPE_TEXT,
        value: part
      });
    }
    return breakLines(result, maxWidth);
  }
  function breakLines(tokens, maxWidth) {
    if (!maxWidth) {
      maxWidth = Infinity;
    }
    let i = 0;
    let lineLength = 0;
    let lastTokenWithSpace = -1;
    while (i < tokens.length) {
      let token = tokens[i];
      if (token.type == TYPE_NEWLINE) {
        lineLength = 0;
        lastTokenWithSpace = -1;
      }
      if (token.type != TYPE_TEXT) {
        i++;
        continue;
      }
      while (lineLength == 0 && token.value.charAt(0) == " ") {
        token.value = token.value.substring(1);
      }
      let index = token.value.indexOf("\n");
      if (index != -1) {
        token.value = breakInsideToken(tokens, i, index, true);
        let arr = token.value.split("");
        while (arr.length && arr[arr.length - 1] == " ") {
          arr.pop();
        }
        token.value = arr.join("");
      }
      if (!token.value.length) {
        tokens.splice(i, 1);
        continue;
      }
      if (lineLength + token.value.length > maxWidth) {
        let index2 = -1;
        while (1) {
          let nextIndex = token.value.indexOf(" ", index2 + 1);
          if (nextIndex == -1) {
            break;
          }
          if (lineLength + nextIndex > maxWidth) {
            break;
          }
          index2 = nextIndex;
        }
        if (index2 != -1) {
          token.value = breakInsideToken(tokens, i, index2, true);
        } else if (lastTokenWithSpace != -1) {
          let token2 = tokens[lastTokenWithSpace];
          let breakIndex = token2.value.lastIndexOf(" ");
          token2.value = breakInsideToken(tokens, lastTokenWithSpace, breakIndex, true);
          i = lastTokenWithSpace;
        } else {
          token.value = breakInsideToken(tokens, i, maxWidth - lineLength, false);
        }
      } else {
        lineLength += token.value.length;
        if (token.value.indexOf(" ") != -1) {
          lastTokenWithSpace = i;
        }
      }
      i++;
    }
    tokens.push({ type: TYPE_NEWLINE });
    let lastTextToken = null;
    for (let i2 = 0; i2 < tokens.length; i2++) {
      let token = tokens[i2];
      switch (token.type) {
        case TYPE_TEXT:
          lastTextToken = token;
          break;
        case TYPE_NEWLINE:
          if (lastTextToken) {
            let arr = lastTextToken.value.split("");
            while (arr.length && arr[arr.length - 1] == " ") {
              arr.pop();
            }
            lastTextToken.value = arr.join("");
          }
          lastTextToken = null;
          break;
      }
    }
    tokens.pop();
    return tokens;
  }
  function breakInsideToken(tokens, tokenIndex, breakIndex, removeBreakChar) {
    let newBreakToken = {
      type: TYPE_NEWLINE
    };
    let newTextToken = {
      type: TYPE_TEXT,
      value: tokens[tokenIndex].value.substring(breakIndex + (removeBreakChar ? 1 : 0))
    };
    tokens.splice(tokenIndex + 1, 0, newBreakToken, newTextToken);
    return tokens[tokenIndex].value.substring(0, breakIndex);
  }

  // node_modules/rot-js/lib/constants.js
  var DEFAULT_WIDTH = 80;
  var DEFAULT_HEIGHT = 25;
  var DIRS = {
    4: [[0, -1], [1, 0], [0, 1], [-1, 0]],
    8: [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]],
    6: [[-1, -1], [1, -1], [2, 0], [1, 1], [-1, 1], [-2, 0]]
  };

  // node_modules/rot-js/lib/display/display.js
  var BACKENDS = {
    "hex": Hex,
    "rect": Rect,
    "tile": Tile,
    "tile-gl": TileGL,
    "term": Term
  };
  var DEFAULT_OPTIONS = {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    transpose: false,
    layout: "rect",
    fontSize: 15,
    spacing: 1,
    border: 0,
    forceSquareRatio: false,
    fontFamily: "monospace",
    fontStyle: "",
    fg: "#ccc",
    bg: "#000",
    tileWidth: 32,
    tileHeight: 32,
    tileMap: {},
    tileSet: null,
    tileColorize: false
  };
  var Display = class {
    constructor(options = {}) {
      this._data = {};
      this._dirty = false;
      this._options = {};
      options = Object.assign({}, DEFAULT_OPTIONS, options);
      this.setOptions(options);
      this.DEBUG = this.DEBUG.bind(this);
      this._tick = this._tick.bind(this);
      this._backend.schedule(this._tick);
    }
    /**
     * Debug helper, ideal as a map generator callback. Always bound to this.
     * @param {int} x
     * @param {int} y
     * @param {int} what
     */
    DEBUG(x, y, what) {
      let colors = [this._options.bg, this._options.fg];
      this.draw(x, y, null, null, colors[what % colors.length]);
    }
    /**
     * Clear the whole display (cover it with background color)
     */
    clear() {
      this._data = {};
      this._dirty = true;
    }
    /**
     * @see ROT.Display
     */
    setOptions(options) {
      Object.assign(this._options, options);
      if (options.width || options.height || options.fontSize || options.fontFamily || options.spacing || options.layout) {
        if (options.layout) {
          let ctor = BACKENDS[options.layout];
          this._backend = new ctor();
        }
        this._backend.setOptions(this._options);
        this._dirty = true;
      }
      return this;
    }
    /**
     * Returns currently set options
     */
    getOptions() {
      return this._options;
    }
    /**
     * Returns the DOM node of this display
     */
    getContainer() {
      return this._backend.getContainer();
    }
    /**
     * Compute the maximum width/height to fit into a set of given constraints
     * @param {int} availWidth Maximum allowed pixel width
     * @param {int} availHeight Maximum allowed pixel height
     * @returns {int[2]} cellWidth,cellHeight
     */
    computeSize(availWidth, availHeight) {
      return this._backend.computeSize(availWidth, availHeight);
    }
    /**
     * Compute the maximum font size to fit into a set of given constraints
     * @param {int} availWidth Maximum allowed pixel width
     * @param {int} availHeight Maximum allowed pixel height
     * @returns {int} fontSize
     */
    computeFontSize(availWidth, availHeight) {
      return this._backend.computeFontSize(availWidth, availHeight);
    }
    computeTileSize(availWidth, availHeight) {
      let width = Math.floor(availWidth / this._options.width);
      let height = Math.floor(availHeight / this._options.height);
      return [width, height];
    }
    /**
     * Convert a DOM event (mouse or touch) to map coordinates. Uses first touch for multi-touch.
     * @param {Event} e event
     * @returns {int[2]} -1 for values outside of the canvas
     */
    eventToPosition(e) {
      let x, y;
      if ("touches" in e) {
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
      } else {
        x = e.clientX;
        y = e.clientY;
      }
      return this._backend.eventToPosition(x, y);
    }
    /**
     * @param {int} x
     * @param {int} y
     * @param {string || string[]} ch One or more chars (will be overlapping themselves)
     * @param {string} [fg] foreground color
     * @param {string} [bg] background color
     */
    draw(x, y, ch, fg, bg) {
      if (!fg) {
        fg = this._options.fg;
      }
      if (!bg) {
        bg = this._options.bg;
      }
      let key = `${x},${y}`;
      this._data[key] = [x, y, ch, fg, bg];
      if (this._dirty === true) {
        return;
      }
      if (!this._dirty) {
        this._dirty = {};
      }
      this._dirty[key] = true;
    }
    /**
     * @param {int} x
     * @param {int} y
     * @param {string || string[]} ch One or more chars (will be overlapping themselves)
     * @param {string || null} [fg] foreground color
     * @param {string || null} [bg] background color
     */
    drawOver(x, y, ch, fg, bg) {
      const key = `${x},${y}`;
      const existing = this._data[key];
      if (existing) {
        existing[2] = ch || existing[2];
        existing[3] = fg || existing[3];
        existing[4] = bg || existing[4];
      } else {
        this.draw(x, y, ch, fg, bg);
      }
    }
    /**
     * Draws a text at given position. Optionally wraps at a maximum length. Currently does not work with hex layout.
     * @param {int} x
     * @param {int} y
     * @param {string} text May contain color/background format specifiers, %c{name}/%b{name}, both optional. %c{}/%b{} resets to default.
     * @param {int} [maxWidth] wrap at what width?
     * @returns {int} lines drawn
     */
    drawText(x, y, text, maxWidth) {
      let fg = null;
      let bg = null;
      let cx = x;
      let cy = y;
      let lines = 1;
      if (!maxWidth) {
        maxWidth = this._options.width - x;
      }
      let tokens = tokenize(text, maxWidth);
      while (tokens.length) {
        let token = tokens.shift();
        switch (token.type) {
          case TYPE_TEXT:
            let isSpace = false, isPrevSpace = false, isFullWidth = false, isPrevFullWidth = false;
            for (let i = 0; i < token.value.length; i++) {
              let cc = token.value.charCodeAt(i);
              let c = token.value.charAt(i);
              if (this._options.layout === "term") {
                let cch = cc >> 8;
                let isCJK = cch === 17 || cch >= 46 && cch <= 159 || cch >= 172 && cch <= 215 || cc >= 43360 && cc <= 43391;
                if (isCJK) {
                  this.draw(cx + 0, cy, c, fg, bg);
                  this.draw(cx + 1, cy, "	", fg, bg);
                  cx += 2;
                  continue;
                }
              }
              isFullWidth = cc > 65280 && cc < 65377 || cc > 65500 && cc < 65512 || cc > 65518;
              isSpace = c.charCodeAt(0) == 32 || c.charCodeAt(0) == 12288;
              if (isPrevFullWidth && !isFullWidth && !isSpace) {
                cx++;
              }
              if (isFullWidth && !isPrevSpace) {
                cx++;
              }
              this.draw(cx++, cy, c, fg, bg);
              isPrevSpace = isSpace;
              isPrevFullWidth = isFullWidth;
            }
            break;
          case TYPE_FG:
            fg = token.value || null;
            break;
          case TYPE_BG:
            bg = token.value || null;
            break;
          case TYPE_NEWLINE:
            cx = x;
            cy++;
            lines++;
            break;
        }
      }
      return lines;
    }
    /**
     * Timer tick: update dirty parts
     */
    _tick() {
      this._backend.schedule(this._tick);
      if (!this._dirty) {
        return;
      }
      if (this._dirty === true) {
        this._backend.clear();
        for (let id in this._data) {
          this._draw(id, false);
        }
      } else {
        for (let key in this._dirty) {
          this._draw(key, true);
        }
      }
      this._dirty = false;
    }
    /**
     * @param {string} key What to draw
     * @param {bool} clearBefore Is it necessary to clean before?
     */
    _draw(key, clearBefore) {
      let data = this._data[key];
      if (data[4] != this._options.bg) {
        clearBefore = true;
      }
      this._backend.draw(data, clearBefore);
    }
  };
  Display.Rect = Rect;
  Display.Hex = Hex;
  Display.Tile = Tile;
  Display.TileGL = TileGL;
  Display.Term = Term;

  // node_modules/rot-js/lib/fov/fov.js
  var FOV = class {
    /**
     * @class Abstract FOV algorithm
     * @param {function} lightPassesCallback Does the light pass through x,y?
     * @param {object} [options]
     * @param {int} [options.topology=8] 4/6/8
     */
    constructor(lightPassesCallback, options = {}) {
      this._lightPasses = lightPassesCallback;
      this._options = Object.assign({ topology: 8 }, options);
    }
    /**
     * Return all neighbors in a concentric ring
     * @param {int} cx center-x
     * @param {int} cy center-y
     * @param {int} r range
     */
    _getCircle(cx, cy, r) {
      let result = [];
      let dirs, countFactor, startOffset;
      switch (this._options.topology) {
        case 4:
          countFactor = 1;
          startOffset = [0, 1];
          dirs = [
            DIRS[8][7],
            DIRS[8][1],
            DIRS[8][3],
            DIRS[8][5]
          ];
          break;
        case 6:
          dirs = DIRS[6];
          countFactor = 1;
          startOffset = [-1, 1];
          break;
        case 8:
          dirs = DIRS[4];
          countFactor = 2;
          startOffset = [-1, 1];
          break;
        default:
          throw new Error("Incorrect topology for FOV computation");
          break;
      }
      let x = cx + startOffset[0] * r;
      let y = cy + startOffset[1] * r;
      for (let i = 0; i < dirs.length; i++) {
        for (let j = 0; j < r * countFactor; j++) {
          result.push([x, y]);
          x += dirs[i][0];
          y += dirs[i][1];
        }
      }
      return result;
    }
  };

  // node_modules/rot-js/lib/fov/discrete-shadowcasting.js
  var DiscreteShadowcasting = class extends FOV {
    compute(x, y, R, callback) {
      callback(x, y, 0, 1);
      if (!this._lightPasses(x, y)) {
        return;
      }
      let DATA = [];
      let A, B, cx, cy, blocks;
      for (let r = 1; r <= R; r++) {
        let neighbors = this._getCircle(x, y, r);
        let angle = 360 / neighbors.length;
        for (let i = 0; i < neighbors.length; i++) {
          cx = neighbors[i][0];
          cy = neighbors[i][1];
          A = angle * (i - 0.5);
          B = A + angle;
          blocks = !this._lightPasses(cx, cy);
          if (this._visibleCoords(Math.floor(A), Math.ceil(B), blocks, DATA)) {
            callback(cx, cy, r, 1);
          }
          if (DATA.length == 2 && DATA[0] == 0 && DATA[1] == 360) {
            return;
          }
        }
      }
    }
    /**
     * @param {int} A start angle
     * @param {int} B end angle
     * @param {bool} blocks Does current cell block visibility?
     * @param {int[][]} DATA shadowed angle pairs
     */
    _visibleCoords(A, B, blocks, DATA) {
      if (A < 0) {
        let v1 = this._visibleCoords(0, B, blocks, DATA);
        let v2 = this._visibleCoords(360 + A, 360, blocks, DATA);
        return v1 || v2;
      }
      let index = 0;
      while (index < DATA.length && DATA[index] < A) {
        index++;
      }
      if (index == DATA.length) {
        if (blocks) {
          DATA.push(A, B);
        }
        return true;
      }
      let count = 0;
      if (index % 2) {
        while (index < DATA.length && DATA[index] < B) {
          index++;
          count++;
        }
        if (count == 0) {
          return false;
        }
        if (blocks) {
          if (count % 2) {
            DATA.splice(index - count, count, B);
          } else {
            DATA.splice(index - count, count);
          }
        }
        return true;
      } else {
        while (index < DATA.length && DATA[index] < B) {
          index++;
          count++;
        }
        if (A == DATA[index - count] && count == 1) {
          return false;
        }
        if (blocks) {
          if (count % 2) {
            DATA.splice(index - count, count, A);
          } else {
            DATA.splice(index - count, count, A, B);
          }
        }
        return true;
      }
    }
  };

  // node_modules/rot-js/lib/fov/precise-shadowcasting.js
  var PreciseShadowcasting = class extends FOV {
    compute(x, y, R, callback) {
      callback(x, y, 0, 1);
      if (!this._lightPasses(x, y)) {
        return;
      }
      let SHADOWS = [];
      let cx, cy, blocks, A1, A2, visibility;
      for (let r = 1; r <= R; r++) {
        let neighbors = this._getCircle(x, y, r);
        let neighborCount = neighbors.length;
        for (let i = 0; i < neighborCount; i++) {
          cx = neighbors[i][0];
          cy = neighbors[i][1];
          A1 = [i ? 2 * i - 1 : 2 * neighborCount - 1, 2 * neighborCount];
          A2 = [2 * i + 1, 2 * neighborCount];
          blocks = !this._lightPasses(cx, cy);
          visibility = this._checkVisibility(A1, A2, blocks, SHADOWS);
          if (visibility) {
            callback(cx, cy, r, visibility);
          }
          if (SHADOWS.length == 2 && SHADOWS[0][0] == 0 && SHADOWS[1][0] == SHADOWS[1][1]) {
            return;
          }
        }
      }
    }
    /**
     * @param {int[2]} A1 arc start
     * @param {int[2]} A2 arc end
     * @param {bool} blocks Does current arc block visibility?
     * @param {int[][]} SHADOWS list of active shadows
     */
    _checkVisibility(A1, A2, blocks, SHADOWS) {
      if (A1[0] > A2[0]) {
        let v1 = this._checkVisibility(A1, [A1[1], A1[1]], blocks, SHADOWS);
        let v2 = this._checkVisibility([0, 1], A2, blocks, SHADOWS);
        return (v1 + v2) / 2;
      }
      let index1 = 0, edge1 = false;
      while (index1 < SHADOWS.length) {
        let old = SHADOWS[index1];
        let diff = old[0] * A1[1] - A1[0] * old[1];
        if (diff >= 0) {
          if (diff == 0 && !(index1 % 2)) {
            edge1 = true;
          }
          break;
        }
        index1++;
      }
      let index2 = SHADOWS.length, edge2 = false;
      while (index2--) {
        let old = SHADOWS[index2];
        let diff = A2[0] * old[1] - old[0] * A2[1];
        if (diff >= 0) {
          if (diff == 0 && index2 % 2) {
            edge2 = true;
          }
          break;
        }
      }
      let visible = true;
      if (index1 == index2 && (edge1 || edge2)) {
        visible = false;
      } else if (edge1 && edge2 && index1 + 1 == index2 && index2 % 2) {
        visible = false;
      } else if (index1 > index2 && index1 % 2) {
        visible = false;
      }
      if (!visible) {
        return 0;
      }
      let visibleLength;
      let remove = index2 - index1 + 1;
      if (remove % 2) {
        if (index1 % 2) {
          let P = SHADOWS[index1];
          visibleLength = (A2[0] * P[1] - P[0] * A2[1]) / (P[1] * A2[1]);
          if (blocks) {
            SHADOWS.splice(index1, remove, A2);
          }
        } else {
          let P = SHADOWS[index2];
          visibleLength = (P[0] * A1[1] - A1[0] * P[1]) / (A1[1] * P[1]);
          if (blocks) {
            SHADOWS.splice(index1, remove, A1);
          }
        }
      } else {
        if (index1 % 2) {
          let P1 = SHADOWS[index1];
          let P2 = SHADOWS[index2];
          visibleLength = (P2[0] * P1[1] - P1[0] * P2[1]) / (P1[1] * P2[1]);
          if (blocks) {
            SHADOWS.splice(index1, remove);
          }
        } else {
          if (blocks) {
            SHADOWS.splice(index1, remove, A1, A2);
          }
          return 1;
        }
      }
      let arcLength = (A2[0] * A1[1] - A1[0] * A2[1]) / (A1[1] * A2[1]);
      return visibleLength / arcLength;
    }
  };

  // node_modules/rot-js/lib/fov/recursive-shadowcasting.js
  var OCTANTS = [
    [-1, 0, 0, 1],
    [0, -1, 1, 0],
    [0, -1, -1, 0],
    [-1, 0, 0, -1],
    [1, 0, 0, -1],
    [0, 1, -1, 0],
    [0, 1, 1, 0],
    [1, 0, 0, 1]
  ];
  var RecursiveShadowcasting = class extends FOV {
    /**
     * Compute visibility for a 360-degree circle
     * @param {int} x
     * @param {int} y
     * @param {int} R Maximum visibility radius
     * @param {function} callback
     */
    compute(x, y, R, callback) {
      callback(x, y, 0, 1);
      for (let i = 0; i < OCTANTS.length; i++) {
        this._renderOctant(x, y, OCTANTS[i], R, callback);
      }
    }
    /**
     * Compute visibility for a 180-degree arc
     * @param {int} x
     * @param {int} y
     * @param {int} R Maximum visibility radius
     * @param {int} dir Direction to look in (expressed in a ROT.DIRS value);
     * @param {function} callback
     */
    compute180(x, y, R, dir, callback) {
      callback(x, y, 0, 1);
      let previousOctant = (dir - 1 + 8) % 8;
      let nextPreviousOctant = (dir - 2 + 8) % 8;
      let nextOctant = (dir + 1 + 8) % 8;
      this._renderOctant(x, y, OCTANTS[nextPreviousOctant], R, callback);
      this._renderOctant(x, y, OCTANTS[previousOctant], R, callback);
      this._renderOctant(x, y, OCTANTS[dir], R, callback);
      this._renderOctant(x, y, OCTANTS[nextOctant], R, callback);
    }
    /**
     * Compute visibility for a 90-degree arc
     * @param {int} x
     * @param {int} y
     * @param {int} R Maximum visibility radius
     * @param {int} dir Direction to look in (expressed in a ROT.DIRS value);
     * @param {function} callback
     */
    compute90(x, y, R, dir, callback) {
      callback(x, y, 0, 1);
      let previousOctant = (dir - 1 + 8) % 8;
      this._renderOctant(x, y, OCTANTS[dir], R, callback);
      this._renderOctant(x, y, OCTANTS[previousOctant], R, callback);
    }
    /**
     * Render one octant (45-degree arc) of the viewshed
     * @param {int} x
     * @param {int} y
     * @param {int} octant Octant to be rendered
     * @param {int} R Maximum visibility radius
     * @param {function} callback
     */
    _renderOctant(x, y, octant, R, callback) {
      this._castVisibility(x, y, 1, 1, 0, R + 1, octant[0], octant[1], octant[2], octant[3], callback);
    }
    /**
     * Actually calculates the visibility
     * @param {int} startX The starting X coordinate
     * @param {int} startY The starting Y coordinate
     * @param {int} row The row to render
     * @param {float} visSlopeStart The slope to start at
     * @param {float} visSlopeEnd The slope to end at
     * @param {int} radius The radius to reach out to
     * @param {int} xx
     * @param {int} xy
     * @param {int} yx
     * @param {int} yy
     * @param {function} callback The callback to use when we hit a block that is visible
     */
    _castVisibility(startX, startY, row, visSlopeStart, visSlopeEnd, radius, xx, xy, yx, yy, callback) {
      if (visSlopeStart < visSlopeEnd) {
        return;
      }
      for (let i = row; i <= radius; i++) {
        let dx = -i - 1;
        let dy = -i;
        let blocked = false;
        let newStart = 0;
        while (dx <= 0) {
          dx += 1;
          let mapX = startX + dx * xx + dy * xy;
          let mapY = startY + dx * yx + dy * yy;
          let slopeStart = (dx - 0.5) / (dy + 0.5);
          let slopeEnd = (dx + 0.5) / (dy - 0.5);
          if (slopeEnd > visSlopeStart) {
            continue;
          }
          if (slopeStart < visSlopeEnd) {
            break;
          }
          if (dx * dx + dy * dy < radius * radius) {
            callback(mapX, mapY, i, 1);
          }
          if (!blocked) {
            if (!this._lightPasses(mapX, mapY) && i < radius) {
              blocked = true;
              this._castVisibility(startX, startY, i + 1, visSlopeStart, slopeStart, radius, xx, xy, yx, yy, callback);
              newStart = slopeEnd;
            }
          } else {
            if (!this._lightPasses(mapX, mapY)) {
              newStart = slopeEnd;
              continue;
            }
            blocked = false;
            visSlopeStart = newStart;
          }
        }
        if (blocked) {
          break;
        }
      }
    }
  };

  // node_modules/rot-js/lib/fov/index.js
  var fov_default = { DiscreteShadowcasting, PreciseShadowcasting, RecursiveShadowcasting };

  // node_modules/rot-js/lib/noise/simplex.js
  var F2 = 0.5 * (Math.sqrt(3) - 1);
  var G2 = (3 - Math.sqrt(3)) / 6;

  // client/src/main.js
  var TILE_PX = 48;
  var CHAR_SCALE = 3;
  var INTERP_SPEED = 10;
  var CHAR_NAMES = ["Adam", "Alex", "Amelia", "Bob"];
  var DIR_OFFSETS = { right: 0, up: 6, left: 12, down: 18 };
  function hashStr(s) {
    s = String(s);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
    return Math.abs(h);
  }
  function angleToDirection(angle) {
    const a = (angle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (a < Math.PI * 0.25 || a > Math.PI * 1.75) return "right";
    if (a < Math.PI * 0.75) return "down";
    if (a < Math.PI * 1.25) return "left";
    return "up";
  }
  var LOS_RADIUS = 380;
  var visibleTiles = /* @__PURE__ */ new Set();
  var lastFovX = -1;
  var lastFovY = -1;
  var channel = null;
  var myId = null;
  var connected = false;
  var latency = 0;
  var worldRevision = null;
  var loadedRevision = null;
  var initEpoch = 0;
  var pendingEvents = [];
  var serverPlayers = [];
  var serverBots = [];
  var serverProjectiles = [];
  var serverZone = null;
  var serverEvents = [];
  var serverTick = 0;
  var mapData = null;
  var mapSize = 0;
  var mapGrid2D = null;
  var wallVariants = null;
  var gameMode = "normal";
  var groundLoot = [];
  var inputSeq = 0;
  var pendingInputs = [];
  var predictedX = 0;
  var predictedY = 0;
  var PLAYER_SPEED = 220;
  var cameraX = 0;
  var cameraY = 0;
  var CAMERA_SMOOTHING = 0.12;
  var activeScene = null;
  var playerSprites = /* @__PURE__ */ new Map();
  var botSprites = /* @__PURE__ */ new Map();
  var lootSprites = /* @__PURE__ */ new Map();
  var zoneGraphics = null;
  var fogGraphics = null;
  var combatGfx = null;
  var hpBarBg = null;
  var hpBarFill = null;
  var hpText = null;
  var boostBarBg = null;
  var boostBarFill = null;
  var weaponSlots = [];
  var minimapGfx = null;
  var killFeed = [];
  var zoneTimerText = null;
  var playerCountText = null;
  var ammoText = null;
  var reloadBarBg = null;
  var reloadBarFill = null;
  var armorText = null;
  var aliveCountText = null;
  var smokeClouds = [];
  var RARITY_COLOR = { common: 13421772, rare: 4491519, epic: 11158783, legendary: 16755200 };
  var RARITY_GLOW = { common: 6710886, rare: 2254540, epic: 7807692, legendary: 13404160 };
  var activeSlot = "primary";
  var deathOverlay = null;
  var deathElements = [];
  var isShowingDeathScreen = false;
  var clientKills = 0;
  var gameStartTime = 0;
  var leaderboardVisible = false;
  var leaderboardPanel = null;
  var leaderboardTexts = [];
  var serverLeaderboard = [];
  var audioCtx = null;
  var audioInitialized = false;
  var audioEnabled = false;
  var footstepTimer = 0;
  var zoneWarningTimer = 0;
  function initAudio() {
    if (audioInitialized) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioInitialized = true;
    } catch (e) {
    }
  }
  function toggleAudio() {
    if (!audioInitialized) initAudio();
    audioEnabled = !audioEnabled;
    return audioEnabled;
  }
  function playSound(freq, type, duration, gain = 0.1, pitchEnd = null) {
    if (!audioCtx || !audioEnabled) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (pitchEnd !== null) {
      osc.frequency.linearRampToValueAtTime(pitchEnd, audioCtx.currentTime + duration);
    }
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);
    osc.connect(g).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }
  function playNoise(duration, gain = 0.05) {
    if (!audioCtx || !audioEnabled) return;
    const bufSize = audioCtx.sampleRate * duration;
    const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    const g = audioCtx.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);
    src.connect(g).connect(audioCtx.destination);
    src.start();
  }
  function playGunshot(weaponId) {
    switch (weaponId) {
      case "pistol":
        playSound(200, "square", 0.08, 0.12);
        break;
      case "smg":
        playSound(300, "square", 0.04, 0.08);
        break;
      case "shotgun":
        playSound(100, "sawtooth", 0.12, 0.15);
        playNoise(0.08, 0.1);
        break;
      case "sniper":
        playSound(150, "square", 0.2, 0.18);
        break;
      case "ar":
        playSound(250, "square", 0.06, 0.1);
        break;
      case "lmg":
        playSound(180, "sawtooth", 0.05, 0.1);
        break;
      case "dmr":
        playSound(160, "square", 0.15, 0.14);
        break;
      default:
        playSound(250, "square", 0.06, 0.08);
    }
  }
  function playPickup() {
    playSound(800, "sine", 0.1, 0.08, 1200);
  }
  function playHitMarker() {
    playSound(1e3, "sine", 0.05, 0.06);
  }
  function playDeath() {
    playSound(200, "sine", 0.5, 0.12, 50);
  }
  function playZoneWarning() {
    playSound(400, "square", 0.15, 0.08);
  }
  function playFootstep() {
    playNoise(0.03, 0.02);
  }
  var ITEM_RARITY = {
    pistol: "common",
    smg: "rare",
    shotgun: "rare",
    sniper: "epic",
    ar: "rare",
    lmg: "epic",
    dmr: "epic",
    frag_grenade: "common",
    smoke_grenade: "common",
    medkit: "common",
    bandage: "common",
    energy_drink: "rare",
    ammo_9mm: "common",
    ammo_556: "common",
    ammo_762: "common",
    ammo_12gauge: "common",
    ammo_300: "common",
    first_aid_kit: "rare",
    medkit_full: "rare",
    painkiller: "rare",
    adrenaline: "rare",
    vest_1: "common",
    vest_2: "rare",
    vest_3: "epic",
    helmet_1: "common",
    helmet_2: "rare",
    helmet_3: "epic"
  };
  function preload() {
    for (const name of CHAR_NAMES) {
      this.load.spritesheet(`${name}_run`, `assets/limzu/${name}_run_16x16.png`, {
        frameWidth: 16,
        frameHeight: 32
      });
      this.load.spritesheet(`${name}_idle`, `assets/limzu/${name}_idle_anim_16x16.png`, {
        frameWidth: 16,
        frameHeight: 32
      });
    }
    this.load.image("rpg_tileset", "assets/limzu/rpgmaker_tileset.png");
    this.load.image("wpn_pistol", "assets/weapons/pistol.png");
    this.load.image("wpn_smg", "assets/weapons/smg.png");
    this.load.image("wpn_shotgun", "assets/weapons/shotgun.png");
    this.load.image("wpn_sniper", "assets/weapons/sniper.png");
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(16777096, 1);
    g.fillCircle(8, 8, 8);
    g.fillStyle(16777215, 1);
    g.fillCircle(8, 8, 4);
    g.generateTexture("muzzle_flash", 16, 16);
    g.clear();
    g.fillStyle(1118481, 1);
    g.fillCircle(4, 4, 4);
    g.fillStyle(3355443, 1);
    g.fillCircle(4, 4, 2);
    g.generateTexture("bullet_hole", 8, 8);
    g.clear();
    g.fillStyle(6723908, 1);
    g.fillCircle(8, 8, 7);
    g.fillStyle(8960853, 1);
    g.fillCircle(8, 8, 4);
    g.generateTexture("loot_tactical", 16, 16);
    g.clear();
    g.fillStyle(14500932, 1);
    g.fillRoundedRect(2, 2, 12, 14, 3);
    g.fillStyle(16777215, 1);
    g.fillRect(6, 5, 4, 2);
    g.fillRect(7, 4, 2, 4);
    g.generateTexture("loot_consumable", 16, 16);
    g.clear();
    g.fillStyle(11184810, 0.5);
    g.fillCircle(16, 16, 16);
    g.generateTexture("smoke_particle", 32, 32);
    g.clear();
    g.destroy();
  }
  var TILE_ROLES = {
    // Floors
    floor: { col: 35, row: 12 },
    floor_n: { col: 35, row: 11 },
    floor_s: { col: 35, row: 12 },
    floor_e: { col: 35, row: 12 },
    floor_w: { col: 34, row: 12 },
    floor_ne: { col: 35, row: 11 },
    floor_nw: { col: 34, row: 11 },
    floor_se: { col: 35, row: 12 },
    floor_sw: { col: 34, row: 12 },
    floor_corner_ne: { col: 35, row: 12 },
    floor_corner_nw: { col: 36, row: 11 },
    floor_corner_se: { col: 35, row: 12 },
    floor_corner_sw: { col: 35, row: 12 },
    // Wall faces (2 tiles tall)
    wall_top: { col: 47, row: 63 },
    wall_bot: { col: 47, row: 64 },
    wall_top_nw: { col: 49, row: 64 },
    wall_bot_nw: { col: 49, row: 65 },
    wall_top_ne: { col: 46, row: 64 },
    wall_bot_ne: { col: 46, row: 65 },
    // Side walls
    wall_s: { col: 12, row: 6 },
    wall_e: { col: 50, row: 66 },
    wall_w: { col: 45, row: 66 },
    wall_sw: { col: 45, row: 65 },
    wall_se: { col: 50, row: 65 },
    // Diagonal corners
    wall_corner_tl: { col: 53, row: 52 },
    wall_corner_tr: { col: 58, row: 52 },
    wall_corner_bl: { col: 6, row: 6 },
    wall_corner_br: { col: 5, row: 6 },
    // Top-row diagonal corners (above wall_corner_tl/tr)
    wall_topcorner_tl: { col: 45, row: 62 },
    wall_topcorner_tr: { col: 50, row: 62 }
  };
  var ROLE_NAMES = Object.keys(TILE_ROLES);
  var ROLE_TO_IDX = {};
  ROLE_NAMES.forEach((name, i) => ROLE_TO_IDX[name] = i);
  var TILE_VOID = ROLE_NAMES.length;
  function composeTileset(scene) {
    const T = TILE_PX;
    const totalTiles = ROLE_NAMES.length + 1;
    const canvas = document.createElement("canvas");
    canvas.width = totalTiles * T;
    canvas.height = T;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const srcImg = scene.textures.get("rpg_tileset").getSourceImage();
    for (let i = 0; i < ROLE_NAMES.length; i++) {
      const pos = TILE_ROLES[ROLE_NAMES[i]];
      ctx.drawImage(srcImg, pos.col * T, pos.row * T, T, T, i * T, 0, T, T);
    }
    ctx.fillStyle = "#000000";
    ctx.fillRect(TILE_VOID * T, 0, T, T);
    scene.textures.addCanvas("tileset", canvas);
  }
  function getWeaponTexture(weaponId) {
    const map = {
      pistol: "wpn_pistol",
      smg: "wpn_smg",
      shotgun: "wpn_shotgun",
      sniper: "wpn_sniper",
      ar: "wpn_smg",
      lmg: "wpn_shotgun",
      dmr: "wpn_sniper"
    };
    return map[weaponId] || null;
  }
  function create() {
    activeScene = this;
    console.time("composeTileset");
    composeTileset(this);
    console.timeEnd("composeTileset");
    const DIRS2 = ["down", "up", "right", "left"];
    for (const name of CHAR_NAMES) {
      for (const dir of DIRS2) {
        const start = DIR_OFFSETS[dir];
        this.anims.create({
          key: `${name}_run_${dir}`,
          frames: this.anims.generateFrameNumbers(`${name}_run`, { start, end: start + 5 }),
          frameRate: 10,
          repeat: -1
        });
        this.anims.create({
          key: `${name}_idle_${dir}`,
          frames: this.anims.generateFrameNumbers(`${name}_idle`, { start, end: start + 5 }),
          frameRate: 6,
          repeat: -1
        });
      }
    }
    combatGfx = this.add.graphics().setDepth(45);
    zoneGraphics = this.add.graphics().setDepth(50);
    createHUD(this);
    this.input.keyboard.addCapture("TAB");
    connectToServer(this);
  }
  function update(time, delta) {
    if (!connected || !myId || !channel.ready("state") || loadedRevision !== worldRevision) return;
    const dt = delta / 1e3;
    if (gameMode === "arena") {
      recomputeFOV();
      combatGfx.clear();
      updateSmokeClouds(dt);
      updateFogOfWar(this);
      updateBotSprites(this);
      updateLootSprites(this);
      updateHUD_frame(this);
      const arenaCenterX = mapSize / 2 * TILE_PX;
      const arenaCenterY = mapSize / 2 * TILE_PX;
      cameraX += (arenaCenterX - cameraX) * CAMERA_SMOOTHING;
      cameraY += (arenaCenterY - cameraY) * CAMERA_SMOOTHING;
      this.cameras.main.centerOn(cameraX, cameraY);
      if (!this._arenaZoomSet) {
        this.cameras.main.setZoom(1.5);
        this._arenaZoomSet = true;
      }
      return;
    }
    const keys = this.input.keyboard.addKeys({
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      e: Phaser.Input.Keyboard.KeyCodes.E,
      r: Phaser.Input.Keyboard.KeyCodes.R,
      one: Phaser.Input.Keyboard.KeyCodes.ONE,
      two: Phaser.Input.Keyboard.KeyCodes.TWO,
      three: Phaser.Input.Keyboard.KeyCodes.THREE,
      four: Phaser.Input.Keyboard.KeyCodes.FOUR,
      tab: Phaser.Input.Keyboard.KeyCodes.TAB,
      shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      ctrl: Phaser.Input.Keyboard.KeyCodes.CTRL
    });
    const me = serverPlayers.find((p) => p.id === myId);
    if (me && !me.alive) {
      if (!isShowingDeathScreen) showDeathScreen(this);
      return;
    }
    if (isShowingDeathScreen) hideDeathScreen();
    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const angle = Math.atan2(worldPoint.y - predictedY, worldPoint.x - predictedX);
    const input = {
      seq: ++inputSeq,
      keys: { w: keys.w.isDown, a: keys.a.isDown, s: keys.s.isDown, d: keys.d.isDown, shift: keys.shift.isDown, ctrl: keys.ctrl.isDown },
      angle
    };
    applyInput(input, 1 / 60);
    pendingInputs.push(input);
    if (pendingInputs.length > 120) pendingInputs.shift();
    channel.emit("input", input);
    if (input.keys.w || input.keys.a || input.keys.s || input.keys.d) {
      footstepTimer -= dt;
      if (footstepTimer <= 0) {
        playFootstep();
        footstepTimer = 0.35;
      }
    } else {
      footstepTimer = 0;
    }
    if (Phaser.Input.Keyboard.JustDown(keys.r)) {
      channel.emit("reload");
    }
    if (!window._pointerReady) {
      if (!pointer.isDown) window._pointerReady = true;
    }
    if (!window._pointerMoved) {
      if (pointer.x !== pointer.prevPosition.x || pointer.y !== pointer.prevPosition.y) {
        window._pointerMoved = true;
      }
    }
    const aimDist = Math.hypot(worldPoint.x - predictedX, worldPoint.y - predictedY);
    if (pointer.isDown && window._pointerReady && window._pointerMoved && aimDist > 20 && !keys.shift.isDown && !(me && me.reloading)) {
      const now = Date.now();
      if (!window._lastFireTime) window._lastFireTime = 0;
      const minInterval = 100;
      if (now - window._lastFireTime >= minInterval) {
        channel.emit("fire", { angle, slot: activeSlot, latency });
        window._lastFireTime = now;
      }
    }
    if (Phaser.Input.Keyboard.JustDown(keys.e)) {
      const nl = findNearestLoot();
      if (nl) channel.emit("pickup", { lootId: nl.id });
    }
    if (Phaser.Input.Keyboard.JustDown(keys.one)) activeSlot = "primary";
    if (Phaser.Input.Keyboard.JustDown(keys.two)) activeSlot = "secondary";
    if (Phaser.Input.Keyboard.JustDown(keys.three)) activeSlot = "tactical";
    if (Phaser.Input.Keyboard.JustDown(keys.four)) {
      channel.emit("use_item", { slot: "consumable", index: 0 });
    }
    if (Phaser.Input.Keyboard.JustDown(keys.tab)) {
      leaderboardVisible = !leaderboardVisible;
    }
    updateLeaderboard(this);
    recomputeFOV();
    combatGfx.clear();
    updateSmokeClouds(dt);
    updateFogOfWar(this);
    updatePlayerSprites(this);
    updateBotSprites(this);
    updateLootSprites(this);
    updateZoneGraphics();
    updateHUD_frame(this);
    updateMinimap();
    if (serverZone && me) {
      const dx = predictedX - serverZone.current.x;
      const dy = predictedY - serverZone.current.y;
      const distToCenter = Math.sqrt(dx * dx + dy * dy);
      if (distToCenter > serverZone.current.radius) {
        zoneWarningTimer -= dt;
        if (zoneWarningTimer <= 0) {
          playZoneWarning();
          zoneWarningTimer = 3;
        }
      } else {
        zoneWarningTimer = 0;
      }
    }
    cameraX += (predictedX - cameraX) * CAMERA_SMOOTHING;
    cameraY += (predictedY - cameraY) * CAMERA_SMOOTHING;
    this.cameras.main.centerOn(cameraX, cameraY);
  }
  function connectToServer(scene) {
    const url = new URL("/connect", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    channel = createEventClient({ url: url.href, room: NAMESPACE, latest: LATEST, stateMaxAgeMs: 250, rtc: new URLSearchParams(location.search).get("rtc") === "0" ? false : void 0 });
    channel.net.bindPageLifecycle();
    channel.onPause = () => {
      connected = false;
    };
    channel.onReset = () => {
      initEpoch++;
      loadedRevision = null;
      pendingInputs = [];
      pendingEvents = [];
      serverPlayers = [];
      serverBots = [];
      serverProjectiles = [];
    };
    channel.onConnect(() => {
      connected = true;
      console.log("Connected");
    });
    channel.on("init", async (initial) => {
      const epoch = ++initEpoch;
      worldRevision = initial.worldRevision;
      loadedRevision = null;
      pendingInputs = [];
      pendingEvents = [];
      let world;
      try {
        const response = await fetch(initial.worldURL, { cache: "no-store" });
        if (!response.ok) throw Error("World bootstrap unavailable");
        world = await response.json();
      } catch (error) {
        console.error(error);
        return;
      }
      if (epoch !== initEpoch || world.worldRevision !== worldRevision) return;
      const data = { ...world, ...initial };
      console.time("init_total");
      myId = data.playerId;
      gameStartTime = Date.now();
      mapData = data.map;
      mapSize = data.mapSize;
      predictedX = data.playerState.x;
      predictedY = data.playerState.y;
      cameraX = predictedX;
      cameraY = predictedY;
      groundLoot = data.loot;
      serverBots = data.bots;
      serverZone = data.zone;
      wallVariants = data.wallVariants || null;
      gameMode = data.mode || "normal";
      mapGrid2D = [];
      for (let r = 0; r < mapSize; r++) {
        mapGrid2D[r] = [];
        for (let c = 0; c < mapSize; c++) {
          mapGrid2D[r][c] = mapData[r * mapSize + c];
        }
      }
      if (scene._tileMapLayer) scene._tileMapLayer.destroy();
      if (scene._debugLabels) {
        for (const txt of scene._debugLabels) txt.destroy();
      }
      scene._debugLabels = [];
      console.time("buildTilemap");
      buildTilemap(scene);
      console.timeEnd("buildTilemap");
      buildFogOfWar(scene);
      console.timeEnd("init_total");
      loadedRevision = data.worldRevision;
      console.log(`Init: id=${myId} map=${mapSize}x${mapSize}`);
    });
    channel.on("game-events", (data) => {
      if (data.worldRevision === worldRevision) {
        pendingEvents.push(...data.events);
        if (pendingEvents.length > 256) pendingEvents.splice(0, pendingEvents.length - 256);
      }
    });
    channel.on("state", (data) => {
      if (data.worldRevision !== loadedRevision) return false;
      serverTick = data.tick;
      serverPlayers = data.players;
      serverBots = data.bots;
      serverProjectiles = data.projectiles;
      serverZone = data.zone;
      serverEvents = pendingEvents.splice(0);
      serverLeaderboard = data.leaderboard || [];
      reconcile();
      processEvents(scene);
    });
  }
  function reconcile() {
    const me = serverPlayers.find((p) => p.id === myId);
    if (!me) return;
    pendingInputs = pendingInputs.filter((i) => i.seq > me.lastSeq);
    const dx = me.x - predictedX, dy = me.y - predictedY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 100) {
      predictedX = me.x;
      predictedY = me.y;
      cameraX = me.x;
      cameraY = me.y;
    } else if (dist > 3) {
      predictedX = me.x;
      predictedY = me.y;
      for (const inp of pendingInputs) applyInput(inp, 1 / 60);
    }
  }
  var CHAR_RADIUS = 8;
  function clientIsWalkable(px, py) {
    if (!mapGrid2D) return true;
    for (const [ox, oy] of [[-CHAR_RADIUS, -CHAR_RADIUS], [CHAR_RADIUS, -CHAR_RADIUS], [-CHAR_RADIUS, CHAR_RADIUS], [CHAR_RADIUS, CHAR_RADIUS]]) {
      const tx = Math.floor((px + ox) / TILE_PX);
      const ty = Math.floor((py + oy) / TILE_PX);
      if (tx < 0 || ty < 0 || tx >= mapSize || ty >= mapSize) return false;
      const t = mapGrid2D[ty][tx];
      if (t !== 1 && t !== 3 && t !== 5) return false;
    }
    return true;
  }
  function tileBlocksVision(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= mapSize || ty >= mapSize) return true;
    const t = mapGrid2D[ty][tx];
    return t === 0 || t === 2 || t === 4;
  }
  function applyInput(input, dt) {
    let vx = 0, vy = 0;
    if (input.keys.a) vx -= 1;
    if (input.keys.d) vx += 1;
    if (input.keys.w) vy -= 1;
    if (input.keys.s) vy += 1;
    if (vx !== 0 && vy !== 0) {
      vx *= 0.7071;
      vy *= 0.7071;
    }
    let speed = PLAYER_SPEED;
    const isSprinting = input.keys.shift && (vx !== 0 || vy !== 0);
    const isCrouching = input.keys.ctrl && !isSprinting;
    if (isSprinting) speed *= 1.5;
    if (isCrouching) speed *= 0.5;
    const mx = vx * speed * dt, my = vy * speed * dt;
    if (clientIsWalkable(predictedX + mx, predictedY + my)) {
      predictedX += mx;
      predictedY += my;
      return;
    }
    let movedX = false, movedY = false;
    if (mx !== 0 && clientIsWalkable(predictedX + mx, predictedY)) {
      predictedX += mx;
      movedX = true;
    }
    if (my !== 0 && clientIsWalkable(predictedX, predictedY + my)) {
      predictedY += my;
      movedY = true;
    }
    if (movedX || movedY) return;
    const tileAlignX = Math.round(predictedX / TILE_PX) * TILE_PX + TILE_PX / 2;
    const tileAlignY = Math.round(predictedY / TILE_PX) * TILE_PX + TILE_PX / 2;
    const nudge = 2;
    if (mx !== 0) {
      const diffY = tileAlignY - predictedY;
      if (Math.abs(diffY) > 2) {
        const ny = diffY > 0 ? nudge : -nudge;
        if (clientIsWalkable(predictedX, predictedY + ny)) {
          predictedY += ny;
        }
      }
    }
    if (my !== 0) {
      const diffX = tileAlignX - predictedX;
      if (Math.abs(diffX) > 2) {
        const nx = diffX > 0 ? nudge : -nudge;
        if (clientIsWalkable(predictedX + nx, predictedY)) {
          predictedX += nx;
        }
      }
    }
  }
  function findNearestLoot() {
    let best = null, bestD = 50;
    for (const l of groundLoot) {
      if (l.pickedUp) continue;
      const d = Math.hypot(l.x - predictedX, l.y - predictedY);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best;
  }
  function buildTilemap(scene) {
    const grid2D = mapGrid2D;
    const W = 0, F_TILES = /* @__PURE__ */ new Set([1, 2, 3, 5]);
    function isFloor(r, c) {
      if (r < 0 || c < 0 || r >= mapSize || c >= mapSize) return false;
      return F_TILES.has(grid2D[r][c]);
    }
    function isWall(r, c) {
      if (r < 0 || c < 0 || r >= mapSize || c >= mapSize) return false;
      return grid2D[r][c] === W;
    }
    function get(r, c) {
      if (r < 0 || c < 0 || r >= mapSize || c >= mapSize) return -1;
      return grid2D[r][c];
    }
    const isVisibleWall = new Uint8Array(mapSize * mapSize);
    for (let r = 0; r < mapSize; r++) {
      for (let c = 0; c < mapSize; c++) {
        if (grid2D[r][c] === W) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              if (isFloor(r + dr, c + dc)) {
                isVisibleWall[r * mapSize + c] = 1;
                break;
              }
            }
            if (isVisibleWall[r * mapSize + c]) break;
          }
        }
      }
    }
    const isWallBot = new Uint8Array(mapSize * mapSize);
    const isWallTop = new Uint8Array(mapSize * mapSize);
    for (let r = 0; r < mapSize; r++)
      for (let c = 0; c < mapSize; c++)
        if (grid2D[r][c] === W && isFloor(r + 1, c)) isWallBot[r * mapSize + c] = 1;
    for (let r = 0; r < mapSize; r++)
      for (let c = 0; c < mapSize; c++)
        if (grid2D[r][c] === W && r + 1 < mapSize && isWallBot[(r + 1) * mapSize + c])
          isWallTop[r * mapSize + c] = 1;
    const isCornerBot = new Uint8Array(mapSize * mapSize);
    for (let r = 0; r < mapSize; r++) {
      for (let c = 0; c < mapSize; c++) {
        if (grid2D[r][c] !== W) continue;
        if (isWallBot[r * mapSize + c] || isWallTop[r * mapSize + c]) continue;
        const hN = isFloor(r - 1, c), hS = isFloor(r + 1, c), hE = isFloor(r, c + 1), hW = isFloor(r, c - 1);
        if (hN || hS || hE || hW) continue;
        if (isFloor(r + 1, c + 1)) isCornerBot[r * mapSize + c] = 1;
        else if (isFloor(r + 1, c - 1)) isCornerBot[r * mapSize + c] = 2;
      }
    }
    const isCornerTop = new Uint8Array(mapSize * mapSize);
    for (let r = 0; r < mapSize; r++) {
      for (let c = 0; c < mapSize; c++) {
        if (r + 1 < mapSize && isCornerBot[(r + 1) * mapSize + c]) {
          if (grid2D[r][c] === W && !isWallBot[r * mapSize + c] && !isWallTop[r * mapSize + c]) {
            isCornerTop[r * mapSize + c] = isCornerBot[(r + 1) * mapSize + c];
          }
        }
      }
    }
    for (let r = 0; r < mapSize; r++) {
      for (let c = 0; c < mapSize; c++) {
        const idx = r * mapSize + c;
        if (isWallTop[idx] || isCornerTop[idx]) {
          isVisibleWall[idx] = 1;
        }
      }
    }
    const roleGrid = Array.from({ length: mapSize }, () => new Array(mapSize).fill("void"));
    for (let r = 0; r < mapSize; r++) {
      for (let c = 0; c < mapSize; c++) {
        const tile = grid2D[r][c];
        const idx = r * mapSize + c;
        if (tile !== W && !F_TILES.has(tile)) {
          roleGrid[r][c] = "void";
          continue;
        }
        if (F_TILES.has(tile)) {
          const wN = isWall(r - 1, c), wS = isWall(r + 1, c), wE = isWall(r, c + 1), wW = isWall(r, c - 1);
          const wNE = isWall(r - 1, c + 1), wNW = isWall(r - 1, c - 1), wSE = isWall(r + 1, c + 1), wSW = isWall(r + 1, c - 1);
          if (wN && wW) roleGrid[r][c] = "floor_nw";
          else if (wN && wE) roleGrid[r][c] = "floor_ne";
          else if (wS && wW) roleGrid[r][c] = "floor_sw";
          else if (wS && wE) roleGrid[r][c] = "floor_se";
          else if (wN) roleGrid[r][c] = "floor_n";
          else if (wS) roleGrid[r][c] = "floor_s";
          else if (wE) roleGrid[r][c] = "floor_e";
          else if (wW) roleGrid[r][c] = "floor_w";
          else if (wNW) roleGrid[r][c] = "floor_corner_nw";
          else if (wNE) roleGrid[r][c] = "floor_corner_ne";
          else if (wSW) roleGrid[r][c] = "floor_corner_sw";
          else if (wSE) roleGrid[r][c] = "floor_corner_se";
          else roleGrid[r][c] = "floor";
          continue;
        }
        if (!isVisibleWall[idx]) {
          roleGrid[r][c] = "void";
          continue;
        }
        if (isWallBot[idx]) {
          const floorLeft = c > 0 && isFloor(r, c - 1);
          const floorRight = c < mapSize - 1 && isFloor(r, c + 1);
          if (floorLeft) roleGrid[r][c] = "wall_bot_nw";
          else if (floorRight) roleGrid[r][c] = "wall_bot_ne";
          else roleGrid[r][c] = "wall_bot";
        } else if (isWallTop[idx]) {
          const floorLeft = c > 0 && isFloor(r, c - 1);
          const floorRight = c < mapSize - 1 && isFloor(r, c + 1);
          if (floorLeft) roleGrid[r][c] = "wall_top_nw";
          else if (floorRight) roleGrid[r][c] = "wall_top_ne";
          else roleGrid[r][c] = "wall_top";
        } else if (isCornerTop[idx]) {
          roleGrid[r][c] = isCornerTop[idx] === 1 ? "wall_topcorner_tl" : "wall_topcorner_tr";
        } else if (isCornerBot[idx]) {
          roleGrid[r][c] = isCornerBot[idx] === 1 ? "wall_corner_tl" : "wall_corner_tr";
        } else {
          const hN = isFloor(r - 1, c), hE = isFloor(r, c + 1), hW = isFloor(r, c - 1);
          if (hN && hE) roleGrid[r][c] = "wall_sw";
          else if (hN && hW) roleGrid[r][c] = "wall_se";
          else if (hN) roleGrid[r][c] = "wall_s";
          else if (hE) roleGrid[r][c] = "wall_w";
          else if (hW) roleGrid[r][c] = "wall_e";
          else {
            const dne = isFloor(r - 1, c + 1), dnw = isFloor(r - 1, c - 1);
            if (dne) roleGrid[r][c] = "wall_corner_bl";
            else if (dnw) roleGrid[r][c] = "wall_corner_br";
            else roleGrid[r][c] = "void";
          }
        }
      }
    }
    const displayGrid = roleGrid.map((row) => row.map((role) => {
      const idx = ROLE_TO_IDX[role];
      return idx !== void 0 ? idx : TILE_VOID;
    }));
    const map = scene.make.tilemap({ data: displayGrid, tileWidth: TILE_PX, tileHeight: TILE_PX });
    const tileset = map.addTilesetImage("tileset", "tileset", TILE_PX, TILE_PX, 0, 0);
    scene._tileMapLayer = map.createLayer(0, tileset, 0, 0).setDepth(0);
    const debugLabels = scene._debugLabels;
    let debugVisible = false;
    let debugCreated = false;
    const SHORT_LABELS = {
      floor: "F",
      floor_n: "Fn",
      floor_s: "Fs",
      floor_e: "Fe",
      floor_w: "Fw",
      floor_ne: "Fne",
      floor_nw: "Fnw",
      floor_se: "Fse",
      floor_sw: "Fsw",
      floor_corner_ne: "F*ne",
      floor_corner_nw: "F*nw",
      floor_corner_se: "F*se",
      floor_corner_sw: "F*sw",
      wall_top: "WT",
      wall_bot: "WB",
      wall_top_nw: "WTnw",
      wall_bot_nw: "WBnw",
      wall_top_ne: "WTne",
      wall_bot_ne: "WBne",
      wall_s: "Ws",
      wall_e: "We",
      wall_w: "Ww",
      wall_sw: "Wsw",
      wall_se: "Wse",
      wall_corner_tl: "W*tl",
      wall_corner_tr: "W*tr",
      wall_corner_bl: "W*bl",
      wall_corner_br: "W*br",
      wall_topcorner_tl: "WT*tl",
      wall_topcorner_tr: "WT*tr"
    };
    function createDebugOverlay() {
      if (debugCreated) return;
      debugCreated = true;
      console.time("createDebugOverlay");
      for (let r = 0; r < mapSize; r++) {
        for (let c = 0; c < mapSize; c++) {
          const role = roleGrid[r][c];
          if (role === "void") continue;
          const label = SHORT_LABELS[role] || role;
          const isWall2 = role.startsWith("wall");
          const txt = scene.add.text(
            c * TILE_PX + TILE_PX / 2,
            r * TILE_PX + TILE_PX / 2,
            label,
            {
              fontSize: "8px",
              fontFamily: "monospace",
              color: isWall2 ? "#ff8844" : "#ffffff",
              align: "center",
              stroke: "#000000",
              strokeThickness: 2
            }
          ).setOrigin(0.5).setDepth(3);
          debugLabels.push(txt);
        }
      }
      console.timeEnd("createDebugOverlay");
    }
    scene.input.keyboard.on("keydown-O", () => {
      debugVisible = !debugVisible;
      if (debugVisible && !debugCreated) createDebugOverlay();
      for (const txt of debugLabels) txt.setVisible(debugVisible);
    });
    scene.input.keyboard.on("keydown-P", () => {
      if (channel) channel.emit("restart_server");
    });
    scene.physics.world.setBounds(0, 0, mapSize * TILE_PX, mapSize * TILE_PX);
    scene.cameras.main.setBounds(0, 0, mapSize * TILE_PX, mapSize * TILE_PX);
  }
  function buildFogOfWar(scene) {
    fogGraphics = scene.add.graphics().setDepth(55).setScrollFactor(0);
  }
  function updateFogOfWar(scene) {
    if (fogGraphics) fogGraphics.clear();
  }
  function recomputeFOV() {
    const playerTX = Math.floor(predictedX / TILE_PX);
    const playerTY = Math.floor(predictedY / TILE_PX);
    if (playerTX === lastFovX && playerTY === lastFovY) return;
    lastFovX = playerTX;
    lastFovY = playerTY;
    visibleTiles.clear();
    const fov = new fov_default.PreciseShadowcasting((x, y) => {
      if (x < 0 || y < 0 || x >= mapSize || y >= mapSize) return false;
      const t = mapGrid2D[y][x];
      return t === 1 || t === 3 || t === 5;
    });
    const radiusTiles = Math.ceil(LOS_RADIUS / TILE_PX);
    fov.compute(playerTX, playerTY, radiusTiles, (x, y, r, visibility) => {
      if (visibility > 0) {
        visibleTiles.add(x + "," + y);
      }
    });
  }
  function isInPlayerLOS(x, y) {
    return true;
  }
  function hasDirectLOS(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const steps = Math.ceil(dist / 4);
    const sx = dx / steps, sy = dy / steps;
    for (let i = 1; i < steps; i++) {
      const px = x1 + sx * i, py = y1 + sy * i;
      const tx = Math.floor(px / TILE_PX), ty = Math.floor(py / TILE_PX);
      if (tileBlocksVision(tx, ty)) return false;
    }
    return true;
  }
  function processEvents(scene) {
    for (const ev of serverEvents) {
      switch (ev.type) {
        case "fire": {
          const shooter = serverPlayers.find((p) => p.id === ev.shooterId) || serverBots.find((b) => b.id === ev.shooterId);
          if (!shooter) break;
          const botEntry = botSprites.get(ev.shooterId);
          const playerEntry = playerSprites.get(ev.shooterId);
          const spriteEntry = botEntry || playerEntry;
          const originX = spriteEntry ? spriteEntry.body.x : shooter.x;
          const originY = (spriteEntry ? spriteEntry.body.y : shooter.y) - 20;
          let tracerEndX = originX + Math.cos(ev.angle) * 500;
          let tracerEndY = originY + Math.sin(ev.angle) * 500;
          const raySteps = Math.ceil(500 / 8);
          for (let i = 1; i <= raySteps; i++) {
            const rx = originX + Math.cos(ev.angle) * i * 8;
            const ry = originY + Math.sin(ev.angle) * i * 8;
            const tx = Math.floor(rx / TILE_PX), ty = Math.floor(ry / TILE_PX);
            if (tileBlocksVision(tx, ty)) {
              tracerEndX = rx;
              tracerEndY = ry;
              break;
            }
          }
          const sx = originX + Math.cos(ev.angle) * 24;
          const sy = originY + Math.sin(ev.angle) * 24;
          drawTracer(scene, sx, sy, tracerEndX, tracerEndY);
          const flash = scene.add.sprite(
            sx + Math.cos(ev.angle) * 8,
            sy + Math.sin(ev.angle) * 8,
            "muzzle_flash"
          ).setDepth(46).setAlpha(0.9).setScale(0.8);
          scene.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 1.5,
            duration: 60,
            onComplete: () => flash.destroy()
          });
          playGunshot(ev.weapon);
          break;
        }
        case "hit": {
          playHitMarker();
          if (ev.targetType === "bot") {
            const entry = botSprites.get(ev.targetId);
            if (entry) {
              entry.body.setTint(16711680);
              scene.time.delayedCall(120, () => entry.body.clearTint());
            }
          } else if (ev.targetType === "player") {
            const entry = playerSprites.get(ev.targetId);
            if (entry) {
              entry.body.setTint(16711680);
              scene.time.delayedCall(120, () => entry.body.clearTint());
            }
          }
          if (ev.x !== void 0 && ev.y !== void 0) {
            for (let i = 0; i < 3; i++) {
              const particle = scene.add.circle(
                ev.x + (Math.random() - 0.5) * 12,
                ev.y + (Math.random() - 0.5) * 12,
                2 + Math.random() * 3,
                16720418,
                0.8
              ).setDepth(47);
              scene.tweens.add({
                targets: particle,
                alpha: 0,
                scale: 0.3,
                x: particle.x + (Math.random() - 0.5) * 16,
                y: particle.y + (Math.random() - 0.5) * 16,
                duration: 200 + Math.random() * 100,
                onComplete: () => particle.destroy()
              });
            }
          }
          break;
        }
        case "wallhit": {
          const hole = scene.add.sprite(ev.x, ev.y, "bullet_hole").setDepth(2).setAlpha(0.8);
          scene.tweens.add({
            targets: hole,
            alpha: 0,
            duration: 5e3,
            delay: 3e3,
            onComplete: () => hole.destroy()
          });
          break;
        }
        case "explosion": {
          const explosionRadius = ev.radius || 60;
          for (let i = 0; i < 5; i++) {
            const colors = [16729088, 16746496, 16763904, 16737792, 16755200];
            const c = scene.add.circle(
              ev.x + (Math.random() - 0.5) * 20,
              ev.y + (Math.random() - 0.5) * 20,
              explosionRadius * (0.3 + Math.random() * 0.4),
              colors[i],
              0
            ).setDepth(46);
            scene.tweens.add({
              targets: c,
              alpha: { from: 0, to: 0.8 },
              scale: { from: 0.3, to: 1.2 },
              duration: 80,
              delay: i * 40,
              onComplete: () => {
                scene.tweens.add({
                  targets: c,
                  alpha: 0,
                  duration: 150,
                  onComplete: () => c.destroy()
                });
              }
            });
          }
          for (let i = 0; i < 3; i++) {
            const smokeC = scene.add.circle(
              ev.x + (Math.random() - 0.5) * 30,
              ev.y + (Math.random() - 0.5) * 30,
              explosionRadius * 0.5,
              8947848,
              0
            ).setDepth(45);
            scene.tweens.add({
              targets: smokeC,
              alpha: { from: 0, to: 0.5 },
              scale: 1.5,
              duration: 300,
              delay: 250 + i * 80,
              onComplete: () => {
                scene.tweens.add({
                  targets: smokeC,
                  alpha: 0,
                  duration: 500,
                  onComplete: () => smokeC.destroy()
                });
              }
            });
          }
          break;
        }
        case "pickup": {
          const l = groundLoot.find((x) => x.id === ev.lootId);
          if (l) l.pickedUp = true;
          playPickup();
          break;
        }
        case "kill": {
          addKillFeedEntry(scene, ev.killerId, ev.targetId);
          if (ev.killerId === myId) clientKills++;
          playDeath();
          break;
        }
        case "use_item": {
          if (ev.playerId === myId) {
            const healFx = scene.add.circle(predictedX, predictedY, 20, 4521830, 0.4).setDepth(25);
            scene.tweens.add({
              targets: healFx,
              alpha: 0,
              scale: 2,
              duration: 400,
              onComplete: () => healFx.destroy()
            });
          }
          break;
        }
        case "round_end": {
          const sw = scene.scale.width, sh = scene.scale.height;
          const banner = scene.add.rectangle(sw / 2, sh / 2 - 40, 300, 80, 657946, 0.9).setScrollFactor(0).setDepth(300).setStrokeStyle(2, 16755200);
          const winText = scene.add.text(sw / 2, sh / 2 - 55, `WINNER: ${ev.winner}`, {
            fontSize: "18px",
            fill: "#ffdd44",
            fontFamily: "monospace",
            fontStyle: "bold"
          }).setScrollFactor(0).setDepth(301).setOrigin(0.5);
          const hpText2 = scene.add.text(sw / 2, sh / 2 - 30, `HP: ${ev.winnerHp}`, {
            fontSize: "14px",
            fill: "#44ff66",
            fontFamily: "monospace"
          }).setScrollFactor(0).setDepth(301).setOrigin(0.5);
          const restartText = scene.add.text(sw / 2, sh / 2 - 10, `Restarting in ${ev.seconds}s...`, {
            fontSize: "12px",
            fill: "#aaaaaa",
            fontFamily: "monospace"
          }).setScrollFactor(0).setDepth(301).setOrigin(0.5);
          scene.time.delayedCall((ev.seconds || 3) * 1e3, () => {
            banner.destroy();
            winText.destroy();
            hpText2.destroy();
            restartText.destroy();
          });
          break;
        }
      }
    }
  }
  function drawTracer(scene, x1, y1, x2, y2) {
    const tracer = scene.add.graphics().setDepth(44);
    tracer.lineStyle(2, 16777028, 0.9);
    tracer.beginPath();
    tracer.moveTo(x1, y1);
    tracer.lineTo(x2, y2);
    tracer.strokePath();
    scene.tweens.add({
      targets: tracer,
      alpha: 0,
      duration: 80,
      onComplete: () => tracer.destroy()
    });
  }
  function updateSmokeClouds(dt) {
    for (let i = smokeClouds.length - 1; i >= 0; i--) {
      const c = smokeClouds[i];
      c.timer -= dt;
      c.radius = Math.min(c.maxRadius, c.radius + dt * 30);
      if (c.timer <= 0) {
        smokeClouds.splice(i, 1);
      }
    }
  }
  function updatePlayerSprites(scene) {
    const active = /* @__PURE__ */ new Set();
    for (const p of serverPlayers) {
      active.add(p.id);
      const isMe = p.id === myId;
      let entry = playerSprites.get(p.id);
      if (!entry) {
        const charName = CHAR_NAMES[hashStr(p.id) % CHAR_NAMES.length];
        const body = scene.add.sprite(0, 0, `${charName}_idle`, 0).setDepth(20).setScale(CHAR_SCALE).setOrigin(0.5, 1);
        const weapon = scene.add.sprite(0, 0, "wpn_pistol").setDepth(21).setScale(3).setOrigin(0, 0.5).setVisible(false);
        entry = { body, weapon, charName, lastDir: "down", prevX: 0, prevY: 0 };
        playerSprites.set(p.id, entry);
      }
      let sx, sy;
      if (isMe) {
        sx = predictedX;
        sy = predictedY;
      } else {
        if (!isInPlayerLOS(p.x, p.y)) {
          entry.body.setVisible(false);
          entry.weapon.setVisible(false);
          continue;
        }
        entry.body.setVisible(true);
        const dt = 1 / 60;
        const t = 1 - Math.exp(-INTERP_SPEED * dt);
        sx = entry.body.x + (p.x - entry.body.x) * t;
        sy = entry.body.y + (p.y - entry.body.y) * t;
      }
      let aimAngle = p.angle;
      if (isMe && activeScene) {
        const pointer = activeScene.input.activePointer;
        if (pointer) {
          const wp = activeScene.cameras.main.getWorldPoint(pointer.x, pointer.y);
          aimAngle = Math.atan2(wp.y - sy, wp.x - sx);
        }
      }
      const dx = sx - entry.prevX, dy = sy - entry.prevY;
      const isMoving = dx * dx + dy * dy > 0.5;
      entry.prevX = sx;
      entry.prevY = sy;
      let dir;
      if (isMoving) {
        const moveAngle = Math.atan2(dy, dx);
        dir = angleToDirection(moveAngle);
        entry.lastMoveDir = dir;
      } else {
        dir = entry.lastMoveDir || angleToDirection(aimAngle);
      }
      const animKey = `${entry.charName}_${isMoving ? "run" : "idle"}_${dir}`;
      entry.body.anims.play(animKey, true);
      entry.body.setPosition(sx, sy);
      entry.body.setAlpha(p.alive ? 1 : 0.3);
      const yDepth = 10 + sy / (mapSize * TILE_PX) * 40;
      entry.body.setDepth(yDepth);
      const weaponId = p.inventory?.primary || p.inventory?.secondary || null;
      const wpnTex = weaponId ? getWeaponTexture(weaponId) : null;
      if (wpnTex && p.alive) {
        entry.weapon.setTexture(wpnTex).setVisible(true);
        entry.weapon.setPosition(sx, sy - 20);
        entry.weapon.setRotation(aimAngle);
        entry.weapon.setFlipY(Math.abs(aimAngle) > Math.PI / 2);
        entry.weapon.setDepth(dir === "up" ? yDepth - 0.1 : yDepth + 0.1);
      } else {
        entry.weapon.setVisible(false);
      }
    }
    for (const [id, entry] of playerSprites) {
      if (!active.has(id)) {
        entry.body.destroy();
        entry.weapon.destroy();
        playerSprites.delete(id);
      }
    }
  }
  function updateBotSprites(scene) {
    const active = /* @__PURE__ */ new Set();
    for (const b of serverBots) {
      active.add(b.id);
      let entry = botSprites.get(b.id);
      const visible = isInPlayerLOS(b.x, b.y);
      if (!entry) {
        const charName = CHAR_NAMES[hashStr(b.id) % CHAR_NAMES.length];
        const body = scene.add.sprite(b.x, b.y, `${charName}_idle`, 0).setDepth(15).setScale(CHAR_SCALE).setOrigin(0.5, 1);
        const weapon = scene.add.sprite(b.x, b.y, "wpn_pistol").setDepth(16).setScale(3).setOrigin(0, 0.5).setVisible(false);
        const hpBar = scene.add.graphics().setDepth(17);
        entry = { body, weapon, hpBar, charName, prevX: b.x, prevY: b.y };
        botSprites.set(b.id, entry);
      }
      entry.body.setVisible(visible);
      entry.weapon.setVisible(false);
      entry.hpBar.setVisible(visible && b.hp < 100);
      if (!entry.targetX) {
        entry.targetX = b.x;
        entry.targetY = b.y;
      }
      const serverMoved = Math.abs(b.x - entry.targetX) > 0.5 || Math.abs(b.y - entry.targetY) > 0.5;
      entry.targetX = b.x;
      entry.targetY = b.y;
      if (serverMoved) entry.lastServerMoveTime = Date.now();
      if (visible) {
        const dt = 1 / 60;
        const t = 1 - Math.exp(-INTERP_SPEED * dt);
        const sx = entry.body.x + (b.x - entry.body.x) * t;
        const sy = entry.body.y + (b.y - entry.body.y) * t;
        const timeSinceMove = Date.now() - (entry.lastServerMoveTime || 0);
        const isMoving = timeSinceMove < 200;
        let dir;
        if (isMoving && serverMoved) {
          const moveDx = b.x - (entry.prevServerX || b.x);
          const moveDy = b.y - (entry.prevServerY || b.y);
          if (moveDx * moveDx + moveDy * moveDy > 1) {
            const moveAngle = Math.atan2(moveDy, moveDx);
            dir = angleToDirection(moveAngle);
            entry.lastMoveDir = dir;
          }
        }
        if (!dir) dir = entry.lastMoveDir || angleToDirection(b.angle);
        if (serverMoved) {
          entry.prevServerX = entry.targetX;
          entry.prevServerY = entry.targetY;
        }
        const animKey = `${entry.charName}_${isMoving ? "run" : "idle"}_${dir}`;
        entry.body.anims.play(animKey, true);
        entry.body.setPosition(sx, sy);
        const yDepth = 10 + sy / (mapSize * TILE_PX) * 40;
        entry.body.setDepth(yDepth);
        const wpnTex = b.weapon ? getWeaponTexture(b.weapon) : null;
        if (wpnTex) {
          entry.weapon.setTexture(wpnTex).setVisible(true);
          entry.weapon.setPosition(sx, sy - 20);
          entry.weapon.setRotation(b.angle);
          entry.weapon.setFlipY(Math.abs(b.angle) > Math.PI / 2);
          entry.weapon.setDepth(dir === "up" ? yDepth - 0.1 : yDepth + 0.1);
        }
        if (b.hp < 100) {
          entry.hpBar.clear();
          const bx = sx - 12, by = sy - 64 - 4;
          entry.hpBar.fillStyle(3355443, 0.8);
          entry.hpBar.fillRect(bx, by, 24, 3);
          entry.hpBar.fillStyle(b.hp > 50 ? 4521796 : b.hp > 25 ? 16755200 : 16724787, 1);
          entry.hpBar.fillRect(bx, by, 24 * (b.hp / 100), 3);
          entry.hpBar.setDepth(yDepth + 0.2);
        }
      }
    }
    for (const [id, entry] of botSprites) {
      if (!active.has(id)) {
        entry.body.destroy();
        entry.weapon.destroy();
        entry.hpBar.destroy();
        botSprites.delete(id);
      }
    }
  }
  function getLootTexture(itemId) {
    if (itemId === "pistol") return "wpn_pistol";
    if (itemId === "smg" || itemId === "ar") return "wpn_smg";
    if (itemId === "shotgun" || itemId === "lmg") return "wpn_shotgun";
    if (itemId === "sniper" || itemId === "dmr") return "wpn_sniper";
    if (itemId === "frag_grenade" || itemId === "smoke_grenade") return "loot_tactical";
    return "loot_consumable";
  }
  function updateLootSprites(scene) {
    for (const l of groundLoot) {
      if (l.pickedUp) {
        const e2 = lootSprites.get(l.id);
        if (e2) {
          e2.icon.destroy();
          if (e2.aura) e2.aura.destroy();
          lootSprites.delete(l.id);
        }
        continue;
      }
      const visible = isInPlayerLOS(l.x, l.y);
      if (!lootSprites.has(l.id)) {
        const rarity = ITEM_RARITY[l.itemId] || "common";
        const glowColor = RARITY_GLOW[rarity];
        const aura = scene.add.circle(l.x, l.y, 14, glowColor, 0.35).setDepth(2);
        scene.tweens.add({
          targets: aura,
          alpha: { from: 0.15, to: 0.45 },
          scale: { from: 0.9, to: 1.2 },
          duration: 800 + Math.random() * 400,
          yoyo: true,
          repeat: -1
        });
        const texKey = getLootTexture(l.itemId);
        const isWeapon = texKey.startsWith("wpn_");
        const icon = scene.add.sprite(l.x, l.y, texKey).setDepth(3).setScale(isWeapon ? 3 : 1);
        icon.setTint(isWeapon ? 16777215 : RARITY_COLOR[rarity]);
        scene.tweens.add({
          targets: icon,
          y: l.y - 3,
          duration: 1e3 + Math.random() * 500,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut"
        });
        lootSprites.set(l.id, { icon, aura });
      }
      const e = lootSprites.get(l.id);
      if (e) {
        e.icon.setVisible(visible);
        e.aura.setVisible(visible);
      }
    }
  }
  function updateZoneGraphics() {
    if (!serverZone || !zoneGraphics) return;
    zoneGraphics.clear();
    const { current, next } = serverZone;
    const wW = mapSize * TILE_PX, wH = mapSize * TILE_PX;
    zoneGraphics.fillStyle(16711680, 0.08);
    zoneGraphics.fillRect(0, 0, wW, wH);
    zoneGraphics.fillStyle(657941, 0.08);
    zoneGraphics.fillCircle(current.x, current.y, current.radius);
    zoneGraphics.lineStyle(3, 3381759, 0.6);
    zoneGraphics.strokeCircle(current.x, current.y, current.radius);
    if (next.radius > 0 && next.radius < current.radius) {
      zoneGraphics.lineStyle(2, 16777215, 0.3);
      zoneGraphics.strokeCircle(next.x, next.y, next.radius);
    }
  }
  function createHUD(scene) {
    const sw = scene.scale.width;
    const sh = scene.scale.height;
    const D = 200;
    const hpW = 280, hpH = 18, hpX = sw / 2 - hpW / 2, hpY = sh - 50;
    hpBarBg = scene.add.rectangle(hpX + hpW / 2, hpY + hpH / 2, hpW, hpH, 2236962, 0.8).setScrollFactor(0).setDepth(D);
    hpBarFill = scene.add.rectangle(hpX + 2, hpY + 2, hpW - 4, hpH - 4, 3394645, 1).setScrollFactor(0).setDepth(D + 1).setOrigin(0, 0);
    hpText = scene.add.text(hpX + hpW / 2, hpY + hpH / 2, "200", {
      fontSize: "13px",
      fill: "#fff",
      fontFamily: "monospace",
      fontStyle: "bold"
    }).setScrollFactor(0).setDepth(D + 2).setOrigin(0.5);
    boostBarBg = scene.add.rectangle(hpX + hpW / 2, hpY - 6, hpW, 6, 2236962, 0.6).setScrollFactor(0).setDepth(D);
    boostBarFill = scene.add.rectangle(hpX + 2, hpY - 8, 0, 4, 16755200, 1).setScrollFactor(0).setDepth(D + 1).setOrigin(0, 0);
    const slotW = 70, slotH = 40, slotGap = 6;
    const slotStartX = sw - (slotW + slotGap) * 3 - 16;
    const slotY = sh - 56;
    const slotLabels = ["Primary [1]", "Secondry [2]", "Tactical [3]"];
    weaponSlots = [];
    for (let i = 0; i < 3; i++) {
      const x = slotStartX + (slotW + slotGap) * i;
      const bg = scene.add.rectangle(x + slotW / 2, slotY + slotH / 2, slotW, slotH, 1710638, 0.85).setScrollFactor(0).setDepth(D).setStrokeStyle(1, 4473958);
      const label = scene.add.text(x + slotW / 2, slotY + slotH - 4, slotLabels[i], {
        fontSize: "8px",
        fill: "#888",
        fontFamily: "monospace"
      }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5, 1);
      const icon = scene.add.text(x + slotW / 2, slotY + 14, "\u2014", {
        fontSize: "11px",
        fill: "#ccc",
        fontFamily: "monospace",
        fontStyle: "bold"
      }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5);
      weaponSlots.push({ bg, label, icon });
    }
    zoneTimerText = scene.add.text(sw / 2, 16, "", {
      fontSize: "14px",
      fill: "#aaddff",
      fontFamily: "monospace",
      fontStyle: "bold",
      backgroundColor: "#00000066",
      padding: { x: 8, y: 4 }
    }).setScrollFactor(0).setDepth(D).setOrigin(0.5, 0);
    playerCountText = scene.add.text(16, 16, "", {
      fontSize: "13px",
      fill: "#fff",
      fontFamily: "monospace",
      backgroundColor: "#00000066",
      padding: { x: 6, y: 4 }
    }).setScrollFactor(0).setDepth(D);
    minimapGfx = scene.add.graphics().setScrollFactor(0).setDepth(D);
    ammoText = scene.add.text(sw - 120, sh - 14, "", {
      fontSize: "13px",
      fill: "#ffcc44",
      fontFamily: "monospace",
      fontStyle: "bold",
      backgroundColor: "#00000088",
      padding: { x: 6, y: 2 }
    }).setScrollFactor(0).setDepth(D + 2).setOrigin(0.5, 1);
    const rlX = sw - 160, rlY = sh - 70;
    reloadBarBg = scene.add.rectangle(rlX + 60, rlY, 120, 8, 3355443, 0.8).setScrollFactor(0).setDepth(D).setVisible(false);
    reloadBarFill = scene.add.rectangle(rlX, rlY, 0, 6, 4500223, 1).setScrollFactor(0).setDepth(D + 1).setOrigin(0, 0.5).setVisible(false);
    armorText = scene.add.text(hpX + hpW + 10, hpY + 2, "", {
      fontSize: "12px",
      fill: "#88bbff",
      fontFamily: "monospace"
    }).setScrollFactor(0).setDepth(D + 1);
    aliveCountText = scene.add.text(16, 36, "", {
      fontSize: "11px",
      fill: "#aaa",
      fontFamily: "monospace",
      backgroundColor: "#00000066",
      padding: { x: 6, y: 2 }
    }).setScrollFactor(0).setDepth(D);
    const audioBtn = scene.add.text(16, sh - 36, "SOUND: OFF", {
      fontSize: "12px",
      fill: "#888",
      fontFamily: "monospace",
      backgroundColor: "#1a1a2ecc",
      padding: { x: 8, y: 4 }
    }).setScrollFactor(0).setDepth(D).setInteractive({ useHandCursor: true });
    audioBtn.on("pointerdown", () => {
      const on = toggleAudio();
      audioBtn.setText("SOUND: " + (on ? "ON" : "OFF"));
      audioBtn.setColor(on ? "#44ff66" : "#888");
    });
  }
  function updateHUD_frame(scene) {
    const me = serverPlayers.find((p) => p.id === myId);
    if (!me) return;
    const sw = scene.scale.width;
    const sh = scene.scale.height;
    const hpPct = Math.max(0, me.hp / 200);
    const hpW = 276;
    hpBarFill.displayWidth = hpW * hpPct;
    hpBarFill.fillColor = hpPct > 0.5 ? 3394645 : hpPct > 0.25 ? 16755200 : 16724787;
    hpText.setText(Math.round(me.hp));
    const boostPct = (me.boost || 0) / 100;
    boostBarFill.displayWidth = 276 * boostPct;
    boostBarFill.fillColor = boostPct > 0.6 ? 16746496 : 16755200;
    const inv = me.inventory || {};
    const WEAPON_DISPLAY = { pistol: "PISTOL", smg: "SMG", shotgun: "SHOTGUN", sniper: "SNIPER", ar: "AR", lmg: "LMG", dmr: "DMR" };
    const slotData = [inv.primary || "\u2014", inv.secondary || "\u2014", (inv.tactical || [])[0] || "\u2014"];
    const slotNames = ["primary", "secondary", "tactical"];
    for (let i = 0; i < 3; i++) {
      const item = slotData[i];
      weaponSlots[i].icon.setText(item === "\u2014" ? "\u2014" : WEAPON_DISPLAY[item] || item.toUpperCase());
      const isActive = slotNames[i] === activeSlot;
      weaponSlots[i].bg.setStrokeStyle(isActive ? 2 : 1, isActive ? 4521830 : 4473958);
    }
    if (ammoText) {
      const activeWeaponId = inv[activeSlot];
      if (activeWeaponId && inv.magAmmo && activeSlot !== "tactical") {
        const mag = inv.magAmmo[activeSlot] || 0;
        const AMMO_TYPES = { pistol: "9mm", smg: "9mm", shotgun: "12gauge", sniper: "300", ar: "556", lmg: "762", dmr: "762" };
        const ammoType = AMMO_TYPES[activeWeaponId] || "";
        const reserve = inv.ammo && inv.ammo[ammoType] || 0;
        ammoText.setText(`${mag} / ${reserve}`);
        ammoText.setColor(mag === 0 ? "#ff3333" : "#ffcc44");
      } else {
        ammoText.setText("");
      }
    }
    if (reloadBarBg && reloadBarFill) {
      if (me.reloading) {
        reloadBarBg.setVisible(true);
        reloadBarFill.setVisible(true);
        const RELOAD_TIMES = { pistol: 1500, smg: 2e3, shotgun: 2500, sniper: 3e3, ar: 2200, lmg: 5e3, dmr: 2500 };
        const activeWeaponId = inv[activeSlot];
        const reloadMs = activeWeaponId && RELOAD_TIMES[activeWeaponId] || 2e3;
        const reloadTicks = Math.ceil(reloadMs / 1e3 * 60);
        const ticksLeft = Math.max(0, (me.reloadEndTick || 0) - (serverTick || 0));
        const progress = Math.max(0, Math.min(1, 1 - ticksLeft / reloadTicks));
        reloadBarFill.displayWidth = 120 * progress;
      } else {
        reloadBarBg.setVisible(false);
        reloadBarFill.setVisible(false);
      }
    }
    if (armorText) {
      const vl = me.vestLevel || 0;
      const hl = me.helmetLevel || 0;
      let armorStr = "";
      if (vl > 0) armorStr += `V${vl} `;
      if (hl > 0) armorStr += `H${hl}`;
      armorText.setText(armorStr);
    }
    if (serverZone) {
      const z = serverZone;
      zoneTimerText.setText(`ZONE ${z.phase} \u2014 ${Math.ceil(z.timeLeft)}s`);
      zoneTimerText.setX(sw / 2);
    }
    const alivePlayers = serverPlayers.filter((p) => p.alive).length;
    const aliveBots = serverBots.length;
    const totalAlive = alivePlayers + aliveBots;
    playerCountText.setText(`${totalAlive} alive`);
    if (aliveCountText) {
      aliveCountText.setText(`Players: ${alivePlayers} | Bots: ${aliveBots}`);
    }
    const now = Date.now();
    for (let i = killFeed.length - 1; i >= 0; i--) {
      if (now - killFeed[i].time > 5e3) {
        killFeed[i].text.destroy();
        killFeed.splice(i, 1);
      }
    }
  }
  function addKillFeedEntry(scene, killerId, targetId) {
    const sw = scene.scale.width;
    const y = 50 + killFeed.length * 18;
    const msg = `${killerId.slice(0, 6)} \u2192 ${targetId.slice(0, 6)}`;
    const t = scene.add.text(sw - 16, y, msg, {
      fontSize: "11px",
      fill: "#ff6644",
      fontFamily: "monospace",
      backgroundColor: "#00000066",
      padding: { x: 4, y: 2 }
    }).setScrollFactor(0).setDepth(200).setOrigin(1, 0);
    killFeed.push({ text: t, time: Date.now() });
  }
  function updateMinimap() {
    if (!minimapGfx || !mapData) return;
    minimapGfx.clear();
    const mmS = 150;
    const sw = activeScene.scale.width;
    const mmX = sw - mmS - 12, mmY = 40;
    const scale = mmS / (mapSize * TILE_PX);
    minimapGfx.fillStyle(657941, 0.75);
    minimapGfx.fillRoundedRect(mmX - 4, mmY - 4, mmS + 8, mmS + 8, 6);
    if (serverZone) {
      minimapGfx.lineStyle(1.5, 3381759, 0.7);
      minimapGfx.strokeCircle(mmX + serverZone.current.x * scale, mmY + serverZone.current.y * scale, serverZone.current.radius * scale);
      if (serverZone.next.radius < serverZone.current.radius) {
        minimapGfx.lineStyle(1, 16777215, 0.35);
        minimapGfx.strokeCircle(mmX + serverZone.next.x * scale, mmY + serverZone.next.y * scale, serverZone.next.radius * scale);
      }
    }
    minimapGfx.fillStyle(16724804, 0.5);
    for (const b of serverBots) {
      if (isInPlayerLOS(b.x, b.y)) {
        minimapGfx.fillCircle(mmX + b.x * scale, mmY + b.y * scale, 1.2);
      }
    }
    minimapGfx.fillStyle(4491519, 1);
    for (const p of serverPlayers) {
      if (p.id !== myId && p.alive) {
        minimapGfx.fillCircle(mmX + p.x * scale, mmY + p.y * scale, 2.5);
      }
    }
    minimapGfx.fillStyle(4521864, 1);
    minimapGfx.fillCircle(mmX + predictedX * scale, mmY + predictedY * scale, 3);
    minimapGfx.lineStyle(1, 4473958, 0.6);
    minimapGfx.strokeRoundedRect(mmX - 4, mmY - 4, mmS + 8, mmS + 8, 6);
  }
  function showDeathScreen(scene) {
    if (isShowingDeathScreen) return;
    isShowingDeathScreen = true;
    const sw = scene.scale.width, sh = scene.scale.height;
    const D = 300;
    deathOverlay = scene.add.rectangle(sw / 2, sh / 2, sw, sh, 0, 0.75).setScrollFactor(0).setDepth(D);
    const elements = [];
    const title = scene.add.text(sw / 2, sh / 2 - 60, "YOU DIED", {
      fontSize: "48px",
      fill: "#ff3333",
      fontFamily: "monospace",
      fontStyle: "bold"
    }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5);
    elements.push(title);
    const survivalTime = Math.floor((Date.now() - gameStartTime) / 1e3);
    const mins = Math.floor(survivalTime / 60);
    const secs = survivalTime % 60;
    const statsText = scene.add.text(
      sw / 2,
      sh / 2 + 10,
      `Kills: ${clientKills}  |  Survived: ${mins}m ${secs}s`,
      {
        fontSize: "16px",
        fill: "#cccccc",
        fontFamily: "monospace"
      }
    ).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5);
    elements.push(statsText);
    const respawn = scene.add.text(sw / 2, sh / 2 + 60, "GAME OVER \u2014 NEW MATCH STARTING SOON", {
      fontSize: "14px",
      fill: "#aaaaaa",
      fontFamily: "monospace"
    }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5);
    scene.tweens.add({
      targets: respawn,
      alpha: { from: 0.4, to: 1 },
      duration: 600,
      yoyo: true,
      repeat: -1
    });
    elements.push(respawn);
    deathElements = elements;
  }
  function hideDeathScreen() {
    if (!isShowingDeathScreen) return;
    isShowingDeathScreen = false;
    if (deathOverlay) {
      deathOverlay.destroy();
      deathOverlay = null;
    }
    for (const el of deathElements) el.destroy();
    deathElements = [];
  }
  function updateLeaderboard(scene) {
    if (leaderboardPanel) {
      leaderboardPanel.destroy();
      leaderboardPanel = null;
    }
    for (const t of leaderboardTexts) t.destroy();
    leaderboardTexts = [];
    if (!leaderboardVisible || serverLeaderboard.length === 0) return;
    const sw = scene.scale.width, sh = scene.scale.height;
    const D = 250;
    const panelW = 260, panelH = 30 + serverLeaderboard.length * 22;
    leaderboardPanel = scene.add.rectangle(sw / 2, sh / 2, panelW, panelH, 657946, 0.9).setScrollFactor(0).setDepth(D).setStrokeStyle(1, 4473958);
    const title = scene.add.text(sw / 2, sh / 2 - panelH / 2 + 12, "LEADERBOARD", {
      fontSize: "12px",
      fill: "#aaddff",
      fontFamily: "monospace",
      fontStyle: "bold"
    }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5);
    leaderboardTexts.push(title);
    serverLeaderboard.forEach((entry, i) => {
      const isMe = entry.id === myId;
      const name = entry.id.slice(0, 8);
      const line = `${i + 1}. ${name}  ${entry.kills} kills`;
      const t = scene.add.text(sw / 2 - panelW / 2 + 16, sh / 2 - panelH / 2 + 30 + i * 22, line, {
        fontSize: "11px",
        fill: isMe ? "#44ff66" : "#cccccc",
        fontFamily: "monospace"
      }).setScrollFactor(0).setDepth(D + 1);
      leaderboardTexts.push(t);
    });
  }
  window.__game = {
    state() {
      const me = serverPlayers.find((p) => p.id === myId);
      const nearbyBots = serverBots.map((b) => ({ ...b, dist: Math.round(Math.hypot(b.x - predictedX, b.y - predictedY)) })).sort((a, b) => a.dist - b.dist).slice(0, 20);
      return {
        connected,
        myId,
        transport: channel?.transport,
        ready: channel?.ready("state"),
        worldRevision,
        player: me ? { x: Math.round(predictedX), y: Math.round(predictedY), hp: me.hp, alive: me.alive, inventory: me.inventory } : null,
        nearbyBots,
        totalBots: serverBots.length,
        players: serverPlayers.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), hp: p.hp, alive: p.alive })),
        zone: serverZone,
        tick: serverTick
      };
    },
    sendInput(keys, angle) {
      if (!channel || !connected) return;
      const inp = { seq: ++inputSeq, keys: { w: false, a: false, s: false, d: false, shift: false, ctrl: false, ...keys }, angle: angle || 0 };
      applyInput(inp, 1 / 60);
      pendingInputs.push(inp);
      if (pendingInputs.length > 120) pendingInputs.shift();
      channel.emit("input", inp);
    },
    moveTo(x, y) {
      const dx = x - predictedX, dy = y - predictedY;
      if (Math.hypot(dx, dy) < 10) {
        this.sendInput({ w: false, a: false, s: false, d: false }, 0);
        return false;
      }
      const moveAngle = Math.atan2(dy, dx);
      const useAngle = this._engageTime && Date.now() - this._engageTime < 500 ? this._engageAngle : moveAngle;
      this.sendInput({ w: dy < -10, s: dy > 10, a: dx < -10, d: dx > 10 }, useAngle);
      return true;
    },
    shoot(x, y) {
      if (!channel || !connected) return;
      if (!hasDirectLOS(predictedX, predictedY, x, y)) return;
      const angle = Math.atan2(y - predictedY, x - predictedX);
      channel.emit("fire", { angle, slot: activeSlot, latency });
      this._engageAngle = angle;
      this._engageTime = Date.now();
    },
    shootNearest() {
      let nearest = null, minD = Infinity;
      for (const b of serverBots) {
        const d = Math.hypot(b.x - predictedX, b.y - predictedY);
        if (d < minD && hasDirectLOS(predictedX, predictedY, b.x, b.y)) {
          minD = d;
          nearest = b;
        }
      }
      if (nearest && minD < 500) {
        this.shoot(nearest.x, nearest.y);
        return true;
      }
      return false;
    },
    dodge() {
      let nearest = null, minD = Infinity;
      for (const b of serverBots) {
        const d = Math.hypot(b.x - predictedX, b.y - predictedY);
        if (d < minD) {
          minD = d;
          nearest = b;
        }
      }
      if (nearest && minD < 200) {
        this.moveTo(predictedX + (predictedX - nearest.x), predictedY + (predictedY - nearest.y));
        return true;
      }
      return false;
    },
    pickup() {
      const n = findNearestLoot();
      if (n) {
        channel.emit("pickup", { lootId: n.id });
        return true;
      }
      return false;
    },
    _autoInterval: null
  };
  var config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#000000",
    pixelArt: true,
    // nearest-neighbor scaling for all sprites
    disableVisibilityChange: true,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
    scene: { preload, create, update }
  };
  var game = new Phaser.Game(config);
})();
