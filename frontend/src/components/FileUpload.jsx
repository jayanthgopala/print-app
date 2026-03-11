import React, { useState, useRef } from 'react';
import { jobsService, storageService } from '../services/api.js';
import './FileUpload.css';

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function FileUpload({ onJobCreated }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState(1);
  const [printerName, setPrinterName] = useState('');
  const fileInputRef = useRef(null);

  const validateFile = (file) => {
    if (!file) return 'Please select a file';
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Only PDF and image files (PNG, JPEG) are allowed';
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'File size must be less than 50MB';
    }
    return null;
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    setError('');
    
    if (selectedFile) {
      const validationError = validateFile(selectedFile);
      if (validationError) {
        setError(validationError);
        setFile(null);
      } else {
        setFile(selectedFile);
      }
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    setError('');
    
    if (droppedFile) {
      const validationError = validateFile(droppedFile);
      if (validationError) {
        setError(validationError);
        setFile(null);
      } else {
        setFile(droppedFile);
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!file) {
      setError('Please select a file');
      return;
    }

    setUploading(true);
    setError('');
    setUploadProgress(0);

    try {
      // Upload file to storage
      const uploadResult = await storageService.simulateUpload(file, setUploadProgress);

      // Create print job
      const jobData = {
        fileUrl: uploadResult.fileUrl,
        fileName: uploadResult.fileName,
        fileSize: uploadResult.fileSize,
        fileType: uploadResult.fileType,
        copies: parseInt(copies),
        printerName: printerName || undefined,
      };

      const result = await jobsService.createJob(jobData);

      // Reset form
      setFile(null);
      setCopies(1);
      setPrinterName('');
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Notify parent
      if (onJobCreated) {
        onJobCreated(result);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit print job');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="file-upload">
      {error && <div className="error-message">{error}</div>}

      <div
        className={`drop-zone ${file ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          disabled={uploading}
        />
        
        {file ? (
          <div className="file-info">
            <div className="file-icon">📄</div>
            <div className="file-details">
              <div className="file-name">{file.name}</div>
              <div className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
          </div>
        ) : (
          <div className="drop-zone-content">
            <div className="upload-icon">📤</div>
            <p className="drop-zone-text">
              Click to select or drag and drop a file
            </p>
            <p className="drop-zone-hint">PDF, PNG, or JPEG (max 50MB)</p>
          </div>
        )}
      </div>

      {uploading && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${uploadProgress}%` }}>
            {uploadProgress}%
          </div>
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="copies">Copies</label>
          <input
            id="copies"
            type="number"
            min="1"
            max="10"
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
            disabled={uploading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="printer">Printer (optional)</label>
          <input
            id="printer"
            type="text"
            placeholder="Default printer"
            value={printerName}
            onChange={(e) => setPrinterName(e.target.value)}
            disabled={uploading}
          />
        </div>
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-submit"
        disabled={!file || uploading}
      >
        {uploading ? 'Submitting...' : 'Submit Print Job'}
      </button>
    </form>
  );
}

export default FileUpload;
