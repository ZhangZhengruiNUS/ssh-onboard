import { rm } from 'node:fs/promises';

await Promise.all(
  ['artifacts', 'coverage', 'dist', 'out'].map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ),
);
