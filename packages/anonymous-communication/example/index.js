import AnonymousCommunication from '../src/index.js';

// const ENDPOINT_URL = 'https://collector-hpn.ghostery.net';
const ENDPOINT_URL = 'http://localhost:3001';

const ALIVE_MESSAGE = {
  'action': 'wtm.alive',
  'ver': '1',
  'payload': {
    't': '2022092912', // YYYYMMDDHH
    'ctry': 'it',
  },
};

const storage = {
  storage: {},
  async get(key) {
    return this.storage[key];
  },
  async set(key, value) {
    this.storage[key] = value;
  },
};

(async function () {
  try {
    let communication = new AnonymousCommunication({
      config: {
        COLLECTOR_DIRECT_URL: ENDPOINT_URL,
        COLLECTOR_PROXY_URL: ENDPOINT_URL,
        CHANNEL: 'safari',
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
