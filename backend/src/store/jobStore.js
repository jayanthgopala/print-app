const jobs = new Map();

export function createJobRecord(job) {
  const record = {
    ...job,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    errorMessage: null,
  };
  jobs.set(record.jobId, record);
  return record;
}

export function getJobRecord(jobId) {
  return jobs.get(jobId) || null;
}

export function getJobsByShop(shopCode, limit = 50) {
  const list = [];
  for (const job of jobs.values()) {
    if (job.shopCode === shopCode) list.push(job);
  }
  return list
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export function updateJobStatus(jobId, status, errorMessage = null) {
  const existing = jobs.get(jobId);
  if (!existing) return null;

  existing.status = status;
  if (status === 'printing' && !existing.startedAt) {
    existing.startedAt = new Date().toISOString();
  }
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    existing.completedAt = new Date().toISOString();
  }
  if (errorMessage) existing.errorMessage = errorMessage;
  jobs.set(jobId, existing);
  return existing;
}

export function cancelJob(jobId) {
  return updateJobStatus(jobId, 'cancelled');
}
