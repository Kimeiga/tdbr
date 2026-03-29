(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/engine.io-parser/build/esm/commons.js
  var PACKET_TYPES = /* @__PURE__ */ Object.create(null);
  PACKET_TYPES["open"] = "0";
  PACKET_TYPES["close"] = "1";
  PACKET_TYPES["ping"] = "2";
  PACKET_TYPES["pong"] = "3";
  PACKET_TYPES["message"] = "4";
  PACKET_TYPES["upgrade"] = "5";
  PACKET_TYPES["noop"] = "6";
  var PACKET_TYPES_REVERSE = /* @__PURE__ */ Object.create(null);
  Object.keys(PACKET_TYPES).forEach((key) => {
    PACKET_TYPES_REVERSE[PACKET_TYPES[key]] = key;
  });
  var ERROR_PACKET = { type: "error", data: "parser error" };

  // node_modules/engine.io-parser/build/esm/encodePacket.browser.js
  var withNativeBlob = typeof Blob === "function" || typeof Blob !== "undefined" && Object.prototype.toString.call(Blob) === "[object BlobConstructor]";
  var withNativeArrayBuffer = typeof ArrayBuffer === "function";
  var isView = (obj) => {
    return typeof ArrayBuffer.isView === "function" ? ArrayBuffer.isView(obj) : obj && obj.buffer instanceof ArrayBuffer;
  };
  var encodePacket = ({ type, data }, supportsBinary, callback) => {
    if (withNativeBlob && data instanceof Blob) {
      if (supportsBinary) {
        return callback(data);
      } else {
        return encodeBlobAsBase64(data, callback);
      }
    } else if (withNativeArrayBuffer && (data instanceof ArrayBuffer || isView(data))) {
      if (supportsBinary) {
        return callback(data);
      } else {
        return encodeBlobAsBase64(new Blob([data]), callback);
      }
    }
    return callback(PACKET_TYPES[type] + (data || ""));
  };
  var encodeBlobAsBase64 = (data, callback) => {
    const fileReader = new FileReader();
    fileReader.onload = function() {
      const content = fileReader.result.split(",")[1];
      callback("b" + (content || ""));
    };
    return fileReader.readAsDataURL(data);
  };
  function toArray(data) {
    if (data instanceof Uint8Array) {
      return data;
    } else if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    } else {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
  }
  var TEXT_ENCODER;
  function encodePacketToBinary(packet, callback) {
    if (withNativeBlob && packet.data instanceof Blob) {
      return packet.data.arrayBuffer().then(toArray).then(callback);
    } else if (withNativeArrayBuffer && (packet.data instanceof ArrayBuffer || isView(packet.data))) {
      return callback(toArray(packet.data));
    }
    encodePacket(packet, false, (encoded) => {
      if (!TEXT_ENCODER) {
        TEXT_ENCODER = new TextEncoder();
      }
      callback(TEXT_ENCODER.encode(encoded));
    });
  }

  // node_modules/engine.io-parser/build/esm/contrib/base64-arraybuffer.js
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var lookup = typeof Uint8Array === "undefined" ? [] : new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  var decode = (base64) => {
    let bufferLength = base64.length * 0.75, len = base64.length, i, p = 0, encoded1, encoded2, encoded3, encoded4;
    if (base64[base64.length - 1] === "=") {
      bufferLength--;
      if (base64[base64.length - 2] === "=") {
        bufferLength--;
      }
    }
    const arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
    for (i = 0; i < len; i += 4) {
      encoded1 = lookup[base64.charCodeAt(i)];
      encoded2 = lookup[base64.charCodeAt(i + 1)];
      encoded3 = lookup[base64.charCodeAt(i + 2)];
      encoded4 = lookup[base64.charCodeAt(i + 3)];
      bytes[p++] = encoded1 << 2 | encoded2 >> 4;
      bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
      bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
    }
    return arraybuffer;
  };

  // node_modules/engine.io-parser/build/esm/decodePacket.browser.js
  var withNativeArrayBuffer2 = typeof ArrayBuffer === "function";
  var decodePacket = (encodedPacket, binaryType) => {
    if (typeof encodedPacket !== "string") {
      return {
        type: "message",
        data: mapBinary(encodedPacket, binaryType)
      };
    }
    const type = encodedPacket.charAt(0);
    if (type === "b") {
      return {
        type: "message",
        data: decodeBase64Packet(encodedPacket.substring(1), binaryType)
      };
    }
    const packetType = PACKET_TYPES_REVERSE[type];
    if (!packetType) {
      return ERROR_PACKET;
    }
    return encodedPacket.length > 1 ? {
      type: PACKET_TYPES_REVERSE[type],
      data: encodedPacket.substring(1)
    } : {
      type: PACKET_TYPES_REVERSE[type]
    };
  };
  var decodeBase64Packet = (data, binaryType) => {
    if (withNativeArrayBuffer2) {
      const decoded = decode(data);
      return mapBinary(decoded, binaryType);
    } else {
      return { base64: true, data };
    }
  };
  var mapBinary = (data, binaryType) => {
    switch (binaryType) {
      case "blob":
        if (data instanceof Blob) {
          return data;
        } else {
          return new Blob([data]);
        }
      case "arraybuffer":
      default:
        if (data instanceof ArrayBuffer) {
          return data;
        } else {
          return data.buffer;
        }
    }
  };

  // node_modules/engine.io-parser/build/esm/index.js
  var SEPARATOR = String.fromCharCode(30);
  var encodePayload = (packets, callback) => {
    const length = packets.length;
    const encodedPackets = new Array(length);
    let count = 0;
    packets.forEach((packet, i) => {
      encodePacket(packet, false, (encodedPacket) => {
        encodedPackets[i] = encodedPacket;
        if (++count === length) {
          callback(encodedPackets.join(SEPARATOR));
        }
      });
    });
  };
  var decodePayload = (encodedPayload, binaryType) => {
    const encodedPackets = encodedPayload.split(SEPARATOR);
    const packets = [];
    for (let i = 0; i < encodedPackets.length; i++) {
      const decodedPacket = decodePacket(encodedPackets[i], binaryType);
      packets.push(decodedPacket);
      if (decodedPacket.type === "error") {
        break;
      }
    }
    return packets;
  };
  function createPacketEncoderStream() {
    return new TransformStream({
      transform(packet, controller) {
        encodePacketToBinary(packet, (encodedPacket) => {
          const payloadLength = encodedPacket.length;
          let header;
          if (payloadLength < 126) {
            header = new Uint8Array(1);
            new DataView(header.buffer).setUint8(0, payloadLength);
          } else if (payloadLength < 65536) {
            header = new Uint8Array(3);
            const view = new DataView(header.buffer);
            view.setUint8(0, 126);
            view.setUint16(1, payloadLength);
          } else {
            header = new Uint8Array(9);
            const view = new DataView(header.buffer);
            view.setUint8(0, 127);
            view.setBigUint64(1, BigInt(payloadLength));
          }
          if (packet.data && typeof packet.data !== "string") {
            header[0] |= 128;
          }
          controller.enqueue(header);
          controller.enqueue(encodedPacket);
        });
      }
    });
  }
  var TEXT_DECODER;
  function totalLength(chunks) {
    return chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  }
  function concatChunks(chunks, size) {
    if (chunks[0].length === size) {
      return chunks.shift();
    }
    const buffer = new Uint8Array(size);
    let j = 0;
    for (let i = 0; i < size; i++) {
      buffer[i] = chunks[0][j++];
      if (j === chunks[0].length) {
        chunks.shift();
        j = 0;
      }
    }
    if (chunks.length && j < chunks[0].length) {
      chunks[0] = chunks[0].slice(j);
    }
    return buffer;
  }
  function createPacketDecoderStream(maxPayload, binaryType) {
    if (!TEXT_DECODER) {
      TEXT_DECODER = new TextDecoder();
    }
    const chunks = [];
    let state = 0;
    let expectedLength = -1;
    let isBinary2 = false;
    return new TransformStream({
      transform(chunk, controller) {
        chunks.push(chunk);
        while (true) {
          if (state === 0) {
            if (totalLength(chunks) < 1) {
              break;
            }
            const header = concatChunks(chunks, 1);
            isBinary2 = (header[0] & 128) === 128;
            expectedLength = header[0] & 127;
            if (expectedLength < 126) {
              state = 3;
            } else if (expectedLength === 126) {
              state = 1;
            } else {
              state = 2;
            }
          } else if (state === 1) {
            if (totalLength(chunks) < 2) {
              break;
            }
            const headerArray = concatChunks(chunks, 2);
            expectedLength = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length).getUint16(0);
            state = 3;
          } else if (state === 2) {
            if (totalLength(chunks) < 8) {
              break;
            }
            const headerArray = concatChunks(chunks, 8);
            const view = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length);
            const n = view.getUint32(0);
            if (n > Math.pow(2, 53 - 32) - 1) {
              controller.enqueue(ERROR_PACKET);
              break;
            }
            expectedLength = n * Math.pow(2, 32) + view.getUint32(4);
            state = 3;
          } else {
            if (totalLength(chunks) < expectedLength) {
              break;
            }
            const data = concatChunks(chunks, expectedLength);
            controller.enqueue(decodePacket(isBinary2 ? data : TEXT_DECODER.decode(data), binaryType));
            state = 0;
          }
          if (expectedLength === 0 || expectedLength > maxPayload) {
            controller.enqueue(ERROR_PACKET);
            break;
          }
        }
      }
    });
  }
  var protocol = 4;

  // node_modules/@socket.io/component-emitter/lib/esm/index.js
  function Emitter(obj) {
    if (obj) return mixin(obj);
  }
  function mixin(obj) {
    for (var key in Emitter.prototype) {
      obj[key] = Emitter.prototype[key];
    }
    return obj;
  }
  Emitter.prototype.on = Emitter.prototype.addEventListener = function(event, fn) {
    this._callbacks = this._callbacks || {};
    (this._callbacks["$" + event] = this._callbacks["$" + event] || []).push(fn);
    return this;
  };
  Emitter.prototype.once = function(event, fn) {
    function on2() {
      this.off(event, on2);
      fn.apply(this, arguments);
    }
    on2.fn = fn;
    this.on(event, on2);
    return this;
  };
  Emitter.prototype.off = Emitter.prototype.removeListener = Emitter.prototype.removeAllListeners = Emitter.prototype.removeEventListener = function(event, fn) {
    this._callbacks = this._callbacks || {};
    if (0 == arguments.length) {
      this._callbacks = {};
      return this;
    }
    var callbacks = this._callbacks["$" + event];
    if (!callbacks) return this;
    if (1 == arguments.length) {
      delete this._callbacks["$" + event];
      return this;
    }
    var cb;
    for (var i = 0; i < callbacks.length; i++) {
      cb = callbacks[i];
      if (cb === fn || cb.fn === fn) {
        callbacks.splice(i, 1);
        break;
      }
    }
    if (callbacks.length === 0) {
      delete this._callbacks["$" + event];
    }
    return this;
  };
  Emitter.prototype.emit = function(event) {
    this._callbacks = this._callbacks || {};
    var args = new Array(arguments.length - 1), callbacks = this._callbacks["$" + event];
    for (var i = 1; i < arguments.length; i++) {
      args[i - 1] = arguments[i];
    }
    if (callbacks) {
      callbacks = callbacks.slice(0);
      for (var i = 0, len = callbacks.length; i < len; ++i) {
        callbacks[i].apply(this, args);
      }
    }
    return this;
  };
  Emitter.prototype.emitReserved = Emitter.prototype.emit;
  Emitter.prototype.listeners = function(event) {
    this._callbacks = this._callbacks || {};
    return this._callbacks["$" + event] || [];
  };
  Emitter.prototype.hasListeners = function(event) {
    return !!this.listeners(event).length;
  };

  // node_modules/engine.io-client/build/esm/globals.js
  var nextTick = (() => {
    const isPromiseAvailable = typeof Promise === "function" && typeof Promise.resolve === "function";
    if (isPromiseAvailable) {
      return (cb) => Promise.resolve().then(cb);
    } else {
      return (cb, setTimeoutFn) => setTimeoutFn(cb, 0);
    }
  })();
  var globalThisShim = (() => {
    if (typeof self !== "undefined") {
      return self;
    } else if (typeof window !== "undefined") {
      return window;
    } else {
      return Function("return this")();
    }
  })();
  var defaultBinaryType = "arraybuffer";
  function createCookieJar() {
  }

  // node_modules/engine.io-client/build/esm/util.js
  function pick(obj, ...attr) {
    return attr.reduce((acc, k) => {
      if (obj.hasOwnProperty(k)) {
        acc[k] = obj[k];
      }
      return acc;
    }, {});
  }
  var NATIVE_SET_TIMEOUT = globalThisShim.setTimeout;
  var NATIVE_CLEAR_TIMEOUT = globalThisShim.clearTimeout;
  function installTimerFunctions(obj, opts) {
    if (opts.useNativeTimers) {
      obj.setTimeoutFn = NATIVE_SET_TIMEOUT.bind(globalThisShim);
      obj.clearTimeoutFn = NATIVE_CLEAR_TIMEOUT.bind(globalThisShim);
    } else {
      obj.setTimeoutFn = globalThisShim.setTimeout.bind(globalThisShim);
      obj.clearTimeoutFn = globalThisShim.clearTimeout.bind(globalThisShim);
    }
  }
  var BASE64_OVERHEAD = 1.33;
  function byteLength(obj) {
    if (typeof obj === "string") {
      return utf8Length(obj);
    }
    return Math.ceil((obj.byteLength || obj.size) * BASE64_OVERHEAD);
  }
  function utf8Length(str) {
    let c = 0, length = 0;
    for (let i = 0, l = str.length; i < l; i++) {
      c = str.charCodeAt(i);
      if (c < 128) {
        length += 1;
      } else if (c < 2048) {
        length += 2;
      } else if (c < 55296 || c >= 57344) {
        length += 3;
      } else {
        i++;
        length += 4;
      }
    }
    return length;
  }
  function randomString() {
    return Date.now().toString(36).substring(3) + Math.random().toString(36).substring(2, 5);
  }

  // node_modules/engine.io-client/build/esm/contrib/parseqs.js
  function encode(obj) {
    let str = "";
    for (let i in obj) {
      if (obj.hasOwnProperty(i)) {
        if (str.length)
          str += "&";
        str += encodeURIComponent(i) + "=" + encodeURIComponent(obj[i]);
      }
    }
    return str;
  }
  function decode2(qs) {
    let qry = {};
    let pairs = qs.split("&");
    for (let i = 0, l = pairs.length; i < l; i++) {
      let pair = pairs[i].split("=");
      qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
    }
    return qry;
  }

  // node_modules/engine.io-client/build/esm/transport.js
  var TransportError = class extends Error {
    constructor(reason, description, context) {
      super(reason);
      this.description = description;
      this.context = context;
      this.type = "TransportError";
    }
  };
  var Transport = class extends Emitter {
    /**
     * Transport abstract constructor.
     *
     * @param {Object} opts - options
     * @protected
     */
    constructor(opts) {
      super();
      this.writable = false;
      installTimerFunctions(this, opts);
      this.opts = opts;
      this.query = opts.query;
      this.socket = opts.socket;
      this.supportsBinary = !opts.forceBase64;
    }
    /**
     * Emits an error.
     *
     * @param {String} reason
     * @param description
     * @param context - the error context
     * @return {Transport} for chaining
     * @protected
     */
    onError(reason, description, context) {
      super.emitReserved("error", new TransportError(reason, description, context));
      return this;
    }
    /**
     * Opens the transport.
     */
    open() {
      this.readyState = "opening";
      this.doOpen();
      return this;
    }
    /**
     * Closes the transport.
     */
    close() {
      if (this.readyState === "opening" || this.readyState === "open") {
        this.doClose();
        this.onClose();
      }
      return this;
    }
    /**
     * Sends multiple packets.
     *
     * @param {Array} packets
     */
    send(packets) {
      if (this.readyState === "open") {
        this.write(packets);
      } else {
      }
    }
    /**
     * Called upon open
     *
     * @protected
     */
    onOpen() {
      this.readyState = "open";
      this.writable = true;
      super.emitReserved("open");
    }
    /**
     * Called with data.
     *
     * @param {String} data
     * @protected
     */
    onData(data) {
      const packet = decodePacket(data, this.socket.binaryType);
      this.onPacket(packet);
    }
    /**
     * Called with a decoded packet.
     *
     * @protected
     */
    onPacket(packet) {
      super.emitReserved("packet", packet);
    }
    /**
     * Called upon close.
     *
     * @protected
     */
    onClose(details) {
      this.readyState = "closed";
      super.emitReserved("close", details);
    }
    /**
     * Pauses the transport, in order not to lose packets during an upgrade.
     *
     * @param onPause
     */
    pause(onPause) {
    }
    createUri(schema, query = {}) {
      return schema + "://" + this._hostname() + this._port() + this.opts.path + this._query(query);
    }
    _hostname() {
      const hostname = this.opts.hostname;
      return hostname.indexOf(":") === -1 ? hostname : "[" + hostname + "]";
    }
    _port() {
      if (this.opts.port && (this.opts.secure && Number(this.opts.port) !== 443 || !this.opts.secure && Number(this.opts.port) !== 80)) {
        return ":" + this.opts.port;
      } else {
        return "";
      }
    }
    _query(query) {
      const encodedQuery = encode(query);
      return encodedQuery.length ? "?" + encodedQuery : "";
    }
  };

  // node_modules/engine.io-client/build/esm/transports/polling.js
  var Polling = class extends Transport {
    constructor() {
      super(...arguments);
      this._polling = false;
    }
    get name() {
      return "polling";
    }
    /**
     * Opens the socket (triggers polling). We write a PING message to determine
     * when the transport is open.
     *
     * @protected
     */
    doOpen() {
      this._poll();
    }
    /**
     * Pauses polling.
     *
     * @param {Function} onPause - callback upon buffers are flushed and transport is paused
     * @package
     */
    pause(onPause) {
      this.readyState = "pausing";
      const pause = () => {
        this.readyState = "paused";
        onPause();
      };
      if (this._polling || !this.writable) {
        let total = 0;
        if (this._polling) {
          total++;
          this.once("pollComplete", function() {
            --total || pause();
          });
        }
        if (!this.writable) {
          total++;
          this.once("drain", function() {
            --total || pause();
          });
        }
      } else {
        pause();
      }
    }
    /**
     * Starts polling cycle.
     *
     * @private
     */
    _poll() {
      this._polling = true;
      this.doPoll();
      this.emitReserved("poll");
    }
    /**
     * Overloads onData to detect payloads.
     *
     * @protected
     */
    onData(data) {
      const callback = (packet) => {
        if ("opening" === this.readyState && packet.type === "open") {
          this.onOpen();
        }
        if ("close" === packet.type) {
          this.onClose({ description: "transport closed by the server" });
          return false;
        }
        this.onPacket(packet);
      };
      decodePayload(data, this.socket.binaryType).forEach(callback);
      if ("closed" !== this.readyState) {
        this._polling = false;
        this.emitReserved("pollComplete");
        if ("open" === this.readyState) {
          this._poll();
        } else {
        }
      }
    }
    /**
     * For polling, send a close packet.
     *
     * @protected
     */
    doClose() {
      const close = () => {
        this.write([{ type: "close" }]);
      };
      if ("open" === this.readyState) {
        close();
      } else {
        this.once("open", close);
      }
    }
    /**
     * Writes a packets payload.
     *
     * @param {Array} packets - data packets
     * @protected
     */
    write(packets) {
      this.writable = false;
      encodePayload(packets, (data) => {
        this.doWrite(data, () => {
          this.writable = true;
          this.emitReserved("drain");
        });
      });
    }
    /**
     * Generates uri for connection.
     *
     * @private
     */
    uri() {
      const schema = this.opts.secure ? "https" : "http";
      const query = this.query || {};
      if (false !== this.opts.timestampRequests) {
        query[this.opts.timestampParam] = randomString();
      }
      if (!this.supportsBinary && !query.sid) {
        query.b64 = 1;
      }
      return this.createUri(schema, query);
    }
  };

  // node_modules/engine.io-client/build/esm/contrib/has-cors.js
  var value = false;
  try {
    value = typeof XMLHttpRequest !== "undefined" && "withCredentials" in new XMLHttpRequest();
  } catch (err) {
  }
  var hasCORS = value;

  // node_modules/engine.io-client/build/esm/transports/polling-xhr.js
  function empty() {
  }
  var BaseXHR = class extends Polling {
    /**
     * XHR Polling constructor.
     *
     * @param {Object} opts
     * @package
     */
    constructor(opts) {
      super(opts);
      if (typeof location !== "undefined") {
        const isSSL = "https:" === location.protocol;
        let port = location.port;
        if (!port) {
          port = isSSL ? "443" : "80";
        }
        this.xd = typeof location !== "undefined" && opts.hostname !== location.hostname || port !== opts.port;
      }
    }
    /**
     * Sends data.
     *
     * @param {String} data to send.
     * @param {Function} called upon flush.
     * @private
     */
    doWrite(data, fn) {
      const req = this.request({
        method: "POST",
        data
      });
      req.on("success", fn);
      req.on("error", (xhrStatus, context) => {
        this.onError("xhr post error", xhrStatus, context);
      });
    }
    /**
     * Starts a poll cycle.
     *
     * @private
     */
    doPoll() {
      const req = this.request();
      req.on("data", this.onData.bind(this));
      req.on("error", (xhrStatus, context) => {
        this.onError("xhr poll error", xhrStatus, context);
      });
      this.pollXhr = req;
    }
  };
  var Request = class _Request extends Emitter {
    /**
     * Request constructor
     *
     * @param {Object} options
     * @package
     */
    constructor(createRequest, uri, opts) {
      super();
      this.createRequest = createRequest;
      installTimerFunctions(this, opts);
      this._opts = opts;
      this._method = opts.method || "GET";
      this._uri = uri;
      this._data = void 0 !== opts.data ? opts.data : null;
      this._create();
    }
    /**
     * Creates the XHR object and sends the request.
     *
     * @private
     */
    _create() {
      var _a;
      const opts = pick(this._opts, "agent", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "autoUnref");
      opts.xdomain = !!this._opts.xd;
      const xhr = this._xhr = this.createRequest(opts);
      try {
        xhr.open(this._method, this._uri, true);
        try {
          if (this._opts.extraHeaders) {
            xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
            for (let i in this._opts.extraHeaders) {
              if (this._opts.extraHeaders.hasOwnProperty(i)) {
                xhr.setRequestHeader(i, this._opts.extraHeaders[i]);
              }
            }
          }
        } catch (e) {
        }
        if ("POST" === this._method) {
          try {
            xhr.setRequestHeader("Content-type", "text/plain;charset=UTF-8");
          } catch (e) {
          }
        }
        try {
          xhr.setRequestHeader("Accept", "*/*");
        } catch (e) {
        }
        (_a = this._opts.cookieJar) === null || _a === void 0 ? void 0 : _a.addCookies(xhr);
        if ("withCredentials" in xhr) {
          xhr.withCredentials = this._opts.withCredentials;
        }
        if (this._opts.requestTimeout) {
          xhr.timeout = this._opts.requestTimeout;
        }
        xhr.onreadystatechange = () => {
          var _a2;
          if (xhr.readyState === 3) {
            (_a2 = this._opts.cookieJar) === null || _a2 === void 0 ? void 0 : _a2.parseCookies(
              // @ts-ignore
              xhr.getResponseHeader("set-cookie")
            );
          }
          if (4 !== xhr.readyState)
            return;
          if (200 === xhr.status || 1223 === xhr.status) {
            this._onLoad();
          } else {
            this.setTimeoutFn(() => {
              this._onError(typeof xhr.status === "number" ? xhr.status : 0);
            }, 0);
          }
        };
        xhr.send(this._data);
      } catch (e) {
        this.setTimeoutFn(() => {
          this._onError(e);
        }, 0);
        return;
      }
      if (typeof document !== "undefined") {
        this._index = _Request.requestsCount++;
        _Request.requests[this._index] = this;
      }
    }
    /**
     * Called upon error.
     *
     * @private
     */
    _onError(err) {
      this.emitReserved("error", err, this._xhr);
      this._cleanup(true);
    }
    /**
     * Cleans up house.
     *
     * @private
     */
    _cleanup(fromError) {
      if ("undefined" === typeof this._xhr || null === this._xhr) {
        return;
      }
      this._xhr.onreadystatechange = empty;
      if (fromError) {
        try {
          this._xhr.abort();
        } catch (e) {
        }
      }
      if (typeof document !== "undefined") {
        delete _Request.requests[this._index];
      }
      this._xhr = null;
    }
    /**
     * Called upon load.
     *
     * @private
     */
    _onLoad() {
      const data = this._xhr.responseText;
      if (data !== null) {
        this.emitReserved("data", data);
        this.emitReserved("success");
        this._cleanup();
      }
    }
    /**
     * Aborts the request.
     *
     * @package
     */
    abort() {
      this._cleanup();
    }
  };
  Request.requestsCount = 0;
  Request.requests = {};
  if (typeof document !== "undefined") {
    if (typeof attachEvent === "function") {
      attachEvent("onunload", unloadHandler);
    } else if (typeof addEventListener === "function") {
      const terminationEvent = "onpagehide" in globalThisShim ? "pagehide" : "unload";
      addEventListener(terminationEvent, unloadHandler, false);
    }
  }
  function unloadHandler() {
    for (let i in Request.requests) {
      if (Request.requests.hasOwnProperty(i)) {
        Request.requests[i].abort();
      }
    }
  }
  var hasXHR2 = (function() {
    const xhr = newRequest({
      xdomain: false
    });
    return xhr && xhr.responseType !== null;
  })();
  var XHR = class extends BaseXHR {
    constructor(opts) {
      super(opts);
      const forceBase64 = opts && opts.forceBase64;
      this.supportsBinary = hasXHR2 && !forceBase64;
    }
    request(opts = {}) {
      Object.assign(opts, { xd: this.xd }, this.opts);
      return new Request(newRequest, this.uri(), opts);
    }
  };
  function newRequest(opts) {
    const xdomain = opts.xdomain;
    try {
      if ("undefined" !== typeof XMLHttpRequest && (!xdomain || hasCORS)) {
        return new XMLHttpRequest();
      }
    } catch (e) {
    }
    if (!xdomain) {
      try {
        return new globalThisShim[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP");
      } catch (e) {
      }
    }
  }

  // node_modules/engine.io-client/build/esm/transports/websocket.js
  var isReactNative = typeof navigator !== "undefined" && typeof navigator.product === "string" && navigator.product.toLowerCase() === "reactnative";
  var BaseWS = class extends Transport {
    get name() {
      return "websocket";
    }
    doOpen() {
      const uri = this.uri();
      const protocols = this.opts.protocols;
      const opts = isReactNative ? {} : pick(this.opts, "agent", "perMessageDeflate", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "localAddress", "protocolVersion", "origin", "maxPayload", "family", "checkServerIdentity");
      if (this.opts.extraHeaders) {
        opts.headers = this.opts.extraHeaders;
      }
      try {
        this.ws = this.createSocket(uri, protocols, opts);
      } catch (err) {
        return this.emitReserved("error", err);
      }
      this.ws.binaryType = this.socket.binaryType;
      this.addEventListeners();
    }
    /**
     * Adds event listeners to the socket
     *
     * @private
     */
    addEventListeners() {
      this.ws.onopen = () => {
        if (this.opts.autoUnref) {
          this.ws._socket.unref();
        }
        this.onOpen();
      };
      this.ws.onclose = (closeEvent) => this.onClose({
        description: "websocket connection closed",
        context: closeEvent
      });
      this.ws.onmessage = (ev) => this.onData(ev.data);
      this.ws.onerror = (e) => this.onError("websocket error", e);
    }
    write(packets) {
      this.writable = false;
      for (let i = 0; i < packets.length; i++) {
        const packet = packets[i];
        const lastPacket = i === packets.length - 1;
        encodePacket(packet, this.supportsBinary, (data) => {
          try {
            this.doWrite(packet, data);
          } catch (e) {
          }
          if (lastPacket) {
            nextTick(() => {
              this.writable = true;
              this.emitReserved("drain");
            }, this.setTimeoutFn);
          }
        });
      }
    }
    doClose() {
      if (typeof this.ws !== "undefined") {
        this.ws.onerror = () => {
        };
        this.ws.close();
        this.ws = null;
      }
    }
    /**
     * Generates uri for connection.
     *
     * @private
     */
    uri() {
      const schema = this.opts.secure ? "wss" : "ws";
      const query = this.query || {};
      if (this.opts.timestampRequests) {
        query[this.opts.timestampParam] = randomString();
      }
      if (!this.supportsBinary) {
        query.b64 = 1;
      }
      return this.createUri(schema, query);
    }
  };
  var WebSocketCtor = globalThisShim.WebSocket || globalThisShim.MozWebSocket;
  var WS = class extends BaseWS {
    createSocket(uri, protocols, opts) {
      return !isReactNative ? protocols ? new WebSocketCtor(uri, protocols) : new WebSocketCtor(uri) : new WebSocketCtor(uri, protocols, opts);
    }
    doWrite(_packet, data) {
      this.ws.send(data);
    }
  };

  // node_modules/engine.io-client/build/esm/transports/webtransport.js
  var WT = class extends Transport {
    get name() {
      return "webtransport";
    }
    doOpen() {
      try {
        this._transport = new WebTransport(this.createUri("https"), this.opts.transportOptions[this.name]);
      } catch (err) {
        return this.emitReserved("error", err);
      }
      this._transport.closed.then(() => {
        this.onClose();
      }).catch((err) => {
        this.onError("webtransport error", err);
      });
      this._transport.ready.then(() => {
        this._transport.createBidirectionalStream().then((stream) => {
          const decoderStream = createPacketDecoderStream(Number.MAX_SAFE_INTEGER, this.socket.binaryType);
          const reader = stream.readable.pipeThrough(decoderStream).getReader();
          const encoderStream = createPacketEncoderStream();
          encoderStream.readable.pipeTo(stream.writable);
          this._writer = encoderStream.writable.getWriter();
          const read = () => {
            reader.read().then(({ done, value: value2 }) => {
              if (done) {
                return;
              }
              this.onPacket(value2);
              read();
            }).catch((err) => {
            });
          };
          read();
          const packet = { type: "open" };
          if (this.query.sid) {
            packet.data = `{"sid":"${this.query.sid}"}`;
          }
          this._writer.write(packet).then(() => this.onOpen());
        });
      });
    }
    write(packets) {
      this.writable = false;
      for (let i = 0; i < packets.length; i++) {
        const packet = packets[i];
        const lastPacket = i === packets.length - 1;
        this._writer.write(packet).then(() => {
          if (lastPacket) {
            nextTick(() => {
              this.writable = true;
              this.emitReserved("drain");
            }, this.setTimeoutFn);
          }
        });
      }
    }
    doClose() {
      var _a;
      (_a = this._transport) === null || _a === void 0 ? void 0 : _a.close();
    }
  };

  // node_modules/engine.io-client/build/esm/transports/index.js
  var transports = {
    websocket: WS,
    webtransport: WT,
    polling: XHR
  };

  // node_modules/engine.io-client/build/esm/contrib/parseuri.js
  var re = /^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;
  var parts = [
    "source",
    "protocol",
    "authority",
    "userInfo",
    "user",
    "password",
    "host",
    "port",
    "relative",
    "path",
    "directory",
    "file",
    "query",
    "anchor"
  ];
  function parse(str) {
    if (str.length > 8e3) {
      throw "URI too long";
    }
    const src = str, b = str.indexOf("["), e = str.indexOf("]");
    if (b != -1 && e != -1) {
      str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ";") + str.substring(e, str.length);
    }
    let m = re.exec(str || ""), uri = {}, i = 14;
    while (i--) {
      uri[parts[i]] = m[i] || "";
    }
    if (b != -1 && e != -1) {
      uri.source = src;
      uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ":");
      uri.authority = uri.authority.replace("[", "").replace("]", "").replace(/;/g, ":");
      uri.ipv6uri = true;
    }
    uri.pathNames = pathNames(uri, uri["path"]);
    uri.queryKey = queryKey(uri, uri["query"]);
    return uri;
  }
  function pathNames(obj, path) {
    const regx = /\/{2,9}/g, names = path.replace(regx, "/").split("/");
    if (path.slice(0, 1) == "/" || path.length === 0) {
      names.splice(0, 1);
    }
    if (path.slice(-1) == "/") {
      names.splice(names.length - 1, 1);
    }
    return names;
  }
  function queryKey(uri, query) {
    const data = {};
    query.replace(/(?:^|&)([^&=]*)=?([^&]*)/g, function($0, $1, $2) {
      if ($1) {
        data[$1] = $2;
      }
    });
    return data;
  }

  // node_modules/engine.io-client/build/esm/socket.js
  var withEventListeners = typeof addEventListener === "function" && typeof removeEventListener === "function";
  var OFFLINE_EVENT_LISTENERS = [];
  if (withEventListeners) {
    addEventListener("offline", () => {
      OFFLINE_EVENT_LISTENERS.forEach((listener) => listener());
    }, false);
  }
  var SocketWithoutUpgrade = class _SocketWithoutUpgrade extends Emitter {
    /**
     * Socket constructor.
     *
     * @param {String|Object} uri - uri or options
     * @param {Object} opts - options
     */
    constructor(uri, opts) {
      super();
      this.binaryType = defaultBinaryType;
      this.writeBuffer = [];
      this._prevBufferLen = 0;
      this._pingInterval = -1;
      this._pingTimeout = -1;
      this._maxPayload = -1;
      this._pingTimeoutTime = Infinity;
      if (uri && "object" === typeof uri) {
        opts = uri;
        uri = null;
      }
      if (uri) {
        const parsedUri = parse(uri);
        opts.hostname = parsedUri.host;
        opts.secure = parsedUri.protocol === "https" || parsedUri.protocol === "wss";
        opts.port = parsedUri.port;
        if (parsedUri.query)
          opts.query = parsedUri.query;
      } else if (opts.host) {
        opts.hostname = parse(opts.host).host;
      }
      installTimerFunctions(this, opts);
      this.secure = null != opts.secure ? opts.secure : typeof location !== "undefined" && "https:" === location.protocol;
      if (opts.hostname && !opts.port) {
        opts.port = this.secure ? "443" : "80";
      }
      this.hostname = opts.hostname || (typeof location !== "undefined" ? location.hostname : "localhost");
      this.port = opts.port || (typeof location !== "undefined" && location.port ? location.port : this.secure ? "443" : "80");
      this.transports = [];
      this._transportsByName = {};
      opts.transports.forEach((t) => {
        const transportName = t.prototype.name;
        this.transports.push(transportName);
        this._transportsByName[transportName] = t;
      });
      this.opts = Object.assign({
        path: "/engine.io",
        agent: false,
        withCredentials: false,
        upgrade: true,
        timestampParam: "t",
        rememberUpgrade: false,
        addTrailingSlash: true,
        rejectUnauthorized: true,
        perMessageDeflate: {
          threshold: 1024
        },
        transportOptions: {},
        closeOnBeforeunload: false
      }, opts);
      this.opts.path = this.opts.path.replace(/\/$/, "") + (this.opts.addTrailingSlash ? "/" : "");
      if (typeof this.opts.query === "string") {
        this.opts.query = decode2(this.opts.query);
      }
      if (withEventListeners) {
        if (this.opts.closeOnBeforeunload) {
          this._beforeunloadEventListener = () => {
            if (this.transport) {
              this.transport.removeAllListeners();
              this.transport.close();
            }
          };
          addEventListener("beforeunload", this._beforeunloadEventListener, false);
        }
        if (this.hostname !== "localhost") {
          this._offlineEventListener = () => {
            this._onClose("transport close", {
              description: "network connection lost"
            });
          };
          OFFLINE_EVENT_LISTENERS.push(this._offlineEventListener);
        }
      }
      if (this.opts.withCredentials) {
        this._cookieJar = createCookieJar();
      }
      this._open();
    }
    /**
     * Creates transport of the given type.
     *
     * @param {String} name - transport name
     * @return {Transport}
     * @private
     */
    createTransport(name) {
      const query = Object.assign({}, this.opts.query);
      query.EIO = protocol;
      query.transport = name;
      if (this.id)
        query.sid = this.id;
      const opts = Object.assign({}, this.opts, {
        query,
        socket: this,
        hostname: this.hostname,
        secure: this.secure,
        port: this.port
      }, this.opts.transportOptions[name]);
      return new this._transportsByName[name](opts);
    }
    /**
     * Initializes transport to use and starts probe.
     *
     * @private
     */
    _open() {
      if (this.transports.length === 0) {
        this.setTimeoutFn(() => {
          this.emitReserved("error", "No transports available");
        }, 0);
        return;
      }
      const transportName = this.opts.rememberUpgrade && _SocketWithoutUpgrade.priorWebsocketSuccess && this.transports.indexOf("websocket") !== -1 ? "websocket" : this.transports[0];
      this.readyState = "opening";
      const transport = this.createTransport(transportName);
      transport.open();
      this.setTransport(transport);
    }
    /**
     * Sets the current transport. Disables the existing one (if any).
     *
     * @private
     */
    setTransport(transport) {
      if (this.transport) {
        this.transport.removeAllListeners();
      }
      this.transport = transport;
      transport.on("drain", this._onDrain.bind(this)).on("packet", this._onPacket.bind(this)).on("error", this._onError.bind(this)).on("close", (reason) => this._onClose("transport close", reason));
    }
    /**
     * Called when connection is deemed open.
     *
     * @private
     */
    onOpen() {
      this.readyState = "open";
      _SocketWithoutUpgrade.priorWebsocketSuccess = "websocket" === this.transport.name;
      this.emitReserved("open");
      this.flush();
    }
    /**
     * Handles a packet.
     *
     * @private
     */
    _onPacket(packet) {
      if ("opening" === this.readyState || "open" === this.readyState || "closing" === this.readyState) {
        this.emitReserved("packet", packet);
        this.emitReserved("heartbeat");
        switch (packet.type) {
          case "open":
            this.onHandshake(JSON.parse(packet.data));
            break;
          case "ping":
            this._sendPacket("pong");
            this.emitReserved("ping");
            this.emitReserved("pong");
            this._resetPingTimeout();
            break;
          case "error":
            const err = new Error("server error");
            err.code = packet.data;
            this._onError(err);
            break;
          case "message":
            this.emitReserved("data", packet.data);
            this.emitReserved("message", packet.data);
            break;
        }
      } else {
      }
    }
    /**
     * Called upon handshake completion.
     *
     * @param {Object} data - handshake obj
     * @private
     */
    onHandshake(data) {
      this.emitReserved("handshake", data);
      this.id = data.sid;
      this.transport.query.sid = data.sid;
      this._pingInterval = data.pingInterval;
      this._pingTimeout = data.pingTimeout;
      this._maxPayload = data.maxPayload;
      this.onOpen();
      if ("closed" === this.readyState)
        return;
      this._resetPingTimeout();
    }
    /**
     * Sets and resets ping timeout timer based on server pings.
     *
     * @private
     */
    _resetPingTimeout() {
      this.clearTimeoutFn(this._pingTimeoutTimer);
      const delay = this._pingInterval + this._pingTimeout;
      this._pingTimeoutTime = Date.now() + delay;
      this._pingTimeoutTimer = this.setTimeoutFn(() => {
        this._onClose("ping timeout");
      }, delay);
      if (this.opts.autoUnref) {
        this._pingTimeoutTimer.unref();
      }
    }
    /**
     * Called on `drain` event
     *
     * @private
     */
    _onDrain() {
      this.writeBuffer.splice(0, this._prevBufferLen);
      this._prevBufferLen = 0;
      if (0 === this.writeBuffer.length) {
        this.emitReserved("drain");
      } else {
        this.flush();
      }
    }
    /**
     * Flush write buffers.
     *
     * @private
     */
    flush() {
      if ("closed" !== this.readyState && this.transport.writable && !this.upgrading && this.writeBuffer.length) {
        const packets = this._getWritablePackets();
        this.transport.send(packets);
        this._prevBufferLen = packets.length;
        this.emitReserved("flush");
      }
    }
    /**
     * Ensure the encoded size of the writeBuffer is below the maxPayload value sent by the server (only for HTTP
     * long-polling)
     *
     * @private
     */
    _getWritablePackets() {
      const shouldCheckPayloadSize = this._maxPayload && this.transport.name === "polling" && this.writeBuffer.length > 1;
      if (!shouldCheckPayloadSize) {
        return this.writeBuffer;
      }
      let payloadSize = 1;
      for (let i = 0; i < this.writeBuffer.length; i++) {
        const data = this.writeBuffer[i].data;
        if (data) {
          payloadSize += byteLength(data);
        }
        if (i > 0 && payloadSize > this._maxPayload) {
          return this.writeBuffer.slice(0, i);
        }
        payloadSize += 2;
      }
      return this.writeBuffer;
    }
    /**
     * Checks whether the heartbeat timer has expired but the socket has not yet been notified.
     *
     * Note: this method is private for now because it does not really fit the WebSocket API, but if we put it in the
     * `write()` method then the message would not be buffered by the Socket.IO client.
     *
     * @return {boolean}
     * @private
     */
    /* private */
    _hasPingExpired() {
      if (!this._pingTimeoutTime)
        return true;
      const hasExpired = Date.now() > this._pingTimeoutTime;
      if (hasExpired) {
        this._pingTimeoutTime = 0;
        nextTick(() => {
          this._onClose("ping timeout");
        }, this.setTimeoutFn);
      }
      return hasExpired;
    }
    /**
     * Sends a message.
     *
     * @param {String} msg - message.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @return {Socket} for chaining.
     */
    write(msg, options, fn) {
      this._sendPacket("message", msg, options, fn);
      return this;
    }
    /**
     * Sends a message. Alias of {@link Socket#write}.
     *
     * @param {String} msg - message.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @return {Socket} for chaining.
     */
    send(msg, options, fn) {
      this._sendPacket("message", msg, options, fn);
      return this;
    }
    /**
     * Sends a packet.
     *
     * @param {String} type: packet type.
     * @param {String} data.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @private
     */
    _sendPacket(type, data, options, fn) {
      if ("function" === typeof data) {
        fn = data;
        data = void 0;
      }
      if ("function" === typeof options) {
        fn = options;
        options = null;
      }
      if ("closing" === this.readyState || "closed" === this.readyState) {
        return;
      }
      options = options || {};
      options.compress = false !== options.compress;
      const packet = {
        type,
        data,
        options
      };
      this.emitReserved("packetCreate", packet);
      this.writeBuffer.push(packet);
      if (fn)
        this.once("flush", fn);
      this.flush();
    }
    /**
     * Closes the connection.
     */
    close() {
      const close = () => {
        this._onClose("forced close");
        this.transport.close();
      };
      const cleanupAndClose = () => {
        this.off("upgrade", cleanupAndClose);
        this.off("upgradeError", cleanupAndClose);
        close();
      };
      const waitForUpgrade = () => {
        this.once("upgrade", cleanupAndClose);
        this.once("upgradeError", cleanupAndClose);
      };
      if ("opening" === this.readyState || "open" === this.readyState) {
        this.readyState = "closing";
        if (this.writeBuffer.length) {
          this.once("drain", () => {
            if (this.upgrading) {
              waitForUpgrade();
            } else {
              close();
            }
          });
        } else if (this.upgrading) {
          waitForUpgrade();
        } else {
          close();
        }
      }
      return this;
    }
    /**
     * Called upon transport error
     *
     * @private
     */
    _onError(err) {
      _SocketWithoutUpgrade.priorWebsocketSuccess = false;
      if (this.opts.tryAllTransports && this.transports.length > 1 && this.readyState === "opening") {
        this.transports.shift();
        return this._open();
      }
      this.emitReserved("error", err);
      this._onClose("transport error", err);
    }
    /**
     * Called upon transport close.
     *
     * @private
     */
    _onClose(reason, description) {
      if ("opening" === this.readyState || "open" === this.readyState || "closing" === this.readyState) {
        this.clearTimeoutFn(this._pingTimeoutTimer);
        this.transport.removeAllListeners("close");
        this.transport.close();
        this.transport.removeAllListeners();
        if (withEventListeners) {
          if (this._beforeunloadEventListener) {
            removeEventListener("beforeunload", this._beforeunloadEventListener, false);
          }
          if (this._offlineEventListener) {
            const i = OFFLINE_EVENT_LISTENERS.indexOf(this._offlineEventListener);
            if (i !== -1) {
              OFFLINE_EVENT_LISTENERS.splice(i, 1);
            }
          }
        }
        this.readyState = "closed";
        this.id = null;
        this.emitReserved("close", reason, description);
        this.writeBuffer = [];
        this._prevBufferLen = 0;
      }
    }
  };
  SocketWithoutUpgrade.protocol = protocol;
  var SocketWithUpgrade = class extends SocketWithoutUpgrade {
    constructor() {
      super(...arguments);
      this._upgrades = [];
    }
    onOpen() {
      super.onOpen();
      if ("open" === this.readyState && this.opts.upgrade) {
        for (let i = 0; i < this._upgrades.length; i++) {
          this._probe(this._upgrades[i]);
        }
      }
    }
    /**
     * Probes a transport.
     *
     * @param {String} name - transport name
     * @private
     */
    _probe(name) {
      let transport = this.createTransport(name);
      let failed = false;
      SocketWithoutUpgrade.priorWebsocketSuccess = false;
      const onTransportOpen = () => {
        if (failed)
          return;
        transport.send([{ type: "ping", data: "probe" }]);
        transport.once("packet", (msg) => {
          if (failed)
            return;
          if ("pong" === msg.type && "probe" === msg.data) {
            this.upgrading = true;
            this.emitReserved("upgrading", transport);
            if (!transport)
              return;
            SocketWithoutUpgrade.priorWebsocketSuccess = "websocket" === transport.name;
            this.transport.pause(() => {
              if (failed)
                return;
              if ("closed" === this.readyState)
                return;
              cleanup();
              this.setTransport(transport);
              transport.send([{ type: "upgrade" }]);
              this.emitReserved("upgrade", transport);
              transport = null;
              this.upgrading = false;
              this.flush();
            });
          } else {
            const err = new Error("probe error");
            err.transport = transport.name;
            this.emitReserved("upgradeError", err);
          }
        });
      };
      function freezeTransport() {
        if (failed)
          return;
        failed = true;
        cleanup();
        transport.close();
        transport = null;
      }
      const onerror = (err) => {
        const error = new Error("probe error: " + err);
        error.transport = transport.name;
        freezeTransport();
        this.emitReserved("upgradeError", error);
      };
      function onTransportClose() {
        onerror("transport closed");
      }
      function onclose() {
        onerror("socket closed");
      }
      function onupgrade(to) {
        if (transport && to.name !== transport.name) {
          freezeTransport();
        }
      }
      const cleanup = () => {
        transport.removeListener("open", onTransportOpen);
        transport.removeListener("error", onerror);
        transport.removeListener("close", onTransportClose);
        this.off("close", onclose);
        this.off("upgrading", onupgrade);
      };
      transport.once("open", onTransportOpen);
      transport.once("error", onerror);
      transport.once("close", onTransportClose);
      this.once("close", onclose);
      this.once("upgrading", onupgrade);
      if (this._upgrades.indexOf("webtransport") !== -1 && name !== "webtransport") {
        this.setTimeoutFn(() => {
          if (!failed) {
            transport.open();
          }
        }, 200);
      } else {
        transport.open();
      }
    }
    onHandshake(data) {
      this._upgrades = this._filterUpgrades(data.upgrades);
      super.onHandshake(data);
    }
    /**
     * Filters upgrades, returning only those matching client transports.
     *
     * @param {Array} upgrades - server upgrades
     * @private
     */
    _filterUpgrades(upgrades) {
      const filteredUpgrades = [];
      for (let i = 0; i < upgrades.length; i++) {
        if (~this.transports.indexOf(upgrades[i]))
          filteredUpgrades.push(upgrades[i]);
      }
      return filteredUpgrades;
    }
  };
  var Socket = class extends SocketWithUpgrade {
    constructor(uri, opts = {}) {
      const o = typeof uri === "object" ? uri : opts;
      if (!o.transports || o.transports && typeof o.transports[0] === "string") {
        o.transports = (o.transports || ["polling", "websocket", "webtransport"]).map((transportName) => transports[transportName]).filter((t) => !!t);
      }
      super(uri, o);
    }
  };

  // node_modules/engine.io-client/build/esm/index.js
  var protocol2 = Socket.protocol;

  // node_modules/socket.io-client/build/esm/url.js
  function url(uri, path = "", loc) {
    let obj = uri;
    loc = loc || typeof location !== "undefined" && location;
    if (null == uri)
      uri = loc.protocol + "//" + loc.host;
    if (typeof uri === "string") {
      if ("/" === uri.charAt(0)) {
        if ("/" === uri.charAt(1)) {
          uri = loc.protocol + uri;
        } else {
          uri = loc.host + uri;
        }
      }
      if (!/^(https?|wss?):\/\//.test(uri)) {
        if ("undefined" !== typeof loc) {
          uri = loc.protocol + "//" + uri;
        } else {
          uri = "https://" + uri;
        }
      }
      obj = parse(uri);
    }
    if (!obj.port) {
      if (/^(http|ws)$/.test(obj.protocol)) {
        obj.port = "80";
      } else if (/^(http|ws)s$/.test(obj.protocol)) {
        obj.port = "443";
      }
    }
    obj.path = obj.path || "/";
    const ipv6 = obj.host.indexOf(":") !== -1;
    const host = ipv6 ? "[" + obj.host + "]" : obj.host;
    obj.id = obj.protocol + "://" + host + ":" + obj.port + path;
    obj.href = obj.protocol + "://" + host + (loc && loc.port === obj.port ? "" : ":" + obj.port);
    return obj;
  }

  // node_modules/socket.io-parser/build/esm/index.js
  var esm_exports = {};
  __export(esm_exports, {
    Decoder: () => Decoder,
    Encoder: () => Encoder,
    PacketType: () => PacketType,
    isPacketValid: () => isPacketValid,
    protocol: () => protocol3
  });

  // node_modules/socket.io-parser/build/esm/is-binary.js
  var withNativeArrayBuffer3 = typeof ArrayBuffer === "function";
  var isView2 = (obj) => {
    return typeof ArrayBuffer.isView === "function" ? ArrayBuffer.isView(obj) : obj.buffer instanceof ArrayBuffer;
  };
  var toString = Object.prototype.toString;
  var withNativeBlob2 = typeof Blob === "function" || typeof Blob !== "undefined" && toString.call(Blob) === "[object BlobConstructor]";
  var withNativeFile = typeof File === "function" || typeof File !== "undefined" && toString.call(File) === "[object FileConstructor]";
  function isBinary(obj) {
    return withNativeArrayBuffer3 && (obj instanceof ArrayBuffer || isView2(obj)) || withNativeBlob2 && obj instanceof Blob || withNativeFile && obj instanceof File;
  }
  function hasBinary(obj, toJSON) {
    if (!obj || typeof obj !== "object") {
      return false;
    }
    if (Array.isArray(obj)) {
      for (let i = 0, l = obj.length; i < l; i++) {
        if (hasBinary(obj[i])) {
          return true;
        }
      }
      return false;
    }
    if (isBinary(obj)) {
      return true;
    }
    if (obj.toJSON && typeof obj.toJSON === "function" && arguments.length === 1) {
      return hasBinary(obj.toJSON(), true);
    }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
        return true;
      }
    }
    return false;
  }

  // node_modules/socket.io-parser/build/esm/binary.js
  function deconstructPacket(packet) {
    const buffers = [];
    const packetData = packet.data;
    const pack = packet;
    pack.data = _deconstructPacket(packetData, buffers);
    pack.attachments = buffers.length;
    return { packet: pack, buffers };
  }
  function _deconstructPacket(data, buffers) {
    if (!data)
      return data;
    if (isBinary(data)) {
      const placeholder = { _placeholder: true, num: buffers.length };
      buffers.push(data);
      return placeholder;
    } else if (Array.isArray(data)) {
      const newData = new Array(data.length);
      for (let i = 0; i < data.length; i++) {
        newData[i] = _deconstructPacket(data[i], buffers);
      }
      return newData;
    } else if (typeof data === "object" && !(data instanceof Date)) {
      const newData = {};
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          newData[key] = _deconstructPacket(data[key], buffers);
        }
      }
      return newData;
    }
    return data;
  }
  function reconstructPacket(packet, buffers) {
    packet.data = _reconstructPacket(packet.data, buffers);
    delete packet.attachments;
    return packet;
  }
  function _reconstructPacket(data, buffers) {
    if (!data)
      return data;
    if (data && data._placeholder === true) {
      const isIndexValid = typeof data.num === "number" && data.num >= 0 && data.num < buffers.length;
      if (isIndexValid) {
        return buffers[data.num];
      } else {
        throw new Error("illegal attachments");
      }
    } else if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        data[i] = _reconstructPacket(data[i], buffers);
      }
    } else if (typeof data === "object") {
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          data[key] = _reconstructPacket(data[key], buffers);
        }
      }
    }
    return data;
  }

  // node_modules/socket.io-parser/build/esm/index.js
  var RESERVED_EVENTS = [
    "connect",
    // used on the client side
    "connect_error",
    // used on the client side
    "disconnect",
    // used on both sides
    "disconnecting",
    // used on the server side
    "newListener",
    // used by the Node.js EventEmitter
    "removeListener"
    // used by the Node.js EventEmitter
  ];
  var protocol3 = 5;
  var PacketType;
  (function(PacketType2) {
    PacketType2[PacketType2["CONNECT"] = 0] = "CONNECT";
    PacketType2[PacketType2["DISCONNECT"] = 1] = "DISCONNECT";
    PacketType2[PacketType2["EVENT"] = 2] = "EVENT";
    PacketType2[PacketType2["ACK"] = 3] = "ACK";
    PacketType2[PacketType2["CONNECT_ERROR"] = 4] = "CONNECT_ERROR";
    PacketType2[PacketType2["BINARY_EVENT"] = 5] = "BINARY_EVENT";
    PacketType2[PacketType2["BINARY_ACK"] = 6] = "BINARY_ACK";
  })(PacketType || (PacketType = {}));
  var Encoder = class {
    /**
     * Encoder constructor
     *
     * @param {function} replacer - custom replacer to pass down to JSON.parse
     */
    constructor(replacer) {
      this.replacer = replacer;
    }
    /**
     * Encode a packet as a single string if non-binary, or as a
     * buffer sequence, depending on packet type.
     *
     * @param {Object} obj - packet object
     */
    encode(obj) {
      if (obj.type === PacketType.EVENT || obj.type === PacketType.ACK) {
        if (hasBinary(obj)) {
          return this.encodeAsBinary({
            type: obj.type === PacketType.EVENT ? PacketType.BINARY_EVENT : PacketType.BINARY_ACK,
            nsp: obj.nsp,
            data: obj.data,
            id: obj.id
          });
        }
      }
      return [this.encodeAsString(obj)];
    }
    /**
     * Encode packet as string.
     */
    encodeAsString(obj) {
      let str = "" + obj.type;
      if (obj.type === PacketType.BINARY_EVENT || obj.type === PacketType.BINARY_ACK) {
        str += obj.attachments + "-";
      }
      if (obj.nsp && "/" !== obj.nsp) {
        str += obj.nsp + ",";
      }
      if (null != obj.id) {
        str += obj.id;
      }
      if (null != obj.data) {
        str += JSON.stringify(obj.data, this.replacer);
      }
      return str;
    }
    /**
     * Encode packet as 'buffer sequence' by removing blobs, and
     * deconstructing packet into object with placeholders and
     * a list of buffers.
     */
    encodeAsBinary(obj) {
      const deconstruction = deconstructPacket(obj);
      const pack = this.encodeAsString(deconstruction.packet);
      const buffers = deconstruction.buffers;
      buffers.unshift(pack);
      return buffers;
    }
  };
  var Decoder = class _Decoder extends Emitter {
    /**
     * Decoder constructor
     */
    constructor(opts) {
      super();
      this.opts = Object.assign({
        reviver: void 0,
        maxAttachments: 10
      }, typeof opts === "function" ? { reviver: opts } : opts);
    }
    /**
     * Decodes an encoded packet string into packet JSON.
     *
     * @param {String} obj - encoded packet
     */
    add(obj) {
      let packet;
      if (typeof obj === "string") {
        if (this.reconstructor) {
          throw new Error("got plaintext data when reconstructing a packet");
        }
        packet = this.decodeString(obj);
        const isBinaryEvent = packet.type === PacketType.BINARY_EVENT;
        if (isBinaryEvent || packet.type === PacketType.BINARY_ACK) {
          packet.type = isBinaryEvent ? PacketType.EVENT : PacketType.ACK;
          this.reconstructor = new BinaryReconstructor(packet);
          if (packet.attachments === 0) {
            super.emitReserved("decoded", packet);
          }
        } else {
          super.emitReserved("decoded", packet);
        }
      } else if (isBinary(obj) || obj.base64) {
        if (!this.reconstructor) {
          throw new Error("got binary data when not reconstructing a packet");
        } else {
          packet = this.reconstructor.takeBinaryData(obj);
          if (packet) {
            this.reconstructor = null;
            super.emitReserved("decoded", packet);
          }
        }
      } else {
        throw new Error("Unknown type: " + obj);
      }
    }
    /**
     * Decode a packet String (JSON data)
     *
     * @param {String} str
     * @return {Object} packet
     */
    decodeString(str) {
      let i = 0;
      const p = {
        type: Number(str.charAt(0))
      };
      if (PacketType[p.type] === void 0) {
        throw new Error("unknown packet type " + p.type);
      }
      if (p.type === PacketType.BINARY_EVENT || p.type === PacketType.BINARY_ACK) {
        const start = i + 1;
        while (str.charAt(++i) !== "-" && i != str.length) {
        }
        const buf = str.substring(start, i);
        if (buf != Number(buf) || str.charAt(i) !== "-") {
          throw new Error("Illegal attachments");
        }
        const n = Number(buf);
        if (!isInteger(n) || n < 0) {
          throw new Error("Illegal attachments");
        } else if (n > this.opts.maxAttachments) {
          throw new Error("too many attachments");
        }
        p.attachments = n;
      }
      if ("/" === str.charAt(i + 1)) {
        const start = i + 1;
        while (++i) {
          const c = str.charAt(i);
          if ("," === c)
            break;
          if (i === str.length)
            break;
        }
        p.nsp = str.substring(start, i);
      } else {
        p.nsp = "/";
      }
      const next = str.charAt(i + 1);
      if ("" !== next && Number(next) == next) {
        const start = i + 1;
        while (++i) {
          const c = str.charAt(i);
          if (null == c || Number(c) != c) {
            --i;
            break;
          }
          if (i === str.length)
            break;
        }
        p.id = Number(str.substring(start, i + 1));
      }
      if (str.charAt(++i)) {
        const payload = this.tryParse(str.substr(i));
        if (_Decoder.isPayloadValid(p.type, payload)) {
          p.data = payload;
        } else {
          throw new Error("invalid payload");
        }
      }
      return p;
    }
    tryParse(str) {
      try {
        return JSON.parse(str, this.opts.reviver);
      } catch (e) {
        return false;
      }
    }
    static isPayloadValid(type, payload) {
      switch (type) {
        case PacketType.CONNECT:
          return isObject(payload);
        case PacketType.DISCONNECT:
          return payload === void 0;
        case PacketType.CONNECT_ERROR:
          return typeof payload === "string" || isObject(payload);
        case PacketType.EVENT:
        case PacketType.BINARY_EVENT:
          return Array.isArray(payload) && (typeof payload[0] === "number" || typeof payload[0] === "string" && RESERVED_EVENTS.indexOf(payload[0]) === -1);
        case PacketType.ACK:
        case PacketType.BINARY_ACK:
          return Array.isArray(payload);
      }
    }
    /**
     * Deallocates a parser's resources
     */
    destroy() {
      if (this.reconstructor) {
        this.reconstructor.finishedReconstruction();
        this.reconstructor = null;
      }
    }
  };
  var BinaryReconstructor = class {
    constructor(packet) {
      this.packet = packet;
      this.buffers = [];
      this.reconPack = packet;
    }
    /**
     * Method to be called when binary data received from connection
     * after a BINARY_EVENT packet.
     *
     * @param {Buffer | ArrayBuffer} binData - the raw binary data received
     * @return {null | Object} returns null if more binary data is expected or
     *   a reconstructed packet object if all buffers have been received.
     */
    takeBinaryData(binData) {
      this.buffers.push(binData);
      if (this.buffers.length === this.reconPack.attachments) {
        const packet = reconstructPacket(this.reconPack, this.buffers);
        this.finishedReconstruction();
        return packet;
      }
      return null;
    }
    /**
     * Cleans up binary packet reconstruction variables.
     */
    finishedReconstruction() {
      this.reconPack = null;
      this.buffers = [];
    }
  };
  function isNamespaceValid(nsp) {
    return typeof nsp === "string";
  }
  var isInteger = Number.isInteger || function(value2) {
    return typeof value2 === "number" && isFinite(value2) && Math.floor(value2) === value2;
  };
  function isAckIdValid(id) {
    return id === void 0 || isInteger(id);
  }
  function isObject(value2) {
    return Object.prototype.toString.call(value2) === "[object Object]";
  }
  function isDataValid(type, payload) {
    switch (type) {
      case PacketType.CONNECT:
        return payload === void 0 || isObject(payload);
      case PacketType.DISCONNECT:
        return payload === void 0;
      case PacketType.EVENT:
        return Array.isArray(payload) && (typeof payload[0] === "number" || typeof payload[0] === "string" && RESERVED_EVENTS.indexOf(payload[0]) === -1);
      case PacketType.ACK:
        return Array.isArray(payload);
      case PacketType.CONNECT_ERROR:
        return typeof payload === "string" || isObject(payload);
      default:
        return false;
    }
  }
  function isPacketValid(packet) {
    return isNamespaceValid(packet.nsp) && isAckIdValid(packet.id) && isDataValid(packet.type, packet.data);
  }

  // node_modules/socket.io-client/build/esm/on.js
  function on(obj, ev, fn) {
    obj.on(ev, fn);
    return function subDestroy() {
      obj.off(ev, fn);
    };
  }

  // node_modules/socket.io-client/build/esm/socket.js
  var RESERVED_EVENTS2 = Object.freeze({
    connect: 1,
    connect_error: 1,
    disconnect: 1,
    disconnecting: 1,
    // EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
    newListener: 1,
    removeListener: 1
  });
  var Socket2 = class extends Emitter {
    /**
     * `Socket` constructor.
     */
    constructor(io, nsp, opts) {
      super();
      this.connected = false;
      this.recovered = false;
      this.receiveBuffer = [];
      this.sendBuffer = [];
      this._queue = [];
      this._queueSeq = 0;
      this.ids = 0;
      this.acks = {};
      this.flags = {};
      this.io = io;
      this.nsp = nsp;
      if (opts && opts.auth) {
        this.auth = opts.auth;
      }
      this._opts = Object.assign({}, opts);
      if (this.io._autoConnect)
        this.open();
    }
    /**
     * Whether the socket is currently disconnected
     *
     * @example
     * const socket = io();
     *
     * socket.on("connect", () => {
     *   console.log(socket.disconnected); // false
     * });
     *
     * socket.on("disconnect", () => {
     *   console.log(socket.disconnected); // true
     * });
     */
    get disconnected() {
      return !this.connected;
    }
    /**
     * Subscribe to open, close and packet events
     *
     * @private
     */
    subEvents() {
      if (this.subs)
        return;
      const io = this.io;
      this.subs = [
        on(io, "open", this.onopen.bind(this)),
        on(io, "packet", this.onpacket.bind(this)),
        on(io, "error", this.onerror.bind(this)),
        on(io, "close", this.onclose.bind(this))
      ];
    }
    /**
     * Whether the Socket will try to reconnect when its Manager connects or reconnects.
     *
     * @example
     * const socket = io();
     *
     * console.log(socket.active); // true
     *
     * socket.on("disconnect", (reason) => {
     *   if (reason === "io server disconnect") {
     *     // the disconnection was initiated by the server, you need to manually reconnect
     *     console.log(socket.active); // false
     *   }
     *   // else the socket will automatically try to reconnect
     *   console.log(socket.active); // true
     * });
     */
    get active() {
      return !!this.subs;
    }
    /**
     * "Opens" the socket.
     *
     * @example
     * const socket = io({
     *   autoConnect: false
     * });
     *
     * socket.connect();
     */
    connect() {
      if (this.connected)
        return this;
      this.subEvents();
      if (!this.io["_reconnecting"])
        this.io.open();
      if ("open" === this.io._readyState)
        this.onopen();
      return this;
    }
    /**
     * Alias for {@link connect()}.
     */
    open() {
      return this.connect();
    }
    /**
     * Sends a `message` event.
     *
     * This method mimics the WebSocket.send() method.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
     *
     * @example
     * socket.send("hello");
     *
     * // this is equivalent to
     * socket.emit("message", "hello");
     *
     * @return self
     */
    send(...args) {
      args.unshift("message");
      this.emit.apply(this, args);
      return this;
    }
    /**
     * Override `emit`.
     * If the event is in `events`, it's emitted normally.
     *
     * @example
     * socket.emit("hello", "world");
     *
     * // all serializable datastructures are supported (no need to call JSON.stringify)
     * socket.emit("hello", 1, "2", { 3: ["4"], 5: Uint8Array.from([6]) });
     *
     * // with an acknowledgement from the server
     * socket.emit("hello", "world", (val) => {
     *   // ...
     * });
     *
     * @return self
     */
    emit(ev, ...args) {
      var _a, _b, _c;
      if (RESERVED_EVENTS2.hasOwnProperty(ev)) {
        throw new Error('"' + ev.toString() + '" is a reserved event name');
      }
      args.unshift(ev);
      if (this._opts.retries && !this.flags.fromQueue && !this.flags.volatile) {
        this._addToQueue(args);
        return this;
      }
      const packet = {
        type: PacketType.EVENT,
        data: args
      };
      packet.options = {};
      packet.options.compress = this.flags.compress !== false;
      if ("function" === typeof args[args.length - 1]) {
        const id = this.ids++;
        const ack = args.pop();
        this._registerAckCallback(id, ack);
        packet.id = id;
      }
      const isTransportWritable = (_b = (_a = this.io.engine) === null || _a === void 0 ? void 0 : _a.transport) === null || _b === void 0 ? void 0 : _b.writable;
      const isConnected = this.connected && !((_c = this.io.engine) === null || _c === void 0 ? void 0 : _c._hasPingExpired());
      const discardPacket = this.flags.volatile && !isTransportWritable;
      if (discardPacket) {
      } else if (isConnected) {
        this.notifyOutgoingListeners(packet);
        this.packet(packet);
      } else {
        this.sendBuffer.push(packet);
      }
      this.flags = {};
      return this;
    }
    /**
     * @private
     */
    _registerAckCallback(id, ack) {
      var _a;
      const timeout = (_a = this.flags.timeout) !== null && _a !== void 0 ? _a : this._opts.ackTimeout;
      if (timeout === void 0) {
        this.acks[id] = ack;
        return;
      }
      const timer = this.io.setTimeoutFn(() => {
        delete this.acks[id];
        for (let i = 0; i < this.sendBuffer.length; i++) {
          if (this.sendBuffer[i].id === id) {
            this.sendBuffer.splice(i, 1);
          }
        }
        ack.call(this, new Error("operation has timed out"));
      }, timeout);
      const fn = (...args) => {
        this.io.clearTimeoutFn(timer);
        ack.apply(this, args);
      };
      fn.withError = true;
      this.acks[id] = fn;
    }
    /**
     * Emits an event and waits for an acknowledgement
     *
     * @example
     * // without timeout
     * const response = await socket.emitWithAck("hello", "world");
     *
     * // with a specific timeout
     * try {
     *   const response = await socket.timeout(1000).emitWithAck("hello", "world");
     * } catch (err) {
     *   // the server did not acknowledge the event in the given delay
     * }
     *
     * @return a Promise that will be fulfilled when the server acknowledges the event
     */
    emitWithAck(ev, ...args) {
      return new Promise((resolve, reject) => {
        const fn = (arg1, arg2) => {
          return arg1 ? reject(arg1) : resolve(arg2);
        };
        fn.withError = true;
        args.push(fn);
        this.emit(ev, ...args);
      });
    }
    /**
     * Add the packet to the queue.
     * @param args
     * @private
     */
    _addToQueue(args) {
      let ack;
      if (typeof args[args.length - 1] === "function") {
        ack = args.pop();
      }
      const packet = {
        id: this._queueSeq++,
        tryCount: 0,
        pending: false,
        args,
        flags: Object.assign({ fromQueue: true }, this.flags)
      };
      args.push((err, ...responseArgs) => {
        if (packet !== this._queue[0]) {
        }
        const hasError = err !== null;
        if (hasError) {
          if (packet.tryCount > this._opts.retries) {
            this._queue.shift();
            if (ack) {
              ack(err);
            }
          }
        } else {
          this._queue.shift();
          if (ack) {
            ack(null, ...responseArgs);
          }
        }
        packet.pending = false;
        return this._drainQueue();
      });
      this._queue.push(packet);
      this._drainQueue();
    }
    /**
     * Send the first packet of the queue, and wait for an acknowledgement from the server.
     * @param force - whether to resend a packet that has not been acknowledged yet
     *
     * @private
     */
    _drainQueue(force = false) {
      if (!this.connected || this._queue.length === 0) {
        return;
      }
      const packet = this._queue[0];
      if (packet.pending && !force) {
        return;
      }
      packet.pending = true;
      packet.tryCount++;
      this.flags = packet.flags;
      this.emit.apply(this, packet.args);
    }
    /**
     * Sends a packet.
     *
     * @param packet
     * @private
     */
    packet(packet) {
      packet.nsp = this.nsp;
      this.io._packet(packet);
    }
    /**
     * Called upon engine `open`.
     *
     * @private
     */
    onopen() {
      if (typeof this.auth == "function") {
        this.auth((data) => {
          this._sendConnectPacket(data);
        });
      } else {
        this._sendConnectPacket(this.auth);
      }
    }
    /**
     * Sends a CONNECT packet to initiate the Socket.IO session.
     *
     * @param data
     * @private
     */
    _sendConnectPacket(data) {
      this.packet({
        type: PacketType.CONNECT,
        data: this._pid ? Object.assign({ pid: this._pid, offset: this._lastOffset }, data) : data
      });
    }
    /**
     * Called upon engine or manager `error`.
     *
     * @param err
     * @private
     */
    onerror(err) {
      if (!this.connected) {
        this.emitReserved("connect_error", err);
      }
    }
    /**
     * Called upon engine `close`.
     *
     * @param reason
     * @param description
     * @private
     */
    onclose(reason, description) {
      this.connected = false;
      delete this.id;
      this.emitReserved("disconnect", reason, description);
      this._clearAcks();
    }
    /**
     * Clears the acknowledgement handlers upon disconnection, since the client will never receive an acknowledgement from
     * the server.
     *
     * @private
     */
    _clearAcks() {
      Object.keys(this.acks).forEach((id) => {
        const isBuffered = this.sendBuffer.some((packet) => String(packet.id) === id);
        if (!isBuffered) {
          const ack = this.acks[id];
          delete this.acks[id];
          if (ack.withError) {
            ack.call(this, new Error("socket has been disconnected"));
          }
        }
      });
    }
    /**
     * Called with socket packet.
     *
     * @param packet
     * @private
     */
    onpacket(packet) {
      const sameNamespace = packet.nsp === this.nsp;
      if (!sameNamespace)
        return;
      switch (packet.type) {
        case PacketType.CONNECT:
          if (packet.data && packet.data.sid) {
            this.onconnect(packet.data.sid, packet.data.pid);
          } else {
            this.emitReserved("connect_error", new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));
          }
          break;
        case PacketType.EVENT:
        case PacketType.BINARY_EVENT:
          this.onevent(packet);
          break;
        case PacketType.ACK:
        case PacketType.BINARY_ACK:
          this.onack(packet);
          break;
        case PacketType.DISCONNECT:
          this.ondisconnect();
          break;
        case PacketType.CONNECT_ERROR:
          this.destroy();
          const err = new Error(packet.data.message);
          err.data = packet.data.data;
          this.emitReserved("connect_error", err);
          break;
      }
    }
    /**
     * Called upon a server event.
     *
     * @param packet
     * @private
     */
    onevent(packet) {
      const args = packet.data || [];
      if (null != packet.id) {
        args.push(this.ack(packet.id));
      }
      if (this.connected) {
        this.emitEvent(args);
      } else {
        this.receiveBuffer.push(Object.freeze(args));
      }
    }
    emitEvent(args) {
      if (this._anyListeners && this._anyListeners.length) {
        const listeners = this._anyListeners.slice();
        for (const listener of listeners) {
          listener.apply(this, args);
        }
      }
      super.emit.apply(this, args);
      if (this._pid && args.length && typeof args[args.length - 1] === "string") {
        this._lastOffset = args[args.length - 1];
      }
    }
    /**
     * Produces an ack callback to emit with an event.
     *
     * @private
     */
    ack(id) {
      const self2 = this;
      let sent = false;
      return function(...args) {
        if (sent)
          return;
        sent = true;
        self2.packet({
          type: PacketType.ACK,
          id,
          data: args
        });
      };
    }
    /**
     * Called upon a server acknowledgement.
     *
     * @param packet
     * @private
     */
    onack(packet) {
      const ack = this.acks[packet.id];
      if (typeof ack !== "function") {
        return;
      }
      delete this.acks[packet.id];
      if (ack.withError) {
        packet.data.unshift(null);
      }
      ack.apply(this, packet.data);
    }
    /**
     * Called upon server connect.
     *
     * @private
     */
    onconnect(id, pid) {
      this.id = id;
      this.recovered = pid && this._pid === pid;
      this._pid = pid;
      this.connected = true;
      this.emitBuffered();
      this._drainQueue(true);
      this.emitReserved("connect");
    }
    /**
     * Emit buffered events (received and emitted).
     *
     * @private
     */
    emitBuffered() {
      this.receiveBuffer.forEach((args) => this.emitEvent(args));
      this.receiveBuffer = [];
      this.sendBuffer.forEach((packet) => {
        this.notifyOutgoingListeners(packet);
        this.packet(packet);
      });
      this.sendBuffer = [];
    }
    /**
     * Called upon server disconnect.
     *
     * @private
     */
    ondisconnect() {
      this.destroy();
      this.onclose("io server disconnect");
    }
    /**
     * Called upon forced client/server side disconnections,
     * this method ensures the manager stops tracking us and
     * that reconnections don't get triggered for this.
     *
     * @private
     */
    destroy() {
      if (this.subs) {
        this.subs.forEach((subDestroy) => subDestroy());
        this.subs = void 0;
      }
      this.io["_destroy"](this);
    }
    /**
     * Disconnects the socket manually. In that case, the socket will not try to reconnect.
     *
     * If this is the last active Socket instance of the {@link Manager}, the low-level connection will be closed.
     *
     * @example
     * const socket = io();
     *
     * socket.on("disconnect", (reason) => {
     *   // console.log(reason); prints "io client disconnect"
     * });
     *
     * socket.disconnect();
     *
     * @return self
     */
    disconnect() {
      if (this.connected) {
        this.packet({ type: PacketType.DISCONNECT });
      }
      this.destroy();
      if (this.connected) {
        this.onclose("io client disconnect");
      }
      return this;
    }
    /**
     * Alias for {@link disconnect()}.
     *
     * @return self
     */
    close() {
      return this.disconnect();
    }
    /**
     * Sets the compress flag.
     *
     * @example
     * socket.compress(false).emit("hello");
     *
     * @param compress - if `true`, compresses the sending data
     * @return self
     */
    compress(compress) {
      this.flags.compress = compress;
      return this;
    }
    /**
     * Sets a modifier for a subsequent event emission that the event message will be dropped when this socket is not
     * ready to send messages.
     *
     * @example
     * socket.volatile.emit("hello"); // the server may or may not receive it
     *
     * @returns self
     */
    get volatile() {
      this.flags.volatile = true;
      return this;
    }
    /**
     * Sets a modifier for a subsequent event emission that the callback will be called with an error when the
     * given number of milliseconds have elapsed without an acknowledgement from the server:
     *
     * @example
     * socket.timeout(5000).emit("my-event", (err) => {
     *   if (err) {
     *     // the server did not acknowledge the event in the given delay
     *   }
     * });
     *
     * @returns self
     */
    timeout(timeout) {
      this.flags.timeout = timeout;
      return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback.
     *
     * @example
     * socket.onAny((event, ...args) => {
     *   console.log(`got ${event}`);
     * });
     *
     * @param listener
     */
    onAny(listener) {
      this._anyListeners = this._anyListeners || [];
      this._anyListeners.push(listener);
      return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback. The listener is added to the beginning of the listeners array.
     *
     * @example
     * socket.prependAny((event, ...args) => {
     *   console.log(`got event ${event}`);
     * });
     *
     * @param listener
     */
    prependAny(listener) {
      this._anyListeners = this._anyListeners || [];
      this._anyListeners.unshift(listener);
      return this;
    }
    /**
     * Removes the listener that will be fired when any event is emitted.
     *
     * @example
     * const catchAllListener = (event, ...args) => {
     *   console.log(`got event ${event}`);
     * }
     *
     * socket.onAny(catchAllListener);
     *
     * // remove a specific listener
     * socket.offAny(catchAllListener);
     *
     * // or remove all listeners
     * socket.offAny();
     *
     * @param listener
     */
    offAny(listener) {
      if (!this._anyListeners) {
        return this;
      }
      if (listener) {
        const listeners = this._anyListeners;
        for (let i = 0; i < listeners.length; i++) {
          if (listener === listeners[i]) {
            listeners.splice(i, 1);
            return this;
          }
        }
      } else {
        this._anyListeners = [];
      }
      return this;
    }
    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
     * e.g. to remove listeners.
     */
    listenersAny() {
      return this._anyListeners || [];
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback.
     *
     * Note: acknowledgements sent to the server are not included.
     *
     * @example
     * socket.onAnyOutgoing((event, ...args) => {
     *   console.log(`sent event ${event}`);
     * });
     *
     * @param listener
     */
    onAnyOutgoing(listener) {
      this._anyOutgoingListeners = this._anyOutgoingListeners || [];
      this._anyOutgoingListeners.push(listener);
      return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback. The listener is added to the beginning of the listeners array.
     *
     * Note: acknowledgements sent to the server are not included.
     *
     * @example
     * socket.prependAnyOutgoing((event, ...args) => {
     *   console.log(`sent event ${event}`);
     * });
     *
     * @param listener
     */
    prependAnyOutgoing(listener) {
      this._anyOutgoingListeners = this._anyOutgoingListeners || [];
      this._anyOutgoingListeners.unshift(listener);
      return this;
    }
    /**
     * Removes the listener that will be fired when any event is emitted.
     *
     * @example
     * const catchAllListener = (event, ...args) => {
     *   console.log(`sent event ${event}`);
     * }
     *
     * socket.onAnyOutgoing(catchAllListener);
     *
     * // remove a specific listener
     * socket.offAnyOutgoing(catchAllListener);
     *
     * // or remove all listeners
     * socket.offAnyOutgoing();
     *
     * @param [listener] - the catch-all listener (optional)
     */
    offAnyOutgoing(listener) {
      if (!this._anyOutgoingListeners) {
        return this;
      }
      if (listener) {
        const listeners = this._anyOutgoingListeners;
        for (let i = 0; i < listeners.length; i++) {
          if (listener === listeners[i]) {
            listeners.splice(i, 1);
            return this;
          }
        }
      } else {
        this._anyOutgoingListeners = [];
      }
      return this;
    }
    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
     * e.g. to remove listeners.
     */
    listenersAnyOutgoing() {
      return this._anyOutgoingListeners || [];
    }
    /**
     * Notify the listeners for each packet sent
     *
     * @param packet
     *
     * @private
     */
    notifyOutgoingListeners(packet) {
      if (this._anyOutgoingListeners && this._anyOutgoingListeners.length) {
        const listeners = this._anyOutgoingListeners.slice();
        for (const listener of listeners) {
          listener.apply(this, packet.data);
        }
      }
    }
  };

  // node_modules/socket.io-client/build/esm/contrib/backo2.js
  function Backoff(opts) {
    opts = opts || {};
    this.ms = opts.min || 100;
    this.max = opts.max || 1e4;
    this.factor = opts.factor || 2;
    this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
    this.attempts = 0;
  }
  Backoff.prototype.duration = function() {
    var ms = this.ms * Math.pow(this.factor, this.attempts++);
    if (this.jitter) {
      var rand = Math.random();
      var deviation = Math.floor(rand * this.jitter * ms);
      ms = (Math.floor(rand * 10) & 1) == 0 ? ms - deviation : ms + deviation;
    }
    return Math.min(ms, this.max) | 0;
  };
  Backoff.prototype.reset = function() {
    this.attempts = 0;
  };
  Backoff.prototype.setMin = function(min) {
    this.ms = min;
  };
  Backoff.prototype.setMax = function(max) {
    this.max = max;
  };
  Backoff.prototype.setJitter = function(jitter) {
    this.jitter = jitter;
  };

  // node_modules/socket.io-client/build/esm/manager.js
  var Manager = class extends Emitter {
    constructor(uri, opts) {
      var _a;
      super();
      this.nsps = {};
      this.subs = [];
      if (uri && "object" === typeof uri) {
        opts = uri;
        uri = void 0;
      }
      opts = opts || {};
      opts.path = opts.path || "/socket.io";
      this.opts = opts;
      installTimerFunctions(this, opts);
      this.reconnection(opts.reconnection !== false);
      this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
      this.reconnectionDelay(opts.reconnectionDelay || 1e3);
      this.reconnectionDelayMax(opts.reconnectionDelayMax || 5e3);
      this.randomizationFactor((_a = opts.randomizationFactor) !== null && _a !== void 0 ? _a : 0.5);
      this.backoff = new Backoff({
        min: this.reconnectionDelay(),
        max: this.reconnectionDelayMax(),
        jitter: this.randomizationFactor()
      });
      this.timeout(null == opts.timeout ? 2e4 : opts.timeout);
      this._readyState = "closed";
      this.uri = uri;
      const _parser = opts.parser || esm_exports;
      this.encoder = new _parser.Encoder();
      this.decoder = new _parser.Decoder();
      this._autoConnect = opts.autoConnect !== false;
      if (this._autoConnect)
        this.open();
    }
    reconnection(v) {
      if (!arguments.length)
        return this._reconnection;
      this._reconnection = !!v;
      if (!v) {
        this.skipReconnect = true;
      }
      return this;
    }
    reconnectionAttempts(v) {
      if (v === void 0)
        return this._reconnectionAttempts;
      this._reconnectionAttempts = v;
      return this;
    }
    reconnectionDelay(v) {
      var _a;
      if (v === void 0)
        return this._reconnectionDelay;
      this._reconnectionDelay = v;
      (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMin(v);
      return this;
    }
    randomizationFactor(v) {
      var _a;
      if (v === void 0)
        return this._randomizationFactor;
      this._randomizationFactor = v;
      (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setJitter(v);
      return this;
    }
    reconnectionDelayMax(v) {
      var _a;
      if (v === void 0)
        return this._reconnectionDelayMax;
      this._reconnectionDelayMax = v;
      (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMax(v);
      return this;
    }
    timeout(v) {
      if (!arguments.length)
        return this._timeout;
      this._timeout = v;
      return this;
    }
    /**
     * Starts trying to reconnect if reconnection is enabled and we have not
     * started reconnecting yet
     *
     * @private
     */
    maybeReconnectOnOpen() {
      if (!this._reconnecting && this._reconnection && this.backoff.attempts === 0) {
        this.reconnect();
      }
    }
    /**
     * Sets the current transport `socket`.
     *
     * @param {Function} fn - optional, callback
     * @return self
     * @public
     */
    open(fn) {
      if (~this._readyState.indexOf("open"))
        return this;
      this.engine = new Socket(this.uri, this.opts);
      const socket = this.engine;
      const self2 = this;
      this._readyState = "opening";
      this.skipReconnect = false;
      const openSubDestroy = on(socket, "open", function() {
        self2.onopen();
        fn && fn();
      });
      const onError = (err) => {
        this.cleanup();
        this._readyState = "closed";
        this.emitReserved("error", err);
        if (fn) {
          fn(err);
        } else {
          this.maybeReconnectOnOpen();
        }
      };
      const errorSub = on(socket, "error", onError);
      if (false !== this._timeout) {
        const timeout = this._timeout;
        const timer = this.setTimeoutFn(() => {
          openSubDestroy();
          onError(new Error("timeout"));
          socket.close();
        }, timeout);
        if (this.opts.autoUnref) {
          timer.unref();
        }
        this.subs.push(() => {
          this.clearTimeoutFn(timer);
        });
      }
      this.subs.push(openSubDestroy);
      this.subs.push(errorSub);
      return this;
    }
    /**
     * Alias for open()
     *
     * @return self
     * @public
     */
    connect(fn) {
      return this.open(fn);
    }
    /**
     * Called upon transport open.
     *
     * @private
     */
    onopen() {
      this.cleanup();
      this._readyState = "open";
      this.emitReserved("open");
      const socket = this.engine;
      this.subs.push(
        on(socket, "ping", this.onping.bind(this)),
        on(socket, "data", this.ondata.bind(this)),
        on(socket, "error", this.onerror.bind(this)),
        on(socket, "close", this.onclose.bind(this)),
        // @ts-ignore
        on(this.decoder, "decoded", this.ondecoded.bind(this))
      );
    }
    /**
     * Called upon a ping.
     *
     * @private
     */
    onping() {
      this.emitReserved("ping");
    }
    /**
     * Called with data.
     *
     * @private
     */
    ondata(data) {
      try {
        this.decoder.add(data);
      } catch (e) {
        this.onclose("parse error", e);
      }
    }
    /**
     * Called when parser fully decodes a packet.
     *
     * @private
     */
    ondecoded(packet) {
      nextTick(() => {
        this.emitReserved("packet", packet);
      }, this.setTimeoutFn);
    }
    /**
     * Called upon socket error.
     *
     * @private
     */
    onerror(err) {
      this.emitReserved("error", err);
    }
    /**
     * Creates a new socket for the given `nsp`.
     *
     * @return {Socket}
     * @public
     */
    socket(nsp, opts) {
      let socket = this.nsps[nsp];
      if (!socket) {
        socket = new Socket2(this, nsp, opts);
        this.nsps[nsp] = socket;
      } else if (this._autoConnect && !socket.active) {
        socket.connect();
      }
      return socket;
    }
    /**
     * Called upon a socket close.
     *
     * @param socket
     * @private
     */
    _destroy(socket) {
      const nsps = Object.keys(this.nsps);
      for (const nsp of nsps) {
        const socket2 = this.nsps[nsp];
        if (socket2.active) {
          return;
        }
      }
      this._close();
    }
    /**
     * Writes a packet.
     *
     * @param packet
     * @private
     */
    _packet(packet) {
      const encodedPackets = this.encoder.encode(packet);
      for (let i = 0; i < encodedPackets.length; i++) {
        this.engine.write(encodedPackets[i], packet.options);
      }
    }
    /**
     * Clean up transport subscriptions and packet buffer.
     *
     * @private
     */
    cleanup() {
      this.subs.forEach((subDestroy) => subDestroy());
      this.subs.length = 0;
      this.decoder.destroy();
    }
    /**
     * Close the current socket.
     *
     * @private
     */
    _close() {
      this.skipReconnect = true;
      this._reconnecting = false;
      this.onclose("forced close");
    }
    /**
     * Alias for close()
     *
     * @private
     */
    disconnect() {
      return this._close();
    }
    /**
     * Called when:
     *
     * - the low-level engine is closed
     * - the parser encountered a badly formatted packet
     * - all sockets are disconnected
     *
     * @private
     */
    onclose(reason, description) {
      var _a;
      this.cleanup();
      (_a = this.engine) === null || _a === void 0 ? void 0 : _a.close();
      this.backoff.reset();
      this._readyState = "closed";
      this.emitReserved("close", reason, description);
      if (this._reconnection && !this.skipReconnect) {
        this.reconnect();
      }
    }
    /**
     * Attempt a reconnection.
     *
     * @private
     */
    reconnect() {
      if (this._reconnecting || this.skipReconnect)
        return this;
      const self2 = this;
      if (this.backoff.attempts >= this._reconnectionAttempts) {
        this.backoff.reset();
        this.emitReserved("reconnect_failed");
        this._reconnecting = false;
      } else {
        const delay = this.backoff.duration();
        this._reconnecting = true;
        const timer = this.setTimeoutFn(() => {
          if (self2.skipReconnect)
            return;
          this.emitReserved("reconnect_attempt", self2.backoff.attempts);
          if (self2.skipReconnect)
            return;
          self2.open((err) => {
            if (err) {
              self2._reconnecting = false;
              self2.reconnect();
              this.emitReserved("reconnect_error", err);
            } else {
              self2.onreconnect();
            }
          });
        }, delay);
        if (this.opts.autoUnref) {
          timer.unref();
        }
        this.subs.push(() => {
          this.clearTimeoutFn(timer);
        });
      }
    }
    /**
     * Called upon successful reconnect.
     *
     * @private
     */
    onreconnect() {
      const attempt = this.backoff.attempts;
      this._reconnecting = false;
      this.backoff.reset();
      this.emitReserved("reconnect", attempt);
    }
  };

  // node_modules/socket.io-client/build/esm/index.js
  var cache = {};
  function lookup2(uri, opts) {
    if (typeof uri === "object") {
      opts = uri;
      uri = void 0;
    }
    opts = opts || {};
    const parsed = url(uri, opts.path || "/socket.io");
    const source = parsed.source;
    const id = parsed.id;
    const path = parsed.path;
    const sameNamespace = cache[id] && path in cache[id]["nsps"];
    const newConnection = opts.forceNew || opts["force new connection"] || false === opts.multiplex || sameNamespace;
    let io;
    if (newConnection) {
      io = new Manager(source, opts);
    } else {
      if (!cache[id]) {
        cache[id] = new Manager(source, opts);
      }
      io = cache[id];
    }
    if (parsed.query && !opts.query) {
      opts.query = parsed.queryKey;
    }
    return io.socket(parsed.path, opts);
  }
  Object.assign(lookup2, {
    Manager,
    Socket: Socket2,
    io: lookup2,
    connect: lookup2
  });

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
      let parts2 = group.split(",");
      let name = parts2.shift() || "";
      let method = map[name.toLowerCase()];
      if (!method) {
        return match;
      }
      obj = args.shift();
      let replaced = obj[method].apply(obj, parts2);
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
      let chars2 = [].concat(ch);
      for (let i = 0; i < chars2.length; i++) {
        this._ctx.fillText(chars2[i], px[0], Math.ceil(px[1]));
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
          let chars2 = [].concat(ch);
          for (let i = 0; i < chars2.length; i++) {
            ctx.fillText(chars2[i], this._spacingX / 2, Math.ceil(this._spacingY / 2));
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
      let chars2 = [].concat(ch);
      for (let i = 0; i < chars2.length; i++) {
        this._ctx.fillText(chars2[i], (x + 0.5) * this._spacingX, Math.ceil((y + 0.5) * this._spacingY));
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
      let chars2 = [].concat(ch);
      let fgs = [].concat(fg);
      let bgs = [].concat(bg);
      for (let i = 0; i < chars2.length; i++) {
        let tile = this._options.tileMap[chars2[i]];
        if (!tile) {
          throw new Error(`Char "${chars2[i]}" not found in tileMap`);
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
      let chars2 = [].concat(ch);
      let bgs = [].concat(bg);
      let fgs = [].concat(fg);
      gl.uniform2fv(this._uniforms["targetPosRel"], [x, y]);
      for (let i = 0; i < chars2.length; i++) {
        let tile = this._options.tileMap[chars2[i]];
        if (!tile) {
          throw new Error(`Char "${chars2[i]}" not found in tileMap`);
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
        let chars2 = [].concat(ch);
        process.stdout.write(chars2[0]);
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
    if (!connected || !myId) return;
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
    channel = lookup2(`http://${location.hostname}:${location.port || 3e3}`);
    channel.on("connect", () => {
      connected = true;
      console.log("Connected");
    });
    channel.on("init", (data) => {
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
      console.log(`Init: id=${myId} map=${mapSize}x${mapSize}`);
    });
    channel.on("state", (data) => {
      serverTick = data.tick;
      serverPlayers = data.players;
      serverBots = data.bots;
      serverProjectiles = data.projectiles;
      serverZone = data.zone;
      serverEvents = data.events || [];
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
      const on2 = toggleAudio();
      audioBtn.setText("SOUND: " + (on2 ? "ON" : "OFF"));
      audioBtn.setColor(on2 ? "#44ff66" : "#888");
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
