import React from 'react';
import './JobsList.css';

function JobsList({ jobs, onCancel }) {
  if (jobs.length === 0) {
    return <div className="empty-state">No print jobs yet</div>;
  }

  const getStatusColor = (status) => {
    const colors = {
      pending: '#ff9800',
      queued: '#2196f3',
      printing: '#673ab7',
      completed: '#4caf50',
      failed: '#f44336',
      cancelled: '#9e9e9e',
    };
    return colors[status] || '#999';
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="jobs-list">
      {jobs.map((job) => (
        <div key={job.jobId} className="job-card">
          <div className="job-header">
            <div className="job-title">
              <span className="job-icon">📄</span>
              <span className="job-filename">{job.fileName}</span>
            </div>
            <div
              className="job-status-badge"
              style={{ backgroundColor: getStatusColor(job.status) }}
            >
              {job.status}
            </div>
          </div>

          <div className="job-details">
            <div className="job-detail-row">
              <span className="detail-label">Job ID:</span>
              <span className="detail-value">{job.jobId}</span>
            </div>
            
            {job.copies > 1 && (
              <div className="job-detail-row">
                <span className="detail-label">Copies:</span>
                <span className="detail-value">{job.copies}</span>
              </div>
            )}
            
            <div className="job-detail-row">
              <span className="detail-label">Created:</span>
              <span className="detail-value">{formatDate(job.createdAt)}</span>
            </div>

            {job.completedAt && (
              <div className="job-detail-row">
                <span className="detail-label">Completed:</span>
                <span className="detail-value">{formatDate(job.completedAt)}</span>
              </div>
            )}
          </div>

          {(job.status === 'pending' || job.status === 'queued') && onCancel && (
            <div className="job-actions">
              <button
                className="btn-cancel"
                onClick={() => onCancel(job.jobId)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default JobsList;
