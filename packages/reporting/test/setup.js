import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';

import { setLogLevel } from '../src/logger.js';

chai.use(chaiAsPromised);
chai.use(sinonChai);

setLogLevel('off');
