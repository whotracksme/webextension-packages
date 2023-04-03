import './setup.js';
/**
 * reporting.spec.js has a tendency to fail due to cssom
 * race condition during commonjs module init
 */
import 'cssom';
import './reporting.spec.js';
import './duplicate-detector.spec.js';
import './patterns.spec.js';
import './patterns-updater.spec.js';
import './country-provider.spec.js';
import './persisted-hashes.spec.js';
import './url-analyzer.spec.js';
import './alive-check.spec.js';
import './sanitizer.spec.js';
import './search-extractor.spec.js';
import './request/unit/utils-test.spec.js';
import './request/unit/step-context-test.spec.js';
import './request/unit/qs-whitelist2-test.spec.js';
import './request/unit/hash-test.spec.js';
import './request/unit/index.spec.js';
