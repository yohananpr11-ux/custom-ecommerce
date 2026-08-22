'use strict';

const db = require('../db.js');

if (
  !db.readyPromise ||
  typeof db.readyPromise.then !== 'function'
) {
  console.error('DB_READY_PROMISE_MISSING');
  process.exitCode = 1;
} else {
  db.readyPromise
    .then(() => {
      console.log('DB_INIT_HARNESS_DONE=true');
    })
    .catch((err) => {
      console.error(
        'DB_INIT_HARNESS_FAILED=' +
        (err && err.message ? err.message : String(err))
      );
      process.exitCode = 1;
    });
}
