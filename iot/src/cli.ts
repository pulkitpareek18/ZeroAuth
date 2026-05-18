/**
 * CLI for the R307 fingerprint terminal driver.
 *
 * Usage:
 *   npm --prefix iot run info                  -- read sensor params + slot occupancy
 *   npm --prefix iot run enroll -- <slot>      -- two-capture enrollment + on-sensor store
 *   npm --prefix iot run search                -- single capture + 1:N match
 *   npm --prefix iot run capture               -- single capture + upload characteristic + SHA-256
 *   npm --prefix iot run wipe                  -- empty the entire on-sensor template library
 *
 * Environment overrides:
 *   ZA_IOT_PORT      serial path (default: /dev/cu.usbserial-0001)
 *   ZA_IOT_BAUD      baud rate (default: 57600)
 *   ZA_IOT_PASSWORD  4-byte hex password (default: 00000000)
 *
 * Threat-model notes:
 *   - The raw fingerprint image never crosses this process. We read the
 *     CHARACTERISTIC bytes (an opaque template, ~512 bytes for R307) via
 *     the sensor's UpChar command, hash them locally, and only ever
 *     surface the hex digest.
 *   - The on-sensor template store is the persistence layer here. In the
 *     production ZeroAuth terminal that store gets wiped on every reboot
 *     and replaced with a per-tenant view fetched over a mutual-TLS
 *     channel; that work isn't in this script.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { R307Sensor } from './sensor.js';

const PORT = process.env.ZA_IOT_PORT ?? '/dev/cu.usbserial-0001';
const BAUD = Number.parseInt(process.env.ZA_IOT_BAUD ?? '57600', 10);
const PASSWORD = Number.parseInt(process.env.ZA_IOT_PASSWORD ?? '0', 16);

function bold(s: string): string { return `\x1b[1m${s}\x1b[0m`; }
function dim(s: string): string { return `\x1b[2m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }
function red(s: string): string { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[0m`; }

async function withSensor<T>(run: (s: R307Sensor) => Promise<T>): Promise<T> {
  const sensor = new R307Sensor({ path: PORT, baudRate: BAUD, password: PASSWORD });
  console.log(dim(`opening ${PORT} @ ${BAUD} baud…`));
  await sensor.open();
  console.log(dim(`verifying password 0x${PASSWORD.toString(16).padStart(8, '0')}…`));
  const ok = await sensor.verifyPassword();
  if (!ok) {
    await sensor.close();
    throw new Error('Password verification failed. Set ZA_IOT_PASSWORD if the sensor uses a non-default password.');
  }
  try {
    return await run(sensor);
  } finally {
    await sensor.close();
  }
}

async function cmdInfo(): Promise<void> {
  await withSensor(async (sensor) => {
    const params = await sensor.getSystemParams();
    const count = await sensor.getTemplateCount();
    const slots = await sensor.readIndexTable(params.templateLibrarySize);

    console.log(bold('Sensor params:'));
    console.log(`  ${dim('status register   ')} 0x${params.statusRegister.toString(16).padStart(4, '0')}`);
    console.log(`  ${dim('system identifier ')} 0x${params.systemIdentifier.toString(16).padStart(4, '0')}`);
    console.log(`  ${dim('library size      ')} ${params.templateLibrarySize} slots`);
    console.log(`  ${dim('security level    ')} ${params.securityLevel} (1=easy ↔ 5=strict)`);
    console.log(`  ${dim('device address    ')} 0x${params.deviceAddress.toString(16).padStart(8, '0')}`);
    console.log(`  ${dim('packet size       ')} ${params.packetSize} bytes`);
    console.log(`  ${dim('baud rate         ')} ${params.baudRate}`);
    console.log();
    console.log(bold('Templates stored:'));
    console.log(`  ${dim('count             ')} ${count}`);
    if (slots.length === 0) {
      console.log(`  ${dim('occupied slots    ')} ${yellow('(none — factory fresh)')}`);
    } else {
      const preview = slots.slice(0, 16).map((s) => s.toString()).join(', ');
      const trailer = slots.length > 16 ? `, … (${slots.length - 16} more)` : '';
      console.log(`  ${dim('occupied slots    ')} ${preview}${trailer}`);
    }
  });
}

async function prompt(line: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  await rl.question(line);
  rl.close();
}

async function cmdEnroll(slotArg?: string): Promise<void> {
  const slot = slotArg !== undefined ? Number.parseInt(slotArg, 10) : 0;
  if (!Number.isFinite(slot) || slot < 0) {
    throw new Error(`Invalid slot: "${slotArg}". Must be a non-negative integer.`);
  }
  await withSensor(async (sensor) => {
    const before = await sensor.readIndexTable();
    if (before.includes(slot)) {
      console.log(yellow(`Slot ${slot} already has a template. Overwriting.`));
    }

    console.log(bold(`Enrolling at slot ${slot}.`));
    console.log(dim('Step 1/2 — place finger on the sensor…'));
    await sensor.waitForFinger();
    await sensor.imageToCharBuffer(1);
    console.log(green('  ✓ first scan captured'));
    console.log(dim('  remove finger…'));
    await sensor.waitForFingerRemoval();

    console.log(dim('Step 2/2 — place the SAME finger again…'));
    await sensor.waitForFinger();
    await sensor.imageToCharBuffer(2);
    console.log(green('  ✓ second scan captured'));

    console.log(dim('Combining scans into a template…'));
    await sensor.combineToTemplate();

    console.log(dim(`Storing template at slot ${slot}…`));
    await sensor.storeTemplate(slot);
    console.log(green(`  ✓ stored`));

    // Read the characteristic for a commitment preview. This is what the
    // production firmware would feed to the Pramaan fuzzy extractor +
    // Poseidon — here we just SHA-256 it so the operator can see the
    // pipeline is wired.
    const characteristic = await sensor.uploadCharacteristic(1);
    const commitment = createHash('sha256').update(characteristic).digest('hex');
    console.log();
    console.log(bold('Enrolled.'));
    console.log(`  ${dim('slot           ')} ${slot}`);
    console.log(`  ${dim('characteristic ')} ${characteristic.length} bytes`);
    console.log(`  ${dim('sha-256(char)  ')} ${commitment}`);
    console.log();
    console.log(dim(`This SHA-256 is a placeholder commitment. The production`));
    console.log(dim(`flow runs the characteristic through a fuzzy extractor`));
    console.log(dim(`then Poseidon → BN128 scalar. Different scans of the`));
    console.log(dim(`same finger produce different SHA-256s; that's expected.`));
  });
}

async function cmdSearch(): Promise<void> {
  await withSensor(async (sensor) => {
    console.log(bold('Matching against on-sensor templates.'));
    console.log(dim('Place finger on sensor…'));
    await sensor.waitForFinger();
    await sensor.imageToCharBuffer(1);
    console.log(green('  ✓ captured'));

    const result = await sensor.search();
    if (!result) {
      console.log(red('  ✗ no match found'));
      return;
    }
    console.log(green(`  ✓ match: slot ${result.pageId}, score ${result.matchScore}`));
  });
}

async function cmdCapture(): Promise<void> {
  await withSensor(async (sensor) => {
    const eventId = randomUUID();
    console.log(bold('Single-capture + characteristic upload.'));
    console.log(`  ${dim('event id        ')} ${eventId}`);
    console.log(dim('Place finger on sensor…'));
    await sensor.waitForFinger();
    await sensor.imageToCharBuffer(1);
    const characteristic = await sensor.uploadCharacteristic(1);
    const commitment = createHash('sha256').update(characteristic).digest('hex');
    console.log(green('  ✓ captured + uploaded'));
    console.log(`  ${dim('characteristic  ')} ${characteristic.length} bytes`);
    console.log(`  ${dim('sha-256(char)   ')} ${commitment}`);
    console.log(`  ${dim('first 32 bytes  ')} ${characteristic.subarray(0, 32).toString('hex')}…`);
  });
}

async function cmdWipe(): Promise<void> {
  await prompt(yellow('Wipe ALL templates on the sensor? Press Enter to confirm, Ctrl-C to cancel. '));
  await withSensor(async (sensor) => {
    await sensor.emptyDatabase();
    console.log(green('  ✓ template library cleared'));
  });
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  try {
    switch (command) {
      case 'info':
        await cmdInfo();
        break;
      case 'enroll':
        await cmdEnroll(rest[0]);
        break;
      case 'search':
        await cmdSearch();
        break;
      case 'capture':
        await cmdCapture();
        break;
      case 'wipe':
        await cmdWipe();
        break;
      default:
        console.error(`Usage: cli <info|enroll [slot]|search|capture|wipe>`);
        process.exit(2);
    }
  } catch (err) {
    console.error(red(`✗ ${(err as Error).message}`));
    process.exit(1);
  }
}

void main();
