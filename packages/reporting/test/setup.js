import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';
import chrome from 'sinon-chrome';

/**
 * reporting.spec.js has a tendency to fail due to cssom
 * race condition during commonjs module init
 */
import 'cssom';

import { setLogLevel } from '../src/logger.js';
import { eventListenerQueue } from '../src/pages.js';

chai.use(chaiAsPromised);
chai.use(sinonChai);

setLogLevel('off');

window.chrome = chrome;

// This global object installs a timeout, which will confuse tests that mock
// timers. By immediately closing it, the native timer will be cleared.
eventListenerQueue.close();
