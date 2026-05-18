/**
 * R307 / FPM10A / ZFM-20 fingerprint sensor driver (the "ZhiAn" protocol).
 *
 * Speaks the canonical packet format used by the Hangzhou-Synochip /
 * Adafruit fingerprint family. All commands are wrapped in:
 *
 *   header (0xEF 0x01) | address (4B BE) | PID (1B) | length (2B BE) | payload | checksum (2B BE)
 *
 * where the checksum is the low 16 bits of (PID + length-bytes + payload-bytes).
 *
 * The driver is intentionally minimal: enough surface to enroll a finger,
 * search the on-sensor template store, read the index table, and upload
 * the raw characteristic bytes for off-device hashing. Anything more
 * (fast search, capacitance tuning, encryption mode toggles) is product
 * work and lives downstream of this PR.
 *
 * Threat model context:
 *   - Raw fingerprint bytes never leave the host. We upload the
 *     CHARACTERISTIC (an opaque template — fingerprint minutiae or
 *     feature vector, not an image) so the host can hash it locally
 *     and forward only the commitment.
 *   - The sensor's own template store still holds the characteristic,
 *     so resetting / wiping is part of the operational story.
 */

import { SerialPort } from 'serialport';

// ─── Constants ────────────────────────────────────────────────────────────

export const PACKET_HEADER = 0xef01;
export const DEFAULT_ADDRESS = 0xffffffff;
export const DEFAULT_PASSWORD = 0x00000000;

/** Packet identifier byte. */
export const PID = {
  COMMAND: 0x01,
  DATA: 0x02,
  ACK: 0x07,
  END_DATA: 0x08,
} as const;

/** Command opcodes — selected subset. */
export const CMD = {
  GET_IMAGE: 0x01,
  IMG_TO_TZ: 0x02,
  MATCH: 0x03,
  SEARCH: 0x04,
  REG_MODEL: 0x05,
  STORE: 0x06,
  LOAD_CHAR: 0x07,
  UP_CHAR: 0x08,
  DOWN_CHAR: 0x09,
  UP_IMAGE: 0x0a,
  DELETE_CHAR: 0x0c,
  EMPTY: 0x0d,
  SET_PASSWORD: 0x12,
  VERIFY_PASSWORD: 0x13,
  GET_RANDOM: 0x14,
  GET_SYS_PARAMS: 0x0f,
  TEMPLATE_COUNT: 0x1d,
  READ_INDEX_TABLE: 0x1f,
  HANDSHAKE: 0x40,
} as const;

/** Confirmation codes — the first byte of an ACK payload. */
export const CONF = {
  OK: 0x00,
  PACKET_RECV_ERR: 0x01,
  NO_FINGER: 0x02,
  ENROLL_FAIL: 0x03,
  TOO_FUZZY: 0x06,
  TOO_FEW_FEATURE: 0x07,
  NOT_MATCH: 0x08,
  NO_MATCH_FOUND: 0x09,
  COMBINE_FAIL: 0x0a,
  ADDRESSING_PAGEID_OOR: 0x0b,
  READ_TEMPLATE_FAIL: 0x0c,
  UPLOAD_FAIL: 0x0d,
  RECEIVE_FAIL: 0x0e,
  DELETE_FAIL: 0x10,
  CLEAR_FAIL: 0x11,
  BAUD_INVALID: 0x1a,
  PASSWORD_INCORRECT: 0x13,
  INVALID_REGISTER: 0x1a,
  FLASH_FAIL: 0x18,
} as const;

export interface SystemParams {
  statusRegister: number;
  systemIdentifier: number;
  templateLibrarySize: number;
  securityLevel: number;
  deviceAddress: number;
  packetSize: number; // 32 / 64 / 128 / 256 bytes
  baudRate: number;
}

export interface SearchResult {
  pageId: number;
  matchScore: number;
}

// ─── Codec ────────────────────────────────────────────────────────────────

function buildPacket(pid: number, payload: Buffer, address = DEFAULT_ADDRESS): Buffer {
  const length = payload.length + 2; // payload + checksum
  const header = Buffer.alloc(2);
  header.writeUInt16BE(PACKET_HEADER, 0);

  const addr = Buffer.alloc(4);
  addr.writeUInt32BE(address >>> 0, 0);

  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(length, 0);

  let checksum = pid + lenBuf[0]! + lenBuf[1]!;
  for (const b of payload) checksum += b;
  const ckBuf = Buffer.alloc(2);
  ckBuf.writeUInt16BE(checksum & 0xffff, 0);

  return Buffer.concat([header, addr, Buffer.from([pid]), lenBuf, payload, ckBuf]);
}

interface ParsedPacket {
  address: number;
  pid: number;
  payload: Buffer;
}

/**
 * Greedy packet parser. Reads bytes from `buf` starting at `offset` and
 * returns the first complete packet found, with the new offset. Returns
 * null if there aren't enough bytes yet for a complete packet.
 */
function tryParsePacket(buf: Buffer, offset: number): { packet: ParsedPacket; nextOffset: number } | null {
  // Find the header
  while (offset + 1 < buf.length && buf.readUInt16BE(offset) !== PACKET_HEADER) {
    offset += 1;
  }
  if (offset + 9 > buf.length) return null; // need at least header(2)+addr(4)+pid(1)+len(2)

  const address = buf.readUInt32BE(offset + 2);
  const pid = buf.readUInt8(offset + 6);
  const length = buf.readUInt16BE(offset + 7);
  const totalSize = 9 + length;
  if (offset + totalSize > buf.length) return null;

  const payload = buf.subarray(offset + 9, offset + 9 + length - 2);
  // (We could verify the checksum here; the sensor is reliable on a wired
  // UART so we trust it and let downstream parsers fail loudly if not.)
  return {
    packet: { address, pid, payload },
    nextOffset: offset + totalSize,
  };
}

// ─── Driver ───────────────────────────────────────────────────────────────

export interface SensorOptions {
  path: string;
  baudRate?: number;
  address?: number;
  password?: number;
  /** Maximum time to wait for a single packet, in ms. */
  packetTimeoutMs?: number;
  /** Maximum time to wait for the user's finger between prompts. */
  fingerTimeoutMs?: number;
}

export class R307Sensor {
  private port: SerialPort;
  private buffer = Buffer.alloc(0);
  private waiters: Array<{ resolve: (p: ParsedPacket) => void; reject: (e: Error) => void; deadline: number }> = [];
  private readonly address: number;
  private readonly password: number;
  private readonly packetTimeoutMs: number;
  private readonly fingerTimeoutMs: number;

  constructor(opts: SensorOptions) {
    this.address = opts.address ?? DEFAULT_ADDRESS;
    this.password = opts.password ?? DEFAULT_PASSWORD;
    this.packetTimeoutMs = opts.packetTimeoutMs ?? 3000;
    this.fingerTimeoutMs = opts.fingerTimeoutMs ?? 15000;
    this.port = new SerialPort({
      path: opts.path,
      baudRate: opts.baudRate ?? 57600,
      autoOpen: false,
    });
    this.port.on('data', (chunk: Buffer) => this.onData(chunk));
    this.port.on('error', (err: Error) => {
      for (const w of this.waiters) w.reject(err);
      this.waiters = [];
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const result = tryParsePacket(this.buffer, 0);
      if (!result) break;
      this.buffer = this.buffer.subarray(result.nextOffset);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(result.packet);
    }
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.open((err) => (err ? reject(err) : resolve()));
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port.isOpen) {
        resolve();
        return;
      }
      this.port.close(() => resolve());
    });
  }

  private writeRaw(buf: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.write(buf, (err) => (err ? reject(err) : resolve()));
      this.port.drain((err) => (err ? reject(err) : undefined));
    });
  }

  private readPacket(timeoutMs = this.packetTimeoutMs): Promise<ParsedPacket> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const waiter = { resolve, reject, deadline };
      this.waiters.push(waiter);
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`Timeout waiting for sensor packet (${timeoutMs}ms)`));
      }, timeoutMs);
      const origResolve = waiter.resolve;
      waiter.resolve = (p) => {
        clearTimeout(t);
        origResolve(p);
      };
    });
  }

  /** Send a command and read the ACK. Throws on non-OK confirmation. */
  private async cmd(opcode: number, args: Buffer = Buffer.alloc(0), timeoutMs?: number): Promise<Buffer> {
    const payload = Buffer.concat([Buffer.from([opcode]), args]);
    await this.writeRaw(buildPacket(PID.COMMAND, payload, this.address));
    const ack = await this.readPacket(timeoutMs ?? this.packetTimeoutMs);
    if (ack.pid !== PID.ACK) {
      throw new Error(`Expected ACK packet, got pid=0x${ack.pid.toString(16)}`);
    }
    return ack.payload;
  }

  /** Verify the 4-byte password — first call after opening the port. */
  async verifyPassword(password = this.password): Promise<boolean> {
    const args = Buffer.alloc(4);
    args.writeUInt32BE(password >>> 0, 0);
    const ack = await this.cmd(CMD.VERIFY_PASSWORD, args);
    return ack.readUInt8(0) === CONF.OK;
  }

  async getSystemParams(): Promise<SystemParams> {
    const ack = await this.cmd(CMD.GET_SYS_PARAMS);
    if (ack.readUInt8(0) !== CONF.OK) {
      throw new Error(`get_sys_params confirmation=0x${ack.readUInt8(0).toString(16)}`);
    }
    // Payload after the OK byte: 16 bytes of parameters (big-endian shorts).
    return {
      statusRegister: ack.readUInt16BE(1),
      systemIdentifier: ack.readUInt16BE(3),
      templateLibrarySize: ack.readUInt16BE(5),
      securityLevel: ack.readUInt16BE(7),
      deviceAddress: ack.readUInt32BE(9),
      packetSize: 32 << ack.readUInt16BE(13), // 0→32, 1→64, 2→128, 3→256
      baudRate: ack.readUInt16BE(15) * 9600,
    };
  }

  async getTemplateCount(): Promise<number> {
    const ack = await this.cmd(CMD.TEMPLATE_COUNT);
    if (ack.readUInt8(0) !== CONF.OK) {
      throw new Error(`template_count confirmation=0x${ack.readUInt8(0).toString(16)}`);
    }
    return ack.readUInt16BE(1);
  }

  /**
   * Returns the list of slot indices that currently hold a template.
   * The sensor returns 32 bytes per page (one bit per slot), so we
   * decode all `templateLibrarySize` bits across one or two pages.
   */
  async readIndexTable(librarySize = 1000): Promise<number[]> {
    const slots: number[] = [];
    const pages = Math.ceil(librarySize / 256);
    for (let page = 0; page < pages; page++) {
      const ack = await this.cmd(CMD.READ_INDEX_TABLE, Buffer.from([page]));
      if (ack.readUInt8(0) !== CONF.OK) {
        throw new Error(`read_index_table page=${page} confirmation=0x${ack.readUInt8(0).toString(16)}`);
      }
      const bitmap = ack.subarray(1); // 32 bytes
      for (let byteIdx = 0; byteIdx < bitmap.length; byteIdx++) {
        for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
          if ((bitmap[byteIdx]! >> bitIdx) & 1) {
            slots.push(page * 256 + byteIdx * 8 + bitIdx);
          }
        }
      }
    }
    return slots;
  }

  /**
   * Wait for a finger to settle on the sensor. Polls GetImage every 200ms
   * until it returns OK or the per-call timeout elapses.
   */
  async waitForFinger(): Promise<void> {
    const deadline = Date.now() + this.fingerTimeoutMs;
    while (Date.now() < deadline) {
      const ack = await this.cmd(CMD.GET_IMAGE);
      const conf = ack.readUInt8(0);
      if (conf === CONF.OK) return;
      if (conf === CONF.NO_FINGER) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw new Error(`get_image confirmation=0x${conf.toString(16)}`);
    }
    throw new Error(`Finger not detected within ${this.fingerTimeoutMs}ms`);
  }

  /** Wait for the finger to be REMOVED. */
  async waitForFingerRemoval(): Promise<void> {
    const deadline = Date.now() + this.fingerTimeoutMs;
    while (Date.now() < deadline) {
      const ack = await this.cmd(CMD.GET_IMAGE);
      const conf = ack.readUInt8(0);
      if (conf === CONF.NO_FINGER) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Finger not removed within ${this.fingerTimeoutMs}ms`);
  }

  /** Convert the captured image to a characteristic file in buffer 1 or 2. */
  async imageToCharBuffer(buffer: 1 | 2): Promise<void> {
    const ack = await this.cmd(CMD.IMG_TO_TZ, Buffer.from([buffer]));
    const conf = ack.readUInt8(0);
    if (conf !== CONF.OK) {
      throw new Error(`img_to_tz buffer=${buffer} confirmation=0x${conf.toString(16)}`);
    }
  }

  /** Combine buffer 1 + buffer 2 into a template stored in BOTH buffers. */
  async combineToTemplate(): Promise<void> {
    const ack = await this.cmd(CMD.REG_MODEL);
    const conf = ack.readUInt8(0);
    if (conf !== CONF.OK) {
      throw new Error(`reg_model confirmation=0x${conf.toString(16)}`);
    }
  }

  /** Persist the template currently in buffer 1 into the on-sensor slot. */
  async storeTemplate(slot: number, buffer: 1 | 2 = 1): Promise<void> {
    const args = Buffer.alloc(3);
    args.writeUInt8(buffer, 0);
    args.writeUInt16BE(slot, 1);
    const ack = await this.cmd(CMD.STORE, args);
    const conf = ack.readUInt8(0);
    if (conf !== CONF.OK) {
      throw new Error(`store slot=${slot} confirmation=0x${conf.toString(16)}`);
    }
  }

  /**
   * 1:N search against the on-sensor template store using the
   * characteristic in buffer 1.
   */
  async search(startSlot = 0, count = 1000, buffer: 1 | 2 = 1): Promise<SearchResult | null> {
    const args = Buffer.alloc(5);
    args.writeUInt8(buffer, 0);
    args.writeUInt16BE(startSlot, 1);
    args.writeUInt16BE(count, 3);
    const ack = await this.cmd(CMD.SEARCH, args);
    const conf = ack.readUInt8(0);
    if (conf === CONF.NO_MATCH_FOUND) return null;
    if (conf !== CONF.OK) {
      throw new Error(`search confirmation=0x${conf.toString(16)}`);
    }
    return {
      pageId: ack.readUInt16BE(1),
      matchScore: ack.readUInt16BE(3),
    };
  }

  /**
   * Upload the characteristic bytes from sensor buffer N to the host.
   * Returns the concatenated payload of all the data packets the sensor
   * sends after the ACK.
   *
   * The packet size used here is whatever the sensor reports in
   * GetSystemParams (32/64/128/256). We don't insist on a particular
   * total length — for R307 it's typically 512 bytes — and let the
   * sensor flag the last packet with PID=0x08 (END_DATA).
   */
  async uploadCharacteristic(buffer: 1 | 2 = 1): Promise<Buffer> {
    const ack = await this.cmd(CMD.UP_CHAR, Buffer.from([buffer]));
    const conf = ack.readUInt8(0);
    if (conf !== CONF.OK) {
      throw new Error(`up_char confirmation=0x${conf.toString(16)}`);
    }

    const chunks: Buffer[] = [];
    while (true) {
      const pkt = await this.readPacket(this.packetTimeoutMs);
      if (pkt.pid !== PID.DATA && pkt.pid !== PID.END_DATA) {
        throw new Error(`Expected DATA/END_DATA, got pid=0x${pkt.pid.toString(16)}`);
      }
      chunks.push(pkt.payload);
      if (pkt.pid === PID.END_DATA) break;
    }
    return Buffer.concat(chunks);
  }

  /** Delete a single stored template. */
  async deleteTemplate(slot: number): Promise<void> {
    const args = Buffer.alloc(4);
    args.writeUInt16BE(slot, 0);
    args.writeUInt16BE(1, 2); // count = 1
    const ack = await this.cmd(CMD.DELETE_CHAR, args);
    const conf = ack.readUInt8(0);
    if (conf !== CONF.OK) {
      throw new Error(`delete slot=${slot} confirmation=0x${conf.toString(16)}`);
    }
  }

  /** Wipe the entire on-sensor template library. */
  async emptyDatabase(): Promise<void> {
    const ack = await this.cmd(CMD.EMPTY);
    const conf = ack.readUInt8(0);
    if (conf !== CONF.OK) {
      throw new Error(`empty confirmation=0x${conf.toString(16)}`);
    }
  }

  /** Ask the sensor for a random 32-bit number — useful as a host-side nonce. */
  async getRandom(): Promise<number> {
    const ack = await this.cmd(CMD.GET_RANDOM);
    if (ack.readUInt8(0) !== CONF.OK) {
      throw new Error(`get_random confirmation=0x${ack.readUInt8(0).toString(16)}`);
    }
    return ack.readUInt32BE(1);
  }
}
