import AnonymousCommunication from '../src/index.js';
import Storage from '../src/storage.js';
import {
  getTimeAsYYYYMMDDHH,
  getTimeAsYYYYMMDD,
  getTrustedUtcTime,
} from '../src/timestamps.js';

// const ENDPOINT_URL = 'https://collector-hpn.ghostery.net';
const ENDPOINT_URL = 'http://localhost:3001';

const now = getTrustedUtcTime();
const ALIVE_MESSAGE = {
  'action': 'wtm.alive',
  'ver': '1',
  'channel': 'safari',
  'ts': getTimeAsYYYYMMDD(now),
  'payload': { 't': getTimeAsYYYYMMDDHH(now), 'ctry': 'it' },
};

(async function () {
  try {
    const storage = new Storage();
    await storage.init();
    let communication = new AnonymousCommunication({
      config: {
        COLLECTOR_DIRECT_URL: ENDPOINT_URL,
        COLLECTOR_PROXY_URL: ENDPOINT_URL,
      },
      storage,
    });

    setInterval(async () => {
      await communication.send(ALIVE_MESSAGE);
      console.log('alive', ALIVE_MESSAGE);
    }, 3000);
  } catch (e) {
    console.error(e);
  }
})();
