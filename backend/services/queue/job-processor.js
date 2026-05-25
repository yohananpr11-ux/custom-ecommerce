const db = require('../../db');
const { processVisionJob } = require('../vision/vision-worker');
const { processPrintifyJob } = require('../printify/printify-worker');
const { syncProductToStorefront } = require('../sync/save-product');

const dbAllAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.all(query, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows || []);
  });
});

const dbRunAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.run(query, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

// A simple in-memory set to prevent double-processing in the same node process
const activeJobLocks = new Set();

async function pollAndProcessJobs() {
  try {
    // 1. Fetch pending automation jobs
    const pendingJobs = await dbAllAsync(
      `SELECT * FROM automation_jobs WHERE status IN ('received', 'analyzed', 'printify_created') ORDER BY id ASC`
    );

    if (!pendingJobs || pendingJobs.length === 0) {
      return;
    }

    for (const job of pendingJobs) {
      if (activeJobLocks.has(job.id)) {
        continue; // Job is already processing
      }

      // Lock job in memory
      activeJobLocks.add(job.id);

      // Run asynchronously to allow concurrent processing of multiple jobs
      processJobLifecycle(job).finally(() => {
        activeJobLocks.delete(job.id);
      });
    }
  } catch (err) {
    console.error('⚠️ [Queue Job Processor] Polling failed:', err.message);
  }
}

async function processJobLifecycle(job) {
  try {
    if (job.status === 'received') {
      console.log(`🚀 [Queue Job Processor] Starting Vision AI stage for Job #${job.id}`);
      // Mark as processing to avoid duplicate pickups in SQLite
      await dbRunAsync(`UPDATE automation_jobs SET status = 'processing_vision', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [job.id]);
      
      const success = await processVisionJob({ ...job, status: 'received' });
      if (success) {
        // Trigger printify stage immediately on success instead of waiting for next poll!
        const updatedJob = { ...job, status: 'analyzed' };
        await processJobLifecycle(updatedJob);
      }
    } else if (job.status === 'analyzed') {
      console.log(`🚀 [Queue Job Processor] Starting Printify stage for Job #${job.id}`);
      await dbRunAsync(`UPDATE automation_jobs SET status = 'processing_printify', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [job.id]);
      
      const success = await processPrintifyJob({ ...job, status: 'analyzed' });
      if (success) {
        const updatedJob = { ...job, status: 'printify_created' };
        await processJobLifecycle(updatedJob);
      }
    } else if (job.status === 'printify_created') {
      console.log(`🚀 [Queue Job Processor] Starting DB Sync stage for Job #${job.id}`);
      await dbRunAsync(`UPDATE automation_jobs SET status = 'processing_sync', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [job.id]);
      
      await syncProductToStorefront({ ...job, status: 'printify_created' });
    }
  } catch (lifecycleErr) {
    console.error(`❌ [Queue Job Processor] Error during Job #${job.id} lifecycle execution:`, lifecycleErr.message);
    await dbRunAsync(`UPDATE automation_jobs SET status = 'failed', errorMessage = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [lifecycleErr.message, job.id]);
  }
}

let intervalId = null;

function startQueue() {
  if (intervalId) return;
  
  console.log('⏰ [Queue Job Processor] Starting DB polling queue worker (polls every 10s)...');
  
  // Run immediately on start
  pollAndProcessJobs();
  
  intervalId = setInterval(pollAndProcessJobs, 10000);
}

function stopQueue() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('⏹️ [Queue Job Processor] DB polling queue worker stopped.');
  }
}

module.exports = {
  startQueue,
  stopQueue,
  pollAndProcessJobs
};
