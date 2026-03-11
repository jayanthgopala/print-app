import axios from 'axios';

const defaultApiUrl = import.meta.env.DEV ? 'http://localhost:3000' : '';
const API_URL = (import.meta.env.VITE_API_URL || defaultApiUrl).replace(/\/$/, '');

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    throw error;
  }
);

// Auth API
export const authService = {
  async login(shopCode) {
    const { data } = await api.post('/api/auth/login', { shopCode });
    return data;
  },

  async verify() {
    const { data } = await api.get('/api/auth/verify');
    return data;
  },
};

// Jobs API
export const jobsService = {
  async createJob(jobData) {
    const { data } = await api.post('/api/jobs', jobData);
    return data;
  },

  async getJobs(limit = 50) {
    const { data } = await api.get('/api/jobs', { params: { limit } });
    return data;
  },

  async getJob(jobId) {
    const { data } = await api.get(`/api/jobs/${jobId}`);
    return data;
  },

  async cancelJob(jobId) {
    const { data } = await api.delete(`/api/jobs/${jobId}`);
    return data;
  },
};

// Devices API
export const devicesService = {
  async getDevices() {
    const { data } = await api.get('/api/devices');
    return data;
  },

  async getDevice(deviceId) {
    const { data } = await api.get(`/api/devices/${deviceId}`);
    return data;
  },
};

// Storage upload (direct to R2/S3)
export const storageService = {
  async uploadFile(file, onProgress) {
    // In production, get a presigned URL from your backend first
    // For now, this is a placeholder for direct upload
    
    const formData = new FormData();
    formData.append('file', file);

    const { data } = await api.post('/api/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      },
    });

    return data;
  },

  // Simulate upload for demo purposes
  async simulateUpload(file, onProgress) {
    return new Promise((resolve) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        if (onProgress) {
          onProgress(progress);
        }
        if (progress >= 100) {
          clearInterval(interval);
          resolve({
            fileUrl: `https://example.com/files/${file.name}`,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
          });
        }
      }, 200);
    });
  },
};

export default api;
