import { setGlobalOptions } from 'firebase-functions/v2';

// SRS section 2: every function runs in Singapore.
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });
