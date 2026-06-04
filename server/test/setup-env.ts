import { applyE2EEnv } from './e2e-env';

// Runs before each test module is loaded so config validation (which reads
// process.env at module construction) sees the test environment.
applyE2EEnv();
