import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import FileUpload from '../components/FileUpload.jsx';
import JobsList from '../components/JobsList.jsx';
import DeviceStatus from '../components/DeviceStatus.jsx';
import Header from '../components/Header.jsx';
import { jobsService, devicesService } from '../services/api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import './Dashboard.css';

function Dashboard() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
    try {
      const data = await jobsService.getJobs();
      setJobs(data.jobs);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const data = await devicesService.getDevices();
      setDevices(data.devices);
    } catch (err) {
      console.error('Failed to load devices:', err);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([loadJobs(), loadDevices()]);
      setLoading(false);
    };

    loadData();

    // Refresh data periodically
    const interval = setInterval(() => {
      loadJobs();
      loadDevices();
    }, 10000);

    return () => clearInterval(interval);
  }, [loadJobs, loadDevices]);

  // WebSocket for real-time updates
  useWebSocket(
    useCallback((message) => {
      if (message.type === 'job_update') {
        loadJobs();
      }
    }, [loadJobs])
  );

  const handleJobCreated = (newJob) => {
    setJobs((prev) => [newJob, ...prev]);
  };

  const handleJobCancelled = async (jobId) => {
    try {
      await jobsService.cancelJob(jobId);
      await loadJobs();
    } catch (err) {
      setError('Failed to cancel job');
    }
  };

  if (loading) {
    return (
      <div className="dashboard">
        <Header />
        <div className="dashboard-loading">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  const onlineDevices = devices.filter((d) => d.status === 'online');

  return (
    <div className="dashboard">
      <Header />
      
      <main className="dashboard-content">
        <div className="dashboard-grid">
          <div className="dashboard-main">
            <section className="dashboard-section">
              <h2>Submit Print Job</h2>
              {onlineDevices.length === 0 ? (
                <div className="warning-box">
                  <strong>⚠️ No devices online</strong>
                  <p>Please ensure your PC client is running and connected.</p>
                </div>
              ) : (
                <FileUpload onJobCreated={handleJobCreated} />
              )}
            </section>

            <section className="dashboard-section">
              <h2>Recent Jobs</h2>
              {error && <div className="error-box">{error}</div>}
              <JobsList jobs={jobs} onCancel={handleJobCancelled} />
            </section>
          </div>

          <div className="dashboard-sidebar">
            <section className="dashboard-section">
              <h2>Shop Information</h2>
              <div className="info-card">
                <div className="info-item">
                  <span className="info-label">Shop Code</span>
                  <span className="info-value">{user.shopCode}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Shop Name</span>
                  <span className="info-value">{user.name || 'N/A'}</span>
                </div>
              </div>
            </section>

            <section className="dashboard-section">
              <h2>Devices</h2>
              <DeviceStatus devices={devices} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
