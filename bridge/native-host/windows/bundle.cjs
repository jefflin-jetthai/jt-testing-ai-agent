/* Windows Compatibility Patch V3 */
(function(){
  const url = require('url');
  const nodeUrl = require('node:url');
  const cp = require('child_process');
  const nodeCp = require('node:child_process');
  const path = require('path');
  const os = require('os');

  const hookUrl = (mod) => {
    const orig = mod.fileURLToPath;
    mod.fileURLToPath = function(p) {
      if (p === 'file:///bridge') return path.resolve(__dirname, 'bridge');
      return orig(p);
    };
  };
  hookUrl(url); hookUrl(nodeUrl);

  const hookCp = (mod) => {
    const orig = mod.spawn;
    mod.spawn = function(cmd, args, opts) {
      // 1. 遇到 Mac which 檢查直接強行回傳成功 (0)
      if (cmd === 'which') {
        cmd = 'cmd.exe';
        args = ['/c', 'exit 0'];
      }
      // 2. 真正啟動 claude 時套上 Windows Shell 執行護甲
      if (cmd === 'claude') {
        if (!opts) opts = {};
        opts.shell = true;
      }
      // 3. 【核心安全網】強行把 Windows 的 npm 全域安裝路徑與系統預設路徑死死綁進 PATH
      // 這樣就算 Chrome 沒重開乾淨、沒刷新變數，也絕對 100% 找得到 claude.cmd！
      if (opts && opts.env) {
        const npmPath = path.resolve(os.homedir(), 'AppData', 'Roaming', 'npm');
        opts.env.PATH = (process.env.PATH || '') + ';' + npmPath + ';C:\\Windows\\system32;C:\\Windows';
      }
      return orig.call(this, cmd, args, opts);
    };
  };
  hookCp(cp); hookCp(nodeCp);

  if (!process.env.JT_DATA_DIR) {
    process.env.JT_DATA_DIR = path.resolve(os.homedir(), 'AppData', 'Roaming', 'JT Testing AI Agent');
  }
  process.env.JT_BRIDGE_SCRIPT = __filename;
})();
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf2 = list[i];
        target.set(buf2, offset);
        offset += buf2.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf2) {
      if (buf2.length === buf2.buffer.byteLength) {
        return buf2.buffer;
      }
      return buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf2;
      if (data instanceof ArrayBuffer) {
        buf2 = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf2 = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf2 = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf2;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf2) {
      const len = buf2.length;
      let i = 0;
      while (i < len) {
        if ((buf2[i] & 128) === 0) {
          i++;
        } else if ((buf2[i] & 224) === 192) {
          if (i + 1 === len || (buf2[i + 1] & 192) !== 128 || (buf2[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf2[i] & 240) === 224) {
          if (i + 2 >= len || (buf2[i + 1] & 192) !== 128 || (buf2[i + 2] & 192) !== 128 || buf2[i] === 224 && (buf2[i + 1] & 224) === 128 || // Overlong
          buf2[i] === 237 && (buf2[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf2[i] & 248) === 240) {
          if (i + 3 >= len || (buf2[i + 1] & 192) !== 128 || (buf2[i + 2] & 192) !== 128 || (buf2[i + 3] & 192) !== 128 || buf2[i] === 240 && (buf2[i + 1] & 240) === 128 || // Overlong
          buf2[i] === 244 && buf2[i + 1] > 143 || buf2[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf2) {
        return buf2.length < 24 ? _isValidUTF8(buf2) : isUtf8(buf2);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf2) {
          return buf2.length < 32 ? _isValidUTF8(buf2) : isValidUTF8(buf2);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf2 = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf2.buffer,
            buf2.byteOffset + n,
            buf2.length - n
          );
          return new FastBuffer(buf2.buffer, buf2.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf2 = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf2.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf2.buffer, buf2.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf2.buffer,
              buf2.byteOffset + n,
              buf2.length - n
            );
          }
          n -= buf2.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf2 = this.consume(2);
        if ((buf2[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf2[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf2[0] & 128) === 128;
        this._opcode = buf2[0] & 15;
        this._payloadLength = buf2[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf2[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf2 = this.consume(8);
        const num = buf2.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf2.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          if (this._maxFragments > 0 && this._fragments.length >= this._maxFragments) {
            const error = this.createError(
              RangeError,
              "Too many message fragments",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            );
            cb(error);
            return;
          }
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf2) => {
          if (err) return cb(err);
          if (buf2.length) {
            this._messageLength += buf2.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            if (this._maxFragments > 0 && this._fragments.length >= this._maxFragments) {
              const error = this.createError(
                RangeError,
                "Too many message fragments",
                false,
                1008,
                "WS_ERR_TOO_MANY_BUFFERED_PARTS"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf2);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf2 = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf2)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf2, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf2, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf2 = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf2)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf2);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module2.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var {
      types: { isUint8Array }
    } = require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf2;
        if (code === void 0) {
          buf2 = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf2 = Buffer.allocUnsafe(2);
          buf2.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf2 = Buffer.allocUnsafe(2 + length);
          buf2.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf2.write(data, 2);
          } else if (isUint8Array(data)) {
            buf2.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf2.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf2, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf2, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf2) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf2, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function push2(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push2(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push2(params, header.slice(start, end), true);
            if (code === 44) {
              push2(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push2(params, paramName, value);
            if (code === 44) {
              push2(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push2(offers, token, params);
      } else {
        if (paramName === void 0) {
          push2(params, token, true);
        } else if (mustUnescape) {
          push2(params, paramName, token.replace(/\\/g, ""));
        } else {
          push2(params, paramName, token);
        }
        push2(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https = require("https");
    var http2 = require("http");
    var net2 = require("net");
    var tls = require("tls");
    var { randomBytes, createHash } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL: URL2 } = require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 1024 * 1024,
        maxFragments: 128 * 1024,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http2.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net2.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net2.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws2, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws2.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws2.pause();
      });
      ws2.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws2.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws2.readyState === ws2.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws2.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws2.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws2.terminate();
      };
      duplex._final = function(callback) {
        if (ws2.readyState === ws2.CONNECTING) {
          ws2.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws2._socket === null) return;
        if (ws2._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws2._socket.once("finish", function finish2() {
            callback();
          });
          ws2.close();
        }
      };
      duplex._read = function() {
        if (ws2.isPaused) ws2.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws2.readyState === ws2.CONNECTING) {
          ws2.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws2.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http2 = require("http");
    var { Duplex } = require("stream");
    var { createHash } = require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=1048576] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=131072] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 1024 * 1024,
          maxFragments: 128 * 1024,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http2.createServer((req, res) => {
            const body = http2.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws2 = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws2._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws2._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws2.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws2);
          ws2.on("close", () => {
            this.clients.delete(ws2);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws2, req);
      }
    };
    module2.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http2.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http2.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// node_modules/ws/wrapper.mjs
var import_stream, import_extension, import_permessage_deflate, import_receiver, import_sender, import_subprotocol, import_websocket, import_websocket_server, wrapper_default;
var init_wrapper = __esm({
  "node_modules/ws/wrapper.mjs"() {
    import_stream = __toESM(require_stream(), 1);
    import_extension = __toESM(require_extension(), 1);
    import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
    import_receiver = __toESM(require_receiver(), 1);
    import_sender = __toESM(require_sender(), 1);
    import_subprotocol = __toESM(require_subprotocol(), 1);
    import_websocket = __toESM(require_websocket(), 1);
    import_websocket_server = __toESM(require_websocket_server(), 1);
    wrapper_default = import_websocket.default;
  }
});

// browser-mcp.mjs
var browser_mcp_exports = {};
function connect() {
  return new Promise((resolve4, reject) => {
    ws = new wrapper_default(BRIDGE_CDP_URL);
    ws.on("open", () => resolve4());
    ws.on("error", (e) => reject(e));
    ws.on("message", (data) => {
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      const cb = cdpPending.get(m.id);
      if (cb) {
        cdpPending.delete(m.id);
        cb(m);
      }
    });
    ws.on("close", () => {
      ws = null;
    });
  });
}
function cdp(method, params) {
  return new Promise((resolve4) => {
    if (!ws || ws.readyState !== wrapper_default.OPEN) return resolve4({ error: { message: "bridge CDP \u901A\u9053\u672A\u9023\u7DDA" } });
    const id = ++cdpSeq;
    cdpPending.set(id, resolve4);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => {
      if (cdpPending.has(id)) {
        cdpPending.delete(id);
        resolve4({ error: { message: `CDP timeout: ${method}` } });
      }
    }, 15e3);
  });
}
async function evalJs(expression, awaitPromise = false) {
  const r = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true
  });
  if (r.error) throw new Error(r.error.message);
  const res = r.result;
  if (res?.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || "JS \u4F8B\u5916");
  }
  return res?.result?.value;
}
async function toolSnapshot() {
  const s = await evalJs(SNAPSHOT_JS);
  return [
    `URL: ${s.url}`,
    `Title: ${s.title}`,
    ``,
    `# \u4E92\u52D5\u5143\u7D20\uFF08\u7528 ref \u9EDE\u64CA/\u586B\u503C\uFF09`,
    ...s.elements.length ? s.elements : ["(\u7121)"],
    ``,
    `# \u53EF\u898B\u6587\u5B57\uFF08\u7BC0\u9304\uFF09`,
    s.text
  ].join("\n");
}
async function toolNavigate(url) {
  await evalJs(`(() => { location.href = ${JSON.stringify(url)}; return true; })()`);
  await evalJs(
    `new Promise(res => { const done=()=>res(true);
      if (document.readyState==='complete') return done();
      window.addEventListener('load', done, {once:true}); setTimeout(done, 8000); })`,
    true
  );
  return `\u5DF2\u5C0E\u5411 ${url}`;
}
async function toolClick({ ref, text }) {
  const js = ref != null ? `(() => { const el = document.querySelector('[data-jt-ref=' + JSON.stringify(String(${JSON.stringify(String(ref))})) + ']'); if(!el) return {ok:false,err:'\u627E\u4E0D\u5230 ref ${ref}'}; el.scrollIntoView({block:'center'}); el.click(); return {ok:true}; })()` : `(() => { const t=${JSON.stringify(text || "")}; const el=[...document.querySelectorAll('a,button,[role=button],input[type=submit]')].find(e => (e.innerText||e.value||'').trim().includes(t)); if(!el) return {ok:false,err:'\u627E\u4E0D\u5230\u6587\u5B57: '+t}; el.scrollIntoView({block:'center'}); el.click(); return {ok:true}; })()`;
  const r = await evalJs(js);
  if (!r?.ok) throw new Error(r?.err || "\u9EDE\u64CA\u5931\u6557");
  return `\u5DF2\u9EDE\u64CA ${ref != null ? "ref " + ref : '"' + text + '"'}`;
}
async function toolFill({ ref, value }) {
  const js = `(() => { const el=document.querySelector('[data-jt-ref=' + JSON.stringify(String(${JSON.stringify(String(ref))})) + ']'); if(!el) return {ok:false,err:'\u627E\u4E0D\u5230 ref ${ref}'};
    el.focus(); el.value=${JSON.stringify(value ?? "")};
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
    return {ok:true}; })()`;
  const r = await evalJs(js);
  if (!r?.ok) throw new Error(r?.err || "\u586B\u503C\u5931\u6557");
  return `\u5DF2\u65BC ref ${ref} \u586B\u5165\u300C${value}\u300D`;
}
async function toolWaitFor({ text, timeoutMs }) {
  const t = JSON.stringify(text || "");
  const ms = Math.min(Number(timeoutMs) || 8e3, 2e4);
  const ok = await evalJs(
    `new Promise(res => { const t=${t}; const deadline=Date.now()+${ms};
      const check=()=>{ if((document.body?document.body.innerText:'').includes(t)) return res(true);
        if(Date.now()>deadline) return res(false); setTimeout(check,300); }; check(); })`,
    true
  );
  if (!ok) throw new Error(`\u7B49\u5F85\u903E\u6642\uFF0C\u9801\u9762\u672A\u51FA\u73FE\u6587\u5B57\uFF1A${text}`);
  return `\u5DF2\u51FA\u73FE\u6587\u5B57\uFF1A${text}`;
}
async function toolEvaluate({ expression }) {
  const v = await evalJs(`(() => { return (${expression}); })()`);
  return typeof v === "string" ? v : JSON.stringify(v);
}
function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
async function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (method === "initialize") {
    write({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "jt-browser", version: "0.1.0" } } });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "tools/list") {
    write({ jsonrpc: "2.0", id, result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, ...t.def })) } });
    return;
  }
  if (method === "tools/call") {
    const tool = TOOLS[params?.name];
    if (!tool) {
      write({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: `\u672A\u77E5\u5DE5\u5177: ${params?.name}` }] } });
      return;
    }
    try {
      const text = await tool.run(params.arguments || {});
      write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(text) }] } });
    } catch (e) {
      write({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: `\u932F\u8AA4: ${e.message}` }] } });
    }
    return;
  }
  if (id != null) write({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}
var BRIDGE_CDP_URL, ws, cdpSeq, cdpPending, SNAPSHOT_JS, TOOLS, buf;
var init_browser_mcp = __esm({
  "browser-mcp.mjs"() {
    "use strict";
    init_wrapper();
    BRIDGE_CDP_URL = process.env.JT_BRIDGE_CDP_URL || "ws://localhost:8787/agent-cdp";
    ws = null;
    cdpSeq = 0;
    cdpPending = /* @__PURE__ */ new Map();
    SNAPSHOT_JS = `(() => {
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[onclick]';
  const els = Array.from(document.querySelectorAll(sel));
  const lines = [];
  let n = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    el.setAttribute('data-jt-ref', String(n));
    const label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.name || '').trim().replace(/\\s+/g,' ').slice(0,60);
    const tag = el.tagName.toLowerCase();
    const t = el.getAttribute('type');
    lines.push('[' + n + '] ' + tag + (t ? '['+t+']' : '') + (label ? ' "'+label+'"' : ''));
    n++;
  }
  return { title: document.title, url: location.href,
    text: (document.body ? document.body.innerText : '').replace(/\\n{2,}/g,'\\n').slice(0,2500),
    elements: lines };
})()`;
    TOOLS = {
      snapshot: {
        def: { description: "\u8B80\u53D6\u7576\u524D\u5206\u9801\uFF1AURL\u3001\u6A19\u984C\u3001\u4E92\u52D5\u5143\u7D20\u6E05\u55AE\uFF08\u542B ref\uFF09\u3001\u53EF\u898B\u6587\u5B57\u3002\u64CD\u4F5C\u524D\u5148\u7528\u5B83\u4E86\u89E3\u9801\u9762\u3002", inputSchema: { type: "object", properties: {} } },
        run: () => toolSnapshot()
      },
      navigate: {
        def: { description: "\u5C0E\u5411\u6307\u5B9A\u7DB2\u5740\u4E26\u7B49\u5F85\u8F09\u5165\u3002", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
        run: (a) => toolNavigate(a.url)
      },
      click: {
        def: { description: "\u9EDE\u64CA\u5143\u7D20\uFF1A\u7528 snapshot \u7684 ref\uFF08\u6578\u5B57\uFF09\u6216\u7528 text\uFF08\u5143\u7D20\u6587\u5B57\uFF09\u3002", inputSchema: { type: "object", properties: { ref: { type: ["number", "string"] }, text: { type: "string" } } } },
        run: (a) => toolClick(a)
      },
      fill: {
        def: { description: "\u5728\u8F38\u5165\u6846\u586B\u503C\uFF1Aref + value\u3002", inputSchema: { type: "object", properties: { ref: { type: ["number", "string"] }, value: { type: "string" } }, required: ["ref", "value"] } },
        run: (a) => toolFill(a)
      },
      wait_for: {
        def: { description: "\u7B49\u5F85\u9801\u9762\u51FA\u73FE\u6307\u5B9A\u6587\u5B57\uFF08\u9810\u8A2D 8 \u79D2\uFF09\u3002", inputSchema: { type: "object", properties: { text: { type: "string" }, timeoutMs: { type: "number" } }, required: ["text"] } },
        run: (a) => toolWaitFor(a)
      },
      evaluate: {
        def: { description: "\u5728\u5206\u9801\u57F7\u884C\u4EFB\u610F JS \u904B\u7B97\u5F0F\u4E26\u56DE\u50B3\u7D50\u679C\uFF08\u9A57\u8B49\u7528\uFF0C\u5982 document.querySelectorAll('x').length\uFF09\u3002", inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } },
        run: (a) => toolEvaluate(a)
      }
    };
    buf = "";
    process.stdin.on("data", async (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) await handle(line);
      }
    });
    connect().catch((e) => {
      process.stderr.write(`[jt-browser-mcp] \u9023 bridge \u5931\u6557: ${e.message}
`);
    });
  }
});

// sea/native-host.mjs
var native_host_exports = {};
function send(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}
function isUp() {
  return new Promise((resolve4) => {
    const s = import_node_net.default.connect(PORT, "127.0.0.1");
    s.setTimeout(800);
    s.on("connect", () => {
      s.destroy();
      resolve4(true);
    });
    s.on("error", () => resolve4(false));
    s.on("timeout", () => {
      s.destroy();
      resolve4(false);
    });
  });
}
var import_node_child_process, import_node_net, PORT, wait, finish;
var init_native_host = __esm({
  "sea/native-host.mjs"() {
    "use strict";
    import_node_child_process = require("node:child_process");
    import_node_net = __toESM(require("node:net"), 1);
    PORT = Number(process.env.BRIDGE_PORT || 8787);
    wait = (ms) => new Promise((r) => setTimeout(r, ms));
    finish = (code = 0) => setTimeout(() => process.exit(code), 120);
    (async () => {
      try {
        if (await isUp()) {
          send({ ok: true, already: true });
          return finish(0);
        }
        const serverArgs = process.env.JT_BRIDGE_SCRIPT ? [process.env.JT_BRIDGE_SCRIPT] : [];
        const child = (0, import_node_child_process.spawn)(process.execPath, serverArgs, { detached: true, stdio: "ignore", env: process.env });
        child.unref();
        for (let i = 0; i < 40; i++) {
          if (await isUp()) {
            send({ ok: true, started: true });
            return finish(0);
          }
          await wait(500);
        }
        send({ ok: false, error: "bridge \u555F\u52D5\u903E\u6642\uFF0820s\uFF09" });
        finish(1);
      } catch (e) {
        send({ ok: false, error: String(e?.message || e) });
        finish(1);
      }
    })();
  }
});

// node_modules/dotenv/package.json
var require_package = __commonJS({
  "node_modules/dotenv/package.json"(exports2, module2) {
    module2.exports = {
      name: "dotenv",
      version: "16.6.1",
      description: "Loads environment variables from .env file",
      main: "lib/main.js",
      types: "lib/main.d.ts",
      exports: {
        ".": {
          types: "./lib/main.d.ts",
          require: "./lib/main.js",
          default: "./lib/main.js"
        },
        "./config": "./config.js",
        "./config.js": "./config.js",
        "./lib/env-options": "./lib/env-options.js",
        "./lib/env-options.js": "./lib/env-options.js",
        "./lib/cli-options": "./lib/cli-options.js",
        "./lib/cli-options.js": "./lib/cli-options.js",
        "./package.json": "./package.json"
      },
      scripts: {
        "dts-check": "tsc --project tests/types/tsconfig.json",
        lint: "standard",
        pretest: "npm run lint && npm run dts-check",
        test: "tap run --allow-empty-coverage --disable-coverage --timeout=60000",
        "test:coverage": "tap run --show-full-coverage --timeout=60000 --coverage-report=text --coverage-report=lcov",
        prerelease: "npm test",
        release: "standard-version"
      },
      repository: {
        type: "git",
        url: "git://github.com/motdotla/dotenv.git"
      },
      homepage: "https://github.com/motdotla/dotenv#readme",
      funding: "https://dotenvx.com",
      keywords: [
        "dotenv",
        "env",
        ".env",
        "environment",
        "variables",
        "config",
        "settings"
      ],
      readmeFilename: "README.md",
      license: "BSD-2-Clause",
      devDependencies: {
        "@types/node": "^18.11.3",
        decache: "^4.6.2",
        sinon: "^14.0.1",
        standard: "^17.0.0",
        "standard-version": "^9.5.0",
        tap: "^19.2.0",
        typescript: "^4.8.4"
      },
      engines: {
        node: ">=12"
      },
      browser: {
        fs: false
      }
    };
  }
});

// node_modules/dotenv/lib/main.js
var require_main = __commonJS({
  "node_modules/dotenv/lib/main.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var os = require("os");
    var crypto = require("crypto");
    var packageJson = require_package();
    var version = packageJson.version;
    var LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
    function parse(src) {
      const obj = {};
      let lines = src.toString();
      lines = lines.replace(/\r\n?/mg, "\n");
      let match;
      while ((match = LINE.exec(lines)) != null) {
        const key = match[1];
        let value = match[2] || "";
        value = value.trim();
        const maybeQuote = value[0];
        value = value.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");
        if (maybeQuote === '"') {
          value = value.replace(/\\n/g, "\n");
          value = value.replace(/\\r/g, "\r");
        }
        obj[key] = value;
      }
      return obj;
    }
    function _parseVault(options) {
      options = options || {};
      const vaultPath = _vaultPath(options);
      options.path = vaultPath;
      const result = DotenvModule.configDotenv(options);
      if (!result.parsed) {
        const err = new Error(`MISSING_DATA: Cannot parse ${vaultPath} for an unknown reason`);
        err.code = "MISSING_DATA";
        throw err;
      }
      const keys = _dotenvKey(options).split(",");
      const length = keys.length;
      let decrypted;
      for (let i = 0; i < length; i++) {
        try {
          const key = keys[i].trim();
          const attrs = _instructions(result, key);
          decrypted = DotenvModule.decrypt(attrs.ciphertext, attrs.key);
          break;
        } catch (error) {
          if (i + 1 >= length) {
            throw error;
          }
        }
      }
      return DotenvModule.parse(decrypted);
    }
    function _warn(message) {
      console.log(`[dotenv@${version}][WARN] ${message}`);
    }
    function _debug(message) {
      console.log(`[dotenv@${version}][DEBUG] ${message}`);
    }
    function _log(message) {
      console.log(`[dotenv@${version}] ${message}`);
    }
    function _dotenvKey(options) {
      if (options && options.DOTENV_KEY && options.DOTENV_KEY.length > 0) {
        return options.DOTENV_KEY;
      }
      if (process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0) {
        return process.env.DOTENV_KEY;
      }
      return "";
    }
    function _instructions(result, dotenvKey) {
      let uri;
      try {
        uri = new URL(dotenvKey);
      } catch (error) {
        if (error.code === "ERR_INVALID_URL") {
          const err = new Error("INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        }
        throw error;
      }
      const key = uri.password;
      if (!key) {
        const err = new Error("INVALID_DOTENV_KEY: Missing key part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environment = uri.searchParams.get("environment");
      if (!environment) {
        const err = new Error("INVALID_DOTENV_KEY: Missing environment part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environmentKey = `DOTENV_VAULT_${environment.toUpperCase()}`;
      const ciphertext = result.parsed[environmentKey];
      if (!ciphertext) {
        const err = new Error(`NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${environmentKey} in your .env.vault file.`);
        err.code = "NOT_FOUND_DOTENV_ENVIRONMENT";
        throw err;
      }
      return { ciphertext, key };
    }
    function _vaultPath(options) {
      let possibleVaultPath = null;
      if (options && options.path && options.path.length > 0) {
        if (Array.isArray(options.path)) {
          for (const filepath of options.path) {
            if (fs.existsSync(filepath)) {
              possibleVaultPath = filepath.endsWith(".vault") ? filepath : `${filepath}.vault`;
            }
          }
        } else {
          possibleVaultPath = options.path.endsWith(".vault") ? options.path : `${options.path}.vault`;
        }
      } else {
        possibleVaultPath = path.resolve(process.cwd(), ".env.vault");
      }
      if (fs.existsSync(possibleVaultPath)) {
        return possibleVaultPath;
      }
      return null;
    }
    function _resolveHome(envPath) {
      return envPath[0] === "~" ? path.join(os.homedir(), envPath.slice(1)) : envPath;
    }
    function _configVault(options) {
      const debug = Boolean(options && options.debug);
      const quiet = options && "quiet" in options ? options.quiet : true;
      if (debug || !quiet) {
        _log("Loading env from encrypted .env.vault");
      }
      const parsed = DotenvModule._parseVault(options);
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsed, options);
      return { parsed };
    }
    function configDotenv(options) {
      const dotenvPath = path.resolve(process.cwd(), ".env");
      let encoding = "utf8";
      const debug = Boolean(options && options.debug);
      const quiet = options && "quiet" in options ? options.quiet : true;
      if (options && options.encoding) {
        encoding = options.encoding;
      } else {
        if (debug) {
          _debug("No encoding is specified. UTF-8 is used by default");
        }
      }
      let optionPaths = [dotenvPath];
      if (options && options.path) {
        if (!Array.isArray(options.path)) {
          optionPaths = [_resolveHome(options.path)];
        } else {
          optionPaths = [];
          for (const filepath of options.path) {
            optionPaths.push(_resolveHome(filepath));
          }
        }
      }
      let lastError;
      const parsedAll = {};
      for (const path2 of optionPaths) {
        try {
          const parsed = DotenvModule.parse(fs.readFileSync(path2, { encoding }));
          DotenvModule.populate(parsedAll, parsed, options);
        } catch (e) {
          if (debug) {
            _debug(`Failed to load ${path2} ${e.message}`);
          }
          lastError = e;
        }
      }
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsedAll, options);
      if (debug || !quiet) {
        const keysCount = Object.keys(parsedAll).length;
        const shortPaths = [];
        for (const filePath of optionPaths) {
          try {
            const relative = path.relative(process.cwd(), filePath);
            shortPaths.push(relative);
          } catch (e) {
            if (debug) {
              _debug(`Failed to load ${filePath} ${e.message}`);
            }
            lastError = e;
          }
        }
        _log(`injecting env (${keysCount}) from ${shortPaths.join(",")}`);
      }
      if (lastError) {
        return { parsed: parsedAll, error: lastError };
      } else {
        return { parsed: parsedAll };
      }
    }
    function config(options) {
      if (_dotenvKey(options).length === 0) {
        return DotenvModule.configDotenv(options);
      }
      const vaultPath = _vaultPath(options);
      if (!vaultPath) {
        _warn(`You set DOTENV_KEY but you are missing a .env.vault file at ${vaultPath}. Did you forget to build it?`);
        return DotenvModule.configDotenv(options);
      }
      return DotenvModule._configVault(options);
    }
    function decrypt(encrypted, keyStr) {
      const key = Buffer.from(keyStr.slice(-64), "hex");
      let ciphertext = Buffer.from(encrypted, "base64");
      const nonce = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(-16);
      ciphertext = ciphertext.subarray(12, -16);
      try {
        const aesgcm = crypto.createDecipheriv("aes-256-gcm", key, nonce);
        aesgcm.setAuthTag(authTag);
        return `${aesgcm.update(ciphertext)}${aesgcm.final()}`;
      } catch (error) {
        const isRange = error instanceof RangeError;
        const invalidKeyLength = error.message === "Invalid key length";
        const decryptionFailed = error.message === "Unsupported state or unable to authenticate data";
        if (isRange || invalidKeyLength) {
          const err = new Error("INVALID_DOTENV_KEY: It must be 64 characters long (or more)");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        } else if (decryptionFailed) {
          const err = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
          err.code = "DECRYPTION_FAILED";
          throw err;
        } else {
          throw error;
        }
      }
    }
    function populate(processEnv, parsed, options = {}) {
      const debug = Boolean(options && options.debug);
      const override = Boolean(options && options.override);
      if (typeof parsed !== "object") {
        const err = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
        err.code = "OBJECT_REQUIRED";
        throw err;
      }
      for (const key of Object.keys(parsed)) {
        if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
          if (override === true) {
            processEnv[key] = parsed[key];
          }
          if (debug) {
            if (override === true) {
              _debug(`"${key}" is already defined and WAS overwritten`);
            } else {
              _debug(`"${key}" is already defined and was NOT overwritten`);
            }
          }
        } else {
          processEnv[key] = parsed[key];
        }
      }
    }
    var DotenvModule = {
      configDotenv,
      _configVault,
      _parseVault,
      config,
      decrypt,
      parse,
      populate
    };
    module2.exports.configDotenv = DotenvModule.configDotenv;
    module2.exports._configVault = DotenvModule._configVault;
    module2.exports._parseVault = DotenvModule._parseVault;
    module2.exports.config = DotenvModule.config;
    module2.exports.decrypt = DotenvModule.decrypt;
    module2.exports.parse = DotenvModule.parse;
    module2.exports.populate = DotenvModule.populate;
    module2.exports = DotenvModule;
  }
});

// src/config.ts
function readBridgeConfig() {
  try {
    return (0, import_node_fs.existsSync)(BRIDGE_CONFIG_FILE) ? JSON.parse((0, import_node_fs.readFileSync)(BRIDGE_CONFIG_FILE, "utf8")) : {};
  } catch {
    return {};
  }
}
function saveBridgeConfig(patch) {
  const merged = { ...readBridgeConfig(), ...patch };
  (0, import_node_fs.mkdirSync)(DATA_DIR, { recursive: true });
  (0, import_node_fs.writeFileSync)(BRIDGE_CONFIG_FILE, JSON.stringify(merged, null, 2));
}
function loadAtEnv() {
  const envPath = (0, import_node_path.resolve)(AT_REPO_PATH, ".env");
  if ((0, import_node_fs.existsSync)(envPath)) {
    (0, import_dotenv.config)({ path: envPath });
  }
}
function describeConfig() {
  const envPath = (0, import_node_path.resolve)(AT_REPO_PATH, ".env");
  return {
    atRepoPath: AT_REPO_PATH,
    atRepoExists: (0, import_node_fs.existsSync)(AT_REPO_PATH),
    atEnvExists: (0, import_node_fs.existsSync)(envPath),
    notionKeyConfigured: Boolean(process.env.NOTION_API_KEY),
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    bridgePort: BRIDGE_PORT,
    cdpBrowserUrl: CDP_BROWSER_URL,
    defaultAgent: DEFAULT_AGENT,
    artifactsDir: ARTIFACTS_DIR
  };
}
var import_node_fs, import_node_os, import_node_path, import_node_url, import_dotenv, PACKAGED, DATA_DIR, BRIDGE_CONFIG_FILE, FILE_CONFIG, AT_REPO_PATH, BRIDGE_PORT, CDP_BROWSER_URL, CLAUDE_MODEL, CHROME_BINARY, CHROME_USER_DATA_DIR, EXTENSION_PATH, CDP_PORT, DEFAULT_AGENT, ARTIFACTS_DIR;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    import_node_fs = require("node:fs");
    import_node_os = require("node:os");
    import_node_path = require("node:path");
    import_node_url = require("node:url");
    import_dotenv = __toESM(require_main(), 1);
    PACKAGED = process.env.JT_PACKAGED === "1";
    DATA_DIR = process.env.JT_DATA_DIR ?? (PACKAGED ? (0, import_node_path.resolve)((0, import_node_os.homedir)(), "Library", "Application Support", "JT Testing AI Agent") : (0, import_node_path.resolve)((0, import_node_url.fileURLToPath)("file:///bridge"), "..", ".."));
    BRIDGE_CONFIG_FILE = (0, import_node_path.resolve)(DATA_DIR, ".jt-bridge.json");
    FILE_CONFIG = readBridgeConfig();
    AT_REPO_PATH = process.env.AT_REPO_PATH ?? FILE_CONFIG.AT_REPO_PATH ?? "/Users/jefflin/gitProject/automatic-testing";
    BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8787);
    CDP_BROWSER_URL = process.env.CDP_BROWSER_URL ?? "http://127.0.0.1:9222";
    CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";
    CHROME_BINARY = process.env.CHROME_BINARY ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR ?? "/tmp/jt-chrome";
    EXTENSION_PATH = process.env.EXTENSION_PATH ?? (0, import_node_path.resolve)((0, import_node_url.fileURLToPath)("file:///bridge"), "..", "..", "..", "extension");
    CDP_PORT = Number(new URL(CDP_BROWSER_URL).port || 9222);
    DEFAULT_AGENT = process.env.DEFAULT_AGENT ?? "claude";
    ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? (0, import_node_path.resolve)(AT_REPO_PATH, "reports", "ai-agent");
  }
});

// src/agents/env.ts
function defaultPath(env = process.env) {
  const home = env.HOME;
  const extras = [
    home ? (0, import_node_path2.join)(home, ".local", "bin") : "",
    home ? (0, import_node_path2.join)(home, "bin") : "",
    home ? (0, import_node_path2.join)(home, ".npm-global", "bin") : "",
    home ? (0, import_node_path2.join)(home, ".antigravity", "antigravity", "bin") : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ];
  return [...extras, env.PATH ?? ""].filter(Boolean).join(":");
}
function augmentedEnv(env = process.env) {
  return { ...env, PATH: defaultPath(env) };
}
function commandExists(cmd) {
  return new Promise((resolve4) => {
    const p = (0, import_node_child_process2.spawn)("which", [cmd], { env: augmentedEnv() });
    p.on("close", (code) => resolve4(code === 0));
    p.on("error", () => resolve4(false));
  });
}
var import_node_child_process2, import_node_path2;
var init_env = __esm({
  "src/agents/env.ts"() {
    "use strict";
    import_node_child_process2 = require("node:child_process");
    import_node_path2 = require("node:path");
  }
});

// src/agents/claude.ts
function interpret(evt) {
  if (!evt || typeof evt !== "object") return null;
  switch (evt.type) {
    case "system":
      return { kind: "system", text: `[init] model=${evt.model ?? "?"} tools=${evt.tools?.length ?? 0}` };
    case "assistant": {
      const blocks = evt.message?.content ?? [];
      const parts = [];
      let kind = "text";
      for (const b of blocks) {
        if (b.type === "text" && b.text) parts.push(b.text);
        else if (b.type === "tool_use") {
          kind = "tool";
          parts.push(`\u{1F527} ${b.name}(${summarizeInput(b.input)})`);
        }
      }
      const text = parts.join("\n").trim();
      return text ? { kind, text } : null;
    }
    case "user": {
      const blocks = evt.message?.content ?? [];
      const parts = [];
      for (const b of blocks) {
        if (b.type === "tool_result") {
          const c = Array.isArray(b.content) ? b.content.map((x) => x.text ?? "").join(" ") : String(b.content ?? "");
          if (c.trim()) parts.push(`\u21B3 ${truncate(c.trim(), 200)}`);
        }
      }
      const text = parts.join("\n");
      return text ? { kind: "tool", text } : null;
    }
    case "result":
      return { kind: "result", text: evt.result ?? evt.subtype ?? "(done)" };
    default:
      return null;
  }
}
function summarizeInput(input) {
  if (!input || typeof input !== "object") return "";
  const obj = input;
  const keys = ["url", "selector", "uid", "text", "value", "key"];
  for (const k of keys) if (obj[k] != null) return `${k}=${truncate(String(obj[k]), 60)}`;
  return truncate(JSON.stringify(obj), 60);
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "\u2026" : s;
}
var import_node_child_process3, import_node_readline, ClaudeAdapter;
var init_claude = __esm({
  "src/agents/claude.ts"() {
    "use strict";
    import_node_child_process3 = require("node:child_process");
    import_node_readline = require("node:readline");
    init_env();
    ClaudeAdapter = class {
      name = "claude";
      isAvailable() {
        return commandExists("claude");
      }
      run(opts) {
        const args = [
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--permission-mode",
          "bypassPermissions"
        ];
        if (opts.mcpConfigPath) {
          args.push("--mcp-config", opts.mcpConfigPath, "--strict-mcp-config");
        }
        if (opts.allowedTools?.length) args.push("--allowedTools", ...opts.allowedTools);
        if (opts.model) args.push("--model", opts.model);
        if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
        args.push(opts.prompt);
        return new Promise((resolve4) => {
          const child = (0, import_node_child_process3.spawn)("claude", args, {
            cwd: opts.cwd,
            env: augmentedEnv()
          });
          let finalText = "";
          let ok = false;
          const rl = (0, import_node_readline.createInterface)({ input: child.stdout });
          rl.on("line", (line) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            let evt;
            try {
              evt = JSON.parse(trimmed);
            } catch {
              return;
            }
            const out = interpret(evt);
            if (!out) return;
            if (out.kind === "result") {
              finalText = out.text;
              ok = !evt.is_error;
            }
            opts.onEvent({ kind: out.kind, text: out.text, raw: evt });
          });
          child.stderr.on(
            "data",
            (d) => opts.onEvent({ kind: "stderr", text: d.toString().trim() })
          );
          if (opts.signal) {
            opts.signal.addEventListener("abort", () => child.kill("SIGTERM"), {
              once: true
            });
          }
          child.on("error", (err) => {
            opts.onEvent({ kind: "stderr", text: `spawn error: ${err.message}` });
            resolve4({ ok: false, finalText: err.message });
          });
          child.on("close", () => resolve4({ ok, finalText }));
        });
      }
    };
  }
});

// src/agents/codex.ts
function defaultPath2(env = process.env) {
  const home = env.HOME;
  const extras = [
    home ? (0, import_node_path3.join)(home, ".local", "bin") : "",
    home ? (0, import_node_path3.join)(home, "bin") : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ];
  return [...extras, env.PATH ?? ""].filter(Boolean).join(":");
}
async function canExecute(path) {
  try {
    await (0, import_promises.access)(path, import_node_fs2.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function which(cmd, env) {
  return new Promise((resolve4) => {
    const p = (0, import_node_child_process4.spawn)("which", [cmd], { env });
    let stdout = "";
    p.stdout.on("data", (d) => stdout += d.toString());
    p.on("close", (code) => resolve4(code === 0 ? stdout.trim().split("\n")[0] || null : null));
    p.on("error", () => resolve4(null));
  });
}
async function resolveCodexCommand(env = process.env) {
  const withPath = { ...env, PATH: defaultPath2(env) };
  const configured = env.CODEX_BINARY || env.CODEX_BIN;
  if (configured && await canExecute(configured)) return configured;
  const fromPath = await which("codex", withPath);
  if (fromPath) return fromPath;
  const home = env.HOME;
  const candidates = [
    home ? (0, import_node_path3.join)(home, ".local", "bin", "codex") : "",
    home ? (0, import_node_path3.join)(home, ".npm-global", "bin", "codex") : "",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ].filter(Boolean);
  for (const c of candidates) if (await canExecute(c)) return c;
  return null;
}
function tomlString(value) {
  return JSON.stringify(String(value));
}
function tomlArray(values) {
  return `[${values.map((v) => tomlString(v)).join(", ")}]`;
}
function tomlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}
function tomlInlineTable(obj) {
  const entries = Object.entries(obj).map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`);
  return `{ ${entries.join(", ")} }`;
}
function mcpToCodexArgs(mcpConfigPath) {
  if (!mcpConfigPath) return [];
  try {
    const cfg = JSON.parse((0, import_node_fs2.readFileSync)(mcpConfigPath, "utf8"));
    const servers = cfg.mcpServers ?? {};
    const args = [];
    for (const [name, def] of Object.entries(servers)) {
      if (def.command) args.push("-c", `mcp_servers.${name}.command=${tomlString(def.command)}`);
      if (Array.isArray(def.args)) args.push("-c", `mcp_servers.${name}.args=${tomlArray(def.args)}`);
      if (def.env && typeof def.env === "object") {
        args.push("-c", `mcp_servers.${name}.env=${tomlInlineTable(def.env)}`);
      }
    }
    return args;
  } catch {
    return [];
  }
}
function truncate2(s, n) {
  return s.length > n ? s.slice(0, n) + "..." : s;
}
function summarizeItem(item) {
  if (!item || typeof item !== "object") return null;
  if (item.type === "agent_message" && typeof item.text === "string") {
    return { kind: "result", text: item.text };
  }
  if (item.type === "reasoning") {
    const text = item.text ?? item.summary?.map?.((s) => s.text ?? "").filter(Boolean).join("\n") ?? "";
    return text ? { kind: "text", text } : null;
  }
  if (item.type?.includes?.("tool") || item.type === "function_call") {
    const name = item.name ?? item.call?.name ?? item.type;
    const input = item.arguments ?? item.input ?? item.call?.arguments;
    const suffix = input ? ` ${truncate2(typeof input === "string" ? input : JSON.stringify(input), 120)}` : "";
    return { kind: "tool", text: `${name}${suffix}` };
  }
  if (item.type === "command_execution") {
    return { kind: "tool", text: truncate2(item.command ?? JSON.stringify(item), 160) };
  }
  return null;
}
function summarizeEvent(evt) {
  if (!evt || typeof evt !== "object") return null;
  if (evt.type === "thread.started") return { kind: "system", text: `[codex] thread=${evt.thread_id ?? "started"}` };
  if (evt.type === "turn.started") return { kind: "system", text: "[codex] turn started" };
  if (evt.type === "turn.completed") return { kind: "system", text: "[codex] turn completed" };
  if (evt.type === "turn.failed" || evt.type === "error") {
    const message = evt.error?.message ?? evt.message ?? JSON.stringify(evt);
    return { kind: "stderr", text: message };
  }
  if (evt.type === "item.completed" || evt.type === "item.started") return summarizeItem(evt.item);
  const msg = evt.msg ?? evt;
  if (msg !== evt) return summarizeEvent(msg);
  if (msg.type?.includes?.("tool") || msg.type === "function_call") {
    return { kind: "tool", text: msg.name ?? msg.type };
  }
  if (typeof msg.text === "string") return { kind: "text", text: msg.text };
  if (typeof msg.message === "string") return { kind: "text", text: msg.message };
  return null;
}
function isNoisyCodexWarning(line) {
  return line === "Reading additional input from stdin..." || /WARN codex_core_plugins::manifest: ignoring interface\.defaultPrompt/.test(line) || /WARN codex_core_skills::loader: ignoring interface\.icon_/.test(line) || /WARN codex_rollout::list: state db discrepancy/.test(line);
}
var import_node_child_process4, import_node_fs2, import_promises, import_node_path3, import_node_readline2, CodexAdapter;
var init_codex = __esm({
  "src/agents/codex.ts"() {
    "use strict";
    import_node_child_process4 = require("node:child_process");
    import_node_fs2 = require("node:fs");
    import_promises = require("node:fs/promises");
    import_node_path3 = require("node:path");
    import_node_readline2 = require("node:readline");
    CodexAdapter = class {
      name = "codex";
      commandPath;
      async command() {
        if (this.commandPath !== void 0) return this.commandPath;
        this.commandPath = await resolveCodexCommand();
        return this.commandPath;
      }
      async isAvailable() {
        return Boolean(await this.command());
      }
      async run(opts) {
        const command = await this.command();
        if (!command) return { ok: false, finalText: "codex CLI \u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u7528" };
        const args = [
          "exec",
          "--json",
          "--ephemeral",
          "--dangerously-bypass-approvals-and-sandbox",
          "-C",
          opts.cwd,
          ...mcpToCodexArgs(opts.mcpConfigPath)
        ];
        if (opts.model) args.push("-m", opts.model);
        const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}

${opts.prompt}` : opts.prompt;
        args.push(fullPrompt);
        return new Promise((resolve4) => {
          const child = (0, import_node_child_process4.spawn)(command, args, {
            cwd: opts.cwd,
            env: { ...process.env, PATH: defaultPath2(process.env) },
            stdio: ["ignore", "pipe", "pipe"]
          });
          let finalText = "";
          let sawFailure = false;
          const rl = (0, import_node_readline2.createInterface)({ input: child.stdout });
          rl.on("line", (line) => {
            const t = line.trim();
            if (!t) return;
            let evt;
            try {
              evt = JSON.parse(t);
            } catch {
              opts.onEvent({ kind: "text", text: t });
              return;
            }
            const out = summarizeEvent(evt);
            if (!out) return;
            if (out.kind === "result") finalText = out.text;
            if (out.kind === "stderr") sawFailure = true;
            opts.onEvent({ kind: out.kind, text: out.kind === "tool" ? `\u{1F527} ${out.text}` : out.text, raw: evt });
          });
          child.stderr.on("data", (d) => {
            for (const line of d.toString().split("\n").map((s) => s.trim()).filter(Boolean)) {
              if (!isNoisyCodexWarning(line)) opts.onEvent({ kind: "stderr", text: line });
            }
          });
          opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
          child.on("error", (err) => {
            opts.onEvent({ kind: "stderr", text: `spawn error: ${err.message}` });
            resolve4({ ok: false, finalText: err.message });
          });
          child.on("close", (code) => resolve4({ ok: code === 0 && !sawFailure, finalText }));
        });
      }
    };
  }
});

// src/agents/antigravity.ts
async function canExecute2(p) {
  try {
    await (0, import_promises2.access)(p, import_node_fs3.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function which2(cmd, env) {
  return new Promise((resolve4) => {
    const p = (0, import_node_child_process5.spawn)("which", [cmd], { env });
    let out = "";
    p.stdout.on("data", (d) => out += d.toString());
    p.on("close", (code) => resolve4(code === 0 ? out.trim().split("\n")[0] || null : null));
    p.on("error", () => resolve4(null));
  });
}
async function resolveCommand(env = process.env) {
  const withPath = { ...env, PATH: defaultPath(env) };
  if (env.ANTIGRAVITY_BIN && await canExecute2(env.ANTIGRAVITY_BIN)) return env.ANTIGRAVITY_BIN;
  for (const name of ["agy", "antigravity"]) {
    const hit = await which2(name, withPath);
    if (hit) return hit;
  }
  const home = env.HOME;
  const candidates = [
    home ? (0, import_node_path4.join)(home, ".antigravity", "antigravity", "bin", "agy") : "",
    home ? (0, import_node_path4.join)(home, ".antigravity", "antigravity", "bin", "antigravity") : ""
  ].filter(Boolean);
  for (const c of candidates) if (await canExecute2(c)) return c;
  return null;
}
function baseArgs() {
  const raw = process.env.ANTIGRAVITY_ARGS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
    }
  }
  return ["-p"];
}
var import_node_child_process5, import_node_fs3, import_promises2, import_node_readline3, import_node_path4, AntigravityAdapter;
var init_antigravity = __esm({
  "src/agents/antigravity.ts"() {
    "use strict";
    import_node_child_process5 = require("node:child_process");
    import_node_fs3 = require("node:fs");
    import_promises2 = require("node:fs/promises");
    import_node_readline3 = require("node:readline");
    import_node_path4 = require("node:path");
    init_env();
    AntigravityAdapter = class {
      name = "antigravity";
      cmd;
      async command() {
        if (this.cmd !== void 0) return this.cmd;
        this.cmd = await resolveCommand();
        return this.cmd;
      }
      async isAvailable() {
        return Boolean(await this.command());
      }
      async run(opts) {
        const command = await this.command();
        if (!command) return { ok: false, finalText: "antigravity CLI \u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u7528" };
        const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}

${opts.prompt}` : opts.prompt;
        const args = [...baseArgs(), fullPrompt];
        return new Promise((resolve4) => {
          const child = (0, import_node_child_process5.spawn)(command, args, {
            cwd: opts.cwd,
            env: augmentedEnv(),
            stdio: ["ignore", "pipe", "pipe"]
          });
          let finalText = "";
          const rl = (0, import_node_readline3.createInterface)({ input: child.stdout });
          rl.on("line", (line) => {
            const t = line.trim();
            if (!t) return;
            try {
              const evt = JSON.parse(t);
              const content = evt.content ?? evt.text ?? evt.message;
              if (typeof content === "string" && content.trim()) {
                finalText = content;
                opts.onEvent({ kind: "text", text: content, raw: evt });
              }
            } catch {
              finalText = t;
              opts.onEvent({ kind: "text", text: t });
            }
          });
          child.stderr.on("data", (d) => opts.onEvent({ kind: "stderr", text: d.toString().trim() }));
          opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
          child.on("error", (err) => {
            opts.onEvent({ kind: "stderr", text: `spawn error: ${err.message}` });
            resolve4({ ok: false, finalText: err.message });
          });
          child.on("close", (code) => resolve4({ ok: code === 0, finalText }));
        });
      }
    };
  }
});

// src/agents/index.ts
async function availableAgents() {
  const out = [];
  for (const [name, a] of registry) if (await a.isAvailable()) out.push(name);
  return out;
}
function getAgent(name) {
  const key = (name ?? "claude").toLowerCase();
  const adapter = registry.get(key);
  if (!adapter) {
    throw new Error(`\u672A\u77E5\u6216\u5C1A\u672A\u652F\u63F4\u7684 agent: ${name}\uFF08\u76EE\u524D\u652F\u63F4\uFF1A${[...registry.keys()].join(", ")}\uFF09`);
  }
  return adapter;
}
function listAgents() {
  return [...registry.keys()];
}
var registry;
var init_agents = __esm({
  "src/agents/index.ts"() {
    "use strict";
    init_claude();
    init_codex();
    init_antigravity();
    registry = /* @__PURE__ */ new Map();
    registry.set("claude", new ClaudeAdapter());
    registry.set("codex", new CodexAdapter());
    registry.set("antigravity", new AntigravityAdapter());
  }
});

// src/mcp.ts
function writeBrowserMcpConfig() {
  const dir = (0, import_node_fs4.mkdtempSync)((0, import_node_path5.join)((0, import_node_os2.tmpdir)(), "jt-ai-bmcp-"));
  const path = (0, import_node_path5.join)(dir, "mcp.json");
  const env = { JT_BRIDGE_CDP_URL: `ws://localhost:${BRIDGE_PORT}/agent-cdp` };
  let server;
  if (process.env.JT_BRIDGE_SCRIPT) {
    server = { command: process.execPath, args: [process.env.JT_BRIDGE_SCRIPT, "--browser-mcp"], env };
  } else if (process.env.JT_BRIDGE_BIN) {
    server = { command: process.env.JT_BRIDGE_BIN, args: ["--browser-mcp"], env };
  } else {
    server = { command: "node", args: [BROWSER_MCP_PATH], env };
  }
  const config = { mcpServers: { "jt-browser": server } };
  (0, import_node_fs4.writeFileSync)(path, JSON.stringify(config, null, 2));
  return path;
}
function writeMcpConfig(browserUrl = CDP_BROWSER_URL) {
  const dir = (0, import_node_fs4.mkdtempSync)((0, import_node_path5.join)((0, import_node_os2.tmpdir)(), "jt-ai-mcp-"));
  const path = (0, import_node_path5.join)(dir, "mcp.json");
  const config = {
    mcpServers: {
      "chrome-devtools": {
        command: "npx",
        args: ["-y", "chrome-devtools-mcp@latest", "--browser-url", browserUrl]
      }
    }
  };
  (0, import_node_fs4.writeFileSync)(path, JSON.stringify(config, null, 2));
  return path;
}
async function probeCdp(browserUrl = CDP_BROWSER_URL) {
  try {
    const ver = await fetch(`${browserUrl}/json/version`).then((r) => r.json());
    const list = await fetch(`${browserUrl}/json/list`).then((r) => r.json()).catch(() => []);
    const pages = (Array.isArray(list) ? list : []).filter((t) => t.type === "page").map((t) => ({ url: t.url, title: t.title }));
    return { ok: true, version: ver.Browser, pages };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
var import_node_fs4, import_node_os2, import_node_path5, import_node_url2, CHROME_DEVTOOLS_TOOLS, JT_BROWSER_TOOLS, __dirname, BROWSER_MCP_PATH;
var init_mcp = __esm({
  "src/mcp.ts"() {
    "use strict";
    import_node_fs4 = require("node:fs");
    import_node_os2 = require("node:os");
    import_node_path5 = require("node:path");
    import_node_url2 = require("node:url");
    init_config();
    CHROME_DEVTOOLS_TOOLS = ["mcp__chrome-devtools"];
    JT_BROWSER_TOOLS = ["mcp__jt-browser"];
    __dirname = (0, import_node_path5.dirname)((0, import_node_url2.fileURLToPath)("file:///bridge"));
    BROWSER_MCP_PATH = (0, import_node_path5.resolve)(__dirname, "..", "browser-mcp.mjs");
  }
});

// src/cdp-proxy.ts
var TabRelay;
var init_cdp_proxy = __esm({
  "src/cdp-proxy.ts"() {
    "use strict";
    TabRelay = class {
      socket = null;
      seq = 0;
      pending = /* @__PURE__ */ new Map();
      tabId = null;
      url = "";
      title = "";
      onEvent = null;
      onDetach = null;
      get connected() {
        return !!this.socket && this.socket.readyState === this.socket.OPEN;
      }
      attachSocket(ws2) {
        this.socket = ws2;
        ws2.on("message", (data) => this.handle(data.toString()));
        ws2.on("close", () => {
          this.socket = null;
          this.onDetach?.();
        });
      }
      handle(raw) {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        switch (msg.type) {
          case "hello":
            this.tabId = msg.tabId;
            this.url = msg.url ?? "";
            this.title = msg.title ?? "";
            break;
          case "result": {
            const cb = this.pending.get(msg.id);
            if (cb) {
              this.pending.delete(msg.id);
              cb({ result: msg.result, error: msg.error });
            }
            break;
          }
          case "event":
            this.onEvent?.(msg.method, msg.params);
            break;
          case "detached":
            this.onDetach?.();
            break;
        }
      }
      /** 轉發一條 CDP 指令到 extension 的 chrome.debugger。 */
      sendCommand(method, params) {
        return new Promise((resolve4) => {
          if (!this.connected) return resolve4({ error: { message: "tab relay not connected" } });
          const id = ++this.seq;
          this.pending.set(id, resolve4);
          this.socket.send(JSON.stringify({ type: "command", id, method, params }));
          setTimeout(() => {
            if (this.pending.has(id)) {
              this.pending.delete(id);
              resolve4({ error: { message: `cdp command timeout: ${method}` } });
            }
          }, 3e4);
        });
      }
    };
  }
});

// src/attach.ts
function isRelayConnected() {
  return tabRelay.connected;
}
var tabRelay;
var init_attach = __esm({
  "src/attach.ts"() {
    "use strict";
    init_cdp_proxy();
    tabRelay = new TabRelay();
  }
});

// src/prompt.ts
function buildRunPrompt(tc, target) {
  const lines = [];
  lines.push(`# \u6E2C\u8A66\u6848\u4F8B ${tc.tcId}\uFF1A${tc.title}`);
  if (target?.url) lines.push(`
\u76EE\u6A19\u5206\u9801 URL\uFF1A${target.url}`);
  if (tc.purpose) lines.push(`
## \u76EE\u7684
${tc.purpose}`);
  if (tc.preconditions.length)
    lines.push(`
## \u524D\u7F6E\u689D\u4EF6
${tc.preconditions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  if (tc.steps.length)
    lines.push(`
## \u6E2C\u8A66\u6B65\u9A5F
${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  if (tc.expected.length)
    lines.push(`
## \u78BA\u8A8D\u9805\u76EE\uFF08\u9010\u689D\u9A57\u8B49\uFF09
${tc.expected.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  lines.push(
    [
      "\n## \u57F7\u884C\u8981\u6C42",
      "1. \u5148 list_pages \u2192 \u627E\u5230\u7B26\u5408\u4E0A\u8FF0\u76EE\u6A19 URL \u7684\u5206\u9801 \u2192 select_page\u3002",
      "2. \u4F9D\u5E8F\u57F7\u884C\u6E2C\u8A66\u6B65\u9A5F\uFF0C\u5FC5\u8981\u6642 take_snapshot / wait_for\u3002",
      "3. \u9010\u689D\u9A57\u8B49\u300E\u78BA\u8A8D\u9805\u76EE\u300F\uFF0C\u8A18\u9304\u5BE6\u969B\u7D50\u679C\u3002",
      "4. \u6700\u5F8C\u8F38\u51FA\u4E0B\u5217\u56FA\u5B9A\u683C\u5F0F\uFF08\u4F9B\u7A0B\u5F0F\u89E3\u6790\uFF09\uFF1A",
      "",
      "```verdict",
      "STATUS: PASS \u6216 FAIL",
      "SUMMARY: \u4E00\u53E5\u8A71\u7E3D\u7D50",
      "CHECKS:",
      "- <\u78BA\u8A8D\u9805\u76EE1>: PASS/FAIL - \u5BE6\u969B\u89C0\u5BDF",
      "- <\u78BA\u8A8D\u9805\u76EE2>: PASS/FAIL - \u5BE6\u969B\u89C0\u5BDF",
      "```"
    ].join("\n")
  );
  return lines.join("\n");
}
function parseVerdict(finalText) {
  const block = finalText.match(/```verdict([\s\S]*?)```/i)?.[1] ?? finalText;
  const statusM = block.match(/STATUS:\s*(PASS|FAIL)/i);
  const summaryM = block.match(/SUMMARY:\s*(.+)/i);
  if (!statusM) {
    const raw = (finalText || "").trim();
    if (/session limit|usage limit|rate limit|quota/i.test(raw))
      return { status: "error", summary: `Agent \u984D\u5EA6/\u9650\u5236\uFF1A${raw.slice(0, 160)}` };
    return {
      status: "error",
      summary: summaryM?.[1]?.trim() || raw.slice(0, 200) || "\u7121\u6CD5\u89E3\u6790\u6E2C\u8A66\u7D50\u679C\uFF08agent \u7121\u8F38\u51FA\uFF09"
    };
  }
  return {
    status: statusM[1].toUpperCase() === "PASS" ? "pass" : "fail",
    summary: summaryM?.[1]?.trim() ?? ""
  };
}
var SYSTEM_PROMPT, ATTACH_SYSTEM_PROMPT;
var init_prompt = __esm({
  "src/prompt.ts"() {
    "use strict";
    SYSTEM_PROMPT = [
      "\u4F60\u662F\u4E00\u500B E2E \u6E2C\u8A66\u57F7\u884C agent\uFF0C\u900F\u904E chrome-devtools MCP \u5DE5\u5177\u64CD\u4F5C\u300E\u4F7F\u7528\u8005\u76EE\u524D\u6B63\u5728\u770B\u7684\u9019\u500B Chrome \u5206\u9801\u300F\u3002",
      "\u76EE\u6A19\u7DB2\u7AD9\u591A\u70BA Vue.js SPA\uFF1A\u64CD\u4F5C\u524D\u52D9\u5FC5\u7B49\u5F85\u5143\u7D20\u51FA\u73FE/\u53EF\u898B\uFF08\u7B49\u540C networkidle + wait_for visible\uFF09\uFF0C\u4E0D\u8981\u5C0D\u5C1A\u672A\u6E32\u67D3\u7684\u5143\u7D20\u64CD\u4F5C\u3002",
      "\u9078\u64C7\u5668\u512A\u5148\u5E8F\uFF1Adata-testid > name > placeholder > \u6587\u5B57\u8A9E\u610F > type > class\uFF0C\u7981\u7528 nth-child \u4F4D\u7F6E\u9078\u64C7\u5668\u3002",
      "\u52D9\u5FC5\u300E\u63A5\u7BA1\u7576\u524D\u5206\u9801\u300F\u800C\u975E\u958B\u65B0\u5206\u9801\uFF1A\u5148\u7528 list_pages \u627E\u5230\u8207\u76EE\u6A19 URL \u76F8\u7B26\u7684\u5206\u9801\u4E26 select_page\uFF0C\u518D\u64CD\u4F5C\u3002",
      "\u9010\u6B65\u57F7\u884C\u6E2C\u8A66\u6B65\u9A5F\uFF0C\u6BCF\u6B65\u8AAA\u660E\u4F60\u505A\u4E86\u4EC0\u9EBC\uFF1B\u6700\u5F8C\u9010\u689D\u6AA2\u67E5\u300E\u78BA\u8A8D\u9805\u76EE\u300F\u3002",
      "\u53EA\u505A\u6E2C\u8A66\u6848\u4F8B\u63CF\u8FF0\u7684\u64CD\u4F5C\uFF0C\u4E0D\u8981\u9032\u884C\u7834\u58DE\u6027\u6216\u8207\u6E2C\u8A66\u7121\u95DC\u7684\u52D5\u4F5C\u3002"
    ].join("\n");
    ATTACH_SYSTEM_PROMPT = [
      "\u4F60\u662F\u4E00\u500B E2E \u6E2C\u8A66\u57F7\u884C agent\uFF0C\u900F\u904E jt-browser MCP \u5DE5\u5177\u64CD\u4F5C\u300E\u4F7F\u7528\u8005\u76EE\u524D\u7684 Chrome \u5206\u9801\u300F\uFF08\u5DF2\u7531 extension \u63A5\u7BA1\uFF09\u3002",
      "\u53EF\u7528\u5DE5\u5177\uFF1Asnapshot\uFF08\u8B80\u9801\u9762+\u4E92\u52D5\u5143\u7D20ref\uFF09\u3001navigate\u3001click\uFF08\u7528 ref \u6216 text\uFF09\u3001fill\uFF08ref+value\uFF09\u3001wait_for\uFF08\u7B49\u6587\u5B57\uFF09\u3001evaluate\uFF08\u57F7\u884CJS\u9A57\u8B49\uFF09\u3002",
      "\u6D41\u7A0B\uFF1A\u5148 snapshot \u4E86\u89E3\u9801\u9762 \u2192 \u4F9D\u6E2C\u8A66\u6B65\u9A5F\u7528 click/fill/navigate \u64CD\u4F5C \u2192\uFF08\u5FC5\u8981\u6642 wait_for\uFF09\u2192 \u7528 evaluate/snapshot \u9A57\u8B49\u300E\u78BA\u8A8D\u9805\u76EE\u300F\u3002",
      "\u76EE\u6A19\u7DB2\u7AD9\u591A\u70BA Vue SPA\uFF1A\u64CD\u4F5C\u5F8C\u5E38\u9700 wait_for \u7B49\u5F85\u7D50\u679C\u51FA\u73FE\u518D\u9A57\u8B49\u3002",
      "\u53EA\u505A\u6E2C\u8A66\u6848\u4F8B\u63CF\u8FF0\u7684\u64CD\u4F5C\uFF0C\u4E0D\u8981\u7834\u58DE\u6027\u52D5\u4F5C\u3002"
    ].join("\n");
  }
});

// src/recorder.ts
function framesToGif(frameDir, outGifPath, fps) {
  const input = (0, import_node_path6.join)(frameDir, "frame-%05d.jpg");
  const filter = `fps=${fps},scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
  return new Promise((resolve4) => {
    const ff = (0, import_node_child_process6.spawn)(
      "ffmpeg",
      ["-y", "-framerate", String(fps), "-i", input, "-vf", filter, "-loop", "0", outGifPath],
      { env: augmentedEnv() }
    );
    let err = "";
    ff.stderr?.on("data", (d) => err += d.toString());
    ff.on("error", (e) => {
      console.error(`[recorder] ffmpeg spawn \u5931\u6557\uFF1A${e.message}`);
      resolve4(false);
    });
    ff.on("close", (code) => {
      const ok = code === 0 && (0, import_node_fs5.existsSync)(outGifPath);
      if (!ok) console.error(`[recorder] ffmpeg \u5408\u6210\u5931\u6557 code=${code}: ${err.slice(-300)}`);
      resolve4(ok);
    });
  });
}
async function findPageWsUrl(targetUrl, browserUrl = CDP_BROWSER_URL) {
  try {
    const list = await fetch(`${browserUrl}/json/list`).then((r) => r.json());
    const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pages.length) return null;
    if (targetUrl) {
      const hit = pages.find((p) => p.url === targetUrl || p.url.startsWith(targetUrl));
      if (hit) return hit.webSocketDebuggerUrl;
    }
    return pages[0].webSocketDebuggerUrl;
  } catch {
    return null;
  }
}
var import_node_child_process6, import_node_fs5, import_node_path6, ScreencastRecorder, AttachRecorder;
var init_recorder = __esm({
  "src/recorder.ts"() {
    "use strict";
    import_node_child_process6 = require("node:child_process");
    import_node_fs5 = require("node:fs");
    import_node_path6 = require("node:path");
    init_wrapper();
    init_config();
    init_attach();
    init_env();
    ScreencastRecorder = class {
      constructor(wsUrl, outGifPath, workDir) {
        this.wsUrl = wsUrl;
        this.outGifPath = outGifPath;
        this.workDir = workDir;
        this.frameDir = (0, import_node_path6.join)(workDir, "frames");
      }
      wsUrl;
      outGifPath;
      workDir;
      ws = null;
      msgId = 0;
      frameDir;
      frameCount = 0;
      started = false;
      send(method, params = {}) {
        this.ws?.send(JSON.stringify({ id: ++this.msgId, method, params }));
      }
      async start() {
        if ((0, import_node_fs5.existsSync)(this.frameDir)) (0, import_node_fs5.rmSync)(this.frameDir, { recursive: true, force: true });
        (0, import_node_fs5.mkdirSync)(this.frameDir, { recursive: true });
        await new Promise((resolve4, reject) => {
          this.ws = new wrapper_default(this.wsUrl);
          this.ws.on("open", () => {
            this.send("Page.enable");
            this.send("Page.startScreencast", {
              format: "jpeg",
              quality: 60,
              maxWidth: 900,
              maxHeight: 900,
              everyNthFrame: 1
            });
            this.started = true;
            resolve4();
          });
          this.ws.on("error", reject);
          this.ws.on("message", (data) => this.onMessage(data.toString()));
        });
      }
      onMessage(raw) {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (msg.method === "Page.screencastFrame") {
          const { data, sessionId } = msg.params;
          const idx = String(++this.frameCount).padStart(5, "0");
          (0, import_node_fs5.writeFileSync)((0, import_node_path6.join)(this.frameDir, `frame-${idx}.jpg`), Buffer.from(data, "base64"));
          this.send("Page.screencastFrameAck", { sessionId });
        }
      }
      /** 停止錄影並用 ffmpeg 合成 gif。回傳 gif 路徑（無 frame 則 null）。 */
      async stop(fps = 4) {
        if (this.started) {
          this.send("Page.stopScreencast");
          await new Promise((r) => setTimeout(r, 150));
        }
        this.ws?.close();
        this.ws = null;
        if (this.frameCount === 0) return null;
        const ok = await this.assembleGif(fps);
        return ok ? this.outGifPath : null;
      }
      assembleGif(fps) {
        return framesToGif(this.frameDir, this.outGifPath, fps);
      }
    };
    AttachRecorder = class {
      constructor(outGifPath, workDir) {
        this.outGifPath = outGifPath;
        this.workDir = workDir;
        this.frameDir = (0, import_node_path6.join)(workDir, "frames");
      }
      outGifPath;
      workDir;
      frameDir;
      frameCount = 0;
      started = false;
      async start() {
        if (!tabRelay.connected) throw new Error("tabRelay \u672A\u9023\u7DDA\uFF0C\u7121\u6CD5\u9304\u5F71");
        if ((0, import_node_fs5.existsSync)(this.frameDir)) (0, import_node_fs5.rmSync)(this.frameDir, { recursive: true, force: true });
        (0, import_node_fs5.mkdirSync)(this.frameDir, { recursive: true });
        tabRelay.onEvent = (method, params) => {
          if (method !== "Page.screencastFrame") return;
          const idx = String(++this.frameCount).padStart(5, "0");
          (0, import_node_fs5.writeFileSync)((0, import_node_path6.join)(this.frameDir, `frame-${idx}.jpg`), Buffer.from(params.data, "base64"));
          void tabRelay.sendCommand("Page.screencastFrameAck", { sessionId: params.sessionId });
        };
        await tabRelay.sendCommand("Page.enable", {});
        await tabRelay.sendCommand("Page.startScreencast", {
          format: "jpeg",
          quality: 60,
          maxWidth: 900,
          maxHeight: 900,
          everyNthFrame: 1
        });
        this.started = true;
      }
      async stop(fps = 4) {
        if (this.started) {
          await tabRelay.sendCommand("Page.stopScreencast", {});
          await new Promise((r) => setTimeout(r, 150));
        }
        tabRelay.onEvent = null;
        if (this.frameCount === 0) return null;
        const ok = await framesToGif(this.frameDir, this.outGifPath, fps);
        return ok ? this.outGifPath : null;
      }
    };
  }
});

// src/report.ts
function extractChecks(finalText) {
  const block = finalText.match(/CHECKS:\s*([\s\S]*?)(?:```|$)/i)?.[1] ?? "";
  return block.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-")).map((l) => l.replace(/^-\s*/, ""));
}
function buildMarkdown(a) {
  const { tc, status, summary, finalText, agentName, durationMs } = a;
  const checks = extractChecks(finalText);
  const now = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
  const lines = [];
  lines.push(`# ${tc.tcId} ${tc.title}`);
  lines.push("");
  lines.push(
    `**\u72C0\u614B**\uFF1A${STATUS_EMOJI[status]}\u3000\xB7\u3000**\u8017\u6642**\uFF1A${Math.round(durationMs / 1e3)}s\u3000\xB7\u3000**Agent**\uFF1A${agentName}\u3000\xB7\u3000**\u6642\u9593**\uFF1A${now}`
  );
  if (tc.meta?.version || tc.meta?.ENV) {
    lines.push("");
    lines.push(`**version**\uFF1A${tc.meta.version ?? "-"}\u3000\xB7\u3000**ENV**\uFF1A${tc.meta.ENV ?? "-"}`);
  }
  if (tc.purpose) {
    lines.push("");
    lines.push(`> \u76EE\u7684\uFF1A${tc.purpose}`);
  }
  if (tc.preconditions.length) {
    lines.push("", "## \u524D\u7F6E\u689D\u4EF6");
    tc.preconditions.forEach((s) => lines.push(`- ${s}`));
  }
  if (tc.steps.length) {
    lines.push("", "## \u6E2C\u8A66\u6B65\u9A5F");
    tc.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  lines.push("", "## \u78BA\u8A8D\u9805\u76EE\u7D50\u679C");
  if (checks.length) {
    checks.forEach((c) => {
      const ok = /:\s*pass/i.test(c) || /\bPASS\b/.test(c);
      lines.push(`- ${ok ? "\u2705" : "\u274C"} ${c}`);
    });
  } else {
    tc.expected.forEach((s) => lines.push(`- \u2B1C ${s}`));
  }
  lines.push("", "## \u6458\u8981", summary || "(\u7121)");
  if (a.gifFileName) {
    lines.push("", "## \u9304\u5F71", `\`${a.gifFileName}\`\uFF08\u6E2C\u8A66\u904E\u7A0B\u9304\u5F71\uFF0C\u8ACB\u624B\u52D5\u62D6\u5165 Notion\uFF09`);
  }
  const verdict = finalText.match(/```verdict[\s\S]*?```/i)?.[0];
  if (verdict) {
    lines.push("", "## Agent \u539F\u59CB\u7D50\u8AD6", verdict);
  }
  return lines.join("\n");
}
function writeMarkdown(filePath, args) {
  const md = buildMarkdown(args);
  (0, import_node_fs6.writeFileSync)(filePath, md, "utf8");
  return md;
}
var import_node_fs6, STATUS_EMOJI;
var init_report = __esm({
  "src/report.ts"() {
    "use strict";
    import_node_fs6 = require("node:fs");
    STATUS_EMOJI = {
      pass: "\u2705 PASS",
      fail: "\u274C FAIL",
      error: "\u26A0\uFE0F ERROR"
    };
  }
});

// src/runner.ts
function cancelRun(runId) {
  const ctrl = activeRuns.get(runId);
  if (ctrl) {
    ctrl.abort();
    activeRuns.delete(runId);
    return true;
  }
  return false;
}
async function startRun(payload, emit) {
  const runId = (0, import_node_crypto.randomUUID)().slice(0, 8);
  const agentName = payload.agent ?? DEFAULT_AGENT;
  const agent = getAgent(agentName);
  if (!await agent.isAvailable()) {
    throw new Error(`agent '${agentName}' CLI \u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u7528`);
  }
  const mode = payload.mode ?? "remote";
  let probe = { ok: true };
  if (mode === "attach") {
    if (!isRelayConnected()) {
      throw new Error("\u5C1A\u672A\u63A5\u7BA1\u7576\u524D\u5206\u9801\uFF1A\u8ACB\u5148\u5728 side panel \u6309\u300C\u63A5\u7BA1\u7576\u524D\u5206\u9801\u300D\u3002");
    }
  } else {
    probe = await probeCdp(CDP_BROWSER_URL);
    if (!probe.ok) {
      throw new Error(
        `\u7121\u6CD5\u9023\u5230\u76EE\u6A19 Chrome \u7684 CDP\uFF08${CDP_BROWSER_URL}\uFF09\u3002
\u8ACB\u6309 side panel \u7684\u300C\u555F\u52D5\u6E2C\u8A66\u7528 Chrome\u300D\uFF0C\u6216\u624B\u52D5\u4EE5 --remote-debugging-port=9222 \u555F\u52D5\u3002
\u932F\u8AA4\uFF1A${probe.error}`
      );
    }
  }
  const ctrl = new AbortController();
  activeRuns.set(runId, ctrl);
  void (async () => {
    const log = (p) => emit({ type: "agent.log", payload: { runId, ...p } });
    const mcpConfigPath = mode === "attach" ? writeBrowserMcpConfig() : writeMcpConfig(CDP_BROWSER_URL);
    const allowedTools = mode === "attach" ? JT_BROWSER_TOOLS : CHROME_DEVTOOLS_TOOLS;
    const systemPrompt = mode === "attach" ? ATTACH_SYSTEM_PROMPT : SYSTEM_PROMPT;
    log({
      kind: "system",
      text: mode === "attach" ? `\u63A5\u7BA1\u7576\u524D\u5206\u9801\u5C31\u7DD2\uFF08jt-browser \u5DE5\u5177\uFF0C\u7E5E\u958B puppeteer\uFF09\u3002agent=${agentName}` : `Chrome \u5DF2\u9023\u7DDA\uFF1A${probe.version}\uFF08${probe.pages?.length ?? 0} \u500B\u5206\u9801\uFF09\u3002agent=${agentName}`
    });
    const runDir = (0, import_node_path7.join)(ARTIFACTS_DIR, runId);
    (0, import_node_fs7.mkdirSync)(runDir, { recursive: true });
    for (const tc of payload.cases) {
      if (ctrl.signal.aborted) break;
      const startedAt = Date.now();
      emit({ type: "run.step", payload: { runId, tcId: tc.tcId, phase: "start", title: tc.title } });
      const gifPathOut = (0, import_node_path7.join)(runDir, `${tc.tcId}.gif`);
      const gifTmp = (0, import_node_path7.join)(runDir, `.tmp-${tc.tcId}`);
      let recorder = null;
      try {
        if (mode === "attach") {
          recorder = new AttachRecorder(gifPathOut, gifTmp);
          await recorder.start();
        } else {
          const pageWs = await findPageWsUrl(payload.target?.url, CDP_BROWSER_URL);
          if (pageWs) {
            recorder = new ScreencastRecorder(pageWs, gifPathOut, gifTmp);
            await recorder.start();
          } else {
            log({ tcId: tc.tcId, kind: "stderr", text: "\u627E\u4E0D\u5230\u53EF\u9304\u5F71\u7684\u5206\u9801\uFF0C\u7565\u904E\u9304\u5F71" });
          }
        }
      } catch (e) {
        log({ tcId: tc.tcId, kind: "stderr", text: `\u9304\u5F71\u555F\u52D5\u5931\u6557\uFF1A${e.message}` });
        recorder = null;
      }
      const prompt = buildRunPrompt(tc, payload.target);
      let finalText = "";
      try {
        const res = await agent.run({
          prompt,
          systemPrompt,
          cwd: AT_REPO_PATH,
          mcpConfigPath,
          allowedTools,
          model: agentName === "claude" ? CLAUDE_MODEL : void 0,
          signal: ctrl.signal,
          onEvent: (e) => log({ tcId: tc.tcId, kind: e.kind, text: e.text })
        });
        finalText = res.finalText;
      } catch (err) {
        finalText = err instanceof Error ? err.message : String(err);
      }
      if (ctrl.signal.aborted) {
        if (recorder) await recorder.stop().catch(() => {
        });
        log({ tcId: tc.tcId, kind: "system", text: "\u5DF2\u4E2D\u6B62\uFF0C\u7565\u904E\u6B64\u6E2C\u9805\u5831\u544A" });
        break;
      }
      let gifPath;
      if (recorder) {
        try {
          gifPath = await recorder.stop() ?? void 0;
          if (gifPath) log({ tcId: tc.tcId, kind: "system", text: `\u{1F39E} \u5DF2\u7522\u51FA\u9304\u5F71\uFF1A${gifPath}` });
        } catch (e) {
          log({ tcId: tc.tcId, kind: "stderr", text: `\u9304\u5F71\u5408\u6210\u5931\u6557\uFF1A${e.message}` });
        }
      }
      const verdict = parseVerdict(finalText);
      const durationMs = Date.now() - startedAt;
      const gifFileName = gifPath ? `${tc.tcId}.gif` : void 0;
      const mdPath = (0, import_node_path7.join)(runDir, `${tc.tcId}.md`);
      const markdown = writeMarkdown(mdPath, {
        tc,
        status: verdict.status,
        summary: verdict.summary || finalText.slice(0, 200),
        finalText,
        agentName,
        durationMs,
        gifFileName
      });
      const result = {
        runId,
        tcId: tc.tcId,
        status: verdict.status,
        summary: verdict.summary || finalText.slice(0, 200),
        markdown,
        markdownPath: mdPath,
        gifPath,
        gifUrl: gifFileName ? `http://localhost:${BRIDGE_PORT}/artifacts/${runId}/${gifFileName}` : void 0,
        durationMs
      };
      emit({ type: "run.result", payload: result });
    }
    activeRuns.delete(runId);
    emit({ type: "run.done", payload: { runId, cancelled: ctrl.signal.aborted } });
  })();
  return { runId };
}
var import_node_crypto, import_node_fs7, import_node_path7, activeRuns;
var init_runner = __esm({
  "src/runner.ts"() {
    "use strict";
    import_node_crypto = require("node:crypto");
    import_node_fs7 = require("node:fs");
    import_node_path7 = require("node:path");
    init_config();
    init_agents();
    init_mcp();
    init_attach();
    init_prompt();
    init_recorder();
    init_report();
    init_config();
    activeRuns = /* @__PURE__ */ new Map();
  }
});

// src/git.ts
function git(args, cwd = AT_REPO_PATH) {
  return new Promise((resolve4) => {
    const p = (0, import_node_child_process7.spawn)("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => stdout += d.toString());
    p.stderr.on("data", (d) => stderr += d.toString());
    p.on("error", (e) => resolve4({ code: 1, stdout, stderr: stderr + e.message }));
    p.on("close", (code) => resolve4({ code: code ?? 1, stdout, stderr }));
  });
}
async function currentBranch(cwd = AT_REPO_PATH) {
  const r = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return r.stdout.trim();
}
async function changedTestFiles(cwd = AT_REPO_PATH) {
  const r = await git(
    ["status", "--porcelain", "--untracked-files=all", "--", "tests/", "specs/"],
    cwd
  );
  return r.stdout.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
}
async function listUntrackedTestFiles(cwd = AT_REPO_PATH) {
  const r = await git(
    ["status", "--porcelain", "--untracked-files=all", "--", "tests/", "specs/"],
    cwd
  );
  return r.stdout.split("\n").filter((l) => l.startsWith("??")).map((l) => l.slice(3).trim()).filter(Boolean);
}
async function diff(files, cwd = AT_REPO_PATH) {
  const r = await git(["diff", "--", ...files], cwd);
  return r.stdout;
}
async function createCommit(args) {
  const cwd = args.cwd ?? AT_REPO_PATH;
  if (!args.files.length) return { ok: false, branch: await currentBranch(cwd), error: "\u6C92\u6709\u8981\u63D0\u4EA4\u7684\u6A94\u6848" };
  if (args.branch) {
    const co = await git(["checkout", "-b", args.branch], cwd);
    if (co.code !== 0) {
      const co2 = await git(["checkout", args.branch], cwd);
      if (co2.code !== 0) return { ok: false, branch: args.branch, error: co.stderr || co2.stderr };
    }
  }
  const add = await git(["add", "--", ...args.files], cwd);
  if (add.code !== 0) return { ok: false, branch: await currentBranch(cwd), error: add.stderr };
  const commit = await git(["commit", "-m", args.message], cwd);
  const branch = await currentBranch(cwd);
  if (commit.code !== 0) return { ok: false, branch, error: commit.stderr || commit.stdout };
  const hash = (await git(["rev-parse", "HEAD"], cwd)).stdout.trim();
  return { ok: true, branch, hash };
}
async function push(branch, cwd = AT_REPO_PATH) {
  const b = branch ?? await currentBranch(cwd);
  const r = await git(["push", "-u", "origin", b], cwd);
  return { ok: r.code === 0, output: r.stdout + r.stderr };
}
var import_node_child_process7;
var init_git = __esm({
  "src/git.ts"() {
    "use strict";
    import_node_child_process7 = require("node:child_process");
    init_config();
  }
});

// src/exporter.ts
function loadGeneratorSpec() {
  const p = (0, import_node_path8.resolve)(AT_REPO_PATH, GENERATOR_AGENT_FILE);
  if ((0, import_node_fs8.existsSync)(p)) {
    let body = (0, import_node_fs8.readFileSync)(p, "utf8");
    body = body.replace(/^---\n[\s\S]*?\n---\n/, "");
    return "\u4EE5\u4E0B\u662F\u672C\u5C08\u6848\u7684 Playwright \u6E2C\u8A66\u7522\u751F\u5668\u898F\u7BC4\uFF0C\u8ACB\u56B4\u683C\u9075\u5FAA\uFF1A\n\n" + body + "\n\n\uFF08\u8A3B\uFF1A\u82E5\u7121\u6CD5\u4F7F\u7528\u700F\u89BD\u5668/MCP \u6AA2\u8996\u5DE5\u5177\uFF0C\u5247\u4F9D\u6E2C\u8A66\u6848\u4F8B\u8207\u65E2\u6709 locators.py \u751F\u6210\uFF0C\u7121\u6CD5\u78BA\u5B9A\u7684\u9078\u64C7\u5668\u4EE5 TODO \u6A19\u8A3B\u3002\uFF09";
  }
  return FALLBACK_SYSTEM_PROMPT;
}
function cancelExport() {
  if (exportCtrl) {
    exportCtrl.abort();
    exportCtrl = null;
    return true;
  }
  return false;
}
function buildExportPrompt(cases, product) {
  const lines = [];
  lines.push(`\u8ACB\u70BA\u4EE5\u4E0B ${cases.length} \u500B\u6E2C\u8A66\u6848\u4F8B\u7522\u751F pytest \u6E2C\u8A66\u6A94\uFF0C\u7522\u54C1\u7DDA\uFF1A${product}\u3002`);
  lines.push("");
  for (const tc of cases) {
    lines.push(`## ${tc.tcId} ${tc.title}`);
    if (tc.purpose) lines.push(`\u76EE\u7684\uFF1A${tc.purpose}`);
    if (tc.preconditions.length) lines.push(`\u524D\u7F6E\u689D\u4EF6\uFF1A
${tc.preconditions.map((s) => `- ${s}`).join("\n")}`);
    if (tc.steps.length) lines.push(`\u6E2C\u8A66\u6B65\u9A5F\uFF1A
${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
    if (tc.expected.length) lines.push(`\u78BA\u8A8D\u9805\u76EE\uFF1A
${tc.expected.map((s) => `- ${s}`).join("\n")}`);
    lines.push("");
  }
  lines.push(
    [
      "\u8981\u6C42\uFF1A",
      `1. \u4F9D\u7522\u751F\u5668\u898F\u7BC4\u8207 module \u5206\u985E\uFF0C\u5EFA\u7ACB\u6216\u64F4\u5145 tests/${product}/<module>/test_*.py\u3002`,
      "2. \u5148 Read \u898F\u7BC4\u6240\u6307\u5B9A\u7684\u898F\u5247\u6A94\u8207\u76F8\u95DC locators.py / helpers.py / conftest.py \u518D\u52D5\u624B\u3002",
      "3. **\u7522\u751F\u5B8C\u6210\u5F8C\u4E0D\u9700\u57F7\u884C pytest \u6216\u4EFB\u4F55\u9A57\u8B49**\u3002",
      "4. \u6700\u5F8C\u689D\u5217\u4F60\u5EFA\u7ACB/\u4FEE\u6539\u4E86\u54EA\u4E9B\u6A94\u6848\u3002"
    ].join("\n")
  );
  return lines.join("\n");
}
async function exportToPytest(payload, emit) {
  const product = payload.product ?? "pwa";
  const agentName = payload.agent ?? DEFAULT_AGENT;
  const agent = getAgent(agentName);
  if (!await agent.isAvailable()) throw new Error(`agent '${agentName}' \u4E0D\u53EF\u7528`);
  emit({ type: "agent.log", payload: { runId: "export", kind: "system", text: `\u958B\u59CB\u751F\u6210 pytest\uFF08product=${product}, ${payload.cases.length} \u6848\u4F8B\uFF09\u2026` } });
  const beforeUntracked = new Set(await listUntrackedTestFiles());
  const ctrl = new AbortController();
  exportCtrl = ctrl;
  let res;
  try {
    res = await agent.run({
      prompt: buildExportPrompt(payload.cases, product),
      systemPrompt: loadGeneratorSpec(),
      cwd: AT_REPO_PATH,
      model: agentName === "claude" ? CLAUDE_MODEL : void 0,
      signal: ctrl.signal,
      onEvent: (e) => emit({ type: "agent.log", payload: { runId: "export", kind: e.kind, text: e.text } })
    });
  } finally {
    exportCtrl = null;
  }
  if (ctrl.signal.aborted) {
    const created = (await listUntrackedTestFiles()).filter((f) => !beforeUntracked.has(f));
    for (const f of created) {
      try {
        (0, import_node_fs8.rmSync)((0, import_node_path8.resolve)(AT_REPO_PATH, f), { force: true });
      } catch {
      }
    }
    emit({ type: "agent.log", payload: { runId: "export", kind: "system", text: `\u5DF2\u4E2D\u6B62\u532F\u51FA\uFF0C\u5DF2\u79FB\u9664\u672C\u6B21\u65B0\u7522\u751F ${created.length} \u500B\u6A94\u6848` } });
    throw new Error("\u5DF2\u4E2D\u6B62\u532F\u51FA\uFF08\u4E0D\u63A1\u7528\u7522\u51FA\uFF09");
  }
  const files = await changedTestFiles();
  emit({ type: "agent.log", payload: { runId: "export", kind: "system", text: `\u751F\u6210\u5B8C\u6210\uFF0C\u7570\u52D5\u6A94\u6848\uFF1A${files.length} \u500B` } });
  return { files, summary: res.finalText };
}
var import_node_fs8, import_node_path8, GENERATOR_AGENT_FILE, FALLBACK_SYSTEM_PROMPT, exportCtrl;
var init_exporter = __esm({
  "src/exporter.ts"() {
    "use strict";
    import_node_fs8 = require("node:fs");
    import_node_path8 = require("node:path");
    init_config();
    init_agents();
    init_git();
    GENERATOR_AGENT_FILE = ".github/agents/playwright-test-generator.agent.md";
    FALLBACK_SYSTEM_PROMPT = [
      "\u4F60\u662F\u4E00\u500B\u8CC7\u6DF1\u6E2C\u8A66\u5DE5\u7A0B\u5E2B\uFF0C\u628A\u6E2C\u8A66\u6848\u4F8B\u56FA\u5316\u6210\u53EF\u7DAD\u8B77\u7684 pytest \u7A0B\u5F0F\u78BC\uFF0C\u56B4\u683C\u9075\u5B88\u672C\u5C08\u6848 CLAUDE.md \u898F\u7BC4\uFF1A",
      "\u9078\u64C7\u5668\u7528 tests/common/locators.py \u7684 Locators \u985E\u5225\u3001\u91CD\u7528 helpers.py / conftest.py fixtures\u3001",
      "\u6A94\u540D test_<\u529F\u80FD>.py\u3001\u653E\u5C0D tests/<product>/<module>/\u3001Vue SPA \u7528 networkidle + wait_for(visible)\u3002"
    ].join("\n");
    exportCtrl = null;
  }
});

// src/chrome.ts
function pickFolder(prompt = "\u9078\u64C7 automatic-testing \u5C08\u6848\u8CC7\u6599\u593E") {
  return new Promise((resolve4) => {
    const script = `POSIX path of (choose folder with prompt "${prompt.replace(/"/g, '\\"')}")`;
    const p = (0, import_node_child_process8.spawn)("osascript", ["-e", script]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => out += d.toString());
    p.stderr.on("data", (d) => err += d.toString());
    p.on("error", (e) => resolve4({ error: e.message }));
    p.on("close", (code) => {
      if (code === 0 && out.trim()) resolve4({ path: out.trim().replace(/\/+$/, "") });
      else if (/User canceled|cancel/i.test(err)) resolve4({ canceled: true });
      else resolve4({ error: err.trim() || `osascript exit ${code}` });
    });
  });
}
async function waitForCdp(timeoutMs = 15e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = await probeCdp(CDP_BROWSER_URL);
    if (p.ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
async function chromeStatus() {
  const p = await probeCdp(CDP_BROWSER_URL);
  return { running: p.ok, version: p.version, pages: p.pages };
}
async function launchChrome(url = "https://example.com") {
  const existing = await probeCdp(CDP_BROWSER_URL);
  if (existing.ok) return { ok: true, alreadyRunning: true, version: existing.version };
  if (!(0, import_node_fs9.existsSync)(CHROME_BINARY)) {
    return {
      ok: false,
      error: `\u627E\u4E0D\u5230 Chrome \u57F7\u884C\u6A94\uFF1A${CHROME_BINARY}\uFF08\u53EF\u7528\u74B0\u5883\u8B8A\u6578 CHROME_BINARY \u8986\u5BEB\uFF09`
    };
  }
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_USER_DATA_DIR}`,
    "--no-first-run",
    "--no-default-browser-check"
  ];
  if ((0, import_node_fs9.existsSync)(EXTENSION_PATH)) {
    args.push(`--load-extension=${EXTENSION_PATH}`);
  }
  args.push(url);
  const child = (0, import_node_child_process8.spawn)(CHROME_BINARY, args, { detached: true, stdio: "ignore" });
  child.unref();
  const ready = await waitForCdp();
  if (!ready) return { ok: false, error: "Chrome \u5DF2\u555F\u52D5\u4F46 CDP \u5728\u903E\u6642\u5167\u672A\u5C31\u7DD2" };
  const p = await probeCdp(CDP_BROWSER_URL);
  return { ok: true, version: p.version };
}
var import_node_child_process8, import_node_fs9;
var init_chrome = __esm({
  "src/chrome.ts"() {
    "use strict";
    import_node_child_process8 = require("node:child_process");
    import_node_fs9 = require("node:fs");
    init_config();
    init_mcp();
  }
});

// src/server.ts
var server_exports = {};
__export(server_exports, {
  broadcast: () => broadcast
});
function send2(ws2, msg) {
  if (ws2.readyState === ws2.OPEN) ws2.send(JSON.stringify(msg));
}
function broadcast(event) {
  for (const ws2 of clients) send2(ws2, event);
}
async function handleRequest(req) {
  const base = { id: req.id, ok: true };
  try {
    switch (req.type) {
      case "hello":
        return { ...base, result: { server: "jt-testing-ai-agent-bridge", v: "0.1.0" } };
      case "config.describe":
        return {
          ...base,
          result: {
            ...describeConfig(),
            agents: listAgents(),
            availableAgents: await availableAgents()
          }
        };
      case "config.setAtRepo": {
        const { path } = req.payload ?? {};
        if (!path) return { id: req.id, ok: false, error: "\u7F3A\u5C11 path" };
        const exists = (0, import_node_fs10.existsSync)(path);
        saveBridgeConfig({ AT_REPO_PATH: path });
        return {
          ...base,
          result: {
            saved: true,
            path,
            exists,
            needsRestart: path !== AT_REPO_PATH
          }
        };
      }
      case "config.pickFolder":
        return { ...base, result: await pickFolder() };
      case "bridge.shutdown":
        console.log("[bridge] shutdown requested by UI");
        setTimeout(() => process.exit(0), 150);
        return { ...base, result: { stopping: true } };
      case "chrome.launch": {
        const { url } = req.payload ?? {};
        return { ...base, result: await launchChrome(url) };
      }
      case "chrome.status":
        return { ...base, result: await chromeStatus() };
      // 註：Notion 讀取已移至 extension 端直接 fetch（參考 chrome-traslate-compare-plugin），bridge 不再經手。
      case "run.start": {
        const payload = req.payload;
        if (!payload?.cases?.length)
          return { id: req.id, ok: false, error: "\u6C92\u6709\u8981\u57F7\u884C\u7684\u6E2C\u8A66\u6848\u4F8B" };
        const { runId } = await startRun(payload, broadcast);
        return { ...base, result: { runId } };
      }
      case "run.cancel": {
        const { runId } = req.payload ?? {};
        return { ...base, result: { cancelled: runId ? cancelRun(runId) : false } };
      }
      case "export.toPytest": {
        const p = req.payload;
        if (!p?.cases?.length) return { id: req.id, ok: false, error: "\u6C92\u6709\u8981\u532F\u51FA\u7684\u6E2C\u8A66\u6848\u4F8B" };
        const out = await exportToPytest(p, broadcast);
        return { ...base, result: out };
      }
      case "export.cancel":
        return { ...base, result: { cancelled: cancelExport() } };
      case "git.commit": {
        const p = req.payload;
        if (!p?.files?.length) return { id: req.id, ok: false, error: "\u6C92\u6709\u8981\u63D0\u4EA4\u7684\u6A94\u6848" };
        const d = await diff(p.files);
        const commit = await createCommit({
          message: p.message || "test(ai-agent): add generated pytest cases",
          files: p.files,
          branch: p.branch
        });
        return { ...base, result: { ...commit, diff: d } };
      }
      case "git.push": {
        const { branch } = req.payload ?? {};
        return { ...base, result: await push(branch) };
      }
      default:
        return { id: req.id, ok: false, error: `unknown type: ${req.type}` };
    }
  } catch (err) {
    return {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function renderArtifactIndex(dirFsPath, urlPath) {
  const base = urlPath.endsWith("/") ? urlPath : urlPath + "/";
  const entries = (0, import_node_fs10.readdirSync)(dirFsPath, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const isImg = (n) => /\.(gif|jpe?g|png)$/i.test(n);
  const items = entries.map((e) => {
    const href = base + encodeURIComponent(e.name) + (e.isDirectory() ? "/" : "");
    if (e.isDirectory()) return `<div class="item"><a href="${href}">\u{1F4C1} ${e.name}/</a></div>`;
    if (isImg(e.name))
      return `<figure><img src="${href}" loading="lazy" /><figcaption>${e.name}</figcaption></figure>`;
    return `<div class="item"><a href="${href}">\u{1F4C4} ${e.name}</a></div>`;
  }).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>\u622A\u5716 / \u9304\u5F71 \u2014 ${urlPath}</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#1e1e1e;color:#ddd;margin:16px}
  h1{font-size:15px;color:#9cdcfe;font-weight:600}
  .grid{display:flex;flex-wrap:wrap;gap:12px}
  figure{margin:0;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:8px;padding:8px;max-width:320px}
  figure img{max-width:300px;display:block;border-radius:4px}
  figcaption{font-size:12px;color:#aaa;margin-top:6px;word-break:break-all}
  .item{padding:4px 0}a{color:#4fc1ff}
</style>
<h1>${urlPath}</h1><div class="grid">${items || "<p>\uFF08\u6B64\u76EE\u9304\u6C92\u6709\u6A94\u6848\uFF09</p>"}</div>`;
}
var import_node_fs10, import_node_http, import_node_path9, clients, MIME, http, appWss, relayWss, agentCdpWss;
var init_server = __esm({
  "src/server.ts"() {
    "use strict";
    import_node_fs10 = require("node:fs");
    import_node_http = require("node:http");
    import_node_path9 = require("node:path");
    init_wrapper();
    init_config();
    init_runner();
    init_agents();
    init_exporter();
    init_git();
    init_chrome();
    init_attach();
    loadAtEnv();
    clients = /* @__PURE__ */ new Set();
    MIME = {
      ".gif": "image/gif",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".md": "text/markdown; charset=utf-8",
      ".webm": "video/webm"
    };
    http = (0, import_node_http.createServer)((req, res) => {
      const url = req.url ?? "/";
      if (url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...describeConfig() }));
        return;
      }
      if (url.startsWith("/artifacts/")) {
        const rel = (0, import_node_path9.normalize)(decodeURIComponent(url.slice("/artifacts/".length)));
        if (rel.includes("..")) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        const file = (0, import_node_path9.join)(ARTIFACTS_DIR, rel);
        if (!(0, import_node_fs10.existsSync)(file)) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        if ((0, import_node_fs10.statSync)(file).isDirectory()) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(renderArtifactIndex(file, url));
          return;
        }
        res.writeHead(200, {
          "content-type": MIME[(0, import_node_path9.extname)(file)] ?? "application/octet-stream",
          "access-control-allow-origin": "*"
        });
        (0, import_node_fs10.createReadStream)(file).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    appWss = new import_websocket_server.default({ noServer: true });
    relayWss = new import_websocket_server.default({ noServer: true });
    agentCdpWss = new import_websocket_server.default({ noServer: true });
    http.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "";
      if (url === "/cdp-relay") {
        relayWss.handleUpgrade(req, socket, head, (ws2) => relayWss.emit("connection", ws2, req));
      } else if (url === "/agent-cdp") {
        agentCdpWss.handleUpgrade(req, socket, head, (ws2) => agentCdpWss.emit("connection", ws2, req));
      } else {
        appWss.handleUpgrade(req, socket, head, (ws2) => appWss.emit("connection", ws2, req));
      }
    });
    relayWss.on("connection", (ws2) => {
      console.log("[bridge] cdp-relay connected\uFF08extension debugger \u6A4B\u63A5\uFF09");
      tabRelay.attachSocket(ws2);
    });
    agentCdpWss.on("connection", (ws2) => {
      console.log("[bridge] agent-cdp connected\uFF08browser-mcp \u6A4B\u63A5\uFF09");
      ws2.on("message", async (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!msg.method) return;
        const r = await tabRelay.sendCommand(msg.method, msg.params ?? {});
        if (ws2.readyState === ws2.OPEN)
          ws2.send(JSON.stringify({ id: msg.id, result: r.result, error: r.error }));
      });
    });
    appWss.on("connection", (ws2) => {
      clients.add(ws2);
      console.log(`[bridge] client connected (${clients.size} total)`);
      ws2.on("message", async (data) => {
        let req;
        try {
          req = JSON.parse(data.toString());
        } catch {
          send2(ws2, { type: "error", payload: { error: "invalid JSON" } });
          return;
        }
        const res = await handleRequest(req);
        send2(ws2, res);
      });
      ws2.on("close", () => {
        clients.delete(ws2);
        console.log(`[bridge] client disconnected (${clients.size} total)`);
      });
    });
    http.listen(BRIDGE_PORT, () => {
      console.log(`[bridge] listening on http://localhost:${BRIDGE_PORT}`);
      console.table(describeConfig());
    });
  }
});

// sea/entry.mjs
process.env.JT_PACKAGED = "1";
if (/(^|\/)node\d*$/.test(process.execPath) && process.argv[1]) {
  process.env.JT_BRIDGE_SCRIPT = process.argv[1];
}
var argv = process.argv;
if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write("jt-bridge 1.0.0\n");
  process.exit(0);
} else if (argv.includes("--browser-mcp")) {
  Promise.resolve().then(() => init_browser_mcp());
} else if (argv.includes("--native-host")) {
  Promise.resolve().then(() => init_native_host());
} else {
  process.env.JT_BRIDGE_BIN = process.execPath;
  Promise.resolve().then(() => init_server());
}
