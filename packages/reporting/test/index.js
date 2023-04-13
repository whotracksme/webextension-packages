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
import './request/steps/check-context.spec.js';
import './request/utils.spec.js';
import './request/qs-whitelist2.spec.js';
import './request/hash.spec.js';
import './request/webrequest-pipeline/pipeline.spec.js';
import './request/index.spec.js';
import './request/utils/bloom-filter-packed.spec.js';
import './request/utils/events.spec.js';
import './request/utils/pacemaker.spec.js';
