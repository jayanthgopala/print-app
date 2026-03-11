import React from 'react';
import './DeviceStatus.css';

function DeviceStatus({ devices }) {
  if (devices.length === 0) {
    return (
      <div className="device-status-empty">
        <p>No devices registered</p>
        <p className="help-text">Install and run the PC client to connect</p>
      </div>
    );
  }

  const formatLastSeen = (lastSeen) => {
    if (!lastSeen) return 'Never';
    
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleString();
  };

  return (
    <div className="device-status">
      <div className="device-list">
        {devices.map((device) => (
          <div key={device.deviceId} className="device-item">
            <div className="device-info">
              <div className="device-header">
                <div
                  className={`status-dot ${device.status === 'online' ? 'online' : 'offline'}`}
                ></div>
                <span className="device-name">{device.pcName}</span>
              </div>
              
              <div className="device-details">
                <div className="device-id">ID: {device.deviceId}</div>
                <div className="device-last-seen">
                  Last seen: {formatLastSeen(device.lastSeen)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="device-summary">
        <div className="summary-item">
          <span className="summary-label">Online:</span>
          <span className="summary-value">
            {devices.filter((d) => d.status === 'online').length}
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Total:</span>
          <span className="summary-value">{devices.length}</span>
        </div>
      </div>
    </div>
  );
}

export default DeviceStatus;
