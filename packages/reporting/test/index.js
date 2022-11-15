import './setup.js';
/**
 * reporting.spec.js has a tendency to fail due to cssom
 * race condition during commonjs module init
 */
import 'cssom';
import './reporting.spec.js';
import './duplicate-detector.spec.js';
import './patterns-updater.spec.js';
import './country-provider.spec.js';
import './persisted-hashes.spec.js';
import './url-analyzer.spec.js';
import './alive-check.spec.js';
