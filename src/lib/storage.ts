import {resolve} from 'node:path';
// Electron supplies the OS-specific userData directory; CLI uses an isolated local directory.
export const dataDirectory=resolve(/* turbopackIgnore: true */ process.env.KNITTING_DATA_DIR||'data/local');
export const photosDirectory=resolve(dataDirectory,'photos');
export const databasePath=resolve(dataDirectory,'workshop.sqlite');
