/**
 * Module-level singletons for the CLI bridge and capability layer.
 * Imported by both handlers.ts and the main/index.ts bootstrap.
 */

import { AFFiNECapability } from '../affine-capability/index';
import type { AffineLocalServer } from '../affine-capability/local-server';
import { CLIBridge } from './index';

export const cliBridge = new CLIBridge();
export const affineCapability = new AFFiNECapability();

cliBridge.setCapability(affineCapability);

/** Mutable reference to the local REST server, set by main/index.ts after start. */
export const localServerRef: { current: AffineLocalServer | null } = {
  current: null,
};
