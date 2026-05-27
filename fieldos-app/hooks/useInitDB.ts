import { useEffect, useRef, useState } from 'react';
import { getDatabase } from '../db/database';
import { seedDatabase } from '../db/seed';
import { runMigrations } from '../db/migrations';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { initSecureStorage } from '../services/secureStorage';
import { initDeviceIdentity } from '../services/deviceIdentity';

/**
 * useInitDB
 *
 * Call this hook once at the root layout level.
 * It opens the SQLite database, runs migrations, seeds demo data,
 * initializes secure storage, reads device identity,
 * and hydrates the Zustand store from persisted settings.
 *
 * Returns:
 *  - isReady: true once everything is initialized
 *  - error: any initialization error
 */
export function useInitDB(): { isReady: boolean; error: Error | null } {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const initialized = useRef(false);
  const setDbReady = useFieldOSStore(s => s.setDbReady);
  const hydrateFromDb = useFieldOSStore(s => s.hydrateFromDb);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      try {
        // 1. Initialize secure storage defaults
        await initSecureStorage();

        // 2. Initialize device identity
        const deviceInfo = await initDeviceIdentity();

        // 3. Open database and create tables
        await getDatabase();

        // 4. Run migrations
        await runMigrations();

        // 5. Seed demo data (idempotent)
        await seedDatabase();

        // 6. Mark DB as ready
        setDbReady(true);

        // 7. Hydrate store from persisted settings
        await hydrateFromDb();

        console.log('[InitDB] ✓ Database ready, device:', deviceInfo.deviceId);

        // 8. Signal layout to render
        setIsReady(true);
      } catch (err) {
        console.error('Database initialization failed:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        // Even on error, allow the app to render (will show login)
        setIsReady(true);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { isReady, error };
}
