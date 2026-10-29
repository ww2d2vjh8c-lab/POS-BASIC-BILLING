# Integration Tests
Each file runs the real main-process code (IPC handlers, services, SQLite)
against a throw-away userData folder in the OS temp directory. Electron is
mocked; `npm test` runs them under Electron's Node so better-sqlite3 loads.

- `billing-flow.test.js` — a cashier's full sale: cart → bill → print → dashboard → delete
- `billing-integrity.test.js` — crashes between steps, re-used tables, discounts, paise rounding, cash, stock restore
- `input-validation.test.js` — every channel rejects bad input without writing junk
- `backup-restore.test.js` — consistent backups, never overwritten by damaged data, retention, restore
- `startup-recovery.test.js` — damaged / locked database at launch, migration failures, bill counter rebuild
