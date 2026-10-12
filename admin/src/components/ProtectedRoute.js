import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('admin_token');
  const user = JSON.parse(localStorage.getItem('admin_user') || 'null');

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin' && user.role !== 'super_admin') {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
