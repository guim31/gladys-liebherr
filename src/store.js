// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container):
//   - the appliances last read (device and controls, as the HomeAPI gave
//     them): an appliance that is offline when the integration starts — a
//     power cut — drops out of the HomeAPI list, and must stay in the
//     Discovery tab with its features;
//   - the alarm state, so a restart neither forgets an alarm in progress nor
//     announces it a second time.
// Never the API key: it lives in the Gladys configuration.
// Losing the file is harmless: everything is read again.
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'liebherr-store' });
const FILE_NAME = 'liebherr-state.json';

export class Store {
  constructor(directory = process.env.LIEBHERR_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.pending = null;
    this.writing = null;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      return {};
    }
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save(data) {
    this.latest = data;
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, JSON.stringify(snapshot));
          await rename(temporary, this.path);
        } catch (err) {
          logger.warn(`Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  async flush() {
    while (this.writing) {
      const current = this.writing;
      await current;
      if (this.writing === current) {
        this.writing = null;
      }
    }
  }
}
