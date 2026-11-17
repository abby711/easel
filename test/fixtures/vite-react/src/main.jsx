import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Users from './pages/Users.jsx';
import UserDetail from './pages/UserDetail.jsx';
import './styles.css';

function App() {
  return (
    <BrowserRouter>
      <nav className="nav"><Link to="/">Home</Link> <Link to="/users">Users</Link> <Link to="/about">About</Link></nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/users" element={<Users />} />
        <Route path="/users/:id" element={<UserDetail />} />
        <Route path="/about" element={<h1>About</h1>} />
        <Route path="*" element={<h1>Not found</h1>} />
      </Routes>
    </BrowserRouter>
  );
}
createRoot(document.getElementById('root')).render(<App />);
