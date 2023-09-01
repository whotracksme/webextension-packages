import './setup.js';

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

// Request utils
import './request/utils/tldts.spec.js';
import './request/utils/bloom-filter-packed.spec.js';
import './request/utils/chrome-storage-map.spec.js';

// Request steps
import './request/steps/check-context.spec.js';
import './request/steps/oauth-detector.spec.js';

// Request
import './request/utils.spec.js';
import './request/qs-whitelist2.spec.js';
import './request/hash.spec.js';
import './request/database.spec.js';
import './request/index.spec.js';

// // Utils
import './utils/pacemaker.spec.js';
import './utils/url.spec.js';

// // Webrequest-pipeline
import './webrequest-pipeline/pipeline.spec.js';
