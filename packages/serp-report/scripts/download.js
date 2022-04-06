import { writeFileSync } from 'fs';
import { URL } from 'url';
import { resolve } from 'path';
import fetch from 'node-fetch';

const DATA_URL = 'https://whotracks.me/data/trackers-preview.json';
const OUTPUT_FILE = new URL(
  '../src/background/trackers-preview.json',
  import.meta.url,
).pathname;

const data = await fetch(DATA_URL).then(
  (res) => (res.ok ? res.text() : ''),
  () => '',
);

writeFileSync(
  OUTPUT_FILE,
  data || JSON.stringify({ trackers: {}, categories: [] }),
);

console.log(
  `Trackers preview data ${
    data ? 'downloaded' : "couldn't be downloaded - empty list was generated"
  } and saved in "${OUTPUT_FILE.replace(process.cwd(), '.')}"`,
);
