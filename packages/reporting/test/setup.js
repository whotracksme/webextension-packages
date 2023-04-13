import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';
/**
 * reporting.spec.js has a tendency to fail due to cssom
 * race condition during commonjs module init
 */
import 'cssom';

import { setLogLevel } from '../src/logger.js';

chai.use(chaiAsPromised);
chai.use(sinonChai);

setLogLevel('off');
